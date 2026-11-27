"""นำเข้ารายการให้กล้องจำทีละมาก → รอตรวจ (24 พ.ย. 2569)
app/routers/vision_import.py · app/ai/xlsx_lite.py · ai/training._pending_labels"""
import io
import zipfile

import pytest

from app.ai import training, xlsx_lite
from app.config import settings
from app.db import SessionLocal
from app.models import News, VisionClass, VisionItem, VisionPending, VisionSample

PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff"
       b"\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82")


def _dim() -> int:
    with SessionLocal() as db:
        s = db.query(VisionSample).first()
        return len(s.embedding) if s else 8


def _vec(i: int, n: int) -> list[float]:
    return [1.0 if j == i % n else 0.0 for j in range(n)]


def _news(title="ข่าวทดสอบนำเข้า") -> int:
    with SessionLocal() as db:
        n = News(title_th=title, kind="activity", status="published", image_url="/uploads/test-news.jpg", location="หอประชุม")
        db.add(n)
        db.commit()
        return n.id


# ------------------------------------------------------------------ Excel แบบไม่ใช้ openpyxl
def test_xlsx_roundtrip_thai_and_multiple_sheets():
    data = xlsx_lite.write([("แผ่น ก", [["หัว (a)", "หัว (b)"], ["สวัสดี", "", "ค"]]), ("ป้าย (sign)", [["x"], ["1"]])])
    back = xlsx_lite.read(data)
    assert back["แผ่น ก"][1][0] == "สวัสดี" and back["แผ่น ก"][1][2] == "ค" and back["ป้าย (sign)"] == [["x"], ["1"]]


def test_xlsx_read_rejects_non_excel():
    with pytest.raises(ValueError):
        xlsx_lite.read(b"not a zip")


def test_template_has_one_sheet_per_kind(client, editor_headers):
    r = client.get("/api/admin/vision/import/template", headers=editor_headers)
    assert r.status_code == 200 and "spreadsheetml" in r.headers["content-type"]
    sheets = xlsx_lite.read(r.content)
    assert {"ป้าย (sign)", "โปสเตอร์ (poster)", "กิจกรรม (event)", "วัตถุ (object)", "ผลงาน (product)"} <= set(sheets)
    assert "ราคา/ช่องทางซื้อ (price)" in sheets["ผลงาน (product)"][0] and "รหัสข่าวที่ผูก (news_id)" in sheets["โปสเตอร์ (poster)"][0]
    assert "รหัสข่าวที่ผูก (news_id)" not in sheets["ป้าย (sign)"][0]


# ------------------------------------------------------------------ อ่านไฟล์ (ยังไม่บันทึก)
def _book(rows_by_sheet: dict) -> bytes:
    return xlsx_lite.write([(k, v) for k, v in rows_by_sheet.items()])


def test_parse_xlsx_skips_examples_and_reports_errors(client, editor_headers):
    nid = _news()
    book = _book({
        "ป้าย (sign)": [["ชื่อที่เรียก (display_name)", "ชื่อป้าย (name)", "รูป (images)"],
                        ["ตัวอย่าง: ข้าม", "x", ""], ["", "ป้ายห้องสมุด", "/uploads/lib.jpg"], ["", "", ""], ["", "", "ไม่มีไฟล์.jpg"]],
        "โปสเตอร์ (poster)": [["ชื่อที่เรียก (display_name)", "หัวข้อ (title)", "ราคา (price)", "รหัสข่าวที่ผูก (news_id)"],
                             ["โปสเตอร์ A", "งาน A", "99", str(nid)], ["โปสเตอร์ B", "งาน B", "", "999999"]],
    })
    r = client.post("/api/admin/vision/import/parse", headers=editor_headers,
                    files={"file": ("t.xlsx", book, "application/octet-stream")})
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    assert [x["display_name"] for x in rows] == ["ป้ายห้องสมุด", "", "โปสเตอร์ A", "โปสเตอร์ B"]
    lib, empty, a, b = rows
    assert lib["kind"] == "sign" and lib["details"] == {"name": "ป้ายห้องสมุด"} and lib["images"] == ["/uploads/lib.jpg"] and not lib["errors"]
    assert any("ไม่พบรูป" in e for e in empty["errors"]) and any("ชื่อ" in e for e in empty["errors"])
    assert a["details"] == {"title": "งาน A"} and a["news_id"] == nid and not a["errors"]      # ช่องที่ไม่ใช่ของประเภทถูกตัด
    assert any("999999" in e for e in b["errors"])


def test_parse_zip_maps_image_names(client, editor_headers):
    book = _book({"ผลงาน (product)": [["ชื่อ (name)", "รูป (images)"], ["น้ำพริกทดสอบ", "A.PNG, https://example.com/x.jpg"]]})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("ชุด/import.xlsx", book)
        z.writestr("ชุด/รูป/a.png", PNG)
        z.writestr("__MACOSX/ชุด/._a.png", b"x")
        z.writestr("../../evil.png", PNG)
    r = client.post("/api/admin/vision/import/parse", headers=editor_headers, files={"file": ("t.zip", buf.getvalue(), "application/zip")})
    assert r.status_code == 200, r.text
    row = r.json()["rows"][0]
    assert row["kind"] == "product" and row["images"][0].startswith("/uploads/vision-import/") and row["images"][1].startswith("https://")
    assert not row["errors"] and any("ภายนอก" in w for w in row["warnings"])
    assert ".." not in row["images"][0]


def test_parse_csv_needs_kind_column(client, editor_headers):
    csv_text = "ประเภท (kind),ชื่อ (name),หัวข้อ (title)\nproduct,ผลงาน CSV,\nposter,,โปสเตอร์ CSV\nยานอวกาศ,x,\n"
    r = client.post("/api/admin/vision/import/parse", headers=editor_headers, files={"file": ("t.csv", csv_text.encode("utf-8-sig"), "text/csv")})
    rows = r.json()["rows"]
    assert rows[0]["kind"] == "product" and rows[0]["details"] == {"name": "ผลงาน CSV"}
    assert rows[1]["kind"] == "poster" and rows[1]["display_name"] == "โปสเตอร์ CSV"
    assert rows[2]["errors"]


def test_parse_rejects_other_files_and_viewer(client, editor_headers):
    assert client.post("/api/admin/vision/import/parse", headers=editor_headers, files={"file": ("x.exe", b"MZ", "x")}).status_code == 400


# ------------------------------------------------------------------ บันทึก → รอตรวจ → ยืนยัน/ไม่ใช้
def test_batch_creates_pending_not_trained_until_approved(client, editor_headers):
    nid = _news("ข่าวสำหรับ batch")
    n = _dim()
    items = [{"display_name": "นำเข้า 1", "kind": "event", "details": {"title": "กิจกรรม 1", "price": "x"}, "images": ["/uploads/e.jpg", "javascript:x"],
              "news_id": nid, "embeddings": [_vec(i, n) for i in range(4)], "thumbnails": ["data:image/jpeg;base64,AA"] * 4},
             {"display_name": "นำเข้า 2", "kind": "sign", "details": {"name": "ป้าย 2"}, "news_id": nid,
              "embeddings": [_vec(i + 1, n) for i in range(4)], "thumbnails": ["https://evil/x.png"] * 4}]
    r = client.post("/api/admin/vision/import/batch", headers=editor_headers, json={"source": "news", "items": items})
    assert r.status_code == 200, r.text
    a, b = r.json()["created"]
    st = client.get("/api/admin/vision/import/status", headers=editor_headers).json()
    assert st["enabled"] and {a, b} <= set(st["pending"])
    with SessionLocal() as db:
        va, vb = db.get(VisionClass, a), db.get(VisionClass, b)
        assert not va.active and va.label.startswith("imp_")
        ia = db.query(VisionItem).filter(VisionItem.vision_class_id == a).one()
        assert ia.details == {"title": "กิจกรรม 1"} and ia.images == ["/uploads/e.jpg"] and ia.news_id == nid
        assert db.query(VisionItem).filter(VisionItem.vision_class_id == b).one().news_id is None      # ป้ายผูกข่าวไม่ได้
        assert db.query(VisionSample).filter(VisionSample.label == vb.label).first().thumbnail == ""   # ภาพย่อแปลกปลอมถูกตัด
        assert {va.label, vb.label} <= training._pending_labels(db)
    news = client.get("/api/admin/vision/import/news", headers=editor_headers).json()
    assert next(x for x in news if x["id"] == nid)["imported"] is True
    assert next(x for x in news if x["id"] == nid)["suggest_kind"] == "event"
    # ไม่ใช้ b · ยืนยัน a
    assert client.post("/api/admin/vision/import/reject", headers=editor_headers, json={"ids": [b]}).json()["rejected"] == [b]
    assert client.post("/api/admin/vision/import/approve", headers=editor_headers, json={"ids": [a]}).json()["approved"] == [a]
    with SessionLocal() as db:
        assert db.get(VisionClass, b) is None and not db.query(VisionSample).filter(VisionSample.label == vb.label).count()
        assert db.get(VisionClass, a).active and not db.query(VisionPending).filter(VisionPending.vision_class_id == a).count()
        assert va.label not in training._pending_labels(db)
    # ยืนยันแล้วลบผ่าน reject ไม่ได้
    assert client.post("/api/admin/vision/import/reject", headers=editor_headers, json={"ids": [a]}).json()["rejected"] == []


def test_batch_validation(client, editor_headers):
    n = _dim()
    bad = [{"display_name": "x", "kind": "spaceship"}]
    assert client.post("/api/admin/vision/import/batch", headers=editor_headers, json={"items": bad}).status_code == 400
    assert client.post("/api/admin/vision/import/batch", headers=editor_headers, json={"items": []}).status_code == 400
    wrong_dim = [{"display_name": "x", "kind": "sign", "embeddings": [[0.1] * (n + 3)]}]
    assert client.post("/api/admin/vision/import/batch", headers=editor_headers, json={"items": wrong_dim}).status_code == 400
    assert client.post("/api/admin/vision/import/batch", headers=editor_headers,
                       json={"items": [{"display_name": "x", "kind": "poster", "news_id": 987654}]}).status_code == 400


def test_switch_off_hides_import(client, editor_headers, monkeypatch):
    monkeypatch.setattr(settings, "vision_import", False)
    assert client.get("/api/admin/vision/import/status", headers=editor_headers).json() == {"enabled": False, "pending": []}
    assert client.get("/api/admin/vision/import/news", headers=editor_headers).status_code == 404
    assert client.post("/api/admin/vision/import/batch", headers=editor_headers, json={"items": [{"display_name": "x"}]}).status_code == 404
