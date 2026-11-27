"""Phase 6 · Gate 6E-4 — F1 / F1b: สิทธิ์ kiosk ตัดสินที่ server (ไม่เชื่อ channel จาก client)

TestClient ส่ง IP ผู้เรียก = "testclient" · conftest ตั้งให้ "testclient" เป็นเครื่องที่เชื่อถือได้ (แทน localhost ของการใช้งานจริง)
ชุดทดสอบนี้จำลองเครื่องที่ไม่น่าเชื่อถือ (มือถือ/เครื่องอื่นใน LAN) โดยเอา "testclient" ออกจาก VORA_KIOSK_TRUSTED_HOSTS

S-CH  : /api/chat — spoof channel=kiosk ไม่ได้สิทธิ์ · ถูกจำกัดอัตรา · ไม่สั่งท่าหุ่นยนต์ · บันทึกเป็น mobile
S-OK  : เครื่องที่เชื่อถือได้ทำงานเหมือนเดิม (ไม่จำกัดอัตรา · ท่าหุ่นยนต์ · channel kiosk)
S-F1b : /api/greet · /api/vision/recognized · /ws?role=kiosk จากเครื่องที่ไม่น่าเชื่อถือ → ปฏิเสธ
S-STOP: /api/robot/stop เปิดได้เสมอ (ปุ่มหยุดเพื่อความปลอดภัย)
S-RB  : VORA_CHANNEL_TRUST=legacy = พฤติกรรมก่อน 6E (ทาง rollback)
"""
from types import SimpleNamespace

import pytest
from starlette.websockets import WebSocketDisconnect

import app.routers.public as public
from app.config import settings
from app.db import SessionLocal
from app.models import ChatSession, Message
from app.robot.bridge import bridge

UNTRUSTED = ("127.0.0.1", "::1")                    # ค่าเริ่มต้นของระบบจริง → "testclient" ไม่อยู่ในรายการ


@pytest.fixture
def robot(monkeypatch):
    """บันทึกคำสั่งท่า/หยุดที่ส่งไปหุ่นยนต์ (ไม่แตะ protocol/driver)"""
    calls = {"gesture": [], "stop": []}

    async def gesture(name, source="ai"):
        calls["gesture"].append(name)

    async def stop(source="user"):
        calls["stop"].append(source)
    monkeypatch.setattr(bridge, "gesture", gesture)
    monkeypatch.setattr(bridge, "stop", stop)
    return calls


@pytest.fixture
def fresh_rate(monkeypatch):
    """แยกตัวนับ rate limit ของชุดนี้ ไม่ให้กระทบชุดทดสอบอื่น"""
    monkeypatch.setattr(public, "_rate", {})


@pytest.fixture
def untrusted(monkeypatch, fresh_rate):
    monkeypatch.setattr(settings, "kiosk_trusted_hosts", UNTRUSTED)
    monkeypatch.setattr(settings, "channel_trust", "server")


@pytest.fixture
def broadcasts(monkeypatch):
    seen = []
    real = public.hub.broadcast

    async def spy(topic, data, roles=None):
        seen.append((topic, data))
        return await real(topic, data, roles=roles)
    monkeypatch.setattr(public.hub, "broadcast", spy)
    return seen


def chat(client, text="โบกมือหน่อย", channel="kiosk", headers=None):
    return client.post("/api/chat", json={"text": text, "lang": "th", "channel": channel}, headers=headers or {})


def session_channel(sid: str) -> str:
    db = SessionLocal()
    try:
        return db.get(ChatSession, sid).channel
    finally:
        db.close()


# ---------------------------------------------------------------- unit
@pytest.mark.parametrize("host,claimed,expected", [
    ("127.0.0.1", "kiosk", True), ("::1", "kiosk", True), ("192.168.1.20", "kiosk", False), ("10.0.0.5", "kiosk", False),
    ("", "kiosk", False), ("127.0.0.1", "mobile", False), ("192.168.1.20", "mobile", False),
])
def test_s_unit_is_trusted_kiosk(monkeypatch, host, claimed, expected):
    monkeypatch.setattr(settings, "kiosk_trusted_hosts", ("127.0.0.1", "::1"))
    monkeypatch.setattr(settings, "channel_trust", "server")
    conn = SimpleNamespace(client=SimpleNamespace(host=host) if host else None)
    assert public.is_trusted_kiosk(conn, claimed) is expected


def test_s_unit_default_trusted_hosts_are_loopback_only(monkeypatch):
    from app.config import Settings
    monkeypatch.delenv("VORA_KIOSK_TRUSTED_HOSTS", raising=False)
    monkeypatch.delenv("VORA_CHANNEL_TRUST", raising=False)
    s = Settings()
    assert s.kiosk_trusted_hosts == ("127.0.0.1", "::1") and s.channel_trust == "server"


# ---------------------------------------------------------------- S-CH
def test_s_ch_spoofed_kiosk_gets_no_robot_gesture(client, untrusted, robot, broadcasts):
    r = chat(client, "โบกมือหน่อย", "kiosk")
    assert r.status_code == 200
    body = r.json()
    assert body["robot_action"] == "wave"            # คำตอบเดิม (ข้อความ/ท่าในคำตอบ) ไม่เปลี่ยน
    assert robot["gesture"] == []                    # แต่ไม่สั่งหุ่นยนต์จริง
    assert session_channel(body["session_id"]) == "mobile"
    msg = [d for t, d in broadcasts if t == "chat.message"][-1]
    assert msg["channel"] == "mobile"


def test_s_ch_spoofed_kiosk_is_rate_limited(client, untrusted):
    codes = [chat(client, f"สวัสดี {i}", "kiosk").status_code for i in range(32)]
    assert codes[:30] == [200] * 30 and codes[30:] == [429, 429]


def test_s_ch_forwarded_header_does_not_grant_kiosk(client, untrusted, robot):
    r = chat(client, "โบกมือหน่อย", "kiosk", headers={"X-Forwarded-For": "127.0.0.1", "X-Real-IP": "127.0.0.1"})
    assert r.status_code == 200 and robot["gesture"] == []


def test_s_ch_mobile_from_untrusted_unchanged(client, untrusted, robot):
    r = chat(client, "โบกมือหน่อย", "mobile")
    assert r.status_code == 200 and robot["gesture"] == []
    assert session_channel(r.json()["session_id"]) == "mobile"


# ---------------------------------------------------------------- S-OK (เครื่องที่เชื่อถือได้)
def test_s_ok_trusted_kiosk_triggers_gesture(client, fresh_rate, robot, broadcasts):
    import time
    r = chat(client, "โบกมือหน่อย", "kiosk")
    assert r.status_code == 200
    for _ in range(50):                               # create_task — รอให้ task ทำงาน
        if robot["gesture"]:
            break
        time.sleep(0.01)
    assert robot["gesture"] == ["wave"]
    assert session_channel(r.json()["session_id"]) == "kiosk"
    assert [d for t, d in broadcasts if t == "chat.message"][-1]["channel"] == "kiosk"


def test_s_ok_trusted_kiosk_not_rate_limited(client, fresh_rate):
    codes = {chat(client, f"สวัสดีค่ะ {i}", "kiosk").status_code for i in range(35)}
    assert codes == {200}


def test_s_ok_trusted_host_can_only_downgrade(client, fresh_rate, robot):
    """หน้ามือถือที่เปิดบนเครื่องหุ่นยนต์ (ส่ง mobile) → ไม่ได้สิทธิ์ kiosk"""
    r = chat(client, "โบกมือหน่อย", "mobile")
    assert r.status_code == 200 and robot["gesture"] == []
    assert session_channel(r.json()["session_id"]) == "mobile"


# ---------------------------------------------------------------- S-F1b
def test_s_f1b_greet_spoof_blocked(client, untrusted, robot):
    db = SessionLocal()
    n = db.query(Message).filter(Message.intent == "auto_greeting").count()
    db.close()
    r = client.post("/api/greet", json={"lang": "th", "trigger": "face", "people": 1})
    assert r.status_code == 403 and robot["gesture"] == []
    db = SessionLocal()
    assert db.query(Message).filter(Message.intent == "auto_greeting").count() == n
    db.close()


def test_s_f1b_greet_trusted_unchanged(client, robot):
    r = client.post("/api/greet", json={"lang": "th", "trigger": "face", "people": 1})
    assert r.status_code == 200 and r.json()["gesture"] == "wave" and robot["gesture"] == ["wave"]


def test_s_f1b_vision_spoof_blocked(client, untrusted, robot):
    r = client.post("/api/vision/recognized", json={"label": "it", "confidence": 0.9, "lang": "th"})
    assert r.status_code == 403 and robot["gesture"] == []


def test_s_f1b_vision_trusted_unchanged(client, robot):
    r = client.post("/api/vision/recognized", json={"label": "it", "confidence": 0.9, "lang": "th"})
    assert r.status_code == 200 and robot["gesture"] == ["present"]


@pytest.mark.parametrize("url", ["/ws?role=kiosk", "/ws"])          # ไม่ระบุ role = kiosk (ค่าเริ่มต้นเดิม)
def test_s_f1b_ws_kiosk_role_spoof_blocked(client, untrusted, url):
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect(url) as ws:
            ws.receive_json()
    assert e.value.code == 4403


def test_s_f1b_ws_mobile_role_still_allowed_from_untrusted(client, untrusted):
    with client.websocket_connect("/ws?role=mobile") as ws:
        hello = ws.receive_json()
    assert hello["topic"] == "hello" and hello["data"]["role"] == "mobile"


def test_s_f1b_ws_kiosk_role_trusted_allowed(client):
    with client.websocket_connect("/ws?role=kiosk") as ws:
        hello = ws.receive_json()
    assert hello["data"]["role"] == "kiosk"


# ---------------------------------------------------------------- S-STOP
def test_s_stop_robot_stop_always_open(client, untrusted, robot):
    r = client.post("/api/robot/stop")
    assert r.status_code == 200 and r.json() == {"ok": True} and robot["stop"] == ["kiosk"]


# ---------------------------------------------------------------- S-RB
def test_s_rb_legacy_mode_restores_pre_6e_behaviour(client, untrusted, robot, monkeypatch):
    import time
    monkeypatch.setattr(settings, "channel_trust", "legacy")
    r = chat(client, "โบกมือหน่อย", "kiosk")
    for _ in range(50):
        if robot["gesture"]:
            break
        time.sleep(0.01)
    assert r.status_code == 200 and robot["gesture"] == ["wave"]
    assert session_channel(r.json()["session_id"]) == "kiosk"
    assert client.post("/api/greet", json={"lang": "th"}).status_code == 200
