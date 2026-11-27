"""24 พ.ย. 2569: นำเข้ารายการให้กล้องจำทีละมาก — จากข่าว/กิจกรรม หรือไฟล์ Excel (แนบรูปเป็น zip ได้)

ลำดับ: หลังบ้านเลือกข่าว / อัปโหลดไฟล์ → (parse) ดูตัวอย่างและข้อผิดพลาด → เบราว์เซอร์แตกรูปเป็นภาพย่อย ~10 แบบ/รูป แล้วแปลงเป็นเวกเตอร์
→ POST batch → สร้างป้าย (ปิดไว้) + รายละเอียด + ภาพตัวอย่าง + แถว "รอตรวจ" → เจ้าหน้าที่ยืนยัน (เปิดใช้งาน) หรือไม่ใช้ (ลบ)
ไม่ฝึกโมเดลอัตโนมัติ · รายการรอตรวจไม่ถูกนำไปฝึก (ai/training._pending_labels) และหุ่นยนต์ไม่ใช้ (active=False)

/api/admin/vision/import/...
  GET  status         เปิดใช้งานไหม + รหัสป้ายที่รอตรวจ
  GET  news           ข่าว/กิจกรรมพร้อมรูป และบอกว่านำเข้าแล้วหรือยัง
  GET  template       ไฟล์ Excel แม่แบบ (แผ่นงานละประเภท ช่องต่างกัน)
  POST parse          อ่าน .xlsx / .csv / .zip → แถวพร้อมข้อผิดพลาด (ยังไม่บันทึก)
  POST batch          บันทึกหลายรายการเป็น "รอตรวจ"
  POST approve        ยืนยัน (ids) · POST reject  ไม่ใช้ (ids, ลบเฉพาะที่ยังรอตรวจ)
สวิตช์: VORA_VISION_IMPORT (ต้องเปิด VORA_VISION_DETAIL ด้วย)
"""
from __future__ import annotations

import csv
import io
import re
import uuid
import zipfile
from datetime import datetime
from pathlib import PurePosixPath
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..ai import vision_items, xlsx_lite
from ..config import settings
from ..db import get_db
from ..models import News, User, VisionClass, VisionItem, VisionPending, VisionSample
from ..security import require
from ..services import audit
from .admin import UPLOAD_DIR

router = APIRouter(prefix="/api/admin/vision/import", tags=["vision-import"])
MAX_ITEMS = 50                      # ต่อการบันทึก 1 ครั้ง
MAX_SAMPLES = 120                   # ภาพตัวอย่างต่อรายการ
MAX_FILE = 60 * 1024 * 1024         # ไฟล์ที่อัปโหลด
MAX_ZIP_IMAGES = 300
MAX_IMAGE = 10 * 1024 * 1024
IMG_EXT = {".png", ".jpg", ".jpeg", ".webp"}
SHEET_NAME = {"sign": "ป้าย", "poster": "โปสเตอร์", "event": "กิจกรรม", "object": "วัตถุ", "product": "ผลงาน"}
NEWS_KIND = {"activity": "event", "news": "poster", "admission": "poster"}
EXAMPLE = {
    "sign": ["ตัวอย่าง: ป้ายหน้าแผนกไอที", "แผนกวิชาเทคโนโลยีสารสนเทศ", "(คำอธิบายป้าย)", "เทคโนโลยีสารสนเทศ", "(อาคาร/ชั้น)", ""],
    "poster": ["ตัวอย่าง: โปสเตอร์รับสมัคร", "(หัวข้อบนโปสเตอร์)", "(รายละเอียด)", "1 ธ.ค. 2569", "15 ธ.ค. 2569", "(สถานที่)", "(ผู้จัด)", "", "", "", "2026-12-15"],
    "event": ["ตัวอย่าง: ภาพกิจกรรมวันไหว้ครู", "(ชื่อกิจกรรม)", "(วันที่จัด)", "(สถานที่)", "", "(รายละเอียด)", ""],
    "object": ["ตัวอย่าง: เครื่องพิมพ์ 3 มิติ", "(ชื่ออุปกรณ์)", "(ใช้ทำอะไร)", "(แผนกที่ใช้)", "", ""],
    "product": ["ตัวอย่าง: ผลงานนักเรียน", "(ชื่อผลงาน)", "(ผู้ผลิต/แผนก)", "(จุดเด่น)", "", "", ""],
}


def _need() -> None:
    if not (settings.vision_import and settings.vision_detail):
        raise HTTPException(404, "การนำเข้าปิดอยู่ (VORA_VISION_IMPORT=0 หรือ VORA_VISION_DETAIL=0)")


def _pending_ids(db: Session) -> list[int]:
    ids = [p.vision_class_id for p in db.query(VisionPending).all()]
    if not ids:
        return []
    return [v.id for v in db.query(VisionClass).filter(VisionClass.id.in_(ids), VisionClass.active.is_(False)).all()]


def _news_images(n: News) -> list[str]:
    out: list[str] = []
    for u in [n.image_url or ""] + [x.strip() for x in (getattr(n, "gallery", "") or "").splitlines()]:
        if u and re.match(r"^(/uploads/|https?://)", u) and u not in out:
            out.append(u)
    return out[: vision_items.MAX_IMAGES]


@router.get("/status")
def status(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    on = settings.vision_import and settings.vision_detail
    return {"enabled": on, "pending": _pending_ids(db) if on else []}


@router.get("/news")
def news_list(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    _need()
    linked = {i.news_id for i in db.query(VisionItem).filter(VisionItem.news_id.isnot(None)).all()}
    rows = db.query(News).filter(News.status != "archived").order_by(News.id.desc()).limit(300).all()
    return [{"id": n.id, "title_th": n.title_th, "kind": n.kind, "status": n.status, "event_date": n.event_date,
             "images": _news_images(n), "suggest_kind": NEWS_KIND.get(n.kind, "poster"), "imported": n.id in linked} for n in rows]


# ---------------------------------------------------------------------------------------------- แม่แบบ Excel
def _headers(kind: str) -> list[str]:
    k = vision_items.KINDS[kind]
    cols = ["ชื่อที่เรียก (display_name)"] + [f"{lab} ({key})" for key, lab, _ in k["fields"]] + ["รูป (images)"]
    if kind in ("poster", "event"):
        cols.append("รหัสข่าวที่ผูก (news_id)")
    return cols


@router.get("/template")
def template(_: User = Depends(require("viewer"))):
    _need()
    howto = [["วิธีใช้แม่แบบนำเข้า \"สอนกล้องจำป้าย\""],
             ["1. แต่ละแผ่นงานคือ 1 ประเภท (ป้าย / โปสเตอร์ / กิจกรรม / วัตถุ / ผลงาน) ช่องไม่เหมือนกัน — กรอกในแผ่นงานที่ตรงประเภท"],
             ["2. 1 แถว = 1 สิ่งที่จะสอน · ช่อง \"ชื่อที่เรียก\" ว่างได้ (จะใช้ชื่อ/หัวข้อแทน)"],
             ["3. แถวที่ขึ้นต้นด้วย \"ตัวอย่าง:\" ระบบจะข้าม — ลบหรือเก็บไว้ก็ได้"],
             ["4. ช่อง \"รูป\" ใส่ชื่อไฟล์รูป (เช่น openhouse.jpg) หลายรูปคั่นด้วย , หรือขึ้นบรรทัดใหม่ แล้วบีบอัด Excel นี้กับรูปทั้งหมดเป็นไฟล์ .zip เดียว"],
             ["   หรือใส่ลิงก์ /uploads/... ที่อัปโหลดไว้แล้ว · ลิงก์ https:// ภายนอกใช้แสดงในป๊อปอัปได้ แต่ใช้สอนกล้องไม่ได้"],
             ["5. รูปแต่ละรูป ระบบจะสร้างภาพย่อย ~10 แบบ (ครอป เอียง ปรับแสง) ให้กล้องจำ · ถ่ายกล้องจริงเสริมภายหลังจะแม่นขึ้น"],
             ["6. \"รหัสข่าวที่ผูก\" (โปสเตอร์/กิจกรรม) = เลขรหัสข่าวในหลังบ้าน ช่องที่เว้นว่างจะใช้ข้อมูลจากข่าวนั้น"],
             ["7. นำเข้าแล้วทุกรายการจะเป็น \"รอตรวจ\" — หุ่นยนต์ยังไม่ใช้จนกว่าจะกดยืนยัน แล้วค่อยกดฝึกโมเดลเอง"],
             ["8. ใส่เฉพาะข้อมูลจริงที่ตรวจสอบแล้ว ไม่ทราบให้เว้นว่าง"]]
    sheets: list[tuple] = [("วิธีใช้", howto, [120])]
    for kind in vision_items.KINDS:
        hdr = _headers(kind)
        ex = EXAMPLE[kind] + [""] * (len(hdr) - len(EXAMPLE[kind]))
        sheets.append((f"{SHEET_NAME[kind]} ({kind})", [hdr, ex[: len(hdr)]], [28] + [24] * (len(hdr) - 1)))
    data = xlsx_lite.write(sheets)
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="vora-vision-import-template.xlsx"'})


# ---------------------------------------------------------------------------------------------- อ่านไฟล์
def _kind_of(text: str) -> Optional[str]:
    t = (text or "").strip().lower()
    m = re.search(r"\(([a-z]+)\)", t)
    if m and m.group(1) in vision_items.KINDS:
        return m.group(1)
    if t in vision_items.KINDS:
        return t
    for k, v in vision_items.KINDS.items():
        if t and (t == v["th"].lower() or t == SHEET_NAME[k] or t.startswith(SHEET_NAME[k])):
            return k
    return None


def _key_of(header: str, kind: str) -> Optional[str]:
    h = (header or "").strip()
    m = re.search(r"\(([a-z_]+)\)\s*$", h)
    key = m.group(1) if m else None
    keys = {f for f, _, _ in vision_items.KINDS[kind]["fields"]} | {"display_name", "images", "news_id", "kind"}
    if key in keys:
        return key
    for f, lab, _ in vision_items.KINDS[kind]["fields"]:
        if h == lab:
            return f
    return {"ชื่อที่เรียก": "display_name", "รูป": "images", "รหัสข่าวที่ผูก": "news_id", "ประเภท": "kind"}.get(h)


def _save_images(z: zipfile.ZipFile) -> dict[str, str]:
    """เก็บรูปใน zip ไว้ที่ /uploads/vision-import/ (ใช้เฉพาะชื่อไฟล์ ไม่ใช้โฟลเดอร์ใน zip)"""
    out: dict[str, str] = {}
    folder = UPLOAD_DIR / "vision-import"
    for info in z.infolist():
        name = PurePosixPath(info.filename.replace("\\", "/")).name
        ext = PurePosixPath(name).suffix.lower()
        if info.is_dir() or "__MACOSX" in info.filename or name.startswith(".") or ext not in IMG_EXT:
            continue
        if len(out) >= MAX_ZIP_IMAGES or info.file_size > MAX_IMAGE:
            continue
        folder.mkdir(parents=True, exist_ok=True)
        fn = f"{datetime.now():%Y%m%d}-{uuid.uuid4().hex[:8]}{ext}"
        (folder / fn).write_bytes(z.read(info))
        out.setdefault(name.lower(), f"/uploads/vision-import/{fn}")
    return out


def _rows_from(sheets: dict[str, list[list[str]]], csv_mode: bool) -> list[tuple[str, int, str, dict[str, str]]]:
    """→ [(แผ่นงาน, เลขแถว Excel, ประเภท, {ช่อง: ค่า})]"""
    out = []
    for sheet, rows in sheets.items():
        sheet_kind = None if csv_mode else _kind_of(sheet)
        if not rows or (not csv_mode and not sheet_kind):
            continue
        header = rows[0]
        for r, row in enumerate(rows[1:], start=2):
            if not any((c or "").strip() for c in row):
                continue
            kind = sheet_kind
            if csv_mode:
                raw_kind = next((row[i] for i, h in enumerate(header) if i < len(row) and _key_of(h, "sign") == "kind"), "")
                kind = _kind_of(raw_kind) or ""
            vals: dict[str, str] = {}
            for i, h in enumerate(header):
                key = _key_of(h, kind) if kind else (_key_of(h, "sign") if _key_of(h, "sign") in ("display_name", "images", "news_id") else None)
                if key and i < len(row) and (row[i] or "").strip():
                    vals[key] = row[i].strip()
            out.append((sheet, r, kind, vals))
    return out


@router.post("/parse")
async def parse(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require("editor"))):
    _need()
    data = await file.read()
    if len(data) > MAX_FILE:
        raise HTTPException(400, "ไฟล์ใหญ่เกิน 60MB")
    name = (file.filename or "").lower()
    images: dict[str, str] = {}
    sheets: dict[str, list[list[str]]] = {}
    csv_mode = False
    try:
        if name.endswith(".zip"):
            z = zipfile.ZipFile(io.BytesIO(data))
            if sum(i.file_size for i in z.infolist()) > 400 * 1024 * 1024:
                raise ValueError("ไฟล์ zip ขยายแล้วใหญ่เกิน 400MB")
            book = next((i for i in z.infolist() if "__MACOSX" not in i.filename and not PurePosixPath(i.filename).name.startswith(("~$", "."))
                         and i.filename.lower().endswith((".xlsx", ".csv"))), None)
            if not book:
                raise ValueError("ไม่พบไฟล์ Excel (.xlsx) หรือ .csv ใน zip")
            raw = z.read(book)
            if book.filename.lower().endswith(".csv"):
                csv_mode = True
                sheets = {"csv": list(csv.reader(io.StringIO(raw.decode("utf-8-sig", errors="replace"))))}
            else:
                sheets = xlsx_lite.read(raw)
            images = _save_images(z)
        elif name.endswith(".xlsx"):
            sheets = xlsx_lite.read(data)
        elif name.endswith(".csv"):
            csv_mode = True
            sheets = {"csv": list(csv.reader(io.StringIO(data.decode("utf-8-sig", errors="replace"))))}
        else:
            raise ValueError("รองรับไฟล์ .xlsx .csv หรือ .zip (Excel + รูป)")
    except (ValueError, zipfile.BadZipFile) as e:
        raise HTTPException(400, str(e))
    news_ids = {n.id for n in db.query(News.id).all()}
    out = []
    for sheet, r, kind, vals in _rows_from(sheets, csv_mode):
        dn = vals.get("display_name", "")
        if dn.startswith("ตัวอย่าง"):
            continue
        errors: list[str] = []
        warnings: list[str] = []
        if not kind:
            errors.append("ไม่ทราบประเภท (ใส่ช่อง \"ประเภท (kind)\" เป็น sign/poster/event/object/product)")
            kind = "sign"
        details = vision_items.clean_details(kind, vals)
        title = vision_items.title_of(kind, details, "")
        news_id = None
        if vals.get("news_id"):
            if kind not in ("poster", "event"):
                warnings.append("ผูกข่าวได้เฉพาะโปสเตอร์/กิจกรรม — ข้ามช่องนี้")
            elif not vals["news_id"].isdigit() or int(vals["news_id"]) not in news_ids:
                errors.append(f"ไม่พบข่าวรหัส {vals['news_id']}")
            else:
                news_id = int(vals["news_id"])
        imgs: list[str] = []
        for tok in [t.strip() for t in re.split(r"[,\n;]+", vals.get("images", "")) if t.strip()]:
            if re.match(r"^(/uploads/|https?://)", tok):
                imgs.append(tok)
                if tok.startswith("http"):
                    warnings.append(f"{tok[:40]}… เป็นลิงก์ภายนอก ใช้แสดงในป๊อปอัปได้ แต่ใช้สอนกล้องไม่ได้")
            elif tok.lower() in images:
                imgs.append(images[tok.lower()])
            else:
                errors.append(f"ไม่พบรูป \"{tok}\"" + (" ใน zip" if images else " (แนบรูปเป็น zip พร้อมไฟล์ Excel)"))
        if not (dn or title):
            errors.append("ต้องมีชื่อที่เรียก หรือ ชื่อ/หัวข้อ")
        if not any(u.startswith("/uploads/") for u in imgs) and not news_id:
            warnings.append("ไม่มีรูปสำหรับสอนกล้อง — ต้องถ่ายด้วยกล้องเพิ่มเอง")
        out.append({"sheet": sheet, "row": r, "kind": kind, "display_name": (dn or title)[:120], "details": details,
                    "images": imgs[: vision_items.MAX_IMAGES], "news_id": news_id, "errors": errors, "warnings": warnings})
    audit(db, user.username, "parse", "vision_import", file.filename or "", rows=len(out), images=len(images))
    db.commit()
    return {"rows": out, "images_found": len(images)}


# ---------------------------------------------------------------------------------------------- บันทึก / ยืนยัน
class ImportItem(BaseModel):
    display_name: str
    kind: str = "sign"
    details: dict[str, Any] = {}
    images: list[str] = []
    news_id: Optional[int] = None
    ref: str = ""
    embeddings: list[list[float]] = []
    thumbnails: list[str] = []


class BatchIn(BaseModel):
    source: str = "excel"                               # news | excel
    items: list[ImportItem] = Field(default_factory=list)


class IdsIn(BaseModel):
    ids: list[int] = Field(default_factory=list)


@router.post("/batch")
def batch(body: BatchIn, db: Session = Depends(get_db), user: User = Depends(require("editor"))):
    _need()
    if not body.items or len(body.items) > MAX_ITEMS:
        raise HTTPException(400, f"จำนวนรายการต่อครั้งต้องอยู่ระหว่าง 1-{MAX_ITEMS}")
    if body.source not in ("news", "excel"):
        raise HTTPException(400, "แหล่งที่มาไม่ถูกต้อง")
    existing = db.query(VisionSample).first()
    dims = {len(existing.embedding)} if existing else set()
    news_ids = {n.id for n in db.query(News.id).all()}
    for i, it in enumerate(body.items, start=1):
        if it.kind not in vision_items.KINDS:
            raise HTTPException(400, f"รายการที่ {i}: ประเภทไม่ถูกต้อง")
        if not it.display_name.strip():
            raise HTTPException(400, f"รายการที่ {i}: ต้องมีชื่อ")
        if len(it.embeddings) > MAX_SAMPLES:
            raise HTTPException(400, f"รายการที่ {i}: ภาพตัวอย่างเกิน {MAX_SAMPLES}")
        if it.news_id is not None and it.news_id not in news_ids:
            raise HTTPException(400, f"รายการที่ {i}: ไม่พบข่าวรหัส {it.news_id}")
        dims |= {len(e) for e in it.embeddings}
    if len(dims) > 1:
        raise HTTPException(400, "ขนาดเวกเตอร์ไม่ตรงกับภาพตัวอย่างที่มีอยู่ (โมเดลกล้องไม่ตรงกัน)")
    created = []
    for it in body.items:
        vc = VisionClass(label=f"imp_{uuid.uuid4().hex[:10]}", display_name=it.display_name.strip()[:120], action="text", active=False)
        db.add(vc)
        db.flush()
        imgs = [u.strip() for u in it.images if isinstance(u, str) and re.match(r"^(/uploads/|https?://)", u.strip())][: vision_items.MAX_IMAGES]
        news_id = it.news_id if it.kind in ("poster", "event") else None
        db.add(VisionItem(vision_class_id=vc.id, kind=it.kind, details=vision_items.clean_details(it.kind, it.details), images=imgs, news_id=news_id))
        for j, e in enumerate(it.embeddings):
            thumb = it.thumbnails[j] if j < len(it.thumbnails) else ""
            db.add(VisionSample(label=vc.label, embedding=[round(float(x), 5) for x in e],
                                thumbnail=thumb[:20000] if thumb.startswith("data:image/") else ""))
        db.add(VisionPending(vision_class_id=vc.id, source=body.source, ref=(it.ref or (f"news:{news_id}" if news_id else ""))[:255], created_by=user.username))
        created.append(vc.id)
    audit(db, user.username, "import", "vision", body.source, n=len(created), ids=created)
    db.commit()
    return {"created": created}


@router.post("/approve")
def approve(body: IdsIn, db: Session = Depends(get_db), user: User = Depends(require("editor"))):
    _need()
    done = []
    for cid in body.ids[:500]:
        p = db.query(VisionPending).filter(VisionPending.vision_class_id == cid).first()
        vc = db.get(VisionClass, cid)
        if not p or not vc:
            continue
        vc.active = True
        db.delete(p)
        done.append(cid)
    audit(db, user.username, "approve", "vision_import", "", ids=done)
    db.commit()
    return {"approved": done, "hint": "ยืนยันแล้ว — กด \"ฝึกโมเดลจำภาพใหม่\" เพื่อให้กล้องจำได้"}


@router.post("/reject")
def reject(body: IdsIn, db: Session = Depends(get_db), user: User = Depends(require("editor"))):
    """ลบเฉพาะรายการที่ยังรอตรวจ (ป้ายที่ยืนยันแล้วต้องลบที่หน้าตั้งค่า ซึ่งต้องเป็นผู้ดูแล)"""
    _need()
    pend = set(_pending_ids(db))
    done = []
    for cid in body.ids[:500]:
        if cid not in pend:
            continue
        vc = db.get(VisionClass, cid)
        db.query(VisionSample).filter(VisionSample.label == vc.label).delete()
        db.query(VisionItem).filter(VisionItem.vision_class_id == cid).delete()
        db.query(VisionPending).filter(VisionPending.vision_class_id == cid).delete()
        db.delete(vc)
        done.append(cid)
    audit(db, user.username, "reject", "vision_import", "", ids=done)
    db.commit()
    return {"rejected": done}
