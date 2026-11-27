"""ตอบคำถามสาขาให้ตรงประเด็น (23 พ.ย. 2569) — ai/program_answer.py + engine
พบจริง: "มีแผนกเทคโนโลยีคอมพิวเตอร์ไหม" และ "เรียนเกี่ยวกับอะไรบ้าง" ได้คำตอบประโยคเดียวกัน ไม่ได้ตอบว่า "มี" """
import pytest

from app import brain
from app.ai import program_answer as pa
from app.config import settings
from app.db import SessionLocal
from app.models import Program, UnansweredQuestion


@pytest.fixture(autouse=True)
def _reset():
    brain._reset_for_tests()


def chat(client, text, sid=None, lang="th"):
    r = client.post("/api/chat", json={"text": text, "session_id": sid, "lang": lang}).json()
    return r, brain.recent(1)[0]


def prog(code):
    with SessionLocal() as db:
        p = db.query(Program).filter(Program.code == code).one()
        db.expunge(p)
        return p


# ------------------------------------------------------------------ แยกประเด็น (ฟังก์ชันล้วน)
@pytest.mark.parametrize("q,asp", [
    ("มีแผนกเทคโนโลยีคอมพิวเตอร์ไหม", pa.EXISTS), ("มีสาขาบัญชีมั้ยคะ", pa.EXISTS), ("เปิดสอนการตลาดไหมครับ", pa.EXISTS),
    ("does the college have accounting?", pa.EXISTS),
    ("เรียนเกี่ยวกับอะไรบ้าง", pa.LEARN), ("ช่างยนต์เรียนอะไร", pa.LEARN), ("สาขานี้เรียนวิชาอะไร", pa.LEARN),
    ("สาขานี้เหมาะกับใคร", pa.SUITS), ("ชอบคอมพิวเตอร์ควรเรียนสาขาไหน", pa.RECOMMEND),
    ("คอมเรียนกี่ปี", pa.OTHER), ("ค่าเทอมสาขาคอมเท่าไหร่", pa.OTHER), ("สาขาไอทียากไหม", pa.OTHER), ("มีทุนไหม", pa.OTHER),
    ("เมคคาทรอนิกส์คืออะไร", pa.OVERVIEW), ("เทคโนโลยีคอมพิวเตอร์", pa.OVERVIEW),
])
def test_aspect(q, asp):
    assert pa.aspect(q, "program_detail") == asp


def test_career_intent_wins():
    assert pa.aspect("จบแล้วทำงานอะไร", "career") == pa.CAREER


class P:
    name_th, name_en, level = "เทคโนโลยีคอมพิวเตอร์", "Computer Technology", ""
    description_th, description_en = "ฮาร์ดแวร์ ระบบปฏิบัติการ เครือข่าย และดูแลระบบ", "Hardware, operating systems and networks."
    careers_th, careers_en = "ช่างคอมพิวเตอร์ ช่างเทคนิคเครือข่าย", "Computer technician."
    suits_th, suits_en = "เหมาะกับคนที่ชอบคอมพิวเตอร์", "People who like computers."


def test_each_aspect_gives_a_different_answer():
    outs = {a: pa.compose(P, a, "th") for a in (pa.EXISTS, pa.LEARN, pa.SUITS, pa.CAREER, pa.OVERVIEW, pa.RECOMMEND)}
    assert len(set(outs.values())) == len(outs)
    assert outs[pa.EXISTS].startswith("มีค่ะ")
    assert "เรียนเกี่ยวกับฮาร์ดแวร์" in outs[pa.LEARN]
    assert "เหมาะกับคนที่ชอบคอมพิวเตอร์" in outs[pa.SUITS]
    assert outs[pa.RECOMMEND].startswith("แนะนำสาขาเทคโนโลยีคอมพิวเตอร์")


def test_levels_only_from_data():
    assert "ปวช. และ ปวส." in pa.compose(P, pa.EXISTS, "th", ["ปวช.", "ปวส.", "ปวช."])
    assert "ระดับ" not in pa.compose(P, pa.EXISTS, "th", [""])          # ไม่มีข้อมูลระดับ → ไม่พูดถึง (ไม่เดา)


def test_empty_field_returns_empty_so_engine_searches_kb():
    class Q(P):
        suits_th = ""
    assert pa.compose(Q, pa.SUITS, "th") == "" and pa.compose(P, pa.OTHER, "th") == ""


def test_english():
    assert pa.compose(P, pa.EXISTS, "en").startswith("Yes, we offer Computer Technology")


# ------------------------------------------------------------------ ผ่าน engine จริง
def test_exists_question_says_yes(client):
    p = prog("ACC")
    r, t = chat(client, "มีสาขาการบัญชีไหม")
    assert r["text"].startswith("มีค่ะ") and p.name_th in r["text"] and "ปวช." in r["text"]
    assert t["program_answer"]["aspect"] == pa.EXISTS and r["answered"]


def test_followup_learn_is_not_same_sentence(client):
    r1, _ = chat(client, "มีสาขาการบัญชีไหม")
    r2, t = chat(client, "เรียนเกี่ยวกับอะไรบ้าง", r1["session_id"])
    assert r2["text"] != r1["text"] and "การบัญชี" in r2["text"]
    assert t["program_answer"] == {**t["program_answer"], "aspect": pa.LEARN, "from_context": True}
    assert t["program"] == "การบัญชี"


def test_specific_question_without_data_is_honest_and_logged(client):
    r1, _ = chat(client, "สาขาการบัญชีเรียนอะไร")
    r, t = chat(client, "การบัญชีต้องเรียนกี่ปีคะ", r1["session_id"])
    assert "ยังไม่มีข้อมูล" in r["text"] and "การบัญชี" in r["text"] and not r["answered"]
    assert t["program_answer"]["aspect"] == pa.OTHER
    with SessionLocal() as db:
        assert db.query(UnansweredQuestion).filter(UnansweredQuestion.text.contains("กี่ปี")).count() >= 1


def test_switch_off_restores_old_behaviour(client, monkeypatch):
    monkeypatch.setattr(settings, "program_smart", False)
    p = prog("ACC")
    r, t = chat(client, "มีสาขาการบัญชีไหม")
    assert r["text"].startswith(f"สาขา{p.name_th}") and t.get("program_answer") is None


def test_chat_json_keys_unchanged(client):
    r, _ = chat(client, "มีสาขาการบัญชีไหม")
    assert set(r) == {"session_id", "message_id", "text", "lang", "intent", "intent_raw", "confidence", "intent_top", "answered",
                      "retrieval_score", "sources", "media", "gesture", "emotion", "robot_action", "suggestions", "provider", "latency_ms"}
