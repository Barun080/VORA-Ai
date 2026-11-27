"""Phase 6 · Gate 6E-3 — Privacy Boundary (ผู้ให้บริการจำลองด้วย httpx MockTransport · ไม่ใช้อินเทอร์เน็ต)

P-1 ชื่อเรื่อง FAQ ที่มาจากคำถามที่ตอบไม่ได้ (มีข้อมูลส่วนบุคคล) → ผู้ให้บริการไม่เห็นข้อมูลส่วนบุคคลนั้น
P-2 ข้อมูลติดต่อทางการของวิทยาลัยในคำตอบ/CONTEXT ยังส่งครบ (ไม่ถูกกรองเพียงเพราะเป็นเบอร์/อีเมล)
P-3 คีย์ / bearer token / ค่าที่คล้ายคีย์ในข้อความผู้ใช้ → ไม่ออกไปยังผู้ให้บริการ (payload ขาออกถูกปิดบัง)
P-4 pipeline exception → system_events / log ไม่มีคำถามดิบ
P-5 ไม่มี session id / IP / ข้อมูลบัญชีเจ้าหน้าที่ใน payload ขาออก
"""
import json
import logging

import httpx
import pytest

import app.ai.engine as engine
import app.routers.public as public
from app.ai.llm import CircuitBreaker, llm
from app.ai.retriever import retriever
from app.config import settings
from app.db import SessionLocal
from app.models import KnowledgeItem, SystemEvent, UnansweredQuestion
from app.ai.text import normalize

KEY = "VORA-SENTINEL-KEY-boundary-7e31"
OFFICIAL_PHONE = "02-555-0177"
OFFICIAL_EMAIL = "registrar@demo-college.ac.th"
USER_PHONE, USER_EMAIL, USER_ID = "0898765432", "nattaya.p@example.com", "1209900123456"
UQ = f"ขอใบรับรองการฝึกงานต้องทำอย่างไร ติดต่อกลับ {USER_PHONE} อีเมล {USER_EMAIL} เลขบัตร {USER_ID}"
ASK = "ขอใบรับรองการฝึกงานต้องทำอย่างไร"


class Fake:
    def __init__(self):
        self.requests = []

    def __call__(self, req):
        self.requests.append(req)
        return httpx.Response(200, json={"choices": [{"message": {"content": f"ติดต่องานทะเบียนที่ {OFFICIAL_PHONE} ค่ะ"},
                                                       "finish_reason": "stop"}]})

    def bodies(self):
        return [r.content.decode("utf-8") for r in self.requests]


@pytest.fixture
def chain(monkeypatch):
    monkeypatch.setattr(llm, "breaker", CircuitBreaker())
    monkeypatch.setattr(llm, "fallback_breaker", CircuitBreaker())
    fake = Fake()
    monkeypatch.setattr(settings, "llm_provider", "openai")
    monkeypatch.setattr(settings, "llm_api_key", KEY)
    monkeypatch.setattr(settings, "llm_model", "")
    monkeypatch.setattr(settings, "llm_base_url", "")
    monkeypatch.setattr(settings, "llm_fallback_provider", "")
    monkeypatch.setattr(settings, "ai_budget_s", 0.0)
    monkeypatch.setattr(llm, "_transport", httpx.MockTransport(fake))
    engine._llm_cache.clear()
    yield fake
    engine._llm_cache.clear()


@pytest.fixture(scope="module")
def unanswered_kb(client, editor_headers):
    """คำถามที่ตอบไม่ได้ (มี PII ของผู้ใช้) → เจ้าหน้าที่แก้เป็นความรู้ใหม่ผ่าน API จริง (flow การอนุมัติเดิม ไม่เปลี่ยน)"""
    db = SessionLocal()
    u = UnansweredQuestion(text=UQ, normalized=normalize(UQ), lang="th", best_score=0.0)
    db.add(u)
    db.commit()
    uid = u.id
    db.close()
    r = client.post(f"/api/admin/unanswered/{uid}/resolve", headers=editor_headers,
                    json={"action": "knowledge", "category": "admission",
                          "answer_th": f"ขอใบรับรองการฝึกงานได้ที่งานทะเบียน โทร {OFFICIAL_PHONE} อีเมล {OFFICIAL_EMAIL}"})
    assert r.status_code == 200
    db = SessionLocal()
    kb = db.query(KnowledgeItem).filter(KnowledgeItem.source == "unanswered", KnowledgeItem.question == UQ).one()
    if kb.status != "approved":                   # ผู้ใช้ staff อาจต้องรออนุมัติ — อนุมัติในฐานข้อมูลทดสอบเพื่อให้ค้นคืนได้
        kb.status = "approved"
        db.commit()
    kid = kb.id
    db.close()
    retriever.mark_dirty()
    yield kid


def ask(client, text, **extra):
    r = client.post("/api/chat", json={"text": text, "lang": "th", "channel": "kiosk", **extra})
    assert r.status_code == 200
    return r.json()


def context_part(b: str) -> str:
    return b.split("คำถามของผู้ใช้:", 1)[0]


# ---------------------------------------------------------------- P-1 / P-2
def test_p1_unanswered_title_pii_not_sent_to_provider(client, chain, unanswered_kb):
    r = ask(client, ASK)
    assert chain.requests, "ต้องผ่านเส้นทางเรียบเรียงด้วย LLM"
    blob = "\n".join(chain.bodies())
    for raw in (USER_PHONE, USER_EMAIL, USER_ID):
        assert raw not in blob, raw
    assert "[เบอร์โทร]" in blob and "[อีเมล]" in blob
    assert r["answered"] is True


def test_p2_official_contact_in_context_kept(client, chain, unanswered_kb):
    ask(client, ASK + " ที่ไหน")
    ctx = context_part(json.loads(chain.requests[-1].content)["messages"][1]["content"])
    assert OFFICIAL_PHONE in ctx and OFFICIAL_EMAIL in ctx


def test_p2_title_redaction_only_for_faq(unanswered_kb):
    """ชื่อเรื่องของสาขา/ข่าว (ข้อมูลทางการ) ไม่ผ่านตัวกรอง · FAQ ผ่าน · คำตอบไม่ผ่านตัวกรอง"""
    from app.ai.retriever import Doc, Hit
    faq = Hit(doc=Doc(key="kb:x", type="faq", ref_id=1, category="c", title=UQ, match_text="", content="",
                      answer_th=f"โทร {OFFICIAL_PHONE}", answer_en=""), score=1.0, detail={})
    news = Hit(doc=Doc(key="news:x", type="news", ref_id=2, category="c", title=f"สายด่วน {OFFICIAL_PHONE}", match_text="",
                       content="", answer_th="x", answer_en=""), score=1.0, detail={})
    faq_item, news_item = engine._context_items([faq, news])
    assert USER_PHONE not in faq_item and OFFICIAL_PHONE in faq_item
    assert OFFICIAL_PHONE in news_item


def test_p2_db_record_and_approval_flow_unchanged(unanswered_kb):
    """ข้อมูลในฐานข้อมูลไม่ถูกแก้ (การกรองเกิดเฉพาะตอนส่งออกไปผู้ให้บริการ)"""
    db = SessionLocal()
    try:
        kb = db.get(KnowledgeItem, unanswered_kb)
        assert kb.question == UQ and kb.source == "unanswered"
    finally:
        db.close()


# ---------------------------------------------------------------- P-3 secrets ขาออก
SECRETS = [KEY, "sk-ant-api03-ZZZZzzzz1111222233334444", "AIzaSyD-ExampleExampleExample12345", "Bearer abcDEF123456ghi"]


@pytest.mark.parametrize("secret", SECRETS)
def test_p3_secret_in_user_input_is_not_sent(client, chain, secret):
    ask(client, f"สมัครเรียนยังไง {secret}")
    assert chain.requests
    blob = "\n".join(chain.bodies())
    token = secret.split(" ", 1)[-1]
    assert token not in blob, secret
    assert "[REDACTED]" in blob


def test_p3_outbound_redaction_keeps_ordinary_text(client, chain):
    ask(client, "สมัครเรียนยังไง ต้องใช้เอกสารอะไรบ้าง")
    user = json.loads(chain.requests[-1].content)["messages"][1]["content"]
    assert "ต้องใช้เอกสารอะไรบ้าง" in user and "[REDACTED]" not in user


# ---------------------------------------------------------------- P-4 pipeline exception
def test_p4_pipeline_exception_does_not_log_raw_question(client, monkeypatch, caplog):
    marker = f"คำถามลับ-{USER_PHONE}-ทดสอบ"

    async def boom(*a, **k):
        raise RuntimeError("pipeline down")
    monkeypatch.setattr(public, "answer", boom)
    db = SessionLocal()
    before = db.query(SystemEvent).count()
    db.close()
    with caplog.at_level(logging.DEBUG):
        r = client.post("/api/chat", json={"text": marker, "lang": "th", "channel": "kiosk"})
    assert r.status_code == 200 and r.json()["provider"] == "error"
    db = SessionLocal()
    try:
        rows = db.query(SystemEvent).order_by(SystemEvent.id).all()[before:]
    finally:
        db.close()
    assert rows, "ต้องมีเหตุการณ์ pipeline error"
    for e in rows:
        blob = e.message + json.dumps(e.data, ensure_ascii=False)
        assert marker not in blob and USER_PHONE not in blob
    ev = next(e for e in rows if "answer pipeline error" in e.message)
    assert ev.data.get("text_len") == len(marker) and len(ev.data.get("text_sha256", "")) == 16 and "text" not in ev.data
    assert marker not in caplog.text


# ---------------------------------------------------------------- P-5 ไม่มีข้อมูลการเชื่อมต่อ/บัญชีใน payload
def test_p5_no_session_ip_or_staff_data_in_payload(client, chain, admin_headers):
    sid = "SESSION-PRIVACY-6E3"
    ask(client, "สมัครเรียนยังไง", session_id=sid)
    blob = "\n".join(chain.bodies())
    for bad in (sid, "testclient", "127.0.0.1", "admin", "vora1234", "staff1234", admin_headers["Authorization"][7:]):
        assert bad not in blob, bad
