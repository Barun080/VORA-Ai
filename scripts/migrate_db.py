"""ย้ายข้อมูล VORA ระหว่างฐานข้อมูล (SQLite -> PostgreSQL หรือย้อนกลับ)

ใช้งาน (ปิด start.bat ก่อนเสมอ):
    python scripts\\migrate_db.py                       # จาก data\\vora.db ไปยัง VORA_DATABASE_URL ใน .env
    python scripts\\migrate_db.py --force               # ล้างข้อมูลในปลายทางก่อนแล้วย้ายใหม่
    python scripts\\migrate_db.py --from postgresql+psycopg://... --to sqlite:///data/vora-copy.db

- ทำในทรานแซกชันเดียว ถ้าผิดพลาดกลางทางปลายทางจะไม่เปลี่ยนแปลง
- ไม่ลบหรือแก้ไขฐานข้อมูลต้นทาง
- ตรวจจำนวนแถวทุกตารางหลังย้าย และตั้งลำดับเลข id ของ PostgreSQL ให้ต่อจากข้อมูลเดิม
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import Integer, String, create_engine, func, inspect, select, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

BATCH = 500


def read_env(path: Path = ROOT / ".env") -> dict[str, str]:
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def default_sqlite_url() -> str:
    data_dir = Path(os.environ.get("VORA_DATA_DIR", ROOT / "data"))
    return f"sqlite:///{(data_dir / 'vora.db').as_posix()}"


def safe(url: str) -> str:
    return make_url(url).render_as_string(hide_password=True)


def _fit_row(row: dict, table) -> dict:
    """ตัดข้อความให้พอดีคอลัมน์และลบอักขระ NUL (PostgreSQL ไม่รับ) เหมือนที่แอปทำตอนบันทึก"""
    for col in table.columns:
        v = row.get(col.name)
        if isinstance(v, str):
            if "\x00" in v:
                v = v.replace("\x00", "")
            limit = getattr(col.type, "length", None) if isinstance(col.type, String) else None
            if limit and len(v) > limit:
                v = v[:limit]
            row[col.name] = v
    return row


def migrate(src_url: str, dst_url: str, force: bool = False, log=print) -> dict[str, int]:
    from app.db import Base
    import app.models  # noqa: F401  ลงทะเบียนตารางทั้งหมด

    if make_url(src_url) == make_url(dst_url):
        raise SystemExit("ต้นทางและปลายทางเป็นฐานข้อมูลเดียวกัน")
    src = create_engine(src_url)
    dst = create_engine(dst_url)
    src_tables = set(inspect(src).get_table_names())
    if not src_tables:
        raise SystemExit(f"ไม่พบตารางในฐานข้อมูลต้นทาง {safe(src_url)}")
    tables = [t for t in Base.metadata.sorted_tables]
    counts: dict[str, int] = {}

    with dst.begin() as dc, src.connect() as sc:
        if force:
            Base.metadata.drop_all(dc)
        Base.metadata.create_all(dc)
        non_empty = [t.name for t in tables if dc.execute(select(func.count()).select_from(t)).scalar()]
        if non_empty:
            raise SystemExit("ปลายทางมีข้อมูลอยู่แล้วในตาราง: " + ", ".join(non_empty)
                             + "\nถ้าต้องการเขียนทับ ให้รันใหม่พร้อม --force")
        src_insp = inspect(sc)
        for t in tables:
            if t.name not in src_tables:
                log(f"  - {t.name:<22} ไม่มีในต้นทาง (ข้าม)")
                counts[t.name] = 0
                continue
            src_cols = {c["name"] for c in src_insp.get_columns(t.name)}
            cols = [c for c in t.columns if c.name in src_cols]
            n = 0
            batch: list[dict] = []
            for row in sc.execute(select(*cols)).mappings():
                batch.append(_fit_row(dict(row), t))
                if len(batch) >= BATCH:
                    dc.execute(t.insert(), batch)
                    n += len(batch)
                    batch = []
            if batch:
                dc.execute(t.insert(), batch)
                n += len(batch)
            counts[t.name] = n
            log(f"  - {t.name:<22} {n:>7} แถว")

        # ตรวจจำนวนแถวให้ตรงกัน
        for t in tables:
            if t.name in src_tables:
                a = sc.execute(select(func.count()).select_from(t)).scalar()
                b = dc.execute(select(func.count()).select_from(t)).scalar()
                if a != b:
                    raise RuntimeError(f"จำนวนแถวตาราง {t.name} ไม่ตรงกัน (ต้นทาง {a}, ปลายทาง {b}) ยกเลิกการย้าย")

        # PostgreSQL: ให้เลข id ถัดไปต่อจากข้อมูลที่ย้ายมา ไม่ชนกับของเดิม
        if dst.dialect.name == "postgresql":
            for t in tables:
                pk = list(t.primary_key.columns)
                if len(pk) == 1 and isinstance(pk[0].type, Integer):
                    dc.execute(text(
                        f"SELECT setval(pg_get_serial_sequence('{t.name}', '{pk[0].name}'), "
                        f"COALESCE((SELECT MAX({pk[0].name}) FROM {t.name}), 0) + 1, false)"))
    return counts


def main() -> None:
    env = read_env()
    ap = argparse.ArgumentParser(description="ย้ายข้อมูล VORA ระหว่างฐานข้อมูล")
    ap.add_argument("--from", dest="src", default=default_sqlite_url(), help="ฐานข้อมูลต้นทาง (ค่าเริ่มต้น data/vora.db)")
    ap.add_argument("--to", dest="dst", default=os.environ.get("VORA_DATABASE_URL") or env.get("VORA_DATABASE_URL", ""),
                    help="ฐานข้อมูลปลายทาง (ค่าเริ่มต้น VORA_DATABASE_URL ใน .env)")
    ap.add_argument("--force", action="store_true", help="ล้างข้อมูลในปลายทางก่อนย้าย")
    a = ap.parse_args()
    if not a.dst:
        raise SystemExit("ยังไม่ได้ตั้ง VORA_DATABASE_URL ใน .env (รัน setup_postgres.bat ก่อน) หรือระบุ --to")
    if a.src.startswith("sqlite:///") and not Path(make_url(a.src).database or "").exists():
        raise SystemExit(f"ไม่พบไฟล์ต้นทาง {make_url(a.src).database}")
    print(f"ย้ายข้อมูลจาก {safe(a.src)}\n          ไป {safe(a.dst)}")
    counts = migrate(a.src, a.dst, force=a.force)
    print(f"สำเร็จ: ย้าย {sum(counts.values())} แถว จาก {len([c for c in counts.values() if c])} ตาราง "
          "(ฐานข้อมูลต้นทางยังอยู่ครบ ใช้เป็นสำรองได้)")


if __name__ == "__main__":
    main()
