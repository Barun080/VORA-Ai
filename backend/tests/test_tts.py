"""เสียงพูดฝั่งเซิร์ฟเวอร์ (8 พ.ย. 2569) — ทดสอบแบบออฟไลน์ด้วยตัวจำลอง edge-tts (ไม่เรียกบริการจริงเลย)"""
import asyncio
import sys
import types

import pytest

from app import tts
from app.config import settings


class _FakeCommunicate:
    calls: list = []
    mode = "ok"          # ok | slow | fail | empty

    def __init__(self, text, voice, rate="+0%", pitch="+0Hz"):
        _FakeCommunicate.calls.append({"text": text, "voice": voice, "rate": rate, "pitch": pitch})

    async def stream(self):
        if _FakeCommunicate.mode == "slow":
            await asyncio.sleep(5)
        if _FakeCommunicate.mode == "fail":
            raise RuntimeError("network down")
        if _FakeCommunicate.mode != "empty":
            yield {"type": "audio", "data": b"ID3fake-mp3-" + str(len(_FakeCommunicate.calls)).encode()}
        yield {"type": "WordBoundary"}


@pytest.fixture
def edge(monkeypatch, tmp_path):
    mod = types.ModuleType("edge_tts")
    mod.Communicate = _FakeCommunicate
    monkeypatch.setitem(sys.modules, "edge_tts", mod)
    monkeypatch.setattr(settings, "tts_provider", "edge")
    monkeypatch.setattr(settings, "tts_voice_th", "th-TH-PremwadeeNeural")
    monkeypatch.setattr(settings, "tts_voice_en", "same")
    monkeypatch.setattr(settings, "tts_rate", "-5%")
    monkeypatch.setattr(settings, "tts_pitch", "+0Hz")
    monkeypatch.setattr(settings, "tts_timeout_s", 0.3)
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path / "tts_cache")
    tts._state.update(fail_until=0.0, last_error="")
    _FakeCommunicate.calls = []
    _FakeCommunicate.mode = "ok"
    return _FakeCommunicate


def run(coro):
    return asyncio.run(coro)


def test_thai_english_mixed_use_one_voice_identity(edge):
    for text, lang in [("สวัสดีค่ะ ยินดีต้อนรับสู่ VORA", "th"), ("Hello, welcome to VORA.", "en"),
                       ("แผนก Computer Technology เปิดสอนอะไรบ้างคะ?", "th")]:
        assert run(tts.synthesize(text, lang))
    assert {c["voice"] for c in edge.calls} == {"th-TH-PremwadeeNeural"}
    assert all(c["rate"] == "-5%" and c["pitch"] == "+0Hz" for c in edge.calls)


def test_separate_english_voice_when_configured(edge, monkeypatch):
    monkeypatch.setattr(settings, "tts_voice_en", "en-US-AvaNeural")
    run(tts.synthesize("Hello", "en"))
    run(tts.synthesize("สวัสดีค่ะ", "th"))
    assert [c["voice"] for c in edge.calls] == ["en-US-AvaNeural", "th-TH-PremwadeeNeural"]


def test_bad_prosody_values_fall_back_to_safe_defaults(edge, monkeypatch):
    monkeypatch.setattr(settings, "tts_rate", "fast")
    monkeypatch.setattr(settings, "tts_pitch", "+999")
    assert tts.prosody() == ("-5%", "+0Hz")


def test_cache_hit_does_not_call_provider_again(edge):
    a = run(tts.synthesize("สวัสดีค่ะ", "th"))
    b = run(tts.synthesize("สวัสดีค่ะ", "th"))
    assert a == b and len(edge.calls) == 1


def test_empty_text_returns_none_without_calling(edge):
    assert run(tts.synthesize("   ", "th")) is None
    assert edge.calls == []


def test_timeout_returns_none_quickly_then_circuit_skips_provider(edge):
    edge.mode = "slow"
    assert run(tts.synthesize("ประโยคหนึ่ง", "th")) is None
    assert "timeout" in tts.status()["last_error"] and tts.status()["cooling_down"]
    edge.mode = "ok"
    n = len(edge.calls)
    assert run(tts.synthesize("ประโยคสอง", "th")) is None          # ช่วงพัก: ไม่เรียกผู้ให้บริการ
    assert len(edge.calls) == n


def test_provider_error_and_empty_audio_do_not_raise(edge):
    edge.mode = "fail"
    assert run(tts.synthesize("ทดสอบ", "th")) is None
    tts._state.update(fail_until=0.0)
    edge.mode = "empty"
    assert run(tts.synthesize("ทดสอบอีกครั้ง", "th")) is None


def test_retry_after_cooldown(edge):
    edge.mode = "fail"
    assert run(tts.synthesize("ลองใหม่", "th")) is None
    tts._state.update(fail_until=0.0)        # จำลองว่าพ้นช่วงพัก 60 วินาทีแล้ว
    edge.mode = "ok"
    assert run(tts.synthesize("ลองใหม่", "th"))


def test_browser_provider_means_no_server_tts(monkeypatch):
    monkeypatch.setattr(settings, "tts_provider", "browser")
    assert tts.available() is False
    assert run(tts.synthesize("สวัสดีค่ะ", "th")) is None


def test_api_tts_returns_204_when_unavailable_and_config_reports_status(client, monkeypatch):
    monkeypatch.setattr(settings, "tts_provider", "browser")
    r = client.get("/api/tts", params={"text": "สวัสดีค่ะ", "lang": "th"})
    assert r.status_code == 204
    cfg = client.get("/api/kiosk/config").json()
    assert cfg["server_tts"] is False and cfg["tts"]["provider"] == "browser" and "api_key" not in str(cfg["tts"]).lower()


def test_api_tts_returns_audio_from_provider(client, edge):
    r = client.get("/api/tts", params={"text": "Hello, welcome to VORA.", "lang": "en"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content.startswith(b"ID3")
