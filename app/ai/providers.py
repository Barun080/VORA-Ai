"""สวิตช์เลือกโมเดล AI จากหลังบ้าน (22 พ.ย. 2569)

ทำอะไร: ให้เจ้าหน้าที่ (admin) เลือกได้ว่า "ตอนนี้" VORA ใช้ผู้ให้บริการ AI ตัวไหนเรียบเรียงคำตอบ
  ไม่ใช้ AI ภายนอก / Gemini / Typhoon / OpenAI / Anthropic / Ollama (ในเครื่อง) + ตัวสำรอง
  มีผลทันที ไม่ต้องรีสตาร์ต · จำค่าไว้ในฐานข้อมูล (ตาราง settings คีย์ "ai_choice") รีสตาร์ตแล้วยังเป็นค่าเดิม
ความปลอดภัย: คีย์ API อยู่ในไฟล์ .env เท่านั้น — ไม่รับคีย์ทางหน้าเว็บ ไม่ส่งคีย์ออกทาง API ไม่บันทึกคีย์ลงฐานข้อมูล/audit
  ใส่คีย์ของแต่ละเจ้าใน .env เป็น VORA_KEY_<ชื่อ> เช่น VORA_KEY_TYPHOON=... แล้วกด "โหลดคีย์จาก .env ใหม่" (ไม่ต้องรีสตาร์ต)
ไม่เลือกอะไร (mode=env) = พฤติกรรมเดิมทุกประการ (ใช้ VORA_LLM_* ใน .env)
หลักการ: เปลี่ยนค่า settings.llm_* ในหน่วยความจำ — โค้ดเดิมทุกจุดอ่านค่าจากที่นี่อยู่แล้ว จึงไม่ต้องแก้ engine/llm
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any

import httpx

from ..config import ROOT_DIR, settings
from .llm import DEFAULT_BASE, DEFAULT_MODELS, CircuitBreaker, llm

SETTING_KEY = "ai_choice"
MODEL_RE = re.compile(r"^[A-Za-z0-9._:/\-]{1,80}$")


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    note: str
    needs_key: bool
    local: bool = False
    web_search: bool = False        # ค้นเว็บ ("หาข้อมูล…") ใช้ Google Search ของ Gemini เท่านั้น


PROVIDERS: dict[str, Provider] = {p.id: p for p in [
    Provider("none", "ไม่ใช้ AI ภายนอก", "ตอบจากคลังความรู้ที่เจ้าหน้าที่เขียนไว้ตรง ๆ · ไม่ต้องใช้คีย์ ไม่เสียเงิน ไม่แต่งข้อมูลแน่นอน "
             "แต่ประโยคไม่ยืดหยุ่น และคำถามความรู้ทั่วไป/แปลภาษาจะตอบไม่ได้", needs_key=False),
    Provider("gemini", "Google Gemini", "มีโควตาฟรีจาก Google AI Studio (จำกัดจำนวนครั้งต่อนาที/วัน) · รองรับค้นเว็บ", True, web_search=True),
    Provider("typhoon", "Typhoon (SCB 10X · เก่งภาษาไทย)", "API ฟรี ไม่ต้องใช้บัตรเครดิต (สมัครที่ playground.opentyphoon.ai) "
             "· จำกัดราว 200 ครั้ง/นาที · ข้อมูลการใช้งานถูกนำไปปรับปรุงโมเดล", True),
    Provider("openai", "OpenAI", "ต้องซื้อเครดิต", True),
    Provider("anthropic", "Anthropic Claude", "ต้องซื้อเครดิต", True),
    Provider("ollama", "Ollama (รันในเครื่อง)", "ไม่ต้องใช้เน็ต/คีย์ ไม่มีค่าใช้จ่าย · ต้องติดตั้ง Ollama และดาวน์โหลดโมเดลก่อน "
             "· ตอบช้ากว่าบนคอมพิวเตอร์ทั่วไป", False, local=True),
]}

# ค่าจาก .env ตอนเริ่มระบบ — ใช้คืนค่าเมื่อเลือก "ตามไฟล์ .env" และใช้หาคีย์เดิม (VORA_LLM_API_KEY ของผู้ให้บริการหลัก)
_ENV_FIELDS = ("llm_provider", "llm_model", "llm_api_key", "llm_base_url", "llm_timeout",
               "llm_fallback_provider", "llm_fallback_model", "llm_fallback_api_key", "llm_fallback_base_url",
               "llm_fallback_timeout")
_ENV0: dict[str, Any] = {f: getattr(settings, f) for f in _ENV_FIELDS}
_current: dict[str, Any] = {"mode": "env"}


def _dotenv() -> dict[str, str]:
    """อ่านเฉพาะ VORA_KEY_* / VORA_MODEL_* / VORA_BASE_* จากไฟล์ .env ใหม่ทุกครั้ง (เพิ่มคีย์แล้วไม่ต้องรีสตาร์ต)
    ปิดได้ด้วย VORA_DOTENV_RELOAD=0 (ชุดทดสอบปิดไว้ ไม่ให้อ่านคีย์จริงของเครื่อง)"""
    if os.environ.get("VORA_DOTENV_RELOAD", "1").strip().lower() in ("0", "false", "no", "off"):
        return {}
    path = ROOT_DIR / ".env"
    out: dict[str, str] = {}
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            if k.startswith(("VORA_KEY_", "VORA_MODEL_", "VORA_BASE_")):
                out[k] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def _lookup(prefix: str, pid: str, file_vals: dict[str, str]) -> str:
    name = f"{prefix}{pid.upper()}"
    return (file_vals.get(name) or os.environ.get(name, "")).strip()


def key_for(pid: str, file_vals: dict[str, str] | None = None) -> str:
    fv = _dotenv() if file_vals is None else file_vals
    k = _lookup("VORA_KEY_", pid, fv)
    if k:
        return k
    if _ENV0["llm_provider"] == pid and _ENV0["llm_api_key"]:
        return _ENV0["llm_api_key"]
    if _ENV0["llm_fallback_provider"] == pid and _ENV0["llm_fallback_api_key"]:
        return _ENV0["llm_fallback_api_key"]
    return ""


def default_model_for(pid: str, file_vals: dict[str, str] | None = None) -> str:
    fv = _dotenv() if file_vals is None else file_vals
    m = _lookup("VORA_MODEL_", pid, fv)
    if m:
        return m
    if _ENV0["llm_provider"] == pid and _ENV0["llm_model"]:
        return _ENV0["llm_model"]
    if _ENV0["llm_fallback_provider"] == pid and _ENV0["llm_fallback_model"]:
        return _ENV0["llm_fallback_model"]
    return DEFAULT_MODELS.get(pid, "")


def base_for(pid: str, file_vals: dict[str, str] | None = None) -> str:
    fv = _dotenv() if file_vals is None else file_vals
    b = _lookup("VORA_BASE_", pid, fv)
    if b:
        return b
    if _ENV0["llm_provider"] == pid and _ENV0["llm_base_url"]:
        return _ENV0["llm_base_url"]
    if _ENV0["llm_fallback_provider"] == pid and _ENV0["llm_fallback_base_url"]:
        return _ENV0["llm_fallback_base_url"]
    return ""


def has_key(pid: str, file_vals: dict[str, str] | None = None) -> bool:
    p = PROVIDERS.get(pid)
    return bool(p) and (not p.needs_key or bool(key_for(pid, file_vals)))


def _timeout(pid: str, cloud: float) -> float:
    return max(float(cloud or 0), 30.0) if pid == "ollama" else float(cloud or 12.0)


def _reset_runtime() -> None:
    llm.breaker = CircuitBreaker()
    llm.fallback_breaker = CircuitBreaker()
    llm.last_error = ""
    try:
        from . import engine
        engine._llm_cache.clear()           # คำตอบในแคชมาจากโมเดลเดิม → ล้าง ให้เห็นผลของโมเดลใหม่ทันที
    except Exception:  # noqa: BLE001
        pass


def validate(choice: dict[str, Any] | None) -> dict[str, Any]:
    """ตรวจค่าที่เลือก คืนค่าที่สะอาด หรือ raise ValueError(ข้อความภาษาไทย)"""
    if not choice or choice.get("mode", "custom") == "env" or choice.get("primary") in (None, "", "env"):
        return {"mode": "env"}
    fv = _dotenv()
    primary = str(choice.get("primary", "")).strip().lower()
    fallback = str(choice.get("fallback") or "none").strip().lower()
    if primary not in PROVIDERS:
        raise ValueError("ไม่รู้จักผู้ให้บริการที่เลือก")
    if fallback not in PROVIDERS:
        raise ValueError("ไม่รู้จักตัวสำรองที่เลือก")
    if primary == "none" or fallback == primary:
        fallback = "none"
    for pid in (primary, fallback):
        if pid != "none" and not has_key(pid, fv):
            raise ValueError(f"ยังไม่มีคีย์ของ {PROVIDERS[pid].label} — ใส่ VORA_KEY_{pid.upper()}=... ในไฟล์ .env "
                             f"แล้วกด \"โหลดคีย์จาก .env ใหม่\"")
    models: dict[str, str] = {}
    for pid, m in (choice.get("models") or {}).items():
        m = str(m or "").strip()
        if pid in (primary, fallback) and pid != "none" and m:
            if not MODEL_RE.match(m):
                raise ValueError(f"ชื่อโมเดลของ {PROVIDERS[pid].label} ไม่ถูกต้อง")
            models[pid] = m
    return {"mode": "custom", "primary": primary, "fallback": fallback, "models": models}


def apply(choice: dict[str, Any] | None) -> dict[str, Any]:
    """ใช้ค่าที่เลือกทันที (ไม่ต้องรีสตาร์ต) · ค่า env = คืนค่าเดิมจาก .env"""
    clean = validate(choice)
    if clean["mode"] == "env":
        for f, v in _ENV0.items():
            setattr(settings, f, v)
    else:
        fv = _dotenv()
        p, f = clean["primary"], clean["fallback"]
        settings.llm_provider = p
        settings.llm_api_key = key_for(p, fv) if p != "none" else ""
        settings.llm_model = clean["models"].get(p) or (default_model_for(p, fv) if p != "none" else "")
        settings.llm_base_url = base_for(p, fv) if p != "none" else ""
        settings.llm_timeout = _timeout(p, _ENV0["llm_timeout"])
        settings.llm_fallback_provider = f
        settings.llm_fallback_api_key = key_for(f, fv) if f != "none" else ""
        settings.llm_fallback_model = clean["models"].get(f) or (default_model_for(f, fv) if f != "none" else "")
        settings.llm_fallback_base_url = base_for(f, fv) if f != "none" else ""
        settings.llm_fallback_timeout = _timeout(f, _ENV0["llm_fallback_timeout"])
    _current.clear()
    _current.update(clean)
    _reset_runtime()
    return clean


def current() -> dict[str, Any]:
    return dict(_current)


async def ollama_models(timeout: float = 1.5) -> dict[str, Any]:
    """ตรวจว่า Ollama ในเครื่องเปิดอยู่ไหม และมีโมเดลอะไรบ้าง (ไม่ออกอินเทอร์เน็ต)"""
    base = (base_for("ollama") or DEFAULT_BASE["ollama"]).rstrip("/")
    root = base[:-3] if base.endswith("/v1") else base
    try:
        async with httpx.AsyncClient(timeout=timeout, transport=llm._transport) as c:
            r = await c.get(root + "/api/tags")
            r.raise_for_status()
            names = [str(m.get("name", "")) for m in (r.json().get("models") or []) if m.get("name")]
            return {"running": True, "models": names[:30]}
    except Exception:  # noqa: BLE001 - ไม่ได้ติดตั้ง/ไม่ได้เปิด
        return {"running": False, "models": []}


def describe(ollama: dict[str, Any] | None = None) -> dict[str, Any]:
    """สถานะสำหรับหน้าหลังบ้าน — ไม่มีค่าคีย์ใด ๆ (มีเพียงตั้งแล้วหรือไม่)"""
    fv = _dotenv()
    cur = current()
    options = []
    for p in PROVIDERS.values():
        ready = has_key(p.id, fv)
        if p.local and ollama is not None:
            ready = ready and ollama.get("running", False)
        options.append({"id": p.id, "label": p.label, "note": p.note, "needs_key": p.needs_key, "local": p.local,
                        "key_set": bool(key_for(p.id, fv)) if p.needs_key else None,
                        "key_env": f"VORA_KEY_{p.id.upper()}" if p.needs_key else "",
                        "default_model": default_model_for(p.id, fv) if p.id != "none" else "",
                        "web_search": p.web_search, "ready": ready})
    active = [{k: c[k] for k in ("role", "provider", "model", "enabled", "key_set", "circuit_open")} for c in llm.chain_status()
              if c["provider"] not in ("", "none", "off")]
    return {
        "mode": cur.get("mode", "env"), "primary": cur.get("primary"), "fallback": cur.get("fallback"),
        "models": cur.get("models", {}),
        "env": {"provider": _ENV0["llm_provider"], "model": _ENV0["llm_model"],
                "fallback": _ENV0["llm_fallback_provider"], "fallback_model": _ENV0["llm_fallback_model"]},
        "options": options, "active": active, "ai_on": bool(settings.llm_enabled),
        "web_search": any(a["provider"] == "gemini" and a["enabled"] for a in active),
        "ollama": ollama,
    }


def load_saved(db) -> None:
    """ตอนเริ่มระบบ: ใช้ค่าที่เจ้าหน้าที่เลือกไว้ล่าสุด · ค่าเสีย/คีย์หาย → กลับไปใช้ .env และบันทึกเหตุการณ์"""
    from ..services import get_setting, record_event
    saved = get_setting(db, SETTING_KEY)
    if not saved:
        return
    try:
        apply(saved)
    except ValueError as e:
        apply(None)
        record_event("warn", "ai", f"ai_choice ใช้ไม่ได้ ({e}) — ใช้ค่าจาก .env แทน")


def _reset_for_tests() -> None:
    apply(None)
