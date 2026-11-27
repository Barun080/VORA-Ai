"""24 พ.ย. 2569: กล่องตรวจข้อมูล (Sandbox) — ข้อมูลไม่แน่นอน/ข้อมูลเก่า รอเจ้าหน้าที่ตรวจก่อนใช้ตอบ

ลำดับ: สคริปต์ scripts/import_sandbox.py ใส่รายการ (pending) → เจ้าหน้าที่ดูแหล่งอ้างอิง/เหตุผล/ตัวเลือก
→ "อนุมัตินำเข้า" (แก้ข้อความหรือเลือกตัวเลือกก่อนได้) = สร้างความรู้สถานะอนุมัติในฐานความรู้ AI ทันที
→ "ปฏิเสธ" = ไม่ใช้ · "ย้อนกลับ" = ความรู้ที่สร้างไว้เปลี่ยนเป็นฉบับร่าง และรายการกลับมารอตรวจ
ปิดทั้งหมดด้วย VORA_SANDBOX=0 (ตารางข้อมูลยังอยู่ ไม่กระทบฐานความรู้ที่อนุมัติไปแล้ว)
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..ai.retriever import retriever
from ..config import settings
from ..db import get_db
from ..models import KnowledgeCandidate, KnowledgeItem, User
from ..security import require
from ..services import audit
from .admin import to_dict

router = APIRouter(prefix="/api/admin/sandbox", tags=["sandbox"])
CATEGORIES = {"general", "program", "admission", "tuition", "scholarship", "career", "news", "activity", "location", "contact", "robot"}


def _enabled() -> None:
    if not settings.sandbox:
        raise HTTPException(404, "กล่องตรวจข้อมูลปิดอยู่ (VORA_SANDBOX=0)")


def _get(db: Session, cid: int) -> KnowledgeCandidate:
    c = db.get(KnowledgeCandidate, cid)
    if not c:
        raise HTTPException(404, "ไม่พบรายการ")
    return c


@router.get("/status")
def sandbox_status(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    if not settings.sandbox:
        return {"enabled": False, "pending": 0}
    n = db.query(func.count(KnowledgeCandidate.id)).filter(KnowledgeCandidate.status == "pending").scalar()
    return {"enabled": True, "pending": n}


@router.get("")
def list_candidates(status: Optional[str] = "pending", batch: Optional[str] = None, db: Session = Depends(get_db),
                    _: User = Depends(require("viewer"))):
    _enabled()
    q = db.query(KnowledgeCandidate)
    if status:
        q = q.filter(KnowledgeCandidate.status == status)
    if batch:
        q = q.filter(KnowledgeCandidate.batch == batch)
    rows = [to_dict(c) for c in q.order_by(KnowledgeCandidate.id).all()]
    counts = dict(db.query(KnowledgeCandidate.status, func.count()).group_by(KnowledgeCandidate.status).all())
    return {"items": rows, "counts": counts}


class ApproveIn(BaseModel):
    question: Optional[str] = None
    alt_questions: Optional[str] = None
    answer_th: Optional[str] = None
    answer_en: Optional[str] = None
    category: Optional[str] = None
    choice: Optional[int] = None          # ลำดับตัวเลือกใน choices (ใช้เมื่อไม่ได้แก้คำตอบเอง)
    note: str = ""


@router.post("/{cid}/approve")
def approve_candidate(cid: int, body: ApproveIn, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    _enabled()
    c = _get(db, cid)
    if c.status == "approved":
        raise HTTPException(409, "รายการนี้อนุมัติไปแล้ว")
    answer = (body.answer_th or "").strip()
    if not answer and body.choice is not None:
        opts = c.choices or []
        if not 0 <= body.choice < len(opts):
            raise HTTPException(400, "ไม่มีตัวเลือกนี้")
        answer = str(opts[body.choice].get("answer_th", "")).strip()
    answer = answer or c.answer_th.strip()
    question = (body.question or c.question).strip()
    if not question or not answer:
        raise HTTPException(400, "ต้องมีคำถามและคำตอบก่อนอนุมัติ")
    category = body.category or c.category
    if category not in CATEGORIES:
        category = "general"
    k = KnowledgeItem(kind="faq", category=category, question=question,
                      alt_questions=(body.alt_questions if body.alt_questions is not None else c.alt_questions),
                      answer_th=answer, answer_en=(body.answer_en if body.answer_en is not None else c.answer_en),
                      source="sandbox", status="approved", created_by=f"sandbox:{c.batch}"[:64], approved_by=user.username)
    db.add(k)
    db.flush()
    c.status, c.knowledge_id = "approved", k.id
    c.reviewed_by, c.reviewed_at, c.review_note = user.username, datetime.now(), body.note[:2000]
    edited = answer != c.answer_th.strip() or question != c.question.strip()
    audit(db, user.username, "approve", "sandbox", c.id, knowledge_id=k.id, question=question[:200], edited=edited,
          choice=body.choice, sources=[s.get("url", "") for s in (c.sources or [])][:5])
    db.commit()
    retriever.mark_dirty()
    return {"ok": True, "knowledge_id": k.id}


class NoteIn(BaseModel):
    note: str = ""


@router.post("/{cid}/reject")
def reject_candidate(cid: int, body: NoteIn, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    _enabled()
    c = _get(db, cid)
    if c.status == "approved":
        raise HTTPException(409, "รายการนี้อนุมัติไปแล้ว — กด 'ย้อนกลับ' ก่อน")
    c.status, c.reviewed_by, c.reviewed_at, c.review_note = "rejected", user.username, datetime.now(), body.note[:2000]
    audit(db, user.username, "reject", "sandbox", c.id, question=c.question[:200], note=body.note[:200])
    db.commit()
    return {"ok": True}


@router.post("/{cid}/reopen")
def reopen_candidate(cid: int, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    """ย้อนกลับ: ความรู้ที่สร้างจากรายการนี้ → ฉบับร่าง (ไม่ใช้ตอบ) และรายการกลับไปรอตรวจ"""
    _enabled()
    c = _get(db, cid)
    detail: dict[str, Any] = {"from": c.status}
    if c.knowledge_id:
        k = db.get(KnowledgeItem, c.knowledge_id)
        if k and k.status == "approved":
            k.status = "draft"
            k.version += 1
            detail["knowledge_id"] = k.id
    c.status, c.knowledge_id, c.reviewed_by, c.reviewed_at = "pending", None, "", None
    audit(db, user.username, "reopen", "sandbox", c.id, **detail)
    db.commit()
    retriever.mark_dirty()
    return {"ok": True}
