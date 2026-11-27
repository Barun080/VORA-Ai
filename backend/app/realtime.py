"""ศูนย์กลางการสื่อสารแบบเรียลไทม์ (WebSocket) ระหว่างเซิร์ฟเวอร์ หน้าจอ Kiosk และหลังบ้าน"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self.clients: dict[WebSocket, dict[str, Any]] = {}
        self._lock = asyncio.Lock()
        self.kiosk_state: dict[str, Any] = {"state": "offline", "updated": 0.0}

    async def add(self, ws: WebSocket, role: str) -> None:
        async with self._lock:
            self.clients[ws] = {"role": role, "since": time.time()}

    async def remove(self, ws: WebSocket) -> None:
        async with self._lock:
            self.clients.pop(ws, None)

    def count(self, role: str | None = None) -> int:
        return sum(1 for c in self.clients.values() if role is None or c["role"] == role)

    async def broadcast(self, topic: str, data: Any, roles: tuple[str, ...] | None = None) -> None:
        msg = json.dumps({"topic": topic, "data": data, "ts": time.time()}, ensure_ascii=False, default=str)
        dead = []
        for ws, info in list(self.clients.items()):
            if roles and info["role"] not in roles:
                continue
            try:
                await asyncio.wait_for(ws.send_text(msg), timeout=2)
            except Exception:  # noqa: BLE001 - client หลุด
                dead.append(ws)
        for ws in dead:
            await self.remove(ws)


hub = Hub()
