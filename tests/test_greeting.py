"""คำทักทายตามบริบท + กันซ้ำ (app/greetings.py และ POST /api/greet) — 16 พ.ย. 2569"""
import random
import re

import pytest

from app import greetings as G
from app.greetings import GREETINGS, POOLS, GreetingSelector, build_pools, resolve_context

# ช่วง Emoji เดียวกับ frontend/kiosk/voice/speech-text.js
EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️‍⃣\U000E0020-\U000E007F]")

APPROVED_POOLS = {
    "general": {1, 3, 6, 8}, "program": {2, 4, 5}, "admission": {10, 12}, "activity": {2, 9, 11},
    "parent": {10, 11, 12}, "student": {1, 7, 8}, "kiosk": {6, 7, 9},
}
ALLOWED_EMOJI = {
    "general": {"😊", "👋", "✨"}, "program": {"🎓", "💻", "🔧", "📚"}, "admission": {"📝", "🎓", "✨"},
    "activity": {"🎉", "🏆", "✨"}, "kiosk": {"👋", "😊", "✨"}, "student": {"😊", "👋", "✨"}, "parent": set(),
}


def sel(seed=1, pools=None):
    return GreetingSelector(pools=pools, rng=random.Random(seed))


@pytest.fixture(autouse=True)
def _fresh_selector():
    G.selector.reset()
    old = G.selector.rng
    G.selector.rng = random.Random(2569)
    yield
    G.selector.rng = old
    G.selector.reset()


# ------------------------------------------------------------------ ข้อความและ pool
def test_twelve_templates_unique_and_on_persona():
    assert sorted(GREETINGS) == list(range(1, 13))
    bodies = list(GREETINGS.values())
    assert len(set(bodies)) == 12 and len({G.strip_emoji(b) for b in bodies}) == 12
    for b in bodies:
        assert "VORA" in b and "ยินดีต้อนรับสู่" not in b and "วิทยาลัยเทคนิคน่าน" not in b
        assert not EMOJI.search(b)                      # Emoji อยู่ที่ pool ตามบริบท ไม่ได้ฝังในข้อความ
        assert b.rstrip("?").endswith(("คะ", "ค่ะ"))    # ลงท้ายสุภาพ เปิดทางให้ถามต่อ


def test_pools_match_approved_mapping():
    assert set(POOLS) == set(APPROVED_POOLS)
    for ctx, ids in APPROVED_POOLS.items():
        assert {g.id for g in POOLS[ctx]} == ids, ctx
        assert len({g.key for g in POOLS[ctx]}) == len(POOLS[ctx])      # ไม่มีประโยคซ้ำใน pool เดียวกัน


@pytest.mark.parametrize("ctx", sorted(APPROVED_POOLS))
def test_each_context_picks_only_from_its_pool(ctx):
    s = sel(seed=7)
    for _ in range(120):
        g = s.pick(ctx)
        assert g.context == ctx and g.id in APPROVED_POOLS[ctx]


# ------------------------------------------------------------------ การระบุบริบท
def test_resolve_context_order():
    # 1) หน้านำเสนอที่เปิดอยู่ชนะทุกอย่าง
    assert resolve_context("departments", admission_period=True) == "program"
    assert resolve_context("admission") == "admission"
    assert resolve_context("news", admission_period=True) == "activity"
    assert resolve_context("college", admission_period=True) == "general"
    assert resolve_context(" Program ") == "program"
    for name in ("parent", "student", "kiosk", "general", "activity"):
        assert resolve_context(name) == name
    # 2) ช่วงรับสมัคร 3) กล้องเห็นคนใหม่ 4) general
    assert resolve_context(None, trigger="face", admission_period=True) == "admission"
    assert resolve_context(None, trigger="face") == "kiosk"
    assert resolve_context(None, trigger="gesture") == "kiosk"
    assert resolve_context(None, trigger="web") == "general"


def test_unknown_context_falls_back_to_general():
    assert resolve_context("no-such-page", trigger="web") == "general"
    assert resolve_context("", trigger="") == "general"
    assert resolve_context(12345, trigger=None) == "general"
    s = sel()
    for bad in ("no-such-page", None, 42, ""):
        assert s.pick(bad).context == "general"


def test_admission_period_does_not_override_kiosk_every_time():
    s = sel(seed=3)
    ctxs = [s.choose(None, trigger="face", admission_period=True).context for _ in range(12)]
    assert set(ctxs) == {"admission", "kiosk"}
    assert ctxs.count("admission") == 4                       # 1 ใน 3
    for i in range(len(ctxs) - 1):
        assert not (ctxs[i] == "admission" and ctxs[i + 1] == "admission")
    # นอกช่วงรับสมัคร: ไม่มีชุดรับสมัครเลย
    s2 = sel(seed=3)
    assert {s2.choose(None, trigger="face").context for _ in range(12)} == {"kiosk"}


# ------------------------------------------------------------------ กันซ้ำ
def test_never_repeats_consecutively_even_across_contexts():
    for seed in range(25):
        s, r = sel(seed), random.Random(seed)
        prev = None
        for _ in range(200):
            g = s.pick(r.choice(sorted(POOLS)))
            assert g.key != prev
            prev = g.key


def test_recent_history_is_avoided_when_alternatives_exist():
    """ตัวอย่างในข้อกำหนด: pool A–E, ประวัติ A → C ⇒ ต้องเลือกจาก B/D/E"""
    pools = build_pools({"general": ((1, ""),), "program": ((2, ""), (4, ""), (5, ""), (9, ""), (11, ""))})
    a, b, c, d, e = pools["program"]
    for seed in range(40):
        s = sel(seed, pools)
        s.recent.extend([a.key, c.key]); s.used["program"] = {a.key, c.key}
        assert s.pick("program").key in {b.key, d.key, e.key}


def test_recent_only_chosen_when_pool_exhausted():
    """เลือกประโยคที่อยู่ใน 5 ครั้งล่าสุดได้ก็ต่อเมื่อ pool ของบริบทนั้นไม่เหลือตัวเลือกอื่นแล้วเท่านั้น"""
    for seed in range(25):
        s, r = sel(seed), random.Random(1000 + seed)
        for _ in range(200):
            ctx = r.choice(sorted(POOLS))
            recent, used = set(s.recent), set(s.used.get(ctx, set()))
            g = s.pick(ctx)
            if g.key in recent:
                assert all(x.key in recent or x.key in used for x in POOLS[ctx])


def test_history_resets_when_pool_fully_used():
    s = sel(seed=5)
    first = [s.pick("program") for _ in range(3)]
    assert {g.id for g in first} == {2, 4, 5}                 # ครบทั้ง pool ก่อนจะวนซ้ำ
    again = s.pick("program")                                  # pool ถูกใช้ครบ → เริ่มรอบใหม่ได้ ไม่ล้ม
    assert again.id in {2, 4, 5} and again.key != first[-1].key
    assert s.used["program"] == {again.key}                    # ประวัติของ program ถูกล้างแล้วเริ่มนับใหม่


def test_reset_touches_only_that_context():
    s = sel(seed=9)
    s.pick("general")
    general_used = set(s.used["general"])
    for _ in range(3):
        s.pick("admission")                                    # pool 2 ประโยค → ครั้งที่ 3 ต้อง reset
    assert s.used["general"] == general_used and len(s.used["admission"]) == 1


def test_no_cross_pool_to_avoid_repetition():
    s = sel(seed=11)
    ids = [s.pick("admission").id for _ in range(60)]
    assert set(ids) == {10, 12}
    assert all(ids[i] != ids[i + 1] for i in range(len(ids) - 1))


def test_pool_with_single_greeting_still_works():
    pools = build_pools({"general": ((1, "😊"),)})
    s = sel(pools=pools)
    assert [s.pick("general").id for _ in range(6)] == [1] * 6
    assert s.pick("anything-else").id == 1


def test_emoji_variants_count_as_the_same_greeting():
    pools = build_pools({"general": ((1, "😊"), (1, "👋"), (3, ""))})
    a, b, c = pools["general"]
    assert a.display() != b.display() and a.key == b.key and a.tts_text() == b.tts_text()
    for seed in range(30):
        s = sel(seed, pools)
        keys = [s.pick("general").key for _ in range(40)]
        assert all(keys[i] != keys[i + 1] for i in range(len(keys) - 1))     # 😊 แล้ว 👋 ของประโยคเดียวกัน = ซ้ำ ห้ามติดกัน


def test_general_fallback_uses_anti_repetition():
    s = sel(seed=13)
    ids = [s.pick("unknown-context").id for _ in range(4)]
    assert sorted(ids) == [1, 3, 6, 8]


# ------------------------------------------------------------------ display_text / tts_text / Emoji
def test_display_and_tts_text_are_separated():
    with_emoji = without = 0
    for ctx, pool in POOLS.items():
        for g in pool:
            assert not EMOJI.search(g.tts_text()) and not EMOJI.search(g.display(emoji=False))
            assert g.tts_text() == f"สวัสดีค่ะ {g.body}" and "  " not in g.display()
            assert g.display(2).startswith("สวัสดีค่ะทุกคน") and g.tts_text(2) == f"สวัสดีค่ะทุกคน {g.body}"
            if g.emoji:
                with_emoji += 1
                assert g.display() == f"สวัสดีค่ะ {g.emoji} {g.body}" and g.emoji in ALLOWED_EMOJI[ctx], (ctx, g.id)
                assert len(EMOJI.findall(g.display())) == 1          # ไม่เกิน 1 Emoji ต่อประโยค
            else:
                without += 1
                assert g.display() == g.tts_text()
    assert with_emoji and without                                    # บางประโยคมี บางประโยคไม่มี (ไม่ใส่ทุกประโยค)
    for ctx in ("general", "program", "admission", "activity"):
        assert any(not g.emoji for g in POOLS[ctx]), ctx


# ------------------------------------------------------------------ POST /api/greet
@pytest.fixture
def no_admission(monkeypatch):
    import app.timeline as tl
    monkeypatch.setattr(tl, "build_timeline", lambda db, *a, **k: {"important": []})


@pytest.fixture
def in_admission(monkeypatch):
    import app.timeline as tl
    monkeypatch.setattr(tl, "build_timeline", lambda db, *a, **k: {"important": [{"id": 1}]})


def _texts(ctx, emoji=True, people=1):
    return {g.display(people, emoji=emoji) for g in POOLS[ctx]}


def greet(client, **body):
    r = client.post("/api/greet", json={"lang": "th", **body})
    assert r.status_code == 200, r.text
    return r.json()


def test_api_default_request_gets_kiosk_pool_without_emoji(client, no_admission):
    """หน้าจอรุ่นเก่า (ไม่ส่ง context/emoji): ได้ชุด Kiosk และไม่มี Emoji (เพราะรุ่นเก่าไม่ได้ตัด Emoji ก่อนส่งเสียงพูด)"""
    for _ in range(6):
        r = greet(client)
        assert r["text"] in _texts("kiosk", emoji=False) and not EMOJI.search(r["text"])
        assert r["gesture"] == "wave" and r["emotion"] == "happy" and r["lang"] == "th" and r["suggestions"]


@pytest.mark.parametrize("section,ctx", [("departments", "program"), ("admission", "admission"), ("news", "activity"),
                                         ("college", "general"), ("parent", "parent"), ("student", "student"), ("kiosk", "kiosk")])
def test_api_context_selects_its_pool(client, no_admission, section, ctx):
    for _ in range(8):
        assert greet(client, context=section, emoji=True)["text"] in _texts(ctx)


def test_api_unknown_context_falls_back(client, no_admission):
    assert greet(client, context="no-such-page", emoji=True)["text"] in _texts("kiosk")        # ยังรู้ว่าเป็นหน้าจอ Kiosk
    for _ in range(6):
        assert greet(client, context="no-such-page", trigger="web", emoji=True)["text"] in _texts("general")


def test_api_admission_period_mixes_with_kiosk(client, in_admission):
    texts = [greet(client, emoji=True)["text"] for _ in range(9)]
    adm = [t in _texts("admission") for t in texts]
    assert adm.count(True) == 3 and all(t in _texts("admission") | _texts("kiosk") for t in texts)
    assert greet(client, context="departments", emoji=True)["text"] in _texts("program")       # หน้าที่เปิดอยู่ชนะช่วงรับสมัคร


def test_api_no_consecutive_repeat_and_group_prefix(client, no_admission):
    prev = None
    for i in range(30):
        ctx = ["kiosk", "general", "student", "program", "activity"][i % 5]
        t = greet(client, context=ctx, emoji=True, people=1 + i % 2)["text"]
        assert t.startswith("สวัสดีค่ะทุกคน") == bool(i % 2)
        spoken = G.strip_emoji(t).replace("สวัสดีค่ะทุกคน ", "").replace("สวัสดีค่ะ ", "")
        assert spoken != prev
        prev = spoken


# ------------------------------------------------------------------ ภาษาอังกฤษ (16 พ.ย. 2569 รอบ 3)
SALUTATIONS = ("Good morning", "Good afternoon", "Good evening")


def _texts_en(ctx, emoji=True, people=1):
    return {g.display(people, emoji=emoji, lang="en", hour=h) for g in POOLS[ctx] for h in (9, 14, 20)}


def test_english_translations_cover_all_twelve():
    assert sorted(G.GREETINGS_EN) == list(range(1, 13)) and len(set(G.GREETINGS_EN.values())) == 12
    for gid, body in G.GREETINGS_EN.items():
        assert "VORA" in body and not EMOJI.search(body) and body[-1] in ".?" and body.isascii(), gid
        assert not body.startswith(("Hello", "Good "))          # คำทักตามเวลาเติมตอนแสดงผล ไม่ฝังในประโยค
    assert G.FORMAL_IDS == {10, 11, 12}


def test_english_salutation_follows_current_time():
    for hour, want in [(0, "Good morning"), (11, "Good morning"), (12, "Good afternoon"), (16, "Good afternoon"),
                       (17, "Good evening"), (23, "Good evening")]:
        assert G.salutation_en(hour) == want
    casual = next(g for g in POOLS["general"] if g.id == 1)      # 😊
    formal = next(g for g in POOLS["admission"] if g.id == 10)   # 📝
    assert casual.display(lang="en", hour=9) == "Good morning! 😊 Curious about vocational education? Just ask VORA."
    assert casual.display(2, lang="en", hour=14) == "Good afternoon, everyone! 😊 Curious about vocational education? Just ask VORA."
    assert casual.tts_text(lang="en", hour=20) == "Good evening! Curious about vocational education? Just ask VORA."
    assert formal.display(lang="en", hour=20, emoji=False).startswith("Good evening. If you need information")
    assert formal.display(3, lang="en", hour=9).startswith("Good morning, everyone. 📝 If you need")
    for pool in POOLS.values():
        for g in pool:
            for h in (9, 14, 20):
                d = g.display(lang="en", hour=h)
                assert "Hello" not in d and "สวัสดี" not in d and not EMOJI.search(g.tts_text(lang="en", hour=h))
                assert len(EMOJI.findall(d)) == (1 if g.emoji else 0)
            assert g.display() == g.display(lang="th", hour=3)   # ไทยไม่ขึ้นกับเวลา (เหมือนเดิม)


@pytest.mark.parametrize("section,ctx", [("departments", "program"), ("admission", "admission"), ("news", "activity"),
                                         ("college", "general"), (None, "kiosk")])
def test_api_english_uses_context_pools(client, no_admission, section, ctx):
    for _ in range(6):
        r = client.post("/api/greet", json={"lang": "en", "context": section, "emoji": True}).json()
        assert r["text"] in _texts_en(ctx) and r["text"].startswith(SALUTATIONS) and r["lang"] == "en" and r["gesture"] == "wave"
        assert "PR robot" not in r["text"]                       # ไม่ใช่ประโยคอังกฤษเดิมแล้ว


def test_api_english_group_old_client_and_no_repeat(client, no_admission):
    r = client.post("/api/greet", json={"lang": "en", "people": 3}).json()            # หน้าจอรุ่นเก่า: ไม่มี Emoji
    assert r["text"] in _texts_en("kiosk", emoji=False, people=3) and ", everyone" in r["text"] and not EMOJI.search(r["text"])
    prev = None
    for i in range(24):                                                               # สลับไทย/อังกฤษ: ประโยคเดียวกันคนละภาษา = ซ้ำ
        lang = "en" if i % 2 else "th"
        t = client.post("/api/greet", json={"lang": lang, "context": "kiosk", "emoji": True}).json()["text"]
        gid = next(g.id for g in POOLS["kiosk"] if t in {g.display(lang="th"), *(g.display(lang="en", hour=h) for h in (9, 14, 20))})
        assert gid != prev
        prev = gid


def test_api_english_selection_failure_uses_old_greeting(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("selector broken")
    monkeypatch.setattr(G, "choose", boom)
    r = client.post("/api/greet", json={"lang": "en", "emoji": True})
    assert r.status_code == 200
    assert r.json()["text"].startswith(tuple(s + "! Hello! I'm VORA" for s in SALUTATIONS))
    assert client.post("/api/greet", json={"lang": "en", "people": 2}).json()["text"].startswith("Hello everyone! ")


def test_api_selection_failure_never_fails_request(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("selector broken")
    monkeypatch.setattr(G, "choose", boom)
    r = greet(client, context="departments", emoji=True)
    assert r["text"].startswith("สวัสดีค่ะ ") and r["gesture"] == "wave"       # คำทักทายเดิมจากหลังบ้าน
    assert greet(client, people=2)["text"].startswith("สวัสดีค่ะทุกคน ")


def test_no_legacy_or_banned_greeting_in_new_module():
    import inspect
    src = inspect.getsource(G)
    assert "หนูชื่อวอร่า" not in src and "ยินดีต้อนรับสู่วิทยาลัยเทคนิคน่าน" not in src
