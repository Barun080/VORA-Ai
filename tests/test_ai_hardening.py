"""Phase 6 · Gate 6E-1 — Provider Hardening (ผู้ให้บริการจำลองด้วย httpx MockTransport · ไม่ใช้อินเทอร์เน็ต · ไม่ใช้คีย์จริง)

H-FIN  : แปลงผลของผู้ให้บริการทุกราย → finish กลาง (stop | length | safety | empty | other)
H-BRK  : ถูกบล็อก / ถูกตัด / ว่าง ไม่นับเป็นการล่ม (ไม่เปิด circuit breaker แม้ซ้ำหลายครั้ง) และไม่ส่งต่อผู้ให้บริการสำรอง
H-KB   : engine ใช้คำตอบจากฐานความรู้แทน (ไม่ใช่ no_info · ไม่บันทึกเป็นคำถามที่ตอบไม่ได้)
H-DL   : deadline ร่วมต่อคำขอ (primary + fallback + การเรียกครั้งถัดไปในคำขอเดียว + เวลารอคิว ไม่เกินงบ)
H-CC   : จำกัดการเรียกพร้อมกัน (VORA_AI_CONCURRENCY) · รอคิวจนหมดงบ → ล้มอย่างปลอดภัย
H-CFG  : ค่าเริ่มต้นใหม่ (8 / 4 / 8 / 4) · ชื่อโมเดล Gemini ยังไม่เปลี่ยน (รอ Bake-off) · ไม่มี thinking config
"""
import asyncio
import json
import time

import httpx
import pytest

import app.ai.engine as engine
from app.ai import llm as llm_mod
from app.ai.llm import (DEFAULT_MODELS, CircuitBreaker, LLMError, LLMUnusable, llm, parse_anthropic, parse_gemini,
                        parse_openai, reset_deadline, set_deadline)
from app.config import Settings, settings
from app.db import SessionLocal
from app.models import UnansweredQuestion

Q = "สมัครเรียนยังไง"          # มีในฐานความรู้ → ผ่านเส้นทางเรียบเรียงด้วย LLM
HOSTS = {"gemini": "generativelanguage.googleapis.com", "anthropic": "api.anthropic.com", "openai": "api.openai.com",
         "typhoon": "api.opentyphoon.ai", "ollama": "localhost"}
PROVIDERS = list(HOSTS)


def body(provider: str, kind: str, text: str = "คำตอบค่ะ") -> dict:
    """response จำลองของผู้ให้บริการแต่ละรายตามสถานะที่ต้องการ"""
    if provider == "gemini":
        if kind == "prompt_blocked":
            return {"promptFeedback": {"blockReason": "SAFETY"}}
        fr = {"stop": "STOP", "length": "MAX_TOKENS", "safety": "SAFETY", "other": "OTHER", "legacy": None}.get(kind, "STOP")
        cand = {"content": {"parts": [{"text": "" if kind in ("empty", "safety") else text}]}}
        if kind == "safety":
            cand = {}
        if fr:
            cand["finishReason"] = fr
        return {"candidates": [cand]}
    if provider == "anthropic":
        sr = {"stop": "end_turn", "length": "max_tokens", "safety": "refusal", "other": "pause_turn", "legacy": None}.get(kind, "end_turn")
        d = {"content": [] if kind in ("empty", "safety") else [{"type": "text", "text": text}]}
        if sr:
            d["stop_reason"] = sr
        return d
    fr = {"stop": "stop", "length": "length", "safety": "content_filter", "other": "tool_calls", "legacy": None}.get(kind, "stop")
    msg = {"content": None if kind == "safety" else "" if kind == "empty" else text}
    return {"choices": [{"message": msg, **({"finish_reason": fr} if fr else {})}]}


class Fake:
    """behaviour[provider] = kind (ดู body()) | int (HTTP status) | ("slow", วินาที)"""

    def __init__(self, **behaviour):
        self.behaviour, self.requests = behaviour, []

    def who(self, req):
        return next(p for p, h in HOSTS.items() if h == req.url.host)

    async def __call__(self, req):
        self.requests.append(req)
        p = self.who(req)
        b = self.behaviour.get(p, "stop")
        if isinstance(b, tuple) and b[0] == "slow":
            await asyncio.sleep(b[1])
            return httpx.Response(200, json=body(p, "stop", "ช้าค่ะ"))
        if isinstance(b, int):
            return httpx.Response(b, json={"error": "x"})
        return httpx.Response(200, json=body(p, b, f"คำตอบจาก {p} ค่ะ"))

    def count(self, p):
        return sum(1 for r in self.requests if self.who(r) == p)


@pytest.fixture
def chain(monkeypatch):
    monkeypatch.setattr(llm, "breaker", CircuitBreaker())
    monkeypatch.setattr(llm, "fallback_breaker", CircuitBreaker())

    def setup(primary="openai", fallback="", fake=None, budget=0.0, timeout=4.0, fallback_timeout=8.0, concurrency=4):
        monkeypatch.setattr(settings, "llm_provider", primary)
        monkeypatch.setattr(settings, "llm_api_key", "test-key-hardening-1" if primary != "ollama" else "")
        monkeypatch.setattr(settings, "llm_model", "")
        monkeypatch.setattr(settings, "llm_base_url", "")
        monkeypatch.setattr(settings, "llm_timeout", timeout)
        monkeypatch.setattr(settings, "llm_fallback_provider", fallback)
        monkeypatch.setattr(settings, "llm_fallback_api_key", "test-key-hardening-2" if fallback not in ("", "ollama") else "")
        monkeypatch.setattr(settings, "llm_fallback_base_url", "")
        monkeypatch.setattr(settings, "llm_fallback_timeout", fallback_timeout)
        monkeypatch.setattr(settings, "ai_budget_s", budget)
        monkeypatch.setattr(settings, "ai_concurrency", concurrency)
        monkeypatch.setattr(settings, "ai_general_enabled", False)
        monkeypatch.setattr(llm, "_transport", httpx.MockTransport(fake))
        engine._llm_cache.clear()
        return fake

    yield setup
    engine._llm_cache.clear()


def ask(client, text=Q):
    r = client.post("/api/chat", json={"text": text, "lang": "th", "channel": "kiosk"})
    assert r.status_code == 200
    return r.json()


def complete(**kw):
    return asyncio.run(llm.complete("system", "user", **kw))


# ---------------------------------------------------------------- H-FIN: แปลงสถานะ (unit)
@pytest.mark.parametrize("provider", ["gemini", "anthropic", "openai"])
@pytest.mark.parametrize("kind,expected", [("stop", "stop"), ("legacy", "stop"), ("length", "length"),
                                           ("safety", "safety"), ("empty", "empty"), ("other", "other")])
def test_h_fin_normalized_finish(provider, kind, expected):
    parse = {"gemini": parse_gemini, "anthropic": parse_anthropic, "openai": parse_openai}[provider]
    r = parse(body(provider, kind))
    assert r.finish == expected, (provider, kind, r)
    if expected in ("stop", "length", "other"):
        assert r.text == "คำตอบค่ะ"


def test_h_fin_gemini_prompt_blocked_and_no_candidates():
    assert parse_gemini(body("gemini", "prompt_blocked")).finish == "safety"
    assert parse_gemini({}).finish == "empty"
    assert parse_gemini({"candidates": [{"content": {"parts": []}, "finishReason": "STOP"}]}).finish == "empty"


def test_h_fin_whitespace_only_is_empty():
    assert parse_openai({"choices": [{"message": {"content": "  \n "}, "finish_reason": "stop"}]}).finish == "empty"
    assert parse_anthropic({"content": [{"type": "text", "text": " "}], "stop_reason": "end_turn"}).finish == "empty"


def test_h_fin_gemini_thought_parts_are_not_answer_text():
    d = {"candidates": [{"content": {"parts": [{"text": "คิดก่อน", "thought": True}, {"text": "คำตอบค่ะ"}]},
                         "finishReason": "STOP"}]}
    assert parse_gemini(d).text == "คำตอบค่ะ"


# ---------------------------------------------------------------- H-BRK: breaker / ไม่ส่งต่อ (unit ระดับ LLMClient)
@pytest.mark.parametrize("provider", PROVIDERS)
@pytest.mark.parametrize("kind", ["length", "safety", "empty", "other"])
def test_h_brk_unusable_does_not_count_as_outage(chain, provider, kind):
    fake = chain(provider, "ollama" if provider != "ollama" else "", fake=Fake(**{provider: kind}))
    errors = llm.errors
    with pytest.raises(LLMUnusable) as e:
        complete()
    assert e.value.finish == kind and isinstance(e.value, LLMError)
    assert llm.errors == errors and llm.breaker.failures == 0 and not llm.breaker.is_open
    assert fake.count(provider) == 1
    if provider != "ollama":
        assert fake.count("ollama") == 0                  # ไม่ส่งต่อผู้ให้บริการสำรองเพื่อ "หาคำตอบที่ไม่ถูกบล็อก"


def test_h_brk_repeated_safety_blocks_never_open_breaker(chain):
    chain("gemini", fake=Fake(gemini="safety"))
    for _ in range(10):
        with pytest.raises(LLMUnusable):
            complete()
    assert not llm.breaker.is_open and llm.breaker.failures == 0 and llm.available


def test_h_brk_real_failures_still_open_breaker(chain):
    chain("gemini", fake=Fake(gemini=500))
    for _ in range(3):
        with pytest.raises(LLMError):
            complete()
    assert llm.breaker.is_open


def test_h_brk_failure_then_fallback_success_no_retry_of_same_provider(chain):
    fake = chain("gemini", "ollama", fake=Fake(gemini=503, ollama="stop"))
    assert complete() == "คำตอบจาก ollama ค่ะ"
    assert fake.count("gemini") == 1 and fake.count("ollama") == 1


# ---------------------------------------------------------------- H-KB: engine → ฐานความรู้ (integration)
def _unanswered(text: str) -> int:
    db = SessionLocal()
    try:
        return db.query(UnansweredQuestion).filter(UnansweredQuestion.text == text).count()
    finally:
        db.close()


@pytest.mark.parametrize("kind", ["safety", "length", "empty", "other"])
def test_h_kb_unusable_ai_falls_back_to_knowledge_base(client, chain, kind):
    fake = chain("openai", fake=Fake(openai=kind))
    q = f"{Q} ({kind})"
    r = ask(client, q)
    assert fake.count("openai") == 1
    assert r["answered"] is True and r["provider"] == "knowledge-base" and r["text"]
    assert _unanswered(q) == 0


def test_h_kb_truncated_text_never_reaches_user(client, chain):
    chain("anthropic", fake=Fake(anthropic="length"))
    r = ask(client, f"{Q} ตัด")
    assert "คำตอบจาก anthropic" not in r["text"] and r["provider"] == "knowledge-base"


def test_h_kb_markdown_only_reply_is_not_no_info(client, chain):
    """ข้อความที่เหลือว่างหลังตัด markdown (เช่น "**") — เดิมถูกตีความเป็น NO_INFO → ตอบว่าไม่มีข้อมูล"""
    class Stars(Fake):
        async def __call__(self, req):
            self.requests.append(req)
            return httpx.Response(200, json={"choices": [{"message": {"content": "**"}, "finish_reason": "stop"}]})
    chain("openai", fake=Stars())
    q = f"{Q} ดาว"
    r = ask(client, q)
    assert r["answered"] is True and r["provider"] == "knowledge-base" and _unanswered(q) == 0


def test_h_kb_unusable_without_usable_kb_is_safe_no_info(client, chain):
    chain("openai", fake=Fake(openai="safety"))
    r = ask(client, "qzxv ไม่มีข้อมูลนี้แน่นอน 7781")
    assert r["answered"] is False and r["provider"] == "rules"


def test_h_kb_no_info_still_means_no_info(client, chain):
    class NoInfo(Fake):
        async def __call__(self, req):
            self.requests.append(req)
            return httpx.Response(200, json={"choices": [{"message": {"content": "NO_INFO"}, "finish_reason": "stop"}]})
    chain("openai", fake=NoInfo())
    r = ask(client, "ค่าเทอมสาขาการบินอวกาศเท่าไหร่")
    assert r["answered"] is False


# ---------------------------------------------------------------- H-DL: deadline ร่วมต่อคำขอ
def test_h_dl_fallback_only_gets_remaining_time(chain):
    """primary ใช้ไป ~0.7 วิ (ช้าจนเกิน timeout 0.7) → fallback ได้แค่เวลาที่เหลือของงบ 1.0 วิ ไม่ใช่ timeout ของตัวเองเต็ม ๆ"""
    chain("anthropic", "ollama", fake=Fake(anthropic=("slow", 5), ollama=("slow", 5)), budget=1.0, timeout=0.7,
          fallback_timeout=8.0)
    t0 = time.time()
    with pytest.raises(LLMError):
        complete()
    assert time.time() - t0 < 1.0 + 0.3


def test_h_dl_shared_across_calls_in_one_request(chain):
    """สองการเรียกในคำขอเดียว (เช่น compose แล้ว general) ใช้งบก้อนเดียวกัน ไม่ใช่คนละ 0.8 วิ"""
    chain("openai", fake=Fake(openai=("slow", 0.5)), budget=0.8, timeout=4.0)

    async def run():
        token = set_deadline(settings.ai_budget_s)
        try:
            first = await llm.complete("s", "u")
            try:
                await llm.complete("s", "u")
                second = "ok"
            except LLMError:
                second = "cut"
            return first, second
        finally:
            reset_deadline(token)

    t0 = time.time()
    first, second = asyncio.run(run())
    elapsed = time.time() - t0
    assert first == "ช้าค่ะ" and second == "cut" and elapsed < 0.8 + 0.3


def test_h_dl_engine_compose_and_general_share_one_budget(client, chain, monkeypatch):
    """engine.answer ตั้ง deadline ครั้งเดียว: _compose_with_llm + _general_answer ในคำขอเดียวรวมกันไม่เกินงบ"""
    chain("openai", fake=Fake(openai=("slow", 0.5)), budget=0.8, timeout=4.0)
    monkeypatch.setattr(settings, "ai_general_enabled", True)
    calls = []
    real_compose = engine._compose_with_llm

    async def compose_then_general(question, hits, lang, cfg, *, allow_llm, db=None):
        r1 = await real_compose(question, hits, lang, cfg, allow_llm=allow_llm, db=db)
        t = time.time()
        r2 = await engine._general_answer(question, lang, cfg, allow_llm=allow_llm, db=db)
        calls.append((r1, r2, time.time() - t))
        return r1
    monkeypatch.setattr(engine, "_compose_with_llm", compose_then_general)
    t0 = time.time()
    r = ask(client, f"{Q} งบรวม")
    assert calls and calls[0][1] is None              # การเรียกครั้งที่ 2 ถูกตัดด้วยงบที่เหลือ
    assert time.time() - t0 < 0.8 + 0.9 and r["answered"] is True


def test_h_dl_answer_resets_deadline_after_request(client, chain):
    chain("openai", fake=Fake(openai="stop"), budget=8.0)
    ask(client, f"{Q} รีเซ็ต")
    assert llm_mod._deadline.get() is None


# ---------------------------------------------------------------- H-CC: concurrency
def test_h_cc_limit_is_enforced(chain):
    chain("openai", fake=Fake(openai=("slow", 0.3)), budget=5.0, concurrency=2)
    active = {"now": 0, "max": 0}
    real = llm._dispatch

    async def counting(*a, **k):
        active["now"] += 1
        active["max"] = max(active["max"], active["now"])
        try:
            return await real(*a, **k)
        finally:
            active["now"] -= 1

    async def run():
        llm._dispatch = counting
        try:
            return await asyncio.gather(*(llm.complete("s", "u") for _ in range(6)))
        finally:
            del llm._dispatch
    out = asyncio.run(run())
    assert out == ["ช้าค่ะ"] * 6 and active["max"] == 2


def test_h_cc_queue_wait_counts_toward_deadline(chain):
    """คิวเต็มจนหมดงบ → LLMError (ไม่ใช่การล่ม: breaker ไม่เปลี่ยน) ภายในงบเวลา"""
    chain("openai", fake=Fake(openai=("slow", 1.0)), budget=0.5, concurrency=1)

    async def run():
        return await asyncio.gather(*(llm.complete("s", "u") for _ in range(3)), return_exceptions=True)
    t0 = time.time()
    out = asyncio.run(run())
    assert time.time() - t0 < 0.5 + 0.4
    assert all(isinstance(x, LLMError) for x in out)
    assert any("queue" in str(x) for x in out)


def test_h_cc_queue_timeout_in_engine_falls_back_to_kb(client, chain, monkeypatch):
    chain("openai", fake=Fake(openai="stop"), budget=0.3, concurrency=1)
    # คิวเต็มตลอดคำขอ (semaphore ขนาด 0) → รอจนหมดงบ
    full = asyncio.Semaphore(0)
    monkeypatch.setattr(llm, "_semaphore", lambda: full)
    r = ask(client, f"{Q} คิวเต็ม")
    assert r["answered"] is True and r["provider"] == "knowledge-base"
    assert not llm.breaker.is_open and llm.breaker.failures == 0


# ---------------------------------------------------------------- H-CFG
def test_h_cfg_new_defaults(monkeypatch):
    for k in ("VORA_AI_BUDGET_S", "VORA_LLM_TIMEOUT", "VORA_LLM_FALLBACK_TIMEOUT", "VORA_AI_CONCURRENCY"):
        monkeypatch.delenv(k, raising=False)
    s = Settings()
    assert (s.ai_budget_s, s.llm_timeout, s.llm_fallback_timeout, s.ai_concurrency) == (8.0, 4.0, 8.0, 4)


def test_h_cfg_gemini_model_unchanged_and_no_thinking_config(chain):
    """6E-1 ไม่เลือกโมเดล Gemini ใหม่เอง และไม่ส่ง thinking config — รอผล Bake-off"""
    assert DEFAULT_MODELS["gemini"] == "gemini-2.5-flash"
    fake = chain("gemini", fake=Fake(gemini="stop"))
    complete()
    sent = json.loads(fake.requests[0].content)
    assert "thinkingConfig" not in json.dumps(sent) and set(sent["generationConfig"]) == {"maxOutputTokens", "temperature"}
    assert "/models/gemini-2.5-flash:generateContent" in str(fake.requests[0].url)


def test_h_cfg_provider_none_makes_no_request(client, chain):
    fake = chain("none", fake=Fake())
    r = ask(client)
    assert fake.requests == [] and r["provider"] == "knowledge-base"
