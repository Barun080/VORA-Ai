"""27 พ.ย. 2569 — "เธอเป็นใคร" ตอบไม่ได้ · คำถามที่ตอบไม่ได้/ตอบผิดข้อ · ข่าวที่เผยแพร่แล้วไม่ขึ้นเพราะวันที่ผิดรูปแบบ
สวิตช์: VORA_ANSWER_CHECK=0 (กติกาตรวจคำตอบทั้งหมด) · VORA_EXACT_FAQ_FIRST=0 (คำถามตรงตัวอักษรขึ้นก่อน)"""
from datetime import datetime, timedelta
from types import SimpleNamespace as NS

import pytest

from app.ai import answer_check as ac
from app.config import settings


def hit(title, answer, score=0.4, match="", type_="faq"):
    return NS(score=score, doc=NS(title=title, match_text=match or title, answer_th=answer, answer_en="", content="", type=type_))


# ------------------------------------------------------------------ คำถาม
def test_who_are_you_core_ignores_be_verb():
    """เดิม: แก่น "เป็นใคร" ไม่อยู่ใน "เธอคือใคร" → ตัดทิ้งทุกข้อ → ไม่มีข้อมูล"""
    ok, why = ac.check("เธอเป็นใคร", hit("เธอคือใคร", "หนูชื่อวอร่าค่ะ", score=0.3, match="เธอคือใคร\nวอร่าคือใคร"))
    assert ok, why


def test_particles_stripped_only_at_end():
    assert "แนะนำ" in ac.core("แนะนำการใช้งาน")          # เดิมกลายเป็น "แนำ"
    assert ac.core("คุณสมบัติผู้สมัคร").startswith("คุณสมบัติ")   # ไม่ตัด "คุณ" ออกจาก "คุณสมบัติ"


def test_level_mismatch_dropped_but_next_level_question_kept():
    ok, why = ac.check("คุณสมบัติผู้สมัครระดับ ปวช.", hit("คุณสมบัติผู้สมัครระดับ ปวส.", "จบ ม.6 หรือ ปวช.", 0.74))
    assert not ok and "ปวส" in why
    assert ac.check("คุณสมบัติผู้สมัครระดับ ปวช.", hit("คุณสมบัติผู้สมัครระดับ ปวช.", "จบ ม.3", 0.71))[0]
    # "จบ ปวช. สมัครอะไรได้" = ถามระดับถัดไป → ข้อของ ปวส. ใช้ได้
    assert ac.check("จบ ปวช. สมัครอะไรได้", hit("คุณสมบัติผู้สมัครระดับ ปวส.", "รับผู้ที่จบ ปวช.", 0.55))[0]


def test_english_name_with_spaces():
    assert ac.check("Fix it Center คืออะไร", hit("Fix it Center คืออะไร", "ศูนย์ซ่อมสร้างเพื่อชุมชนค่ะ", 0.4))[0]


@pytest.mark.parametrize("q", ["สัดส่วนนักเรียนสายสามัญกับสายอาชีพเป็นเท่าไร", "แผนรับนักเรียนอาชีวศึกษาปี 2568 เท่าไร", "ประกวดราคา"])
def test_not_money_questions(q):
    assert ac.check(q, hit(q, "ข้อมูลอยู่ที่ www.example.ac.th ค่ะ", 0.39))[0]


def test_exact_staff_question_first_and_switch(monkeypatch):
    law = hit("กฎหมายหลักของอาชีวศึกษาคืออะไร", "พ.ร.บ.การอาชีวศึกษา", 0.492)
    mean = hit("อาชีวศึกษาคืออะไร", "การศึกษาสายวิชาชีพค่ะ", 0.486, match="อาชีวศึกษาคืออะไร\nอาชีวะคืออะไร")
    keep, _ = ac.filter_hits("อาชีวศึกษาคืออะไร", [law, mean])
    assert keep[0] is mean
    assert ac.filter_hits("อาชีวะคืออะไร ?", [law, mean])[0][0] is mean
    assert not ac.is_exact("อาชีวศึกษาคืออะไร", hit("อาชีวศึกษาคืออะไร", "x", type_="program"))
    monkeypatch.setattr(settings, "exact_faq_first", False)
    assert ac.filter_hits("อาชีวศึกษาคืออะไร", [law, mean])[0][0] is law       # ปิดสวิตช์ = ลำดับคะแนนเดิม


# ------------------------------------------------------------------ ข่าว
def _news(db, title, **kw):
    from app.models import News
    n = News(title_th=title, kind="news", status="published", **kw)
    db.add(n)
    db.commit()
    return n.id


def test_buddhist_year_and_zero_expiry_news_are_shown(client):
    from app.db import SessionLocal
    now = datetime.now()
    with SessionLocal() as db:
        be = _news(db, "ข่าวปี พ.ศ. ทดสอบ", publish_at=(now - timedelta(days=3)).replace(year=now.year + 543))
        zero = _news(db, "ข่าววันหมดอายุศูนย์ทดสอบ", expire_at=datetime(1, 1, 1))
        future = _news(db, "ข่าวอนาคต พ.ศ. ทดสอบ", publish_at=(now + timedelta(days=30)).replace(year=now.year + 543))
        expired = _news(db, "ข่าวหมดอายุ พ.ศ. ทดสอบ", expire_at=(now - timedelta(days=1)).replace(year=now.year + 543))
    ids = {n["id"] for n in client.get("/api/news?limit=200").json()}
    assert be in ids and zero in ids
    assert future not in ids and expired not in ids


def test_admin_news_converts_buddhist_year(client, admin_headers):
    y = datetime.now().year
    r = client.post("/api/admin/news", headers=admin_headers, json={
        "title_th": "ข่าวกรอกปี พ.ศ. ทดสอบ", "kind": "news", "status": "published",
        "publish_at": f"{y + 543}-01-02T08:00:00", "expire_at": "0001-01-01T00:00:00", "event_date": f"{y + 543}-03-04T09:00:00"})
    assert r.status_code == 200, r.text
    n = next(x for x in client.get("/api/admin/news", headers=admin_headers).json() if x["id"] == r.json()["id"])
    assert n["publish_at"].startswith(f"{y}-01-02") and n["event_date"].startswith(f"{y}-03-04") and not n["expire_at"]


def test_fix_news_dates_rule():
    import importlib.util
    from pathlib import Path
    p = Path(__file__).resolve().parents[2] / "scripts" / "fix_news_dates.py"
    spec = importlib.util.spec_from_file_location("fix_news_dates", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.fixed(datetime(2569, 9, 17)) == (datetime(2026, 9, 17), True)
    assert m.fixed(datetime(1, 1, 1)) == (None, True)
    assert m.fixed(datetime(2026, 9, 17)) == (datetime(2026, 9, 17), False)
    assert m.fixed(None) == (None, False)


# ------------------------------------------------------------------ ร่างคำตอบรออนุมัติ / คำถามที่เจ้าหน้าที่เขียนตรงตัว
def _kb(status, q, alts, ans):
    from app.db import SessionLocal
    from app.models import KnowledgeItem
    with SessionLocal() as db:
        k = KnowledgeItem(kind="faq", category="general", status=status, question=q, alt_questions=alts, answer_th=ans, answer_en="")
        db.add(k)
        db.commit()
        return k.id


def _ask(client, text):
    return client.post("/api/chat", json={"text": text, "session_id": None, "lang": "th"}).json()


def test_pending_draft_not_used_until_approved(client, admin_headers):
    kid = _kb("pending", "ทดสอบร่างเรียนยากไหมนะ", "", "คำตอบร่างทดสอบกิ่งก้านสาขา")
    client.post("/api/admin/knowledge/rebuild", headers=admin_headers)
    assert "กิ่งก้านสาขา" not in (_ask(client, "ทดสอบร่างเรียนยากไหมนะ").get("text") or "")
    from app.db import SessionLocal
    from app.models import KnowledgeItem
    with SessionLocal() as db:
        db.get(KnowledgeItem, kid).status = "approved"
        db.commit()
    client.post("/api/admin/knowledge/rebuild", headers=admin_headers)
    assert "กิ่งก้านสาขา" in (_ask(client, "ทดสอบร่างเรียนยากไหมนะ").get("text") or "")


def test_staff_written_website_question_answers_from_kb(client, admin_headers):
    _kb("approved", "เว็บไซต์ข้อมูลทดสอบพิเศษคืออะไร", "เว็บไซต์เกี่ยวกับข้อมูลทดสอบพิเศษ", "ดูได้ที่ www.example-test-site.go.th ค่ะ")
    client.post("/api/admin/knowledge/rebuild", headers=admin_headers)
    r = _ask(client, "เว็บไซต์เกี่ยวกับข้อมูลทดสอบพิเศษ")
    assert "example-test-site" in (r.get("text") or "")
