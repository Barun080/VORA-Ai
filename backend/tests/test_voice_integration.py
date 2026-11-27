"""VORA voice integration — Phase 4 (12 พ.ย. 2569)
API: /api/tts และ /api/tts/session รับ provider (ไม่บังคับ) · header X-VORA-TTS-Provider · หน้าจอรุ่นเก่ายังใช้ได้
ออฟไลน์ทั้งหมด: edge-tts และ Google เป็นตัวจำลอง"""
import sys
import types

import pytest

from app import tts
from app.config import settings


class FakeEdge:
    calls: list = []
    mode = "ok"      # ok | fail

    def __init__(self, text, voice, rate=None, pitch=None):
        FakeEdge.calls.append(text)

    async def stream(self):
        if FakeEdge.mode == "fail":
            raise RuntimeError("No audio was received")
        yield {"type": "audio", "data": b"EDGE"}


@pytest.fixture
def prov(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "edge_tts", types.SimpleNamespace(Communicate=FakeEdge))
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(tts, "_state", {"fail_until": 0.0, "last_error": "", "fails": 0})
    monkeypatch.setattr(tts, "_g_state", {"fail_until": 0.0, "last_error": ""})
    monkeypatch.setattr(tts, "record_event", lambda *a, **k: None)
    g = {"calls": [], "mode": "ok"}

    async def google_stream(text, lang="th"):
        g["calls"].append(text)
        if g["mode"] == "ok":
            yield b"GOOG"

    async def google_synthesize(text, lang="th"):
        out = b"".join([c async for c in google_stream(text, lang)])
        return out or None
    monkeypatch.setattr(tts, "google_stream", google_stream)
    monkeypatch.setattr(tts, "google_synthesize", google_synthesize)
    FakeEdge.calls = []
    FakeEdge.mode = "ok"

    def set_(provider, fallback="none"):
        monkeypatch.setattr(settings, "tts_provider", provider)
        monkeypatch.setattr(settings, "tts_fallback", fallback)
    g["set"] = set_
    return g


# ---------------------------------------------------------------- /api/tts
def test_tts_locked_provider_and_header(client, prov):
    prov["set"]("edge", "google")
    r = client.get("/api/tts", params={"text": "ประโยคต่อไปค่ะ", "lang": "th", "provider": "google"})
    assert r.status_code == 200 and r.content == b"GOOG" and r.headers["X-VORA-TTS-Provider"] == "google"
    assert FakeEdge.calls == []                                          # ล็อก google = ไม่แตะ Microsoft


def test_tts_locked_provider_failure_does_not_switch(client, prov):
    prov["set"]("edge", "google")
    FakeEdge.mode = "fail"
    r = client.get("/api/tts", params={"text": "ล็อก edge ค่ะ", "provider": "edge"})
    assert r.status_code == 204 and prov["calls"] == []                # ไม่ได้เสียง = 204 (หน้าจอจัดการต่อ) ไม่ข้ามไป Google


def test_tts_legacy_client_without_provider(client, prov):
    prov["set"]("edge", "google")
    FakeEdge.mode = "fail"
    r = client.get("/api/tts", params={"text": "หน้าจอรุ่นเก่าค่ะ", "lang": "th"})
    assert r.status_code == 200 and r.content == b"GOOG"                # พฤติกรรมเดิม: สำรองก่อนเสียงชิ้นแรก
    assert r.headers["X-VORA-TTS-Provider"] == "google"                 # บอกผู้ให้บริการที่ใช้จริง
    assert r.headers["Cache-Control"] == "max-age=86400"
    r = client.get("/api/tts", params={"text": "ค่าว่างค่ะ", "provider": ""})
    assert r.status_code == 200


@pytest.mark.parametrize("bad", ["random", "browser", "EDGE-X", "microsoft"])
def test_tts_unknown_provider_400(client, prov, bad):
    prov["set"]("google")
    assert client.get("/api/tts", params={"text": "ทดสอบ", "provider": bad}).status_code == 400


def test_tts_provider_not_enabled_400(client, prov):
    prov["set"]("google", "google")                                       # order = [google]
    assert client.get("/api/tts", params={"text": "ทดสอบ", "provider": "edge"}).status_code == 400
    assert FakeEdge.calls == []


# ---------------------------------------------------------------- /api/tts/session + stream
def test_session_lock_recorded_and_stream_uses_only_it(client, prov):
    prov["set"]("edge", "google")
    FakeEdge.mode = "fail"
    s = client.post("/api/tts/session", json={"text": "คำตอบหนึ่งค่ะ", "lang": "th", "provider": "edge"}).json()
    assert s["provider"] == "edge"
    assert client.get(f"/api/tts/stream/{s['id']}").status_code == 204 and prov["calls"] == []
    s = client.post("/api/tts/session", json={"text": "คำตอบหนึ่งค่ะ", "lang": "th", "provider": "google"}).json()
    r = client.get(f"/api/tts/stream/{s['id']}")
    assert r.status_code == 200 and r.content == b"GOOG" and r.headers["X-VORA-TTS-Provider"] == "google"
    assert r.headers["Cache-Control"] == "no-store"


def test_session_legacy_without_provider(client, prov):
    prov["set"]("edge", "none")
    s = client.post("/api/tts/session", json={"text": "แบบเดิมค่ะ", "lang": "th"}).json()
    assert s["provider"] is None and set(s) == {"id", "cached", "provider"}
    r = client.get(f"/api/tts/stream/{s['id']}")
    assert r.status_code == 200 and r.content == b"EDGE" and r.headers["X-VORA-TTS-Provider"] == "edge"


def test_session_cached_flag_follows_lock(client, prov):
    prov["set"]("edge", "google")
    tts._gpath("มีแคชค่ะ", "th").write_bytes(b"G")
    assert client.post("/api/tts/session", json={"text": "มีแคชค่ะ", "provider": "google"}).json()["cached"] is True
    assert client.post("/api/tts/session", json={"text": "มีแคชค่ะ", "provider": "edge"}).json()["cached"] is False


def test_session_bad_provider_400(client, prov):
    prov["set"]("google")
    assert client.post("/api/tts/session", json={"text": "x", "provider": "edge"}).status_code == 400


# ---------------------------------------------------------------- config (เพิ่มเท่านั้น)
def test_kiosk_config_exposes_order_and_profile_additively(client, prov):
    prov["set"]("edge", "google")
    t = client.get("/api/kiosk/config").json()["tts"]
    assert t["order"] == ["edge", "google"] and t["profile"] == "vora_female_th"
    for k in ("provider", "available", "fallback", "voice_th", "voice_en", "rate", "pitch", "cooling_down", "last_error"):
        assert k in t                                                    # ฟิลด์เดิมยังอยู่ครบ
    prov["set"]("google")
    assert client.get("/api/kiosk/config").json()["tts"]["order"] == ["google"]


def test_resolve_provider():
    assert tts.resolve_provider(None) is None and tts.resolve_provider("") is None and tts.resolve_provider("  ") is None
    settings_order = tts.voice_profiles.provider_order()
    for p in settings_order:
        assert tts.resolve_provider(p.upper()) == p
    with pytest.raises(ValueError):
        tts.resolve_provider("nope")
