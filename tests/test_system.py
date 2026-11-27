"""ทดสอบหลังบ้าน สิทธิ์ ประชาสัมพันธ์อัตโนมัติ รายงาน และความเสถียร"""
import asyncio
import random
import time
from datetime import datetime

from app.ai.llm import CircuitBreaker
from app.models import Schedule
from app.scheduler import _in_quiet_hours, is_due


# ------------------------------------------------------------------ สิทธิ์และการอนุมัติ
def test_login_rejects_wrong_password(client):
    assert client.post("/api/auth/login", json={"username": "admin", "password": "wrong"}).status_code == 401


def test_admin_requires_token(client):
    assert client.get("/api/admin/news").status_code == 401


def test_editor_cannot_publish_directly(client, editor_headers):
    body = {"title_th": "ข่าวทดสอบ", "status": "published"}
    assert client.post("/api/admin/news", headers=editor_headers, json=body).status_code == 403
    body["status"] = "pending"
    assert client.post("/api/admin/news", headers=editor_headers, json=body).status_code == 200


def test_news_visible_only_after_publish_and_within_period(client, admin_headers):
    nid = client.post("/api/admin/news", headers=admin_headers,
                      json={"title_th": "ข่าวยังไม่ถึงเวลา", "status": "published", "publish_at": "2099-01-01T00:00:00"}).json()["id"]
    assert all(n["id"] != nid for n in client.get("/api/news?limit=30").json())
    nid2 = client.post("/api/admin/news", headers=admin_headers,
                       json={"title_th": "ข่าวเผยแพร่แล้ว", "status": "published", "priority": 5}).json()["id"]
    assert any(n["id"] == nid2 for n in client.get("/api/news?limit=30").json())


def test_audit_log_records_changes(client, admin_headers):
    logs = client.get("/api/admin/audit", headers=admin_headers).json()
    assert any(a["entity"] == "news" and a["action"] == "create" for a in logs)


def test_csv_import_goes_to_pending(client, admin_headers):
    csv = "category,question,alt_questions,answer_th,answer_en\nlocation,ลานจอดรถอยู่ไหน,ที่จอดรถ|จอดรถตรงไหน,ลานจอดรถอยู่หลังอาคาร 4 ค่ะ,Parking is behind Building 4.\n"
    r = client.post("/api/admin/knowledge/import", headers=admin_headers, files={"file": ("kb.csv", csv.encode(), "text/csv")})
    assert r.json() == {"added": 1, "skipped": 0}
    pending = client.get("/api/admin/knowledge?status=pending", headers=admin_headers).json()
    assert any(k["question"] == "ลานจอดรถอยู่ไหน" for k in pending)


# ------------------------------------------------------------------ ประชาสัมพันธ์อัตโนมัติ
def test_schedule_due_by_time_and_interval():
    now = datetime(2026, 11, 2, 12, 12)          # วันจันทร์
    s = Schedule(name="t", times="12:10", days="0123456", active=True, interval_min=0)
    assert is_due(s, now)
    s.last_run_at = datetime(2026, 11, 2, 12, 10, 30)
    assert not is_due(s, now)                     # ทำไปแล้วในรอบเวลานี้
    s2 = Schedule(name="i", times="", interval_min=30, days="0123456", active=True, last_run_at=datetime(2026, 11, 2, 11, 50))
    assert not is_due(s2, now)
    s2.last_run_at = datetime(2026, 11, 2, 11, 30)
    assert is_due(s2, now)
    s3 = Schedule(name="weekday", times="12:10", days="01234", active=True)
    assert not is_due(s3, datetime(2026, 11, 1, 12, 12))   # วันอาทิตย์


def test_quiet_hours():
    assert _in_quiet_hours("12:00-13:00", datetime(2026, 1, 1, 12, 30))
    assert not _in_quiet_hours("12:00-13:00", datetime(2026, 1, 1, 13, 30))
    assert _in_quiet_hours("22:00-06:00", datetime(2026, 1, 1, 23, 0))     # ข้ามเที่ยงคืน


def test_announce_now_and_promo(client, admin_headers):
    r = client.post("/api/admin/announce", headers=admin_headers, json={"text_th": "ทดสอบประกาศ"})
    assert r.status_code == 200
    p = client.get("/api/promo/next").json()
    assert p["kind"] in ("news", "program")


def test_kiosk_receives_announcement_over_websocket(client, admin_headers):
    with client.websocket_connect("/ws?role=kiosk") as ws:
        assert ws.receive_json()["topic"] == "hello"
        client.post("/api/admin/announce", headers=admin_headers, json={"text_th": "เชิญรับของที่ระลึกค่ะ"})
        for _ in range(10):
            m = ws.receive_json()
            if m["topic"] == "announce":
                assert m["data"]["text_th"] == "เชิญรับของที่ระลึกค่ะ"
                break
        else:
            raise AssertionError("no announce received")


def test_admin_ws_requires_token(client):
    import pytest
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws?role=admin&token=bad") as ws:
            ws.receive_json()


# ------------------------------------------------------------------ รายงาน
def test_reports_overview_and_csv(client, admin_headers):
    client.post("/api/feedback", json={"session_id": "s1", "kind": "rating", "rating": 5})
    client.post("/api/feedback", json={"session_id": "s1", "kind": "thumb", "rating": 1})
    rep = client.get("/api/reports/overview?days=7", headers=admin_headers).json()
    t = rep["totals"]
    for k in ("sessions", "questions", "answer_rate", "avg_rating", "satisfaction_thumb", "auto_greetings", "errors"):
        assert k in t
    assert t["questions"] > 0 and t["avg_rating"] is not None
    csv = client.get("/api/reports/export.csv", headers=admin_headers)
    assert csv.status_code == 200 and "เจตนา" in csv.text


# ------------------------------------------------------------------ ความเสถียร
def test_llm_circuit_breaker_opens_after_failures():
    cb = CircuitBreaker(threshold=3, cooldown_s=60)
    for _ in range(3):
        cb.failure()
    assert cb.is_open


def test_answer_falls_back_when_llm_fails(client, monkeypatch):
    from app.ai import engine
    from app.ai.llm import LLMError, llm

    async def boom(*a, **k):
        raise LLMError("down")
    monkeypatch.setattr(type(llm), "available", property(lambda self: True))
    monkeypatch.setattr(llm, "complete", boom)
    engine._llm_cache.clear()
    r = client.post("/api/chat", json={"text": "มีทุนการศึกษาไหม"}).json()
    assert r["answered"] and r["provider"] == "knowledge-base" and "ทุน" in r["text"]


def test_stress_200_questions_no_errors(client):
    qs = ["มีสาขาอะไรบ้าง", "สมัครเรียนยังไง", "ค่าเทอมเท่าไหร่", "ห้องน้ำอยู่ไหน", "What programs do you offer?",
          "ข่าวล่าสุด", "อยากเรียนหุ่นยนต์", "asdfghjkl", "🙂", "a" * 400, "จบแล้วทำงานอะไร", "ไม่รู้จะถามอะไร"]
    random.seed(1)
    lat = []
    for i in range(200):
        t0 = time.time()
        r = client.post("/api/chat", json={"text": random.choice(qs), "channel": "kiosk"})
        lat.append(time.time() - t0)
        assert r.status_code == 200 and r.json()["text"]
    lat.sort()
    assert lat[int(len(lat) * 0.95)] < 0.5, f"p95 {lat[int(len(lat) * 0.95)]:.3f}s"


def test_invalid_inputs_are_rejected_gracefully(client):
    assert client.post("/api/chat", json={"text": ""}).status_code == 422
    assert client.post("/api/feedback", json={"kind": "hack"}).status_code == 400
    assert client.get("/api/news/999999").status_code == 404


def test_long_text_and_nul_are_stored_safely_on_any_database(client, admin_headers):
    # PostgreSQL ปฏิเสธข้อความยาวเกินคอลัมน์และอักขระ NUL ส่วน SQLite ไม่ปฏิเสธ ระบบต้องทำงานเหมือนกันทั้งสองแบบ
    r = client.post("/api/admin/news", headers=admin_headers,
                    json={"title_th": "ก" * 400, "body_th": "เนื้อหา\x00มี NUL", "status": "draft"})
    assert r.status_code == 200, r.text
    n = client.get(f"/api/admin/news", headers=admin_headers).json()
    item = next(x for x in (n if isinstance(n, list) else n.get("items", [])) if x["id"] == r.json()["id"])
    assert len(item["title_th"]) == 255 and "\x00" not in item["body_th"]
    assert client.post("/api/chat", json={"text": "สมัครเรียน\x00ยังไง", "channel": "kiosk"}).status_code == 200


def test_system_status_reports_database(client, admin_headers):
    db = client.get("/api/admin/system", headers=admin_headers).json()["database"]
    assert db["ok"] is True and db["engine"] in ("sqlite", "postgresql") and db["version"]


def test_frontend_files_are_always_revalidated(client):
    # แก้หน้าเว็บแล้วเบราว์เซอร์ต้องไม่ใช้ไฟล์ CSS/JS เก่าที่จำไว้
    for path in ("/", "/kiosk.css", "/app.js", "/shared/base.css", "/admin/", "/m/"):
        r = client.get(path)
        assert r.status_code == 200 and r.headers.get("cache-control") == "no-cache", path
    etag = client.get("/kiosk.css").headers["etag"]
    assert client.get("/kiosk.css", headers={"If-None-Match": etag}).status_code == 304


# ------------------------------------------------------------------ แผงสถานะระบบบนหน้า Kiosk
def test_health_reports_real_component_status(client):
    h = client.get("/api/health").json()
    # ฟิลด์เดิมยังอยู่ครบ
    for k in ("ok", "uptime_s", "intent_model", "robot_connected", "time"):
        assert k in h
    # ฟิลด์ใหม่สำหรับแผงสถานะ ต้องมาจากการตรวจจริง ไม่ใช่ค่าคงที่
    assert h["db"]["ok"] is True and h["db"]["engine"] in ("sqlite", "postgresql")
    assert h["ai"]["ready"] is (h["intent_model"] > 0)
    assert set(h["robot"]) >= {"connected", "online", "ready", "estop"}
