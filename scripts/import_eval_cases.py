"""นำเข้าชุดกรณีทดสอบ AI (หลังบ้าน > ประเมินผล AI) จากชุดคำถาม 23 พ.ย. 2569 — data/knowledge/vtcn/qa_20261123/eval_cases_*.json

ทำอะไร: เพิ่มแถวใน eval_cases (คำถาม · เจตนาที่คาด · คำสำคัญที่ต้องพบ · คาดว่าตอบได้/ต้องบอกว่าไม่มีข้อมูล)
  · ข้ามคำถามที่มีอยู่แล้ว (เทียบข้อความคำถาม) · ไม่แก้/ไม่ลบกรณีเดิม
  · เก็บรายการ id ที่เพิ่มไว้ที่ data/backups/import_eval_YYYYMMDD-HHMMSS.json → --undo ปิดใช้ (active = False) ได้
  · ค่าเริ่มต้น = ดูอย่างเดียว

    python scripts\\import_eval_cases.py                 # ดูว่าจะเพิ่มอะไร
    python scripts\\import_eval_cases.py --apply         # เพิ่มจริง
    python scripts\\import_eval_cases.py --undo FILE     # ปิดใช้กรณีที่เพิ่มจากไฟล์สำรอง (ไม่ลบ)
    --file PATH  ใช้ไฟล์ JSON อื่น · --only-verified  เฉพาะกรณีที่ข้อมูลยืนยันแล้ว (VERIFIED/DB/TEST)
หมายเหตุ: กรณีสถานะ ASK (ยังไม่มีข้อมูล) ตั้งไว้ว่า "ต้องตอบว่าไม่มีข้อมูล" — เมื่อเติมข้อมูลจริงแล้วให้แก้กรณีนั้นในหลังบ้าน
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
DEFAULT = ROOT / "data/knowledge/vtcn/qa_20261123/eval_cases_20261123.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--undo")
    ap.add_argument("--file", default=str(DEFAULT))
    ap.add_argument("--only-verified", action="store_true")
    a = ap.parse_args()
    from app.db import SessionLocal, wait_for_db
    from app.models import EvalCase
    wait_for_db(30)
    with SessionLocal() as db:
        if a.undo:
            ids = json.loads(Path(a.undo).read_text(encoding="utf-8")).get("eval_case_ids", [])
            n = 0
            for i in ids:
                c = db.get(EvalCase, int(i))
                if c and c.active:
                    c.active, n = False, n + 1
            db.commit()
            print(f"ปิดใช้กรณีทดสอบ {n} รายการ (ไม่ได้ลบ — เปิดคืนได้ในหลังบ้าน)")
            return 0
        rows = json.loads(Path(a.file).read_text(encoding="utf-8"))
        if a.only_verified:
            rows = [r for r in rows if r.get("status") in ("VERIFIED", "DB", "TEST")]
        have = {q.strip() for (q,) in db.query(EvalCase.question).all()}
        new = [r for r in rows if r["question"].strip() not in have]
        print(f"ในไฟล์ {len(rows)} กรณี · มีอยู่แล้ว {len(rows) - len(new)} · จะเพิ่ม {len(new)}")
        for r in new:
            print(f"  {r.get('qid', ''):6} [{r.get('status', '')}] {r['question']} → intent={r.get('expected_intent') or '-'} "
                  f"ตอบได้={r.get('expect_answered')} คำสำคัญ={r.get('expected_keywords') or '-'}")
        if not a.apply:
            print("\nยังไม่ได้แก้อะไร — ใส่ --apply เพื่อเพิ่มจริง")
            return 0
        added = []
        for r in new:
            c = EvalCase(question=r["question"].strip(), expected_intent=r.get("expected_intent") or "",
                         expected_keywords=r.get("expected_keywords") or "", expect_answered=bool(r.get("expect_answered", True)),
                         lang=r.get("lang") or "th", active=True)
            db.add(c)
            db.flush()
            added.append(c.id)
        db.commit()
        out = ROOT / "data/backups" / f"import_eval_{datetime.now():%Y%m%d-%H%M%S}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"file": a.file, "eval_case_ids": added}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"เพิ่ม {len(added)} กรณี · ย้อนกลับ: python scripts\\import_eval_cases.py --undo {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
