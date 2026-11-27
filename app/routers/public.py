"""API สำหรับหน้าจอผู้ใช้ (Kiosk บนหุ่นยนต์ และหน้ามือถือ) — ไม่ต้องเข้าสู่ระบบ"""
from __future__ import annotations

import asyncio
import hashlib
import socket
import time
from datetime import datetime
from typing import Optional

import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import brain, connectivity, greetings, tts
from ..ai.engine import (ERROR_CONTRACT, _ctx, _news_card, _program_card, active_news, answer, answer_vision, apply_online,
                         get_or_create_session, school_website)
from ..ai.intent import intent_classifier
from ..ai.llm import llm
from ..ai.training import active_vision_model
from ..config import settings
from ..db import DIALECT, engine, get_db
from ..models import Feedback, Message, News, Program
from ..realtime import hub
from ..robot.bridge import bridge
from ..scheduler import scheduler
from ..services import all_settings, get_setting, record_event, set_setting

router = APIRouter(prefix="/api", tags=["public"])
STARTED_AT = time.time()

# จำกัดอัตราการเรียกต่อ IP เพื่อป้องกันการกดรัว/สแปม (สำคัญเมื่อเปิดให้มือถือเข้าผ่าน QR)
_rate: dict[str, list[float]] = {}


def rate_limit(request: Request, limit: int = 30, window: float = 60) -> None:
    ip = request.client.host if request.client else "?"
    now = time.time()
    hits = [t for t in _rate.get(ip, []) if now - t < window]
    if len(hits) >= limit and ip not in ("127.0.0.1", "::1"):
        raise HTTPException(429, "ส่งคำถามถี่เกินไป กรุณารอสักครู่")
    hits.append(now)
    _rate[ip] = hits


# ---------------------------------------------------------------- Phase 6 · 6E-4 (F1/F1b): server ตัดสินว่าเป็น kiosk หรือไม่
def client_host(conn) -> str:
    """IP ผู้เรียก (Request หรือ WebSocket) · ระบบรันตรงด้วย uvicorn ไม่ผ่าน proxy จึงไม่อ่าน X-Forwarded-For (ปลอมได้)"""
    return conn.client.host if conn.client else ""


def is_trusted_kiosk(conn, claimed: str = "kiosk") -> bool:
    """สิทธิ์ kiosk (ยกเว้น rate limit · สั่งท่าหุ่นยนต์) ได้เฉพาะคำขอจากเครื่องใน VORA_KIOSK_TRUSTED_HOSTS
    ค่า channel ที่ client ส่งมาไม่ให้สิทธิ์ แต่ "ลดสิทธิ์" ได้ (เช่นหน้ามือถือที่เปิดบนเครื่องหุ่นยนต์ส่ง mobile)
    VORA_CHANNEL_TRUST=legacy → เชื่อ channel จาก client แบบก่อน 6E (ทาง rollback)"""
    if settings.channel_trust == "legacy":
        return claimed == "kiosk"
    return claimed == "kiosk" and client_host(conn) in settings.kiosk_trusted_hosts


def is_display_kiosk(conn, claimed: str = "kiosk") -> bool:
    """25 พ.ย. 2569: หน้าจอหุ่นยนต์ (เครื่องหลัก) หรือจอในวง LAN ที่ผู้ดูแลอนุมัติแล้ว (routers/screens.py)
    = ถามไม่จำกัด รับประกาศสด ทักทาย/กล้องจำป้ายได้ · การสั่งท่าหุ่นยนต์จริงยังใช้ is_trusted_kiosk เท่านั้น"""
    if is_trusted_kiosk(conn, claimed):
        return True
    if claimed != "kiosk" or settings.channel_trust == "legacy":
        return False
    from .screens import approved_screen
    return approved_screen(conn) is not None


def _require_display_kiosk(request: Request) -> None:
    if not is_display_kiosk(request):
        record_event("warn", "security", f"untrusted kiosk call {request.url.path} from {client_host(request)}")
        raise HTTPException(403, "อนุญาตเฉพาะหน้าจอบนตัวหุ่นยนต์ หรือจอในวง LAN ที่อนุมัติแล้ว")


def _require_trusted_kiosk(request: Request) -> None:
    """endpoint ที่สั่งพฤติกรรมของหุ่นยนต์และมีไว้สำหรับหน้าจอบนตัวหุ่นยนต์เท่านั้น (ทักทาย / กล้องจำป้าย)"""
    if not is_trusted_kiosk(request):
        record_event("warn", "security", f"untrusted kiosk call {request.url.path} from {client_host(request)}")
        raise HTTPException(403, "อนุญาตเฉพาะหน้าจอบนตัวหุ่นยนต์")


def wants_contract_v2(request: Request) -> bool:
    """6E-2: client ขอ answer_source / verification / notice ด้วย header X-VORA-Contract: 2 (ไม่ส่ง = รูปแบบเดิม)"""
    return request.headers.get("x-vora-contract", "").strip() == "2"


def _lan_ip() -> str:
    """25 พ.ย. 2569: เลือก IP วง LAN ที่มือถือเข้าถึงได้ (ข้าม VPN/127.0.0.1) — app/netaddr.py"""
    from .. import netaddr
    return netaddr.best_lan_ip()[0]


MOBILE_BASE_KEY = "mobile_base"          # 25 พ.ย. 2569: ที่อยู่สำหรับคิวอาร์มือถือที่ผู้ดูแลล็อกไว้ ("" = อัตโนมัติ)
THEME_KEY = "kiosk_theme"                # ธีมของหน้าจอหุ่นยนต์ (หน้ามือถือใช้ตาม)


def mobile_base(db: Session) -> dict:
    """ที่อยู่ฐานของหน้ามือถือ — ลำดับ: VORA_PUBLIC_URL → ที่ผู้ดูแลล็อกในหลังบ้าน → อัตโนมัติ (https ถ้าเปิดอยู่)
    คืน {base, ok, source, warning} · ok=False = มือถือน่าจะเข้าไม่ได้ (ไม่มีเครือข่าย LAN)"""
    import os
    from .. import netaddr
    if settings.public_url:
        return {"base": settings.public_url.rstrip("/"), "ok": True, "source": "env", "warning": ""}
    pinned = (get_setting(db, MOBILE_BASE_KEY) or "").strip().rstrip("/")
    if pinned:
        return {"base": pinned, "ok": True, "source": "admin", "warning": ""}
    ip, ok = netaddr.best_lan_ip()
    # 25 พ.ย. 2569 (รอบ 2): คิวอาร์ใช้ http เสมอ → สแกนแล้วเปิดได้ทันที ไม่มีหน้าเตือน "การเชื่อมต่อไม่ปลอดภัย"
    # https (ใบรับรองสร้างเอง) ใช้เฉพาะตอนผู้ใช้กดปุ่มไมค์บนมือถือ (https_base)
    https = os.environ.get("VORA_HTTPS_ACTIVE") == "1" and settings.https_port > 0
    base = f"http://{ip}:{settings.port}"
    warn = "" if ok else "เครื่องหลักยังไม่ได้เชื่อมต่อเครือข่าย LAN — มือถือสแกนแล้วจะเข้าไม่ได้"
    return {"base": base, "ok": ok, "source": "auto", "warning": warn,
            "https_base": f"https://{ip}:{settings.https_port}" if https and ok else ""}


class ChatIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    session_id: Optional[str] = None
    lang: Optional[str] = None
    # VORA NEXT: สาขาที่หน้าจอกำลังแสดงอยู่ (เส้นทางการสมัคร / รายละเอียดสาขา / แผนผังความรู้) — ไม่บังคับ
    # ใช้เป็น "บริบท" ของคำถามที่ไม่ได้ระบุชื่อสาขา เช่น "สาขานี้เรียนอะไร" · ถ้าคำถามระบุชื่อสาขาเอง ชื่อในคำถามสำคัญกว่า
    context_program_id: Optional[int] = None
    # 24 พ.ย. 2569: ป๊อปอัปของสิ่งที่กล้องจำได้ที่เปิดอยู่บนจอ (ไม่บังคับ) — ถามเรื่องสิ่งนั้นจะตอบจากข้อมูลของสิ่งนั้น
    vision_item_id: Optional[int] = None
    channel: str = "kiosk"
    input_mode: str = "text"


class VisionIn(BaseModel):
    label: str
    confidence: float = 0.0
    session_id: Optional[str] = None
    lang: str = "th"
    channel: str = "kiosk"


class GreetIn(BaseModel):
    session_id: Optional[str] = None
    lang: str = "th"
    trigger: str = "face"          # face | gesture | touch | patrol
    people: int = 1
    context: Optional[str] = None  # 16 พ.ย. 2569: หน้านำเสนอที่เปิดอยู่ / ชื่อบริบท (ไม่ส่ง = เซิร์ฟเวอร์ตัดสินเอง) — ดู app/greetings.py
    emoji: bool = False            # ผู้เรียกตัด Emoji ก่อนส่งเสียงพูดแล้ว → ส่งข้อความที่มี Emoji ได้ (หน้าจอรุ่นเก่าไม่ส่ง = ไม่มี Emoji)


class FeedbackIn(BaseModel):
    session_id: str = ""
    message_id: Optional[int] = None
    kind: str = "thumb"              # thumb | rating | wrong_answer | survey
    rating: int = 0
    comment: str = Field(default="", max_length=1000)
    channel: str = "kiosk"


class StateIn(BaseModel):
    state: str


def _db_ping() -> dict:
    """ตรวจฐานข้อมูลแบบเบา (select 1) สำหรับแผงสถานะบนหน้า Kiosk — ไม่แสดงรหัสผ่านหรือชื่อโฮสต์"""
    t0 = time.time()
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
        return {"ok": True, "engine": DIALECT, "latency_ms": int((time.time() - t0) * 1000)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "engine": DIALECT, "error": type(e).__name__}


@router.get("/health")
def health():
    st = bridge.public_status()
    ai = llm.status()
    return {"ok": True, "uptime_s": int(time.time() - STARTED_AT), "intent_model": intent_classifier.version,
            "robot_connected": bridge.connected, "time": datetime.now().isoformat(timespec="seconds"),
            # ข้อมูลเพิ่มสำหรับแผงสถานะระบบของหน้า Kiosk (ฟิลด์เดิมไม่เปลี่ยน)
            "db": _db_ping(),
            "ai": {"ready": intent_classifier.version > 0, "intent_model": intent_classifier.version,
                   "llm_provider": ai.get("provider"), "llm_circuit_open": ai.get("circuit_open")},
            "robot": {k: st.get(k) for k in ("connected", "online", "ready", "estop", "battery", "driver")},
            # 21 พ.ย. 2569 (งาน F): โหมดการทำงาน ai | kb (เน็ตล่ม/จำลองเน็ตล่ม) — หน้าจอแสดงไฟสถานะ + ปุ่มคำถามยอดฮิต
            "net": connectivity.status()}


@router.get("/kiosk/config")
def kiosk_config(request: Request, db: Session = Depends(get_db)):
    cfg = all_settings(db)
    mb = mobile_base(db)                 # 25 พ.ย. 2569: เลือก IP ใหม่ทุกครั้ง + https + ผู้ดูแลล็อกได้
    base = mb["base"]
    return {
        "school_name_th": cfg["school_name_th"], "school_name_en": cfg["school_name_en"],
        "robot_name": cfg["robot_name"], "greeting_th": cfg["greeting_th"], "greeting_en": cfg["greeting_en"],
        "languages": cfg["languages"], "auto_greeting": cfg["auto_greeting"], "attract_mode": cfg["attract_mode"],
        # 27 พ.ย. 2569: ประกาศเฉพาะตาราง · โหมดหน้าจอว่าง · ช่วงงดเสียง (หน้าจอใช้ด้วย)
        "pr_schedule_only": settings.pr_schedule_only, "idle_mode": cfg.get("idle_mode") if cfg.get("idle_mode") in ("rotate", "off") else "off",
        "quiet_hours": cfg.get("quiet_hours") or "",
        "avatar_motion": cfg.get("avatar_motion", 150),
        "voice_rate": cfg["voice_rate"], "greeting_cooldown_s": settings.greeting_cooldown_s,
        "idle_attract_s": settings.idle_attract_s, "server_tts": tts.available(), "tts": tts.status(),
        "ai": llm.status(), "mobile_url": f"{base}/m/", "mobile_ok": mb["ok"], "mobile_warning": mb["warning"],
        "mobile_https_url": f"{mb['https_base']}/m/" if mb.get("https_base") else "",
        "theme": cfg.get(THEME_KEY) if cfg.get(THEME_KEY) in ("light", "dark") else "dark", "has_vision_model": active_vision_model(db) is not None,
        "robot": {"connected": bridge.connected, "driver": bridge.driver_kind},
        "admission_form": {"url": cfg.get("admission_form_url") or "", "name": cfg.get("admission_form_name") or ""},
        "base_url": base,
        # 12 พ.ย. 2569: หน้าพิมพ์ใบสมัครบนมือถือ (QR ขั้นสุดท้าย) · เว็บไซต์วิทยาลัย · ขั้นตอนสมัครออนไลน์ (ข้อมูลจากหลังบ้าน)
        "apply_form_url": f"{base}/m/apply.html",
        "website": school_website(db, cfg),
        "apply_online": {"th": apply_online(cfg, "th"), "en": apply_online(cfg, "en")},
    }


async def _robot_gesture(name: str | None) -> None:
    if name:
        asyncio.create_task(bridge.gesture(name))


@router.post("/chat")
async def chat(body: ChatIn, request: Request, db: Session = Depends(get_db)):
    # 6E-4 (F1): สิทธิ์ kiosk ตัดสินจาก IP ผู้เรียก ไม่ใช่ body.channel (เดิม client ส่ง channel=kiosk เพื่อข้าม rate limit
    # และสั่งท่าหุ่นยนต์ได้) · คำขอที่ไม่ใช่ kiosk ที่เชื่อถือได้ = mobile เสมอ
    trusted = is_trusted_kiosk(request, body.channel)
    display = trusted or is_display_kiosk(request, body.channel)      # 25 พ.ย. 2569: + จอในวง LAN ที่อนุมัติแล้ว
    channel = "kiosk" if display else ("mobile" if settings.channel_trust != "legacy" else body.channel[:16])
    if not display:                      # จำกัดเฉพาะช่องทางสาธารณะ (มือถือ) ไม่จำกัดจอหุ่นยนต์/จอที่อนุมัติ
        rate_limit(request)
    v2 = wants_contract_v2(request)
    session_id = body.session_id
    if body.context_program_id:
        p = db.get(Program, body.context_program_id)
        if p and p.status == "published":     # ไม่รับสาขาที่ไม่มี/ไม่ได้เผยแพร่ (ไม่ใช้ข้อมูลที่ไม่ได้อนุมัติ)
            if not session_id:
                session_id = get_or_create_session(db, None, channel, body.lang or "th", body.input_mode[:16]).id
            _ctx(session_id)["program_id"] = p.id
    if body.vision_item_id and settings.vision_detail:
        if not session_id:
            session_id = get_or_create_session(db, None, channel, body.lang or "th", body.input_mode[:16]).id
        _ctx(session_id)["vision_focus"] = body.vision_item_id
    try:
        res = await answer(db, body.text, session_id, body.lang, channel, body.input_mode[:16])
    except Exception as e:  # noqa: BLE001 - ไม่ให้หน้าจอค้าง ตอบกลับอย่างสุภาพเสมอ
        db.rollback()
        # 6E-3: ไม่เก็บคำถามดิบใน system_events — เก็บเพียงความยาวและ hash (ใช้จับคู่เหตุการณ์ซ้ำได้ ย้อนกลับเป็นข้อความไม่ได้)
        record_event("error", "ai", f"answer pipeline error: {type(e).__name__}", text_len=len(body.text),
                     text_sha256=hashlib.sha256(body.text.encode("utf-8")).hexdigest()[:16], channel=channel)
        lang = body.lang or "th"
        fallback = {"session_id": body.session_id, "message_id": None, "answered": False, "lang": lang,
                    "text": "ขออภัยค่ะ ระบบขัดข้องชั่วคราว ลองถามใหม่อีกครั้งนะคะ" if lang == "th"
                    else "Sorry, something went wrong. Please try again.",
                    "media": {"image": "", "video": "", "cards": []}, "gesture": "shrug", "emotion": "sorry",
                    "suggestions": [], "intent": "error", "provider": "error", "latency_ms": 0, "sources": []}
        return {**fallback, **ERROR_CONTRACT} if v2 else fallback
    contract = getattr(res, "contract", None)
    if trusted:                          # 6E-4: ท่าหุ่นยนต์เฉพาะหน้าจอบนตัวหุ่นยนต์ที่เชื่อถือได้
        await _robot_gesture(res.get("robot_action") or res.get("gesture"))
    await hub.broadcast("chat.message", {"q": body.text, "a": res["text"], "intent": res["intent"],
                                         "answered": res["answered"], "channel": channel,
                                         "mode": body.input_mode, "latency_ms": res["latency_ms"],
                                         "provider": res["provider"]}, roles=("admin",))
    await brain.publish(getattr(res, "trace", None))     # 21 พ.ย. 2569 (งาน A): สมองโปร่งใส — หลังบ้านเท่านั้น
    if v2 and contract:                  # 6E-2: เพิ่ม 3 ฟิลด์เฉพาะเมื่อขอ v2 · ไม่ขอ = 18 ฟิลด์เดิมทุกประการ
        return {**res, **contract}
    return dict(res)


@router.post("/vision/recognized")
async def vision_recognized(body: VisionIn, request: Request, db: Session = Depends(get_db)):
    _require_display_kiosk(request)      # 25 พ.ย. 2569: จอในวง LAN ที่อนุมัติแล้วใช้กล้องจำป้ายได้
    res = await answer_vision(db, body.label, body.session_id, body.lang if body.lang in ("th", "en") else "th", body.channel)
    if is_trusted_kiosk(request):         # 6E-4 (F1b): ท่า present ของหุ่นยนต์จริง → เฉพาะเครื่องบนตัวหุ่นยนต์
        await _robot_gesture("present")
    await hub.broadcast("chat.message", {"q": f"[กล้องเห็น: {body.label} {body.confidence:.0%}]", "a": res["text"],
                                         "intent": "vision", "answered": res["answered"], "channel": body.channel,
                                         "mode": "vision", "latency_ms": res["latency_ms"]}, roles=("admin",))
    return res


@router.get("/vision/model")
def vision_model(db: Session = Depends(get_db)):
    m = active_vision_model(db)
    if not m:
        return {"available": False}
    from ..models import VisionClass
    names = {v.label: {"name": v.display_name, "active": v.active, "action": v.action} for v in db.query(VisionClass).all()}
    return {"available": True, **m, "names": names}


def _greeting_text(db: Session, body: GreetIn, cfg: dict, lang: str, hour: int) -> str:
    """16 พ.ย. 2569: คำทักทายตามบริบท + กันซ้ำ ทั้งไทยและอังกฤษ (app/greetings.py · แม่แบบคงที่ ไม่ใช้ LLM)
    อังกฤษขึ้นต้นด้วย Good morning/afternoon/evening ตามเวลาปัจจุบัน
    เลือกไม่ได้ด้วยเหตุใดก็ตาม → ใช้คำทักทายเดิมจากหลังบ้าน (คำขอไม่ล้มเหลวเพราะการเลือกคำทักทาย)"""
    try:
        from ..timeline import build_timeline
        period = bool(build_timeline(db)["important"])     # ช่วงรับสมัคร = มีข่าวรับสมัครที่มีวันจริงภายใน 60 วัน (กติกาเดียวกับ Time Portal)
        g = greetings.choose(body.context, trigger=body.trigger, admission_period=period)
        return g.display(body.people, emoji=body.emoji, lang=lang, hour=hour)
    except Exception:  # noqa: BLE001
        if lang == "en":
            prefix = "Good morning! " if hour < 12 else "Good afternoon! " if hour < 17 else "Good evening! "
            return ("Hello everyone! " if body.people > 1 else prefix) + cfg["greeting_en"]
        text = cfg["greeting_th"]
        return "สวัสดีค่ะทุกคน " + text.replace("สวัสดีค่ะ ", "") if body.people > 1 else text


@router.post("/greet")
async def greet(body: GreetIn, request: Request, db: Session = Depends(get_db)):
    """ทักทายเชิงรุก (Auto Greeting) เมื่อกล้องตรวจพบผู้ใช้ — เริ่มบทสนทนาโดยไม่ต้องรอคำสั่ง"""
    _require_display_kiosk(request)      # 25 พ.ย. 2569: จอในวง LAN ที่อนุมัติแล้วทักทายได้ (ไม่สั่งท่าหุ่นยนต์)
    cfg = all_settings(db)
    lang = body.lang if body.lang in ("th", "en") else "th"
    sess = get_or_create_session(db, body.session_id, "kiosk", lang, "greeting")
    hour = datetime.now().hour
    text = _greeting_text(db, body, cfg, lang, hour)
    top = active_news(db, limit=1)
    cards = [_news_card(top[0], lang)] if top else []
    db.add(Message(session_id=sess.id, role="bot", text=text, input_mode="auto", lang=lang, intent="auto_greeting",
                   answered=True, provider="rules"))
    sess.message_count += 1
    db.commit()
    if is_trusted_kiosk(request):         # 6E-4 (F1b): ท่า wave ของหุ่นยนต์จริง → เฉพาะเครื่องบนตัวหุ่นยนต์
        await _robot_gesture("wave")
    await hub.broadcast("chat.message", {"q": f"[ตรวจพบผู้ใช้ {body.people} คน → ทักทายอัตโนมัติ]", "a": text,
                                         "intent": "auto_greeting", "answered": True, "channel": "kiosk",
                                         "mode": "auto"}, roles=("admin",))
    return {"session_id": sess.id, "text": text, "lang": lang, "gesture": "wave", "emotion": "happy",
            "media": {"image": "", "video": "", "cards": cards},
            "suggestions": ["มีสาขาอะไรบ้าง", "สมัครเรียนยังไง", "มีข่าวอะไรบ้าง"] if lang == "th"
            else ["What programs do you offer?", "How do I apply?", "Latest news"]}


@router.post("/feedback")
async def feedback(body: FeedbackIn, request: Request, db: Session = Depends(get_db)):
    rate_limit(request, limit=20)
    if body.kind not in ("thumb", "rating", "wrong_answer", "survey"):
        raise HTTPException(400, "invalid feedback kind")
    fb = Feedback(session_id=body.session_id[:32], message_id=body.message_id, kind=body.kind,
                  rating=max(-1, min(5, body.rating)), comment=body.comment.strip(), channel=body.channel[:16])
    db.add(fb)
    db.commit()
    await hub.broadcast("feedback", {"kind": fb.kind, "rating": fb.rating, "comment": fb.comment}, roles=("admin",))
    return {"ok": True, "id": fb.id}


def _location(n: News) -> dict:
    """สถานที่ตามที่เจ้าหน้าที่บันทึก (ไม่มี = null ทั้งหมด หน้าจอแสดง "ไม่ระบุสถานที่")"""
    return {"location": n.location, "location_type": n.location_type, "location_map_url": n.location_map_url}


@router.get("/news")
def list_news(kind: Optional[str] = None, limit: int = 10, lang: str = "th", db: Session = Depends(get_db)):
    items = active_news(db, [kind] if kind else None, limit=min(limit, 30))
    return [{**_news_card(n, lang), "kind": n.kind, "title_th": n.title_th, "title_en": n.title_en,
             "body_th": n.body_th, "body_en": n.body_en, "video": n.video_url, "priority": n.priority,
             "event_date": n.event_date, "publish_at": n.publish_at, **_location(n)} for n in items]


@router.get("/news/{news_id}")
def get_news(news_id: int, db: Session = Depends(get_db)):
    n = db.get(News, news_id)
    if not n or n.status != "published":
        raise HTTPException(404, "ไม่พบข่าว")
    n.view_count += 1
    db.commit()
    return {"id": n.id, "kind": n.kind, "title_th": n.title_th, "title_en": n.title_en, "body_th": n.body_th,
            "body_en": n.body_en, "image": n.image_url, "video": n.video_url, "event_date": n.event_date, **_location(n),
            "gallery": [x.strip() for x in (n.gallery or "").splitlines() if x.strip()]}


@router.get("/programs")
def list_programs(lang: str = "th", db: Session = Depends(get_db)):
    progs = db.query(Program).filter(Program.status == "published").order_by(Program.level, Program.id).all()
    out = []
    for p in progs:
        card = _program_card(p, lang)
        if not card.get("image"):               # 25 พ.ย. 2569: ไม่มีภาพหลัก → ใช้ภาพบรรยากาศภาพแรก
            card["image"] = next((u.strip() for u in (p.gallery or "").splitlines() if u.strip()), "")
        out.append({**card, "code": p.code, "level": p.level, "name_th": p.name_th, "name_en": p.name_en,
                    "department": p.department, "suits_th": p.suits_th or "", "suits_en": p.suits_en or ""})
    return out


_MORE_TOPIC = (("learn", ("เรียนวิชา", "เรียนอะไร", "เรียนเกี่ยวกับ")), ("level", ("ระดับ",)),
               ("people", ("อาจารย์", "ครู", "หัวหน้า")), ("activity", ("กิจกรรม", "รางวัล", "แข่ง", "ผลงาน")))


@router.get("/programs/{pid}/more")
def program_more(pid: int, db: Session = Depends(get_db)):
    """25 พ.ย. 2569 (หน้ามือถือ): ข้อมูลเพิ่มของสาขาจากฐานความรู้ที่อนุมัติแล้วเท่านั้น
    (รายวิชาจากตารางเรียน · ระดับที่เปิด · ครู · กิจกรรม/รางวัล) — จับคู่จากชื่อสาขาและคำค้นของสาขา ไม่แต่งเพิ่ม"""
    from ..models import KnowledgeItem
    p = db.get(Program, pid)
    if not p or p.status != "published":
        raise HTTPException(404, "ไม่พบสาขา")
    name = (p.name_th or "").strip()
    terms = {name, name.replace("แผนก", "").replace("สาขา", "").strip()}
    terms |= {t.strip() for t in (p.keywords or "").split(",")}
    for cut in ("และหุ่นยนต์", "เทคนิค"):
        if cut in name and len(name.replace(cut, "")) >= 4:
            terms.add(name.replace(cut, "").strip())
    terms = {t for t in terms if len(t) >= 4}
    out: dict[str, dict] = {}
    for k in db.query(KnowledgeItem).filter(KnowledgeItem.status == "approved").all():
        q = k.question or ""
        if not any(t in q for t in terms) or not (("แผนก" in q) or ("สาขา" in q) or any(q.startswith(t) for t in terms)):
            continue
        topic = next((tp for tp, cues in _MORE_TOPIC if any(c in q for c in cues)), "other")
        if topic in out:
            continue
        out[topic] = {"topic": topic, "question": q, "answer_th": k.answer_th, "answer_en": k.answer_en or "", "image": k.image_url or ""}
    order = [t for t, _ in _MORE_TOPIC] + ["other"]
    return [out[t] for t in order if t in out]


@router.get("/programs/{pid}")
def get_program(pid: int, db: Session = Depends(get_db)):
    p = db.get(Program, pid)
    if not p or p.status != "published":
        raise HTTPException(404, "ไม่พบสาขา")
    p.view_count += 1
    db.commit()
    return {"id": p.id, "code": p.code, "level": p.level, "department": p.department, "name_th": p.name_th,
            "name_en": p.name_en, "description_th": p.description_th, "description_en": p.description_en,
            "careers_th": p.careers_th, "careers_en": p.careers_en, "image": p.image_url, "video": p.video_url,
            # 11 พ.ย. 2569 (migration 0002): พรีเซนเทชันสาขา
            "suits_th": p.suits_th or "", "suits_en": p.suits_en or "",
            "gallery": [u.strip() for u in (p.gallery or "").splitlines() if u.strip()]}


@router.get("/promo/next")
def promo_next(db: Session = Depends(get_db)):
    item = scheduler.next_promo(db)
    return item or {"kind": "none"}


class TTSIn(BaseModel):
    text: str = Field(..., max_length=2000)
    lang: str = "th"
    provider: Optional[str] = Field(None, max_length=16)   # Phase 4 (ไม่บังคับ): ล็อกผู้ให้บริการเสียงของคำตอบนี้


_tts_sessions: dict[str, tuple[float, str, str, Optional[str]]] = {}   # id → (เวลา, ข้อความ, ภาษา, ผู้ให้บริการที่ล็อก)


def _tts_lock(provider: Optional[str]) -> Optional[str]:
    """Phase 4: ค่า provider ที่ส่งมา → ผู้ให้บริการที่ล็อก (None = หน้าจอรุ่นเก่า ทำงานแบบเดิม) · ค่าที่ไม่ได้เปิดใช้ = 400"""
    try:
        return tts.resolve_provider(provider)
    except ValueError:
        raise HTTPException(400, "unknown or disabled tts provider")


def _tts_headers(base: dict, info: dict, lock: Optional[str]) -> dict:
    """เพิ่ม X-VORA-TTS-Provider = ผู้ให้บริการที่ให้เสียงจริง (Phase 4)"""
    used = info.get("provider") or lock or ""
    return {**base, "X-VORA-TTS-Provider": used} if used else base


@router.post("/tts/session")
def tts_session(body: TTSIn):
    """12 พ.ย. 2569: ลงทะเบียนข้อความที่จะพูด (ข้อความยาวใส่ใน URL ไม่ได้) → id สำหรับ /api/tts/stream/{id} (หมดอายุ 5 นาที)
    Phase 4: provider (ไม่บังคับ) = ล็อกผู้ให้บริการของคำตอบนี้ตั้งแต่ต้น — สตรีมและแคชใช้เฉพาะผู้ให้บริการนี้"""
    now = time.time()
    for k in [k for k, v in _tts_sessions.items() if now - v[0] > 300]:
        _tts_sessions.pop(k, None)
    lock = _tts_lock(body.provider)
    if not tts.available() or not body.text.strip():
        raise HTTPException(503, "server tts unavailable")
    sid = secrets.token_urlsafe(9)
    _tts_sessions[sid] = (now, body.text[:1500], "en" if body.lang == "en" else "th", lock)
    return {"id": sid, "cached": tts.is_cached(body.text[:1500], body.lang, lock), "provider": lock}


@router.get("/tts/stream/{sid}")
async def tts_stream(sid: str):
    """สตรีมเสียงทั้งคำตอบ: เริ่มส่งทันทีที่ได้เสียงชิ้นแรก · สร้างเสียงไม่ได้ = 204 (หน้าจอใช้วิธีทีละประโยคแทน)"""
    item = _tts_sessions.get(sid)
    if not item:
        raise HTTPException(404, "unknown tts session")
    lock = item[3] if len(item) > 3 else None
    info: dict = {}
    gen = tts.stream(item[1], item[2], provider=lock, info=info)
    try:
        first = await gen.__anext__()
    except StopAsyncIteration:
        return Response(status_code=204)

    async def body():
        yield first
        async for chunk in gen:
            yield chunk
    return StreamingResponse(body(), media_type="audio/mpeg", headers=_tts_headers({"Cache-Control": "no-store"}, info, lock))


@router.post("/tts/warm")
async def tts_warm(body: TTSIn):
    """เตรียมเสียงล่วงหน้าเก็บแคช (สไลด์พรีเซนต์ถัดไป) — รอให้งานพูดจริงก่อน"""
    return {"ok": await tts.warm(body.text[:1500], body.lang)}


_site_check: dict[str, tuple[float, dict]] = {}


@router.get("/site/check")
async def site_check(db: Session = Depends(get_db)):
    """12 พ.ย. 2569: เว็บไซต์วิทยาลัยแสดงในกรอบบนหน้าจอได้ไหม (บางเว็บห้ามด้วย X-Frame-Options/CSP)
    ตรวจเฉพาะเว็บไซต์ที่ตั้งไว้ของวิทยาลัยเท่านั้น (ไม่รับ URL จากผู้ใช้ กันการใช้เซิร์ฟเวอร์ไปเรียกเว็บอื่น)"""
    url = school_website(db, all_settings(db))
    if not url:
        return {"url": "", "embeddable": False, "reason": "no website"}
    hit = _site_check.get(url)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    out = {"url": url, "embeddable": False, "reason": ""}
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as c:
            r = await c.get(url, headers={"User-Agent": "Mozilla/5.0 VORA-kiosk"})
        xfo = (r.headers.get("x-frame-options") or "").lower()
        csp = (r.headers.get("content-security-policy") or "").lower()
        fa = csp.split("frame-ancestors", 1)[1].split(";", 1)[0] if "frame-ancestors" in csp else ""
        blocked = xfo in ("deny", "sameorigin") or (fa and "*" not in fa)
        out.update(url=str(r.url), embeddable=r.status_code < 400 and not blocked,
                   reason=f"http {r.status_code}" if r.status_code >= 400 else ("blocked by site" if blocked else ""))
    except Exception as e:  # noqa: BLE001
        out["reason"] = type(e).__name__
    _site_check[url] = (time.time(), out)
    return out


@router.get("/tts")
async def text_to_speech(text: str, lang: str = "th", pre: int = 0, provider: Optional[str] = None):
    """Phase 4: provider (ไม่บังคับ) = ใช้เฉพาะผู้ให้บริการนี้ (ประโยคต่อไปของคำตอบเดิมเป็นเสียงเดียวกัน) · ไม่ได้เสียง = 204"""
    lock = _tts_lock(provider)
    info: dict = {}
    audio = await tts.synthesize(text[:600], lang, prefetch=bool(pre), provider=lock, info=info)
    if not audio:
        return Response(status_code=204)
    return Response(content=audio, media_type="audio/mpeg", headers=_tts_headers({"Cache-Control": "max-age=86400"}, info, lock))


@router.post("/kiosk/state")
async def kiosk_state(body: StateIn):
    hub.kiosk_state = {"state": body.state, "updated": time.time()}
    await hub.broadcast("kiosk.state", hub.kiosk_state, roles=("admin",))
    return {"ok": True}


@router.get("/kiosk/mobile_url")
def kiosk_mobile_url(db: Session = Depends(get_db)):
    """25 พ.ย. 2569: ที่อยู่หน้ามือถือล่าสุด — หน้าจอหุ่นยนต์เรียกทุกครั้งที่เปิดคิวอาร์ (ไม่ต้องรีเฟรชเมื่อเปลี่ยนเครือข่าย)"""
    mb = mobile_base(db)
    return {"url": f"{mb['base']}/m/", "ok": mb["ok"], "warning": mb["warning"], "source": mb["source"]}


class ThemeIn(BaseModel):
    theme: str


@router.post("/kiosk/theme")
def kiosk_theme(body: ThemeIn, request: Request, db: Session = Depends(get_db)):
    """25 พ.ย. 2569: หน้าจอบนตัวหุ่นยนต์บอกธีมที่ใช้อยู่ → หน้ามือถือใช้ธีมเดียวกัน (เฉพาะเครื่องบนตัวหุ่นยนต์)"""
    _require_trusted_kiosk(request)
    if body.theme not in ("light", "dark"):
        raise HTTPException(400, "ธีมไม่ถูกต้อง")
    set_setting(db, THEME_KEY, body.theme)
    db.commit()
    return {"ok": True, "theme": body.theme}


@router.post("/robot/stop")
async def public_stop():
    """ปุ่มหยุดหุ่นยนต์ — เปิดให้เรียกได้เสมอโดยไม่ต้องเข้าสู่ระบบ เพื่อความปลอดภัย"""
    await bridge.stop("kiosk")
    return {"ok": True}


@router.get("/robot/brief")
def robot_brief():
    st = bridge.public_status()
    return {k: st.get(k) for k in ("connected", "online", "ready", "state", "battery", "estop", "patrol", "driver")}


class InteractionIn(BaseModel):
    kind: str = "gesture"
    name: str
    session_id: Optional[str] = None
    lang: str = "th"


GESTURE_TH = {"Thumb_Up": "ชูนิ้วโป้ง", "Thumb_Down": "คว่ำนิ้วโป้ง", "Open_Palm": "แบมือ", "Pointing_Up": "ชี้นิ้วขึ้น",
              "Victory": "ชูสองนิ้ว", "ILoveYou": "ท่า I love you", "Closed_Fist": "กำมือ"}


@router.post("/interaction")
async def interaction(body: InteractionIn, request: Request, db: Session = Depends(get_db)):
    """บันทึกการโต้ตอบที่ไม่ใช่คำถาม เช่น ท่ามือหน้ากล้อง เพื่อใช้ในรายงานการใช้งาน"""
    rate_limit(request, limit=40)
    lang = body.lang if body.lang in ("th", "en") else "th"
    sess = get_or_create_session(db, body.session_id, "kiosk", lang, body.kind[:16])
    db.add(Message(session_id=sess.id, role="user", text=f"[{body.kind}:{body.name[:32]}]", input_mode=body.kind[:16],
                   lang=lang, intent=f"gesture_{body.name[:32]}"))
    sess.message_count += 1
    db.commit()
    await hub.broadcast("chat.message", {"q": f"[ท่ามือ: {GESTURE_TH.get(body.name, body.name)}]", "a": "", "intent": "gesture",
                                         "answered": True, "channel": "kiosk", "mode": "gesture"}, roles=("admin",))
    return {"ok": True, "session_id": sess.id}


# ---------------------------------------------------------------- VORA NEXT Phase 5: Time Portal (endpoint ใหม่ อ่านอย่างเดียว)
@router.get("/timeline")
def timeline(lang: str = "th", db: Session = Depends(get_db)):
    """Time Portal: กิจกรรมจากข่าวที่เผยแพร่จริง แบ่งกลุ่มตามวันที่ (เวลาไทย) — ดู app/timeline.py"""
    from ..timeline import build_timeline
    return build_timeline(db, lang)


# ---------------------------------------------------------------- VORA NEXT Phase 4: Knowledge Constellation (endpoint ใหม่ อ่านอย่างเดียว)
@router.get("/constellation")
def constellation(lang: str = "th", db: Session = Depends(get_db)):
    """กราฟความรู้จากความสัมพันธ์ที่มีอยู่ในฐานข้อมูลจริงเท่านั้น (ดู app/constellation.py)"""
    from ..constellation import build_constellation
    return build_constellation(db, lang)
