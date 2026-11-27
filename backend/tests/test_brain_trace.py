"""งาน A "สมองโปร่งใส" (21 พ.ย. 2569) — ขั้นตอนการตัดสินใจของ AI แสดงในหลังบ้าน โดยไม่เปลี่ยนคำตอบ/JSON เดิม

ไม่ออกอินเทอร์เน็ต: ผู้ให้บริการ LLM จำลองด้วย monkeypatch
"""
import asyncio

import pytest

from app import brain, realtime
from app.ai import engine
from app.ai.llm import LLMError, llm
from app.config import settings
from app.db import SessionLocal

Q = "มีทุนการศึกษาไหม"


@pytest.fixture(autouse=True)
def _clean():
    brain._reset_for_tests()
    engine._llm_cache.clear()
    yield
    brain._reset_for_tests()
    engine._llm_cache.clear()


def _fake_llm(monkeypatch, out=None, exc=None):
    async def fake(*a, **k):
        if exc:
            raise exc
        return out
    monkeypatch.setattr(type(llm), "available", property(lambda self: True))
    monkeypatch.setattr(llm, "complete", fake)


def _ask(text, lang="th"):
    async def run():
        db = SessionLocal()
        try:
            return await engine.answer(db, text, None, lang, "kiosk", "text")
        finally:
            db.rollback()
            db.close()
    return asyncio.run(run())


# ------------------------------------------------------------------ สัญญา JSON เดิมไม่เปลี่ยน
def test_chat_json_has_no_trace_key(client):
    r = client.post("/api/chat", json={"text": Q}).json()
    assert "trace" not in r and "retrieval" not in r and "llm" not in r


def test_trace_is_attribute_with_all_stages():
    res = _ask(Q)
    t = res.trace
    assert "trace" not in res                                     # ไม่อยู่ในตัว dict
    for k in ("question", "intent", "route", "retrieval", "result", "answer", "net_mode"):
        assert k in t
    assert t["intent"]["raw"] == res["intent"] or t["intent"]["used"]
    assert t["retrieval"]["hits"] and t["retrieval"]["threshold"] == settings.retrieval_threshold
    assert t["result"]["answered"] == res["answered"] and t["result"]["provider"] == res["provider"]
    assert t["result"]["answer_source"] == res.contract["answer_source"]


def test_question_in_trace_is_pii_redacted():
    t = _ask("ทุนการศึกษา ติดต่อ 0812345678 ได้ไหม").trace
    assert "0812345678" not in t["question"]


def test_trace_has_no_system_prompt_or_canary(monkeypatch):
    _fake_llm(monkeypatch, out="มีทุนการศึกษาสำหรับนักเรียนค่ะ")
    t = _ask(Q).trace
    blob = str(t)
    assert engine.CANARY not in blob and "CONTEXT" not in blob


# ------------------------------------------------------------------ ขั้น AI เรียบเรียง + Answer Guard
def test_llm_error_is_shown_and_answer_falls_back(monkeypatch):
    _fake_llm(monkeypatch, exc=LLMError("down"))
    res = _ask(Q)
    assert res["provider"] == "knowledge-base"
    assert res.trace["llm"]["result"] == "error" and res.trace["llm"]["error"] == "LLMError"


def test_no_info_is_shown(monkeypatch):
    _fake_llm(monkeypatch, out="NO_INFO")
    assert _ask(Q).trace["llm"]["result"] == "no_info"


def test_guard_reject_codes_are_shown(monkeypatch):
    _fake_llm(monkeypatch, out="ทุนการศึกษามีมูลค่า 987,654 บาท ติดต่อ 02-999-9999 ค่ะ")
    res = _ask(Q)
    g = res.trace["llm"]["guard"]
    assert res.trace["llm"]["result"] == "guard_reject" and g["ran"] and not g["ok"] and g["codes"]
    assert "987,654" not in res["text"]                           # คำตอบที่ถูกปฏิเสธไม่ถึงผู้ใช้ (พฤติกรรมเดิม)


def test_cache_hit_is_marked(monkeypatch):
    _fake_llm(monkeypatch, out="มีทุนการศึกษาค่ะ")
    first = _ask(Q).trace["llm"]
    second = _ask(Q).trace["llm"]
    if first["result"] == "composed":                             # เก็บแคชเฉพาะคำตอบที่ผ่าน Guard
        assert second["cache"] is True and first["cache"] is False


def test_concurrent_questions_do_not_mix_traces():
    async def run():
        async def one(t):
            db = SessionLocal()
            try:
                return await engine.answer(db, t, None, "th", "kiosk", "text")
            finally:
                db.rollback()
                db.close()
        return await asyncio.gather(one("มีทุนการศึกษาไหม"), one("สมัครเรียนยังไง"), one("มีสาขาอะไรบ้าง"))
    a, b, c = asyncio.run(run())
    assert a.trace["question"] == "มีทุนการศึกษาไหม" and b.trace["question"] == "สมัครเรียนยังไง"
    assert c.trace["question"] == "มีสาขาอะไรบ้าง"


def test_no_collector_outside_answer_is_harmless():
    engine._trace_set(x=1)                                        # นอก answer() → ไม่มีผลอะไร
    assert engine._TRACE.get() is None


# ------------------------------------------------------------------ ส่งให้หลังบ้าน + สวิตช์
def test_admin_recent_requires_login(client):
    assert client.get("/api/admin/brain/recent").status_code == 401


def test_chat_publishes_to_admin_only(client, admin_headers, monkeypatch):
    sent = []
    real = realtime.hub.broadcast

    async def spy(topic, data, roles=None):
        sent.append((topic, roles))
        return await real(topic, data, roles=roles)
    monkeypatch.setattr(realtime.hub, "broadcast", spy)
    client.post("/api/chat", json={"text": Q})
    assert ("ai.trace", ("admin",)) in sent
    r = client.get("/api/admin/brain/recent", headers=admin_headers).json()
    assert r["enabled"] and r["items"][0]["question"] == Q and len(r["guard_checks"]) == 9


def test_recent_newest_first_and_capped(client, admin_headers):
    for t in ("สมัครเรียนยังไง", Q):
        client.post("/api/chat", json={"text": t})
    items = client.get("/api/admin/brain/recent?n=2", headers=admin_headers).json()["items"]
    assert [i["question"] for i in items] == [Q, "สมัครเรียนยังไง"]
    for _ in range(brain._recent.maxlen + 5):
        brain.record({"question": "x"})
    assert len(brain._recent) == brain._recent.maxlen


def test_switch_off_stops_recording_but_chat_unchanged(client, admin_headers, monkeypatch):
    on = client.post("/api/chat", json={"text": Q}).json()
    brain._reset_for_tests()
    monkeypatch.setattr(settings, "brain_trace", False)
    off = client.post("/api/chat", json={"text": Q}).json()
    assert set(on) == set(off) and on["text"] == off["text"]
    r = client.get("/api/admin/brain/recent", headers=admin_headers).json()
    assert r["enabled"] is False and r["items"] == []


def test_publish_errors_never_break_chat(client, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("ws down")
    monkeypatch.setattr(realtime.hub, "broadcast", boom)
    # chat.message broadcast เดิมก็ใช้ hub — ทดสอบเฉพาะ brain.publish ว่าไม่ยกข้อผิดพลาดออก
    asyncio.run(brain.publish({"question": "x"}))
    assert brain.recent(1)[0]["question"] == "x"
