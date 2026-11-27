"""นำรายการเข้า "กล่องตรวจข้อมูล (Sandbox)" ในหลังบ้าน — 24 พ.ย. 2569

รายการใน sandbox ยังไม่ถูกใช้ตอบ จนกว่าเจ้าหน้าที่จะเปิดหลังบ้าน → ปัญญาประดิษฐ์ → กล่องตรวจข้อมูล แล้วกด "อนุมัตินำเข้า"

    python scripts\\import_sandbox.py                    # ดูอย่างเดียว (ค่าเริ่มต้น ไม่แก้อะไร)
    python scripts\\import_sandbox.py --apply            # ใส่จริง (แนะนำ backup_db.bat ก่อน)
    python scripts\\import_sandbox.py --undo FILE        # ลบเฉพาะรายการที่ยังรอตรวจจากรอบนั้น (ที่อนุมัติแล้วไม่แตะ)
    --file PATH  ไฟล์ JSON อื่น (ค่าเริ่มต้น data/knowledge/vtcn/qa_20261123/sandbox_candidates_20261124.json)

ข้ามรายการที่มีอยู่แล้ว (ชุดเดียวกัน + ref เดียวกัน) · บันทึก id ที่เพิ่มไว้ใน data/backups/import_sandbox_*.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
DEFAULT = ROOT / "data/knowledge/vtcn/qa_20261123/sandbox_candidates_20261124.json"
FIELDS = ("category", "question", "alt_questions", "answer_th", "answer_en", "choices", "sources", "evidence", "data_year", "reason")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--undo")
    ap.add_argument("--file", default=str(DEFAULT))
    a = ap.parse_args()
    from app.db import Base, SessionLocal, engine, wait_for_db
    from app.models import KnowledgeCandidate
    wait_for_db(30)
    Base.metadata.create_all(engine, tables=[KnowledgeCandidate.__table__])   # ตารางใหม่ (ไม่แตะตารางเดิม)
    with SessionLocal() as db:
        if a.undo:
            ids = json.loads(Path(a.undo).read_text(encoding="utf-8")).get("candidate_ids", [])
            gone = kept = 0
            for i in ids:
                c = db.get(KnowledgeCandidate, int(i))
                if c is None:
                    continue
                if c.status == "pending":
                    db.delete(c)
                    gone += 1
                else:
                    kept += 1
            db.commit()
            print(f"ลบรายการที่ยังรอตรวจ {gone} รายการ · คงไว้ {kept} รายการที่เจ้าหน้าที่ตรวจแล้ว (ย้อนกลับได้ที่หน้ากล่องตรวจข้อมูล)")
            return 0
        data = json.loads(Path(a.file).read_text(encoding="utf-8"))
        batch, items = data["batch"], data["items"]
        have = {r for (r,) in db.query(KnowledgeCandidate.ref).filter(KnowledgeCandidate.batch == batch).all()}
        new = [x for x in items if x["ref"] not in have]
        print(f"ชุด {batch}: ในไฟล์ {len(items)} รายการ · มีอยู่แล้ว {len(items) - len(new)} · จะเพิ่ม {len(new)}")
        for x in new:
            print(f"  [{x.get('evidence', 'U')}] {x['ref']:10} {x['question'][:60]}  ← {x.get('reason', '')[:70]}")
        if not a.apply:
            print("\nยังไม่ได้แก้อะไร — ใส่ --apply เพื่อเพิ่มจริง")
            return 0
        added = []
        for x in new:
            c = KnowledgeCandidate(batch=batch, ref=x["ref"], status="pending", **{k: x.get(k, [] if k in ("choices", "sources") else "")
                                                                                 for k in FIELDS})
            db.add(c)
            db.flush()
            added.append(c.id)
        db.commit()
        out = ROOT / "data/backups" / f"import_sandbox_{datetime.now():%Y%m%d-%H%M%S}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"file": a.file, "batch": batch, "candidate_ids": added}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"เพิ่ม {len(added)} รายการเข้ากล่องตรวจข้อมูล · ย้อนกลับ: import_sandbox.bat --undo {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
