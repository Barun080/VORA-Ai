"""API งาน F "สาธิตไม่สะดุด" (21 พ.ย. 2569) — สถานะเน็ต/โหมดฐานความรู้ · คำถามยอดฮิต · เตรียมเสียงล่วงหน้า

สาธารณะ (หน้าจอหุ่น/มือถือ)
  GET  /api/net                      สถานะ: online/mode (ai | kb) · ไม่มีข้อมูลลับ
  GET  /api/quick-questions?lang=th  คำถามที่ตอบได้จากฐานความรู้ (แสดงเป็นปุ่มแตะตอนเน็ตล่ม)
หลังบ้าน
  GET  /api/admin/offline/status     สถานะ + จำนวนไฟล์เสียงที่เตรียมไว้          (viewer)
  POST /api/admin/offline/force      เปิด/ปิด "จำลองเน็ตล่ม" สำหรับซ้อม/สาธิต      (admin · บันทึก audit)
  GET  /api/admin/offline/phrases    ข้อความที่ VORA จะพูดตอนเน็ตล่ม               (editor)
  POST /api/admin/offline/check      ข้อความใดมีเสียงเตรียมไว้แล้ว                  (editor)
  POST /api/admin/offline/pin        เตรียมเสียงหนึ่งข้อความ (ต้องมีอินเทอร์เน็ต)       (editor)
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import connectivity, offline, tts
from ..db import get_db
from ..models import User
from ..security import require
from ..services import all_settings, audit, set_setting

router = APIRouter(prefix="/api", tags=["offline"])

MAX_CHECK = 600


class ForceIn(BaseModel):
    on: bool


class PhraseIn(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    lang: str = "th"
    kind: str = ""
    label: str = ""


class CheckIn(BaseModel):
    items: list[PhraseIn] = Field(default_factory=list, max_length=MAX_CHECK)


def _lang(v: Optional[str]) -> str:
    return "en" if v == "en" else "th"


@router.get("/net")
def net_status():
    return connectivity.status()


@router.get("/quick-questions")
def quick(lang: str = "th", db: Session = Depends(get_db)):
    return {"lang": _lang(lang), "questions": offline.quick_questions(db, _lang(lang), n=6)}


@router.get("/admin/offline/status")
def admin_status(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    order = tts.voice_profiles.provider_order()
    return {**connectivity.status(), "pinned": tts.pinned_stats(), "tts_provider": order[0] if order else "",
            "tts_available": tts.available(), "force_setting": bool(all_settings(db).get("offline_force"))}


@router.post("/admin/offline/force")
def admin_force(body: ForceIn, db: Session = Depends(get_db), user: User = Depends(require("admin"))):
    connectivity.set_forced(body.on)
    set_setting(db, "offline_force", bool(body.on))
    audit(db, user.username, "offline_force", "system", "", on=bool(body.on))
    db.commit()
    return connectivity.status()


@router.get("/admin/offline/phrases")
async def admin_phrases(_: User = Depends(require("editor"))):
    items = await offline.build_phrases()
    return {"items": items, "count": len(items)}


@router.post("/admin/offline/check")
def admin_check(body: CheckIn, _: User = Depends(require("editor"))):
    if not tts.available():
        return {"tts_available": False, "pinned": [False] * len(body.items)}
    return {"tts_available": True, "pinned": [tts.is_pinned(i.text, _lang(i.lang)) for i in body.items]}


@router.post("/admin/offline/pin")
async def admin_pin(body: PhraseIn, _: User = Depends(require("editor"))):
    if not tts.available():
        raise HTTPException(409, "ยังไม่ได้เปิดเสียงพูดฝั่งเซิร์ฟเวอร์ (VORA_TTS_PROVIDER)")
    res = await tts.pin(body.text, _lang(body.lang), {"kind": body.kind[:24], "label": body.label[:80]})
    if not res.get("ok") and res.get("error") == "offline":
        raise HTTPException(409, "ตอนนี้ไม่มีอินเทอร์เน็ต (หรือเปิดจำลองเน็ตล่มอยู่) — ต้องออนไลน์จึงเตรียมเสียงได้")
    return res
