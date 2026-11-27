"""VORA voice core — Phase 3 (12 พ.ย. 2569)
voice profile · voice consistency · cache key · provider isolation · fallback policy
ออฟไลน์ทั้งหมด: edge-tts และ Google เป็นตัวจำลอง ไม่มีการเรียกบริการจริง"""
import asyncio
import sys
import types

import pytest

from app import tts, voice_profiles
from app.config import settings


# ---------------------------------------------------------------- ตัวจำลองผู้ให้บริการ
class FakeEdge:
    """edge-tts จำลอง · mode: ok | fail | cut"""
    calls: list = []
    mode = "ok"

    def __init__(self, text, voice, rate=None, pitch=None):
        FakeEdge.calls.append({"text": text, "voice": voice})

    async def stream(self):
        if FakeEdge.mode == "fail":
            raise RuntimeError("No audio was received")
        yield {"type": "audio", "data": b"EDGE1"}
        if FakeEdge.mode == "cut":
            raise RuntimeError("connection reset")
        yield {"type": "audio", "data": b"EDGE2"}


@pytest.fixture
def fake(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "edge_tts", types.SimpleNamespace(Communicate=FakeEdge))
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(tts, "_state", {"fail_until": 0.0, "last_error": "", "fails": 0})
    monkeypatch.setattr(tts, "_g_state", {"fail_until": 0.0, "last_error": ""})
    monkeypatch.setattr(tts, "record_event", lambda *a, **k: None)
    monkeypatch.setattr(settings, "tts_voice_th", "th-TH-PremwadeeNeural")
    monkeypatch.setattr(settings, "tts_voice_en", "same")
    monkeypatch.setattr(settings, "tts_rate", "-5%")
    monkeypatch.setattr(settings, "tts_pitch", "+0Hz")
    google_calls = []

    async def google_stream(text, lang="th"):
        google_calls.append(text)
        if fake.google_mode == "fail":
            return
        yield b"GOOG1"
        yield b"GOOG2"
        tts._gpath(text, lang).write_bytes(b"GOOG1GOOG2")

    async def google_synthesize(text, lang="th"):
        out = b"".join([c async for c in google_stream(text, lang)])
        return out or None
    monkeypatch.setattr(tts, "google_stream", google_stream)
    monkeypatch.setattr(tts, "google_synthesize", google_synthesize)
    FakeEdge.calls = []
    FakeEdge.mode = "ok"
    fake.google_calls = google_calls
    fake.google_mode = "ok"
    return fake


def configure(monkeypatch, provider, fallback="none"):
    monkeypatch.setattr(settings, "tts_provider", provider)
    monkeypatch.setattr(settings, "tts_fallback", fallback)


def collect(text, lang="th", **kw):
    async def go():
        return b"".join([c async for c in tts.stream(text, lang, **kw)])
    return asyncio.run(go())


# ---------------------------------------------------------------- voice profile
def test_vora_profile_fields_eq_only():
    p = voice_profiles.profile_for("vora")
    assert (p.character_id, p.voice_id, p.language, p.speaking_style) == ("vora", "vora_female_th", "th", "polite_pr")
    assert p.speed == 1.0 and p.pitch == 0 and p.volume == 0.9 and p.preset == "eq_only"


def test_character_to_voice_is_deterministic_and_unknown_maps_to_vora():
    ids = {voice_profiles.profile_for(c).voice_id for c in ["vora", "VORA", " vora ", None, "", "someone-else"] * 50}
    assert ids == {"vora_female_th"}
    assert voice_profiles.profile_for("x", "en").language == "en"


def test_provider_voice_mapping(monkeypatch):
    monkeypatch.setattr(settings, "tts_voice_th", "th-TH-PremwadeeNeural")
    monkeypatch.setattr(settings, "tts_voice_en", "same")
    assert voice_profiles.provider_voice("edge", "th") == "th-TH-PremwadeeNeural"
    assert voice_profiles.provider_voice("edge", "en") == "th-TH-PremwadeeNeural"     # เสียงเดียวทุกภาษา (ค่าเดิม)
    assert voice_profiles.provider_voice("google", "th") == "google-translate-th"
    assert voice_profiles.provider_voice("google", "en", "Hello") == "google-translate-en"
    assert voice_profiles.provider_voice("google", "en", "แผนก IT") == "google-translate-th"
    assert tts.voice_for("th") == voice_profiles.edge_voice("th")                     # voice_for เดิมยังให้ค่าเดิม
    with pytest.raises(ValueError):
        voice_profiles.provider_voice("random", "th")


# ---------------------------------------------------------------- fallback policy (ลำดับคงที่)
@pytest.mark.parametrize("provider,fallback,order", [
    ("google", "none", ["google"]), ("google", "google", ["google"]),
    ("edge", "none", ["edge"]), ("edge", "google", ["edge", "google"]),
    ("browser", "google", []), ("", "none", []),
])
def test_provider_order_is_explicit(monkeypatch, provider, fallback, order):
    configure(monkeypatch, provider, fallback)
    assert voice_profiles.provider_order() == order


# ---------------------------------------------------------------- cache key
def test_cache_key_separates_provider_voice_language_text(fake, monkeypatch):
    configure(monkeypatch, "edge")
    e_th, g_th = tts._epath("สวัสดีค่ะ", "th"), tts._gpath("สวัสดีค่ะ", "th")
    assert e_th != g_th and e_th.name.startswith("edge-") and g_th.name.startswith("google-")
    assert tts._gpath("Hello", "en") != tts._gpath("Hello", "th")                   # ภาษา
    assert tts._epath("สวัสดีค่ะ", "th") != tts._epath("สวัสดีครับ", "th")          # ข้อความ
    assert tts._epath("สวัสดี   ค่ะ ", "th") == tts._epath("สวัสดี ค่ะ", "th")       # ข้อความปกติ (ช่องว่าง)
    monkeypatch.setattr(settings, "tts_voice_th", "th-TH-AcharaNeural")
    assert tts._epath("สวัสดีค่ะ", "th") != e_th                                    # เสียง/profile ของผู้ให้บริการ
    monkeypatch.setattr(settings, "tts_voice_th", "th-TH-PremwadeeNeural")
    monkeypatch.setattr(settings, "tts_rate", "+10%")
    assert tts._epath("สวัสดีค่ะ", "th") != e_th                                    # จังหวะเสียง


def test_cache_path_follows_primary_provider(fake, monkeypatch):
    configure(monkeypatch, "google")
    assert tts.cache_path("ทดสอบ", "th") == tts._gpath("ทดสอบ", "th")
    configure(monkeypatch, "edge", "google")
    assert tts.cache_path("ทดสอบ", "th") == tts._epath("ทดสอบ", "th")


def test_old_format_cache_files_are_not_used(fake, monkeypatch):
    """ไฟล์แคชรูปแบบเดิม (ไม่มีชื่อผู้ให้บริการ) ต้องไม่ถูกหยิบมาเล่น"""
    import hashlib
    configure(monkeypatch, "google")
    text = "ข้อความที่เคยแคชไว้"
    old_edge = hashlib.sha1(f"th-TH-PremwadeeNeural|-5%|+0Hz|{text}".encode()).hexdigest()
    (tts.CACHE_DIR / f"{old_edge}.mp3").write_bytes(b"OLD-MICROSOFT")
    old_google = hashlib.sha1(f"google|th|{text}".encode()).hexdigest()
    (tts.CACHE_DIR / f"g-{old_google}.mp3").write_bytes(b"OLD-GOOGLE")
    assert collect(text) == b"GOOG1GOOG2"


# ---------------------------------------------------------------- provider isolation (root cause: เสียง Microsoft โผล่ทั้งที่ตั้งเป็น Google)
def test_google_config_never_returns_edge_cache(fake, monkeypatch):
    configure(monkeypatch, "google", "google")
    text = "สวัสดีค่ะ ยินดีต้อนรับ"
    tts._epath(text, "th").write_bytes(b"MICROSOFT-CACHED")
    info = {}
    assert collect(text, info=info) == b"GOOG1GOOG2" and info["provider"] == "google"
    assert FakeEdge.calls == []
    assert asyncio.run(tts.synthesize(text)) == b"GOOG1GOOG2"
    assert tts.cache_path(text, "th").exists()                                      # warm/session ดูแคชของ Google


def test_google_config_warm_ignores_edge_cache(fake, monkeypatch):
    configure(monkeypatch, "google")
    text = "สไลด์ถัดไปค่ะ"
    tts._epath(text, "th").write_bytes(b"MICROSOFT-CACHED")
    assert asyncio.run(tts.warm(text)) is True and fake.google_calls == [text]       # เดิม: เห็นแคช edge แล้วไม่เตรียมเสียง Google


def test_edge_config_never_returns_google_cache(fake, monkeypatch):
    configure(monkeypatch, "edge", "none")
    text = "ทดสอบแยกผู้ให้บริการ"
    tts._gpath(text, "th").write_bytes(b"GOOGLE-CACHED")
    info = {}
    assert collect(text, info=info) == b"EDGE1EDGE2" and info["provider"] == "edge"
    assert asyncio.run(tts.synthesize("อีกประโยค")) == b"EDGE1EDGE2"
    assert fake.google_calls == []


def test_edge_config_without_fallback_fails_silent_not_google(fake, monkeypatch):
    configure(monkeypatch, "edge", "none")
    FakeEdge.mode = "fail"
    text = "ล้มทั้งหมด"
    tts._gpath(text, "th").write_bytes(b"GOOGLE-CACHED")
    assert collect(text) == b"" and asyncio.run(tts.synthesize(text)) is None
    assert fake.google_calls == []


# ---------------------------------------------------------------- voice consistency
def test_many_messages_same_voice(fake, monkeypatch):
    configure(monkeypatch, "edge", "none")
    for i in range(20):
        assert collect(f"ข้อความที่ {i} ค่ะ")
        assert asyncio.run(tts.synthesize(f"ประโยคที่ {i} ค่ะ"))
    assert {c["voice"] for c in FakeEdge.calls} == {"th-TH-PremwadeeNeural"}


def test_no_voice_switch_mid_response(fake, monkeypatch):
    """edge ส่งเสียงไปแล้วบางส่วนแล้วขาด → ไม่ต่อด้วย Google ในคำตอบเดียวกัน (ไม่สลับเสียงกลางคำตอบ)"""
    configure(monkeypatch, "edge", "google")
    FakeEdge.mode = "cut"
    info = {}
    assert collect("คำตอบยาว ๆ ค่ะ", info=info) == b"EDGE1" and info["provider"] == "edge"
    assert fake.google_calls == []


def test_fallback_only_before_first_audio(fake, monkeypatch):
    """edge ล้มก่อนได้เสียงชิ้นแรก + ตั้ง VORA_TTS_FALLBACK=google → ใช้ Google ทั้งคำตอบ (ตามลำดับที่กำหนด)"""
    configure(monkeypatch, "edge", "google")
    FakeEdge.mode = "fail"
    info = {}
    assert collect("ทดสอบสำรอง", info=info) == b"GOOG1GOOG2" and info["provider"] == "google"


def test_provider_lock_keeps_rest_of_response_on_same_voice(fake, monkeypatch):
    """ส่วนที่เหลือของคำตอบขอด้วย provider ที่ล็อกไว้ → ได้เสียงเดิมหรือไม่ได้เลย (หน้าจอจัดการต่อ) ไม่ข้ามไปเสียงอื่น"""
    configure(monkeypatch, "edge", "google")
    FakeEdge.mode = "fail"
    info = {}
    assert asyncio.run(tts.synthesize("ประโยคต่อไป", provider="edge", info=info)) is None and info == {}
    assert collect("ประโยคต่อไป", provider="edge") == b""
    assert fake.google_calls == []
    assert asyncio.run(tts.synthesize("ประโยคต่อไป", provider="google", info=info)) == b"GOOG1GOOG2"
    assert info["provider"] == "google"


def test_google_down_does_not_fall_to_edge(fake, monkeypatch):
    configure(monkeypatch, "google", "google")
    fake.google_mode = "fail"
    assert collect("กูเกิลล่ม") == b"" and asyncio.run(tts.synthesize("กูเกิลล่ม")) is None
    assert FakeEdge.calls == []


def test_tts_error_never_raises(fake, monkeypatch):
    configure(monkeypatch, "edge", "google")
    FakeEdge.mode = "fail"
    fake.google_mode = "fail"
    assert collect("ล้มหมด") == b"" and asyncio.run(tts.synthesize("ล้มหมด")) is None


def test_concurrent_requests_same_text_share_one_generation(fake, monkeypatch):
    configure(monkeypatch, "edge", "none")

    async def many():
        return await asyncio.gather(*[tts.synthesize("พร้อมกันค่ะ") for _ in range(5)])
    out = asyncio.run(many())
    assert all(o == b"EDGE1EDGE2" for o in out) and len(FakeEdge.calls) == 1
