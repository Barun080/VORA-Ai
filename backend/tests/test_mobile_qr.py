"""25 พ.ย. 2569: คิวอาร์หน้ามือถือ (เลือก IP วง LAN ข้าม VPN · ที่อยู่สด · ผู้ดูแลล็อกได้ · https) + ธีมหน้ามือถือตามหน้าจอหุ่นยนต์"""
import pytest

from app import netaddr
from app.config import settings
from app.routers import public


def test_best_ip_skips_vpn_and_prefers_route():
    assert netaddr.best_lan_ip("10.2.4.250", ["26.162.135.119", "10.2.4.250"]) == ("10.2.4.250", True)
    assert netaddr.best_lan_ip("26.162.135.119", ["26.162.135.119", "192.168.1.50"]) == ("192.168.1.50", True)   # VPN เป็นเส้นทางหลัก
    assert netaddr.best_lan_ip("100.70.1.2", ["100.70.1.2", "25.1.2.3"]) == ("100.70.1.2", False)               # มีแต่ VPN
    assert netaddr.best_lan_ip("127.0.0.1", []) == ("127.0.0.1", False)
    assert netaddr.best_lan_ip("169.254.3.4", ["169.254.3.4", "172.20.0.5"]) == ("172.20.0.5", True)
    assert [c["kind"] for c in netaddr.candidates("192.168.1.5", ["26.0.0.1", "127.0.0.1"])] == ["lan", "vpn", "loopback"]


@pytest.fixture
def lan(monkeypatch):
    monkeypatch.setattr(netaddr, "best_lan_ip", lambda *a, **k: ("192.168.1.50", True))
    monkeypatch.setattr(settings, "public_url", "")
    monkeypatch.delenv("VORA_HTTPS_ACTIVE", raising=False)


def test_mobile_url_fresh_and_https(client, lan, monkeypatch):
    r = client.get("/api/kiosk/mobile_url").json()
    assert r == {"url": f"http://192.168.1.50:{settings.port}/m/", "ok": True, "warning": "", "source": "auto"}
    # รอบ 2: คิวอาร์ใช้ http เสมอ (ไม่มีหน้าเตือน) · https แยกให้ปุ่มไมค์
    monkeypatch.setenv("VORA_HTTPS_ACTIVE", "1")
    assert client.get("/api/kiosk/mobile_url").json()["url"] == f"http://192.168.1.50:{settings.port}/m/"
    cfg = client.get("/api/kiosk/config").json()
    assert cfg["mobile_url"].startswith("http://192.168.1.50") and cfg["mobile_ok"] is True and cfg["theme"] in ("light", "dark")
    assert cfg["mobile_https_url"] == f"https://192.168.1.50:{settings.https_port}/m/"
    monkeypatch.delenv("VORA_HTTPS_ACTIVE")
    assert client.get("/api/kiosk/config").json()["mobile_https_url"] == ""


def test_no_lan_warns(client, monkeypatch):
    monkeypatch.setattr(netaddr, "best_lan_ip", lambda *a, **k: ("127.0.0.1", False))
    monkeypatch.setattr(settings, "public_url", "")
    r = client.get("/api/kiosk/mobile_url").json()
    assert r["ok"] is False and "LAN" in r["warning"]


def test_admin_pin_and_env_priority(client, lan, admin_headers, editor_headers, monkeypatch):
    g = client.get("/api/admin/mobile-qr", headers=editor_headers).json()
    assert g["current"]["source"] == "auto" and "candidates" in g
    assert client.put("/api/admin/mobile-qr", json={"base": "https://10.0.0.9:8443"}, headers=editor_headers).status_code == 403
    for bad in ("ftp://x", "https://x/m/", "javascript:alert(1)", "https://a b"):
        assert client.put("/api/admin/mobile-qr", json={"base": bad}, headers=admin_headers).status_code == 400, bad
    r = client.put("/api/admin/mobile-qr", json={"base": "https://10.0.0.9:8443/"}, headers=admin_headers).json()
    assert r["current"]["url"] == "https://10.0.0.9:8443/m/" and r["current"]["source"] == "admin"
    assert client.get("/api/kiosk/mobile_url").json()["url"] == "https://10.0.0.9:8443/m/"
    monkeypatch.setattr(settings, "public_url", "https://vora.example.ac.th")
    assert client.get("/api/kiosk/mobile_url").json()["source"] == "env"
    monkeypatch.setattr(settings, "public_url", "")
    client.put("/api/admin/mobile-qr", json={"base": ""}, headers=admin_headers)
    assert client.get("/api/kiosk/mobile_url").json()["source"] == "auto"


def test_theme_only_from_robot_screen(client, monkeypatch):
    assert client.post("/api/kiosk/theme", json={"theme": "light"}).status_code == 200        # testclient = เครื่องบนตัวหุ่นยนต์ (conftest)
    assert client.get("/api/kiosk/config").json()["theme"] == "light"
    assert client.post("/api/kiosk/theme", json={"theme": "pink"}).status_code == 400
    monkeypatch.setattr(settings, "kiosk_trusted_hosts", ("127.0.0.1",))
    assert client.post("/api/kiosk/theme", json={"theme": "dark"}).status_code == 403
    assert client.get("/api/kiosk/config").json()["theme"] == "light"
    monkeypatch.setattr(settings, "kiosk_trusted_hosts", ("127.0.0.1", "::1", "testclient"))
    client.post("/api/kiosk/theme", json={"theme": "dark"})


def test_mobile_page_uses_red_theme(client):
    html = client.get("/m/").text
    assert "#1d5aa6" not in html and "--accent: #FF2B3A" in html and 'data-vora-theme' in html and 'id="mic"' in html
    assert "#1d5aa6" not in client.get("/m/apply.html").text


def test_program_more_uses_only_approved_kb(client):
    from app.db import SessionLocal
    from app.models import KnowledgeItem, Program
    from app.ai.retriever import retriever
    with SessionLocal() as db:
        p = Program(code="TEST-MORE", name_th="ทดสอบช่างกล", level="ปวช.", status="published", keywords="ช่างกลทดสอบ")
        db.add(p); db.flush()
        ks = [KnowledgeItem(kind="faq", category="program", question="แผนกทดสอบช่างกลเรียนวิชาอะไรบ้าง", answer_th="เรียนวิชา ก ข ค", status="approved"),
              KnowledgeItem(kind="faq", category="program", question="แผนกทดสอบช่างกลเปิดระดับไหน", answer_th="ปวช. และ ปวส.", status="approved"),
              KnowledgeItem(kind="faq", category="program", question="แผนกทดสอบช่างกลมีกิจกรรมอะไร", answer_th="ร่าง", status="draft"),
              KnowledgeItem(kind="faq", category="program", question="แผนกอื่นเรียนอะไร", answer_th="ไม่เกี่ยว", status="approved")]
        db.add_all(ks); db.commit()
        pid, kids = p.id, [k.id for k in ks]
    try:
        r = client.get(f"/api/programs/{pid}/more").json()
        assert [x["topic"] for x in r] == ["learn", "level"] and r[0]["answer_th"] == "เรียนวิชา ก ข ค"
        assert client.get("/api/programs/999999/more").status_code == 404
        lst = client.get("/api/programs").json()
        assert "suits_th" in lst[0]
    finally:
        with SessionLocal() as db:
            for k in kids:
                db.delete(db.get(KnowledgeItem, k))
            db.delete(db.get(Program, pid)); db.commit()
        retriever.mark_dirty()


def test_mobile_page_has_new_sections(client):
    html = client.get("/m/").text
    for must in ('data-tab="home"', "renderQuiz", "/api/programs/${id}/more", "mobile_https_url", "context_program_id", "navigator.share"):
        assert must in html, must
