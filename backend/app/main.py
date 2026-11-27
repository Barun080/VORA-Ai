"""VORA — ระบบซอฟต์แวร์หุ่นยนต์ประชาสัมพันธ์อัจฉริยะ (จุดเริ่มต้นของเซิร์ฟเวอร์)

เริ่มระบบ:  python -m uvicorn app.main:app --host 0.0.0.0 --port 8000   (รันจากโฟลเดอร์ backend)
หน้าจอหุ่นยนต์:   http://localhost:8000/
หลังบ้าน:        http://localhost:8000/admin/
หน้ามือถือ:      http://<IP เครื่อง>:8000/m/
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import jwt
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import connectivity, logsafe
from .ai.training import load_active_models
from .config import DATA_DIR, FRONTEND_DIR, settings
from .db import DIALECT, Base, SessionLocal, engine, wait_for_db
from .realtime import hub
from .robot.bridge import bridge
from .routers import admin, aimodels, auth, brain, offline, public, reports, robot, sandbox, screens, vision_detail, vision_import
from .scheduler import scheduler
from .schema_guard import check_schema
from .seed import seed
from .services import get_setting, record_event

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("vora")
logsafe.install()     # 21 พ.ย. 2569: ปิดบังรหัส (token=) ใน log + ซ่อนบรรทัดตรวจเน็ตที่สำเร็จ — ดู app/logsafe.py


async def _say_on_kiosk(text: str, lang: str) -> None:
    await hub.broadcast("say", {"text": text, "lang": lang, "source": "patrol"}, roles=("kiosk",))


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(wait_for_db)
    log.info("ใช้ฐานข้อมูล %s", DIALECT)
    Base.metadata.create_all(engine)
    check_schema(engine)          # create_all ไม่เพิ่มคอลัมน์ให้ตารางเดิม — ขาดคอลัมน์ = ยังไม่ได้รัน migrate.bat upgrade
    db = SessionLocal()
    try:
        seed(db)
        load_active_models(db)
    finally:
        db.close()
    bridge.say_callback = _say_on_kiosk
    await bridge.start()
    scheduler.start()
    db = SessionLocal()
    try:
        forced = bool(get_setting(db, "offline_force"))      # งาน F: จำลองเน็ตล่มที่เจ้าหน้าที่เปิดค้างไว้
    except Exception:  # noqa: BLE001
        forced = False
    try:
        from .ai import providers
        providers.load_saved(db)                              # 22 พ.ย. 2569: โมเดล AI ที่เลือกไว้ในหลังบ้าน
    except Exception as e:  # noqa: BLE001 - ห้ามทำให้ระบบเปิดไม่ขึ้น → ใช้ค่า .env
        record_event("warn", "ai", f"โหลดโมเดล AI ที่เลือกไว้ไม่สำเร็จ: {type(e).__name__}")
    finally:
        db.close()
    logsafe.install()      # ซ้ำได้ — เผื่อ uvicorn ตั้งค่า logging ใหม่หลัง import
    connectivity.start(forced)                               # งาน F: ตรวจอินเทอร์เน็ตเบื้องหลัง (VORA_NET_CHECK_S=0 = ปิด)
    record_event("info", "system",
                 f"VORA started (db={DIALECT}, robot={settings.robot_driver}, llm={settings.llm_provider})")
    yield
    await connectivity.stop()
    await scheduler.stop()
    await bridge.shutdown()


app = FastAPI(title="VORA Smart PR Robot API", version="1.0.0", lifespan=lifespan,
              description="API ของระบบหุ่นยนต์ประชาสัมพันธ์อัจฉริยะ VORA")
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def no_stale_frontend(request: Request, call_next):
    """ให้เบราว์เซอร์ตรวจไฟล์หน้าจอใหม่ทุกครั้ง (หลังอัปเดตดีไซน์จะได้ไม่ค้างหน้าเก่า)"""
    try:
        response = await call_next(request)
    except RuntimeError as e:
        # 12 พ.ย. 2569: เบราว์เซอร์ยกเลิกคำขอกลางทาง (รีเฟรช/ปิดหน้าขณะโหลดฟอนต์) → Starlette แจ้ง "No response returned."
        # ไม่ใช่ข้อผิดพลาดของระบบ → ตอบ 204 เงียบ ๆ ไม่พิมพ์ traceback ยาวในหน้าต่าง start.bat และไม่บันทึกเป็น error
        if str(e) == "No response returned." or await request.is_disconnected():
            return Response(status_code=204)
        raise
    path = request.url.path
    if not path.startswith(("/api", "/uploads", "/assets")) and (path.endswith((".html", ".js", ".css", "/")) or "." not in path.rsplit("/", 1)[-1]):
        response.headers["Cache-Control"] = "no-cache"
    return response

for r in (public.router, auth.router, admin.router, robot.router, reports.router, offline.router, brain.router, aimodels.router,
          sandbox.router, vision_detail.router, vision_import.router, screens.router):
    app.include_router(r)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    record_event("error", "system", f"{request.method} {request.url.path}: {type(exc).__name__}: {exc}")
    return JSONResponse(status_code=500, content={"detail": "ระบบขัดข้องชั่วคราว กรุณาลองใหม่"})


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    role = ws.query_params.get("role", "kiosk")
    display = False                                   # 25 พ.ย. 2569: จอในวง LAN ที่อนุมัติแล้ว (ไม่ใช่เครื่องบนตัวหุ่นยนต์)
    if role == "admin":
        try:
            jwt.decode(ws.query_params.get("token", ""), settings.secret_key, algorithms=["HS256"])
        except jwt.PyJWTError:
            await ws.close(code=4401)
            return
    elif role not in ("kiosk", "mobile"):
        await ws.close(code=4400)
        return
    elif role == "kiosk" and not public.is_trusted_kiosk(ws):
        # Phase 6 · 6E-4 (F1b): บทบาท kiosk (รับคำสั่งพูด/ส่งสถานะหน้าจอให้หลังบ้าน) เฉพาะเครื่องที่เชื่อถือได้
        if not public.is_display_kiosk(ws):
            await ws.close(code=4403)
            return
        display = True                                # รับประกาศ/คำสั่งพูดได้ แต่ไม่เปลี่ยนสถานะหน้าจอหลักในหลังบ้าน
    await ws.accept()
    await hub.add(ws, role)
    try:
        await ws.send_json({"topic": "hello", "data": {"role": role, "robot": bridge.public_status()}})
        while True:
            msg = await asyncio.wait_for(ws.receive_json(), timeout=120)
            t = msg.get("type")
            if t == "ping":
                await ws.send_json({"topic": "pong", "data": {}})
            elif t == "state" and role == "kiosk" and not display:
                import time
                hub.kiosk_state = {"state": str(msg.get("state", ""))[:24], "updated": time.time()}
                await hub.broadcast("kiosk.state", hub.kiosk_state, roles=("admin",))
            elif t == "event" and role == "kiosk":
                await hub.broadcast("kiosk.event", msg.get("data", {}), roles=("admin",))
    except (WebSocketDisconnect, asyncio.TimeoutError, RuntimeError):
        pass
    except Exception as e:  # noqa: BLE001
        log.warning("ws error: %s", e)
    finally:
        await hub.remove(ws)
        if role == "kiosk" and hub.count("kiosk") == 0:
            hub.kiosk_state = {"state": "offline", "updated": 0}


@app.get("/admin", include_in_schema=False)
def admin_redirect():
    return RedirectResponse("/admin/")


@app.get("/m", include_in_schema=False)
def mobile_redirect():
    return RedirectResponse("/m/")


(DATA_DIR / "uploads").mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=DATA_DIR / "uploads"), name="uploads")
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")
app.mount("/shared", StaticFiles(directory=FRONTEND_DIR / "shared"), name="shared")
app.mount("/admin", StaticFiles(directory=FRONTEND_DIR / "admin", html=True), name="admin")
app.mount("/m", StaticFiles(directory=FRONTEND_DIR / "mobile", html=True), name="mobile")
app.mount("/", StaticFiles(directory=FRONTEND_DIR / "kiosk", html=True), name="kiosk")
