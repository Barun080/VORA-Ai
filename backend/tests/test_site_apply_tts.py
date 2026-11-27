"""12 พ.ย. 2569: เว็บไซต์วิทยาลัย (หน้าเว็บ + QR) · ขั้นตอนสมัครออนไลน์จากหลังบ้าน · สตรีมเสียงทั้งคำตอบ · หน้าพิมพ์ใบสมัคร"""
from __future__ import annotations

import asyncio
import sys
import types

import pytest

from app import tts
from app.ai import engine


@pytest.fixture()
def settings_put(client, admin_headers):
    old = client.get("/api/admin/settings", headers=admin_headers).json()
    keys = []

    def put(**kv):
        keys.extend(kv)
        r = client.put("/api/admin/settings", json=kv, headers=admin_headers)
        assert r.status_code == 200
    yield put
    if keys:
        client.put("/api/admin/settings", json={k: old.get(k, "") for k in keys}, headers=admin_headers)


def chat(client, text, lang="th"):
    return client.post("/api/chat", json={"text": text, "lang": lang, "channel": "kiosk"}).json()


def test_website_question_shows_site_popup(client, settings_put, monkeypatch):
    from app.ai import web
    _fake_sites(monkeypatch)
    monkeypatch.setattr(web.settings, "ai_web_enabled", True)

    async def none(q, lang="th", **kw):
        return None
    monkeypatch.setattr(web, "search", none)
    settings_put(website_url="www.technicnan.ac.th")
    r = chat(client, "ขอดูเว็บไซต์วิทยาลัยหน่อย")
    assert r["media"]["site"]["url"] == "https://www.technicnan.ac.th"
    cfg = client.get("/api/kiosk/config").json()
    assert cfg["website"] == "https://www.technicnan.ac.th" and cfg["apply_form_url"].endswith("/m/apply.html")
    r = chat(client, "หาข้อมูลเว็บไซต์วิทยาลัย")          # สั่งค้นเว็บ ≠ เปิดหน้าเว็บวิทยาลัย
    assert "site" not in r["media"]


def test_school_website_falls_back_to_knowledge_domain():
    class Q:
        def filter(self, *a): return self
        def limit(self, n): return self
        def all(self): return [("ดูได้ที่ www.technicnan.ac.th ค่ะ",), ("เว็บ technicnan.ac.th/apply",), ("facebook.com/x",)]

    class DB:
        def query(self, *a): return Q()
    assert engine.school_website(DB(), {"website_url": ""}).startswith("https://")
    assert "technicnan.ac.th" in engine.school_website(DB(), {"website_url": ""})
    assert engine.school_website(DB(), {"website_url": "https://example.ac.th/"}) == "https://example.ac.th"


def test_apply_online_only_when_staff_configured(client, settings_put):
    settings_put(apply_steps_th="", apply_steps_en="")
    r = chat(client, "สมัครเรียนออนไลน์ยังไง")
    assert "apply_online" not in r["media"]                 # ไม่มีข้อมูลจากเจ้าหน้าที่ = ไม่เดาขั้นตอน
    settings_put(apply_steps_th="เข้าเว็บรับสมัคร\n- กรอกข้อมูลผู้สมัคร\n\nอัปโหลดเอกสาร", apply_online_url="https://apply.example.ac.th",
                 apply_contact_th="งานทะเบียน อาคาร 1")
    r = chat(client, "สมัครเรียนออนไลน์ยังไง")
    a = r["media"]["apply_online"]
    assert a["steps"] == ["เข้าเว็บรับสมัคร", "กรอกข้อมูลผู้สมัคร", "อัปโหลดเอกสาร"] and a["url"] == "https://apply.example.ac.th"
    assert "ขั้นที่ 3 อัปโหลดเอกสาร" in r["text"] and "3 ขั้นตอน" in r["text"]
    r = chat(client, "how do I apply online", "en")       # ไม่มีฉบับอังกฤษ → ใช้ขั้นตอนภาษาไทย
    assert r["media"]["apply_online"]["steps"][0] == "เข้าเว็บรับสมัคร"
    cfg = client.get("/api/kiosk/config").json()
    assert cfg["apply_online"]["th"]["contact"] == "งานทะเบียน อาคาร 1"


def test_web_answer_not_truncated(client, monkeypatch):
    from app.ai import web
    monkeypatch.setattr(web.settings, "ai_web_enabled", True)
    long = "ดาวอังคารเป็นดาวเคราะห์ ค่ะ " * 40

    async def fake(q, lang="th", **kw):
        return {"query": q, "title": "x", "summary": long, "points": [], "sources": [{"title": "w", "url": "https://x"}],
                "images": [], "engine": "wikipedia", "lang": lang, "at": 0, "ttl_s": 300}
    monkeypatch.setattr(web, "search", fake)
    r = chat(client, "หาข้อมูลดาวอังคาร")
    assert len(r["text"]) > 600


# ---------------------------------------------------------------- สตรีมเสียง
def _fake_edge(monkeypatch, plan):
    """plan: รายการผลของแต่ละครั้งที่เรียก Communicate — "ok" | "fail" | "cut" """
    calls = []

    class Communicate:
        def __init__(self, text, voice, rate=None, pitch=None):
            calls.append(text)
            self.mode = plan[min(len(calls) - 1, len(plan) - 1)]

        async def stream(self):
            if self.mode == "fail":
                raise RuntimeError("No audio was received")
            yield {"type": "audio", "data": b"AA"}
            if self.mode == "cut":
                raise RuntimeError("connection reset")
            yield {"type": "WordBoundary"}
            yield {"type": "audio", "data": b"BB"}
    monkeypatch.setitem(sys.modules, "edge_tts", types.SimpleNamespace(Communicate=Communicate))
    monkeypatch.setattr(tts, "available", lambda: True)
    monkeypatch.setattr(tts, "_state", {"fail_until": 0.0, "last_error": "", "fails": 0})
    monkeypatch.setattr(tts, "record_event", lambda *a, **k: None)
    return calls


async def _collect(text):
    return b"".join([c async for c in tts.stream(text, "th")])


def test_tts_stream_retries_before_first_byte_and_caches(monkeypatch, tmp_path):
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path)
    calls = _fake_edge(monkeypatch, ["fail", "ok"])
    assert asyncio.run(_collect("สวัสดีค่ะ")) == b"AABB" and len(calls) == 2
    assert asyncio.run(_collect("สวัสดีค่ะ")) == b"AABB" and len(calls) == 2      # ครั้งที่สองมาจากแคช


def test_tts_stream_cut_midway_returns_partial_without_retry(monkeypatch, tmp_path):
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path)
    calls = _fake_edge(monkeypatch, ["cut", "ok"])
    assert asyncio.run(_collect("ยาวมากค่ะ")) == b"AA" and len(calls) == 1          # ส่งไปแล้ว ลองใหม่ไม่ได้ (จะพูดซ้ำ)
    assert not list(tmp_path.glob("*.mp3"))                                         # ไม่เก็บไฟล์ไม่ครบ


def test_tts_stream_endpoint(client, monkeypatch, tmp_path):
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path)
    _fake_edge(monkeypatch, ["ok"])
    sid = client.post("/api/tts/session", json={"text": "ทดสอบเสียงค่ะ", "lang": "th"}).json()["id"]
    r = client.get(f"/api/tts/stream/{sid}")
    assert r.status_code == 200 and r.content == b"AABB" and r.headers["content-type"] == "audio/mpeg"
    assert client.get("/api/tts/stream/nope").status_code == 404
    _fake_edge(monkeypatch, ["fail"])
    sid = client.post("/api/tts/session", json={"text": "อีกประโยคค่ะ", "lang": "th"}).json()["id"]
    assert client.get(f"/api/tts/stream/{sid}").status_code == 204                 # เริ่มไม่ได้ → หน้าจอใช้วิธีทีละประโยค


def test_tts_warm_fills_cache(client, monkeypatch, tmp_path):
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path)

    async def fake_stream(text, voice, rate, pitch):
        return b"MP3"
    monkeypatch.setattr(tts, "_stream", fake_stream)
    monkeypatch.setattr(tts, "available", lambda: True)
    assert client.post("/api/tts/warm", json={"text": "สไลด์ถัดไปค่ะ"}).json()["ok"] is True
    assert tts.cache_path("สไลด์ถัดไปค่ะ", "th").exists()


def test_mobile_apply_page_served(client):
    r = client.get("/m/apply.html")
    assert r.status_code == 200 and "ใบสมัครเข้าศึกษา" in r.text and "ไม่ถูกส่งไปที่ใด" in r.text


# ---------------------------------------------------------------- 12 พ.ย. 2569 (รอบ 2): เปิดเว็บตามคำขอ · แนะนำวิทยาลัย · เสียงสำรอง
from app.ai import sites  # noqa: E402


def test_site_detect_requests_only():
    assert sites.detect("เปิดเว็บไซต์วิทยาลัย") == ("วิทยาลัย", False)
    assert sites.detect("ต้องการดูเว็บไซต์เกี่ยวกับดาวอังคาร") == ("ดาวอังคาร", True)
    assert sites.detect("เปิดเว็บ youtube.com") == ("youtube.com", False)
    assert sites.detect("open the website of NASA") == ("NASA", False)
    for t in ("เว็บไซต์วิทยาลัยคืออะไร", "ดูข่าว", "เปิดหน้าสาขาวิชา", "หาข้อมูลเว็บไซต์วิทยาลัย", "ค่าเทอมเท่าไหร่"):
        assert sites.detect(t) is None, t


def _fake_sites(monkeypatch, ok=True, embeddable=True):
    seen = []

    async def check(url):
        seen.append(url)
        return {"url": url, "ok": ok, "embeddable": embeddable, "reason": ""}

    async def wiki(topic, lang):
        return (f"https://th.wikipedia.org/wiki/{topic}", topic)

    async def official(name):
        return "https://www.tmd.go.th"
    monkeypatch.setattr(sites, "check", check)
    monkeypatch.setattr(sites, "_wikipedia", wiki)
    monkeypatch.setattr(sites, "_official", official)
    return seen


def test_site_resolve_paths(monkeypatch):
    _fake_sites(monkeypatch)
    run = lambda q, about=False: asyncio.run(sites.resolve(q, about, "th", "https://www.technicnan.ac.th", "วิทยาลัยเทคนิคน่าน"))
    assert run("")["url"] == "https://www.technicnan.ac.th" and run("วิทยาลัยเทคนิคน่าน")["kind"] == "school"
    assert run("www.example.com")["url"] == "https://www.example.com"
    assert run("ดาวอังคาร", True)["kind"] == "wikipedia"
    assert run("กรมอุตุนิยมวิทยา")["url"] == "https://www.tmd.go.th"
    assert run("ufabet.com") == {"blocked": True} and run("เว็บพนันออนไลน์") == {"blocked": True}


def test_site_check_refuses_private_hosts():
    for u in ("http://localhost:8000/admin", "http://127.0.0.1/", "http://192.168.1.1/", "http://10.0.0.5/"):
        assert asyncio.run(sites.check(u))["ok"] is False


def test_open_website_request_via_chat(client, settings_put, monkeypatch):
    _fake_sites(monkeypatch, embeddable=False)
    settings_put(website_url="https://www.technicnan.ac.th")
    r = chat(client, "เปิดเว็บไซต์วิทยาลัยหน่อย")
    assert r["media"]["site"]["url"] == "https://www.technicnan.ac.th" and r["media"]["site"]["embeddable"] is False
    assert "เปิดเว็บไซต์" in r["text"]
    r = chat(client, "ต้องการดูเว็บไซต์เกี่ยวกับดาวอังคาร")     # รอบ 3: "เกี่ยวกับ" = ค้นเว็บที่เกี่ยวข้อง (ปิดค้นเว็บ → Wikipedia)
    assert r["media"]["site"]["kind"] == "related" and r["provider"] == "site:related:wikipedia"
    r = chat(client, "เว็บไซต์วิทยาลัยคืออะไร")                    # ถามเฉย ๆ ไม่ได้ขอเปิด → ไม่เด้งหน้าเว็บ (เปลี่ยนจากเดิม)
    assert "site" not in r["media"]


def test_about_college_card(client, settings_put):
    settings_put(about_th="วิทยาลัยเทคนิคน่านเป็นสถานศึกษาอาชีวะของจังหวัดน่านค่ะ", facebook_url="facebook.com/technicnan",
                 website_url="https://www.technicnan.ac.th", phone="054-000000", map_url="https://maps.app.goo.gl/x", address_th="ถนนรอบกำแพงเมือง")
    r = chat(client, "แนะนำวิทยาลัยหน่อย")
    assert r["text"].startswith("วิทยาลัยเทคนิคน่าน") and r["provider"] == "rules"
    kinds = [c["kind"] for c in r["media"]["about"]["contacts"]]
    assert kinds == ["website", "facebook", "map", "phone"]
    assert r["media"]["about"]["contacts"][1]["url"] == "https://facebook.com/technicnan"
    r = chat(client, "ค่าเทอมวิทยาลัยเท่าไหร่")                    # คำถามเจาะจง ไม่ใช่แนะนำวิทยาลัย
    assert "about" not in r["media"]


def test_google_fallback_when_edge_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path)
    _fake_edge(monkeypatch, ["fail"])
    monkeypatch.setattr(tts.settings, "tts_fallback", "google")
    got = []

    async def g(text, lang="th"):
        got.append(text)
        return b"GOOGLE"
    monkeypatch.setattr(tts, "google_synthesize", g)

    async def gs(text, lang="th"):
        got.append(text)
        yield b"GOOGLE"
    monkeypatch.setattr(tts, "google_stream", gs)
    assert asyncio.run(_collect("ทดสอบค่ะ")) == b"GOOGLE"
    assert asyncio.run(tts.synthesize("อีกครั้งค่ะ")) == b"GOOGLE" and len(got) == 2
    assert tts._google_pieces("ก" * 400) == ["ก" * 180, "ก" * 180, "ก" * 40]
    assert all(len(p) <= 180 for p in tts._google_pieces(" ".join(["คำ"] * 200)))


def test_tts_cooldown_grows(monkeypatch):
    monkeypatch.setattr(tts, "_state", {"fail_until": 0.0, "last_error": "", "fails": 2})
    assert tts._cooldown() == tts.FAIL_COOLDOWN_S
    tts._state["fails"] = 5
    assert tts._cooldown() == tts.FAIL_COOLDOWN_S * 8
    tts._state["fails"] = 50
    assert tts._cooldown() == 600.0


def test_google_primary_streams_pieces_and_caches(client, monkeypatch, tmp_path):
    """12 พ.ย. 2569: Microsoft ปฏิเสธทุกคำขอ → ใช้ Google เป็นเสียงหลัก (VORA_TTS_PROVIDER=google) ส่งเสียงทีละท่อน"""
    import httpx
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(tts.settings, "tts_provider", "google")
    monkeypatch.setattr(tts, "_g_state", {"fail_until": 0.0, "last_error": ""})
    calls = []
    real = httpx.AsyncClient

    def handler(req):
        calls.append(req.url.params["q"])
        return httpx.Response(200, content=b"MP" + str(len(calls)).encode(), headers={"content-type": "audio/mpeg"})
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    text = " ".join(["ทดสอบเสียงภาษาไทย"] * 30)                     # ~500 ตัวอักษร → 3 ท่อน
    chunks = asyncio.run(_chunks(text))
    assert len(chunks) == len(calls) >= 3 and tts._gpath(text, "th").exists()
    assert asyncio.run(tts.synthesize(text)) == b"".join(chunks) and len(calls) == len(chunks)   # ครั้งที่สองจากแคช
    assert tts.available() and client.get("/api/kiosk/config").json()["server_tts"] is True


async def _chunks(text):
    return [c async for c in tts.stream(text, "th")]


def test_google_partial_failure_not_cached(monkeypatch, tmp_path):
    import httpx
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(tts.settings, "tts_provider", "google")
    monkeypatch.setattr(tts, "_g_state", {"fail_until": 0.0, "last_error": ""})
    monkeypatch.setattr(tts, "record_event", lambda *a, **k: None)
    n = {"i": 0}
    real = httpx.AsyncClient

    def handler(req):
        n["i"] += 1
        return httpx.Response(200 if n["i"] == 1 else 500, content=b"A", headers={"content-type": "audio/mpeg"})
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    text = " ".join(["ทดสอบเสียงภาษาไทย"] * 30)
    assert asyncio.run(tts.synthesize(text)) is None and not tts._gpath(text, "th").exists()
    assert tts._g_state["fail_until"] == 0.0                                  # ได้บางส่วน → ไม่พักทั้งระบบ


def test_related_websites_search_and_summary(client, monkeypatch):
    """12 พ.ย. 2569 (รอบ 3): "เว็บไซต์เกี่ยวกับ X" → ค้นเว็บที่เกี่ยวข้อง + สรุป · ตัดลิงก์ซ้ำ/เครือข่ายภายใน/ต้องห้าม"""
    from app.ai import web
    monkeypatch.setattr(web.settings, "ai_web_enabled", True)

    async def search(q, lang="th", **kw):
        return {"query": q, "title": q, "summary": "ดาวอังคารเป็นดาวเคราะห์ลำดับที่สี่ค่ะ", "points": ["มีสีแดง"], "engine": "gemini-search",
                "sources": [{"title": "NASA Mars", "url": "https://mars.nasa.gov/"}, {"title": "nasa dup", "url": "https://www.mars.nasa.gov/x"},
                            {"title": "intranet", "url": "http://192.168.1.10/"}, {"title": "bad", "url": "https://ufabet.com/"},
                            {"title": "วิกิพีเดีย", "url": "https://th.wikipedia.org/wiki/ดาวอังคาร"}], "images": []}
    monkeypatch.setattr(web, "search", search)

    async def check(url):
        if "192.168" in url:
            return {"url": url, "ok": False, "embeddable": False, "reason": "private host"}
        return {"url": url, "ok": True, "embeddable": "nasa" not in url, "reason": ""}
    monkeypatch.setattr(sites, "check", check)
    r = chat(client, "มีเว็บไซต์อะไรเกี่ยวกับดาวอังคารบ้าง")
    site = r["media"]["site"]
    assert site["kind"] == "related" and site["topic"] == "ดาวอังคาร"
    assert site["url"].startswith("https://th.wikipedia.org")                   # เว็บหลักบนจอ = เว็บแรกที่แสดงในกรอบได้
    assert [x["url"] for x in site["related"]] == ["https://mars.nasa.gov/"]     # ตัดซ้ำ ภายใน ต้องห้าม
    assert r["text"].startswith("ดาวอังคารเป็นดาวเคราะห์") and "อีก 1 แห่ง" in r["text"]
    assert r["contract"]["answer_source"] == "web" if "contract" in r else True


def test_misheard_school_and_fake_ai_domain(monkeypatch):
    """12 พ.ย. 2569: ฟังเสียงได้ "วิลัย" → AI เดาโดเมน wilai.ac.th ที่ไม่มีจริงแล้วขึ้นบนจอ (ข้อผิดพลาดที่ผู้ใช้พบ)"""
    seen = []

    async def check(url):
        seen.append(url)
        return {"url": url, "ok": "technicnan" in url, "embeddable": False, "reason": "" if "technicnan" in url else "unresolved"}

    async def official(name):
        return "https://www.wilai.ac.th"

    async def no_wiki(topic, lang):
        return None
    monkeypatch.setattr(sites, "check", check)
    monkeypatch.setattr(sites, "_official", official)
    monkeypatch.setattr(sites, "_wikipedia", no_wiki)
    run = lambda q: asyncio.run(sites.resolve(q, False, "th", "https://www.technicnan.ac.th", "วิทยาลัยเทคนิคน่าน"))
    assert run("วิลัย")["url"] == "https://www.technicnan.ac.th"              # ได้ยินเพี้ยน → ยังเป็นเว็บวิทยาลัย
    assert run("หน่วยงานที่ไม่มีอยู่จริง") is None                             # AI เดาแล้วเปิดไม่ได้ → แจ้งว่าหาไม่พบ ไม่แสดงเว็บปลอม
    assert sites.is_direct("วิลัย", "วิทยาลัยเทคนิคน่าน") and not sites.is_direct("มหาวิทยาลัยเชียงใหม่", "วิทยาลัยเทคนิคน่าน")


def test_news_gallery_admin_and_public(client, admin_headers):
    """12 พ.ย. 2569: ข่าว/ประกาศใส่ได้หลายภาพ (ภาพหลัก + gallery) · ไม่ส่ง gallery = ไม่แก้ของเดิม"""
    body = {"kind": "admission", "title_th": "ทดสอบหลายภาพ", "status": "published", "image_url": "/uploads/a.png",
            "gallery": "/uploads/b.png\n/uploads/b.png\njavascript:alert(1)\nhttps://x.ac.th/c.jpg"}
    nid = client.post("/api/admin/news", json=body, headers=admin_headers).json()["id"]
    d = client.get(f"/api/news/{nid}").json()
    assert d["image"] == "/uploads/a.png" and d["gallery"] == ["/uploads/b.png", "https://x.ac.th/c.jpg"]   # ตัดซ้ำ/ลิงก์อันตราย
    upd = {k: v for k, v in body.items() if k != "gallery"} | {"title_th": "ทดสอบหลายภาพ 2"}
    client.put(f"/api/admin/news/{nid}", json=upd, headers=admin_headers)
    assert client.get(f"/api/news/{nid}").json()["gallery"] == ["/uploads/b.png", "https://x.ac.th/c.jpg"]  # ไม่ส่งมา = คงเดิม
    client.put(f"/api/admin/news/{nid}", json=upd | {"gallery": ""}, headers=admin_headers)
    assert client.get(f"/api/news/{nid}").json()["gallery"] == []
    client.delete(f"/api/admin/news/{nid}", headers=admin_headers)
