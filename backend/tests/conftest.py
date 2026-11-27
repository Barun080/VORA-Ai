import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import pytest

# ใช้ฐานข้อมูลชั่วคราวแยกจากข้อมูลจริงทุกครั้งที่ทดสอบ
# ค่าเริ่มต้น: SQLite ในโฟลเดอร์ชั่วคราว
# ทดสอบกับ PostgreSQL: ตั้ง VORA_TEST_DATABASE_URL=postgresql+psycopg://user:pass@host/vora_test
#   (ใน environment หรือในไฟล์ .env; ชื่อฐานข้อมูลต้องมีคำว่า test เพื่อกันการล้างฐานข้อมูลจริงโดยไม่ตั้งใจ)
#   ตั้งเป็น sqlite เพื่อบังคับทดสอบกับ SQLite
_TMP = tempfile.mkdtemp(prefix="vora-test-")


def _test_db_from_dotenv() -> str:
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.strip().partition("=")
            if sep and key.strip() == "VORA_TEST_DATABASE_URL":
                return value.strip().strip('"').strip("'")
    return ""


_TEST_DB = os.environ.get("VORA_TEST_DATABASE_URL", "").strip() or _test_db_from_dotenv()
if _TEST_DB.lower() == "sqlite":
    _TEST_DB = ""
if _TEST_DB and "test" not in (urlparse(_TEST_DB).path or "").lower():
    raise SystemExit("VORA_TEST_DATABASE_URL ต้องชี้ไปฐานข้อมูลที่ชื่อมีคำว่า test เท่านั้น (ชุดทดสอบจะล้างข้อมูลทั้งหมดในฐานนั้น)")

os.environ["VORA_DATA_DIR"] = _TMP
# ตั้งค่าเองทุกครั้ง ไม่ให้ไปอ่าน VORA_DATABASE_URL จาก .env ซึ่งเป็นฐานข้อมูลจริง
os.environ["VORA_DATABASE_URL"] = _TEST_DB or f"sqlite:///{Path(_TMP) / 'vora.db'}"
# ปิด AI ภายนอกทั้งสายเสมอ ไม่ว่าใน .env จะตั้งไว้อย่างไร (.env โหลดแบบ setdefault จึงไม่ทับค่าที่ตั้งตรงนี้)
# เดิมตั้งแค่ VORA_LLM_PROVIDER ทำให้ตัวสำรอง (FALLBACK) และโหมดคำถามทั่วไปจาก .env ยังเรียก Gemini จริงระหว่างทดสอบ
os.environ["VORA_LLM_PROVIDER"] = "none"
os.environ["VORA_TTS_PROVIDER"] = "edge"   # ค่าคงที่ระหว่างทดสอบ (.env จริงอาจเป็น google)
os.environ["VORA_TTS_FALLBACK"] = "none"   # 12 พ.ย. 2569: ไม่เรียกเสียงสำรองจริงระหว่างทดสอบ
os.environ["VORA_LLM_RPM"] = "0"          # 11 พ.ย. 2569: ไม่จำกัดจำนวนครั้งต่อนาทีระหว่างทดสอบ (.env จริงตั้งไว้ 12)
os.environ["VORA_WEB_MODEL"] = ""
os.environ["VORA_LLM_API_KEY"] = ""
os.environ["VORA_LLM_MODEL"] = ""
os.environ["VORA_LLM_BASE_URL"] = ""
os.environ["VORA_LLM_FALLBACK_PROVIDER"] = ""
os.environ["VORA_LLM_FALLBACK_API_KEY"] = ""
os.environ["VORA_LLM_FALLBACK_MODEL"] = ""
os.environ["VORA_LLM_FALLBACK_BASE_URL"] = ""
os.environ["VORA_AI_GENERAL_ENABLED"] = "false"
os.environ["VORA_AI_WEB_ENABLED"] = "false"          # 11 พ.ย. 2569: ชุดทดสอบไม่ออกอินเทอร์เน็ต
os.environ["VORA_ROBOT_DRIVER"] = "simulator"
os.environ["VORA_SCHEDULER"] = "false"
os.environ["VORA_DOTENV_RELOAD"] = "0"      # 22 พ.ย. 2569: สวิตช์โมเดล AI ไม่อ่านคีย์จริงจาก .env ระหว่างทดสอบ
os.environ["VORA_NET_CHECK_S"] = "0"          # 21 พ.ย. 2569 (งาน F): ไม่ตรวจอินเทอร์เน็ตระหว่างทดสอบ (ถือว่าออนไลน์ · ชุดทดสอบงาน F จำลองเอง)
# Phase 6 · 6E-4: TestClient ส่ง IP ผู้เรียก = "testclient" → ถือเป็นหน้าจอบนตัวหุ่นยนต์ (เหมือน localhost ในการใช้งานจริง)
# เพื่อให้ชุดทดสอบเดิมทำงานแบบเดิม · ชุดทดสอบความปลอดภัยของช่องทางปรับค่านี้เองเพื่อจำลองเครื่องที่ไม่น่าเชื่อถือ
os.environ["VORA_KIOSK_TRUSTED_HOSTS"] = "127.0.0.1,::1,testclient"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

if _TEST_DB:
    Base.metadata.drop_all(engine)   # เริ่มจากฐานข้อมูลทดสอบที่ว่างเปล่าทุกครั้ง


def pytest_report_header(config):
    return f"VORA test database: {engine.url.render_as_string(hide_password=True)}"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def admin_headers(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "vora1234"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="session")
def editor_headers(client):
    r = client.post("/api/auth/login", json={"username": "staff", "password": "staff1234"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(autouse=True)
def _reset_llm_rate_window():
    """11 พ.ย. 2569: ตัวจำกัดการเรียก AI ต่อนาทีเป็นสถานะร่วมของเซิร์ฟเวอร์ → ล้างก่อนทุกเทสต์ (เทสต์ 429 ไม่กระทบเทสต์ถัดไป)"""
    from app.ai import llm as _llm
    from app.ai import web as _web
    _llm.rate.calls.clear()
    _llm.rate.blocked_until = 0.0
    _web._quota_until.clear()
    yield
