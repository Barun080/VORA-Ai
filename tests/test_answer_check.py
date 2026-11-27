"""ตรวจความตรงของข้อมูลก่อนตอบ (23 พ.ย. 2569) — ai/answer_check.py + จุดแก้จากชุดทดสอบ 115 คำถาม
ปิดได้: VORA_ANSWER_CHECK=0 (ทุกข้อในไฟล์นี้กลับเป็นแบบเดิม)"""
from types import SimpleNamespace as NS

import pytest

from app import brain
from app.ai import answer_check as ac
from app.ai import engine, program_answer as pa, realtime, web
from app.config import settings


@pytest.fixture(autouse=True)
def _reset():
    brain._reset_for_tests()


def hit(title, answer, score=0.4, match=""):
    return NS(score=score, doc=NS(title=title, match_text=match or title, answer_th=answer, answer_en="", content=""))


# ------------------------------------------------------------------ กติกา (ฟังก์ชันล้วน)
def test_place_question_needs_the_place():
    addr = hit("วิทยาลัยเทคนิคน่านอยู่ที่ไหน", "เลขที่ 2 ถ.รอบกำแพงเมืองทิศตะวันตก ต.ในเวียง อ.เมือง จ.น่าน", 0.6)
    ok, why = ac.check("ห้องทะเบียนอยู่ไหน", addr)
    assert not ok and "ทะเบียน" in why
    assert ac.check("วิทยาลัยอยู่ที่ไหน", addr)[0]


@pytest.mark.parametrize("q,answer,ok", [
    ("วิทยาลัยเปิดกี่โมง", "เลขที่ 2 ถ.รอบกำแพงเมือง จ.น่าน", False),
    ("วิทยาลัยเปิดกี่โมง", "เปิดเวลา 08.30–16.30 น. ค่ะ", True),
    ("ค่าใช้จ่ายเท่าไหร่", "ปีการศึกษา 2569 ประกาศรอบโควตาเมื่อ 2 ธันวาคม 2568", False),   # มีแต่ปี ≠ ราคา
    ("ค่าใช้จ่ายเท่าไหร่", "ค่าบำรุงการศึกษา 1,500 บาท", True),
    ("ปวส. เรียนกี่ปี", "ระดับ ปวส. เรียน 2 ปี", True),
    ("ปวส. เรียนกี่ปี", "ระดับ ปวส. รับผู้จบ ปวช. หรือ ม.6", False),
])
def test_answer_type(q, answer, ok):
    assert ac.check(q, hit(q, answer, 0.7))[0] is ok


def test_english_term_must_appear():
    comp = hit("มีการแข่งขันทักษะวิชาชีพไหม", "มีการแข่งขันทักษะวิชาชีพทุกปี", 0.45)
    assert not ac.check("มีการแข่งขัน STEM ไหม", comp)[0]
    ai = hit("ถ้าชอบ เอไอ ควรเรียนอะไร", "ลองดูเทคโนโลยีสารสนเทศ", 0.7)
    assert ac.check("อยากเรียน AI", ai)[0]                     # คำแปลที่กำหนด (ai ↔ เอไอ)


def test_short_question_core_must_match_low_score_hit():
    wrong = hit("ปวช. สมัครต่อ ปวส. ได้ไหม", "ได้ค่ะ ระดับ ปวส. รับผู้ที่จบ ปวช. และ ม.6", 0.35)
    assert ac.core("สมัครออนไลน์ได้ไหม") == "สมัครออนไลน์"
    assert not ac.check("สมัครออนไลน์ได้ไหม", wrong)[0]
    assert not ac.check("ต้องสอบไหม", hit("มีทวิภาคีไหม", "สอบถามรายละเอียดได้ที่แผนก", 0.2))[0]   # "สอบถาม" ในคำตอบไม่นับ
    assert ac.check("สมัครออนไลน์ได้ไหม", hit("สมัครออนไลน์ได้ไหม", "ได้ค่ะ", 0.35))[0]
    assert ac.check("มีสาขาที่ทำเกมมั้ย", hit("ถ้าอยากทำเกมควรเรียนอะไร", "ลองดูไอที", 0.72))[0]   # คะแนนสูง = ไม่ตรวจข้อนี้


def test_filter_hits_reports_reasons():
    keep, dropped = ac.filter_hits("ห้องทะเบียนอยู่ไหน", [hit("วิทยาลัยอยู่ที่ไหน", "จ.น่าน", 0.6),
                                                       hit("งานทะเบียนอยู่ที่ไหน", "งานทะเบียนอยู่ที่…", 0.5)])
    assert [h.doc.title for h in keep] == ["งานทะเบียนอยู่ที่ไหน"]
    assert dropped and dropped[0]["reason"]


# ------------------------------------------------------------------ จุดแก้อื่นจากชุดทดสอบ
def test_event_time_is_not_the_clock():
    assert realtime.detect("ตอนนี้กี่โมง") is not None
    assert realtime.detect("งานเริ่มกี่โมง") is None
    assert realtime.detect("กิจกรรมจัดกี่โมง") is None


def test_asking_about_ability_is_not_a_web_search():
    assert web.detect("เธอค้นข้อมูลจากอินเทอร์เน็ตได้ไหม") is None
    assert web.detect("ค้นหาข้อมูลดาวอังคาร") is not None


@pytest.mark.parametrize("q,asp", [
    ("แผนกนี้เปิดระดับไหน", pa.OTHER), ("ต้องเรียนเขียนโปรแกรมไหม", pa.OTHER), ("แผนกนี้อยู่ตึกไหน", pa.OTHER),
    ("มีกิจกรรมอะไรบ้าง", pa.OTHER), ("เรียนคอมเป็นโปรแกรมเมอร์ได้ไหม", pa.CAREER), ("จบไปทำงานโรงงานได้มั้ย", pa.CAREER),
])
def test_new_aspect_cues(q, asp):
    assert pa.aspect(q, "program_detail") == asp


@pytest.mark.parametrize("q,is_list", [
    ("มีสาขาอะไรบ้าง", True), ("มีข่าวอะไรบ้าง", True), ("วิทยาลัยมีข่าวอะไรบ้าง", True), ("ข่าวล่าสุด", True),
    ("มีหลักสูตรอะไรบ้าง", True), ("มีสาขาที่ทำเกมมั้ย", False), ("ถ้าอยากรู้ข่าวล่าสุดของวิทยาลัยดูตรงไหน", False),
])
def test_pure_list_questions_keep_live_data(q, is_list):
    assert bool(engine._LIST_Q.match(q.replace(" ", ""))) is is_list


def test_placeholder_contact_is_not_spoken(monkeypatch):
    cfg = {"contact_th": "ติดต่องานประชาสัมพันธ์ อาคาร 1 ชั้น 1 โทร 0-0000-0000", "phone": ""}
    assert "0-0000-0000" not in engine._no_info("th", cfg)
    assert "054" in engine._no_info("th", {**cfg, "phone": "054-719552"})
    monkeypatch.setattr(settings, "answer_check", False)
    assert "0-0000-0000" in engine._no_info("th", cfg)          # ปิดสวิตช์ = แบบเดิม


def test_news_detail_reply():
    from datetime import datetime
    n = NS(title_th="Open House", title_en="", location="หอประชุม", event_date=datetime(2026, 12, 5, 9, 0))
    assert "จัดที่หอประชุม" in engine._news_detail_reply(n, "งานนี้จัดที่ไหน", "th")
    assert "05/12/2569" in engine._news_detail_reply(n, "จัดวันไหน", "th")
    assert "09:00" in engine._news_detail_reply(n, "เริ่มกี่โมง", "th")
    n2 = NS(title_th="ข่าว", title_en="", location="", event_date=None)
    assert "ยังไม่มีข้อมูลสถานที่" in engine._news_detail_reply(n2, "จัดที่ไหน", "th")


# ------------------------------------------------------------------ ผ่าน /api/chat
def test_news_followup_answers_from_that_news(client):
    sid = "t-news-detail"
    r = client.post("/api/chat", json={"text": "วันนี้มีข่าวอะไร", "session_id": sid}).json()
    if not r.get("answered") or "ข่าว" not in r.get("text", r.get("reply", "")):
        pytest.skip("ไม่มีข่าวในฐานข้อมูลทดสอบ")
    r2 = client.post("/api/chat", json={"text": "งานนี้จัดที่ไหน", "session_id": sid}).json()
    t = r2.get("text") or r2.get("reply") or ""
    assert t.startswith("ข่าว ") and ("จัดที่" in t or "ยังไม่มีข้อมูลสถานที่" in t)


def test_switch_off_keeps_old_behaviour(client, monkeypatch):
    monkeypatch.setattr(settings, "answer_check", False)
    r = client.post("/api/chat", json={"text": "ห้องทะเบียนอยู่ไหน", "session_id": "t-ac-off"})
    assert r.status_code == 200


def test_prefer_general_when_level_not_asked():
    hs = [hit("ปวส. เรียนกี่ปี", "ระดับ ปวส. เรียน 2 ปี", 0.84), hit("ปวช. เรียนกี่ปี", "ระดับ ปวช. เรียน 3 ปี", 0.84),
          hit("ใช้เวลาเรียนกี่ปี", "ปวช. 3 ปี ปวส. 2 ปี", 0.73)]
    assert ac.prefer_general("เรียนกี่ปี", hs)[0].doc.title == "ใช้เวลาเรียนกี่ปี"
    assert ac.prefer_general("ปวส. เรียนกี่ปี", hs)[0].doc.title == "ปวส. เรียนกี่ปี"      # ระบุระดับเอง = ตอบระดับนั้น


def test_this_program_reference():
    assert engine._THIS_PROG.search("แผนกนี้มีสาขาอะไรบ้าง") and engine._THIS_PROG.search("สาขานี้อยู่ตึกไหน")
    assert not engine._THIS_PROG.search("มีแผนกอะไรบ้าง")


def test_english_question_is_not_core_checked():
    assert ac.check("How do I apply?", hit("สมัครเรียนอย่างไร", "สมัครได้ที่…", 0.3))[0]


def test_secret_like_tokens_are_not_topics():
    assert ac._terms("สมัครเรียนยังไง AIzaSyD-ExampleExample12345") == []
    assert ac._terms("มีการแข่งขัน STEM ไหม") == [("stem", True)]


# ------------------------------------------------------------------ รอบ 2 (หลังเพิ่มข้อมูลจากตารางเรียน/โควตา 2570)
def test_place_answer_must_say_where():
    director = hit("ผู้อำนวยการวิทยาลัยคือใคร", "ผู้อำนวยการคือ นายพูลศักดิ์ ศรีวรมย์", 0.45)
    assert not ac.check("ห้องผู้อำนวยการอยู่ไหน", director)[0]
    room = hit("ห้องสมาร์ทคลาสรูมอยู่ไหน", "ห้องสมาร์ทคลาสรูมอยู่ที่อาคารวิทยบริการ ชั้น 2", 0.4)
    assert not ac.check("อาคารแผนกคอมอยู่ไหน", room)[0]                 # คนละที่
    news = hit("ถ้าอยากรู้ข่าวล่าสุดดูตรงไหน", "ติดตามได้ที่เว็บไซต์ www.technicnan.ac.th", 0.83)
    assert ac.check("ถ้าอยากรู้ข่าวล่าสุดของวิทยาลัยดูตรงไหน", news)[0]  # ช่องทาง = ตอบ "ตรงไหน" ได้


def test_grade_question_is_not_a_price_question():
    q = "สมัครโควตาต้องใช้เกรดเท่าไหร่"
    assert ac.check(q, hit(q, "ใช้เกรดเฉลี่ยสะสม 5 ภาคเรียนตั้งแต่ 2.50 ขึ้นไป", 0.8))[0]


def test_difficulty_needs_a_difficulty_answer():
    courses = hit("เทคโนโลยีคอมพิวเตอร์เรียนวิชาอะไรบ้าง", "เรียนเครือข่าย IoT เว็บ", 0.6)
    assert not ac.check("คอมเรียนยากไหม", courses)[0]


def test_core_uses_4grams_for_longer_questions():
    robot = hit("มีสอนหุ่นยนต์ไหม", "มีค่ะ", 0.19, match="มีสอนหุ่นยนต์ไหม\nอยากเรียนหุ่นยนต์")
    assert not ac.check("เรียนยากไหม", robot)[0]                       # "ยาก" ใน "อยาก" ไม่นับ
