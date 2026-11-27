"""ปิดใช้ "ข้อมูลตัวอย่าง" ที่ติดมากับการติดตั้งครั้งแรก (seed) — 23 พ.ย. 2569

ทำไม: ตอนติดตั้งระบบครั้งแรก seed.py ใส่ FAQ ตัวอย่าง 14 ข้อ (สถานะอนุมัติ) และสาขาตัวอย่าง 7 สาขา ซึ่ง **ไม่ใช่ข้อมูลจริงของ
วิทยาลัยเทคนิคน่าน** เช่น "งานทะเบียนอยู่อาคาร 1 ชั้น 1", "ห้องน้ำอยู่ทางขวามือ 20 เมตร", "โรงอาหารอยู่หลังอาคาร 3",
"สมัครออนไลน์ผ่านเว็บไซต์ + งานทะเบียน อาคาร 1" → VORA เอามาตอบผู้ใช้จริง และสาขาตัวอย่างซ้ำชื่อกับสาขาจริงที่นำเข้า (VTCN-*)
ทำให้ AI หยิบคำอธิบายผิดสาขา

ทำอะไร: เปลี่ยนสถานะเท่านั้น ไม่ลบ — FAQ ตัวอย่าง (created_by = seed) → draft · สาขาตัวอย่าง (รหัสไม่มี VTCN-) → draft
เฉพาะเมื่อมีสาขาจริง VTCN-* อยู่แล้ว · เก็บค่าเดิมไว้ที่ data/backups/retire_seed_YYYYMMDD-HHMMSS.json ย้อนกลับได้

    python scripts\\retire_seed_samples.py              # ดูอย่างเดียว (ค่าเริ่มต้น ไม่แก้อะไร)
    python scripts\\retire_seed_samples.py --apply      # ทำจริง (แนะนำ backup_db.bat ก่อน)
    python scripts\\retire_seed_samples.py --undo FILE  # คืนสถานะเดิมจากไฟล์สำรอง
หลังทำ: หลังบ้าน > ฐานความรู้ AI > สร้างดัชนีใหม่ (หรือรีสตาร์ต start.bat)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
SEED_PROGRAM_CODES = ("AUTO", "ELEC", "ELEC-TRONIC", "IT", "ACC", "MECHA", "DBT")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--undo")
    ap.add_argument("--keep-programs", action="store_true", help="ไม่แตะสาขาตัวอย่าง")
    a = ap.parse_args()
    from app.db import SessionLocal, wait_for_db
    from app.models import KnowledgeItem, Program
    wait_for_db(30)
    with SessionLocal() as db:
        if a.undo:
            data = json.loads(Path(a.undo).read_text(encoding="utf-8"))
            for kid, st in data.get("knowledge", {}).items():
                k = db.get(KnowledgeItem, int(kid))
                if k:
                    k.status = st
            for pid, st in data.get("programs", {}).items():
                p = db.get(Program, int(pid))
                if p:
                    p.status = st
            db.commit()
            print(f"คืนสถานะ FAQ {len(data.get('knowledge', {}))} รายการ และสาขา {len(data.get('programs', {}))} สาขา")
            return 0
        kb = db.query(KnowledgeItem).filter(KnowledgeItem.created_by == "seed", KnowledgeItem.status == "approved").all()
        has_real = db.query(Program).filter(Program.code.like("VTCN-%"), Program.status == "published").count() > 0
        progs = [] if a.keep_programs or not has_real else \
            db.query(Program).filter(Program.code.in_(SEED_PROGRAM_CODES), Program.status == "published").all()
        print(f"FAQ ตัวอย่างที่จะปิด ({len(kb)}):")
        for k in kb:
            print(f"  #{k.id} [{k.category}] {k.question} → {k.answer_th[:60]}…")
        print(f"สาขาตัวอย่างที่จะปิด ({len(progs)}){'' if has_real else ' — ข้าม: ยังไม่มีสาขาจริง VTCN-*'}:")
        for p in progs:
            print(f"  #{p.id} {p.code} {p.name_th} {p.level}")
        if not a.apply:
            print("\nยังไม่ได้แก้อะไร — ใส่ --apply เพื่อทำจริง")
            return 0
        bak = {"knowledge": {str(k.id): k.status for k in kb}, "programs": {str(p.id): p.status for p in progs}}
        out = ROOT / "data" / "backups" / f"retire_seed_{datetime.now():%Y%m%d-%H%M%S}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(bak, ensure_ascii=False, indent=1), encoding="utf-8")
        for k in kb:
            k.status = "draft"
        for p in progs:
            p.status = "draft"
        db.commit()
        print(f"\nปิดแล้ว · ไฟล์สำรอง: {out}\nย้อนกลับ: python scripts\\retire_seed_samples.py --undo \"{out}\"")
        print("ขั้นต่อไป: หลังบ้าน > ฐานความรู้ AI > สร้างดัชนีใหม่ หรือรีสตาร์ต start.bat")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
