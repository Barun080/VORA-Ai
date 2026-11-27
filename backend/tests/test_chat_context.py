"""คำถาม "สาขานี้…" ต้องหมายถึงสาขาที่หน้าจอกำลังแสดง (context_program_id) ไม่ใช่สาขาที่เคยคุยไว้ก่อนหน้า
พบจากการใช้งานจริง: เส้นทางการสมัครแสดงเมคคาทรอนิกส์ แต่ AI ตอบเรื่องช่างยนต์จากบริบทเดิมของบทสนทนา"""
from app.db import SessionLocal
from app.models import Program


def _ids():
    with SessionLocal() as db:
        progs = {p.code: p for p in db.query(Program).filter(Program.status == "published").all()}
    return progs["AUTO"], progs["MECHA"]


def _ask(client, text, sid=None, ctx=None):
    body = {"text": text, "session_id": sid, "lang": "th"}
    if ctx is not None:
        body["context_program_id"] = ctx
    r = client.post("/api/chat", json=body)
    assert r.status_code == 200
    return r.json()


def test_screen_context_overrides_stale_conversation_program(client):
    auto, mecha = _ids()
    r = _ask(client, "ช่างยนต์เรียนอะไร")
    assert auto.name_th in r["text"]
    sid = r["session_id"]
    r = _ask(client, "สาขานี้เรียนอะไร", sid, mecha.id)
    assert mecha.name_th in r["text"] and auto.name_th not in r["text"]
    r = _ask(client, "จบแล้วทำงานอะไร", sid, mecha.id)
    assert mecha.name_th in r["text"] and mecha.careers_th[:15] in r["text"]


def test_without_context_behaviour_is_unchanged(client):
    auto, _ = _ids()
    sid = _ask(client, "ช่างยนต์เรียนอะไร")["session_id"]
    r = _ask(client, "สาขานี้เรียนอะไร", sid)
    assert auto.name_th in r["text"]


def test_program_named_in_question_wins_over_screen_context(client):
    auto, mecha = _ids()
    r = _ask(client, "ช่างยนต์เรียนอะไร", None, mecha.id)
    assert auto.name_th in r["text"]


def test_new_session_uses_screen_context(client):
    _, mecha = _ids()
    r = _ask(client, "สาขานี้เรียนอะไร", None, mecha.id)
    assert mecha.name_th in r["text"] and r["session_id"]


def test_unknown_or_unpublished_context_is_ignored(client):
    with SessionLocal() as db:
        p = Program(code="TEST-CTX-DRAFT", level="ปวช.", department="ทดสอบ", name_th="สาขาฉบับร่างบริบท", description_th="x", status="draft")
        db.add(p); db.commit(); pid = p.id
    try:
        for bad in (999999, pid):
            r = _ask(client, "สาขานี้เรียนอะไร", None, bad)
            assert "ฉบับร่างบริบท" not in r["text"]
    finally:
        with SessionLocal() as db:
            db.query(Program).filter(Program.id == pid).delete(); db.commit()
