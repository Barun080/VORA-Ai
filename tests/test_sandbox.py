"""กล่องตรวจข้อมูล (Sandbox) — 24 พ.ย. 2569 · app/routers/sandbox.py
รายการใน sandbox ไม่ถูกใช้ตอบจนกว่าเจ้าหน้าที่จะอนุมัติ · อนุมัติแล้วตอบได้ทันที · ย้อนกลับได้"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.config import settings
from app.db import SessionLocal
from app.models import AuditLog, KnowledgeCandidate, KnowledgeItem

ROOT = Path(__file__).resolve().parents[2]


def make(**kw):
    base = dict(batch="t-sb", ref=kw.pop("ref"), category="general", question="", alt_questions="", answer_th="", choices=[],
                sources=[{"title": "ต้นฉบับ", "url": "https://example.test/a"}], evidence="U", reason="แหล่งขัดกัน")
    base.update(kw)
    with SessionLocal() as db:
        c = KnowledgeCandidate(**base)
        db.add(c)
        db.commit()
        return c.id


def ask(client, text):
    return client.post("/api/chat", json={"text": text, "session_id": None, "lang": "th"}).json()


def test_pending_candidate_is_not_used_to_answer(client, admin_headers):
    make(ref="P1", question="ห้องเรียนลับสุดยอดอยู่ไหนนะ", answer_th="อยู่อาคารซีเคร็ตชั้น 9")
    client.post("/api/admin/knowledge/rebuild", headers=admin_headers)
    r = ask(client, "ห้องเรียนลับสุดยอดอยู่ไหนนะ")
    assert "ซีเคร็ต" not in (r.get("text") or "")


def test_list_and_status(client, admin_headers, editor_headers):
    make(ref="L1", question="คำถามรายการ", answer_th="คำตอบ")
    r = client.get("/api/admin/sandbox", headers=editor_headers).json()
    assert any(x["ref"] == "L1" for x in r["items"]) and r["counts"].get("pending", 0) >= 1
    s = client.get("/api/admin/sandbox/status", headers=editor_headers).json()
    assert s["enabled"] and s["pending"] >= 1


def test_choice_approve_creates_knowledge_and_answers(client, admin_headers):
    cid = make(ref="C1", category="contact", question="หัวหน้าแผนกทดสอบสมมุติคือใคร", answer_th="ชื่อ ก",
               choices=[{"label": "หน้าเว็บ", "answer_th": "หัวหน้าแผนกทดสอบสมมุติคือ นายกอไก่ ค่ะ"},
                        {"label": "ตาราง", "answer_th": "หัวหน้าแผนกทดสอบสมมุติคือ นายขอไข่ ค่ะ"}])
    r = client.post(f"/api/admin/sandbox/{cid}/approve", json={"choice": 1, "note": "ตามคำสั่ง"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    kid = r.json()["knowledge_id"]
    with SessionLocal() as db:
        k = db.get(KnowledgeItem, kid)
        c = db.get(KnowledgeCandidate, cid)
        assert k.status == "approved" and k.source == "sandbox" and "ขอไข่" in k.answer_th
        assert c.status == "approved" and c.knowledge_id == kid and c.review_note == "ตามคำสั่ง"
        assert db.query(AuditLog).filter(AuditLog.entity == "sandbox", AuditLog.entity_id == str(cid)).count() >= 1
    client.post("/api/admin/knowledge/rebuild", headers=admin_headers)
    assert "ขอไข่" in ask(client, "หัวหน้าแผนกทดสอบสมมุติคือใคร")["text"]
    assert client.post(f"/api/admin/sandbox/{cid}/approve", json={}, headers=admin_headers).status_code == 409


def test_edited_approve_uses_staff_text(client, admin_headers):
    cid = make(ref="E1", question="อาคารทดสอบอยู่ไหน", answer_th="ตามข้อมูลปี 2564 อยู่อาคาร 1")
    r = client.post(f"/api/admin/sandbox/{cid}/approve", json={"answer_th": "อยู่อาคาร 2 ค่ะ (ยืนยันแล้ว)"}, headers=admin_headers)
    with SessionLocal() as db:
        assert db.get(KnowledgeItem, r.json()["knowledge_id"]).answer_th == "อยู่อาคาร 2 ค่ะ (ยืนยันแล้ว)"


def test_reopen_turns_knowledge_back_to_draft(client, admin_headers):
    cid = make(ref="R1", question="คำถามย้อนกลับ", answer_th="คำตอบย้อนกลับ")
    kid = client.post(f"/api/admin/sandbox/{cid}/approve", json={}, headers=admin_headers).json()["knowledge_id"]
    assert client.post(f"/api/admin/sandbox/{cid}/reopen", headers=admin_headers).status_code == 200
    with SessionLocal() as db:
        assert db.get(KnowledgeItem, kid).status == "draft"
        c = db.get(KnowledgeCandidate, cid)
        assert c.status == "pending" and c.knowledge_id is None


def test_reject_and_permissions(client, admin_headers, editor_headers):
    cid = make(ref="J1", question="คำถามปฏิเสธ", answer_th="x")
    assert client.post(f"/api/admin/sandbox/{cid}/approve", json={}, headers=editor_headers).status_code == 403
    assert client.post(f"/api/admin/sandbox/{cid}/reject", json={"note": "เก่า"}, headers=admin_headers).status_code == 200
    with SessionLocal() as db:
        assert db.get(KnowledgeCandidate, cid).status == "rejected"
    bad = make(ref="J2", question="", answer_th="")
    assert client.post(f"/api/admin/sandbox/{bad}/approve", json={}, headers=admin_headers).status_code == 400
    assert client.post(f"/api/admin/sandbox/{bad}/approve", json={"choice": 3}, headers=admin_headers).status_code == 400


def test_switch_off_hides_api(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "sandbox", False)
    assert client.get("/api/admin/sandbox", headers=admin_headers).status_code == 404
    assert client.get("/api/admin/sandbox/status", headers=admin_headers).json()["enabled"] is False


def test_candidate_file_is_well_formed():
    d = json.loads((ROOT / "data/knowledge/vtcn/qa_20261123/sandbox_candidates_20261124.json").read_text(encoding="utf-8"))
    refs = [x["ref"] for x in d["items"]]
    assert d["batch"] and len(refs) == len(set(refs)) >= 40
    for x in d["items"]:
        assert x["question"] and x["answer_th"] and x["reason"] and x["sources"], x["ref"]
        assert x["evidence"] in "ABCU"
        assert all(s["url"].startswith("https://") for s in x["sources"]), x["ref"]
        assert all(c["answer_th"] for c in x["choices"]), x["ref"]
        if x["evidence"] == "U":
            assert len(x["choices"]) >= 2, x["ref"]                  # แหล่งขัดกัน = ต้องให้เลือก
        if x["data_year"] == "2564":
            assert "2564" in x["answer_th"]                          # ข้อมูลเก่าต้องบอกปีในคำตอบ
