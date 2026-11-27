"""27 พ.ย. 2569: แก้วันที่ข่าวที่ผิดรูปแบบ (ข่าวที่เผยแพร่แล้วแต่ไม่ขึ้นหน้าจอ)

พบในฐานข้อมูลจริง:
  · ปีเป็น พ.ศ. ในช่อง ค.ศ. เช่น 2569-09-17 → ระบบเข้าใจว่าเผยแพร่ในอนาคตอีก 543 ปี จึงไม่แสดง
  · วันหมดอายุ 0001-01-01 (ค่าว่างที่บันทึกผิด) → ระบบเข้าใจว่าหมดอายุไปแล้ว จึงไม่แสดง
แก้: ปี ≥ 2400 → ลบ 543 · ปี < 1900 → ว่าง (ไม่มีวันหมดอายุ) · ช่อง publish_at / expire_at / event_date
ไม่แตะข้อความ รูป หรือสถานะของข่าว

    python scripts\\fix_news_dates.py            # ดูอย่างเดียว
    python scripts\\fix_news_dates.py --apply    # แก้จริง (เก็บค่าเดิมไว้ที่ data/backups/fix_news_dates_*.json)
    python scripts\\fix_news_dates.py --undo data\\backups\\fix_news_dates_....json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
FIELDS = ("publish_at", "expire_at", "event_date")


def fixed(v: datetime | None) -> tuple[datetime | None, bool]:
    if v is None:
        return None, False
    if v.year >= 2400:
        return v.replace(year=v.year - 543), True
    if v.year < 1900:
        return None, True
    return v, False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--undo")
    a = ap.parse_args()
    from app.config import DATA_DIR
    from app.db import SessionLocal, wait_for_db
    from app.models import AuditLog, News
    wait_for_db(30)
    with SessionLocal() as db:
        if a.undo:
            data = json.loads(Path(a.undo).read_text(encoding="utf-8"))
            for row in data["before"]:
                n = db.get(News, row["id"])
                if n:
                    for f in FIELDS:
                        setattr(n, f, datetime.fromisoformat(row[f]) if row[f] else None)
            db.add(AuditLog(username="script", action="undo", entity="news", entity_id="", detail={"file": Path(a.undo).name}))
            db.commit()
            print(f"คืนค่าเดิม {len(data['before'])} ข่าว")
            return 0
        before = []
        for n in db.query(News).order_by(News.id).all():
            changes = {f: fixed(getattr(n, f)) for f in FIELDS}
            if not any(ch for _, ch in changes.values()):
                continue
            print(f"\n#{n.id} [{n.status}] {n.title_th[:60]}")
            for f, (new, ch) in changes.items():
                if ch:
                    print(f"  {f}: {getattr(n, f)} → {new or '(ว่าง)'}")
            if a.apply:
                before.append({"id": n.id, **{f: (getattr(n, f).isoformat() if getattr(n, f) else None) for f in FIELDS}})
                for f, (new, ch) in changes.items():
                    if ch:
                        setattr(n, f, new)
        if not a.apply:
            print("\n(ดูอย่างเดียว — ยังไม่ได้แก้อะไร · ใส่ --apply เพื่อแก้จริง)")
            return 0
        out = DATA_DIR / "backups" / f"fix_news_dates_{datetime.now():%Y%m%d-%H%M%S-%f}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"before": before}, ensure_ascii=False, indent=1), encoding="utf-8")
        db.add(AuditLog(username="script", action="fix_dates", entity="news", entity_id="", detail={"ids": [b["id"] for b in before]}))
        db.commit()
        print(f"\nแก้แล้ว {len(before)} ข่าว · ไฟล์สำรองสำหรับย้อนกลับ: {out}")
        print("ขั้นต่อไป: กด Ctrl+F5 ที่หน้าจอหุ่นยนต์")
    return 0


if __name__ == "__main__":
    sys.exit(main())
