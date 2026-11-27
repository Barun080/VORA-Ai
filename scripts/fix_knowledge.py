"""แก้คำตอบในฐานความรู้ตามไฟล์ที่ตรวจกับแหล่งข้อมูลต้นฉบับแล้ว (25 พ.ย. 2569)

ไฟล์แก้ไขอยู่ที่ data/knowledge/fixes/*.json — แต่ละรายการระบุคำถามที่จะแก้ (match_question) คำตอบใหม่ และแหล่งอ้างอิง
ทำอะไร: หา FAQ ที่คำถามตรงกัน (ทุกสถานะยกเว้น rejected) → แสดงของเดิม/ของใหม่ → --apply จึงแก้จริง (version +1, บันทึก audit)
ไม่พบคำถามนั้นในฐานข้อมูล → เพิ่มเป็น FAQ ใหม่สถานะอนุมัติ (created_by = ชื่อชุดแก้ไข)
เก็บค่าเดิมไว้ที่ data/backups/fix_knowledge_YYYYMMDD-HHMMSS.json ย้อนกลับได้ด้วย --undo

    python scripts\\fix_knowledge.py data\\knowledge\\fixes\\20261125_tvqf.json            # ดูอย่างเดียว
    python scripts\\fix_knowledge.py data\\knowledge\\fixes\\20261125_tvqf.json --apply    # ทำจริง (fix_knowledge.bat สำรองฐานข้อมูลก่อน)
    python scripts\\fix_knowledge.py --undo data\\backups\\fix_knowledge_....json
หลังทำ: รีสตาร์ต start.bat (หรือหลังบ้าน > ฐานความรู้ AI > สร้างดัชนีใหม่)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
FIELDS = ("category", "question", "alt_questions", "answer_th", "answer_en")


def _short(s: str, n: int = 90) -> str:
    s = (s or "").replace("\n", " | ")
    return s if len(s) <= n else s[:n] + "…"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--undo")
    a = ap.parse_args()
    from app.config import DATA_DIR
    from app.db import SessionLocal, wait_for_db
    from app.models import AuditLog, KnowledgeItem
    wait_for_db(30)
    with SessionLocal() as db:
        if a.undo:
            data = json.loads(Path(a.undo).read_text(encoding="utf-8"))
            for row in data.get("updated", []):
                k = db.get(KnowledgeItem, row["id"])
                if k:
                    for f in FIELDS + ("version", "status"):
                        setattr(k, f, row[f])
            for kid in data.get("created", []):
                k = db.get(KnowledgeItem, kid)
                if k:
                    k.status = "draft"
            db.add(AuditLog(username="script", action="undo", entity="knowledge", entity_id="",
                            detail={"file": Path(a.undo).name}))
            db.commit()
            print(f"คืนค่าเดิม {len(data.get('updated', []))} รายการ · ปิดรายการที่เพิ่มใหม่ {len(data.get('created', []))} รายการ (draft)")
            return 0
        if not a.file:
            ap.error("ระบุไฟล์แก้ไข หรือ --undo")
        spec = json.loads(Path(a.file).read_text(encoding="utf-8"))
        batch = spec.get("batch", Path(a.file).stem)
        backup = {"batch": batch, "updated": [], "created": []}
        for fx in spec["fixes"]:
            rows = db.query(KnowledgeItem).filter(KnowledgeItem.question == fx["match_question"],
                                                  KnowledgeItem.status != "rejected").all()
            print(f"\n=== {fx['match_question']}")
            if fx.get("sources"):
                print("แหล่งอ้างอิง: " + "; ".join(s["title"] for s in fx["sources"]))
            if fx.get("action") == "retire":            # ยืนยันไม่ได้ → ปิด (draft) ไม่ลบ · ย้อนกลับได้
                print(f"  ปิดใช้ (draft): {fx.get('reason', '')}")
                for k in rows:
                    print(f"  #{k.id} [{k.status}] {_short(k.answer_th, 120)}")
                    if a.apply and k.status != "draft":
                        backup["updated"].append({"id": k.id, **{f: getattr(k, f) for f in FIELDS + ("version", "status")}})
                        k.status = "draft"
                        db.add(AuditLog(username="script", action="retire", entity="knowledge", entity_id=str(k.id),
                                        detail={"batch": batch, "reason": fx.get("reason", "")}))
                if not rows:
                    print("  ไม่พบในฐานข้อมูล — ข้าม")
                continue
            if not rows:
                print("  ไม่พบในฐานข้อมูล → จะเพิ่มเป็น FAQ ใหม่ " + ("(รออนุมัติ — เจ้าหน้าที่ตรวจที่หลังบ้าน › ฐานความรู้ AI)" if fx.get("status") == "pending" else "(อนุมัติ)"))
                print(f"  ใหม่: {_short(fx.get('answer_th', ''), 200)}")
                if not fx.get("answer_th"):
                    print("  (ไม่มีคำตอบในไฟล์ → ไม่เพิ่ม)")
                    continue
                if a.apply:
                    st = fx.get("status", "approved")    # 27 พ.ย. 2569: "pending" = ร่างให้เจ้าหน้าที่อนุมัติที่หลังบ้านก่อนใช้ตอบ
                    k = KnowledgeItem(kind="faq", source="import", status=st, created_by=batch[:64], approved_by=batch[:64] if st == "approved" else "",
                                      **{f: fx.get(f, "") or ("general" if f == "category" else "") for f in FIELDS if f != "question"},
                                      question=fx.get("question") or fx["match_question"])
                    db.add(k)
                    db.flush()
                    backup["created"].append(k.id)
                continue
            for k in rows:
                print(f"  #{k.id} [{k.status}] v{k.version}")
                print(f"  เดิม: {_short(k.answer_th, 200)}")
                # 27 พ.ย. 2569: ไฟล์ที่แก้แค่คำถามอื่น (ไม่มี answer_th) เดิมหยุดทำงานตรงนี้ → แสดงว่าคงคำตอบเดิม
                print(f"  ใหม่: {_short(fx['answer_th'], 200)}" if fx.get("answer_th") else "  ใหม่: (คำตอบคงเดิม)")
                if fx.get("alt_questions"):
                    print(f"  คำถามอื่น: {_short(fx['alt_questions'].replace(chr(10), ' · '), 200)}")
                if a.apply:
                    backup["updated"].append({"id": k.id, **{f: getattr(k, f) for f in FIELDS + ("version", "status")}})
                    for f in FIELDS:
                        if fx.get(f):                     # ช่องว่างในไฟล์แก้ไข = คงค่าเดิม
                            setattr(k, f, fx[f])
                    k.version = (k.version or 1) + 1
                    db.add(AuditLog(username="script", action="fix", entity="knowledge", entity_id=str(k.id),
                                    detail={"batch": batch, "sources": [s.get("url", "") for s in fx.get("sources", [])]}))
        if not a.apply:
            print("\n(ดูอย่างเดียว — ยังไม่ได้แก้อะไร · ใส่ --apply เพื่อแก้จริง)")
            return 0
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in batch)[:60]
        out = DATA_DIR / "backups" / f"fix_knowledge_{datetime.now():%Y%m%d-%H%M%S-%f}_{safe}.json"   # ไม่ทับไฟล์เดิม
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(backup, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        db.commit()
        print(f"\nแก้แล้ว {len(backup['updated'])} รายการ · เพิ่มใหม่ {len(backup['created'])} รายการ")
        print(f"ไฟล์สำรองสำหรับย้อนกลับ: {out}")
        print("ขั้นต่อไป: รีสตาร์ต start.bat (หรือหลังบ้าน > ฐานความรู้ AI > สร้างดัชนีใหม่)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
