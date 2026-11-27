"""Robot Integration Layer — ตัวกลางระหว่างซอฟต์แวร์ VORA กับตัวควบคุมหุ่นยนต์

หน้าที่:
- เชื่อมต่อ/เชื่อมต่อใหม่อัตโนมัติ (exponential backoff) เมื่อสายหลุดหรือบอร์ดรีเซ็ต
- ส่ง heartbeat ตามรอบ เพื่อให้บอร์ดหยุดเองได้ถ้าซอฟต์แวร์ค้าง (watchdog)
- ตรวจสอบความปลอดภัยของคำสั่งก่อนส่ง จัดคิวทีละคำสั่ง รอผล ack/done พร้อม timeout
- คำสั่งหยุด (stop) แทรกได้ทันทีเหนือคำสั่งอื่นทั้งหมด และยกเลิกการเดินประชาสัมพันธ์ที่ค้างอยู่
- รับสถานะ/เหตุการณ์/ข้อผิดพลาดจากหุ่นยนต์ แล้วกระจายให้หน้าจอและหลังบ้านแบบเรียลไทม์
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from typing import Any, Awaitable, Callable

from ..config import settings
from ..realtime import hub
from ..services import record_event
from .drivers import Driver, SimulatorDriver, make_driver
from .protocol import ProtocolError, estimate_duration_ms, is_motion, validate_command


class RobotError(Exception):
    def __init__(self, code: str, msg: str = "") -> None:
        super().__init__(f"{code}: {msg}")
        self.code, self.msg = code, msg


class RobotBridge:
    def __init__(self) -> None:
        self.driver: Driver | None = None
        self.driver_kind = settings.robot_driver
        self.connected = False
        self.info: dict[str, Any] = {}
        self.status: dict[str, Any] = {}
        self.last_seen = 0.0
        self.events: deque[dict[str, Any]] = deque(maxlen=100)
        self._pending: dict[int, dict[str, Any]] = {}
        self._next_id = 1
        self._cmd_lock = asyncio.Lock()
        self._tasks: list[asyncio.Task] = []
        self._patrol: asyncio.Task | None = None
        self.patrol_name = ""
        self.motion_enabled = settings.robot_enable_motion
        self.stats = {"sent": 0, "done": 0, "errors": 0, "reconnects": 0, "ack_ms_avg": 0.0}
        self._running = False
        self.say_callback: Callable[[str, str], Awaitable[None]] | None = None

    # ------------------------------------------------------------------ วงจรชีวิต
    async def start(self) -> None:
        self._running = True
        self.driver = make_driver(self.driver_kind, settings)
        self._tasks = [asyncio.create_task(self._run()), asyncio.create_task(self._heartbeat())]

    async def shutdown(self) -> None:
        self._running = False
        await self.stop("shutdown")
        for t in self._tasks:
            t.cancel()
        if self.driver:
            await self.driver.close()

    async def switch_driver(self, kind: str) -> None:
        """สลับระหว่างหุ่นจำลองกับหุ่นจริงขณะระบบทำงาน"""
        await self.shutdown()
        self.driver_kind = kind
        self.connected = False
        self.status = {}
        await self.start()

    @property
    def is_simulator(self) -> bool:
        return isinstance(self.driver, SimulatorDriver)

    async def _run(self) -> None:
        backoff = 1.0
        while self._running:
            try:
                await self.driver.connect()
                self.connected = True
                backoff = 1.0
                self._log("info", f"เชื่อมต่อหุ่นยนต์สำเร็จ ({self.driver.describe()})")
                await self._send_raw({"cmd": "hello", "id": 0})
                await self._broadcast_status()
                async for line in self.driver.lines():
                    self.last_seen = time.time()
                    await self._handle(line)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                if self.connected:
                    self._log("error", f"การเชื่อมต่อหุ่นยนต์ขาดหาย: {e}")
                self.connected = False
                self.stats["reconnects"] += 1
                self._fail_all("DISCONNECTED", str(e))
                await self._broadcast_status()
                try:
                    await self.driver.close()
                except Exception:  # noqa: BLE001
                    pass
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 15)

    async def _heartbeat(self) -> None:
        while self._running:
            await asyncio.sleep(settings.robot_heartbeat_ms / 1000)
            if self.connected:
                try:
                    await self.driver.send(json.dumps({"cmd": "hb", "t": int(time.time() * 1000)}))
                except Exception:  # noqa: BLE001
                    pass

    # ------------------------------------------------------------------ รับข้อมูลจากหุ่นยนต์
    async def _handle(self, line: str) -> None:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            return
        t = msg.get("type")
        if t == "status":
            prev_estop = self.status.get("estop")
            self.status = msg
            if msg.get("estop") and not prev_estop:
                self._log("warn", "หุ่นยนต์อยู่ในสถานะหยุดฉุกเฉิน (E-Stop)")
            await hub.broadcast("robot.status", self.public_status(), roles=("admin", "kiosk"))
        elif t == "hello":
            self.info = msg
        elif t in ("ack", "done", "error"):
            mid = msg.get("id")
            p = self._pending.get(mid)
            if p:
                if t == "ack":
                    p["ack_at"] = time.time()
                    ms = (p["ack_at"] - p["sent_at"]) * 1000
                    self.stats["ack_ms_avg"] = round(self.stats["ack_ms_avg"] * 0.8 + ms * 0.2, 1)
                elif not p["future"].done():
                    p["future"].set_result(msg)
            if t == "error":
                self.stats["errors"] += 1
                self._log("warn", f"หุ่นยนต์แจ้งข้อผิดพลาด {msg.get('code')}: {msg.get('msg', '')}", code=msg.get("code"))
        elif t == "event":
            ev = {"name": msg.get("name"), "data": msg, "at": time.time()}
            self.events.appendleft(ev)
            level = "warn" if msg.get("name") in ("estop_pressed", "watchdog_stop", "obstacle_blocked", "hw_fault", "low_battery") else "info"
            self._log(level, f"เหตุการณ์จากหุ่นยนต์: {msg.get('name')}", **{k: v for k, v in msg.items() if k != "type"})
            await hub.broadcast("robot.event", ev, roles=("admin", "kiosk"))

    def _fail_all(self, code: str, msg: str) -> None:
        for p in self._pending.values():
            if not p["future"].done():
                p["future"].set_result({"type": "error", "id": p["id"], "code": code, "msg": msg})

    # ------------------------------------------------------------------ ส่งคำสั่ง
    async def _send_raw(self, cmd: dict[str, Any]) -> None:
        await self.driver.send(json.dumps(cmd, ensure_ascii=False))

    async def execute(self, cmd: dict[str, Any], wait: bool = True, source: str = "system") -> dict[str, Any]:
        """ส่งคำสั่ง 1 คำสั่งและรอจนเสร็จ คืนผลลัพธ์ {ok, code, ...}"""
        try:
            clean = validate_command(cmd)
        except ProtocolError as e:
            raise RobotError("INVALID", str(e))
        if clean["cmd"] == "stop":
            await self.stop(source)
            return {"ok": True}
        if not self.connected:
            raise RobotError("DISCONNECTED", "หุ่นยนต์ไม่ได้เชื่อมต่อ")
        if is_motion(clean) and not self.motion_enabled:
            raise RobotError("MOTION_DISABLED", "ปิดการเคลื่อนที่ไว้ในหลังบ้าน")
        if is_motion(clean) and self.patrol_running and source != "patrol":
            raise RobotError("BUSY", "กำลังเดินประชาสัมพันธ์อยู่ กดหยุดก่อนสั่งงานอื่น")
        if self.status.get("estop") and clean["cmd"] not in ("estop_reset", "status", "hello"):
            raise RobotError("ESTOP", "หุ่นยนต์อยู่ในสถานะหยุดฉุกเฉิน")
        async with self._cmd_lock:
            mid = self._next_id
            self._next_id += 1
            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            self._pending[mid] = {"id": mid, "future": fut, "sent_at": time.time(), "cmd": clean}
            self.stats["sent"] += 1
            try:
                await self._send_raw({**clean, "id": mid})
                await hub.broadcast("robot.command", {"id": mid, "cmd": clean, "source": source}, roles=("admin",))
                if not wait:
                    return {"ok": True, "id": mid, "queued": True}
                timeout = estimate_duration_ms(clean) / 1000 * 2.5 + 5     # เผื่อเวลาหลบสิ่งกีดขวาง
                try:
                    res = await asyncio.wait_for(fut, timeout=timeout)
                except asyncio.TimeoutError:
                    await self._send_raw({"cmd": "stop", "id": 0})
                    self._log("error", f"คำสั่ง {clean['cmd']} ไม่เสร็จภายในเวลา จึงสั่งหยุดเพื่อความปลอดภัย")
                    raise RobotError("TIMEOUT", "คำสั่งไม่เสร็จภายในเวลาที่กำหนด")
            finally:
                self._pending.pop(mid, None)
        if res.get("type") == "error":
            raise RobotError(res.get("code", "HW_FAULT"), res.get("msg", ""))
        self.stats["done"] += 1
        return {"ok": True, "id": mid, "interrupted": bool(res.get("interrupted"))}

    async def gesture(self, name: str, source: str = "ai") -> None:
        """ท่าทางประกอบการพูด: ไม่บล็อกบทสนทนา และไม่แทรกถ้าหุ่นกำลังทำอย่างอื่น"""
        if not self.connected or self._cmd_lock.locked() or self.patrol_running:
            return
        try:
            await self.execute({"cmd": "gesture", "name": name}, source=source)
        except RobotError:
            pass

    async def stop(self, source: str = "user") -> None:
        """หยุดทันที: ยกเลิกการเดินประชาสัมพันธ์ ยกเลิกคำสั่งค้าง แล้วส่ง stop (ไม่ต้องรอคิว)"""
        if self._patrol and not self._patrol.done():
            self._patrol.cancel()
        if self.connected:
            try:
                await self._send_raw({"cmd": "stop", "id": 0})
            except Exception:  # noqa: BLE001
                pass
        self._fail_all("STOPPED", f"stopped by {source}")
        if source not in ("shutdown",):
            self._log("info", f"สั่งหยุดหุ่นยนต์ (โดย {source})")
        await hub.broadcast("robot.stopped", {"source": source}, roles=("admin", "kiosk"))

    # ------------------------------------------------------------------ เดินประชาสัมพันธ์ (ลำดับคำสั่ง)
    @property
    def patrol_running(self) -> bool:
        return bool(self._patrol and not self._patrol.done())

    def start_patrol(self, name: str, steps: list[dict[str, Any]], lang: str = "th") -> None:
        if self.patrol_running:
            raise RobotError("BUSY", "กำลังเดินประชาสัมพันธ์อยู่")
        self.patrol_name = name
        self._patrol = asyncio.create_task(self._run_patrol(name, steps, lang))

    async def _run_patrol(self, name: str, steps: list[dict[str, Any]], lang: str) -> None:
        await hub.broadcast("patrol.started", {"name": name, "steps": len(steps)})
        self._log("info", f"เริ่มเดินประชาสัมพันธ์: {name}")
        try:
            for i, step in enumerate(steps):
                await hub.broadcast("patrol.step", {"index": i, "step": step}, roles=("admin",))
                if step.get("cmd") == "say":
                    text = step.get("text_en") if lang == "en" and step.get("text_en") else step.get("text_th", "")
                    if self.say_callback and text:
                        await self.say_callback(text, lang)
                    await asyncio.sleep(min(12, 1.5 + len(text) * 0.09))   # รอพูดจบโดยประมาณ
                    continue
                if step.get("cmd") == "wait":
                    await asyncio.sleep(min(30, float(step.get("seconds", 1))))
                    continue
                try:
                    await self.execute(step, source="patrol")
                except RobotError as e:
                    if e.code == "OBSTACLE":
                        self._log("warn", f"ทางถูกปิดกั้นระหว่างเดินประชาสัมพันธ์ ข้ามขั้นตอนที่ {i + 1}")
                        continue
                    raise
            await hub.broadcast("patrol.finished", {"name": name, "ok": True})
            self._log("info", f"เดินประชาสัมพันธ์เสร็จ: {name}")
        except asyncio.CancelledError:
            await hub.broadcast("patrol.finished", {"name": name, "ok": False, "reason": "cancelled"})
        except RobotError as e:
            await hub.broadcast("patrol.finished", {"name": name, "ok": False, "reason": e.code})
            self._log("warn", f"หยุดเดินประชาสัมพันธ์เพราะ {e.code}")
        finally:
            self.patrol_name = ""

    # ------------------------------------------------------------------ เครื่องมือสำหรับหุ่นจำลอง
    def sim(self):
        if not self.is_simulator:
            raise RobotError("NOT_SIMULATOR", "ใช้ได้เฉพาะโหมดหุ่นจำลอง")
        return self.driver.robot

    # ------------------------------------------------------------------ สถานะ
    def public_status(self) -> dict[str, Any]:
        st = dict(self.status)
        st.pop("type", None)
        online = self.connected and (time.time() - self.last_seen < 3)
        data = {
            "driver": self.driver_kind, "driver_label": self.driver.describe() if self.driver else "",
            "connected": self.connected, "online": online,
            "ready": online and not st.get("estop") and st.get("battery", 100) > 10,
            "motion_enabled": self.motion_enabled, "patrol": self.patrol_name if self.patrol_running else "",
            "firmware": self.info.get("fw", ""), "caps": self.info.get("caps", {}), "stats": self.stats, **st,
        }
        if self.is_simulator:
            data["world"] = self.driver.robot.world()
        return data

    async def _broadcast_status(self) -> None:
        await hub.broadcast("robot.status", self.public_status(), roles=("admin", "kiosk"))

    def _log(self, level: str, message: str, **data: Any) -> None:
        self.events.appendleft({"name": "log", "level": level, "message": message, "at": time.time()})
        if level in ("warn", "error") or data.get("name") or "เชื่อมต่อ" in message or "เดินประชาสัมพันธ์" in message:
            record_event(level, "robot", message, **data)


bridge = RobotBridge()
