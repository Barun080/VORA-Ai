"""27 พ.ย. 2569: ประกาศเฉพาะตาราง · แนะนำสาขา · ภาพ/วิดีโอ · โควตานับเฉพาะประกาศจริง · ไม่ทิ้งเมื่อกำลังคุย"""
from datetime import datetime

import pytest

from app.config import settings
from app.db import SessionLocal
from app.models import News, Program, Schedule
from app.realtime import hub
from app.scheduler import PRScheduler, _media_kind, _program_payload, program_text


@pytest.fixture()
def prog(client):
    with SessionLocal() as db:
        p = Program(code="T-PR", name_th="ทดสอบประกาศ", name_en="PR Test", level="", status="published",
                    description_th="เรียนซ่อมเครื่องยนต์", description_en="Engine repair.", gallery="/uploads/g1.jpg\n/uploads/g2.jpg")
        db.add(p); db.commit(); pid = p.id
    yield pid
    with SessionLocal() as db:
        db.delete(db.get(Program, pid)); db.commit()


def test_program_text_skips_empty_level():
    p = Program(name_th="ช่างยนต์", name_en="", level="", description_th="เรียนซ่อมรถ")
    assert program_text(p, "th") == "แนะนำสาขาช่างยนต์ค่ะ เรียนซ่อมรถ" and "ระดับ" not in program_text(p, "th")
    assert program_text(p, "en") == ""                                   # ไม่มีชื่ออังกฤษ = ไม่พูด "Meet our  program."
    p.level = "ปวช."
    assert "เปิดสอนระดับปวช." in program_text(p, "th")


def test_media_kind():
    assert _media_kind("/uploads/a.JPG") == "image" and _media_kind("/uploads/a.mp4") == "video" and _media_kind("") == ""


def test_program_payload_uses_gallery_and_staff_override(prog):
    with SessionLocal() as db:
        p = db.get(Program, prog)
        out = _program_payload(p)
        assert out["image"] == "/uploads/g1.jpg" and out["kind"] == "program"
        s = Schedule(name="x", action="announce_program", target_id=prog, text_th="ข้อความที่เจ้าหน้าที่แก้", media_url="/uploads/v.mp4", priority=3)
        out = _program_payload(p, s)
        assert out["text_th"] == "ข้อความที่เจ้าหน้าที่แก้" and out["video"] == "/uploads/v.mp4" and out["priority"] == 3


def test_promo_rotation_does_not_use_quota(prog):
    s = PRScheduler()
    with SessionLocal() as db:
        for _ in range(30):
            s.next_promo(db)
    assert s._count_last_hour() == 0                                      # เดิม: นับ 30 → ตารางโดน rate_limited
    sch = Schedule(name="t", action="announce_text", priority=3, active=True)
    assert s._blocked_reason({}, datetime.now(), sch) in ("", "no_kiosk")


def test_busy_kiosk_does_not_drop_schedule(monkeypatch):
    s = PRScheduler()
    sch = Schedule(name="t", action="announce_text", priority=3, active=True)
    monkeypatch.setitem(hub.kiosk_state, "state", "conversation")
    monkeypatch.setattr(hub, "count", lambda role=None: 1)
    assert s._blocked_reason({}, datetime.now(), sch) == ""                # ส่งไปให้หน้าจอรอคุยจบเอง
    monkeypatch.setattr(settings, "pr_schedule_only", False)
    assert s._blocked_reason({}, datetime.now(), sch) == "busy"           # สวิตช์ปิด = แบบเดิม


def test_schedule_api_program_and_validation(client, admin_headers, prog):
    r = client.get(f"/api/admin/schedules/program-text/{prog}", headers=admin_headers).json()
    assert r["text_th"].startswith("แนะนำสาขาทดสอบประกาศ") and r["image"] == "/uploads/g1.jpg"
    bad = client.post("/api/admin/schedules", headers=admin_headers, json={"name": "x", "action": "announce_program"})
    assert bad.status_code == 400
    bad = client.post("/api/admin/schedules", headers=admin_headers, json={"name": "x", "action": "hack"})
    assert bad.status_code == 400
    ok = client.post("/api/admin/schedules", headers=admin_headers,
                     json={"name": "แนะนำสาขา", "action": "announce_program", "target_id": prog, "priority": 3, "times": "09:00"})
    assert ok.status_code == 200
    sid = ok.json()["id"]
    with client.websocket_connect("/ws?role=kiosk") as ws:
        assert ws.receive_json()["topic"] == "hello"
        run = client.post(f"/api/admin/schedules/{sid}/run", headers=admin_headers).json()
        assert run["ok"] is True
        for _ in range(10):
            m = ws.receive_json()
            if m["topic"] == "announce":
                d = m["data"]
                assert d["kind"] == "program" and d["image"] == "/uploads/g1.jpg" and d["wait_convo"] is True and "ระดับ" not in d["text_th"]
                break
        else:
            raise AssertionError("no announce")
    assert client.delete(f"/api/admin/schedules/{sid}", headers=admin_headers).status_code == 200


def test_text_schedule_image_media(client, admin_headers):
    r = client.post("/api/admin/schedules", headers=admin_headers,
                    json={"name": "รูป", "action": "play_media", "media_url": "/uploads/poster.png", "priority": 5, "interval_min": 60})
    sid = r.json()["id"]
    with client.websocket_connect("/ws?role=kiosk") as ws:
        ws.receive_json()
        client.post(f"/api/admin/schedules/{sid}/run", headers=admin_headers)
        for _ in range(10):
            m = ws.receive_json()
            if m["topic"] == "announce":
                assert m["data"]["image"] == "/uploads/poster.png" and m["data"]["video"] == "" and m["data"]["wait_convo"] is False
                break
    client.delete(f"/api/admin/schedules/{sid}", headers=admin_headers)


def test_kiosk_config_has_pr_fields(client, admin_headers):
    cfg = client.get("/api/kiosk/config").json()
    assert cfg["pr_schedule_only"] is True and cfg["idle_mode"] == "off" and "quiet_hours" in cfg   # ค่าเริ่มต้น = ไม่หมุน
    client.put("/api/admin/settings", headers=admin_headers, json={"idle_mode": "rotate"})
    assert client.get("/api/kiosk/config").json()["idle_mode"] == "rotate"
    client.put("/api/admin/settings", headers=admin_headers, json={"idle_mode": "off"})
