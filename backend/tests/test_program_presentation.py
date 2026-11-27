"""11 พ.ย. 2569 — ข้อมูลพรีเซนเทชันสาขา (migration 0002) และสาขาที่ไม่ระบุระดับ"""
import importlib.util
from pathlib import Path

from app.ai import engine
from app.db import SessionLocal
from app.models import Program

ROOT = Path(__file__).resolve().parents[2]


def _add(**kw):
    with SessionLocal() as db:
        p = Program(**{"code": "T-PRES", "level": "", "department": "กลุ่มทดสอบ", "name_th": "ทดสอบพรีเซนต์", "name_en": "Presentation Test",
                       "description_th": "ฝึกงานทดสอบ", "careers_th": "ช่างทดสอบ", "suits_th": "เหมาะกับคนที่ชอบทดสอบ",
                       "gallery": "/uploads/a.jpg\n\n/uploads/b.jpg", "status": "published", **kw})
        db.add(p)
        db.commit()
        return p.id


def test_public_program_has_presentation_fields(client):
    pid = _add()
    r = client.get(f"/api/programs/{pid}").json()
    assert r["suits_th"] == "เหมาะกับคนที่ชอบทดสอบ" and r["suits_en"] == ""
    assert r["gallery"] == ["/uploads/a.jpg", "/uploads/b.jpg"]
    with SessionLocal() as db:
        db.delete(db.get(Program, pid))
        db.commit()


def test_empty_level_is_not_spoken():
    assert engine._lv("", "th") == "" and engine._lv("ปวส.", "th") == " ระดับ ปวส." and engine._lv("", "en") == ""


def test_import_script_parses_17_departments_without_unreadable_text():
    spec = importlib.util.spec_from_file_location("imp", ROOT / "scripts" / "import_vtcn_programs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    rows = mod.build()
    assert len(rows) == 17 and len({r["code"] for r in rows}) == 17
    for r in rows:
        assert r["level"] == "" and r["status"] == "published" and r["name_en"] and r["suits_th"].startswith("เหมาะกับ")
        assert "[" not in r["suits_th"] + r["description_th"] + r["careers_th"]


# ---------------------------------------------------------------- 11 พ.ย. 2569: เรียลไทม์ / ค้นเว็บ / แปลภาษา
import asyncio
import pytest  # noqa: E402

from app.ai import realtime, web  # noqa: E402


def test_realtime_detect_and_college_times_stay_in_kb():
    assert realtime.detect("ตอนนี้กี่โมงแล้ว") == "time" and realtime.detect("วันนี้วันที่เท่าไหร่") == "date"
    assert realtime.detect("วันนี้อากาศเป็นยังไง") == "weather" and realtime.detect("what's the weather like") == "weather"
    for q in ("ห้องสมุดเปิดถึงกี่โมงคะ", "รับสมัครกี่โมง", "วันที่เปิดรับสมัคร", "เวลาเปิดรับสมัคร"):
        assert realtime.detect(q) is None, q


def test_weather_answer_uses_live_numbers(client, monkeypatch):
    async def fake():
        return {"temp": 27.6, "feels": 29.1, "humidity": 70, "code": 2, "wind": 3, "time": "", "max": 31.2, "min": 20.4, "rain": 20}
    monkeypatch.setattr(realtime, "fetch_weather", fake)
    r = client.post("/api/chat", json={"text": "วันนี้อากาศเป็นยังไง", "lang": "th", "channel": "kiosk"}).json()
    assert r["provider"] == "realtime" and "28 องศา" in r["text"] and "โอกาสฝนตก 20" in r["text"]


def test_weather_failure_is_honest(client, monkeypatch):
    async def fail():
        return None
    monkeypatch.setattr(realtime, "fetch_weather", fail)
    r = client.post("/api/chat", json={"text": "อุณหภูมิตอนนี้เท่าไหร่", "lang": "th", "channel": "kiosk"}).json()
    assert r["provider"] == "realtime" and "ไม่ได้" in r["text"] and not any(c.isdigit() for c in r["text"])


def test_web_detect_requests_only():
    assert web.detect("หาข้อมูลรุ้งกินน้ำให้หน่อย") == "รุ้งกินน้ำ"
    assert web.detect("ช่วยค้นหาข้อมูลเกี่ยวกับดาวอังคารหน่อยค่ะ") == "ดาวอังคาร"
    assert web.detect("search for photosynthesis") == "photosynthesis"
    assert web.detect("ท้องฟ้าทำไมเป็นสีฟ้า") is None and web.detect("หา") is None


def test_web_search_path_includes_college_when_explicit(client, monkeypatch):
    monkeypatch.setattr(web.settings, "ai_web_enabled", True)
    calls = []

    async def fake(q, lang="th", **kw):
        calls.append(q)
        return {"query": q, "title": "รุ้งกินน้ำ", "summary": "รุ้งเกิดจากแสงหักเหในหยดน้ำค่ะ", "points": ["แสงหักเห"], "sources": [{"title": "wiki", "url": "https://th.wikipedia.org/wiki/x"}],
                "images": [], "engine": "wikipedia", "lang": lang, "at": 0, "ttl_s": 300}
    monkeypatch.setattr(web, "search", fake)
    r = client.post("/api/chat", json={"text": "หาข้อมูลรุ้งกินน้ำให้หน่อย", "lang": "th", "channel": "kiosk"}).json()
    assert r["provider"] == "web:wikipedia" and r["media"]["web"]["title"] == "รุ้งกินน้ำ" and r["sources"][0]["type"] == "web"
    # 11 พ.ย. 2569 (รอบ 3): ขึ้นต้นว่า "หาข้อมูล" = ค้นเว็บเสมอ รวมเรื่องวิทยาลัย และมาก่อนข้อมูลเรียลไทม์
    r = client.post("/api/chat", json={"text": "หาข้อมูลค่าเทอมของวิทยาลัยให้หน่อย", "lang": "th", "channel": "kiosk"}).json()
    assert r["provider"] == "web:wikipedia" and calls[-1] == "ค่าเทอมของวิทยาลัย"
    r = client.post("/api/chat", json={"text": "หาข้อมูลของวิทยาลัย", "lang": "th", "channel": "kiosk"}).json()
    school = client.get("/api/kiosk/config").json().get("school_name_th") or ""
    assert r["provider"] == "web:wikipedia" and calls[-1] == (school or "วิทยาลัย")
    client.post("/api/chat", json={"text": "หาข้อมูลสภาพอากาศวันนี้", "lang": "th", "channel": "kiosk"})
    assert calls[-1] == "สภาพอากาศวันนี้"
    n = len(calls)
    client.post("/api/chat", json={"text": "ค่าเทอมเท่าไหร่", "lang": "th", "channel": "kiosk"})
    assert len(calls) == n                              # คำถามธรรมดา (ไม่ได้สั่งค้น) ไม่ออกเว็บ


def test_web_query_resolves_this_program_and_school():
    from types import SimpleNamespace
    cfg = {"school_name_th": "วิทยาลัยเทคนิคน่าน", "school_name_en": "Nan Technical College"}
    p = SimpleNamespace(name_th="ช่างยนต์", name_en="Automotive")
    assert engine._web_query("วิทยาลัยนี้", None, cfg, "th") == "วิทยาลัยเทคนิคน่าน"
    assert engine._web_query("ประวัติวิทยาลัยนี้", None, cfg, "th") == "ประวัติวิทยาลัยเทคนิคน่าน"
    assert engine._web_query("อาชีพของสาขานี้", p, cfg, "th") == "อาชีพของช่างยนต์ วิทยาลัยเทคนิคน่าน"
    assert engine._web_query("ดาวอังคาร", p, cfg, "th") == "ดาวอังคาร"


def test_web_parse_summary_format():
    t, s, p = web._parse_summary("TITLE: ดาวอังคาร\nSUMMARY: ดาวเคราะห์ลำดับที่สี่ค่ะ\nPOINTS:\n- มีดวงจันทร์ 2 ดวง\n- สีแดง")
    assert t == "ดาวอังคาร" and s == "ดาวเคราะห์ลำดับที่สี่ค่ะ" and p == ["มีดวงจันทร์ 2 ดวง", "สีแดง"]


# ---------------------------------------------------------------- 11 พ.ย. 2569 (รอบ 2): ค้นเว็บ + เสียงพรีเซนต์
def test_web_gemini_has_thinking_room_and_accepts_search_queries(monkeypatch):
    import httpx
    monkeypatch.setattr(web.settings, "llm_provider", "gemini")
    monkeypatch.setattr(web.settings, "llm_api_key", "fake-key-not-real")
    seen = {}

    def handler(req):
        import json as _j
        seen["body"] = _j.loads(req.content)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "TITLE: ดาวอังคาร\nSUMMARY: ดาวเคราะห์ดวงที่สี่ค่ะ\nPOINTS:\n- สีแดง"}]},
                                                          "groundingMetadata": {"webSearchQueries": ["ดาวอังคาร"]}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await web._gemini_grounded("ดาวอังคาร", "th", c)
    r = asyncio.run(run())
    assert seen["body"]["generationConfig"]["maxOutputTokens"] > 900       # เผื่อโทเคนคิด
    assert r and r["sources"][0]["url"].startswith("https://www.google.com/search?q=") and web.last["gemini"] == "ok"


def test_web_gemini_empty_text_reports_reason(monkeypatch):
    import httpx
    monkeypatch.setattr(web.settings, "llm_provider", "gemini")
    monkeypatch.setattr(web.settings, "llm_api_key", "fake-key-not-real")
    tr = httpx.MockTransport(lambda req: httpx.Response(200, json={"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": []}}]}))

    async def run():
        async with httpx.AsyncClient(transport=tr) as c:
            return await web._gemini_grounded("x", "th", c)
    assert asyncio.run(run()) is None and "MAX_TOKENS" in web.last["gemini"]


def test_web_search_reports_why_when_all_fail(monkeypatch):
    monkeypatch.setattr(web.settings, "ai_web_enabled", True)
    monkeypatch.setattr(web.settings, "llm_provider", "none")

    async def no_wiki(q, lang, c):
        web._why("wikipedia", "th: HTTPStatusError: 403")
        return []
    monkeypatch.setattr(web, "_wikipedia", no_wiki)
    web._cache.clear()
    assert asyncio.run(web.search("ดาวอังคาร")) is None
    assert "403" in web.last["result"] and "ไม่ได้ตั้งค่า Gemini" in web.last["result"]


def test_tts_limits_parallel_and_merges_duplicates(monkeypatch, tmp_path):
    from app import tts
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(tts, "available", lambda: True)
    monkeypatch.setattr(tts, "_state", {"fail_until": 0.0, "last_error": ""})
    state = {"now": 0, "peak": 0, "calls": 0}

    async def fake_stream(text, voice, rate, pitch):
        state["calls"] += 1
        state["now"] += 1
        state["peak"] = max(state["peak"], state["now"])
        await asyncio.sleep(0.02)
        state["now"] -= 1
        return b"mp3" + text.encode()
    monkeypatch.setattr(tts, "_stream", fake_stream)

    async def run():
        texts = [f"ประโยค {i}" for i in range(8)] + ["ประโยค 0", "ประโยค 0"]
        return await asyncio.gather(*(tts.synthesize(t, "th", prefetch=True) for t in texts))
    res = asyncio.run(run())
    assert all(res) and state["peak"] <= tts.MAX_PARALLEL and state["calls"] == 8


def test_tts_prefetch_failure_does_not_start_cooldown(monkeypatch, tmp_path):
    from app import tts
    monkeypatch.setattr(tts, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(tts, "available", lambda: True)
    monkeypatch.setattr(tts, "_state", {"fail_until": 0.0, "last_error": ""})
    monkeypatch.setattr(tts, "record_event", lambda *a, **k: None)

    async def boom(*a):
        raise RuntimeError("rate limited")
    monkeypatch.setattr(tts, "_stream", boom)
    assert asyncio.run(tts.synthesize("ก", "th", prefetch=True)) is None and tts._state["fail_until"] == 0.0
    assert asyncio.run(tts.synthesize("ข", "th")) is None and tts._state["fail_until"] == 0.0   # ล้มครั้งแรก ยังไม่พัก
    assert asyncio.run(tts.synthesize("ค", "th")) is None and tts._state["fail_until"] > 0     # ล้มติดกัน 2 ครั้ง → พัก


def test_web_speech_text_reads_summary_and_all_points():
    f = {"summary": "ดาวอังคารเป็นดาวเคราะห์ดวงที่สี่ค่ะ", "points": ["มีสีแดง", "มีดวงจันทร์ 2 ดวง"], "lang": "th"}
    t = web.speech_text(f)
    assert t.startswith("ดาวอังคารเป็นดาวเคราะห์ดวงที่สี่ค่ะ") and "ข้อ 1 มีสีแดง" in t and "ข้อ 2 มีดวงจันทร์ 2 ดวง" in t
    assert web.speech_text({"summary": "Mars is red.", "points": [], "lang": "en"}) == "Mars is red."


def test_web_parse_strips_citations_and_relevance():
    _, s, p = web._parse_summary("TITLE: X\nSUMMARY: ดาวอังคารมีสีแดง [1] และมีดวงจันทร์ [2, 3] ค่ะ\nPOINTS:\n- ข้อหนึ่ง [4]")
    assert "[" not in s and p == ["ข้อหนึ่ง"]
    assert web._relevance("ดาวอังคาร", "ดาวอังคาร (ดาวเคราะห์)") == 1.0
    assert web._relevance("ดาวอังคาร", "ภูเขาไฟฟูจิ") < 0.3


def test_web_search_drops_unrelated_wikipedia_pages(monkeypatch):
    monkeypatch.setattr(web.settings, "ai_web_enabled", True)
    monkeypatch.setattr(web.settings, "llm_provider", "none")

    async def wiki(q, lang, c):
        return [{"title": "ภูเขาไฟฟูจิ", "extract": "ภูเขาในญี่ปุ่น", "url": "u1", "image": "i1", "lang": "th"},
                {"title": "ดาวอังคาร", "extract": "ดาวเคราะห์ดวงที่สี่", "url": "u2", "image": "i2", "lang": "th"}]
    monkeypatch.setattr(web, "_wikipedia", wiki)
    web._cache.clear()
    r = asyncio.run(web.search("ดาวอังคาร", question="หาข้อมูลดาวอังคาร"))
    assert r["title"] == "ดาวอังคาร" and [i["url"] for i in r["images"]] == ["i2"] and len(r["sources"]) == 1


def test_web_gemini_quota_429_tries_fallback_then_backs_off(monkeypatch):
    import httpx
    monkeypatch.setattr(web.settings, "llm_provider", "gemini")
    monkeypatch.setattr(web.settings, "llm_api_key", "fake-key-A")
    monkeypatch.setattr(web.settings, "llm_fallback_provider", "gemini")
    monkeypatch.setattr(web.settings, "llm_fallback_api_key", "fake-key-B")
    monkeypatch.setattr(web, "_quota_until", {})
    keys = []

    def handler(req):
        keys.append(req.headers["x-goog-api-key"])
        return httpx.Response(429, json={"error": {"message": "You exceeded your current quota"}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await web._gemini_grounded("x", "th", c)
    from app.ai import llm as llm_mod
    monkeypatch.setattr(llm_mod.rate, "blocked_until", 0.0)
    assert asyncio.run(run()) is None and keys == ["fake-key-A"]   # 429 = โควตาโปรเจกต์เต็ม → งดเรียกทุกคีย์ชั่วคราว
    assert asyncio.run(run()) is None and len(keys) == 1          # พัก ไม่เรียกซ้ำ
    monkeypatch.setattr(llm_mod.rate, "blocked_until", 0.0)
    assert "โควตา" in web.last["gemini"] and "fake-key" not in web.last["gemini"]


def test_llm_local_rpm_limit_skips_call_and_429_pauses_chain(monkeypatch):
    import httpx
    from app.ai import llm as llm_mod
    from app.ai.llm import LLMError, llm
    monkeypatch.setattr(llm_mod.settings, "llm_provider", "gemini")
    monkeypatch.setattr(llm_mod.settings, "llm_api_key", "fake-key-A")
    monkeypatch.setattr(llm_mod.settings, "llm_fallback_provider", "gemini")
    monkeypatch.setattr(llm_mod.settings, "llm_fallback_api_key", "fake-key-B")
    monkeypatch.setattr(llm_mod.settings, "llm_rpm", 1)
    monkeypatch.setattr(llm_mod, "rate", llm_mod.RateWindow())
    hits = []

    def handler(req):
        hits.append(req.headers.get("x-goog-api-key"))
        return httpx.Response(429, json={"error": {"message": "quota"}})
    monkeypatch.setattr(llm, "_transport", httpx.MockTransport(handler))
    with pytest.raises(LLMError):
        asyncio.run(llm.complete("s", "u"))
    assert hits == ["fake-key-A"]                                  # 429 → ไม่ส่งต่อคีย์สำรอง
    assert not llm.breaker.is_open and llm_mod.rate.status()["cooling_down_s"] > 0
    llm_mod.rate.blocked_until = 0.0
    with pytest.raises(LLMError):
        asyncio.run(llm.complete("s", "u"))
    assert hits == ["fake-key-A"]                                  # เกิน 1 ครั้ง/นาที → ไม่เรียกเลย
