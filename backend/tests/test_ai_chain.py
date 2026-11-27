"""Phase 6 · Gate 6C — AI Provider Foundation: ProviderChain (ผู้ให้บริการจำลองด้วย httpx MockTransport · ไม่ใช้อินเทอร์เน็ต)

T-CH-01 ค่าเดิม = พฤติกรรมเดิม · 02 primary สำเร็จ · 03 primary ล้ม → fallback · 04 ล้มทั้งหมด → ฐานความรู้
T-CH-05 circuit breaker ข้ามผู้ให้บริการ · 06 งบเวลารวม · 07 NO_INFO · 08 ข้อผิดพลาด HTTP/timeout/JSON ทุกผู้ให้บริการ
T-OFF-KB-01 ไม่มีอินเทอร์เน็ต → ตอบจากฐานความรู้ได้เท่าเดิม (ชุดประเมิน eval_cases)
"""
import asyncio
import json
import time

import httpx
import pytest

import app.ai.engine as engine
from app.ai.llm import CircuitBreaker, llm
from app.config import settings
from app.db import SessionLocal
from app.models import EvalCase

Q = "สมัครเรียนยังไง"          # คำถามที่มีในฐานความรู้ (ผ่านเส้นทางเรียบเรียงด้วย LLM)
HOSTS = {"gemini": "generativelanguage.googleapis.com", "anthropic": "api.anthropic.com", "openai": "api.openai.com",
         "typhoon": "api.opentyphoon.ai", "ollama": "localhost"}


def ok_body(provider: str, text: str) -> dict:
    if provider == "gemini":
        return {"candidates": [{"content": {"parts": [{"text": text}]}}]}
    if provider == "anthropic":
        return {"content": [{"type": "text", "text": text}]}
    return {"choices": [{"message": {"content": text}}]}


class Fake:
    """ผู้ให้บริการจำลอง: behaviour[provider] = "ok" | int (HTTP status) | "timeout" | "badjson" | "offline" | ("slow", s) | ("text", str)"""

    def __init__(self, **behaviour):
        self.behaviour = behaviour
        self.requests: list[httpx.Request] = []

    def who(self, req: httpx.Request) -> str:
        host = req.url.host
        return next(p for p, h in HOSTS.items() if h == host)

    async def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        p = self.who(req)
        b = self.behaviour.get(p, "ok")
        if b == "offline":
            raise httpx.ConnectError("[Errno -3] name resolution failed", request=req)
        if b == "timeout":
            raise httpx.ReadTimeout("timed out", request=req)
        if isinstance(b, tuple) and b[0] == "slow":
            await asyncio.sleep(b[1])
            return httpx.Response(200, json=ok_body(p, "ช้า"))
        if isinstance(b, int):
            return httpx.Response(b, json={"error": {"message": "fail"}})
        if b == "badjson":
            return httpx.Response(200, text="<html>not json</html>")
        text = b[1] if isinstance(b, tuple) and b[0] == "text" else f"คำตอบจาก {p} ค่ะ"
        return httpx.Response(200, json=ok_body(p, text))

    def count(self, provider: str) -> int:
        return sum(1 for r in self.requests if self.who(r) == provider)


@pytest.fixture
def chain(monkeypatch):
    """ตั้งค่า chain ชั่วคราว + คืนสถานะ llm/แคชของ engine หลังจบ (ไม่กระทบชุดทดสอบอื่น)"""
    monkeypatch.setattr(llm, "breaker", CircuitBreaker())
    monkeypatch.setattr(llm, "fallback_breaker", CircuitBreaker())
    engine._llm_cache.clear()

    def setup(primary="none", fallback="", fake=None, budget=0.0, key="test-key-primary-123", fkey=""):
        monkeypatch.setattr(settings, "llm_provider", primary)
        monkeypatch.setattr(settings, "llm_api_key", key if primary not in ("none", "ollama") else "")
        monkeypatch.setattr(settings, "llm_model", "")
        monkeypatch.setattr(settings, "llm_base_url", "")
        monkeypatch.setattr(settings, "llm_fallback_provider", fallback)
        monkeypatch.setattr(settings, "llm_fallback_api_key", fkey)
        monkeypatch.setattr(settings, "llm_fallback_base_url", "")
        monkeypatch.setattr(settings, "ai_budget_s", budget)
        monkeypatch.setattr(llm, "_transport", httpx.MockTransport(fake) if fake else None)
        engine._llm_cache.clear()
        return fake

    yield setup
    engine._llm_cache.clear()


def ask(client, text=Q):
    r = client.post("/api/chat", json={"text": text, "lang": "th"})
    assert r.status_code == 200
    return r.json()


def test_ch01_default_none_is_unchanged_and_makes_no_request(client, chain):
    fake = chain("none", fake=Fake())
    r = ask(client)
    assert r["answered"] is True and r["provider"] == "knowledge-base"
    assert fake.requests == [] and llm.available is False
    assert llm.status()["provider"] == "offline" and llm.status()["model"] == "knowledge-base-only"


def test_ch02_primary_success(client, chain):
    fake = chain("gemini", fake=Fake(gemini="ok"))
    r = ask(client)
    assert r["provider"] == "llm:gemini" and r["text"] == "คำตอบจาก gemini ค่ะ"
    assert fake.count("gemini") == 1


def test_ch03_primary_fails_fallback_answers(client, chain):
    fake = chain("gemini", "ollama", fake=Fake(gemini=503, ollama="ok"))
    r = ask(client)
    assert r["answered"] is True and r["provider"] == "llm:ollama" and r["text"] == "คำตอบจาก ollama ค่ะ"
    assert fake.count("gemini") == 1 and fake.count("ollama") == 1


def test_ch04_all_fail_falls_back_to_knowledge_base(client, chain):
    chain("gemini", "ollama", fake=Fake(gemini=500, ollama="offline"))
    r = ask(client)
    assert r["answered"] is True and r["provider"] == "knowledge-base" and r["text"]


def test_ch05_open_circuit_is_skipped_without_waiting(client, chain):
    fake = chain("openai", "ollama", fake=Fake(openai=500, ollama="ok"))
    for i in range(3):                                  # ล้ม 3 ครั้ง → ตัดวงจรผู้ให้บริการหลัก
        engine._llm_cache.clear()
        ask(client, f"{Q} {i}")
    assert llm.breaker.is_open and not llm.fallback_breaker.is_open
    before = fake.count("openai")
    engine._llm_cache.clear()
    r = ask(client, f"{Q} อีกครั้ง")
    assert fake.count("openai") == before and r["provider"] == "llm:ollama"


def test_ch06_total_time_budget(client, chain):
    chain("anthropic", "ollama", fake=Fake(anthropic=("slow", 5), ollama=("slow", 5)), budget=0.6)
    t0 = time.time()
    r = ask(client)
    assert time.time() - t0 < 0.6 + 0.9                 # งบ + ความคลาดเคลื่อนของการประมวลผลคำถาม
    assert r["provider"] == "knowledge-base" and r["answered"] is True


def test_ch07_no_info_from_provider_is_not_answered(client, chain):
    chain("gemini", fake=Fake(gemini=("text", "NO_INFO")))
    r = ask(client, "ค่าเทอมสาขาการบินอวกาศเท่าไหร่")
    assert r["answered"] is False


@pytest.mark.parametrize("provider", ["gemini", "anthropic", "openai", "typhoon", "ollama"])
@pytest.mark.parametrize("failure", [400, 401, 429, 500, "timeout", "badjson", "offline"])
def test_ch08_every_failure_mode_degrades_to_knowledge_base(client, chain, provider, failure):
    chain(provider, fake=Fake(**{provider: failure}))
    r = ask(client)
    assert r["answered"] is True and r["provider"] == "knowledge-base"
    assert llm.status()["last_error"]                   # มีข้อผิดพลาดบันทึกไว้ (ปิดบังแล้ว — ตรวจใน test_ai_privacy)


def test_off_kb_01_offline_answers_like_knowledge_base_only(client, chain):
    """T-OFF-KB-01: ไม่มีอินเทอร์เน็ต (ผู้ให้บริการทั้งหมด offline) → ผลตอบได้/ไม่ได้เท่ากับโหมดฐานความรู้ล้วน ทุกกรณีในชุดประเมิน"""
    db = SessionLocal()
    cases = [c.question for c in db.query(EvalCase).order_by(EvalCase.id).all()]
    db.close()
    assert len(cases) >= 20
    chain("none")
    base = [ask(client, q)["answered"] for q in cases]
    chain("gemini", "ollama", fake=Fake(gemini="offline", ollama="offline"))
    offline = [ask(client, q) for q in cases]
    assert [r["answered"] for r in offline] == base
    assert all(r["provider"] in ("knowledge-base", "database") or not r["answered"] or not r["provider"].startswith("llm:") for r in offline)
