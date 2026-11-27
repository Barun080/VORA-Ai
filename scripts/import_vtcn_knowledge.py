"""นำเข้าความรู้วิทยาลัยเทคนิคน่าน + อาชีวศึกษาไทย เข้าฐานความรู้ AI ของ VORA และซ่อนข้อมูลสาธิต

ที่มา: data/knowledge/vtcn/vora_import_knowledge.csv (สกัดจาก รายงานอาชีวศึกษาไทย_เพิ่มเติมวิทยาลัยเทคนิคน่าน-2.pdf)

    python scripts\\import_vtcn_knowledge.py --dry-run   # ดูว่าจะเปลี่ยนอะไร (ไม่แก้ฐานข้อมูล)
    python scripts\\import_vtcn_knowledge.py             # นำเข้า (ถามยืนยันก่อน)
    python scripts\\import_vtcn_knowledge.py --undo      # ย้อนกลับทุกอย่างที่สคริปต์นี้ทำ

สิ่งที่ทำ (แตะเฉพาะข้อมูลสาธิตที่ยังตรงกับ seed.py เท่านั้น ข้อมูลที่เจ้าหน้าที่เพิ่ม/แก้เองไม่ถูกแตะ):
  1. เพิ่ม FAQ เทคนิคน่าน/อาชีวศึกษาไทย และคำตอบสำรอง "ยังไม่พบข้อมูล" สำหรับคำถามทั่วไป ในสถานะ "อนุมัติแล้ว"
  2. ซ่อน FAQ สาธิต (เปลี่ยนเป็น "ปฏิเสธ") ยกเว้นข้อแนะนำตัวหุ่นยนต์
  3. ซ่อนสาขาสาธิต 7 สาขา และข่าวสาธิต (เปลี่ยนเป็น "archived")
  4. ปิดตารางประกาศสาธิต 3 รายการ (คงการเดินประชาสัมพันธ์ไว้)
  5. ป้ายสาขาที่กล้องจำได้ 4 ป้าย เปลี่ยนให้พูดข้อมูลแผนกของเทคนิคน่านแทนสาขาสาธิต
  6. ปิดชุดทดสอบสาธิต 20 ข้อ และเพิ่มชุดทดสอบเทคนิคน่าน
  7. ตั้งชื่อสถานศึกษาและข้อความติดต่อเป็นวิทยาลัยเทคนิคน่าน
ทุกการเปลี่ยนแปลงบันทึกค่าเดิมไว้ใน data/knowledge/vtcn/undo-*.json และ audit log
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db import DIALECT, SessionLocal, engine, wait_for_db  # noqa: E402
from app.models import EvalCase, KnowledgeItem, News, Program, Schedule, SettingKV, VisionClass  # noqa: E402
from app.schema_guard import check_schema  # noqa: E402
from app import seed as S  # noqa: E402
from app.services import all_settings, audit, set_setting  # noqa: E402

KB_DIR = ROOT / "data" / "knowledge" / "vtcn"
CSV_FILE = KB_DIR / "vora_import_knowledge.csv"
FALLBACK_FILE = KB_DIR / "vora_system_fallback.csv"   # คำตอบ \"ยังไม่พบข้อมูล\" สำหรับคำถามทั่วไป (ห้องน้ำ โรงอาหาร ฯลฯ)
ROBOT_ALTS = ["ใครสร้างเธอ", "เธอทำงานยังไง", "หุ่นยนต์ตัวนี้ทำอะไรได้"]
TAG = "import:vtcn-pdf"

SETTINGS = {
    "school_name_th": "วิทยาลัยเทคนิคน่าน",
    "contact_th": "ติดต่อวิทยาลัยเทคนิคน่าน ถนนรอบกำแพงเมืองทิศตะวันตก ตำบลในเวียง อำเภอเมือง จังหวัดน่าน หรือเว็บไซต์ technicnan.ac.th ค่ะ",
    "contact_en": "Please contact the college via its website technicnan.ac.th.",
}

# ป้ายสาธิต -> แผนกของเทคนิคน่านที่ชื่อตรงกัน (คำตอบนำมาจาก FAQ แผนกนั้นใน CSV)
VISION_MAP = {
    "sign_it": "แผนกเทคโนโลยีสารสนเทศเรียนอะไร",
    "sign_elec": "ช่างไฟฟ้าเรียนอะไร",
    "sign_auto": "แผนกช่างยนต์เรียนอะไร",
    "sign_mecha": "เมคคาทรอนิกส์และหุ่นยนต์เหมาะกับใคร",
}

# ชุดทดสอบใหม่: (คำถาม, คำที่ต้องมีในคำตอบ คั่นด้วย |, ต้องตอบได้)
EVAL = [
    ("เทคนิคน่านมีแผนกอะไรบ้าง", "ช่างยนต์|อาหารและโภชนาการ", True),
    ("หนูชอบคอมพิวเตอร์ควรเรียนอะไรดี", "เทคโนโลยีคอมพิวเตอร์", True),
    ("ชอบรถยนต์มากเลยเรียนอะไรดี", "ช่างยนต์", True),
    ("อยากทำหุ่นยนต์ต้องเรียนแผนกไหน", "เมคคาทรอนิกส์", True),
    ("ช่างเชื่อมเรียนอะไรบ้าง", "กระบวนการเชื่อม", True),
    ("เรียนบัญชีจบไปทำอะไร", "พนักงานบัญชี", True),
    ("ชอบทำกับข้าวเรียนอะไร", "อาหารและโภชนาการ", True),
    ("ค่าเทอมเท่าไหร่ครับ", "ไม่พบข้อมูลยืนยัน", True),
    ("รับสมัครวันไหน", "ประกาศรับสมัครล่าสุด", True),
    ("เบอร์โทรวิทยาลัย", "ไม่พบข้อมูลยืนยัน", True),
    ("วิทยาลัยอยู่ที่ไหน", "ถนนรอบกำแพงเมืองทิศตะวันตก", True),
    ("มีทุนไหมคะ", "มูลนิธิ", True),
    ("เทคนิคน่านมีทวิภาคีไหม", "ทวิภาคี", True),
    ("ผลงานสิ่งประดิษฐ์ของวิทยาลัย", "ปลาดุก", True),
    ("ผลประเมินวิทยาลัย", "ดีเลิศ", True),
    ("ปวส คืออะไร", "ประกาศนียบัตรวิชาชีพชั้นสูง", True),
    ("นักเรียนอาชีวะทั้งประเทศกี่คน", "860,000", True),
    ("สาขาไหนคนสมัครเยอะที่สุด", "ช่างยนต์", True),
    ("ทวิภาคีคืออะไร", "สถานประกอบการ", True),
    ("ห้องน้ำอยู่ไหน", "ยังไม่พบข้อมูล", True),
    ("ใครสร้างเธอ", "วอร่า", True),
]


def load_csv() -> list[dict]:
    rows = []
    for f in (CSV_FILE, FALLBACK_FILE):
        if not f.exists():
            sys.exit(f"ไม่พบไฟล์ {f}")
        part = list(csv.DictReader(f.open(encoding="utf-8-sig")))
        if not part or not {"category", "question", "alt_questions", "answer_th"} <= set(part[0]):
            sys.exit(f"รูปแบบ CSV ไม่ถูกต้อง: {f.name}")
        rows += part
    return rows


def plan(db, rows):
    demo_kb_q = {k[1] for k in S.KNOWLEDGE}
    demo_prog = {(p["code"], p["name_th"]) for p in S.PROGRAMS}
    demo_news = {n["title_th"] for n in S.NEWS}
    demo_sched = {"ประกาศรับสมัครเรียน ทุก 30 นาที", "ข่าวเด่นช่วงเช้าและพักเที่ยง", "ชวนร่วมงาน Open House"}
    demo_eval = {e[0] for e in S.EVAL_CASES}
    p = {
        "kb": [k for k in db.query(KnowledgeItem).filter(KnowledgeItem.status == "approved").all()
               if k.question in demo_kb_q and k.category != "robot"],
        "programs": [x for x in db.query(Program).filter(Program.status == "published").all() if (x.code, x.name_th) in demo_prog],
        "news": [n for n in db.query(News).filter(News.status == "published").all() if n.title_th in demo_news],
        "schedules": [s for s in db.query(Schedule).filter(Schedule.active.is_(True)).all() if s.name in demo_sched],
        "eval": [e for e in db.query(EvalCase).filter(EvalCase.active.is_(True)).all() if e.question in demo_eval],
        "vision": [v for v in db.query(VisionClass).all() if v.label in VISION_MAP and v.action == "program"],
        "robot": [k for k in db.query(KnowledgeItem).filter(KnowledgeItem.status == "approved", KnowledgeItem.category == "robot").all()
                  if k.question in demo_kb_q][:1],
    }
    by_q = {r["question"]: r for r in rows}
    missing = [q for q in VISION_MAP.values() if q not in by_q]
    if missing:
        sys.exit(f"CSV ไม่มีคำถามสำหรับป้ายกล้อง: {missing}")
    return p, by_q


def show(p, rows, cur):
    print(f"\nฐานข้อมูล: {DIALECT}")
    print(f"  + เพิ่ม FAQ เทคนิคน่าน/อาชีวศึกษาไทย + คำตอบสำรอง  {len(rows)} ข้อ (อนุมัติแล้ว)")
    if p["robot"]:
        print(f"  ~ เพิ่มคำถามรูปแบบอื่นให้ FAQ แนะนำตัวหุ่นยนต์   " + ", ".join(ROBOT_ALTS))
    print(f"  - ซ่อน FAQ สาธิต                            {len(p['kb'])} ข้อ  " + ", ".join(k.question for k in p["kb"]))
    print(f"  - ซ่อนสาขาสาธิต                             {len(p['programs'])} สาขา  " + ", ".join(x.name_th for x in p["programs"]))
    print(f"  - ซ่อนข่าวสาธิต                             {len(p['news'])} ข่าว")
    print(f"  - ปิดตารางประกาศสาธิต                       {len(p['schedules'])} รายการ  " + ", ".join(s.name for s in p["schedules"]))
    print(f"  ~ ป้ายกล้องพูดข้อมูลแผนกเทคนิคน่าน           {len(p['vision'])} ป้าย  " + ", ".join(v.label for v in p["vision"]))
    print(f"  - ปิดชุดทดสอบสาธิต                          {len(p['eval'])} ข้อ")
    print(f"  + เพิ่มชุดทดสอบเทคนิคน่าน                   {len(EVAL)} ข้อ")
    for k, v in SETTINGS.items():
        print(f"  ~ ค่าตั้ง {k}: \"{cur.get(k)}\" -> \"{v}\"")


def apply(db, rows, p, by_q):
    undo = {"tag": TAG, "at": datetime.now().isoformat(timespec="seconds"), "db": DIALECT,
            "added_knowledge": [], "added_eval": [], "kb": [], "programs": [], "news": [], "schedules": [],
            "eval": [], "vision": [], "robot": [], "settings": {}}
    for r in rows:
        k = KnowledgeItem(kind="faq", category=(r["category"] or "general").strip(), question=r["question"].strip(),
                          alt_questions=(r.get("alt_questions") or "").replace("|", "\n"), answer_th=r["answer_th"].strip(),
                          answer_en=(r.get("answer_en") or "").strip(), source="import", status="approved",
                          created_by=TAG, approved_by=TAG)
        db.add(k)
        db.flush()
        undo["added_knowledge"].append(k.id)
    for k in p["robot"]:
        undo["robot"].append([k.id, k.alt_questions])
        have = set(k.alt_questions.splitlines())
        k.alt_questions = "\n".join([k.alt_questions] + [a for a in ROBOT_ALTS if a not in have])
    for k in p["kb"]:
        undo["kb"].append([k.id, k.status])
        k.status = "rejected"
    for x in p["programs"]:
        undo["programs"].append([x.id, x.status])
        x.status = "archived"
    for n in p["news"]:
        undo["news"].append([n.id, n.status])
        n.status = "archived"
    for s in p["schedules"]:
        undo["schedules"].append([s.id, s.active])
        s.active = False
    for v in p["vision"]:
        undo["vision"].append([v.id, v.action, v.target_id, v.response_th, v.response_en])
        v.action, v.target_id = "text", None
        v.response_th, v.response_en = by_q[VISION_MAP[v.label]]["answer_th"], ""
    for e in p["eval"]:
        undo["eval"].append([e.id, e.active])
        e.active = False
    for q, kw, ans in EVAL:
        e = EvalCase(question=q, expected_intent="", expected_keywords=kw, expect_answered=ans, lang="th")
        db.add(e)
        db.flush()
        undo["added_eval"].append(e.id)
    for key, val in SETTINGS.items():
        row = db.get(SettingKV, key)
        undo["settings"][key] = {"exists": bool(row), "value": row.value if row else None}
        set_setting(db, key, val)
    audit(db, "import-script", "import", "knowledge", TAG, added=len(rows), hidden_demo_kb=len(p["kb"]),
          hidden_programs=len(p["programs"]), hidden_news=len(p["news"]), source=str(CSV_FILE.name))
    db.commit()
    path = KB_DIR / f"undo-{datetime.now():%Y%m%d-%H%M%S}.json"
    path.write_text(json.dumps(undo, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    return path


def do_undo(db):
    files = sorted(KB_DIR.glob("undo-*.json"))
    if not files:
        sys.exit("ไม่พบไฟล์ย้อนกลับ (undo-*.json) — ยังไม่เคยนำเข้า")
    u = json.loads(files[-1].read_text(encoding="utf-8"))
    print(f"ย้อนกลับตาม {files[-1].name}")
    n = db.query(KnowledgeItem).filter(KnowledgeItem.id.in_(u["added_knowledge"]), KnowledgeItem.created_by == TAG).delete(synchronize_session=False)
    m = db.query(EvalCase).filter(EvalCase.id.in_(u["added_eval"])).delete(synchronize_session=False)
    for i, st in u["kb"]:
        if (k := db.get(KnowledgeItem, i)):
            k.status = st
    for i, alts in u.get("robot", []):
        if (k := db.get(KnowledgeItem, i)):
            k.alt_questions = alts
    for i, st in u["programs"]:
        if (x := db.get(Program, i)):
            x.status = st
    for i, st in u["news"]:
        if (x := db.get(News, i)):
            x.status = st
    for i, act in u["schedules"]:
        if (x := db.get(Schedule, i)):
            x.active = act
    for i, act in u["eval"]:
        if (x := db.get(EvalCase, i)):
            x.active = act
    for i, action, target, r_th, r_en in u["vision"]:
        if (v := db.get(VisionClass, i)):
            v.action, v.target_id, v.response_th, v.response_en = action, target, r_th, r_en
    for key, s in u["settings"].items():
        row = db.get(SettingKV, key)
        if s["exists"]:
            set_setting(db, key, s["value"])
        elif row:
            db.delete(row)
    audit(db, "import-script", "undo_import", "knowledge", TAG, removed=n)
    db.commit()
    files[-1].rename(files[-1].with_suffix(".undone.json"))
    print(f"ลบ FAQ ที่นำเข้า {n} ข้อ ลบชุดทดสอบที่เพิ่ม {m} ข้อ และคืนค่าข้อมูลสาธิตแล้ว")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--undo", action="store_true")
    ap.add_argument("--yes", action="store_true", help="ไม่ถามยืนยัน")
    a = ap.parse_args()
    wait_for_db(30)
    check_schema(engine)
    db = SessionLocal()
    try:
        if a.undo:
            do_undo(db)
        else:
            if db.query(KnowledgeItem).filter(KnowledgeItem.created_by == TAG).first():
                sys.exit("นำเข้าไปแล้ว ถ้าต้องการนำเข้าใหม่ให้รัน --undo ก่อน")
            rows = load_csv()
            p, by_q = plan(db, rows)
            show(p, rows, all_settings(db))
            if a.dry_run:
                print("\n(--dry-run: ยังไม่ได้แก้ฐานข้อมูล)")
                return
            if not a.yes and input("\nยืนยันนำเข้า? พิมพ์ y แล้วกด Enter: ").strip().lower() != "y":
                print("ยกเลิก")
                return
            path = apply(db, rows, p, by_q)
            print(f"\nนำเข้าเสร็จแล้ว · ไฟล์ย้อนกลับ: {path.relative_to(ROOT)}")
        print("\n>>> ปิดหน้าต่าง start.bat แล้วเปิดใหม่ เพื่อให้ VORA โหลดฐานความรู้ใหม่ <<<")
    finally:
        db.close()


if __name__ == "__main__":
    main()
