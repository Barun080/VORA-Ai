"""ไดรเวอร์การเชื่อมต่อกับหุ่นยนต์: Simulator / Serial (USB-UART) / WebSocket (Wi-Fi)

ทุกไดรเวอร์มีอินเทอร์เฟซเดียวกัน: connect(), close(), send(line), lines() -> async iterator
จึงสลับจากหุ่นจำลองไปหุ่นจริงได้ด้วยการเปลี่ยนค่า VORA_ROBOT_DRIVER เพียงค่าเดียว
"""
from __future__ import annotations

import asyncio
import threading
from typing import AsyncIterator

from .simulator import VirtualRobot


class Driver:
    name = "base"

    async def connect(self) -> None: ...
    async def close(self) -> None: ...
    async def send(self, line: str) -> None: ...

    async def lines(self) -> AsyncIterator[str]:  # pragma: no cover
        if False:
            yield ""

    def describe(self) -> str:
        return self.name


class SimulatorDriver(Driver):
    name = "simulator"

    def __init__(self) -> None:
        self.robot = VirtualRobot()

    async def connect(self) -> None:
        self.robot.start()

    async def close(self) -> None:
        await self.robot.stop_loop()

    async def send(self, line: str) -> None:
        await self.robot.receive_line(line)

    async def lines(self) -> AsyncIterator[str]:
        while True:
            yield await self.robot.queue_out.get()

    def describe(self) -> str:
        return "หุ่นยนต์จำลอง (Virtual Robot)"


class SerialDriver(Driver):
    """เชื่อมต่อบอร์ด (เช่น ESP32/Arduino) ผ่านสาย USB ใช้ pyserial อ่านในเธรดแยก"""
    name = "serial"

    def __init__(self, port: str, baud: int) -> None:
        self.port, self.baud = port, baud
        self._ser = None
        self._q: asyncio.Queue[str] = asyncio.Queue()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop = threading.Event()

    async def connect(self) -> None:
        import serial  # pyserial

        self._loop = asyncio.get_running_loop()
        self._ser = serial.Serial(self.port, self.baud, timeout=0.2, write_timeout=1)
        self._stop.clear()
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self) -> None:
        buf = b""
        while not self._stop.is_set():
            try:
                chunk = self._ser.read(256)
            except Exception as e:  # noqa: BLE001 - สายหลุด
                self._loop.call_soon_threadsafe(self._q.put_nowait, f'{{"type":"_disconnected","msg":"{e}"}}')
                return
            if not chunk:
                continue
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                text = line.decode("utf-8", "ignore").strip()
                if text.startswith("{"):
                    self._loop.call_soon_threadsafe(self._q.put_nowait, text)

    async def close(self) -> None:
        self._stop.set()
        if self._ser:
            try:
                self._ser.close()
            except Exception:  # noqa: BLE001
                pass

    async def send(self, line: str) -> None:
        if not self._ser:
            raise ConnectionError("serial not open")
        await asyncio.to_thread(self._ser.write, (line + "\n").encode("utf-8"))

    async def lines(self) -> AsyncIterator[str]:
        while True:
            line = await self._q.get()
            if line.startswith('{"type":"_disconnected"'):
                raise ConnectionError(line)
            yield line

    def describe(self) -> str:
        return f"Serial {self.port} @ {self.baud}"


class WebSocketDriver(Driver):
    """เชื่อมต่อบอร์ดที่เปิด WebSocket server ผ่าน Wi-Fi (เช่น ESP32 โหมด Access Point)"""
    name = "websocket"

    def __init__(self, url: str) -> None:
        self.url = url
        self._ws = None

    async def connect(self) -> None:
        import websockets

        self._ws = await websockets.connect(self.url, open_timeout=5, ping_interval=5, ping_timeout=5)

    async def close(self) -> None:
        if self._ws:
            await self._ws.close()

    async def send(self, line: str) -> None:
        if not self._ws:
            raise ConnectionError("websocket not open")
        await self._ws.send(line)

    async def lines(self) -> AsyncIterator[str]:
        async for msg in self._ws:
            if isinstance(msg, bytes):
                msg = msg.decode("utf-8", "ignore")
            for part in msg.splitlines():
                if part.strip():
                    yield part.strip()
        raise ConnectionError("websocket closed")

    def describe(self) -> str:
        return f"WebSocket {self.url}"


def make_driver(kind: str, settings) -> Driver:
    if kind == "serial":
        return SerialDriver(settings.robot_serial_port, settings.robot_serial_baud)
    if kind == "websocket":
        return WebSocketDriver(settings.robot_ws_url)
    return SimulatorDriver()
