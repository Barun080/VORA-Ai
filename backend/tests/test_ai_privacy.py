"""Phase 6 · Gate 6C — Security Blocker S1 + Privacy (T-PRV) · ผู้ให้บริการจำลอง ไม่ใช้อินเทอร์เน็ต

S1: คีย์ Gemini เคยอยู่ใน URL (?key=) → ข้อความผิดพลาดของ httpx มีคีย์ → last_error → /api/kiosk/config (สาธารณะ) + system_events
ชุดนี้ใช้คีย์ sentinel แล้วตรวจทุกช่องทางว่าไม่มีคีย์หลุด
"""
import json
import logging
import re
import time

import httpx
import pytest
from sqlalchemy import inspect, text

import app.ai.engine as engine
from app.ai.llm import CircuitBreaker, LLMError, llm
from app.ai.privacy import MASK, redact_pii, redact_secrets
from app.config import settings
from app.db import SessionLocal, engine as db_engine
from app.models import SystemEvent

KEY = "VORA-SENTINEL-KEY-7f3a9c2e51"           # ไม่ตรงรูปแบบคีย์ที่รู้จัก → ต้องถูกปิดบังด้วยการเทียบค่าที่ตั้งไว้จริง
FKEY = "VORA-SENTINEL-FALLBACK-b8d04e"
GKEY = "AIzaSyVORA-SENTINEL-google-0123456789"   # รูปแบบคีย์ Google จริง
Q = "สมัครเรียนยังไง"


class Capture:
    def __init__(self, status=400):
        self.status = status
        self.requests: list[httpx.Request] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        if self.status == "offline":
            raise httpx.ConnectError(f"connect failed for {req.url}", request=req)
        return httpx.Response(self.status, json={"error": {"message": "bad request"}})


@pytest.fixture
def leaky(monkeypatch):
    """ตั้งค่าผู้ให้บริการให้ล้มด้วยคีย์ sentinel (Gemini เป็นหลัก — กรณีที่รั่วจริงใน S1)"""
    monkeypatch.setattr(llm, "breaker", CircuitBreaker())
    monkeypatch.setattr(llm, "fallback_breaker", CircuitBreaker())

    def setup(primary="gemini", key=KEY, fallback="", fkey="", status=400, base_url=""):
        monkeypatch.setattr(settings, "llm_provider", primary)
        monkeypatch.setattr(settings, "llm_api_key", key)
        monkeypatch.setattr(settings, "llm_model", "")
        monkeypatch.setattr(settings, "llm_base_url", base_url)
        monkeypatch.setattr(settings, "llm_fallback_provider", fallback)
        monkeypatch.setattr(settings, "llm_fallback_api_key", fkey)
        monkeypatch.setattr(settings, "llm_fallback_base_url", "")
        monkeypatch.setattr(settings, "ai_budget_s", 0.0)
        cap = Capture(status)
        monkeypatch.setattr(llm, "_transport", httpx.MockTransport(cap))
        engine._llm_cache.clear()
        return cap

    yield setup
    engine._llm_cache.clear()


def _wait_events(n_before: int, timeout=20.0) -> list[str]:
    """system_events ถูกเขียนในเธรดแยก — รอจนเขียนเสร็จ"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        db = SessionLocal()
        rows = db.query(SystemEvent).filter(SystemEvent.source == "ai").order_by(SystemEvent.id).all()
        out = [f"{r.message} {json.dumps(r.data, ensure_ascii=False)}" for r in rows]
        db.close()
        if len(out) > n_before:
            time.sleep(0.3)                                   # ให้เธรดที่เหลือของคำขอเดียวกันเขียนเสร็จ
            db = SessionLocal()
            rows = db.query(SystemEvent).filter(SystemEvent.source == "ai").order_by(SystemEvent.id).all()
            db.close()
            return [f"{r.message} {json.dumps(r.data, ensure_ascii=False)}" for r in rows][n_before:]   # เฉพาะ event ของการทดสอบนี้
        time.sleep(0.2)
    raise AssertionError("ไม่พบ system_events ใหม่ของ ai")


def _ai_event_count() -> int:
    db = SessionLocal()
    n = db.query(SystemEvent).filter(SystemEvent.source == "ai").count()
    db.close()
    return n


def _no_secret(blob: str, *secrets: str) -> None:
    for s in secrets:
        assert s not in blob, f"พบคีย์ใน: …{blob[max(0, blob.find(s) - 80): blob.find(s) + 40]}…"


# ---------------------------------------------------------------- หลักฐานว่า S1 มีจริงในรูปแบบเดิม
def test_s1_reproduced_old_pattern_would_leak():
    """ยืนยันกลไกที่ทำให้รั่ว: ข้อความผิดพลาดของ httpx มี URL เต็ม รวม query ?key= (ไม่พึ่งโค้ดเก่า)"""
    req = httpx.Request("POST", "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent", params={"key": KEY})
    err = httpx.HTTPStatusError("x", request=req, response=httpx.Response(400, request=req))
    try:
        httpx.Response(400, request=req).raise_for_status()
    except httpx.HTTPStatusError as e:
        err = e
    assert KEY in str(err)                                   # รูปแบบเดิมรั่วจริง
    assert KEY not in redact_secrets(str(err), [KEY])        # ตัวปิดบังจัดการได้
    assert KEY not in redact_secrets(str(err))               # แม้ไม่รู้ค่าคีย์ (จับจาก ?key=)


# ---------------------------------------------------------------- T-PRV-23 คีย์ Gemini ไปทาง header ไม่อยู่ใน URL
def test_prv23_gemini_key_in_header_not_url(client, leaky):
    cap = leaky("gemini", key=KEY, status=400)
    client.post("/api/chat", json={"text": Q, "lang": "th"})
    assert cap.requests, "ต้องมีคำขอไปยังผู้ให้บริการจำลอง"
    for r in cap.requests:
        assert KEY not in str(r.url)
        assert r.headers.get("x-goog-api-key") == KEY       # คีย์ยังถูกส่งให้ผู้ให้บริการได้จริง


# ---------------------------------------------------------------- T-PRV-11/12 last_error, LLMError, system_events
@pytest.mark.parametrize("provider,key", [("gemini", KEY), ("gemini", GKEY), ("anthropic", KEY), ("openai", KEY), ("typhoon", KEY)],
                         ids=["gemini-plainkey", "gemini-googleformat", "anthropic", "openai", "typhoon"])   # ไม่พิมพ์ค่าคีย์ในชื่อเทสต์ (T-PRV-22)
@pytest.mark.parametrize("status", [400, 401, 429, 500, "offline"])
def test_prv11_12_errors_never_contain_key(client, leaky, provider, key, status):
    leaky(provider, key=key, status=status)
    n = _ai_event_count()
    r = client.post("/api/chat", json={"text": Q, "lang": "th"})
    assert r.status_code == 200 and r.json()["provider"] == "knowledge-base"
    _no_secret(llm.last_error + json.dumps(llm.status(), ensure_ascii=False), key)
    _no_secret("\n".join(_wait_events(n)), key)


def test_prv12_llmerror_message_redacted(leaky):
    import asyncio
    leaky("gemini", key=GKEY, status=403)
    with pytest.raises(LLMError) as ei:
        asyncio.run(llm.complete("sys", "user"))
    _no_secret(str(ei.value) + repr(ei.value), GKEY)


# ---------------------------------------------------------------- T-PRV-10 log ของแอป
def test_prv10_application_log_has_no_key(client, leaky, caplog):
    leaky("gemini", key=KEY, fallback="openai", fkey=FKEY, status=500)
    n = _ai_event_count()
    with caplog.at_level(logging.DEBUG):
        client.post("/api/chat", json={"text": Q, "lang": "th"})
        _wait_events(n)
    _no_secret("\n".join(r.getMessage() for r in caplog.records), KEY, FKEY)


# ---------------------------------------------------------------- T-PRV-20 ทุก endpoint สาธารณะและหลังบ้าน
def test_prv20_endpoints_never_return_key(client, admin_headers, leaky):
    leaky("gemini", key=KEY, fallback="anthropic", fkey=FKEY, status=400)
    client.post("/api/chat", json={"text": Q, "lang": "th"})
    time.sleep(0.5)
    blobs = [client.post("/api/chat", json={"text": Q + " ค่ะ", "lang": "th"}).text]
    for path in ("/api/health", "/api/kiosk/config", "/api/news", "/api/timeline", "/api/programs"):
        blobs.append(client.get(path).text)
    for path in ("/api/admin/system", "/api/admin/settings", "/api/admin/events?limit=1000", "/api/admin/audit?limit=1000"):
        r = client.get(path, headers=admin_headers)
        assert r.status_code == 200, path
        blobs.append(r.text)
    _no_secret("\n".join(blobs), KEY, FKEY)


# ---------------------------------------------------------------- T-PRV-21 ทั้งฐานข้อมูลทดสอบ
def test_prv21_whole_test_database_has_no_key(client, leaky):
    leaky("gemini", key=KEY, fallback="openai", fkey=FKEY, status=401)
    n = _ai_event_count()
    client.post("/api/chat", json={"text": Q, "lang": "th"})
    _wait_events(n)
    dump = []
    with db_engine.connect() as c:
        for t in inspect(c).get_table_names():
            dump += [str(tuple(row)) for row in c.execute(text(f'SELECT * FROM "{t}"'))]
    assert len(dump) > 50
    _no_secret("\n".join(dump), KEY, FKEY)


# ---------------------------------------------------------------- T-PRV-24/26 สถานะรายผู้ให้บริการ
def test_prv24_26_chain_status_shows_only_key_set_and_masks_url_credentials(leaky):
    leaky("openai", key=KEY, fallback="ollama", base_url="https://proxyuser:proxy-pass-123@proxy.example.com/v1")
    st = llm.chain_status()
    blob = json.dumps(st, ensure_ascii=False)
    _no_secret(blob, KEY, "proxy-pass-123", "proxyuser")
    assert st[0]["key_set"] is True and st[1]["key_set"] is False and MASK in st[0]["base_url"]
    assert [s["role"] for s in st] == ["primary", "fallback"]


# ---------------------------------------------------------------- T-PRV-25 คีย์ไม่ผ่านการตั้งค่าในหลังบ้าน · .env.example ไม่มีคีย์จริง
def test_prv25_settings_api_does_not_accept_keys(client, admin_headers):
    r = client.put("/api/admin/settings", headers=admin_headers, json={"llm_api_key": KEY, "VORA_LLM_API_KEY": KEY})
    assert r.status_code == 200
    _no_secret(client.get("/api/admin/settings", headers=admin_headers).text, KEY)
    assert settings.llm_api_key != KEY


def test_prv25_env_example_has_no_real_keys():
    from pathlib import Path
    env = (Path(__file__).resolve().parents[2] / ".env.example").read_text(encoding="utf-8")
    for line in env.splitlines():
        if re.match(r"\s*VORA_[A-Z_]*API_KEY\s*=", line):
            assert line.split("=", 1)[1].strip() == "", line
    assert not re.search(r"AIza[0-9A-Za-z_\-]{20,}|sk-[A-Za-z0-9_\-]{16,}", env)


# ---------------------------------------------------------------- T-PRV-06 สิ่งที่ไม่ส่งไปผู้ให้บริการ
def test_prv06_session_id_not_sent_to_provider(client, leaky):
    cap = leaky("openai", key=KEY, status=500)
    sid = client.post("/api/chat", json={"text": "สวัสดี", "lang": "th"}).json()["session_id"]
    engine._llm_cache.clear()
    client.post("/api/chat", json={"text": Q, "lang": "th", "session_id": sid})
    assert cap.requests
    for r in cap.requests:
        body = r.content.decode("utf-8", "replace")
        assert sid not in body and sid not in str(r.url) and "session" not in body.lower()


# ---------------------------------------------------------------- ตัวปิดบัง (หน่วย)
@pytest.mark.parametrize("raw", [
    "Client error for url 'https://x.googleapis.com/v1/m:generateContent?key=ABCDEF123456&alt=json'",
    "headers {'x-goog-api-key': 'ABCDEF123456'}", "x-api-key: ABCDEF123456", "Authorization: Bearer ABCDEF123456",
    "https://user:ABCDEF123456@proxy/v1", "token AIzaSyABCDEF123456ABCDEF123456", "key sk-ant-ABCDEF123456ABCDEF123456",
], ids=["query-key", "dict-header", "x-api-key", "bearer", "url-credentials", "google-format", "sk-format"])
def test_redact_secrets_patterns(raw):
    out = redact_secrets(raw)
    assert "ABCDEF123456" not in out and MASK in out


def test_redact_secrets_keeps_ordinary_text():
    msg = "HTTPStatusError: Server error '500 Internal Server Error' for url 'https://api.openai.com/v1/chat/completions'"
    assert redact_secrets(msg, ["", "abc"]) == msg            # ไม่แตะข้อความปกติ และไม่ใช้ค่าคีย์ที่สั้น/ว่าง


# ---------------------------------------------------------------- ตัวตัดข้อมูลส่วนบุคคล (หน่วย — ยังไม่ต่อสายใน engine.py: รออนุมัติ)
@pytest.mark.parametrize("raw,secret,tag", [
    ("โทรกลับที่ 0812345678 นะคะ", "0812345678", "[เบอร์โทร]"),
    ("เบอร์ 081-234-5678", "081-234-5678", "[เบอร์โทร]"),
    ("call +66 81 234 5678", "+66 81 234 5678", "[เบอร์โทร]"),
    ("อีเมล somchai.k@example.co.th ค่ะ", "somchai.k@example.co.th", "[อีเมล]"),
    ("เลขบัตร 1103700012345", "1103700012345", "[เลขบัตรประชาชน]"),
    ("เลขบัตร 1-1037-00012-34-5", "1-1037-00012-34-5", "[เลขบัตรประชาชน]"),
    ("บัญชี 123-4-56789-0", "123-4-56789-0", "[เลขบัญชี]"),
    ("ไลน์ไอดี: somchai_99", "somchai_99", "[LINE ID]"),
], ids=["phone", "phone-dashed", "phone-intl", "email", "national-id", "national-id-dashed", "bank-account", "line-id"])   # ไม่พิมพ์ข้อมูลทดสอบในชื่อเทสต์
def test_redact_pii(raw, secret, tag):
    out = redact_pii(raw)
    assert secret not in out and tag in out


def test_redact_pii_keeps_years_and_short_numbers():
    s = "รับสมัครปี 2569 จำนวน 40 คน ค่าเทอม 12,500 บาท"
    assert redact_pii(s) == s
