"""Phase 6 · Gate 6C — engine.py (อนุมัติเฉพาะ 2 รายการ, 1 พ.ย. 2569 22:28)

A. Privacy: ตัดข้อมูลส่วนบุคคลเฉพาะ "คำถามของผู้ใช้" ก่อนส่งผู้ให้บริการ — CONTEXT (ฐานความรู้ที่อนุมัติ/ข้อมูลติดต่อทางการ) ต้องคงเดิม
   และข้อมูลส่วนบุคคลดิบต้องไม่ไปอยู่ใน log / system_events / ข้อความผิดพลาด
B. Cached Provider Attribution: คำตอบจากแคชต้องระบุผู้ให้บริการที่ตอบไว้จริง (เช่น fallback) · รูปแบบ /api/chat เดิม
+ ตรวจ /api/kiosk/config: รูปแบบเดิม (มี ai.last_error) แต่ค่าไม่มีคีย์/credential
"""
import json
import logging
import time

import httpx
import pytest

import app.ai.engine as engine
from app.ai.llm import CircuitBreaker, llm
from app.ai.retriever import retriever
from app.config import settings
from app.db import SessionLocal
from app.models import KnowledgeItem, SystemEvent

OFFICIAL_PHONE = "02-555-0199"
OFFICIAL_EMAIL = "pr@demo-college.ac.th"
OFFICIAL_LINE = "@democollege"
USER_PII = {"phone": "0812345678", "phone2": "089-765-4321", "email": "somchai.k@example.com",
            "id": "1103700012345", "line": "somchai_99"}
QUESTION = "ช่องทางติดต่องานประชาสัมพันธ์วิทยาลัยมีอะไรบ้าง"
KEY = "VORA-SENTINEL-KEY-engine-4d2c"


def ok_body(provider: str, text: str) -> dict:
    if provider == "gemini":
        return {"candidates": [{"content": {"parts": [{"text": text}]}}]}
    return {"choices": [{"message": {"content": text}}]}


class Fake:
    def __init__(self, **behaviour):
        self.behaviour, self.requests = behaviour, []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        p = "gemini" if "googleapis" in req.url.host else "openai" if "openai" in req.url.host else "ollama"
        b = self.behaviour.get(p, "ok")
        if isinstance(b, int):
            return httpx.Response(b, json={"error": "x"})
        return httpx.Response(200, json=ok_body(p, b if isinstance(b, str) and b != "ok" else f"ติดต่อได้ที่ {OFFICIAL_PHONE} ค่ะ ({p})"))

    def bodies(self) -> list[str]:
        return [r.content.decode("utf-8") for r in self.requests]

    def count(self, host_part: str) -> int:
        return sum(1 for r in self.requests if host_part in r.url.host)


@pytest.fixture(scope="module")
def official_kb():
    """ความรู้ที่อนุมัติแล้วซึ่งมีข้อมูลติดต่อทางการ (ต้องไม่ถูกกรอง)"""
    db = SessionLocal()
    kb = KnowledgeItem(kind="faq", category="contact", question=QUESTION,
                       alt_questions="ติดต่อวิทยาลัยยังไง|เบอร์โทรประชาสัมพันธ์|อีเมลวิทยาลัย",
                       answer_th=f"ติดต่องานประชาสัมพันธ์ โทร {OFFICIAL_PHONE} อีเมล {OFFICIAL_EMAIL} LINE {OFFICIAL_LINE}",
                       answer_en=f"PR office: phone {OFFICIAL_PHONE}, email {OFFICIAL_EMAIL}", status="approved", source="manual")
    db.add(kb)
    db.commit()
    kid = kb.id
    db.close()
    retriever.mark_dirty()
    yield kid


@pytest.fixture
def chain(monkeypatch):
    # 25 พ.ย. 2569: ไฟล์นี้ทดสอบเส้นทาง "AI เรียบเรียงจากฐานความรู้" (กรอง PII/แคช) → ปิด VORA_FAQ_FULL
    # (เปิดอยู่ คำถามที่ตรง FAQ ที่อนุมัติจะอ่านคำตอบตรง ๆ ไม่ส่งอะไรออกนอกเครื่อง)
    monkeypatch.setattr(settings, "faq_full", False)
    monkeypatch.setattr(llm, "breaker", CircuitBreaker())
    monkeypatch.setattr(llm, "fallback_breaker", CircuitBreaker())

    def setup(primary="openai", fallback="", fake=None):
        monkeypatch.setattr(settings, "llm_provider", primary)
        monkeypatch.setattr(settings, "llm_api_key", KEY if primary != "ollama" else "")
        monkeypatch.setattr(settings, "llm_model", "")
        monkeypatch.setattr(settings, "llm_base_url", "")
        monkeypatch.setattr(settings, "llm_fallback_provider", fallback)
        monkeypatch.setattr(settings, "llm_fallback_api_key", "")
        monkeypatch.setattr(settings, "llm_fallback_base_url", "")
        monkeypatch.setattr(settings, "ai_budget_s", 0.0)
        monkeypatch.setattr(llm, "_transport", httpx.MockTransport(fake))
        engine._llm_cache.clear()
        return fake

    yield setup
    engine._llm_cache.clear()


def ask(client, text, sid=None):
    body = {"text": text, "lang": "th"}
    if sid:
        body["session_id"] = sid
    r = client.post("/api/chat", json=body)
    assert r.status_code == 200
    return r.json()


def user_part(body: str) -> str:
    return body.split("คำถามของผู้ใช้:", 1)[1]


def context_part(body: str) -> str:
    return body.split("คำถามของผู้ใช้:", 1)[0]


# ---------------------------------------------------------------- A. Privacy
def test_a1_question_pii_removed_before_provider(client, chain, official_kb):
    fake = chain("openai", fake=Fake())
    q = (f"{QUESTION} ถ้าไม่สะดวกโทรกลับเบอร์ฉัน {USER_PII['phone']} หรือ {USER_PII['phone2']} "
         f"อีเมล {USER_PII['email']} เลขบัตร {USER_PII['id']} ไลน์ไอดี: {USER_PII['line']}")
    r = ask(client, q)
    assert r["provider"] == "llm:openai", r
    body = fake.bodies()[-1]
    raw = json.loads(body)["messages"][1]["content"]
    for v in USER_PII.values():
        assert v not in body, v                                 # ไม่มีข้อมูลส่วนบุคคลดิบในคำขอ (URL/header/body)
    up = user_part(raw)
    for tag in ("[เบอร์โทร]", "[อีเมล]", "[เลขบัตรประชาชน]", "[LINE ID]"):
        assert tag in up, tag
    assert "ช่องทางติดต่องานประชาสัมพันธ์วิทยาลัย" in up        # เนื้อคำถามที่ไม่ใช่ PII คงอยู่


def test_a2_official_contact_in_context_not_filtered(client, chain, official_kb):
    fake = chain("openai", fake=Fake())
    ask(client, f"{QUESTION} เบอร์ฉัน {USER_PII['phone']}")
    raw = json.loads(fake.bodies()[-1])["messages"][1]["content"]
    ctx = context_part(raw)
    assert OFFICIAL_PHONE in ctx and OFFICIAL_EMAIL in ctx and OFFICIAL_LINE in ctx   # ข้อมูลติดต่อทางการไม่ถูกกรอง
    assert "[เบอร์โทร]" not in ctx and "[อีเมล]" not in ctx and "[LINE ID]" not in ctx
    sys_prompt = json.loads(fake.bodies()[-1])["messages"][0]["content"]
    assert settings.llm_provider and "[" not in sys_prompt.split("หุ่นยนต์ประชาสัมพันธ์ของ", 1)[1][:60]   # ชื่อวิทยาลัยไม่ถูกแตะ


def test_a3_question_without_pii_sent_unchanged(client, chain, official_kb):
    fake = chain("openai", fake=Fake())
    ask(client, QUESTION)
    up = user_part(json.loads(fake.bodies()[-1])["messages"][1]["content"]).strip()
    assert up == QUESTION


def test_a4_no_raw_pii_in_log_events_or_errors(client, chain, official_kb, caplog):
    chain("openai", "ollama", fake=Fake(openai=500, ollama=503))
    db = SessionLocal()
    n = db.query(SystemEvent).count()
    db.close()
    with caplog.at_level(logging.DEBUG):
        r = ask(client, f"{QUESTION} เบอร์ฉัน {USER_PII['phone']} อีเมล {USER_PII['email']} เลขบัตร {USER_PII['id']}")
        time.sleep(1.0)                                         # event เขียนในเธรดแยก
    assert r["provider"] == "knowledge-base"
    db = SessionLocal()
    events = [f"{e.message} {json.dumps(e.data, ensure_ascii=False)}" for e in db.query(SystemEvent).order_by(SystemEvent.id).all()[n:]]
    db.close()
    assert events, "ต้องมี event ผู้ให้บริการล้ม"
    blob = "\n".join(events) + "\n".join(r.getMessage() for r in caplog.records) + llm.last_error + json.dumps(llm.status(), ensure_ascii=False)
    for v in (USER_PII["phone"], USER_PII["email"], USER_PII["id"], KEY):
        assert v not in blob, v


# ---------------------------------------------------------------- B. Cached Provider Attribution
def test_b1_cache_hit_keeps_fallback_attribution(client, chain, official_kb):
    fake = chain("openai", "ollama", fake=Fake(openai=500, ollama="ok"))
    first = ask(client, QUESTION)
    assert first["provider"] == "llm:ollama"
    n = len(fake.requests)
    second = ask(client, QUESTION)                               # คำขอใหม่ (context ใหม่) — ตอบจากแคช
    assert len(fake.requests) == n, "ต้องตอบจากแคช ไม่เรียกผู้ให้บริการซ้ำ"
    assert second["provider"] == "llm:ollama" and second["text"] == first["text"]


def test_b2_cache_hit_keeps_primary_attribution_even_if_primary_now_down(client, chain, official_kb):
    fake = chain("openai", "ollama", fake=Fake(openai="ok", ollama="ok"))
    first = ask(client, QUESTION)
    assert first["provider"] == "llm:openai"
    fake.behaviour["openai"] = 500                              # ภายหลังผู้ให้บริการหลักล่ม
    second = ask(client, QUESTION)
    assert second["provider"] == "llm:openai" and second["text"] == first["text"]


def test_b3_cached_no_info_stays_unanswered(client, chain, official_kb):
    fake = chain("openai", fake=Fake(openai="NO_INFO"))
    a = ask(client, QUESTION)
    n = len(fake.requests)
    b = ask(client, QUESTION)
    assert a["answered"] is False and b["answered"] is False and len(fake.requests) == n


def test_b4_chat_response_contract_unchanged(client, chain, official_kb):
    chain("openai", "ollama", fake=Fake(openai=500, ollama="ok"))
    ask(client, QUESTION)
    r = ask(client, QUESTION)
    for k in ("session_id", "message_id", "text", "lang", "intent", "intent_raw", "confidence", "intent_top", "answered",
              "retrieval_score", "sources", "media", "gesture", "emotion", "robot_action", "suggestions", "provider", "latency_ms"):
        assert k in r, k
    assert isinstance(r["provider"], str) and isinstance(r["text"], str)


def test_b5_cache_value_shape(chain, official_kb, client):
    chain("openai", fake=Fake())
    ask(client, QUESTION)
    assert engine._llm_cache and all(isinstance(v, tuple) and len(v) == 2 for v in engine._llm_cache.values())


# ---------------------------------------------------------------- /api/kiosk/config: รูปแบบเดิม + ไม่มีข้อมูลลับ
def test_kiosk_config_contract_kept_and_secret_free(client, chain, official_kb):
    chain("gemini", fake=Fake(gemini=403))
    ask(client, QUESTION)
    cfg = client.get("/api/kiosk/config").json()
    assert set(cfg["ai"]) == {"provider", "model", "enabled", "circuit_open", "last_latency_ms", "last_error", "calls", "errors"}
    assert cfg["ai"]["last_error"]                              # ฟิลด์เดิมยังส่งออก (ไม่เปลี่ยน contract)
    blob = json.dumps(cfg, ensure_ascii=False)
    assert KEY not in blob and "key=" not in blob.lower()
