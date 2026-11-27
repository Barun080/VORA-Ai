"""งาน F "สาธิตไม่สะดุด" (21 พ.ย. 2569) — รายการข้อความที่ VORA จะพูดเมื่อเน็ตล่ม + คำถามยอดฮิตสำหรับแตะถาม

ทำไมต้อง "ถามระบบจริง" แทนการเดาข้อความ: เสียงที่เตรียมไว้ค้นด้วย "ข้อความที่พูดทั้งข้อความ" ต้องตรงทุกตัวอักษร
จึงให้ engine ตอบคำถามตัวอย่างจริง ๆ ในโหมดฐานความรู้ (connectivity.simulate_offline — เฉพาะงานนี้ ไม่กระทบผู้ใช้คนอื่น)
บนธุรกรรมฐานข้อมูลที่ "ย้อนกลับทั้งหมด" ตอนจบ (rollback_only) → ไม่มีข้อความ/สถิติ/คำถามที่ตอบไม่ได้ถูกบันทึกจากงานนี้
หน้าหลังบ้านนำข้อความไปผ่าน speechText() ตัวเดียวกับหน้าจอหุ่น แล้วสั่งเตรียมเสียงทีละข้อความ (tts.pin)
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from . import connectivity, greetings
from .db import engine as db_engine
from .models import KnowledgeItem, Program, Schedule

MAX_FAQ = 300

# คำถามที่หน้าจอแสดงให้แตะเมื่อเน็ตล่ม (ตอบได้จากฐานความรู้/ข้อมูลโครงสร้าง) — ต่อด้วยคำถามที่ถามบ่อยในฐานความรู้
BASE_QUICK = {
    "th": ["มีสาขาอะไรบ้าง", "สมัครเรียนยังไง", "มีข่าวอะไรบ้าง", "ค่าเทอมเท่าไหร่", "มีทุนการศึกษาไหม"],
    "en": ["What programs do you offer?", "How do I apply?", "Latest news", "How much is the tuition?", "Is there a scholarship?"],
}
# ประโยคที่ engine สุ่มเลือก (ขอบคุณ/ลา) — ใส่ครบทุกแบบ
FIXED_REPLIES = {
    "th": ["ยินดีค่ะ ขอให้เป็นวันที่ดีนะคะ แล้วพบกันใหม่ค่ะ", "ด้วยความยินดีค่ะ มีอะไรมาถามวอร่าได้อีกนะคะ"],
    "en": [],
}
SYSTEM_Q = {
    "th": [("ทักทาย", "สวัสดี"), ("แนะนำวิทยาลัย", "แนะนำวิทยาลัยหน่อย"), ("สมัครออนไลน์", "สมัครเรียนออนไลน์ยังไง"),
           ("เน็ตล่ม", "เปิดเว็บไซต์วิทยาลัย"), ("ความสามารถ", "เธอทำอะไรได้บ้าง")],
    "en": [("Greeting", "Hello"), ("About", "Tell me about the college"), ("Apply online", "How do I apply online?"),
           ("Offline", "Open the college website"), ("Abilities", "What can you do?")],
}


def quick_questions(db: Session, lang: str = "th", n: int = 6) -> list[str]:
    lang = "en" if lang == "en" else "th"
    out: list[str] = list(BASE_QUICK[lang])
    if lang == "th":
        rows = (db.query(KnowledgeItem.question).filter(KnowledgeItem.status == "approved", KnowledgeItem.kind == "faq",
                                                        KnowledgeItem.question != "")
                .order_by(KnowledgeItem.hit_count.desc(), KnowledgeItem.id).limit(40).all())
        for (q,) in rows:
            q = (q or "").strip()
            if q and len(q) <= 40 and q not in out:
                out.append(q)
    return out[: max(n, 1) + 4][: n]


def _questions(db: Session) -> list[tuple[str, str, str, str]]:
    """(kind, label, lang, question)"""
    qs: list[tuple[str, str, str, str]] = []
    for lang in ("th", "en"):
        for label, q in SYSTEM_Q[lang]:
            qs.append(("system", label, lang, q))
        for q in quick_questions(db, lang, n=12):
            qs.append(("quick", q, lang, q))
    progs = db.query(Program).filter(Program.status == "published").order_by(Program.id).all()
    for p in progs:
        qs.append(("program", p.name_th, "th", f"สาขา{p.name_th}เรียนอะไร"))
        qs.append(("program", p.name_th, "th", f"จบสาขา{p.name_th}แล้วทำงานอะไร"))
        if p.name_en:
            qs.append(("program", p.name_en, "en", f"What do you study in {p.name_en}?"))
            qs.append(("program", p.name_en, "en", f"What jobs can {p.name_en} graduates do?"))
    faqs = (db.query(KnowledgeItem).filter(KnowledgeItem.status == "approved", KnowledgeItem.kind == "faq",
                                          KnowledgeItem.question != "")
            .order_by(KnowledgeItem.hit_count.desc(), KnowledgeItem.id).limit(MAX_FAQ).all())
    for k in faqs:
        qs.append(("faq", k.question[:60], "th", k.question))
        if (k.answer_en or "").strip():
            qs.append(("faq", k.question[:60], "en", k.question))
    return qs


async def build_phrases() -> list[dict[str, Any]]:
    """ข้อความที่ VORA จะพูดในโหมดฐานความรู้ (ข้อความดิบ — หน้าหลังบ้านแปลงด้วย speechText ก่อนเตรียมเสียง)"""
    from .ai.engine import answer
    from .scheduler import _news_payload, _program_payload

    items: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(kind: str, label: str, lang: str, text: str) -> None:
        text = (text or "").strip()
        if text and (lang, text) not in seen:
            seen.add((lang, text))
            items.append({"kind": kind, "label": label[:80], "lang": lang, "text": text[:1500]})

    conn = db_engine.connect()
    trans = conn.begin()
    db = Session(bind=conn, join_transaction_mode="rollback_only", autoflush=False, expire_on_commit=False)
    try:
        with connectivity.simulate_offline():
            for kind, label, lang, q in _questions(db):
                try:
                    res = await answer(db, q, None, lang, channel="test", input_mode="text")
                except Exception:  # noqa: BLE001 — คำถามหนึ่งล้มไม่ควรทำให้ทั้งรายการล้ม
                    db.rollback()
                    continue
                add(kind, label, lang, res.get("text", ""))
        # ประกาศอัตโนมัติ (ข้อความเดียวกับที่ scheduler ส่งให้หน้าจอ)
        from .ai.engine import active_news
        for n in active_news(db, limit=20):
            pl = _news_payload(n)
            add("announce", n.title_th, "th", pl["text_th"])
            add("announce", n.title_en or n.title_th, "en", pl["text_en"])
        for p in db.query(Program).filter(Program.status == "published").all():
            pl = _program_payload(p)
            add("announce", p.name_th, "th", pl["text_th"])
            add("announce", p.name_en or p.name_th, "en", pl["text_en"] if p.name_en else "")
        for s in db.query(Schedule).filter(Schedule.action == "announce_text").all():
            add("announce", s.name, "th", s.text_th)
            add("announce", s.name, "en", s.text_en)
    finally:
        db.close()
        trans.rollback()
        conn.close()
    # คำทักทายอัตโนมัติ (ชุดที่ทีมอนุมัติ) — ไทย 1 คน/หลายคน · อังกฤษ 1 คน × คำทักตามช่วงเวลา
    for pool in greetings.POOLS.values():
        for g in pool:
            for people in (1, 2):
                add("greeting", f"#{g.id}", "th", g.display(people, emoji=True, lang="th"))
            for hour in (9, 14, 19):
                add("greeting", f"#{g.id}", "en", g.display(1, emoji=True, lang="en", hour=hour))
    for lang, rows in FIXED_REPLIES.items():
        for t in rows:
            add("system", "ขอบคุณ/ลา", lang, t)
    return items


__all__ = ["build_phrases", "quick_questions"]
