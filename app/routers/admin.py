"""API หลังบ้านสำหรับเจ้าหน้าที่: จัดการเนื้อหา ฐานความรู้ โมเดล AI ตารางประชาสัมพันธ์ ผู้ใช้ และระบบ"""
from __future__ import annotations

import csv
import io
import shutil
import time
import uuid
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, field_validator
from sqlalchemy import func, inspect
from sqlalchemy.orm import Session

from ..ai.engine import answer
from ..ai.intent import intent_classifier
from ..ai.llm import LLMError, llm
from ..ai.retriever import retriever
from ..ai.training import activate_intent_version, retrain_intent, retrain_vision, run_evaluation
from ..config import DATA_DIR, settings
from ..db import db_info, get_db
from ..models import (AuditLog, ChatSession, EvalCase, EvalRun, Feedback, IntentExample, KnowledgeItem, Message, ModelVersion, News,
                      Program, Schedule, SystemEvent, UnansweredQuestion, User, VisionClass, VisionSample)
from ..realtime import hub
from ..robot.bridge import bridge
from ..scheduler import scheduler
from ..security import ROLE_LEVEL, hash_password, require
from ..services import DEFAULT_SETTINGS, all_settings, audit, set_setting
from .public import STARTED_AT

router = APIRouter(prefix="/api/admin", tags=["admin"])
UPLOAD_DIR = DATA_DIR / "uploads"


def to_dict(obj: Any, exclude: tuple[str, ...] = ()) -> dict[str, Any]:
    return {c.key: getattr(obj, c.key) for c in inspect(obj).mapper.column_attrs if c.key not in exclude}


def _get(db: Session, model, oid: Any):
    obj = db.get(model, oid)
    if not obj:
        raise HTTPException(404, "ไม่พบข้อมูล")
    return obj


def _apply(obj: Any, data: dict[str, Any], allowed: set[str]) -> dict[str, Any]:
    changed = {}
    for k, v in data.items():
        if k in allowed and getattr(obj, k) != v:
            changed[k] = {"from": str(getattr(obj, k))[:200], "to": str(v)[:200]}
            setattr(obj, k, v)
    return changed


def _can_publish(user: User) -> bool:
    return ROLE_LEVEL[user.role] >= ROLE_LEVEL["admin"]


# ======================================================================== ภาพรวมระบบ
@router.get("/system")
def system_status(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    import time

    intent_mv = db.query(ModelVersion).filter(ModelVersion.kind == "intent", ModelVersion.active.is_(True)).first()
    vision_mv = db.query(ModelVersion).filter(ModelVersion.kind == "vision", ModelVersion.active.is_(True)).first()
    usage = shutil.disk_usage(DATA_DIR)
    errors_24h = db.query(func.count(SystemEvent.id)).filter(
        SystemEvent.level == "error", SystemEvent.created_at >= datetime.fromtimestamp(time.time() - 86400)).scalar()
    from .. import tts
    return {
        "uptime_s": int(time.time() - STARTED_AT), "school_code": settings.school_code,
        "ai": {"llm": llm.status(), "retriever": retriever.stats(),
               "intent_model": {"version": intent_classifier.version, "ready": intent_classifier.ready,
                                "accuracy": intent_mv.metrics.get("accuracy") if intent_mv else None,
                                "n_samples": intent_mv.n_samples if intent_mv else 0},
               "vision_model": {"version": vision_mv.version if vision_mv else 0,
                                "accuracy": vision_mv.metrics.get("accuracy") if vision_mv else None,
                                "n_samples": vision_mv.n_samples if vision_mv else 0}},
        "speech": {"stt": "browser (Web Speech API)", "tts": "edge-tts" if tts.available() else "browser"},
        "robot": {k: v for k, v in bridge.public_status().items() if k != "world"},
        "scheduler": scheduler.status(),
        "clients": {"kiosk": hub.count("kiosk"), "admin": hub.count("admin"), "mobile": hub.count("mobile")},
        "kiosk_state": hub.kiosk_state, "errors_24h": errors_24h, "database": db_info(),
        "disk": {"free_gb": round(usage.free / 1e9, 1), "total_gb": round(usage.total / 1e9, 1)},
    }


# ======================================================================== ผู้ใช้
class UserIn(BaseModel):
    username: str
    display_name: str = ""
    role: str = "editor"
    password: Optional[str] = None
    active: bool = True


@router.get("/users")
def list_users(db: Session = Depends(get_db), _: User = Depends(require("admin"))):
    return [to_dict(u, ("password_hash",)) for u in db.query(User).order_by(User.id).all()]


@router.post("/users")
def create_user(body: UserIn, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    if body.role not in ROLE_LEVEL:
        raise HTTPException(400, "บทบาทไม่ถูกต้อง")
    if not body.password or len(body.password) < 8:
        raise HTTPException(400, "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(400, "ชื่อผู้ใช้นี้มีอยู่แล้ว")
    u = User(username=body.username.strip(), display_name=body.display_name, role=body.role,
             password_hash=hash_password(body.password), active=body.active)
    db.add(u)
    db.flush()
    audit(db, user.username, "create", "user", u.id, role=body.role)
    db.commit()
    return {"id": u.id}


@router.put("/users/{uid}")
def update_user(uid: int, body: UserIn, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    u = _get(db, User, uid)
    if body.role not in ROLE_LEVEL:
        raise HTTPException(400, "บทบาทไม่ถูกต้อง")
    if u.id == user.id and (body.role != "admin" or not body.active):
        raise HTTPException(400, "ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตนเองได้")
    changed = _apply(u, body.model_dump(exclude={"password", "username"}), {"display_name", "role", "active"})
    if body.password:
        if len(body.password) < 8:
            raise HTTPException(400, "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร")
        u.password_hash = hash_password(body.password)
        changed["password"] = "reset"
    audit(db, user.username, "update", "user", uid, **changed)
    db.commit()
    return {"ok": True}


# ======================================================================== ข่าว/กิจกรรม
class NewsIn(BaseModel):
    kind: str = "news"
    title_th: str
    title_en: str = ""
    body_th: str = ""
    body_en: str = ""
    image_url: str = ""
    video_url: str = ""
    priority: int = 3
    status: str = "draft"
    publish_at: Optional[datetime] = None
    expire_at: Optional[datetime] = None
    event_date: Optional[datetime] = None
    # สถานที่ (Phase 5) — ไม่ส่งมา = ไม่แก้ค่าเดิม (รองรับหน้าหลังบ้าน/สคริปต์รุ่นเก่า)
    location: Optional[str] = None
    location_type: Optional[str] = None          # campus | external | online | ว่าง = ไม่ระบุ
    location_map_url: Optional[str] = None
    gallery: Optional[str] = None                # 12 พ.ย. 2569: ภาพเพิ่มเติม บรรทัดละ 1 URL · ไม่ส่งมา = ไม่แก้ค่าเดิม

    @field_validator("publish_at", "expire_at", "event_date")
    @classmethod
    def _ce_year(cls, v):                        # 27 พ.ย. 2569: ปี พ.ศ. → ค.ศ. · 0001-01-01 → ว่าง (กันข่าวหายจากหน้าจอ)
        if v is None:
            return None
        if v.year >= 2400:
            return v.replace(year=v.year - 543)
        if v.year < 1900:
            return None
        return v


LOCATION_FIELDS = ("location", "location_type", "location_map_url")
LOCATION_TYPES = ("campus", "external", "online")
NEWS_FIELDS = set(NewsIn.model_fields) - set(LOCATION_FIELDS) - {"gallery"}


def _gallery(v: Optional[str]) -> Optional[str]:
    """ทำความสะอาดรายการภาพ: บรรทัดละ 1 ลิงก์ (/uploads/... หรือ https://) ตัดซ้ำ สูงสุด 20 ภาพ"""
    if v is None:
        return None
    out: list[str] = []
    for x in str(v).replace(",", "\n").splitlines():
        x = x.strip()
        if x and (x.startswith("/") or x.startswith("https://") or x.startswith("http://")) and x not in out:
            out.append(x)
    return "\n".join(out[:20])


def _clean(v: Optional[str]) -> Optional[str]:
    v = (v or "").strip()
    return v or None


def _location_values(body: NewsIn, current: Optional[News] = None) -> dict[str, Optional[str]]:
    """รวมค่าที่ส่งมากับค่าเดิม แล้วตรวจตามกติกาประเภทสถานที่ (ไม่อนุมาน/ไม่เติมค่าให้เอง)"""
    sent = body.model_fields_set
    vals = {f: _clean(getattr(body, f)) if f in sent else (getattr(current, f) if current else None)
            for f in LOCATION_FIELDS}
    t, name, url = vals["location_type"], vals["location"], vals["location_map_url"]
    if t is not None and t not in LOCATION_TYPES:
        raise HTTPException(400, "ประเภทสถานที่ไม่ถูกต้อง (ภายในวิทยาลัย / ภายนอกวิทยาลัย / ออนไลน์)")
    if t is None and (name or url):
        raise HTTPException(400, "กรุณาเลือกประเภทสถานที่ (ภายในวิทยาลัย / ภายนอกวิทยาลัย / ออนไลน์)")
    if t in ("campus", "external") and not name:
        raise HTTPException(400, "กรุณากรอกชื่อสถานที่")
    if t == "online" and url:
        raise HTTPException(400, "กิจกรรมออนไลน์ไม่ใช้ลิงก์แผนที่")
    if name and len(name) > 255:
        raise HTTPException(400, "ชื่อสถานที่ยาวเกิน 255 ตัวอักษร")
    if url and (not url.lower().startswith("https://") or len(url) > 500 or any(c.isspace() for c in url)):
        raise HTTPException(400, "ลิงก์แผนที่ต้องขึ้นต้นด้วย https:// และยาวไม่เกิน 500 ตัวอักษร")
    return vals


def _check_status(status: str, user: User, allowed: tuple[str, ...]) -> None:
    if status not in allowed:
        raise HTTPException(400, "สถานะไม่ถูกต้อง")
    if status in ("published", "approved") and not _can_publish(user):
        raise HTTPException(403, "ต้องเป็นผู้ดูแล (admin) จึงจะอนุมัติเผยแพร่ได้ — ส่งเป็น 'รออนุมัติ' แทน")


@router.get("/news")
def list_news(status: Optional[str] = None, db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    q = db.query(News)
    if status:
        q = q.filter(News.status == status)
    return [to_dict(n) for n in q.order_by(News.priority.desc(), News.id.desc()).all()]


@router.post("/news")
def create_news(body: NewsIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    _check_status(body.status, user, ("draft", "pending", "published", "archived"))
    n = News(**body.model_dump(include=NEWS_FIELDS), **_location_values(body), created_by=user.username, gallery=_gallery(body.gallery) or "")
    if body.status == "published":
        n.approved_by = user.username
    db.add(n)
    db.flush()
    audit(db, user.username, "create", "news", n.id, title=n.title_th, status=n.status)
    db.commit()
    retriever.mark_dirty()
    return {"id": n.id}


@router.put("/news/{nid}")
def update_news(nid: int, body: NewsIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    n = _get(db, News, nid)
    if body.status != n.status:
        _check_status(body.status, user, ("draft", "pending", "published", "archived"))
    elif n.status == "published" and not _can_publish(user):
        body.status = "pending"         # editor แก้ข่าวที่เผยแพร่แล้ว -> กลับไปรออนุมัติ
    loc = _location_values(body, n)                  # ตรวจก่อนแก้ไขฟิลด์ใด ๆ
    changed = _apply(n, body.model_dump(include=NEWS_FIELDS), NEWS_FIELDS)
    changed.update(_apply(n, loc, set(LOCATION_FIELDS)))
    g = _gallery(body.gallery)
    if g is not None and g != (n.gallery or ""):
        n.gallery = g
        changed["gallery"] = f"{len(g.splitlines()) if g else 0} ภาพ"
    if body.status == "published" and "status" in changed:
        n.approved_by = user.username
    audit(db, user.username, "update", "news", nid, **changed)
    db.commit()
    retriever.mark_dirty()
    return {"ok": True}


@router.delete("/news/{nid}")
def delete_news(nid: int, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    n = _get(db, News, nid)
    audit(db, user.username, "delete", "news", nid, title=n.title_th)
    db.delete(n)
    db.commit()
    retriever.mark_dirty()
    return {"ok": True}


# ======================================================================== หลักสูตร
class ProgramIn(BaseModel):
    code: str
    level: str = "ปวช."
    department: str = ""
    name_th: str
    name_en: str = ""
    description_th: str = ""
    description_en: str = ""
    careers_th: str = ""
    careers_en: str = ""
    keywords: str = ""
    image_url: str = ""
    video_url: str = ""
    suits_th: str = ""          # 11 พ.ย. 2569 · migration 0002
    suits_en: str = ""
    gallery: str = ""           # บรรทัดละ 1 URL
    status: str = "draft"


@router.get("/programs")
def list_programs(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    return [to_dict(p) for p in db.query(Program).order_by(Program.level, Program.id).all()]


@router.post("/programs")
def create_program(body: ProgramIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    _check_status(body.status, user, ("draft", "pending", "published", "archived"))
    if db.query(Program).filter(Program.code == body.code).first():
        raise HTTPException(400, "รหัสสาขานี้มีอยู่แล้ว")
    p = Program(**body.model_dump())
    db.add(p)
    db.flush()
    audit(db, user.username, "create", "program", p.id, name=p.name_th)
    db.commit()
    retriever.mark_dirty()
    return {"id": p.id}


@router.put("/programs/{pid}")
def update_program(pid: int, body: ProgramIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    p = _get(db, Program, pid)
    if body.status != p.status:
        _check_status(body.status, user, ("draft", "pending", "published", "archived"))
    elif p.status == "published" and not _can_publish(user):
        body.status = "pending"
    changed = _apply(p, body.model_dump(), set(ProgramIn.model_fields))
    audit(db, user.username, "update", "program", pid, **changed)
    db.commit()
    retriever.mark_dirty()
    return {"ok": True}


@router.delete("/programs/{pid}")
def delete_program(pid: int, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    p = _get(db, Program, pid)
    audit(db, user.username, "delete", "program", pid, name=p.name_th)
    db.delete(p)
    db.commit()
    retriever.mark_dirty()
    return {"ok": True}


# ======================================================================== ฐานความรู้ AI
class KnowledgeIn(BaseModel):
    kind: str = "faq"
    category: str = "general"
    question: str
    alt_questions: str = ""
    answer_th: str
    answer_en: str = ""
    image_url: str = ""
    video_url: str = ""
    status: str = "pending"


KB_FIELDS = set(KnowledgeIn.model_fields)


@router.get("/knowledge")
def list_knowledge(status: Optional[str] = None, category: Optional[str] = None, db: Session = Depends(get_db),
                   _: User = Depends(require("viewer"))):
    q = db.query(KnowledgeItem)
    if status:
        q = q.filter(KnowledgeItem.status == status)
    if category:
        q = q.filter(KnowledgeItem.category == category)
    return [to_dict(k) for k in q.order_by(KnowledgeItem.id.desc()).all()]


@router.get("/knowledge/stats")
def knowledge_stats(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    retriever.ensure(db)
    by_status = dict(db.query(KnowledgeItem.status, func.count()).group_by(KnowledgeItem.status).all())
    by_cat = dict(db.query(KnowledgeItem.category, func.count()).filter(KnowledgeItem.status == "approved")
                  .group_by(KnowledgeItem.category).all())
    return {"index": retriever.stats(), "by_status": by_status, "by_category": by_cat,
            "unanswered_open": db.query(func.count(UnansweredQuestion.id)).filter(UnansweredQuestion.status == "new").scalar()}


@router.post("/knowledge")
def create_knowledge(body: KnowledgeIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    _check_status(body.status, user, ("draft", "pending", "approved", "rejected"))
    k = KnowledgeItem(**body.model_dump(), created_by=user.username, source="manual")
    if body.status == "approved":
        k.approved_by = user.username
    db.add(k)
    db.flush()
    audit(db, user.username, "create", "knowledge", k.id, question=k.question, status=k.status)
    db.commit()
    retriever.mark_dirty()
    return {"id": k.id}


@router.put("/knowledge/{kid}")
def update_knowledge(kid: int, body: KnowledgeIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    k = _get(db, KnowledgeItem, kid)
    if body.status != k.status:
        _check_status(body.status, user, ("draft", "pending", "approved", "rejected"))
    elif k.status == "approved" and not _can_publish(user):
        body.status = "pending"
    changed = _apply(k, body.model_dump(), KB_FIELDS)
    if changed:
        k.version += 1
    if body.status == "approved" and "status" in changed:
        k.approved_by = user.username
    audit(db, user.username, "update", "knowledge", kid, **changed)
    db.commit()
    retriever.mark_dirty()
    return {"ok": True, "version": k.version}


@router.post("/knowledge/{kid}/approve")
def approve_knowledge(kid: int, approve: bool = True, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    k = _get(db, KnowledgeItem, kid)
    k.status = "approved" if approve else "rejected"
    k.approved_by = user.username
    audit(db, user.username, "approve" if approve else "reject", "knowledge", kid, question=k.question)
    db.commit()
    retriever.mark_dirty()
    return {"ok": True}


@router.delete("/knowledge/{kid}")
def delete_knowledge(kid: int, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    k = _get(db, KnowledgeItem, kid)
    audit(db, user.username, "delete", "knowledge", kid, question=k.question)
    db.delete(k)
    db.commit()
    retriever.mark_dirty()
    return {"ok": True}


@router.post("/knowledge/import")
async def import_knowledge(file: UploadFile = File(...), user: User = Depends(require("editor")),
                           db: Session = Depends(get_db)):
    """นำเข้าความรู้จากไฟล์ CSV (UTF-8) คอลัมน์: category,question,alt_questions,answer_th,answer_en
    ทุกแถวที่นำเข้าจะอยู่ในสถานะ 'รออนุมัติ' เพื่อให้เจ้าหน้าที่ตรวจสอบก่อนใช้งานจริง"""
    raw = (await file.read()).decode("utf-8-sig", "ignore")
    reader = csv.DictReader(io.StringIO(raw))
    added, skipped = 0, 0
    for row in reader:
        q = (row.get("question") or "").strip()
        a = (row.get("answer_th") or "").strip()
        if not q or not a:
            skipped += 1
            continue
        db.add(KnowledgeItem(category=(row.get("category") or "general").strip(), question=q,
                             alt_questions=(row.get("alt_questions") or "").replace("|", "\n"), answer_th=a,
                             answer_en=(row.get("answer_en") or "").strip(), source="import", status="pending",
                             created_by=user.username))
        added += 1
    audit(db, user.username, "import", "knowledge", "", added=added, skipped=skipped, file=file.filename)
    db.commit()
    return {"added": added, "skipped": skipped}


@router.post("/knowledge/rebuild")
def rebuild_index(user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    n = retriever.rebuild(db)
    audit(db, user.username, "rebuild_index", "knowledge", "", documents=n)
    db.commit()
    return retriever.stats()


class AskIn(BaseModel):
    text: str
    lang: Optional[str] = None


@router.post("/knowledge/test")
async def test_question(body: AskIn, db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    """ทดลองถามระบบจากหลังบ้าน พร้อมแสดงรายละเอียดการตัดสินใจของ AI (เจตนา/คะแนนค้นคืน/แหล่งข้อมูล)"""
    retriever.ensure(db)
    res = await answer(db, body.text, None, body.lang, channel="test", input_mode="text")
    res["retrieval_debug"] = [
        {**h.as_dict(), "detail": h.detail} for h in retriever.search(body.text, None, top_k=5)
    ]
    res["threshold"] = settings.retrieval_threshold
    return res


# ======================================================================== สถานะ AI / ทดสอบ AI (Phase 6 · Gate 6D · admin เท่านั้น)
AI_TEST_SYSTEM = "นี่คือการทดสอบการเชื่อมต่อของระบบ ให้ตอบเพียงคำว่า OK"
AI_TEST_SENTENCE = "ทดสอบการเชื่อมต่อ"          # ประโยคคงที่ — ไม่รับข้อความจากผู้เรียก (T-ADM-06 / T-PRV-08)
AI_TEST_LIMIT_PER_MIN = 5
_ai_test_calls: dict[str, deque] = {}


def _answer_source_ratio(db: Session, days: int = 7) -> dict[str, Any]:
    """สัดส่วนแหล่งคำตอบของ messages (role=bot) ช่วง N วัน ไม่รวมช่องทางทดสอบ — นับจากคอลัมน์ provider เดิม"""
    since = datetime.now() - timedelta(days=days)
    rows = (db.query(Message.provider, func.count(Message.id))
            .join(ChatSession, ChatSession.id == Message.session_id)
            .filter(Message.role == "bot", Message.created_at >= since, ~ChatSession.channel.in_(("test", "eval")))
            .group_by(Message.provider).all())
    out = {"rules": 0, "database": 0, "knowledge-base": 0, "llm": 0, "other": 0}
    for prov, n in rows:
        key = "llm" if (prov or "").startswith("llm:") else prov if prov in out else "other"
        out[key] += n
    total = sum(out.values())
    return {"days": days, "total": total, "counts": out}


@router.get("/ai/status")
def ai_status(db: Session = Depends(get_db), _: User = Depends(require("admin"))):
    """สถานะ AI — เฉพาะฟิลด์ใน allowlist (T-ADM-05) · ไม่มีค่าคีย์ มีเพียงตั้งแล้วหรือไม่"""
    st = llm.status()
    chain = [{k: c[k] for k in ("role", "provider", "model", "enabled", "key_set", "circuit_open")} for c in llm.chain_status()]
    local = any(c["provider"] == "ollama" for c in chain if c["enabled"])
    return {
        "provider": st["provider"], "model": st["model"], "enabled": st["enabled"],
        "key_set": bool(settings.llm_api_key), "circuit_open": st["circuit_open"],
        "last_latency_ms": st["last_latency_ms"], "last_error": st["last_error"],
        "chain": chain,
        "general_enabled": settings.ai_general_enabled,
        "local_ai": "configured" if local else "not_configured",      # T-OFF-AI-03: ไม่อ้างว่ามี Offline AI
        "answer_sources": _answer_source_ratio(db),
    }


@router.post("/ai/test")
async def ai_test(db: Session = Depends(get_db), user: User = Depends(require("admin"))):
    """ทดสอบการเชื่อมต่อผู้ให้บริการด้วยประโยคคงที่ (ไม่รับข้อความใด ๆ จากผู้เรียก) · จำกัด 5 ครั้ง/นาที/บัญชี · บันทึก audit"""
    now = time.time()
    q = _ai_test_calls.setdefault(user.username, deque())
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= AI_TEST_LIMIT_PER_MIN:
        raise HTTPException(429, "ทดสอบถี่เกินไป กรุณารอสักครู่")
    q.append(now)
    st = llm.status()
    result: dict[str, Any] = {"provider": st["provider"], "model": st["model"], "ok": False, "latency_ms": 0, "error": ""}
    if not settings.llm_enabled:
        result["error"] = "not_configured"
    elif not llm.available:
        result["error"] = "unavailable"
    else:
        t0 = time.time()
        try:
            out = await llm.complete(AI_TEST_SYSTEM, AI_TEST_SENTENCE, max_tokens=8)
            result.update(ok=bool(out.strip()), provider=llm.provider)
        except LLMError:
            result["error"] = llm.status()["last_error"] or "failed"       # ปิดบังคีย์แล้ว (S1)
        result["latency_ms"] = int((time.time() - t0) * 1000)
    audit(db, user.username, "ai_test", "ai", "", provider=result["provider"], ok=result["ok"],
          latency_ms=result["latency_ms"], error=result["error"][:200])
    db.commit()
    return result


# ======================================================================== คำถามที่ตอบไม่ได้
@router.get("/unanswered")
def list_unanswered(status: str = "new", db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    q = db.query(UnansweredQuestion)
    if status != "all":
        q = q.filter(UnansweredQuestion.status == status)
    return [to_dict(u) for u in q.order_by(UnansweredQuestion.count.desc(), UnansweredQuestion.last_at.desc()).limit(300)]


class ResolveIn(BaseModel):
    action: str                                   # knowledge | intent | ignore
    category: str = "general"
    answer_th: str = ""
    answer_en: str = ""
    intent: str = ""
    knowledge_id: Optional[int] = None            # เพิ่มเป็นคำถามรูปแบบอื่นของความรู้ที่มีอยู่


@router.post("/unanswered/{uid}/resolve")
def resolve_unanswered(uid: int, body: ResolveIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    u = _get(db, UnansweredQuestion, uid)
    if body.action == "ignore":
        u.status = "ignored"
    elif body.action == "knowledge":
        if body.knowledge_id:
            k = _get(db, KnowledgeItem, body.knowledge_id)
            k.alt_questions = (k.alt_questions + "\n" + u.text).strip()
            k.version += 1
            u.resolved_knowledge_id = k.id
        else:
            if not body.answer_th.strip():
                raise HTTPException(400, "กรุณาใส่คำตอบภาษาไทย")
            status = "approved" if _can_publish(user) else "pending"
            k = KnowledgeItem(category=body.category, question=u.text, answer_th=body.answer_th, answer_en=body.answer_en,
                              source="unanswered", status=status, created_by=user.username,
                              approved_by=user.username if status == "approved" else "")
            db.add(k)
            db.flush()
            u.resolved_knowledge_id = k.id
        u.status = "resolved"
        retriever.mark_dirty()
    elif body.action == "intent":
        if not body.intent:
            raise HTTPException(400, "กรุณาเลือกเจตนา")
        db.add(IntentExample(text=u.text, intent=body.intent, lang=u.lang, source="staff"))
        u.status = "resolved"
    else:
        raise HTTPException(400, "action ไม่ถูกต้อง")
    audit(db, user.username, f"resolve_{body.action}", "unanswered", uid, text=u.text)
    db.commit()
    return {"ok": True}


# ======================================================================== ผลตอบรับ
@router.get("/feedback")
def list_feedback(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    rows = db.query(Feedback).order_by(Feedback.id.desc()).limit(300).all()
    msg_ids = [f.message_id for f in rows if f.message_id]
    from ..models import Message
    msgs = {m.id: m for m in db.query(Message).filter(Message.id.in_(msg_ids)).all()} if msg_ids else {}
    out = []
    for f in rows:
        d = to_dict(f)
        m = msgs.get(f.message_id)
        if m:
            d["answer"] = m.text
            q = db.query(Message).filter(Message.session_id == m.session_id, Message.role == "user",
                                         Message.id < m.id).order_by(Message.id.desc()).first()
            d["question"] = q.text if q else ""
        out.append(d)
    return out


@router.post("/feedback/{fid}/reviewed")
def review_feedback(fid: int, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    f = _get(db, Feedback, fid)
    f.status = "reviewed"
    audit(db, user.username, "review", "feedback", fid)
    db.commit()
    return {"ok": True}


# ======================================================================== โมเดลเจตนา (Intent) + Retrain
class ExampleIn(BaseModel):
    text: str
    intent: str


@router.get("/intents")
def list_intents(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    rows = db.query(IntentExample).filter(IntentExample.active.is_(True)).order_by(IntentExample.intent, IntentExample.id).all()
    groups: dict[str, list] = {}
    for r in rows:
        groups.setdefault(r.intent, []).append({"id": r.id, "text": r.text, "lang": r.lang, "source": r.source})
    return {"intents": groups, "total": len(rows), "active_version": intent_classifier.version}


@router.post("/intents/examples")
def add_example(body: ExampleIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    text = body.text.strip()
    if not text or not body.intent.strip():
        raise HTTPException(400, "กรุณากรอกข้อความและเจตนา")
    ex = IntentExample(text=text, intent=body.intent.strip(), lang="en" if text.isascii() else "th", source="staff")
    db.add(ex)
    db.flush()
    audit(db, user.username, "create", "intent_example", ex.id, intent=ex.intent, text=text)
    db.commit()
    return {"id": ex.id}


@router.delete("/intents/examples/{eid}")
def delete_example(eid: int, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    ex = _get(db, IntentExample, eid)
    ex.active = False
    audit(db, user.username, "delete", "intent_example", eid, text=ex.text)
    db.commit()
    return {"ok": True}


class RetrainIn(BaseModel):
    notes: str = ""


@router.post("/intents/retrain")
def retrain(body: RetrainIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    try:
        mv = retrain_intent(db, user.username, body.notes)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(400, str(e))
    return to_dict(mv)


@router.get("/models")
def model_versions(kind: str = "intent", db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    rows = db.query(ModelVersion).filter(ModelVersion.kind == kind).order_by(ModelVersion.version.desc()).all()
    return [to_dict(m) for m in rows]


@router.post("/models/{mid}/activate")
def activate_model(mid: int, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    mv = _get(db, ModelVersion, mid)
    if mv.kind == "intent":
        try:
            activate_intent_version(db, mid, user.username)
        except ValueError as e:
            raise HTTPException(400, str(e))
    else:
        db.query(ModelVersion).filter(ModelVersion.kind == mv.kind).update({"active": False})
        mv.active = True
        audit(db, user.username, "rollback", f"{mv.kind}_model", mv.version)
        db.commit()
    return {"ok": True}


# ======================================================================== โมเดลจำภาพ (Vision)
class VisionClassIn(BaseModel):
    label: str
    display_name: str = ""
    action: str = "program"
    target_id: Optional[int] = None
    response_th: str = ""
    response_en: str = ""
    active: bool = True


class SampleIn(BaseModel):
    label: str
    embeddings: list[list[float]]
    thumbnails: list[str] = []


@router.get("/vision/classes")
def vision_classes(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    counts = dict(db.query(VisionSample.label, func.count()).group_by(VisionSample.label).all())
    return [{**to_dict(v), "samples": counts.get(v.label, 0)} for v in db.query(VisionClass).order_by(VisionClass.id).all()]


@router.post("/vision/classes")
def create_vision_class(body: VisionClassIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    if db.query(VisionClass).filter(VisionClass.label == body.label).first():
        raise HTTPException(400, "มีป้ายชื่อนี้แล้ว")
    v = VisionClass(**body.model_dump())
    db.add(v)
    db.flush()
    audit(db, user.username, "create", "vision_class", v.id, label=v.label)
    db.commit()
    return {"id": v.id}


@router.put("/vision/classes/{vid}")
def update_vision_class(vid: int, body: VisionClassIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    v = _get(db, VisionClass, vid)
    changed = _apply(v, body.model_dump(exclude={"label"}), set(VisionClassIn.model_fields) - {"label"})
    audit(db, user.username, "update", "vision_class", vid, **changed)
    db.commit()
    return {"ok": True}


@router.delete("/vision/classes/{vid}")
def delete_vision_class(vid: int, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    v = _get(db, VisionClass, vid)
    db.query(VisionSample).filter(VisionSample.label == v.label).delete()
    audit(db, user.username, "delete", "vision_class", vid, label=v.label)
    db.delete(v)
    db.commit()
    return {"ok": True}


@router.get("/vision/samples")
def vision_samples(label: str, limit: int = 200, db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    limit = max(1, min(int(limit), 200))            # 24 พ.ย. 2569: หน้าการ์ดขอแค่ภาพปก 1 ภาพ
    rows = db.query(VisionSample).filter(VisionSample.label == label).order_by(VisionSample.id.desc()).limit(limit).all()
    return [{"id": r.id, "thumbnail": r.thumbnail, "created_at": r.created_at} for r in rows]


@router.post("/vision/samples")
def add_vision_samples(body: SampleIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    if not db.query(VisionClass).filter(VisionClass.label == body.label).first():
        raise HTTPException(400, "ไม่พบป้ายชื่อนี้ กรุณาสร้างก่อน")
    if not body.embeddings or len(body.embeddings) > 100:
        raise HTTPException(400, "จำนวนภาพต่อครั้งต้องอยู่ระหว่าง 1-100")
    dims = {len(e) for e in body.embeddings}
    if len(dims) != 1:
        raise HTTPException(400, "ขนาดเวกเตอร์ไม่เท่ากัน")
    for i, e in enumerate(body.embeddings):
        thumb = body.thumbnails[i] if i < len(body.thumbnails) else ""
        db.add(VisionSample(label=body.label, embedding=[round(float(x), 5) for x in e], thumbnail=thumb[:20000]))
    audit(db, user.username, "add_samples", "vision", body.label, n=len(body.embeddings))
    db.commit()
    return {"added": len(body.embeddings)}


@router.delete("/vision/samples/{sid}")
def delete_vision_sample(sid: int, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    s = _get(db, VisionSample, sid)
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/vision/retrain")
def vision_retrain(body: RetrainIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    try:
        mv = retrain_vision(db, user.username, body.notes)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return to_dict(mv)


# ======================================================================== ตารางประชาสัมพันธ์อัตโนมัติ
class ScheduleIn(BaseModel):
    name: str
    action: str = "announce_text"
    target_id: Optional[int] = None
    text_th: str = ""
    text_en: str = ""
    media_url: str = ""
    times: str = ""
    interval_min: int = 0
    days: str = "0123456"
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    priority: int = 3
    active: bool = True


SCHEDULE_ACTIONS = ("announce_news", "announce_program", "top_news", "announce_text", "play_media", "patrol")


def _check_schedule(body: "ScheduleIn", db: Session) -> None:
    """27 พ.ย. 2569: งานต้องรู้จัก · ข่าว/สาขาต้องเลือกเป้าหมาย · ข้อความ/สื่อต้องมีเนื้อหา"""
    if body.action not in SCHEDULE_ACTIONS:
        raise HTTPException(400, "ประเภทงานไม่ถูกต้อง")
    if body.action == "announce_news" and not (body.target_id and db.get(News, body.target_id)):
        raise HTTPException(400, "กรุณาเลือกข่าวหรือกิจกรรมที่จะประกาศ")
    if body.action == "announce_program" and not (body.target_id and db.get(Program, body.target_id)):
        raise HTTPException(400, "กรุณาเลือกสาขาที่จะแนะนำ")
    if body.action == "announce_text" and not body.text_th.strip():
        raise HTTPException(400, "กรุณาพิมพ์ข้อความประกาศ")
    if body.action == "play_media" and not body.media_url.strip():
        raise HTTPException(400, "กรุณาเลือกวิดีโอหรือรูปภาพ")
    if not 1 <= body.priority <= 5:
        raise HTTPException(400, "ความสำคัญต้องอยู่ระหว่าง 1-5")


@router.get("/schedules/program-text/{pid}")
def schedule_program_text(pid: int, db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    """ข้อความแนะนำสาขาที่ระบบสร้างจากข้อมูลสาขา (เจ้าหน้าที่แก้ต่อในฟอร์มได้)"""
    from ..scheduler import _first_gallery, program_text
    p = db.get(Program, pid)
    if not p:
        raise HTTPException(404, "ไม่พบสาขา")
    return {"text_th": program_text(p, "th"), "text_en": program_text(p, "en"),
            "image": p.image_url or _first_gallery(p), "video": p.video_url or ""}


@router.get("/schedules")
def list_schedules(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    return {"items": [to_dict(s) for s in db.query(Schedule).order_by(Schedule.priority.desc(), Schedule.id).all()],
            "status": scheduler.status()}


@router.post("/schedules")
def create_schedule(body: ScheduleIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    if settings.pr_schedule_only:
        _check_schedule(body, db)
    if body.action not in SCHEDULE_ACTIONS:
        raise HTTPException(400, "ประเภทงานไม่ถูกต้อง")
    if not body.times.strip() and body.interval_min <= 0:
        raise HTTPException(400, "กรุณากำหนดเวลา หรือรอบเวลา (นาที)")
    s = Schedule(**body.model_dump())
    db.add(s)
    db.flush()
    audit(db, user.username, "create", "schedule", s.id, name=s.name)
    db.commit()
    return {"id": s.id}


@router.put("/schedules/{sid}")
def update_schedule(sid: int, body: ScheduleIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    if settings.pr_schedule_only:
        _check_schedule(body, db)
    s = _get(db, Schedule, sid)
    changed = _apply(s, body.model_dump(), set(ScheduleIn.model_fields))
    audit(db, user.username, "update", "schedule", sid, **changed)
    db.commit()
    return {"ok": True}


@router.delete("/schedules/{sid}")
def delete_schedule(sid: int, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    s = _get(db, Schedule, sid)
    audit(db, user.username, "delete", "schedule", sid, name=s.name)
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/schedules/{sid}/run")
async def run_schedule_now(sid: int, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    s = _get(db, Schedule, sid)
    ok = await scheduler.run_schedule(db, s)
    if ok:
        s.last_run_at = datetime.now()
        s.run_count += 1
    audit(db, user.username, "run_now", "schedule", sid)
    db.commit()
    return {"ok": ok, "history": scheduler.status()["history"][:3]}


class AnnounceIn(BaseModel):
    text_th: str
    text_en: str = ""
    image: str = ""
    video: str = ""


@router.post("/announce")
async def announce_now(body: AnnounceIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    """ให้หุ่นยนต์ประกาศข้อความทันที (เช่น ประกาศเรียกพบ/แจ้งเหตุ)"""
    payload = {"kind": "text", "id": f"manual-{uuid.uuid4().hex[:6]}", "title_th": "ประกาศ", "title_en": "Announcement",
               "text_th": body.text_th, "text_en": body.text_en, "image": body.image, "video": body.video,
               "priority": 5, "source": f"staff:{user.username}"}
    await scheduler.announce(payload)
    audit(db, user.username, "announce", "kiosk", "", text=body.text_th[:200])
    db.commit()
    return {"ok": True, "kiosks": hub.count("kiosk")}


@router.post("/scheduler/toggle")
def toggle_scheduler(enabled: bool, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    scheduler.enabled = enabled
    audit(db, user.username, "scheduler_" + ("on" if enabled else "off"), "scheduler")
    db.commit()
    return scheduler.status()


# ======================================================================== ค่าตั้งระบบ
@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    return all_settings(db)


@router.put("/settings")
def put_settings(body: dict[str, Any], user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    changed = {}
    for k, v in body.items():
        if k in DEFAULT_SETTINGS:
            set_setting(db, k, v)
            changed[k] = str(v)[:100]
    audit(db, user.username, "update", "settings", "", **changed)
    db.commit()
    return all_settings(db)


# ======================================================================== ชุดทดสอบระบบ (Evaluation)
class EvalCaseIn(BaseModel):
    question: str
    expected_intent: str = ""
    expected_keywords: str = ""
    expect_answered: bool = True
    lang: str = "th"
    active: bool = True


@router.get("/eval/cases")
def eval_cases(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    return [to_dict(c) for c in db.query(EvalCase).order_by(EvalCase.id).all()]


@router.post("/eval/cases")
def add_eval_case(body: EvalCaseIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    c = EvalCase(**body.model_dump())
    db.add(c)
    db.flush()
    audit(db, user.username, "create", "eval_case", c.id)
    db.commit()
    return {"id": c.id}


@router.delete("/eval/cases/{cid}")
def delete_eval_case(cid: int, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    c = _get(db, EvalCase, cid)
    db.delete(c)
    audit(db, user.username, "delete", "eval_case", cid)
    db.commit()
    return {"ok": True}


class EvalRunIn(BaseModel):
    label: str = ""


@router.post("/eval/run")
async def eval_run(body: EvalRunIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    run = await run_evaluation(db, user.username, body.label)
    return to_dict(run)


@router.get("/eval/runs")
def eval_runs(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    return [to_dict(r, ("details",)) for r in db.query(EvalRun).order_by(EvalRun.id.desc()).limit(50).all()]


@router.get("/eval/runs/{rid}")
def eval_run_detail(rid: int, db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    return to_dict(_get(db, EvalRun, rid))


# ======================================================================== บันทึกตรวจสอบ / เหตุการณ์ระบบ
@router.get("/audit")
def audit_log(limit: int = 200, db: Session = Depends(get_db), _: User = Depends(require("admin"))):
    return [to_dict(a) for a in db.query(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 1000)).all()]


@router.get("/events")
def events(level: Optional[str] = None, source: Optional[str] = None, limit: int = 200, db: Session = Depends(get_db),
           _: User = Depends(require("viewer"))):
    q = db.query(SystemEvent)
    if level:
        q = q.filter(SystemEvent.level == level)
    if source:
        q = q.filter(SystemEvent.source == source)
    return [to_dict(e) for e in q.order_by(SystemEvent.id.desc()).limit(min(limit, 1000)).all()]


# ======================================================================== อัปโหลดไฟล์สื่อ
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".mp4", ".webm", ".mp3", ".pdf"}


@router.post("/upload")
async def upload(file: UploadFile = File(...), user: User = Depends(require("editor"))):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"ไม่รองรับไฟล์ชนิด {ext}")
    data = await file.read()
    if len(data) > 80 * 1024 * 1024:
        raise HTTPException(400, "ไฟล์ใหญ่เกิน 80MB")
    name = f"{datetime.now():%Y%m%d}-{uuid.uuid4().hex[:8]}{ext}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / name).write_bytes(data)
    return {"url": f"/uploads/{name}", "size": len(data)}
