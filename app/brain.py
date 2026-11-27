"""งาน A "สมองโปร่งใส" (21 พ.ย. 2569) — เก็บและส่งขั้นตอนการตัดสินใจของ AI ให้หน้าหลังบ้าน

ทำอะไร: หลังตอบคำถามแต่ละครั้ง engine แนบ res.trace (ดู ai/engine._build_trace) ไว้ · โมดูลนี้
  1) เก็บ trace ล่าสุดในหน่วยความจำ (ring buffer ไม่ลงฐานข้อมูล ไม่ลงไฟล์ — รีสตาร์ตแล้วหาย)
  2) กระจายไปยังหน้าหลังบ้านที่ล็อกอินแล้วเท่านั้น (hub topic "ai.trace", role admin)
ไม่ทำอะไร: ไม่เปลี่ยนคำตอบ ไม่เปลี่ยน JSON ของ /api/chat · ปิดได้ด้วย VORA_BRAIN_TRACE=0
ความเป็นส่วนตัว: คำถามผ่าน redact_pii แล้ว (เบอร์/อีเมล/เลขบัตร ถูกปิด) · ไม่มี system prompt/คีย์/CONTEXT เต็ม
"""
from __future__ import annotations

from collections import deque
from typing import Any

from .config import settings

_recent: deque[dict[str, Any]] = deque(maxlen=max(1, settings.brain_trace_keep))


def enabled() -> bool:
    return bool(settings.brain_trace)


def record(trace: dict[str, Any] | None) -> dict[str, Any] | None:
    """เก็บ trace (ถ้าเปิดใช้) และคืนค่าที่เก็บ · ปิดอยู่/ไม่มี trace → None"""
    if not enabled() or not trace:
        return None
    _recent.append(trace)
    return trace


def recent(n: int = 20) -> list[dict[str, Any]]:
    n = max(1, min(int(n), _recent.maxlen or 1))
    return list(_recent)[-n:][::-1]          # ใหม่สุดก่อน


async def publish(trace: dict[str, Any] | None, *, extra: dict[str, Any] | None = None) -> None:
    """เก็บแล้วกระจายให้หลังบ้าน · ผิดพลาดใด ๆ ต้องไม่กระทบการตอบผู้ใช้"""
    try:
        t = record({**trace, **(extra or {})} if trace else None)
        if t is None:
            return
        from .realtime import hub
        await hub.broadcast("ai.trace", t, roles=("admin",))
    except Exception:  # noqa: BLE001 - จอแสดงผลเสริม ห้ามทำให้แชตล้ม
        pass


def _reset_for_tests() -> None:
    _recent.clear()
