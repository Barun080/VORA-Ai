"""จอในวง LAN (25 พ.ย. 2569) — app/routers/screens.py · public.is_display_kiosk · /ws kiosk · scripts/make_lan_cert.py
TestClient มาจาก host "testclient" — ไฟล์นี้เอาออกจาก VORA_KIOSK_TRUSTED_HOSTS → เท่ากับเครื่องอื่นในวง LAN"""
import os
import secrets
import subprocess
import sys
from pathlib import Path

import pytest

from app.config import settings
from app.db import SessionLocal
from app.models import ChatSession, KioskScreen
from app.realtime import hub
from app.routers import public, screens

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    # conftest ให้ "testclient" เป็นเครื่องบนตัวหุ่นยนต์ — ไฟล์นี้จำลองเครื่องอื่นในวง LAN จึงเอาออก
    monkeypatch.setattr(settings, "kiosk_trusted_hosts", ("127.0.0.1", "::1"))
    screens.forget()
    public._rate.clear()
    yield
    screens.forget()


@pytest.fixture
def gestures(monkeypatch):
    calls = []

    async def fake(name):
        calls.append(name)
    monkeypatch.setattr(public, "_robot_gesture", fake)
    return calls


def _hello(client, key, **kw):
    return client.post("/api/screens/hello", json={"key": key, **kw})


def _sid(client, admin_headers, code):
    d = client.get("/api/admin/screens", headers=admin_headers).json()
    return next(s["id"] for s in d["screens"] if s["code"] == code)


def test_hello_registers_pending_and_validates_key(client):
    key = secrets.token_hex(16)
    r = _hello(client, key, name="จอโถง<script>")
    assert r.status_code == 200 and r.json()["status"] == "pending" and len(r.json()["code"]) == 4
    assert r.json()["name"] == "จอโถงscript"
    assert _hello(client, key).json()["code"] == r.json()["code"]                 # เครื่องเดิม = แถวเดิม
    assert _hello(client, "Z" * 32).status_code == 400
    assert _hello(client, "abc").status_code == 422
    with SessionLocal() as db:
        s = db.query(KioskScreen).filter(KioskScreen.code == r.json()["code"]).first()
        assert s.key_hash != key and len(s.key_hash) == 64                         # เก็บเฉพาะ hash


def test_pending_screen_is_like_mobile_then_approved_gets_display_rights(client, admin_headers, editor_headers, gestures):
    key = secrets.token_hex(16)
    code = _hello(client, key).json()["code"]
    h = {"X-VORA-Screen": key}
    assert client.post("/api/greet", json={}, headers=h).status_code == 403
    assert client.post("/api/vision/recognized", json={"label": "x"}, headers=h).status_code == 403
    sid = _sid(client, admin_headers, code)
    assert client.put(f"/api/admin/screens/{sid}", json={"status": "approved"}, headers=editor_headers).status_code == 403   # ผู้ดูแลเท่านั้น
    r = client.put(f"/api/admin/screens/{sid}", json={"status": "approved", "name": "จอห้องสมุด"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "approved" and r.json()["name"] == "จอห้องสมุด"
    g = client.post("/api/greet", json={"people": 1}, headers=h)
    assert g.status_code == 200 and g.json()["text"]
    assert gestures == []                                                          # ไม่สั่งท่าหุ่นยนต์จริง
    c = client.post("/api/chat", json={"text": "วิทยาลัยอยู่ที่ไหน", "channel": "kiosk"}, headers=h).json()
    with SessionLocal() as db:
        assert db.get(ChatSession, c["session_id"]).channel == "kiosk"
    assert gestures == []
    # ไม่ถูกจำกัดจำนวนคำถาม (มือถือ 30 ครั้ง/นาที)
    for _ in range(32):
        assert client.post("/api/chat", json={"text": "สวัสดี", "channel": "kiosk"}, headers=h).status_code == 200
    # ปิดสิทธิ์ → กลับเป็นแบบมือถือทันที
    client.put(f"/api/admin/screens/{sid}", json={"status": "revoked"}, headers=admin_headers)
    assert client.post("/api/greet", json={}, headers=h).status_code == 403
    c2 = client.post("/api/chat", json={"text": "สวัสดี", "channel": "kiosk"}, headers=h).json()
    with SessionLocal() as db:
        assert db.get(ChatSession, c2["session_id"]).channel == "mobile"


def test_mobile_channel_claim_is_never_upgraded(client, admin_headers):
    key = secrets.token_hex(16)
    code = _hello(client, key).json()["code"]
    client.put(f"/api/admin/screens/{_sid(client, admin_headers, code)}", json={"status": "approved"}, headers=admin_headers)
    c = client.post("/api/chat", json={"text": "สวัสดี", "channel": "mobile"}, headers={"X-VORA-Screen": key}).json()
    with SessionLocal() as db:
        assert db.get(ChatSession, c["session_id"]).channel == "mobile"


def test_websocket_kiosk_role_for_approved_screen_only(client, admin_headers):
    from starlette.websockets import WebSocketDisconnect
    key = secrets.token_hex(16)
    code = _hello(client, key).json()["code"]
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws?role=kiosk&screen={key}") as ws:
            ws.receive_json()
    client.put(f"/api/admin/screens/{_sid(client, admin_headers, code)}", json={"status": "approved"}, headers=admin_headers)
    before = dict(hub.kiosk_state) if isinstance(hub.kiosk_state, dict) else hub.kiosk_state
    with client.websocket_connect(f"/ws?role=kiosk&screen={key}") as ws:
        assert ws.receive_json()["topic"] == "hello"
        ws.send_json({"type": "state", "state": "speaking"})                       # จอรองเปลี่ยนสถานะหน้าจอหลักไม่ได้
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["topic"] == "pong"
    assert hub.kiosk_state == before or hub.kiosk_state.get("state") != "speaking"


def test_admin_list_info_rename_delete(client, admin_headers, editor_headers):
    key = secrets.token_hex(16)
    code = _hello(client, key).json()["code"]
    d = client.get("/api/admin/screens", headers=editor_headers).json()
    assert d["enabled"] is True and d["http_port"] == settings.port and "https" in d and d["lan_ip"]
    sid = _sid(client, admin_headers, code)
    assert client.put(f"/api/admin/screens/{sid}", json={"status": "boss"}, headers=admin_headers).status_code == 400
    assert client.delete(f"/api/admin/screens/{sid}", headers=editor_headers).status_code == 403
    assert client.delete(f"/api/admin/screens/{sid}", headers=admin_headers).status_code == 200
    assert client.delete(f"/api/admin/screens/{sid}", headers=admin_headers).status_code == 404


def test_switch_off_means_mobile_only(client, admin_headers, monkeypatch):
    key = secrets.token_hex(16)
    code = _hello(client, key).json()["code"]
    client.put(f"/api/admin/screens/{_sid(client, admin_headers, code)}", json={"status": "approved"}, headers=admin_headers)
    monkeypatch.setattr(settings, "lan_screens", False)
    screens.forget()
    assert _hello(client, secrets.token_hex(16)).json() == {"status": "off"}
    assert client.post("/api/greet", json={}, headers={"X-VORA-Screen": key}).status_code == 403


def test_pending_cap(client, monkeypatch):
    monkeypatch.setattr(screens, "MAX_PENDING", 0)
    assert _hello(client, secrets.token_hex(16)).status_code == 429


def test_make_lan_cert_creates_and_reuses(tmp_path):
    pytest.importorskip("cryptography")
    env = {**os.environ, "VORA_DATA_DIR": str(tmp_path)}
    cmd = [sys.executable, str(ROOT / "scripts" / "make_lan_cert.py"), "--ip", "192.168.1.50"]
    r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    crt, key = tmp_path / "certs" / "vora-lan.crt", tmp_path / "certs" / "vora-lan.key"
    assert crt.exists() and key.exists() and "PRIVATE KEY" not in r.stdout
    from cryptography import x509
    san = x509.load_pem_x509_certificate(crt.read_bytes()).extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert "192.168.1.50" in {str(i) for i in san.get_values_for_type(x509.IPAddress)} and "localhost" in san.get_values_for_type(x509.DNSName)
    mtime = crt.stat().st_mtime
    r2 = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=60)
    assert r2.returncode == 0 and crt.stat().st_mtime == mtime                    # ใช้ของเดิมเมื่อ IP ครบ
