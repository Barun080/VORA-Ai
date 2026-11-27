"""25 พ.ย. 2569: เปิดเซิร์ฟเวอร์ VORA — http (พอร์ตเดิม 8000) + https (8443) ในโปรเซสเดียว ใช้แอปตัวเดียวกัน

ทำไมโปรเซสเดียว: ถ้ารัน uvicorn 2 ตัว จะได้ตัวตั้งเวลาประกาศ 2 ชุด และเปิดพอร์ตหุ่นยนต์ (COM) ซ้อนกัน
https เปิดเมื่อมีใบรับรอง data/certs/vora-lan.crt + .key (สร้างด้วย lan_setup.bat) และ VORA_HTTPS_PORT ไม่เป็น 0
ไม่มีใบรับรอง = ทำงานแบบเดิมทุกอย่าง (http อย่างเดียว)
"""
from __future__ import annotations

import asyncio
import contextlib
import os
import signal
import socket
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.config import DATA_DIR, settings  # noqa: E402

CERT = DATA_DIR / "certs" / "vora-lan.crt"
KEY = DATA_DIR / "certs" / "vora-lan.key"


class _Server(uvicorn.Server):
    """ให้ serve.py จัดการ Ctrl+C เอง (หยุดทั้ง http และ https พร้อมกัน)"""
    def install_signal_handlers(self) -> None:          # uvicorn รุ่นเก่า
        pass

    @contextlib.contextmanager
    def capture_signals(self):                          # uvicorn 0.29+
        yield


def lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:  # noqa: BLE001
        return "127.0.0.1"


async def main() -> None:
    use_https = settings.https_port > 0 and CERT.exists() and KEY.exists()
    if use_https:
        os.environ["VORA_HTTPS_ACTIVE"] = "1"
    servers = [_Server(uvicorn.Config("app.main:app", host=settings.host, port=settings.port, log_level="info"))]
    if use_https:
        servers.append(_Server(uvicorn.Config("app.main:app", host=settings.host, port=settings.https_port, log_level="info",
                                              ssl_certfile=str(CERT), ssl_keyfile=str(KEY), lifespan="off")))
    ip = lan_ip()
    print("=" * 62)
    print(f"  Robot screen (this PC) : http://localhost:{settings.port}/")
    print(f"  Admin (this PC)        : http://localhost:{settings.port}/admin/")
    if use_https:
        print(f"  Other PCs on LAN       : https://{ip}:{settings.https_port}/        (robot screen)")
        print(f"                           https://{ip}:{settings.https_port}/admin/  (admin)")
        print("  First visit on each PC: click 'Advanced' -> 'Proceed' once.")
    else:
        print(f"  Other PCs on LAN       : http://{ip}:{settings.port}/  (no mic/camera - run lan_setup.bat for https)")
    print("=" * 62, flush=True)

    loop = asyncio.get_running_loop()

    def stop(*_a) -> None:
        for s in servers:
            s.should_exit = True
    with contextlib.suppress(NotImplementedError, AttributeError):
        loop.add_signal_handler(signal.SIGINT, stop)
        loop.add_signal_handler(signal.SIGTERM, stop)
    if sys.platform == "win32":                          # Windows: add_signal_handler ใช้ไม่ได้
        signal.signal(signal.SIGINT, stop)
        with contextlib.suppress(AttributeError, ValueError):
            signal.signal(signal.SIGBREAK, stop)
    # เริ่ม http ก่อน (ตัวที่รัน lifespan: ฐานข้อมูล หุ่นยนต์ ตัวตั้งเวลา) แล้วจึงเปิด https
    first = asyncio.create_task(servers[0].serve())
    while not servers[0].started and not first.done():
        await asyncio.sleep(0.1)
    rest = [asyncio.create_task(s.serve()) for s in servers[1:]]
    done, _ = await asyncio.wait([first, *rest], return_when=asyncio.FIRST_COMPLETED)
    stop()                                               # ตัวใดตัวหนึ่งหยุด → หยุดทั้งหมด (start.bat จะเปิดใหม่ให้)
    await asyncio.gather(first, *rest, return_exceptions=True)
    for t in done:
        if t.exception():
            raise t.exception()


if __name__ == "__main__":
    asyncio.run(main())
