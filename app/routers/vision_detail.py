"""24 พ.ย. 2569: กล้องจำป้าย — รายละเอียดตามประเภท + ภาพที่ยังไม่รู้จัก

หลังบ้าน (/api/admin/vision/...):
  GET  kinds                    โครงสร้างประเภทและช่อง (ฟอร์มเลือกประเภทก่อนกรอก)
  GET  items/{class_id}         รายละเอียดของป้ายนั้น · PUT บันทึก · DELETE ลบรายละเอียด (กลับไปตอบแบบเดิม)
  GET  unknown                  ภาพที่ผู้ใช้ถาม "นี่คืออะไร" แต่กล้องยังไม่รู้จัก
  POST unknown/{id}/teach       เพิ่มภาพนั้นเป็นตัวอย่างของป้าย (แล้วกดฝึกโมเดลจำภาพใหม่) · POST unknown/{id}/ignore · DELETE unknown/{id}
หน้าจอหุ่น:
  POST /api/vision/unknown      บันทึกภาพย่อ + เวกเตอร์ (เก็บในเครื่องเท่านั้น) แล้วตอบว่ายังไม่รู้จัก
สวิตช์: VORA_VISION_DETAIL (รายละเอียด/ป๊อปอัป/ถามต่อ) · VORA_VISION_UNKNOWN (บันทึกภาพที่ไม่รู้จัก)
"""
from __future__ import annotations

import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..ai import vision_items
from ..config import settings
from ..db import get_db
from ..models import News, UnknownSight, User, VisionClass, VisionItem, VisionSample
from ..security import require
from ..services import audit
from .admin import to_dict

router = APIRouter(tags=["vision-detail"])
MAX_UNKNOWN = 300                                    # เก็บล่าสุดไม่เกินเท่านี้ (เก่ากว่าลบอัตโนมัติ)
MAX_THUMB = 60_000                                   # data URL ภาพย่อ ~ 45 KB


def _need_detail() -> None:
    if not settings.vision_detail:
        raise HTTPException(404, "รายละเอียดป้ายปิดอยู่ (VORA_VISION_DETAIL=0)")


def _class(db: Session, cid: int) -> VisionClass:
    vc = db.get(VisionClass, cid)
    if not vc:
        raise HTTPException(404, "ไม่พบป้ายนี้")
    return vc


@router.get("/api/admin/vision/kinds")
def kinds(_: User = Depends(require("viewer"))):
    return {"enabled": settings.vision_detail, "unknown_enabled": settings.vision_unknown, "kinds": vision_items.schema()}


@router.get("/api/admin/vision/items")
def list_items(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    _need_detail()
    return [to_dict(i) for i in db.query(VisionItem).all()]


@router.get("/api/admin/vision/items/{cid}")
def get_item(cid: int, db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    _need_detail()
    _class(db, cid)
    it = db.query(VisionItem).filter(VisionItem.vision_class_id == cid).first()
    return to_dict(it) if it else None


class ItemIn(BaseModel):
    kind: str
    details: dict[str, Any] = Field(default_factory=dict)
    images: list[str] = Field(default_factory=list)
    news_id: Optional[int] = None


@router.put("/api/admin/vision/items/{cid}")
def save_item(cid: int, body: ItemIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    _need_detail()
    vc = _class(db, cid)
    if body.kind not in vision_items.KIND_KEYS:
        raise HTTPException(400, "ประเภทไม่ถูกต้อง")
    details = vision_items.clean_details(body.kind, body.details)
    imgs = [u.strip() for u in body.images if isinstance(u, str) and re.match(r"^(/uploads/|https?://)", u.strip())][:vision_items.MAX_IMAGES]
    news_id = body.news_id if body.kind in ("poster", "event") else None
    if news_id and not db.get(News, news_id):
        raise HTTPException(400, "ไม่พบข่าวที่เลือก")
    title_key = vision_items.KINDS[body.kind]["title"]
    if not details.get(title_key) and not news_id:
        raise HTTPException(400, "กรอกชื่อ/หัวข้ออย่างน้อย 1 ช่อง (หรือผูกกับข่าว)")
    it = db.query(VisionItem).filter(VisionItem.vision_class_id == cid).first()
    created = it is None
    if created:
        it = VisionItem(vision_class_id=cid)
        db.add(it)
    it.kind, it.details, it.images, it.news_id = body.kind, details, imgs, news_id
    db.flush()
    audit(db, user.username, "create" if created else "update", "vision_item", it.id, label=vc.label, kind=body.kind,
          fields=sorted(details), images=len(imgs), news_id=news_id)
    db.commit()
    return to_dict(it)


@router.delete("/api/admin/vision/items/{cid}")
def delete_item(cid: int, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    _need_detail()
    vc = _class(db, cid)
    it = db.query(VisionItem).filter(VisionItem.vision_class_id == cid).first()
    if it:
        audit(db, user.username, "delete", "vision_item", it.id, label=vc.label)
        db.delete(it)
        db.commit()
    return {"ok": True}


@router.get("/api/admin/vision/preview/{cid}")
def preview(cid: int, lang: str = "th", db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    """ดูตัวอย่างว่าหุ่นยนต์จะพูดอะไรและป๊อปอัปจะแสดงอะไร"""
    _need_detail()
    from ..ai.engine import vision_view
    v = vision_view(db, vc=_class(db, cid), lang=lang)
    if not v:
        return None
    return {"view": v, "speech": vision_items.summary(v, lang, settings.max_answer_chars)}


# ---------------------------------------------------------------- ภาพที่ยังไม่รู้จัก
@router.get("/api/admin/vision/unknown")
def list_unknown(status: str = "new", db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    q = db.query(UnknownSight)
    if status:
        q = q.filter(UnknownSight.status == status)
    return [{k: v for k, v in to_dict(u).items() if k != "embedding"} | {"has_vector": bool(u.embedding)}
            for u in q.order_by(UnknownSight.id.desc()).limit(100).all()]


class TeachIn(BaseModel):
    label: str


@router.post("/api/admin/vision/unknown/{uid}/teach")
def teach_unknown(uid: int, body: TeachIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    u = db.get(UnknownSight, uid)
    if not u:
        raise HTTPException(404, "ไม่พบภาพ")
    if not db.query(VisionClass).filter(VisionClass.label == body.label).first():
        raise HTTPException(400, "ไม่พบป้ายนี้ — เพิ่มป้ายก่อน")
    if not u.embedding:
        raise HTTPException(400, "ภาพนี้ไม่มีเวกเตอร์ (กล้องยังไม่โหลดโมเดลตอนบันทึก) — ใช้ภาพนี้เป็นแนวทางแล้วเก็บภาพใหม่ที่หน้าสอนกล้อง")
    db.add(VisionSample(label=body.label, embedding=u.embedding, thumbnail=u.thumbnail))
    u.status, u.taught_label = "taught", body.label
    audit(db, user.username, "teach_unknown", "vision", uid, label=body.label)
    db.commit()
    return {"ok": True, "hint": "เพิ่มเป็นตัวอย่างแล้ว — กด 'ฝึกโมเดลจำภาพใหม่' เพื่อใช้งาน"}


@router.post("/api/admin/vision/unknown/{uid}/ignore")
def ignore_unknown(uid: int, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    u = db.get(UnknownSight, uid)
    if not u:
        raise HTTPException(404, "ไม่พบภาพ")
    u.status = "ignored"
    audit(db, user.username, "ignore_unknown", "vision", uid)
    db.commit()
    return {"ok": True}


@router.delete("/api/admin/vision/unknown/{uid}")
def delete_unknown(uid: int, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    u = db.get(UnknownSight, uid)
    if u:
        audit(db, user.username, "delete_unknown", "vision", uid)
        db.delete(u)
        db.commit()
    return {"ok": True}


class UnknownIn(BaseModel):
    thumbnail: str = ""
    embedding: list[float] = Field(default_factory=list)
    question: str = ""
    best_label: str = ""
    best_prob: float = 0.0
    lang: str = "th"


@router.post("/api/vision/unknown")
def report_unknown(body: UnknownIn, request: Request, db: Session = Depends(get_db)):
    lang = "en" if body.lang == "en" else "th"
    reply = ("I don't recognise this yet. I've saved a picture so the staff can teach me." if lang == "en"
             else "หนูยังไม่รู้จักสิ่งนี้ค่ะ บันทึกภาพไว้ให้เจ้าหน้าที่สอนหนูเพิ่มแล้วนะคะ")
    if not settings.vision_unknown:
        return {"text": ("I don't recognise this yet." if lang == "en" else "หนูยังไม่รู้จักสิ่งนี้ค่ะ"), "saved": False, "lang": lang}
    from .public import is_display_kiosk, rate_limit
    if not is_display_kiosk(request, "kiosk"):          # 25 พ.ย. 2569: + จอในวง LAN ที่อนุมัติแล้ว
        rate_limit(request)
    thumb = body.thumbnail if body.thumbnail.startswith("data:image/") and len(body.thumbnail) <= MAX_THUMB else ""
    vec = [float(x) for x in body.embedding[:2048]]
    db.add(UnknownSight(question=body.question[:200], thumbnail=thumb, embedding=vec,
                        best_label=body.best_label[:64], best_prob=max(0.0, min(1.0, body.best_prob))))
    db.flush()
    old = db.query(UnknownSight.id).order_by(UnknownSight.id.desc()).offset(MAX_UNKNOWN).all()
    if old:
        db.query(UnknownSight).filter(UnknownSight.id.in_([o for (o,) in old])).delete(synchronize_session=False)
    db.commit()
    return {"text": reply, "saved": True, "lang": lang}
