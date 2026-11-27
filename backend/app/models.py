"""โครงสร้างฐานข้อมูลของระบบ VORA"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def now() -> datetime:
    return datetime.now()


def new_uuid() -> str:
    return uuid.uuid4().hex


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


# ---------------------------------------------------------------- ผู้ใช้และสิทธิ์
class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    display_name: Mapped[str] = mapped_column(String(128), default="")
    role: Mapped[str] = mapped_column(String(16), default="editor")   # admin | editor | viewer
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


# ---------------------------------------------------------------- เนื้อหาประชาสัมพันธ์
class News(TimestampMixin, Base):
    """ข่าว กิจกรรม และประกาศรับสมัคร"""
    __tablename__ = "news"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), default="news")     # news | activity | admission
    title_th: Mapped[str] = mapped_column(String(255))
    title_en: Mapped[str] = mapped_column(String(255), default="")
    body_th: Mapped[str] = mapped_column(Text, default="")
    body_en: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str] = mapped_column(String(500), default="")
    video_url: Mapped[str] = mapped_column(String(500), default="")
    priority: Mapped[int] = mapped_column(Integer, default=3)          # 1 (ต่ำ) - 5 (สูงสุด)
    status: Mapped[str] = mapped_column(String(16), default="draft")   # draft | pending | published | archived
    publish_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    expire_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    event_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    approved_by: Mapped[str] = mapped_column(String(64), default="")
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    # สถานที่จัดกิจกรรม (Phase 5 · migration 0001) — NULL ได้ทั้งหมด ข่าวเดิมไม่มีสถานที่ = "ไม่ระบุสถานที่"
    location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)            # ชื่อสถานที่
    location_type: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)        # campus | external | online
    location_map_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)    # https:// ไม่ใช้กับ online
    # 12 พ.ย. 2569 · migration 0003: ภาพประกอบเพิ่มเติม บรรทัดละ 1 URL (แสดงเป็นสไลด์ต่อจาก image_url) — NULL ได้
    gallery: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")


class Program(TimestampMixin, Base):
    """หลักสูตร/สาขาวิชา"""
    __tablename__ = "programs"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    level: Mapped[str] = mapped_column(String(32), default="ปวช.")
    department: Mapped[str] = mapped_column(String(128), default="")
    name_th: Mapped[str] = mapped_column(String(255))
    name_en: Mapped[str] = mapped_column(String(255), default="")
    description_th: Mapped[str] = mapped_column(Text, default="")
    description_en: Mapped[str] = mapped_column(Text, default="")
    careers_th: Mapped[str] = mapped_column(Text, default="")
    careers_en: Mapped[str] = mapped_column(Text, default="")
    keywords: Mapped[str] = mapped_column(Text, default="")             # คำค้นเพิ่มเติม คั่นด้วย ,
    image_url: Mapped[str] = mapped_column(String(500), default="")
    video_url: Mapped[str] = mapped_column(String(500), default="")
    # 11 พ.ย. 2569 · migration 0002 — พรีเซนเทชันสาขาบนหน้าจอหุ่นยนต์ (NULL ได้ทั้งหมด สาขาเดิมไม่ถูกแก้)
    suits_th: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")     # เหมาะกับใคร
    suits_en: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")
    gallery: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")      # ภาพบรรยากาศ บรรทัดละ 1 URL
    status: Mapped[str] = mapped_column(String(16), default="published")
    view_count: Mapped[int] = mapped_column(Integer, default=0)


# ---------------------------------------------------------------- ฐานความรู้ AI
class KnowledgeItem(TimestampMixin, Base):
    """รายการความรู้ที่ AI ใช้ค้นคืน ต้องได้รับการอนุมัติ (approved) ก่อนจึงจะถูกใช้ตอบ"""
    __tablename__ = "knowledge"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), default="faq")       # faq | doc
    category: Mapped[str] = mapped_column(String(32), default="general")
    question: Mapped[str] = mapped_column(Text, default="")             # คำถามหลัก
    alt_questions: Mapped[str] = mapped_column(Text, default="")        # คำถามรูปแบบอื่น บรรทัดละ 1 คำถาม
    answer_th: Mapped[str] = mapped_column(Text, default="")
    answer_en: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str] = mapped_column(String(500), default="")
    video_url: Mapped[str] = mapped_column(String(500), default="")
    source: Mapped[str] = mapped_column(String(32), default="manual")   # manual | unanswered | import
    status: Mapped[str] = mapped_column(String(16), default="pending")  # draft | pending | approved | rejected
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    approved_by: Mapped[str] = mapped_column(String(64), default="")
    hit_count: Mapped[int] = mapped_column(Integer, default=0)


class KnowledgeCandidate(TimestampMixin, Base):
    """24 พ.ย. 2569: กล่องตรวจข้อมูล (Sandbox) — ข้อมูลที่ยังไม่แน่นอน/ข้อมูลเก่า/แหล่งขัดกัน รอเจ้าหน้าที่ตรวจ
    ยังไม่ถูกใช้ตอบจนกว่าจะกด "อนุมัตินำเข้า" → สร้าง KnowledgeItem (approved) แล้วผูก knowledge_id ไว้ย้อนกลับได้"""
    __tablename__ = "knowledge_candidates"
    id: Mapped[int] = mapped_column(primary_key=True)
    batch: Mapped[str] = mapped_column(String(64), default="", index=True)     # ชุดที่นำเข้า เช่น pplx-20261124
    ref: Mapped[str] = mapped_column(String(64), default="")                   # รหัสในไฟล์ต้นทาง (กันนำเข้าซ้ำ)
    category: Mapped[str] = mapped_column(String(32), default="general")
    question: Mapped[str] = mapped_column(Text, default="")
    alt_questions: Mapped[str] = mapped_column(Text, default="")               # บรรทัดละ 1 คำถาม
    answer_th: Mapped[str] = mapped_column(Text, default="")                   # คำตอบที่เสนอ (เลือกตัวเลือกอื่นได้)
    answer_en: Mapped[str] = mapped_column(Text, default="")
    choices: Mapped[Any] = mapped_column(JSON, default=list)                   # [{label, answer_th}] เมื่อแหล่งข้อมูลขัดกัน
    sources: Mapped[Any] = mapped_column(JSON, default=list)                   # [{title, url}]
    evidence: Mapped[str] = mapped_column(String(8), default="U")              # A ต้นฉบับตรง · B ทางการแต่เก่า/กรอบ · C ข่าว/สรุป · U ไม่พอ/ขัดกัน
    data_year: Mapped[str] = mapped_column(String(32), default="")             # ปีของข้อมูล เช่น "2564"
    reason: Mapped[str] = mapped_column(Text, default="")                      # ทำไมต้องตรวจ
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)   # pending | approved | rejected
    knowledge_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    reviewed_by: Mapped[str] = mapped_column(String(64), default="")
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    review_note: Mapped[str] = mapped_column(Text, default="")


class IntentExample(TimestampMixin, Base):
    """ตัวอย่างประโยคสำหรับฝึกโมเดลจำแนกเจตนา (Intent Classifier)"""
    __tablename__ = "intent_examples"
    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str] = mapped_column(Text)
    intent: Mapped[str] = mapped_column(String(48), index=True)
    lang: Mapped[str] = mapped_column(String(4), default="th")
    source: Mapped[str] = mapped_column(String(16), default="seed")     # seed | staff | feedback
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class VisionClass(TimestampMixin, Base):
    """ป้าย/วัตถุ/สัญลักษณ์ที่หุ่นยนต์จำได้ และสิ่งที่ต้องทำเมื่อเห็น"""
    __tablename__ = "vision_classes"
    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(64), unique=True)
    display_name: Mapped[str] = mapped_column(String(128), default="")
    action: Mapped[str] = mapped_column(String(16), default="program")  # program | news | text | none
    target_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    response_th: Mapped[str] = mapped_column(Text, default="")
    response_en: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class VisionItem(TimestampMixin, Base):
    """24 พ.ย. 2569: รายละเอียดของสิ่งที่กล้องจำได้ แยกตามประเภท (ป้าย / โปสเตอร์ / กิจกรรม / วัตถุ / ผลิตภัณฑ์)
    ตารางแยกจาก vision_classes (ไม่ต้อง migrate) · 1 ป้าย = 1 รายการ · ช่องของแต่ละประเภทอยู่ใน ai/vision_items.py"""
    __tablename__ = "vision_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    vision_class_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(16), default="sign")          # sign | poster | event | object | product
    details: Mapped[Any] = mapped_column(JSON, default=dict)               # {ช่อง: ข้อความ}
    images: Mapped[Any] = mapped_column(JSON, default=list)                # ["/uploads/..."] แสดงเป็นสไลด์
    news_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # ผูกกับข่าว/กิจกรรม (ดึงวัน สถานที่ รูป)


class UnknownSight(Base):
    """24 พ.ย. 2569: ผู้ใช้ถาม "นี่คืออะไร" แต่กล้องยังไม่รู้จัก → เก็บภาพย่อ + เวกเตอร์ไว้ในเครื่องให้เจ้าหน้าที่สอนเพิ่ม (ไม่ส่งออกนอกเครื่อง)"""
    __tablename__ = "unknown_sights"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    question: Mapped[str] = mapped_column(String(200), default="")
    thumbnail: Mapped[str] = mapped_column(Text, default="")               # data URL ขนาดเล็ก
    embedding: Mapped[Any] = mapped_column(JSON, default=list)
    best_label: Mapped[str] = mapped_column(String(64), default="")         # ป้ายที่ใกล้ที่สุด (ไม่ถึงเกณฑ์)
    best_prob: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(16), default="new", index=True)   # new | taught | ignored
    taught_label: Mapped[str] = mapped_column(String(64), default="")


class VisionPending(Base):
    """24 พ.ย. 2569: รายการที่นำเข้าทีละมาก (จากข่าว/Excel) รอเจ้าหน้าที่ตรวจ — ระหว่างรอ ป้ายถูกปิด (active=False) และไม่ถูกนำไปฝึก
    ตารางแยก (ไม่ต้อง migrate) · ยืนยัน = เปิดใช้งาน + ลบแถวนี้ · ไม่ใช้ = ลบป้าย ภาพตัวอย่าง และรายละเอียด"""
    __tablename__ = "vision_pending"
    id: Mapped[int] = mapped_column(primary_key=True)
    vision_class_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    source: Mapped[str] = mapped_column(String(16), default="")         # news | excel
    ref: Mapped[str] = mapped_column(String(255), default="")           # รหัสข่าว / แผ่นงาน+แถว
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class KioskScreen(Base):
    """25 พ.ย. 2569: จอหุ่นยนต์ที่เปิดจากเครื่องอื่นในวง LAN — เก็บ sha256 ของกุญแจเท่านั้น · ตารางใหม่ (ไม่ต้อง migrate)"""
    __tablename__ = "kiosk_screens"
    id: Mapped[int] = mapped_column(primary_key=True)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    code: Mapped[str] = mapped_column(String(8), default="")
    name: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)   # pending | approved | revoked
    last_ip: Mapped[str] = mapped_column(String(64), default="")
    last_seen: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    approved_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class VisionSample(Base):
    """เวกเตอร์คุณลักษณะ (image embedding) ของภาพตัวอย่าง ใช้ฝึกโมเดลจำป้าย"""
    __tablename__ = "vision_samples"
    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(64), index=True)
    embedding: Mapped[list] = mapped_column(JSON)
    thumbnail: Mapped[str] = mapped_column(Text, default="")            # data URL ขนาดเล็กไว้แสดงในหลังบ้าน
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ModelVersion(Base):
    """ประวัติการฝึกโมเดล (Retrain) พร้อมผลการวัดประสิทธิภาพ ย้อนกลับเวอร์ชันได้"""
    __tablename__ = "model_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)          # intent | vision
    version: Mapped[int] = mapped_column(Integer)
    n_samples: Mapped[int] = mapped_column(Integer, default=0)
    n_classes: Mapped[int] = mapped_column(Integer, default=0)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    path: Mapped[str] = mapped_column(String(500), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


# ---------------------------------------------------------------- การใช้งานและผลตอบรับ
class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_uuid)
    channel: Mapped[str] = mapped_column(String(16), default="kiosk")    # kiosk | mobile
    lang: Mapped[str] = mapped_column(String(4), default="th")
    trigger: Mapped[str] = mapped_column(String(16), default="text")     # greeting | voice | text | vision | gesture
    started_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    last_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    message_count: Mapped[int] = mapped_column(Integer, default=0)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(8))                         # user | bot
    text: Mapped[str] = mapped_column(Text)
    input_mode: Mapped[str] = mapped_column(String(16), default="text")  # voice | text | vision | gesture | auto
    lang: Mapped[str] = mapped_column(String(4), default="th")
    intent: Mapped[str] = mapped_column(String(48), default="")
    intent_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    retrieval_score: Mapped[float] = mapped_column(Float, default=0.0)
    answered: Mapped[bool] = mapped_column(Boolean, default=True)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    provider: Mapped[str] = mapped_column(String(32), default="")
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    message_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(16), default="rating")      # rating | thumb | wrong_answer | survey
    rating: Mapped[int] = mapped_column(Integer, default=0)               # 1-5 หรือ +1/-1
    comment: Mapped[str] = mapped_column(Text, default="")
    channel: Mapped[str] = mapped_column(String(16), default="kiosk")
    status: Mapped[str] = mapped_column(String(16), default="new")        # new | reviewed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class UnansweredQuestion(Base):
    __tablename__ = "unanswered"
    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str] = mapped_column(Text)
    normalized: Mapped[str] = mapped_column(Text, index=True)
    lang: Mapped[str] = mapped_column(String(4), default="th")
    count: Mapped[int] = mapped_column(Integer, default=1)
    best_score: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(16), default="new")        # new | resolved | ignored
    resolved_knowledge_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    first_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    last_at: Mapped[datetime] = mapped_column(DateTime, default=now)


# ---------------------------------------------------------------- ประชาสัมพันธ์อัตโนมัติ
class Schedule(TimestampMixin, Base):
    __tablename__ = "schedules"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    # announce_news | announce_text | play_media | patrol | top_news
    action: Mapped[str] = mapped_column(String(24), default="announce_text")
    target_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    text_th: Mapped[str] = mapped_column(Text, default="")
    text_en: Mapped[str] = mapped_column(Text, default="")
    media_url: Mapped[str] = mapped_column(String(500), default="")
    times: Mapped[str] = mapped_column(String(255), default="")           # "08:00,12:30"
    interval_min: Mapped[int] = mapped_column(Integer, default=0)          # ทำซ้ำทุก N นาที (0 = ไม่ใช้)
    days: Mapped[str] = mapped_column(String(32), default="0123456")      # 0=จันทร์ ... 6=อาทิตย์
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=3)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0)


class PatrolRoute(TimestampMixin, Base):
    """เส้นทางเดินประชาสัมพันธ์: ลำดับคำสั่งเคลื่อนที่ + จุดประกาศ"""
    __tablename__ = "patrol_routes"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    steps: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class SystemEvent(Base):
    """บันทึกเหตุการณ์/ข้อผิดพลาดของระบบ ใช้ทำรายงานความเสถียร"""
    __tablename__ = "system_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    level: Mapped[str] = mapped_column(String(8), default="info")         # info | warn | error
    source: Mapped[str] = mapped_column(String(32), default="system")     # ai | robot | speech | scheduler | kiosk
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class AuditLog(Base):
    """ประวัติการเปลี่ยนแปลงข้อมูล เพื่อการตรวจสอบย้อนหลัง"""
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), default="")
    action: Mapped[str] = mapped_column(String(32))                        # create | update | delete | approve | retrain ...
    entity: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class SettingKV(Base):
    """ค่าตั้งที่เจ้าหน้าที่ปรับได้จากหลังบ้าน"""
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)


# ---------------------------------------------------------------- ชุดทดสอบระบบถาม-ตอบ (หลักฐานการทดสอบ)
class EvalCase(TimestampMixin, Base):
    """กรณีทดสอบ: คำถาม + เจตนาที่คาดหวัง + คำสำคัญที่ต้องมีในคำตอบ หรือคาดว่าต้อง 'ไม่มีข้อมูล'"""
    __tablename__ = "eval_cases"
    id: Mapped[int] = mapped_column(primary_key=True)
    question: Mapped[str] = mapped_column(Text)
    expected_intent: Mapped[str] = mapped_column(String(48), default="")
    expected_keywords: Mapped[str] = mapped_column(Text, default="")    # คั่นด้วย | (ต้องพบอย่างน้อย 1 คำ)
    expect_answered: Mapped[bool] = mapped_column(Boolean, default=True)
    lang: Mapped[str] = mapped_column(String(4), default="th")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class EvalRun(Base):
    __tablename__ = "eval_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(128), default="")
    total: Mapped[int] = mapped_column(Integer, default=0)
    passed: Mapped[int] = mapped_column(Integer, default=0)
    intent_accuracy: Mapped[float] = mapped_column(Float, default=0.0)
    answer_accuracy: Mapped[float] = mapped_column(Float, default=0.0)
    avg_latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    intent_model_version: Mapped[int] = mapped_column(Integer, default=0)
    kb_documents: Mapped[int] = mapped_column(Integer, default=0)
    details: Mapped[list] = mapped_column(JSON, default=list)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
