"""การตั้งค่าระบบ VORA (อ่านจากไฟล์ .env หรือ environment variables)

ทุกค่ามีค่าเริ่มต้นที่ทำให้ระบบทำงานได้ทันทีแบบออฟไลน์ (ไม่ต้องมี API key)
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]          # โฟลเดอร์โปรเจกต์ vora/
DATA_DIR = Path(os.environ.get("VORA_DATA_DIR", ROOT_DIR / "data"))
FRONTEND_DIR = ROOT_DIR / "frontend"


def _load_dotenv(path: Path) -> None:
    """โหลดไฟล์ .env แบบง่าย (KEY=VALUE) โดยไม่ทับค่าที่ตั้งไว้แล้ว"""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv(ROOT_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def _env_bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _secret_key() -> str:
    """ใช้ค่าจาก env ถ้ามี ไม่เช่นนั้นสร้างและเก็บไว้ในไฟล์ เพื่อให้ token อยู่รอดหลังรีสตาร์ท"""
    if _env("VORA_SECRET_KEY"):
        return _env("VORA_SECRET_KEY")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    f = DATA_DIR / ".secret_key"
    if f.exists():
        return f.read_text().strip()
    key = secrets.token_urlsafe(48)
    f.write_text(key)
    return key


@dataclass
class Settings:
    # ข้อมูลสถานศึกษา (รองรับการขยายหลายสถานศึกษาด้วย school_code)
    school_code: str = field(default_factory=lambda: _env("VORA_SCHOOL_CODE", "demo-college"))
    host: str = field(default_factory=lambda: _env("VORA_HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: int(_env("VORA_PORT", "8000")))
    public_url: str = field(default_factory=lambda: _env("VORA_PUBLIC_URL", ""))

    # PostgreSQL: postgresql+psycopg://vora:รหัสผ่าน@localhost:5432/vora  (ตั้งค่าอัตโนมัติด้วย setup_postgres.bat)
    # ถ้าไม่ได้ตั้งค่า (หรือเว้นว่าง) ใช้ SQLite ที่ data/vora.db
    database_url: str = field(default_factory=lambda: _env("VORA_DATABASE_URL").strip()
                              or f"sqlite:///{DATA_DIR / 'vora.db'}")
    secret_key: str = field(default_factory=_secret_key)
    token_hours: int = field(default_factory=lambda: int(_env("VORA_TOKEN_HOURS", "12")))
    admin_username: str = field(default_factory=lambda: _env("VORA_ADMIN_USER", "admin"))
    admin_password: str = field(default_factory=lambda: _env("VORA_ADMIN_PASSWORD", "vora1234"))

    # ---------- AI ----------
    # llm_provider: none | gemini | openai | anthropic | typhoon | ollama
    llm_provider: str = field(default_factory=lambda: _env("VORA_LLM_PROVIDER", "none").lower())
    llm_model: str = field(default_factory=lambda: _env("VORA_LLM_MODEL", ""))
    llm_api_key: str = field(default_factory=lambda: _env("VORA_LLM_API_KEY", ""))
    llm_base_url: str = field(default_factory=lambda: _env("VORA_LLM_BASE_URL", ""))
    llm_timeout: float = field(default_factory=lambda: _env_float("VORA_LLM_TIMEOUT", 4.0))   # 6E-1: ≈4 วิ (เดิม 12)
    # Phase 6 · 6C — ผู้ให้บริการสำรอง (ไม่บังคับ · ว่าง = ไม่มี chain = พฤติกรรมเดิม) เช่น ollama ในเครื่องสำหรับใช้งานออฟไลน์
    llm_fallback_provider: str = field(default_factory=lambda: _env("VORA_LLM_FALLBACK_PROVIDER", "").lower())
    llm_fallback_model: str = field(default_factory=lambda: _env("VORA_LLM_FALLBACK_MODEL", ""))
    llm_fallback_api_key: str = field(default_factory=lambda: _env("VORA_LLM_FALLBACK_API_KEY", ""))
    llm_fallback_base_url: str = field(default_factory=lambda: _env("VORA_LLM_FALLBACK_BASE_URL", ""))
    llm_fallback_timeout: float = field(default_factory=lambda: _env_float("VORA_LLM_FALLBACK_TIMEOUT", 8.0))  # 6E-1: ถูกจำกัดด้วยเวลาที่เหลือของงบรวม (เดิม 20)
    # งบเวลารวมต่อคำถาม (วินาที) — 6E-1: deadline ร่วมของทุกการเรียก AI ในคำถามเดียว (compose + general + รอคิว)
    # ค่าเริ่มต้น 8 (เดิม 0) · 0 = ไม่จำกัดเพิ่ม (ผลรวม timeout ของแต่ละตัว = พฤติกรรมก่อน 6E)
    ai_budget_s: float = field(default_factory=lambda: _env_float("VORA_AI_BUDGET_S", 8.0))
    # 11 พ.ย. 2569: ระดับการคิดของ Gemini 3.x (minimal | low | ...) · ว่าง = ไม่ส่ง thinkingConfig (พฤติกรรมเดิม)
    llm_thinking: str = field(default_factory=lambda: _env("VORA_LLM_THINKING", "").strip().lower())
    # 6E-1: จำนวนการเรียกผู้ให้บริการ AI พร้อมกันสูงสุด (รอคิวเกินงบเวลา → ใช้คำตอบจากฐานความรู้)
    ai_concurrency: int = field(default_factory=lambda: int(_env("VORA_AI_CONCURRENCY", "4")))
    # Phase 6 · 6D — ตอบคำถามความรู้ทั่วไปด้วย LLM (ไม่ใช่เรื่องของสถานศึกษา) · ปิดเป็นค่าเริ่มต้น (D6D-1)
    ai_general_enabled: bool = field(default_factory=lambda: _env_bool("VORA_AI_GENERAL_ENABLED", False))
    # 11 พ.ย. 2569 — ค้นข้อมูลจากอินเทอร์เน็ตเมื่อผู้ใช้ขอ ("หาข้อมูล … ให้หน่อย") · ปิดเป็นค่าเริ่มต้น
    ai_web_enabled: bool = field(default_factory=lambda: _env_bool("VORA_AI_WEB_ENABLED", False))
    web_timeout_s: float = field(default_factory=lambda: _env_float("VORA_WEB_TIMEOUT", 12.0))
    # 11 พ.ย. 2569: โมเดลสำหรับค้นเว็บโดยเฉพาะ (ว่าง = ใช้โมเดลเดียวกับ VORA_LLM_MODEL) — รุ่น flash ค้นได้ตรงกว่ารุ่น lite
    # 11 พ.ย. 2569: จำกัดจำนวนครั้งที่เรียก AI ต่อนาที (รวมทุกงาน: ตอบ แปล ค้นเว็บ) ให้ต่ำกว่าโควตาของ Google · 0 = ไม่จำกัด
    llm_rpm: int = field(default_factory=lambda: int(_env_float("VORA_LLM_RPM", 0)))
    web_model: str = field(default_factory=lambda: _env("VORA_WEB_MODEL").strip())
    # 11 พ.ย. 2569 — ข้อมูลเรียลไทม์: พิกัดสำหรับสภาพอากาศ (ค่าเริ่มต้น จังหวัดน่าน)
    weather_lat: float = field(default_factory=lambda: _env_float("VORA_WEATHER_LAT", 18.7756))
    weather_lon: float = field(default_factory=lambda: _env_float("VORA_WEATHER_LON", 100.7730))
    weather_place_th: str = field(default_factory=lambda: _env("VORA_WEATHER_PLACE_TH", "จังหวัดน่าน"))
    weather_place_en: str = field(default_factory=lambda: _env("VORA_WEATHER_PLACE_EN", "Nan"))
    # เกณฑ์ความมั่นใจขั้นต่ำของการค้นคืน ถ้าต่ำกว่านี้ถือว่า "ไม่มีข้อมูล"
    retrieval_threshold: float = field(default_factory=lambda: _env_float("VORA_RETRIEVAL_THRESHOLD", 0.22))
    max_answer_chars: int = field(default_factory=lambda: int(_env("VORA_MAX_ANSWER_CHARS", "420")))
    # 25 พ.ย. 2569: คำถามตรงกับ FAQ ที่อนุมัติแล้ว (คะแนน ≥ 0.8) → อ่านคำตอบที่เจ้าหน้าที่อนุมัติเต็มข้อความ ไม่ให้ AI ย่อ/ตัดเหลือ 2 ประโยค
    # 0 = แบบเดิม (AI เรียบเรียง + ตัดตามความยาว)
    faq_full: bool = field(default_factory=lambda: _env_bool("VORA_FAQ_FULL", True))

    # ---------- เสียง ----------
    # tts_provider: browser | edge | google  (edge ใช้ edge-tts ฝั่งเซิร์ฟเวอร์ · google = เสียง Google Translate · ต้องมีอินเทอร์เน็ต)
    tts_provider: str = field(default_factory=lambda: _env("VORA_TTS_PROVIDER", "browser").lower())
    tts_voice_th: str = field(default_factory=lambda: _env("VORA_TTS_VOICE_TH", "th-TH-PremwadeeNeural"))
    # ภาษาอังกฤษ: ว่าง / "same" = ใช้เสียงเดียวกับภาษาไทย (เสียงประจำตัว VORA คนเดิมทุกภาษา) · ใส่ชื่อเสียงเพื่อแยกเสียงอังกฤษ
    tts_voice_en: str = field(default_factory=lambda: _env("VORA_TTS_VOICE_EN", "same"))
    tts_rate: str = field(default_factory=lambda: _env("VORA_TTS_RATE", "-5%"))      # ความเร็ว (-5% ≈ 0.95 เท่า ฟังสบาย)
    tts_pitch: str = field(default_factory=lambda: _env("VORA_TTS_PITCH", "+0Hz"))   # ระดับเสียง (อย่าสูงเกิน +10Hz จะฟังเป็นเด็ก)
    tts_timeout_s: float = field(default_factory=lambda: _env_float("VORA_TTS_TIMEOUT", 8.0))
    # 12 พ.ย. 2569: เสียงสำรองเมื่อ edge-tts ใช้ไม่ได้ (บริการของ Microsoft ตอบ "No audio was received")
    # none = ไม่มี · google = เสียงไทยผู้หญิงจาก Google Translate (บริการไม่เป็นทางการ ต้องมีอินเทอร์เน็ต)
    tts_fallback: str = field(default_factory=lambda: _env("VORA_TTS_FALLBACK", "none").strip().lower())

    # ---------- ทนเน็ตล่ม (21 พ.ย. 2569 · งาน F "สาธิตไม่สะดุด" — ดู app/connectivity.py) ----------
    # ช่วงตรวจอินเทอร์เน็ต (วินาที) · 0 = ปิด (ถือว่าออนไลน์เสมอ = พฤติกรรมเดิม)
    # 22 พ.ย. 2569: ถามต่อจากคำถามก่อนหน้า (ปิด: VORA_FOLLOWUP=0) · จำหัวข้อล่าสุดนานเท่าไร (วินาที)
    followup_enabled: bool = field(default_factory=lambda: _env("VORA_FOLLOWUP", "1").strip().lower() not in ("0", "false", "no", "off"))
    followup_ttl_s: float = field(default_factory=lambda: _env_float("VORA_FOLLOWUP_TTL_S", 180.0))
    # ให้ AI ช่วยเขียนคำถามต่อใหม่เมื่อกฎไม่เข้าใจ ("อันนั้นอยู่ที่ไหน") · ใช้ได้เมื่อเปิด AI ภายนอก (ปิด: VORA_FOLLOWUP_LLM=0)
    followup_llm: bool = field(default_factory=lambda: _env("VORA_FOLLOWUP_LLM", "1").strip().lower() not in ("0", "false", "no", "off"))
    # 23 พ.ย. 2569: ตอบคำถามสาขาให้ตรงประเด็น (มีไหม / เรียนอะไร / เหมาะกับใคร / เรื่องเฉพาะ → ค้นฐานความรู้) · 0 = แบบเดิม
    program_smart: bool = field(default_factory=lambda: _env("VORA_PROGRAM_SMART", "1").strip().lower() not in ("0", "false", "no", "off"))
    # 23 พ.ย. 2569: ตรวจว่าข้อมูลที่ค้นเจอตอบคำถามจริง (สถานที่ / ชนิดคำตอบ / คำภาษาอังกฤษ) — ai/answer_check.py · 0 = แบบเดิม
    answer_check: bool = field(default_factory=lambda: _env("VORA_ANSWER_CHECK", "1").strip().lower() not in ("0", "false", "no", "off"))
    # 27 พ.ย. 2569: คำถามตรงกับคำถามที่เจ้าหน้าที่เขียนไว้ทุกตัวอักษร → ใช้ FAQ ข้อนั้นก่อน (ai/answer_check.is_exact) · 0 = แบบเดิม
    exact_faq_first: bool = field(default_factory=lambda: _env("VORA_EXACT_FAQ_FIRST", "1").strip().lower() not in ("0", "false", "no", "off"))
    # 24 พ.ย. 2569: กล่องตรวจข้อมูล (Sandbox) ในหลังบ้าน — 0 = ซ่อนเมนูและปิด API (ข้อมูลในตารางยังอยู่)
    sandbox: bool = field(default_factory=lambda: _env("VORA_SANDBOX", "1").strip().lower() not in ("0", "false", "no", "off"))
    # 24 พ.ย. 2569: กล้องจำป้าย — รายละเอียดตามประเภท + ป๊อปอัปนำเสนอ + ถามต่อเกี่ยวกับสิ่งที่เห็น (0 = ตอบแบบเดิม)
    vision_detail: bool = field(default_factory=lambda: _env("VORA_VISION_DETAIL", "1").strip().lower() not in ("0", "false", "no", "off"))
    # 24 พ.ย. 2569: "นี่คืออะไร" แต่กล้องยังไม่รู้จัก → บันทึกภาพย่อไว้ในเครื่องให้เจ้าหน้าที่สอน (0 = ไม่บันทึกภาพ)
    vision_unknown: bool = field(default_factory=lambda: _env("VORA_VISION_UNKNOWN", "1").strip().lower() not in ("0", "false", "no", "off"))
    # 24 พ.ย. 2569: นำเข้ารายการให้กล้องจำทีละมาก (จากข่าว/กิจกรรม หรือไฟล์ Excel) → เข้าเป็น "รอตรวจ" ก่อน (0 = ซ่อนปุ่มนำเข้า)
    vision_import: bool = field(default_factory=lambda: _env("VORA_VISION_IMPORT", "1").strip().lower() not in ("0", "false", "no", "off"))
    # 21 พ.ย. 2569 (งาน A "สมองโปร่งใส"): ส่งขั้นตอนการตัดสินใจไปหน้าหลังบ้าน (ปิด: VORA_BRAIN_TRACE=0)
    brain_trace: bool = field(default_factory=lambda: _env("VORA_BRAIN_TRACE", "1").strip().lower() not in ("0", "false", "no", "off"))
    brain_trace_keep: int = field(default_factory=lambda: int(_env_float("VORA_BRAIN_TRACE_KEEP", 30)))
    net_check_s: float = field(default_factory=lambda: _env_float("VORA_NET_CHECK_S", 15.0))
    net_check_urls: tuple[str, ...] = field(default_factory=lambda: tuple(
        u.strip() for u in _env("VORA_NET_CHECK_URLS", "https://www.gstatic.com/generate_204,https://www.google.com/generate_204").split(",")
        if u.strip()))

    # ---------- หุ่นยนต์ ----------
    # robot_driver: simulator | serial | websocket
    robot_driver: str = field(default_factory=lambda: _env("VORA_ROBOT_DRIVER", "simulator").lower())
    robot_serial_port: str = field(default_factory=lambda: _env("VORA_ROBOT_SERIAL_PORT", "COM3"))
    robot_serial_baud: int = field(default_factory=lambda: int(_env("VORA_ROBOT_SERIAL_BAUD", "115200")))
    robot_ws_url: str = field(default_factory=lambda: _env("VORA_ROBOT_WS_URL", "ws://192.168.4.1:81/"))
    robot_heartbeat_ms: int = field(default_factory=lambda: int(_env("VORA_ROBOT_HEARTBEAT_MS", "300")))
    robot_enable_motion: bool = field(default_factory=lambda: _env_bool("VORA_ROBOT_ENABLE_MOTION", True))

    # ---------- ความปลอดภัยของช่องทาง (Phase 6 · 6E-4 / F1) ----------
    # เครื่องที่ถือเป็น "หน้าจอบนตัวหุ่นยนต์" (kiosk) — server ตัดสินจาก IP ผู้เรียก ไม่เชื่อค่า channel ที่ client ส่งมา
    # ค่าเริ่มต้น = เครื่องตัวเอง (kiosk.bat เปิด http://localhost:8000/) · คั่นด้วย ,
    # 25 พ.ย. 2569: จอในวง LAN ที่ผู้ดูแลอนุมัติ = สิทธิ์จอแสดงผล (ไม่สั่งหุ่นยนต์จริง) · 0 = ปิด (เครื่องอื่นเป็นแบบมือถือ)
    lan_screens: bool = field(default_factory=lambda: _env_bool("VORA_LAN_SCREENS", True))
    # https สำหรับเครื่องอื่นในวง LAN (ไมค์/กล้องต้องใช้ https) · ใช้เมื่อมี data/certs/vora-lan.crt (lan_setup.bat) · 0 = ปิด
    https_port: int = field(default_factory=lambda: int(_env("VORA_HTTPS_PORT", "8443") or 0))
    kiosk_trusted_hosts: tuple[str, ...] = field(default_factory=lambda: tuple(
        h.strip() for h in _env("VORA_KIOSK_TRUSTED_HOSTS", "127.0.0.1,::1").split(",") if h.strip()))
    # server = ตัดสินจาก IP (ค่าเริ่มต้น) · legacy = เชื่อ channel จาก client แบบเดิม (ใช้เป็นทาง rollback เท่านั้น)
    channel_trust: str = field(default_factory=lambda: _env("VORA_CHANNEL_TRUST", "server").lower())

    # ---------- ประชาสัมพันธ์อัตโนมัติ ----------
    scheduler_enabled: bool = field(default_factory=lambda: _env_bool("VORA_SCHEDULER", True))
    greeting_cooldown_s: int = field(default_factory=lambda: int(_env("VORA_GREETING_COOLDOWN", "25")))
    idle_attract_s: int = field(default_factory=lambda: int(_env("VORA_IDLE_ATTRACT", "90")))
    max_announcements_per_hour: int = field(default_factory=lambda: int(_env("VORA_MAX_ANNOUNCE_PER_HOUR", "12")))
    # 27 พ.ย. 2569: ประกาศเสียงเฉพาะที่เจ้าหน้าที่ตั้งในตาราง (0 = แบบเดิม: หน้าจอว่างพูดข่าว/สาขาเองทุก 90 วิ)
    pr_schedule_only: bool = field(default_factory=lambda: _env_bool("VORA_PR_SCHEDULE_ONLY", True))

    @property
    def llm_enabled(self) -> bool:
        if self.llm_provider in ("", "none", "off"):
            return False
        if self.llm_provider == "ollama":
            return True
        return bool(self.llm_api_key)

    @property
    def llm_fallback_enabled(self) -> bool:
        if self.llm_fallback_provider in ("", "none", "off"):
            return False
        if self.llm_fallback_provider == "ollama":
            return True
        return bool(self.llm_fallback_api_key)


settings = Settings()
DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "models").mkdir(exist_ok=True)
(DATA_DIR / "uploads").mkdir(exist_ok=True)
