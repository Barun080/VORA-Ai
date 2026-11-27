"""ตัวตรวจการเชื่อมต่ออินเทอร์เน็ต + โหมดฐานความรู้ (งาน F "สาธิตไม่สะดุด" · 21 พ.ย. 2569)

ทำไม: บริการ AI (Gemini), ค้นเว็บ และเสียงพูด (Google TTS) ต้องใช้อินเทอร์เน็ต · ถ้าเน็ตล่มกลางสาธิต เดิมแต่ละคำถาม
ต้องรอ timeout ของ AI (≈12–22 วิ) ก่อนตกไปตอบจากฐานความรู้ และเสียงพูดรอ timeout อีกรอบ → ดูเหมือนระบบค้าง
ใหม่: ตรวจเน็ตเป็นระยะในเบื้องหลัง · ออฟไลน์ = "โหมดฐานความรู้" ทันที (ไม่เรียกบริการภายนอก ไม่ต้องรอ timeout)
· ตอบจากฐานความรู้ที่อนุมัติแล้ว · พูดด้วยไฟล์เสียงที่เตรียมไว้ล่วงหน้า (tts.pinned) · เน็ตกลับมา = กลับเป็นโหมด AI เอง

ค่าตั้ง
- VORA_NET_CHECK_S  ช่วงตรวจตอนออนไลน์ (วินาที) · 0 = ปิดการตรวจ (ถือว่าออนไลน์เสมอ = พฤติกรรมเดิมทุกประการ)
- VORA_NET_CHECK_URLS  ที่อยู่สำหรับตรวจ คั่นด้วย , (ค่าเริ่มต้น: หน้า generate_204 ของ Google ซึ่งเป็นผู้ให้บริการ AI/เสียงที่ใช้อยู่)
- จำลองเน็ตล่ม (force) — เจ้าหน้าที่เปิดจากหลังบ้านเพื่อซ้อม/สาธิตโดยไม่ต้องถอดสาย · เก็บใน settings (offline_force)

ไม่มีข้อมูลผู้ใช้ออกไปกับการตรวจ: เป็นคำขอ HTTP เปล่า ๆ ไปยังที่อยู่ที่กำหนดเท่านั้น
"""
from __future__ import annotations

import asyncio
import contextlib
import contextvars
import logging
from datetime import datetime
from typing import Any

from .config import settings

log = logging.getLogger("vora.net")

FAILS_TO_OFFLINE = 2        # ล้มติดกันกี่ครั้งจึงถือว่าออฟไลน์ (กันเน็ตกระตุกครั้งเดียว)
OFFLINE_RECHECK_S = 5.0     # ตอนออฟไลน์ ตรวจถี่ขึ้น เพื่อกลับเป็นโหมด AI ให้เร็ว
PROBE_TIMEOUT_S = 3.0

_state: dict[str, Any] = {"online": True, "forced": False, "fails": 0, "checked_at": None,
                          "changed_at": None, "last_error": "", "task": None}


# จำลองโหมดฐานความรู้ "เฉพาะงานที่กำลังทำ" (ใช้ตอนหลังบ้านคำนวณข้อความที่ระบบจะตอบเมื่อเน็ตล่ม) — ไม่กระทบผู้ใช้คนอื่น
_override: contextvars.ContextVar[bool | None] = contextvars.ContextVar("vora_offline_override", default=None)


@contextlib.contextmanager
def simulate_offline():
    token = _override.set(True)
    try:
        yield
    finally:
        _override.reset(token)


def enabled() -> bool:
    return settings.net_check_s > 0


def offline() -> bool:
    """True = ใช้โหมดฐานความรู้ (จำลองเน็ตล่มอยู่ หรือ ตรวจพบว่าเน็ตล่มจริง)"""
    ov = _override.get()
    if ov is not None:
        return ov
    return bool(_state["forced"]) or (enabled() and not _state["online"])


def set_forced(on: bool) -> None:
    if bool(on) != bool(_state["forced"]):
        _state["changed_at"] = datetime.now().isoformat(timespec="seconds")
    _state["forced"] = bool(on)


def status() -> dict[str, Any]:
    """สถานะสำหรับหน้าจอ/หลังบ้าน (ไม่มีข้อมูลลับ)"""
    return {"online": not offline(), "mode": "kb" if offline() else "ai", "forced": bool(_state["forced"]),
            "monitor": enabled(), "net_ok": bool(_state["online"]), "checked_at": _state["checked_at"],
            "changed_at": _state["changed_at"], "last_error": _state["last_error"]}


def _set_online(ok: bool, err: str = "") -> None:
    _state["checked_at"] = datetime.now().isoformat(timespec="seconds")
    if ok:
        was = _state["online"]
        _state.update(online=True, fails=0, last_error="")
        if not was:
            _state["changed_at"] = _state["checked_at"]
            _event("info", "อินเทอร์เน็ตกลับมาแล้ว — กลับเป็นโหมด AI")
        return
    _state["fails"] += 1
    _state["last_error"] = err[:200]
    if _state["online"] and _state["fails"] >= FAILS_TO_OFFLINE:
        _state["online"] = False
        _state["changed_at"] = _state["checked_at"]
        _event("warn", f"ตรวจไม่พบอินเทอร์เน็ต — เปลี่ยนเป็นโหมดฐานความรู้ ({_state['last_error']})")


def _event(level: str, message: str) -> None:
    try:
        from .services import record_event
        record_event(level, "network", message)
    except Exception:  # noqa: BLE001 — การบันทึกเหตุการณ์ล้มต้องไม่ทำให้ตัวตรวจหยุด
        log.warning(message)


async def probe_once() -> bool:
    """ลองเชื่อมต่อที่อยู่ตรวจทีละที่ (ได้คำตอบ HTTP ใด ๆ = ออนไลน์) · คืนผลและอัปเดตสถานะ"""
    import httpx

    err = "no url"
    for url in settings.net_check_urls:
        try:
            async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_S, follow_redirects=False) as c:
                await c.get(url)
            _set_online(True)
            return True
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}"
    _set_online(False, err)
    return False


async def _loop() -> None:
    while True:
        try:
            await probe_once()
        except Exception as e:  # noqa: BLE001
            log.warning("net probe error: %s", e)
        await asyncio.sleep(OFFLINE_RECHECK_S if not _state["online"] else max(5.0, float(settings.net_check_s)))


def start(forced: bool = False) -> None:
    set_forced(forced)
    if not enabled() or _state["task"] is not None:
        return
    _state["task"] = asyncio.get_running_loop().create_task(_loop())


async def stop() -> None:
    t = _state.get("task")
    _state["task"] = None
    if t is not None:
        t.cancel()
        try:
            await t
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass


def _reset_for_tests() -> None:
    _state.update(online=True, forced=False, fails=0, checked_at=None, changed_at=None, last_error="")


def is_local_url(url: str) -> bool:
    """ผู้ให้บริการที่รันในเครื่อง/เครือข่ายภายใน (เช่น ollama) ใช้ได้แม้ไม่มีอินเทอร์เน็ต"""
    from urllib.parse import urlparse

    host = (urlparse(url or "").hostname or "").lower()
    return host in ("localhost", "127.0.0.1", "::1") or host.endswith(".local")


__all__ = ["simulate_offline", "offline", "status", "start", "stop", "set_forced", "probe_once", "enabled", "is_local_url"]
