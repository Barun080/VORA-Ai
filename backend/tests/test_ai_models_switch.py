"""สวิตช์เลือกโมเดล AI จากหลังบ้าน (22 พ.ย. 2569) — ไม่ออกอินเทอร์เน็ต (MockTransport) · ไม่มีคีย์จริง"""
import asyncio

import httpx
import pytest

from app.ai import engine, providers
from app.ai.llm import llm
from app.config import settings
from app.db import SessionLocal
from app.models import AuditLog
from app.services import get_setting, set_setting

FAKE = "tk-test-" + "Z" * 24          # คีย์ปลอม ใช้ตรวจว่าไม่รั่วออก API/audit


@pytest.fixture(autouse=True)
def _restore(monkeypatch):
    monkeypatch.delenv("VORA_KEY_TYPHOON", raising=False)
    providers._reset_for_tests()
    yield
    providers._reset_for_tests()
    db = SessionLocal()
    set_setting(db, providers.SETTING_KEY, None)
    db.commit()
    db.close()


def _get(client, h):
    return client.get("/api/admin/ai/models", headers=h)


def test_requires_login_and_admin_to_change(client, editor_headers):
    assert client.get("/api/admin/ai/models").status_code == 401
    assert _get(client, editor_headers).status_code == 200                       # ดูได้
    r = client.post("/api/admin/ai/models", json={"primary": "none"}, headers=editor_headers)
    assert r.status_code == 403                                                  # เปลี่ยนไม่ได้


def test_default_is_env_and_unchanged(client, admin_headers):
    before = {f: getattr(settings, f) for f in providers._ENV_FIELDS}
    d = _get(client, admin_headers).json()
    assert d["mode"] == "env" and {o["id"] for o in d["options"]} >= {"none", "gemini", "typhoon", "ollama"}
    assert {f: getattr(settings, f) for f in providers._ENV_FIELDS} == before


def test_choose_none_answers_from_knowledge_base(client, admin_headers):
    r = client.post("/api/admin/ai/models", json={"primary": "none"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["ai_on"] is False
    assert settings.llm_enabled is False and llm.available is False
    chat = client.post("/api/chat", json={"text": "มีทุนการศึกษาไหม"}).json()
    assert chat["answered"] and chat["provider"] == "knowledge-base"


def test_missing_key_is_refused_with_thai_help(client, admin_headers):
    r = client.post("/api/admin/ai/models", json={"primary": "typhoon"}, headers=admin_headers)
    assert r.status_code == 400 and "VORA_KEY_TYPHOON" in r.json()["detail"]
    assert providers.current()["mode"] == "env"                                  # ค่าเดิมไม่เปลี่ยน


def test_switch_to_typhoon_live_without_restart_and_no_key_leak(client, admin_headers, monkeypatch):
    monkeypatch.setenv("VORA_KEY_TYPHOON", FAKE)
    r = client.post("/api/admin/ai/models", json={"primary": "typhoon", "fallback": "none"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert FAKE not in r.text
    assert settings.llm_provider == "typhoon" and settings.llm_model == "typhoon-v2.5-30b-a3b-instruct"
    assert settings.llm_enabled and llm.chain_status()[0]["key_set"] is True
    # คำขอไปที่ Typhoon จริง (จำลอง) พร้อมคีย์ทาง header
    seen = {}

    def handler(req: httpx.Request):
        seen["host"], seen["auth"] = req.url.host, req.headers.get("authorization")
        return httpx.Response(200, json={"choices": [{"message": {"content": "มีทุนการศึกษาค่ะ"}}]})
    monkeypatch.setattr(llm, "_transport", httpx.MockTransport(handler))
    out = asyncio.run(llm.complete("sys", "user", max_tokens=8))
    assert out and seen["host"] == "api.opentyphoon.ai" and seen["auth"] == f"Bearer {FAKE}"
    db = SessionLocal()
    rows = db.query(AuditLog).filter(AuditLog.action == "ai_model_switch").all()
    assert rows and all(FAKE not in str(a.detail) for a in rows)
    assert get_setting(db, providers.SETTING_KEY)["primary"] == "typhoon"
    db.close()


def test_model_override_and_validation(client, admin_headers, monkeypatch):
    monkeypatch.setenv("VORA_KEY_TYPHOON", FAKE)
    ok = client.post("/api/admin/ai/models", json={"primary": "typhoon", "models": {"typhoon": "typhoon-v2.1-12b-instruct"}},
                     headers=admin_headers)
    assert ok.status_code == 200 and settings.llm_model == "typhoon-v2.1-12b-instruct"
    bad = client.post("/api/admin/ai/models", json={"primary": "typhoon", "models": {"typhoon": "x; rm -rf /"}},
                      headers=admin_headers)
    assert bad.status_code == 400
    assert client.post("/api/admin/ai/models", json={"primary": "hacker"}, headers=admin_headers).status_code == 400


def test_fallback_same_as_primary_is_ignored(monkeypatch):
    monkeypatch.setenv("VORA_KEY_TYPHOON", FAKE)
    clean = providers.apply({"primary": "typhoon", "fallback": "typhoon"})
    assert clean["fallback"] == "none" and len(llm.chain()) == 1


def test_ollama_needs_no_key_and_has_longer_timeout():
    providers.apply({"primary": "ollama"})
    assert settings.llm_enabled and settings.llm_api_key == "" and settings.llm_timeout >= 30


def test_ollama_probe_offline_is_harmless(monkeypatch):
    def boom(req):
        raise httpx.ConnectError("no ollama")
    monkeypatch.setattr(llm, "_transport", httpx.MockTransport(boom))
    assert asyncio.run(providers.ollama_models()) == {"running": False, "models": []}


def test_ollama_probe_lists_models(monkeypatch):
    monkeypatch.setattr(llm, "_transport", httpx.MockTransport(
        lambda req: httpx.Response(200, json={"models": [{"name": "qwen2.5:7b"}]})))
    assert asyncio.run(providers.ollama_models()) == {"running": True, "models": ["qwen2.5:7b"]}


def test_back_to_env_restores_everything(client, admin_headers, monkeypatch):
    before = {f: getattr(settings, f) for f in providers._ENV_FIELDS}
    monkeypatch.setenv("VORA_KEY_TYPHOON", FAKE)
    client.post("/api/admin/ai/models", json={"primary": "typhoon"}, headers=admin_headers)
    r = client.post("/api/admin/ai/models", json={"mode": "env"}, headers=admin_headers)
    assert r.json()["mode"] == "env"
    assert {f: getattr(settings, f) for f in providers._ENV_FIELDS} == before
    db = SessionLocal()
    assert not get_setting(db, providers.SETTING_KEY)
    db.close()


def test_saved_choice_is_applied_at_startup_and_bad_choice_falls_back(monkeypatch):
    db = SessionLocal()
    set_setting(db, providers.SETTING_KEY, {"mode": "custom", "primary": "none", "fallback": "none", "models": {}})
    db.commit()
    providers.load_saved(db)
    assert settings.llm_provider == "none" and settings.llm_enabled is False
    set_setting(db, providers.SETTING_KEY, {"mode": "custom", "primary": "typhoon"})       # ไม่มีคีย์ → ใช้ .env
    db.commit()
    providers.load_saved(db)
    assert providers.current()["mode"] == "env"
    db.close()


def test_switch_clears_answer_cache(monkeypatch):
    engine._llm_cache[("x", "th", 0)] = ("old", "gemini")
    providers.apply({"primary": "none"})
    assert not engine._llm_cache


def test_reload_keys_endpoint(client, admin_headers, monkeypatch):
    r = client.post("/api/admin/ai/models/reload", headers=admin_headers)
    assert r.status_code == 200 and r.json()["mode"] == "env"
