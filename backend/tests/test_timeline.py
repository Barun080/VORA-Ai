"""Phase 5 · Gate 5D — Time Portal (/api/timeline · app/timeline.py)"""
from datetime import datetime, timedelta

import pytest

from app.db import SessionLocal
from app.models import News
from app.timeline import build_timeline, now_bkk

NOW = datetime(2026, 11, 1, 15, 0)       # เวลาไทยที่ใช้ทดสอบ (กำหนดเอง ไม่ขึ้นกับนาฬิกาเครื่อง)
TAG = "TL5-"


@pytest.fixture(scope="module")
def ids(client):
    db = SessionLocal()
    D = lambda days, h=0, m=0: datetime(2026, 11, 1, h, m) + timedelta(days=days)  # noqa: E731
    rows = {
        "today_timed": News(kind="activity", title_th=TAG + "วันนี้มีเวลา", status="published", event_date=D(0, 13, 30),
                            location_type="campus", location="หอประชุม"),
        "up_midnight": News(kind="activity", title_th=TAG + "พรุ่งนี้ไม่ระบุเวลา", status="published", event_date=D(1)),
        "past": News(kind="news", title_th=TAG + "เมื่อวาน", status="published", event_date=D(-1, 9)),
        "too_old": News(kind="news", title_th=TAG + "เก่าเกิน 30 วัน", status="published", event_date=D(-45)),
        "undated": News(kind="news", title_th=TAG + "ไม่มีวันที่", status="published", event_date=None),
        "adm_30": News(kind="admission", title_th=TAG + "รับสมัคร 30 วัน", status="published", event_date=D(30),
                       location_type="online", priority=2),
        "adm_60": News(kind="admission", title_th=TAG + "รับสมัคร 60 วัน", status="published", event_date=D(60)),
        "adm_61": News(kind="admission", title_th=TAG + "รับสมัคร 61 วัน", status="published", event_date=D(61)),
        "adm_undated": News(kind="admission", title_th=TAG + "รับสมัครไม่มีวันที่", status="published"),
        "adm_past": News(kind="admission", title_th=TAG + "รับสมัครผ่านไปแล้ว", status="published", event_date=D(-3)),
        "prio5_activity": News(kind="activity", title_th=TAG + "กิจกรรมสำคัญ 5", status="published", priority=5, event_date=D(5)),
        "prio5_news": News(kind="news", title_th=TAG + "ข่าวสำคัญ 5", status="published", priority=5, event_date=D(6)),
        "draft": News(kind="admission", title_th=TAG + "ร่าง", status="draft", event_date=D(3)),
        "pending": News(kind="activity", title_th=TAG + "รออนุมัติ", status="pending", event_date=D(3)),
        "not_yet": News(kind="admission", title_th=TAG + "ยังไม่ถึงเวลาเผยแพร่", status="published", event_date=D(10),
                        publish_at=D(1)),
        "expired": News(kind="admission", title_th=TAG + "หมดอายุแล้ว", status="published", event_date=D(10),
                        expire_at=D(0, 14)),
        "expires_later_today": News(kind="activity", title_th=TAG + "หมดอายุเย็นนี้", status="published",
                                    event_date=D(0, 16), expire_at=D(0, 18)),
    }
    db.add_all(rows.values())
    db.commit()
    out = {k: v.id for k, v in rows.items()}
    db.close()
    return out


def _tl(**kw):
    db = SessionLocal()
    try:
        return build_timeline(db, "th", now=kw.get("now", NOW))
    finally:
        db.close()


def _ids(group):
    return [i["id"] for i in group if i["title"].startswith(TAG)]


def test_only_published_within_window(ids):
    t = _tl()
    every = {i["id"] for g in ("past", "today_items", "upcoming", "undated", "important") for i in t[g]}
    for k in ("draft", "pending", "not_yet", "expired"):
        assert ids[k] not in every, k
    assert ids["expires_later_today"] in every


def test_groups_by_bangkok_date(ids):
    t = _tl()
    assert t["today"] == "2026-11-01" and "Asia/Bangkok" in t["timezone"]
    assert set(_ids(t["today_items"])) == {ids["today_timed"], ids["expires_later_today"]}
    assert _ids(t["today_items"])[0] == ids["today_timed"]                 # เรียงตามเวลา 13:30 ก่อน 16:00
    up = _ids(t["upcoming"])
    assert up[0] == ids["up_midnight"] and ids["adm_61"] in up
    assert ids["past"] in _ids(t["past"]) and ids["too_old"] not in _ids(t["past"])
    assert ids["undated"] in _ids(t["undated"]) and ids["adm_undated"] in _ids(t["undated"])
    for g in ("past", "today_items", "upcoming", "important"):
        assert ids["undated"] not in _ids(t[g]) and ids["adm_undated"] not in _ids(t[g])


def test_midnight_means_time_not_specified(ids):
    t = _tl()
    up = next(i for i in t["upcoming"] if i["id"] == ids["up_midnight"])
    assert up["date"] == "2026-11-02" and up["time"] is None
    td = next(i for i in t["today_items"] if i["id"] == ids["today_timed"])
    assert td["time"] == "13:30"
    db = SessionLocal()
    assert db.get(News, ids["up_midnight"]).event_date == datetime(2026, 11, 2, 0, 0)   # ไม่แก้ข้อมูลในฐานข้อมูล
    db.close()


def test_important_dates_rule(ids):
    imp = _ids(_tl()["important"])
    assert ids["adm_30"] in imp and ids["adm_60"] in imp                     # admission ภายใน 60 วัน (รวมวันที่ 60)
    for k in ("adm_61", "adm_undated", "adm_past", "prio5_activity", "prio5_news", "not_yet", "expired", "draft"):
        assert ids[k] not in imp, k                                         # priority 5 ไม่ทำให้เป็นวันสำคัญ
    item = next(i for i in _tl()["important"] if i["id"] == ids["adm_30"])
    assert item["important"] is True and item["days_until"] == 30


def test_location_passthrough_without_inference(ids):
    t = _tl()
    td = next(i for i in t["today_items"] if i["id"] == ids["today_timed"])
    assert (td["location_type"], td["location"], td["location_map_url"]) == ("campus", "หอประชุม", None)
    adm = next(i for i in t["important"] if i["id"] == ids["adm_30"])
    assert adm["location_type"] == "online" and adm["location"] is None
    up = next(i for i in t["upcoming"] if i["id"] == ids["up_midnight"])
    assert up["location"] is None and up["location_type"] is None and up["location_map_url"] is None


def test_window_is_rechecked_each_call(ids):
    later = _tl(now=NOW + timedelta(hours=4))                              # 19:00 หลังหมดอายุ 18:00
    every = {i["id"] for g in ("today_items", "upcoming", "important") for i in later[g]}
    assert ids["expires_later_today"] not in every
    nextday = _tl(now=NOW + timedelta(days=1))
    assert ids["not_yet"] in {i["id"] for i in nextday["important"]}          # ถึงเวลาเผยแพร่แล้ว


def test_endpoint_shape(client, ids):
    r = client.get("/api/timeline")
    assert r.status_code == 200
    d = r.json()
    for k in ("now", "today", "timezone", "past", "today_items", "upcoming", "undated", "important", "counts"):
        assert k in d
    assert d["today"] == now_bkk().date().isoformat()
