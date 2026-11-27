"""งาน F "สาธิตไม่สะดุด" (21 พ.ย. 2569) — โหมดฐานความรู้เมื่อเน็ตล่ม + เสียงที่เตรียมไว้ล่วงหน้า

ทุกเทสต์ไม่ออกอินเทอร์เน็ต: จำลองเน็ตล่มด้วย connectivity.set_forced / simulate_offline และจำลองบริการเสียงด้วย monkeypatch
"""
import asyncio
import time

import pytest

from app import connectivity, tts
from app.ai import engine
from app.ai.llm import llm
from app.config import settings
from app.db import SessionLocal
from app.models import Message, UnansweredQuestion


@pytest.fixture(autouse=True)
def _online_again():
    connectivity._reset_for_tests()
    yield
    connectivity._reset_for_tests()


def _agen_list(gen):
    async def run():
        return [c async for c in gen]
    return asyncio.run(run())


# ------------------------------------------------------------------ connectivity
def test_default_online_and_force_switches_mode():
    assert connectivity.offline() is False
    assert connectivity.status()["mode"] == "ai"
    connectivity.set_forced(True)
    st = connectivity.status()
    assert connectivity.offline() and st["mode"] == "kb" and st["forced"] and not st["online"]


def test_monitor_disabled_in_tests_means_online_even_if_probe_failed():
    connectivity._set_online(False, "x")
    connectivity._set_online(False, "x")          # ล้ม 2 ครั้ง = ตัวตรวจบันทึกว่าเน็ตล่ม
    assert connectivity._state["online"] is False
    assert connectivity.offline() is False         # VORA_NET_CHECK_S=0 → ปิดการตรวจ = พฤติกรรมเดิม


def test_detected_offline_needs_two_failures_and_recovers(monkeypatch):
    monkeypatch.setattr(settings, "net_check_s", 15.0)
    connectivity._set_online(False, "ConnectError")
    assert not connectivity.offline()               # ล้มครั้งเดียว (เน็ตกระตุก) ยังไม่เปลี่ยนโหมด
    connectivity._set_online(False, "ConnectError")
    assert connectivity.offline()
    connectivity._set_online(True)
    assert not connectivity.offline()


def test_simulate_offline_is_task_local():
    with connectivity.simulate_offline():
        assert connectivity.offline()
    assert not connectivity.offline()


def test_probe_once_uses_configured_urls(monkeypatch):
    import httpx

    calls = []

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url):
            calls.append(url)
            raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(settings, "net_check_urls", ("https://a.test/204", "https://b.test/204"))
    assert asyncio.run(connectivity.probe_once()) is False
    assert calls == ["https://a.test/204", "https://b.test/204"]


# ------------------------------------------------------------------ LLM ไม่ถูกเรียกเมื่อเน็ตล่ม
def test_llm_unavailable_offline_but_local_ollama_still_ok(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "gemini")
    monkeypatch.setattr(settings, "llm_api_key", "k-test")
    assert llm.available
    connectivity.set_forced(True)
    assert not llm.available
    monkeypatch.setattr(settings, "llm_provider", "ollama")
    monkeypatch.setattr(settings, "llm_base_url", "http://localhost:11434")
    assert llm.available                            # ผู้ให้บริการในเครื่องยังใช้ได้


def test_offline_answer_from_knowledge_base_without_calling_llm(client, monkeypatch):
    called = []

    async def spy(*a, **k):
        called.append(1)
        return "ไม่ควรถูกเรียก"
    monkeypatch.setattr(settings, "llm_provider", "gemini")
    monkeypatch.setattr(settings, "llm_api_key", "k-test")
    monkeypatch.setattr(llm, "complete", spy)
    engine._llm_cache.clear()
    connectivity.set_forced(True)
    t0 = time.time()
    r = client.post("/api/chat", json={"text": "มีทุนการศึกษาไหม"}).json()
    assert time.time() - t0 < 5
    assert r["answered"] and r["provider"] == "knowledge-base" and "ทุน" in r["text"]
    assert called == []


@pytest.mark.parametrize("q", ["เปิดเว็บไซต์วิทยาลัย", "อากาศวันนี้เป็นยังไง"])
def test_offline_net_requests_get_fixed_reply_and_not_logged(client, q):
    connectivity.set_forced(True)
    db = SessionLocal()
    before = db.query(UnansweredQuestion).count()
    db.close()
    r = client.post("/api/chat", json={"text": q}).json()
    assert r["text"] == engine.OFFLINE_NET_REPLY["th"]
    assert r["provider"] == "offline" and not r["answered"]
    db = SessionLocal()
    assert db.query(UnansweredQuestion).count() == before
    db.close()


def test_offline_web_search_request_does_not_go_online(client, monkeypatch):
    from app.ai import web

    async def boom(*a, **k):
        raise AssertionError("must not search offline")
    monkeypatch.setattr(settings, "ai_web_enabled", True)
    monkeypatch.setattr(web, "search", boom)
    connectivity.set_forced(True)
    r = client.post("/api/chat", json={"text": "หาข้อมูลเกี่ยวกับดาวอังคาร"}).json()
    assert r["text"] == engine.OFFLINE_NET_REPLY["th"]


def test_online_behaviour_unchanged_for_site_request(client):
    r = client.post("/api/chat", json={"text": "เปิดเว็บไซต์วิทยาลัย"}).json()
    assert r["text"] != engine.OFFLINE_NET_REPLY["th"]


# ------------------------------------------------------------------ เสียงที่เตรียมไว้ (pinned)
@pytest.fixture
def google_tts(monkeypatch):
    monkeypatch.setattr(settings, "tts_provider", "google")
    tts._g_state["fail_until"] = 0.0
    yield
    tts._g_state["fail_until"] = 0.0


def _put_pinned(text, lang="th", data=b"ID3-pinned"):
    f = tts.cache_path(text, lang, "google")
    tts.PIN_DIR.mkdir(parents=True, exist_ok=True)
    (tts.PIN_DIR / f.name).write_bytes(data)
    return tts.PIN_DIR / f.name


def test_pinned_audio_plays_offline_and_during_cooldown(google_tts):
    text = "ข้อความทดสอบเสียงที่เตรียมไว้ค่ะ"
    _put_pinned(text)
    connectivity.set_forced(True)
    assert _agen_list(tts.stream(text, "th")) == [b"ID3-pinned"]
    connectivity.set_forced(False)
    tts._g_state["fail_until"] = time.monotonic() + 60       # ช่วงพักหลังล้ม: เดิมไม่เล่นไฟล์ที่มีอยู่
    assert _agen_list(tts.stream(text, "th")) == [b"ID3-pinned"]
    assert tts.is_cached(text, "th", "google") and tts.is_pinned(text, "th", "google")


def test_offline_uncached_returns_quickly_without_network(google_tts, monkeypatch):
    import httpx

    def no_net(*a, **k):
        raise AssertionError("no network offline")
    monkeypatch.setattr(httpx, "AsyncClient", no_net)
    connectivity.set_forced(True)
    t0 = time.time()
    assert _agen_list(tts.stream("ยังไม่มีเสียงของข้อความนี้", "th")) == []
    assert time.time() - t0 < 1


def test_pin_creates_pinned_file_and_manifest(google_tts, monkeypatch):
    text = "ข้อความสำหรับเตรียมเสียงค่ะ"

    async def fake_google(t, lang="th"):
        tts._gpath(t, lang).write_bytes(b"ID3-new")
        return b"ID3-new"
    monkeypatch.setattr(tts, "google_synthesize", fake_google)
    res = asyncio.run(tts.pin(text, "th", {"kind": "faq", "label": "ทดสอบ"}))
    assert res["ok"] and res["provider"] == "google" and not res["cached"]
    assert tts.is_pinned(text, "th")
    entry = tts._manifest()[tts._pinned(tts.cache_path(text, "th")).name]
    assert entry["kind"] == "faq" and entry["text"] == text
    assert asyncio.run(tts.pin(text, "th"))["cached"] is True
    assert tts.pinned_stats()["files"] >= 1


def test_pin_offline_refuses_new_audio(google_tts):
    connectivity.set_forced(True)
    assert asyncio.run(tts.pin("ข้อความใหม่ตอนออฟไลน์", "th")) == {"ok": False, "error": "offline"}


def test_prune_keeps_pinned_files(google_tts, monkeypatch):
    p = _put_pinned("ไฟล์ที่ต้องไม่ถูกลบค่ะ")
    monkeypatch.setattr(tts, "CACHE_MAX_FILES", 0)
    tts._prune_cache()
    assert p.exists()


# ------------------------------------------------------------------ API
def test_public_net_quick_and_health(client):
    assert client.get("/api/net").json()["mode"] == "ai"
    h = client.get("/api/health").json()
    assert h["net"]["mode"] == "ai"
    q = client.get("/api/quick-questions?lang=th").json()
    assert q["lang"] == "th" and 1 <= len(q["questions"]) <= 6 and "มีสาขาอะไรบ้าง" in q["questions"]
    assert client.get("/api/quick-questions?lang=en").json()["questions"][0] == "What programs do you offer?"


def test_admin_force_requires_admin_and_is_audited(client, admin_headers, editor_headers):
    assert client.post("/api/admin/offline/force", json={"on": True}).status_code == 401
    assert client.post("/api/admin/offline/force", json={"on": True}, headers=editor_headers).status_code == 403
    r = client.post("/api/admin/offline/force", json={"on": True}, headers=admin_headers).json()
    assert r["mode"] == "kb" and r["forced"]
    assert client.get("/api/net").json()["mode"] == "kb"
    st = client.get("/api/admin/offline/status", headers=admin_headers).json()
    assert st["force_setting"] is True and "pinned" in st
    client.post("/api/admin/offline/force", json={"on": False}, headers=admin_headers)
    assert client.get("/api/net").json()["mode"] == "ai"
    logs = client.get("/api/admin/audit", headers=admin_headers).json()
    assert any(a.get("action") == "offline_force" for a in (logs if isinstance(logs, list) else logs.get("items", [])))


def test_admin_phrases_match_offline_answers_and_leave_no_trace(client, editor_headers):
    db = SessionLocal()
    before = (db.query(Message).count(), db.query(UnansweredQuestion).count())
    db.close()
    r = client.get("/api/admin/offline/phrases", headers=editor_headers)
    assert r.status_code == 200
    items = r.json()["items"]
    texts = {(i["lang"], i["text"]) for i in items}
    kinds = {i["kind"] for i in items}
    assert {"system", "quick", "program", "faq", "greeting"} <= kinds
    assert ("th", engine.OFFLINE_NET_REPLY["th"]) in texts
    # ข้อความต้องตรงกับที่ระบบตอบจริงตอนเน็ตล่ม (ไม่ใช่ข้อความที่เดาเอง)
    connectivity.set_forced(True)
    live = client.post("/api/chat", json={"text": "มีทุนการศึกษาไหม"}).json()["text"]
    assert ("th", live) in texts
    connectivity.set_forced(False)
    db = SessionLocal()
    after = (db.query(Message).count(), db.query(UnansweredQuestion).count())
    db.close()
    assert after == (before[0] + 2, before[1])     # +2 = คำถามที่ถามจริงข้างบนเท่านั้น งานสร้างรายการไม่บันทึกอะไร
    assert not connectivity.offline()


def test_admin_check_and_pin_endpoints(client, editor_headers, google_tts, monkeypatch):
    text = "เตรียมเสียงผ่าน API ค่ะ"

    async def fake_google(t, lang="th"):
        tts._gpath(t, lang).write_bytes(b"ID3-api")
        return b"ID3-api"
    monkeypatch.setattr(tts, "google_synthesize", fake_google)
    chk = client.post("/api/admin/offline/check", json={"items": [{"text": text, "lang": "th"}]}, headers=editor_headers).json()
    assert chk == {"tts_available": True, "pinned": [False]}
    r = client.post("/api/admin/offline/pin", json={"text": text, "lang": "th", "kind": "faq"}, headers=editor_headers).json()
    assert r["ok"]
    chk = client.post("/api/admin/offline/check", json={"items": [{"text": text, "lang": "th"}]}, headers=editor_headers).json()
    assert chk["pinned"] == [True]
    connectivity.set_forced(True)
    r = client.post("/api/admin/offline/pin", json={"text": "ใหม่อีกข้อความค่ะ", "lang": "th"}, headers=editor_headers)
    assert r.status_code == 409
    assert client.post("/api/admin/offline/pin", json={"text": "x"}).status_code == 401


def test_tts_session_reports_pinned_as_cached(client, google_tts):
    text = "เซสชันเสียงที่มีไฟล์เตรียมไว้ค่ะ"
    _put_pinned(text)
    r = client.post("/api/tts/session", json={"text": text, "lang": "th", "provider": "google"}).json()
    assert r["cached"] is True
