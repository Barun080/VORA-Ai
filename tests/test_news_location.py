"""Phase 5 · Gate 5C — สถานที่จัดกิจกรรมในข่าว (หลังบ้าน + API สาธารณะ)"""
import pytest


def _create(client, h, **kw):
    body = {"title_th": "กิจกรรมทดสอบสถานที่", "kind": "activity", "status": "published", **kw}
    return client.post("/api/admin/news", headers=h, json=body)


def _admin_get(client, h, nid):
    return next(n for n in client.get("/api/admin/news", headers=h).json() if n["id"] == nid)


def test_old_style_news_without_location_still_works(client, admin_headers):
    """ข่าวแบบเดิม (ไม่ส่งฟิลด์สถานที่) สร้าง/แสดงได้เหมือนเดิม สถานที่เป็น null"""
    r = _create(client, admin_headers, title_th="ข่าวแบบเดิมไม่มีสถานที่")
    assert r.status_code == 200
    nid = r.json()["id"]
    n = _admin_get(client, admin_headers, nid)
    assert n["location"] is None and n["location_type"] is None and n["location_map_url"] is None
    pub = next(x for x in client.get("/api/news?limit=30").json() if x["id"] == nid)
    assert pub["location"] is None and pub["location_type"] is None and pub["location_map_url"] is None
    for key in ("id", "title", "subtitle", "image", "kind", "title_th", "body_th", "video", "priority", "event_date", "publish_at"):
        assert key in pub                                  # ฟิลด์เดิมของ API ยังอยู่ครบ
    d = client.get(f"/api/news/{nid}").json()
    assert d["location"] is None and "event_date" in d


@pytest.mark.parametrize("kw", [
    {"location_type": "campus", "location": "หอประชุมวิทยาลัย"},
    {"location_type": "external", "location": "ศูนย์ประชุมแห่งชาติสิริกิติ์", "location_map_url": "https://maps.google.com/?q=QSNCC"},
    {"location_type": "online", "location": "Facebook Live เพจวิทยาลัย"},
    {"location_type": "online"},
])
def test_valid_locations(client, admin_headers, kw):
    r = _create(client, admin_headers, **kw)
    assert r.status_code == 200, r.text
    d = client.get(f"/api/news/{r.json()['id']}").json()
    for k, v in kw.items():
        assert d[k] == v
    for k in {"location", "location_type", "location_map_url"} - set(kw):
        assert d[k] is None


@pytest.mark.parametrize("kw,msg", [
    ({"location_type": "moon"}, "ประเภทสถานที่ไม่ถูกต้อง"),
    ({"location": "หอประชุม"}, "เลือกประเภทสถานที่"),
    ({"location_type": "campus"}, "กรอกชื่อสถานที่"),
    ({"location_type": "external", "location": "   "}, "กรอกชื่อสถานที่"),
    ({"location_type": "online", "location_map_url": "https://maps.google.com/x"}, "ออนไลน์ไม่ใช้ลิงก์แผนที่"),
    ({"location_type": "external", "location": "ที่ไหนสักแห่ง", "location_map_url": "http://maps.google.com/x"}, "https://"),
    ({"location_type": "external", "location": "ที่ไหนสักแห่ง", "location_map_url": "javascript:alert(1)"}, "https://"),
    ({"location_type": "campus", "location": "ก" * 256}, "255"),
])
def test_invalid_locations_rejected(client, admin_headers, kw, msg):
    r = _create(client, admin_headers, **kw)
    assert r.status_code == 400 and msg in r.json()["detail"]


def test_blank_strings_become_null_and_trimmed(client, admin_headers):
    nid = _create(client, admin_headers, location_type="campus", location="  อาคาร 3  ", location_map_url="").json()["id"]
    n = _admin_get(client, admin_headers, nid)
    assert n["location"] == "อาคาร 3" and n["location_map_url"] is None
    r = client.put(f"/api/admin/news/{nid}", headers=admin_headers,
                   json={**{k: n[k] for k in ("title_th", "kind", "status")}, "location_type": "", "location": "", "location_map_url": ""})
    assert r.status_code == 200
    n = _admin_get(client, admin_headers, nid)
    assert n["location"] is None and n["location_type"] is None     # ล้างสถานที่ = ไม่ระบุสถานที่


def test_update_without_location_fields_keeps_existing_location(client, admin_headers):
    """หน้าหลังบ้าน/สคริปต์รุ่นเก่าที่ไม่รู้จักฟิลด์สถานที่ แก้ข่าวแล้วสถานที่ต้องไม่หาย"""
    nid = _create(client, admin_headers, location_type="external", location="สนามกีฬาจังหวัด",
                  location_map_url="https://maps.google.com/?q=stadium").json()["id"]
    r = client.put(f"/api/admin/news/{nid}", headers=admin_headers,
                   json={"title_th": "แก้ชื่อข่าวอย่างเดียว", "kind": "activity", "status": "published"})
    assert r.status_code == 200
    n = _admin_get(client, admin_headers, nid)
    assert n["title_th"] == "แก้ชื่อข่าวอย่างเดียว"
    assert (n["location"], n["location_type"], n["location_map_url"]) == (
        "สนามกีฬาจังหวัด", "external", "https://maps.google.com/?q=stadium")


def test_switch_to_online_requires_clearing_map(client, admin_headers):
    nid = _create(client, admin_headers, location_type="external", location="ที่จัดงาน",
                  location_map_url="https://maps.google.com/?q=x").json()["id"]
    base = {"title_th": "กิจกรรมทดสอบสถานที่", "kind": "activity", "status": "published"}
    bad = client.put(f"/api/admin/news/{nid}", headers=admin_headers, json={**base, "location_type": "online"})
    assert bad.status_code == 400
    n = _admin_get(client, admin_headers, nid)
    assert n["location_type"] == "external"                    # คำขอที่ไม่ผ่านไม่แก้ข้อมูลใด ๆ
    ok = client.put(f"/api/admin/news/{nid}", headers=admin_headers,
                    json={**base, "location_type": "online", "location": "Zoom", "location_map_url": ""})
    assert ok.status_code == 200
    n = _admin_get(client, admin_headers, nid)
    assert (n["location"], n["location_type"], n["location_map_url"]) == ("Zoom", "online", None)


def test_location_change_is_audited(client, admin_headers):
    nid = _create(client, admin_headers, location_type="campus", location="ห้องสมุด").json()["id"]
    client.put(f"/api/admin/news/{nid}", headers=admin_headers,
               json={"title_th": "กิจกรรมทดสอบสถานที่", "kind": "activity", "status": "published",
                     "location_type": "campus", "location": "โรงอาหาร"})
    logs = client.get("/api/admin/audit", headers=admin_headers).json()
    upd = [a for a in logs if a["entity"] == "news" and a["action"] == "update" and str(a.get("entity_id")) == str(nid)]
    assert upd and "location" in str(upd[0])


def test_editor_edit_of_published_still_goes_to_pending(client, admin_headers, editor_headers):
    nid = _create(client, admin_headers, location_type="campus", location="หอประชุม").json()["id"]
    r = client.put(f"/api/admin/news/{nid}", headers=editor_headers,
                   json={"title_th": "กิจกรรมทดสอบสถานที่", "kind": "activity", "status": "published",
                         "location_type": "campus", "location": "ลานกิจกรรม"})
    assert r.status_code == 200
    n = _admin_get(client, admin_headers, nid)
    assert n["status"] == "pending" and n["location"] == "ลานกิจกรรม"
    assert all(x["id"] != nid for x in client.get("/api/news?limit=30").json())
