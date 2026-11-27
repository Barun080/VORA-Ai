"""25 พ.ย. 2569: จอในวง LAN — เครื่องอื่นเปิดหน้าจอหุ่นยนต์ได้เหมือนเครื่องหลัก (ยกเว้นสั่งหุ่นยนต์จริง)

ลำดับ: เปิด https://<IP เครื่องหลัก>:8443/ บนเครื่องอื่น → หน้าจอสร้างกุญแจสุ่มเก็บในเบราว์เซอร์ แล้วขอเข้าระบบ (POST /api/screens/hello)
→ หลังบ้าน "จอในวง LAN" แสดงรหัส 4 ตัว ผู้ดูแลกดอนุมัติ → คำขอที่แนบกุญแจ (X-VORA-Screen / ?screen=) ได้สิทธิ์ "จอแสดงผล"

สิทธิ์จอแสดงผล = ถาม-ตอบไม่จำกัด · รับประกาศ/คำสั่งพูดแบบสด (WebSocket kiosk) · ทักทาย/กล้องจำป้าย/ภาพที่ไม่รู้จัก
ไม่ได้: สั่งท่า/การเคลื่อนไหวของหุ่นยนต์จริง (ยังเป็นของเครื่องใน VORA_KIOSK_TRUSTED_HOSTS เท่านั้น) · เปลี่ยนสถานะหน้าจอหลักในหลังบ้าน
เก็บเฉพาะ sha256 ของกุญแจ · สวิตช์ VORA_LAN_SCREENS=0 = ปิด (กลับเป็นแบบมือถือทั้งหมด)
"""
from __future__ import annotations

import hashlib
import os
import re
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import DATA_DIR, settings
from ..db import SessionLocal, get_db
from ..models import KioskScreen, User
from ..security import require
from ..services import audit

router = APIRouter(tags=["screens"])
KEY_RE = re.compile(r"^[a-f0-9]{32,64}$")
MAX_PENDING = 50
TTL = 10.0                                            # วินาที — แคชผลตรวจกุญแจ (ไม่ถามฐานข้อมูลทุกคำขอ)
_cache: dict[str, tuple[float, Optional[int]]] = {}
CERT_DIR = DATA_DIR / "certs"


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode("ascii")).hexdigest()


def code_of(key_hash: str) -> str:
    return key_hash[:4].upper()


def _host(conn) -> str:
    return conn.client.host if conn.client else ""


def key_from(conn) -> str:
    try:
        return (conn.headers.get("x-vora-screen") or conn.query_params.get("screen") or "").strip().lower()
    except Exception:  # noqa: BLE001
        return ""


def forget() -> None:
    _cache.clear()


def approved_screen(conn) -> Optional[int]:
    """รหัสจอที่อนุมัติแล้วของคำขอนี้ (Request หรือ WebSocket) หรือ None"""
    if not settings.lan_screens:
        return None
    key = key_from(conn)
    if not KEY_RE.match(key):
        return None
    h, now = _hash(key), time.time()
    hit = _cache.get(h)
    if hit and hit[0] > now:
        return hit[1]
    sid: Optional[int] = None
    try:
        with SessionLocal() as db:
            s = db.query(KioskScreen).filter(KioskScreen.key_hash == h).first()
            if s:
                sid = s.id if s.status == "approved" else None
                s.last_seen, s.last_ip = datetime.now(), _host(conn)[:64]
                db.commit()
    except Exception:  # noqa: BLE001 - ตารางยังไม่พร้อม ฯลฯ → ไม่ให้สิทธิ์
        sid = None
    _cache[h] = (now + TTL, sid)
    return sid


def https_status() -> dict:
    crt, key = CERT_DIR / "vora-lan.crt", CERT_DIR / "vora-lan.key"
    return {"cert": crt.exists() and key.exists(), "active": os.environ.get("VORA_HTTPS_ACTIVE") == "1",
            "port": settings.https_port}


# ---------------------------------------------------------------------------------------------- หน้าจอ
class HelloIn(BaseModel):
    key: str = Field(min_length=32, max_length=64)
    name: str = Field(default="", max_length=64)


@router.post("/api/screens/hello")
def hello(body: HelloIn, request: Request, db: Session = Depends(get_db)):
    from .public import rate_limit
    if _host(request) in settings.kiosk_trusted_hosts:
        return {"status": "robot"}                    # เครื่องหลัก (บนตัวหุ่นยนต์) ไม่ต้องลงทะเบียน
    if not settings.lan_screens:
        return {"status": "off"}
    rate_limit(request, limit=10, window=60)
    key = body.key.strip().lower()
    if not KEY_RE.match(key):
        raise HTTPException(400, "รูปแบบกุญแจไม่ถูกต้อง")
    h = _hash(key)
    s = db.query(KioskScreen).filter(KioskScreen.key_hash == h).first()
    if not s:
        if db.query(KioskScreen).filter(KioskScreen.status == "pending").count() >= MAX_PENDING:
            raise HTTPException(429, "มีจอรออนุมัติมากเกินไป กรุณาให้ผู้ดูแลตรวจในหลังบ้านก่อน")
        name = re.sub(r"[\x00-\x1f<>]", "", body.name).strip()[:64] or f"จอ {code_of(h)}"
        s = KioskScreen(key_hash=h, code=code_of(h), name=name, status="pending")
        db.add(s)
    s.last_seen, s.last_ip = datetime.now(), _host(request)[:64]
    db.commit()
    _cache.pop(h, None)
    return {"status": s.status, "code": s.code, "name": s.name}


# ---------------------------------------------------------------------------------------------- หลังบ้าน
class ScreenIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=64)
    status: Optional[str] = None                      # approved | revoked | pending


def _row(s: KioskScreen) -> dict:
    return {"id": s.id, "code": s.code, "name": s.name, "status": s.status, "last_ip": s.last_ip, "last_seen": s.last_seen,
            "created_at": s.created_at, "approved_by": s.approved_by}


@router.get("/api/admin/screens")
def list_screens(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    from .public import _lan_ip
    rows = db.query(KioskScreen).order_by(KioskScreen.status.desc(), KioskScreen.id.desc()).all()
    return {"enabled": settings.lan_screens, "lan_ip": _lan_ip(), "http_port": settings.port, "https": https_status(),
            "screens": [_row(s) for s in rows]}


@router.put("/api/admin/screens/{sid}")
def update_screen(sid: int, body: ScreenIn, db: Session = Depends(get_db), user: User = Depends(require("admin"))):
    s = db.get(KioskScreen, sid)
    if not s:
        raise HTTPException(404, "ไม่พบจอนี้")
    if body.status is not None:
        if body.status not in ("approved", "revoked", "pending"):
            raise HTTPException(400, "สถานะไม่ถูกต้อง")
        s.status = body.status
        s.approved_by = user.username if body.status == "approved" else s.approved_by
    if body.name is not None:
        name = re.sub(r"[\x00-\x1f<>]", "", body.name).strip()[:64]
        if name:
            s.name = name
    audit(db, user.username, "update", "kiosk_screen", sid, status=s.status, name=s.name)
    db.commit()
    forget()
    return _row(s)


@router.delete("/api/admin/screens/{sid}")
def delete_screen(sid: int, db: Session = Depends(get_db), user: User = Depends(require("admin"))):
    s = db.get(KioskScreen, sid)
    if not s:
        raise HTTPException(404, "ไม่พบจอนี้")
    audit(db, user.username, "delete", "kiosk_screen", sid, name=s.name)
    db.delete(s)
    db.commit()
    forget()
    return {"ok": True}


# ---------------------------------------------------------------------------------------------- 25 พ.ย. 2569: ที่อยู่คิวอาร์มือถือ
class MobileBaseIn(BaseModel):
    base: str = Field(default="", max_length=200)    # "" = อัตโนมัติ · https://192.168.1.20:8443 · http://vora.local:8000


@router.get("/api/admin/mobile-qr")
def mobile_qr(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    from .. import netaddr
    from .public import MOBILE_BASE_KEY, mobile_base
    from ..services import get_setting
    hs = https_status()
    cands = []
    for c in netaddr.candidates():
        urls = [f"http://{c['ip']}:{settings.port}"] + ([f"https://{c['ip']}:{hs['port']}"] if hs["active"] else [])
        cands.append({**c, "urls": urls})
    mb = mobile_base(db)
    return {"current": {**mb, "url": f"{mb['base']}/m/"}, "pinned": get_setting(db, MOBILE_BASE_KEY) or "",
            "env": bool(settings.public_url), "https": hs, "candidates": cands}


@router.put("/api/admin/mobile-qr")
def set_mobile_qr(body: MobileBaseIn, db: Session = Depends(get_db), user: User = Depends(require("admin"))):
    from .public import MOBILE_BASE_KEY, mobile_base
    from ..services import set_setting
    base = body.base.strip().rstrip("/")
    if base and not re.fullmatch(r"https?://[A-Za-z0-9.\-]+(:\d{1,5})?", base):
        raise HTTPException(400, "ใส่เฉพาะ http(s)://ที่อยู่:พอร์ต เช่น https://192.168.1.20:8443 (ไม่ต้องมี /m/)")
    set_setting(db, MOBILE_BASE_KEY, base)
    audit(db, user.username, "update", "mobile_qr", "", base=base or "auto")
    db.commit()
    mb = mobile_base(db)
    return {"current": {**mb, "url": f"{mb['base']}/m/"}}
