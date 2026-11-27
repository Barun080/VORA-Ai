"""ส่งออกคลังความรู้ของ VORA เป็นไฟล์ CSV เปิดด้วย Excel ได้ทันที (ภาษาไทยไม่เพี้ยน)

อ่านอย่างเดียว: เปิดทรานแซกชันแบบ READ ONLY ไม่แก้ไขฐานข้อมูลใด ๆ ทั้งสิ้น
ไม่ส่งออกตารางผู้ใช้ รหัสผ่าน หรือประวัติการสนทนา

    python scripts\\export_knowledge.py            # ส่งออกไปที่ exports\\knowledge-YYYYMMDD-HHMM\\
    python scripts\\export_knowledge.py --out D:\\x  # กำหนดโฟลเดอร์ปลายทางเอง
"""
from __future__ import annotations

import argparse
import csv
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import inspect, text  # noqa: E402

from app.db import DIALECT, engine, wait_for_db  # noqa: E402

# ตาราง → (ชื่อไฟล์, คำอธิบาย, คอลัมน์ที่ขึ้นบรรทัดใหม่ให้รวมเป็นบรรทัดเดียวคั่นด้วย " | ")
TABLES = [
    ("knowledge", "knowledge.csv", "ฐานความรู้ (FAQ) ทุกสถานะ — status=approved คือที่ AI ใช้ตอบจริง", {"alt_questions"}),
    ("programs", "programs.csv", "แผนก/สาขาวิชา", set()),
    ("news", "news.csv", "ข่าวและกิจกรรม", set()),
    ("unanswered", "unanswered.csv", "คำถามที่ AI ตอบไม่ได้", set()),
    ("intent_examples", "intent_examples.csv", "ประโยคฝึกโมเดลเข้าใจคำถาม", set()),
    ("vision_classes", "vision_classes.csv", "ป้ายที่กล้องจำได้", set()),
    ("settings", "settings.csv", "การตั้งค่าที่ใช้ในคำตอบ (ชื่อวิทยาลัย ข้อความทักทาย ฯลฯ)", set()),
]


def cell(v, join_lines: bool):
    if v is None:
        return ""
    if isinstance(v, (datetime, date)):
        return v.isoformat(sep=" ", timespec="seconds") if isinstance(v, datetime) else v.isoformat()
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    s = str(v)
    if join_lines:
        s = " | ".join(x.strip() for x in s.replace("\r\n", "\n").split("\n") if x.strip())
    return s[:32000]   # Excel รับได้สูงสุด 32,767 ตัวอักษรต่อช่อง


def main() -> int:
    ap = argparse.ArgumentParser(description="ส่งออกคลังความรู้ VORA เป็น CSV (อ่านอย่างเดียว)")
    ap.add_argument("--out", help="โฟลเดอร์ปลายทาง")
    a = ap.parse_args()
    out = Path(a.out) if a.out else ROOT / "exports" / f"knowledge-{datetime.now():%Y%m%d-%H%M}"
    out.mkdir(parents=True, exist_ok=True)

    wait_for_db(30)
    existing = set(inspect(engine).get_table_names())
    summary = []
    with engine.connect() as conn:
        if DIALECT == "postgresql":
            conn.execute(text("SET TRANSACTION READ ONLY"))
        elif DIALECT == "sqlite":
            conn.execute(text("PRAGMA query_only = ON"))
        for table, fname, desc, join_cols in TABLES:
            if table not in existing:
                summary.append((fname, "-", "ไม่มีตารางนี้"))
                continue
            res = conn.execute(text(f'SELECT * FROM "{table}" ORDER BY 1'))
            cols = list(res.keys())
            rows = res.fetchall()
            with open(out / fname, "w", encoding="utf-8-sig", newline="") as f:   # BOM ให้ Excel อ่านไทยถูก
                w = csv.writer(f)
                w.writerow(cols)
                for r in rows:
                    w.writerow([cell(v, c in join_cols) for c, v in zip(cols, r)])
            summary.append((fname, len(rows), desc))
        if table_has(existing, "knowledge"):
            st = conn.execute(text("SELECT status, count(*) FROM knowledge GROUP BY status ORDER BY 2 DESC")).fetchall()
            no_en = conn.execute(text("SELECT count(*) FROM knowledge WHERE status='approved' AND coalesce(answer_en,'')=''")).scalar()
        else:
            st, no_en = [], 0
        conn.rollback()

    lines = [f"ส่งออกเมื่อ {datetime.now():%Y-%m-%d %H:%M} จากฐานข้อมูล {DIALECT}", ""]
    lines += [f"{f:<22} {n!s:>6} แถว  {d}" for f, n, d in summary]
    if st:
        lines += ["", "ฐานความรู้แยกตามสถานะ: " + ", ".join(f"{s}={n}" for s, n in st),
                  f"ความรู้ที่อนุมัติแล้วแต่ยังไม่มีคำตอบภาษาอังกฤษ: {no_en} ข้อ"]
    report = "\n".join(lines)
    (out / "README.txt").write_text(report + "\n", encoding="utf-8-sig")
    print(report)
    print(f"\nไฟล์อยู่ที่: {out}")
    return 0


def table_has(existing: set[str], name: str) -> bool:
    return name in existing


if __name__ == "__main__":
    raise SystemExit(main())
