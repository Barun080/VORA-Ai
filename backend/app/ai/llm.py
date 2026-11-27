"""ตัวเชื่อมต่อโมเดลภาษาขนาดใหญ่ (LLM) หลายผู้ให้บริการ พร้อมระบบตัดวงจรเมื่อบริการขัดข้อง

LLM ถูกใช้เพื่อ "เรียบเรียงคำตอบจากข้อมูลที่ค้นคืนได้" เท่านั้น ไม่ใช่แหล่งความรู้
ถ้าไม่ได้ตั้งค่า หรือบริการล่ม ระบบจะใช้คำตอบจากฐานความรู้โดยตรง (ออฟไลน์) แทนอัตโนมัติ

Phase 6 · Gate 6C
- ProviderChain: ผู้ให้บริการหลัก (VORA_LLM_*) → ผู้ให้บริการสำรอง (VORA_LLM_FALLBACK_*, ไม่บังคับ เช่น ollama ในเครื่อง)
  แต่ละตัวมี circuit breaker ของตัวเอง · งบเวลารวม VORA_AI_BUDGET_S (0 = ไม่จำกัดเพิ่ม → เหมือนเดิม)
  ไม่ได้ตั้งผู้ให้บริการสำรอง = พฤติกรรมเดิมทุกประการ
- S1: คีย์ Gemini ส่งทาง header x-goog-api-key (ไม่อยู่ใน URL อีกต่อไป) และทุกข้อความผิดพลาดผ่าน redact_secrets()
  ก่อนเข้า last_error / system_events / log / LLMError

Phase 6 · Gate 6E-1 (Provider Hardening)
- ผลจากผู้ให้บริการถูกแปลงเป็นสถานะกลาง ProviderResult(text, finish) โดย finish ∈ stop | length | safety | empty | other
  engine ไม่ต้องรู้รูปแบบ response ของผู้ให้บริการรายใด · ไม่มีฟิลด์บอกสถานะ (รูปแบบเดิม) = stop
- finish ≠ stop (ถูกบล็อก / ถูกตัด / ว่าง / อื่น ๆ) → LLMUnusable (เป็น LLMError) ทันที: ไม่นับเป็นการล่มของผู้ให้บริการ
  (ไม่แตะ circuit breaker) และไม่ส่งต่อให้ผู้ให้บริการสำรอง → engine ใช้คำตอบจากฐานความรู้ตรง ๆ
- งบเวลาต่อคำขอ (deadline ร่วม): engine ตั้ง set_deadline() ครั้งเดียวต่อคำถาม ทุกการเรียก complete() ในคำถามนั้นใช้เวลาก้อนเดียวกัน
  รวมเวลารอคิว (จำกัดการเรียกพร้อมกัน VORA_AI_CONCURRENCY) · ไม่ retry ผู้ให้บริการเดิม
- 6E-3: payload ขาออก (system + user) ผ่าน redact_secrets() ก่อนส่ง — กันคีย์/โทเคนที่หลุดมาในข้อความผู้ใช้หรือฐานความรู้
- ชื่อโมเดล Gemini ค่าเริ่มต้น "ยังไม่เปลี่ยน" และไม่มี thinking config — รอผล Bake-off 6E-0
"""
from __future__ import annotations

import asyncio
import contextvars
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from .. import connectivity
from ..config import settings
from ..services import record_event
from .privacy import redact_secrets, redact_url

DEFAULT_MODELS = {
    "gemini": "gemini-2.5-flash",
    "openai": "gpt-4o-mini",
    "anthropic": "claude-haiku-5-5",
    "typhoon": "typhoon-v2.5-30b-a3b-instruct",   # 22 พ.ย. 2569: รุ่นที่ API ฟรีเปิดให้ใช้ (เดิม v2.1-12b)
    "ollama": "qwen2.5:7b",
}
DEFAULT_BASE = {
    "openai": "https://api.openai.com/v1",
    "typhoon": "https://api.opentyphoon.ai/v1",
    "ollama": "http://localhost:11434/v1",
}


GEMINI_THINKING_ALLOWANCE = 1000     # โทเคนเผื่อสำหรับการคิด เมื่อตั้ง VORA_LLM_THINKING (ค่าเดียวกับ bake-off 6E-0)

class LLMError(Exception):
    pass


class LLMUnusable(LLMError):
    """ผู้ให้บริการตอบกลับได้ แต่ข้อความใช้ไม่ได้ (ถูกบล็อก / ถูกตัด / ว่าง) — ไม่ใช่การล่มของผู้ให้บริการ"""

    def __init__(self, finish: str, provider: str = "") -> None:
        super().__init__(f"unusable response: finish={finish}")
        self.finish, self.provider = finish, provider


FINISH_STATES = ("stop", "length", "safety", "empty", "other")


@dataclass(frozen=True)
class ProviderResult:
    """ผลจากผู้ให้บริการในรูปแบบกลาง (ไม่ขึ้นกับรูปแบบ response ของผู้ให้บริการรายใด)"""
    text: str
    finish: str = "stop"


_GEMINI_FINISH = {"STOP": "stop", "MAX_TOKENS": "length", "SAFETY": "safety", "RECITATION": "safety",
                  "BLOCKLIST": "safety", "PROHIBITED_CONTENT": "safety", "SPII": "safety", "IMAGE_SAFETY": "safety"}
_ANTHROPIC_FINISH = {"end_turn": "stop", "stop_sequence": "stop", "max_tokens": "length", "refusal": "safety"}
_OPENAI_FINISH = {"stop": "stop", "length": "length", "content_filter": "safety"}


def _result(text: object, finish: str) -> ProviderResult:
    t = text if isinstance(text, str) else ""
    if finish == "stop" and not t.strip():
        finish = "empty"
    return ProviderResult(t, finish if finish in FINISH_STATES else "other")


def parse_gemini(data: dict) -> ProviderResult:
    cands = data.get("candidates") or []
    if not cands:
        return _result("", "safety" if (data.get("promptFeedback") or {}).get("blockReason") else "empty")
    c = cands[0] or {}
    parts = (c.get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict) and not part.get("thought"))
    fr = c.get("finishReason")
    return _result(text, "stop" if fr is None else _GEMINI_FINISH.get(fr, "other"))


def parse_anthropic(data: dict) -> ProviderResult:
    text = "".join(b.get("text", "") for b in (data.get("content") or []) if isinstance(b, dict) and b.get("type") == "text")
    sr = data.get("stop_reason")
    return _result(text, "stop" if sr is None else _ANTHROPIC_FINISH.get(sr, "other"))


def parse_openai(data: dict) -> ProviderResult:
    ch = (data.get("choices") or [{}])[0] or {}
    fr = ch.get("finish_reason")
    return _result((ch.get("message") or {}).get("content"), "stop" if fr is None else _OPENAI_FINISH.get(fr, "other"))


# deadline ของคำขอปัจจุบัน (time.time() ที่ต้องเสร็จ) — engine ตั้งครั้งเดียวต่อคำถาม · None = ไม่มี (พฤติกรรมเดิม)
_deadline: contextvars.ContextVar[float | None] = contextvars.ContextVar("vora_llm_deadline", default=None)


def set_deadline(seconds: float) -> contextvars.Token | None:
    """เริ่มงบเวลาร่วมของคำขอ (seconds ≤ 0 = ไม่ตั้ง) คืน token สำหรับ reset_deadline()"""
    return _deadline.set(time.time() + seconds) if seconds and seconds > 0 else None


def reset_deadline(token: contextvars.Token | None) -> None:
    if token is not None:
        _deadline.reset(token)


class RateWindow:
    """จำกัดการเรียก AI ต่อนาที (หน้าต่างเลื่อน 60 วิ) — ใช้ร่วมกันทุกงานในเซิร์ฟเวอร์ (11 พ.ย. 2569)

    ผลตรวจจริง: Gemini 3.5 Flash Lite ฟรีได้ 15 ครั้ง/นาที แต่ระบบเรียกไป 16 → 429 แล้วตัวสำรอง (โปรเจกต์เดียวกัน) ก็ 429 ซ้ำ
    · เกินโควตาที่ตั้งไว้ (VORA_LLM_RPM) → ไม่เรียก AI รอบนั้น ระบบตอบจากฐานความรู้/Wikipedia แทน (เร็วกว่ารอ 429)
    · ได้ 429 จากผู้ให้บริการ → งดเรียกทุกตัว 30 วิ (คีย์สำรองมักอยู่โปรเจกต์เดียวกัน ใช้โควตาก้อนเดียวกัน)"""

    def __init__(self) -> None:
        self.calls: list[float] = []
        self.blocked_until = 0.0
        self.denied = 0

    def allow(self) -> bool:
        now = time.monotonic()
        if now < self.blocked_until:
            self.denied += 1
            return False
        rpm = settings.llm_rpm
        if rpm <= 0:
            return True
        self.calls = [t for t in self.calls if now - t < 60.0]
        if len(self.calls) >= rpm:
            self.denied += 1
            return False
        self.calls.append(now)
        return True

    def quota_hit(self, seconds: float = 30.0) -> None:
        self.blocked_until = max(self.blocked_until, time.monotonic() + seconds)

    def status(self) -> dict:
        now = time.monotonic()
        return {"rpm_limit": settings.llm_rpm, "used_last_min": len([t for t in self.calls if now - t < 60.0]),
                "cooling_down_s": max(0, round(self.blocked_until - now)), "denied": self.denied}


rate = RateWindow()


class CircuitBreaker:
    """ถ้าเรียกล้มเหลวติดกัน N ครั้ง จะหยุดเรียกชั่วคราว เพื่อไม่ให้ผู้ใช้ต้องรอ timeout ซ้ำๆ"""

    def __init__(self, threshold: int = 3, cooldown_s: float = 60) -> None:
        self.threshold, self.cooldown_s = threshold, cooldown_s
        self.failures = 0
        self.open_until = 0.0

    @property
    def is_open(self) -> bool:
        return time.time() < self.open_until

    def success(self) -> None:
        self.failures = 0

    def failure(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold:
            self.open_until = time.time() + self.cooldown_s
            self.failures = 0


@dataclass
class ProviderSpec:
    """ผู้ให้บริการหนึ่งตัวใน chain (อ่านค่าจาก settings ทุกครั้ง จึงรองรับการเปลี่ยนค่าระหว่างทดสอบ)"""
    role: str                                  # primary | fallback
    name: str
    model: str
    api_key: str
    base_url: str
    timeout: float
    enabled: bool
    breaker: CircuitBreaker = field(repr=False, default_factory=CircuitBreaker)


# ผู้ให้บริการที่ตอบคำขอปัจจุบันได้จริง (แยกตาม request/task ด้วย contextvar — ไม่ปนกันระหว่างผู้ใช้พร้อมกัน)
_served: contextvars.ContextVar[str] = contextvars.ContextVar("vora_llm_served", default="")


class LLMClient:
    def __init__(self) -> None:
        self.breaker = CircuitBreaker()              # ของผู้ให้บริการหลัก (ชื่อเดิม คงไว้ให้โค้ด/สถานะเดิม)
        self.fallback_breaker = CircuitBreaker()
        self.last_latency_ms = 0
        self.last_error = ""
        self.calls = 0
        self.errors = 0
        self.last_served = ""
        self._transport: httpx.AsyncBaseTransport | None = None   # สำหรับชุดทดสอบ (MockTransport) · ใช้งานจริง = None
        self._sems: dict[tuple[int, int], asyncio.Semaphore] = {}  # (id ของ event loop, ขนาด) → Semaphore
        self.unusable = 0                                          # จำนวนคำตอบที่ใช้ไม่ได้ (ถูกบล็อก/ตัด/ว่าง) — ไม่ใช่ errors

    # ---------------------------------------------------------------- ค่าตั้ง
    def chain(self) -> list[ProviderSpec]:
        out = [ProviderSpec("primary", settings.llm_provider, settings.llm_model or DEFAULT_MODELS.get(settings.llm_provider, ""),
                            settings.llm_api_key, settings.llm_base_url, settings.llm_timeout, settings.llm_enabled, self.breaker)]
        # 11 พ.ย. 2569: ตัวหลัก = none/off หมายถึง "ปิด AI ภายนอกทั้งหมด" → ไม่ใช้ตัวสำรองด้วย
        # (เดิมปิดตัวหลักแล้วตัวสำรองยังเรียก Gemini อยู่ ทำให้ปิด AI ไม่ได้จริงและชุดทดสอบออกอินเทอร์เน็ต)
        if settings.llm_provider not in ("", "none", "off") and settings.llm_fallback_provider not in ("", "none", "off"):
            fp = settings.llm_fallback_provider
            out.append(ProviderSpec("fallback", fp, settings.llm_fallback_model or DEFAULT_MODELS.get(fp, ""),
                                    settings.llm_fallback_api_key, settings.llm_fallback_base_url, settings.llm_fallback_timeout,
                                    settings.llm_fallback_enabled, self.fallback_breaker))
        return out

    def _secrets(self) -> list[str]:
        return [settings.llm_api_key, settings.llm_fallback_api_key]

    def _redact(self, text: object) -> str:
        return redact_secrets(text, self._secrets())

    @property
    def provider(self) -> str:
        """ผู้ให้บริการที่ตอบคำขอนี้ (ถ้ามี) ไม่เช่นนั้นผู้ให้บริการหลัก — engine.py ใช้บันทึก messages.provider = llm:<ชื่อ>"""
        return _served.get() or settings.llm_provider

    @property
    def model(self) -> str:
        return settings.llm_model or DEFAULT_MODELS.get(settings.llm_provider, "")

    @staticmethod
    def reachable(p: "ProviderSpec") -> bool:
        """21 พ.ย. 2569 (งาน F): โหมดฐานความรู้ (เน็ตล่ม/จำลองเน็ตล่ม) → ไม่เรียกผู้ให้บริการทางอินเทอร์เน็ต
        ไม่ต้องรอ timeout · ผู้ให้บริการในเครื่อง (ollama / base_url เป็น localhost) ยังใช้ได้"""
        if not connectivity.offline():
            return True
        return p.name == "ollama" and (not p.base_url or connectivity.is_local_url(p.base_url))

    @property
    def available(self) -> bool:
        return any(p.enabled and not p.breaker.is_open and self.reachable(p) for p in self.chain())

    def status(self) -> dict[str, Any]:
        """ฟิลด์และความหมายเดิม (ใช้ใน /api/health, /api/kiosk/config, /api/admin/system) — last_error ผ่านการปิดบังแล้ว"""
        return {
            "provider": settings.llm_provider if settings.llm_enabled else "offline",
            "model": self.model if settings.llm_enabled else "knowledge-base-only",
            "enabled": settings.llm_enabled,
            "circuit_open": self.breaker.is_open,
            "last_latency_ms": self.last_latency_ms,
            "last_error": self._redact(self.last_error),
            "calls": self.calls,
            "errors": self.errors,
        }

    def chain_status(self) -> list[dict[str, Any]]:
        """สถานะรายผู้ให้บริการ (สำหรับหน้าสถานะ AI ของหลังบ้านใน 6D) — ไม่มีค่าคีย์ มีเพียงตั้งแล้วหรือไม่"""
        return [{"role": p.role, "provider": p.name, "model": p.model, "enabled": p.enabled, "key_set": bool(p.api_key),
                 "base_url": redact_url(p.base_url or DEFAULT_BASE.get(p.name, "")), "timeout_s": p.timeout,
                 "circuit_open": p.breaker.is_open} for p in self.chain()]

    def _event_later(self, message: str) -> None:
        """บันทึก system_events ในเธรดแยก ไม่ให้คำตอบต้องรอ (เดิมเรียกตรง ๆ: บน SQLite คำขอที่ถือ lock อยู่ทำให้รอ ~15 วิ
        แล้วบันทึกไม่สำเร็จ) · ข้อความผ่าน _redact แล้ว · ไม่มี event loop (เช่นเรียกจากสคริปต์) → บันทึกทันที"""
        msg = self._redact(message)
        try:
            asyncio.get_running_loop().run_in_executor(None, record_event, "warn", "ai", msg)
        except RuntimeError:
            record_event("warn", "ai", msg)

    def _semaphore(self) -> asyncio.Semaphore:
        """จำกัดการเรียกผู้ให้บริการพร้อมกัน (VORA_AI_CONCURRENCY) · แยกตาม event loop (ชุดทดสอบ/สคริปต์ใช้หลาย loop)"""
        size = max(1, int(settings.ai_concurrency or 1))
        key = (id(asyncio.get_running_loop()), size)
        sem = self._sems.get(key)
        if sem is None:
            if len(self._sems) > 32:
                self._sems.clear()
            sem = self._sems[key] = asyncio.Semaphore(size)
        return sem

    # ---------------------------------------------------------------- เรียกใช้
    async def complete(self, system: str, user: str, max_tokens: int = 400, temperature: float = 0.2) -> str:
        chain = [p for p in self.chain() if p.enabled and self.reachable(p)]
        if not chain or not self.available:
            raise LLMError("LLM not available")
        t0 = time.time()
        self.calls += 1
        budget = settings.ai_budget_s if settings.ai_budget_s > 0 else sum(p.timeout for p in chain)
        end = t0 + budget
        dl = _deadline.get()
        if dl is not None:
            end = min(end, dl)                       # 6E-1: งบเวลาร่วมของทั้งคำขอ (compose + general ใช้ก้อนเดียวกัน)
        # 6E-3: กันคีย์/โทเคนที่อาจติดมากับข้อความ ไม่ให้ออกไปยังผู้ให้บริการ (ข้อความทั่วไปไม่เปลี่ยน)
        system, user = self._redact(system), self._redact(user)
        sem = self._semaphore()
        try:
            wait = end - time.time()
            try:
                if wait <= 0.05:
                    raise asyncio.TimeoutError
                await asyncio.wait_for(sem.acquire(), timeout=wait)      # เวลารอคิวนับรวมใน deadline
            except asyncio.TimeoutError:
                self.last_error = "time budget exhausted (queue)"
                raise LLMError(self.last_error) from None
            try:
                for p in chain:
                    if p.breaker.is_open:
                        continue
                    remaining = end - time.time()
                    if remaining <= 0.05:
                        self.last_error = "time budget exhausted"
                        break
                    if not rate.allow():
                        self.last_error = "local rate limit (VORA_LLM_RPM) or provider quota cooldown"
                        break                                    # ไม่นับเป็นการล่ม ไม่แตะ breaker
                    try:
                        limit = min(p.timeout, remaining)
                        async with httpx.AsyncClient(timeout=limit, transport=self._transport) as client:
                            # wait_for: บังคับงบเวลาแม้ผู้ให้บริการค้างแบบที่ timeout ของ httpx จับไม่ได้
                            res = await asyncio.wait_for(self._dispatch(client, p, system, user, max_tokens, temperature),
                                                         timeout=limit)
                    except Exception as e:  # noqa: BLE001
                        self.errors += 1
                        if isinstance(e, httpx.HTTPStatusError) and e.response.status_code == 429:
                            rate.quota_hit()                     # โควตาเต็ม: ไม่ส่งต่อตัวสำรอง (มักโปรเจกต์เดียวกัน) ไม่เปิด breaker
                            self.last_error = self._redact(f"quota exceeded (429) {p.name}")[:300]
                            self._event_later(f"LLM quota exceeded ({p.name}) — pause 30s")
                            break
                        p.breaker.failure()
                        self.last_error = self._redact(f"{type(e).__name__}: {e}")[:300]
                        self._event_later(f"LLM call failed ({p.name}): {self.last_error}")
                        continue
                    if res.finish != "stop":
                        # 6E-1: ผู้ให้บริการทำงานปกติ แต่คำตอบใช้ไม่ได้ → ไม่นับเป็นการล่ม (ไม่แตะ breaker) ไม่ส่งต่อผู้ให้บริการสำรอง
                        self.unusable += 1
                        self._event_later(f"LLM response unusable ({p.name}): finish={res.finish}")
                        raise LLMUnusable(res.finish, p.name)
                    p.breaker.success()
                    self.last_error = ""
                    self.last_served = p.name
                    _served.set(p.name)
                    return res.text.strip()
            finally:
                sem.release()
            raise LLMError(self._redact(self.last_error or "LLM not available"))
        finally:
            self.last_latency_ms = int((time.time() - t0) * 1000)

    async def _dispatch(self, client: httpx.AsyncClient, p: ProviderSpec, system: str, user: str, max_tokens: int,
                        temperature: float) -> ProviderResult:
        if p.name == "gemini":
            url = (p.base_url or "https://generativelanguage.googleapis.com/v1beta") + f"/models/{p.model}:generateContent"
            body = {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature},
            }
            if settings.llm_thinking:
                # 11 พ.ย. 2569: โมเดลที่คิดก่อนตอบนับโทเคนที่ใช้คิดรวมในโควตาคำตอบ → เผื่อให้ ไม่ให้คำตอบถูกตัด (finish=length)
                body["generationConfig"]["thinkingConfig"] = {"thinkingLevel": settings.llm_thinking}
                body["generationConfig"]["maxOutputTokens"] = max_tokens + GEMINI_THINKING_ALLOWANCE
            # S1: คีย์ทาง header (เดิมอยู่ใน query string ?key= ซึ่งติดไปกับข้อความผิดพลาดของ httpx)
            r = await client.post(url, headers={"x-goog-api-key": p.api_key}, json=body)
            r.raise_for_status()
            return parse_gemini(r.json())
        if p.name == "anthropic":
            url = (p.base_url or "https://api.anthropic.com/v1") + "/messages"
            headers = {"x-api-key": p.api_key, "anthropic-version": "2023-06-01"}
            body = {"model": p.model, "max_tokens": max_tokens, "temperature": temperature, "system": system,
                    "messages": [{"role": "user", "content": user}]}
            r = await client.post(url, headers=headers, json=body)
            r.raise_for_status()
            return parse_anthropic(r.json())
        if p.name in ("openai", "typhoon", "ollama"):
            base = p.base_url or DEFAULT_BASE[p.name]
            headers = {"Authorization": f"Bearer {p.api_key or 'ollama'}"}
            body = {"model": p.model, "max_tokens": max_tokens, "temperature": temperature,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
            r = await client.post(base.rstrip("/") + "/chat/completions", headers=headers, json=body)
            r.raise_for_status()
            return parse_openai(r.json())
        raise LLMError(f"unknown provider {p.name}")


llm = LLMClient()
