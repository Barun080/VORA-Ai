"""นำเข้า 17 แผนกของวิทยาลัยเทคนิคน่านเป็น "สาขา" (ตาราง programs) สำหรับพรีเซนเทชันสาขาบนหน้าจอหุ่นยนต์ — 11 พ.ย. 2569

ที่มา: data/knowledge/vtcn/vtcn_knowledge_bundle.json (Knowledge Items KI-VTCN-DEPT-*) ซึ่งสกัดจาก
"รายงานอาชีวศึกษาไทย_เพิ่มเติมวิทยาลัยเทคนิคน่าน-2.pdf" หน้า 9–10
  · ชื่อแผนกมาจากเว็บไซต์วิทยาลัย · เหมาะกับใคร / เรียนฝึก / อาชีพตัวอย่าง = "คำอธิบายแนะแนว" ไม่ใช่หลักสูตรทางการ
  · ไม่ระบุระดับที่เปิดสอน (เอกสารไม่ได้ระบุ) → level ว่าง
  · ส่วนที่ PDF อ่านไม่ได้ (เช่น [คำละติน ~2 ตัวอักษรอ่านไม่ได้]) ถูกตัดทิ้ง ไม่เดาคำ
  · ภาษาอังกฤษ = คำแปลของข้อความเดียวกัน (ทีมผู้พัฒนาแปล)
  · ไม่มีรูปภาพจริง → เจ้าหน้าที่เพิ่มภาพหลัก/ภาพบรรยากาศในหลังบ้าน > หลักสูตร/สาขา ได้ภายหลัง

ต้องรัน migrate.bat upgrade (ขั้น 0002) ก่อน

    python scripts\\import_vtcn_programs.py --dry-run   # ดูรายการที่จะเพิ่ม (ไม่แก้ฐานข้อมูล)
    python scripts\\import_vtcn_programs.py             # นำเข้า (ข้ามรหัสที่มีอยู่แล้ว)
    python scripts\\import_vtcn_programs.py --undo      # ลบเฉพาะสาขาที่สคริปต์นี้เพิ่ม
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

BUNDLE = ROOT / "data" / "knowledge" / "vtcn" / "vtcn_knowledge_bundle.json"
UNDO = Path(__import__("os").environ.get("VORA_PROGRAM_UNDO", str(ROOT / "data" / "knowledge" / "vtcn" / "undo-programs.json")))
PREFIX = "VTCN-"
GROUP_EN = {"กลุ่มช่างอุตสาหกรรมและเทคโนโลยี": "Industrial & Technology", "กลุ่มบริหารธุรกิจและบริการ": "Business & Services"}

# คำแปลภาษาอังกฤษ (ชื่อ, เหมาะกับ, เรียนฝึก, อาชีพตัวอย่าง) + คำค้นเพิ่มเติม (ช่วยให้ AI จับชื่อแผนกในคำถาม)
EN = {
    "AUTO": ("Automotive Mechanics", "People who love cars, engines and hands-on problem solving.",
             "Inspecting, maintaining and repairing vehicle engine systems.", "Auto mechanic, vehicle service technician.", "ช่างยนต์,ซ่อมรถ"),
    "EV": ("Electric Vehicle Technology", "People interested in cars, batteries, motors and new technology.",
           "Electric drive systems, batteries, control systems and safety.", "Vehicle service technician, automotive electrical inspector.", "ยานยนต์ไฟฟ้า,รถยนต์ไฟฟ้า"),
    "MACHINE": ("Machine Shop Technology", "People who like machines, measuring and precise work.",
                "Machine tools, parts manufacturing, reading drawings and machining.", "Machine tool technician, production technician.", "ช่างกลโรงงาน,กลโรงงาน"),
    "WELD": ("Welding and Metal Fabrication", "People who enjoy craftwork, can focus and work carefully.",
             "Welding processes, assembling workpieces and inspecting welds.", "Welder, metal structure fitter.", "ช่างเชื่อม,งานเชื่อม"),
    "POWER": ("Electrical Power", "People interested in electrical circuits, installation and step-by-step troubleshooting.",
              "Power systems, wiring, motors, control panels and safety.", "Electrician, electrical maintenance technician.", "ช่างไฟฟ้ากำลัง,ไฟฟ้ากำลัง,ช่างไฟ"),
    "ELEC": ("Electronics", "People who like circuits, devices and finding the cause of problems.",
             "Reading circuits, using measuring tools, assembling and repairing circuits.", "Electronics technician, device repair technician.", "ช่างอิเล็กทรอนิกส์,อิเล็กทรอนิกส์"),
    "CONST": ("Construction", "People who like designing, measuring, reading plans and seeing real results.",
              "Drafting, surveying, construction materials and building processes.", "Construction worker, assistant site supervisor, draftsperson.", "ช่างก่อสร้าง,ก่อสร้าง"),
    "COMPUTER": ("Computer Technology", "People who like computers, devices and solving network problems.",
                 "Hardware, operating systems, networks and system administration.", "Computer technician, network technician.", "เทคโนโลยีคอมพิวเตอร์,ช่างคอม"),
    "MECHA": ("Mechatronics and Robotics", "People interested in robots, automated machines and control systems.",
              "Combining mechanics, electrical, electronics, sensors and control systems.", "Automation technician, assistant robotics technician.", "เมคคาทรอนิกส์"),
    "BASIC": ("Basic Technical Studies", "People who like technical work and want to build basic skills first.",
              "Basic technical skills and using tools safely.", "A foundation for specialised technical work.", "เทคนิคพื้นฐาน"),
    "INDUS": ("Industrial Technology", "People who like solving factory problems and many kinds of technical work.",
              "Industrial technical work and looking after production processes.", "Industrial technician, maintenance assistant.", "เทคนิคอุตสาหกรรม"),
    "MARKETING": ("Marketing", "People who like communicating, presenting, creating campaigns and understanding customers.",
                  "Sales, market analysis, promotion and online marketing.", "Marketing staff, online store manager, salesperson.", "การตลาด"),
    "OFFICE": ("Office Management", "People who like organising documents, coordinating and planning.",
               "Office work, documents, office software and coordination.", "Office officer, secretary, coordinator.", "การจัดการสำนักงาน,งานสำนักงาน"),
    "ACCOUNT": ("Accounting", "People who are careful, thorough and like numbers and organised data.",
                "Bookkeeping, financial documents, tax and accounting software.", "Accounting clerk, finance officer, accounting office assistant.", "การบัญชี,บัญชี"),
    "IT": ("Information Technology", "People who like technology, digital systems and solving problems with computers.",
           "Information systems basics, software, data and digital services.", "Assistant system administrator, assistant web developer.", "เทคโนโลยีสารสนเทศ,ไอที"),
    "DIGIBIZ": ("Digital Business Technology", "People interested in online business, platforms and using technology in business.",
                "E-commerce, data management and digital business tools.", "Online store manager.", "ธุรกิจดิจิทัล,เทคโนโลยีธุรกิจดิจิทัล"),
    "FOOD": ("Food and Nutrition", "People who love cooking, trying recipes and care about cleanliness.",
             "Cooking, preparing ingredients, food sanitation and nutrition.", "Kitchen assistant, cook, food business owner.", "อาหารและโภชนาการ"),
}
_UNREADABLE = re.compile(r"\S*\[[^\]]*\]\S*")


def clean(s: str) -> str:
    """ตัดส่วนที่ PDF อ่านไม่ได้ทั้งคำ (ไม่เดาคำแทน) และช่องว่างซ้ำ"""
    return re.sub(r"\s+", " ", _UNREADABLE.sub("", s or "")).strip()


def parse(item: dict) -> dict:
    """'แผนกX (กลุ่ม…) — คำอธิบายแนะแนว: เหมาะกับ… · เรียนฝึก: … · อาชีพตัวอย่าง: …'"""
    content = item["content"]
    m = re.match(r"แผนก(.+?)\s*\((.+?)\)\s*—", content)
    if not m:
        raise ValueError(f"รูปแบบไม่ตรง: {item['knowledge_id']}")
    parts = dict(re.findall(r"(เหมาะกับ|เรียนฝึก|อาชีพตัวอย่าง):?\s*([^·]+)", content))
    suits = clean(parts.get("เหมาะกับ", ""))
    return {"name_th": m.group(1).strip(), "group": m.group(2).strip(),
            "suits_th": f"เหมาะกับ{suits}" if suits else "",
            "learn_th": clean(parts.get("เรียนฝึก", "")),
            "careers_th": clean(parts.get("อาชีพตัวอย่าง", ""))}


def build() -> list[dict]:
    data = json.loads(BUNDLE.read_text(encoding="utf-8"))
    out = []
    for it in data["part2_knowledge_items"]:
        kid = it.get("knowledge_id", "")
        if not kid.startswith("KI-VTCN-DEPT-"):
            continue
        key = kid.rsplit("-", 1)[-1]
        p = parse(it)
        name_en, suits_en, learn_en, careers_en, kw = EN[key]
        out.append(dict(code=PREFIX + key, level="", department=p["group"], name_th=p["name_th"], name_en=name_en,
                        description_th=p["learn_th"], description_en=learn_en, careers_th=p["careers_th"], careers_en=careers_en,
                        suits_th=p["suits_th"], suits_en=suits_en, keywords=kw, image_url="", video_url="", gallery="",
                        status="published"))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--undo", action="store_true")
    a = ap.parse_args()
    rows = build()
    if a.dry_run:
        for r in rows:
            print(f"{r['code']:<16} {r['name_th']:<28} | เหมาะกับ: {r['suits_th'][8:60]}… | เรียน: {r['description_th'][:50]}… | อาชีพ: {r['careers_th']}")
        print(f"\nรวม {len(rows)} สาขา (ยังไม่แก้ฐานข้อมูล)")
        return 0

    from app.db import SessionLocal, wait_for_db  # noqa: E402
    from app.models import Program  # noqa: E402
    from app.schema_guard import check_schema  # noqa: E402
    from app.db import engine  # noqa: E402
    wait_for_db(30)
    check_schema(engine)          # ยังไม่ได้ migrate.bat upgrade → หยุดพร้อมบอกวิธีแก้
    with SessionLocal() as db:
        if a.undo:
            ids = json.loads(UNDO.read_text(encoding="utf-8")).get("added", []) if UNDO.exists() else []
            n = db.query(Program).filter(Program.id.in_(ids), Program.code.like(PREFIX + "%")).delete(synchronize_session=False) if ids else 0
            db.commit()
            print(f"ลบสาขาที่นำเข้า {n} สาขา")
            return 0
        have = {c for (c,) in db.query(Program.code).all()}
        added = []
        for r in rows:
            if r["code"] in have:
                continue
            p = Program(**r)
            db.add(p)
            db.flush()
            added.append(p.id)
        db.commit()
        prev = json.loads(UNDO.read_text(encoding="utf-8")).get("added", []) if UNDO.exists() else []
        UNDO.write_text(json.dumps({"added": prev + added}, ensure_ascii=False), encoding="utf-8")
        print(f"เพิ่ม {len(added)} สาขา (ข้ามที่มีอยู่แล้ว {len(rows) - len(added)})")
        print("ขั้นต่อไป: เปิด start.bat ใหม่ แล้วดูที่หน้าจอหุ่นยนต์ > สาขาวิชา · เพิ่มภาพได้ที่หลังบ้าน > หลักสูตร/สาขา")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
