"""กล้องจำป้าย: รายละเอียดตามประเภท + ป๊อปอัป + ถามต่อ + ภาพที่ไม่รู้จัก (24 พ.ย. 2569)
app/ai/vision_items.py · app/routers/vision_detail.py · engine.answer_vision / vision_item_id ใน /api/chat"""
from types import SimpleNamespace as NS

import pytest

from app import brain
from app.ai import vision_items as vi
from app.config import settings
from app.db import SessionLocal
from app.models import News, UnansweredQuestion, UnknownSight, VisionClass, VisionItem, VisionSample


@pytest.fixture(autouse=True)
def _reset():
    brain._reset_for_tests()


# ------------------------------------------------------------------ ฟังก์ชันล้วน
POSTER = NS(id=1, kind="poster", news_id=None, images=[], details={
    "title": "Open House เปิดบ้านอาชีวะ", "detail": "ชมการสาธิตของทุกแผนก", "start_date": "5 ธ.ค. 2569",
    "location": "หอประชุมวิทยาลัย", "eligibility": "นักเรียน ม.3 และผู้ปกครอง"})
PRODUCT = NS(id=2, kind="product", news_id=None, images=["/uploads/a.jpg"], details={
    "name": "น้ำพริกอ่อง", "maker": "แผนกอาหารและโภชนาการ", "price": "ขวดละ 35 บาท"})
VC = NS(label="x", display_name="ป้าย x")


def test_schema_has_five_kinds_with_different_fields():
    s = {k["kind"]: [f["key"] for f in k["fields"]] for k in vi.schema()}
    assert set(s) == {"sign", "poster", "event", "object", "product"}
    assert "eligibility" in s["poster"] and "price" in s["product"] and "caution" in s["object"] and "price" not in s["poster"]


def test_clean_details_keeps_only_fields_of_that_kind():
    d = vi.clean_details("poster", {"title": " งาน ", "price": "10", "link": "javascript:alert(1)", "location": ""})
    assert d == {"title": "งาน"}


@pytest.mark.parametrize("q,expect,part", [
    ("จัดที่ไหน", "field", "หอประชุม"), ("งานนี้จัดวันไหน", "field", "5 ธ.ค."), ("ใครเข้าร่วมได้", "field", "ม.3"),
    ("สมัครยังไง", "missing", "ยังไม่มีข้อมูล"), ("คืออะไร", "describe", "โปสเตอร์"), ("ปิด", "close", "ปิด"), ("ขอบคุณค่ะ", "close", ""),
])
def test_follow_up_on_poster(q, expect, part):
    v = vi.view(VC, POSTER)
    r = vi.answer_focus(v, q)
    assert r and r[1] == expect and part in r[0]


@pytest.mark.parametrize("q", ["ค่าเทอมเท่าไหร่", "Python คืออะไร", "ตอนนี้กี่โมง", "มีสาขาอะไรบ้าง"])
def test_unrelated_question_is_not_answered_from_item(q):
    assert vi.answer_focus(vi.view(VC, PRODUCT), q) is None


def test_product_price_and_maker():
    v = vi.view(VC, PRODUCT)
    assert "35 บาท" in vi.answer_focus(v, "ราคาเท่าไหร่")[0]
    assert "อาหารและโภชนาการ" in vi.answer_focus(v, "ใครทำ")[0]
    assert v["images"] == ["/uploads/a.jpg"]


def test_summary_and_news_merge():
    news = NS(title_th="ข่าวแข่งขันทักษะ", body_th="แข่งระดับจังหวัด", location="อาคาร 2", event_date=None, image_url="/uploads/n.jpg", gallery="")
    item = NS(id=3, kind="event", news_id=9, images=[], details={"result": "ชนะเลิศ"})
    v = vi.view(VC, item, news)
    assert v["title"] == "ข่าวแข่งขันทักษะ" and "/uploads/n.jpg" in v["images"]
    s = vi.summary(v)
    assert s.startswith("นี่คือภาพกิจกรรม ข่าวแข่งขันทักษะ") and "อาคาร 2" in s and s.endswith("ถามได้เลยค่ะ")
    assert "ชนะเลิศ" in vi.answer_focus(v, "ได้รางวัลอะไร")[0]


def test_expired_poster_is_flagged():
    item = NS(id=4, kind="poster", news_id=None, images=[], details={"title": "รับสมัคร", "expire_at": "2020-01-01"})
    v = vi.view(VC, item)
    assert v["expired"] and "หมดอายุ" in vi.summary(v)


# ------------------------------------------------------------------ ผ่าน API
def _class(label):
    with SessionLocal() as db:
        vc = db.query(VisionClass).filter(VisionClass.label == label).first()
        if not vc:
            vc = VisionClass(label=label, display_name=label, action="text", response_th="ข้อความเดิม")
            db.add(vc)
            db.commit()
        return vc.id


def test_admin_save_and_recognize_shows_popup(client, admin_headers, editor_headers):
    cid = _class("poster_test")
    assert client.get("/api/admin/vision/kinds", headers=editor_headers).json()["kinds"][0]["kind"] == "sign"
    bad = client.put(f"/api/admin/vision/items/{cid}", json={"kind": "spaceship", "details": {}}, headers=editor_headers)
    assert bad.status_code == 400
    r = client.put(f"/api/admin/vision/items/{cid}", headers=editor_headers, json={
        "kind": "poster", "details": {"title": "งานวันวิชาการ", "location": "หอประชุม", "price": "x"},
        "images": ["/uploads/p.jpg", "javascript:x"]})
    assert r.status_code == 200, r.text
    assert r.json()["details"] == {"title": "งานวันวิชาการ", "location": "หอประชุม"} and r.json()["images"] == ["/uploads/p.jpg"]
    res = client.post("/api/vision/recognized", json={"label": "poster_test", "lang": "th"}).json()
    assert res["text"].startswith("นี่คือโปสเตอร์ งานวันวิชาการ")
    item = res["media"]["vision_item"]
    assert item["kind"] == "poster" and item["images"] == ["/uploads/p.jpg"]
    # ป๊อปอัปเปิดอยู่ → ถามต่อ
    sid = res["session_id"]
    a = client.post("/api/chat", json={"text": "จัดที่ไหน", "session_id": sid, "vision_item_id": item["id"]}).json()
    assert "หอประชุม" in a["text"] and a["media"]["vision_item"]["focus"] == "field"
    # ไม่มีข้อมูล → บอกตรง ๆ + บันทึกให้เจ้าหน้าที่
    m = client.post("/api/chat", json={"text": "ใครเข้าร่วมได้", "session_id": sid, "vision_item_id": item["id"]}).json()
    assert "ยังไม่มีข้อมูล" in m["text"]
    with SessionLocal() as db:
        assert db.query(UnansweredQuestion).filter(UnansweredQuestion.text.like("[งานวันวิชาการ]%")).count() >= 1
    # ถามเรื่องอื่น → ตอบตามปกติ + สั่งปิดป๊อปอัป
    o = client.post("/api/chat", json={"text": "วิทยาลัยอยู่ที่ไหน", "session_id": sid, "vision_item_id": item["id"]}).json()
    assert o["media"].get("vision_close") is True and "vision_item" not in o["media"]
    c = client.post("/api/chat", json={"text": "ปิด", "session_id": sid, "vision_item_id": item["id"]}).json()
    assert c["media"].get("vision_close") is True
    # ไม่ได้ส่ง vision_item_id (ป๊อปอัปปิดแล้ว) → ไม่ตอบจากป้าย
    n = client.post("/api/chat", json={"text": "จัดที่ไหน", "session_id": sid}).json()
    assert "vision_item" not in (n.get("media") or {})


def test_without_details_old_behaviour_and_switch(client, admin_headers, monkeypatch):
    _class("plain_sign")
    res = client.post("/api/vision/recognized", json={"label": "plain_sign"}).json()
    assert res["text"] == "ข้อความเดิม" and "vision_item" not in res["media"]
    cid = _class("switch_sign")
    client.put(f"/api/admin/vision/items/{cid}", headers=admin_headers, json={"kind": "sign", "details": {"name": "ป้ายสวิตช์"}})
    monkeypatch.setattr(settings, "vision_detail", False)
    res = client.post("/api/vision/recognized", json={"label": "switch_sign"}).json()
    assert "vision_item" not in res["media"]
    assert client.get(f"/api/admin/vision/items/{cid}", headers=admin_headers).status_code == 404


def test_unknown_sight_saved_and_taught(client, admin_headers, editor_headers, monkeypatch):
    _class("teach_target")
    r = client.post("/api/vision/unknown", json={"thumbnail": "data:image/jpeg;base64,AAAA", "embedding": [0.1, 0.2, 0.3],
                                                 "question": "นี่คืออะไร", "best_label": "teach_target", "best_prob": 0.31}).json()
    assert r["saved"] and "ยังไม่รู้จัก" in r["text"]
    rows = client.get("/api/admin/vision/unknown", headers=editor_headers).json()
    uid = rows[0]["id"]
    assert rows[0]["has_vector"] and "embedding" not in rows[0]
    t = client.post(f"/api/admin/vision/unknown/{uid}/teach", json={"label": "teach_target"}, headers=editor_headers)
    assert t.status_code == 200
    with SessionLocal() as db:
        assert db.get(UnknownSight, uid).status == "taught"
        assert db.query(VisionSample).filter(VisionSample.label == "teach_target", VisionSample.embedding == [0.1, 0.2, 0.3]).count() == 1
    bad = client.post("/api/vision/unknown", json={"thumbnail": "javascript:alert(1)"}).json()
    with SessionLocal() as db:
        assert db.query(UnknownSight).order_by(UnknownSight.id.desc()).first().thumbnail == ""
    monkeypatch.setattr(settings, "vision_unknown", False)
    assert client.post("/api/vision/unknown", json={"thumbnail": ""}).json()["saved"] is False
