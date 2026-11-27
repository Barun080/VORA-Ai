"""ปรับโครงสร้างฐานข้อมูล VORA ทีละขั้น (Schema Migration) — ปิด start.bat ก่อนเสมอ

    python scripts\\migrate_schema.py status              # ดูว่าฐานข้อมูลอยู่ขั้นไหน (ไม่แก้ไขอะไร)
    python scripts\\migrate_schema.py upgrade             # ทำทุกขั้นที่ยังไม่ได้ทำ
    python scripts\\migrate_schema.py downgrade 0001      # ย้อนขั้น 0001 (ต้องพิมพ์ YES ยืนยัน)

ทุกครั้งที่ upgrade/downgrade:
  1. ตรวจว่าเซิร์ฟเวอร์ VORA ปิดอยู่
  2. สำรองฐานข้อมูล -> _backups\\database\\migrations\\  (ไม่ถูกลบอัตโนมัติ)
  3. ตรวจไฟล์สำรอง (verify_backup.py) — ไม่ผ่านจะหยุดทันที ไม่แก้ฐานข้อมูล
  4. บันทึกลายนิ้วมือข้อมูลเดิม (จำนวนแถวทุกตาราง + md5 ของข้อมูลทุกคอลัมน์เดิม)
  5. แก้โครงสร้างในทรานแซกชันเดียว (ผิดพลาด = ยกเลิกทั้งหมด)
  6. ตรวจลายนิ้วมือซ้ำ ต้องตรงกับก่อนทำทุกตาราง
  7. บันทึกผลใน _backups\\database\\migrations\\migration-log.jsonl
downgrade จะส่งออกข้อมูลในคอลัมน์ที่จะถูกลบเป็นไฟล์ JSON ก่อนเสมอ
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import urllib.request
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import backup_db  # noqa: E402
from verify_backup import BackupInvalid, verify  # noqa: E402

from sqlalchemy import create_engine, inspect, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

MIG_DIR = backup_db.BACKUP_DIR / "migrations"


class Migration:
    id = ""
    title = ""
    table = ""
    columns: list[tuple[str, str]] = []      # (ชื่อ, ชนิดข้อมูล) — ทุกคอลัมน์ NULL ได้ ไม่มีค่าเริ่มต้น

    def applied(self, insp) -> bool | None:
        """True = ครบ · False = ยังไม่ทำ · None = ทำไปบางส่วน (ผิดปกติ ต้องตรวจด้วยคน)"""
        have = {c["name"] for c in insp.get_columns(self.table)}
        n = sum(1 for c, _ in self.columns if c in have)
        return True if n == len(self.columns) else False if n == 0 else None


class M0001NewsLocation(Migration):
    id = "0001"
    title = "เพิ่มสถานที่จัดกิจกรรมในข่าว (location, location_type, location_map_url)"
    table = "news"
    columns = [("location", "VARCHAR(255)"), ("location_type", "VARCHAR(16)"), ("location_map_url", "VARCHAR(500)")]


class M0002ProgramPresentation(Migration):
    id = "0002"
    title = "เพิ่มข้อมูลพรีเซนเทชันสาขา (เหมาะกับใคร ไทย/อังกฤษ และภาพบรรยากาศ)"
    table = "programs"
    columns = [("suits_th", "TEXT"), ("suits_en", "TEXT"), ("gallery", "TEXT")]


class M0003NewsGallery(Migration):
    id = "0003"
    title = "เพิ่มภาพประกอบหลายภาพให้ข่าว/ประกาศ (สไลด์ภาพ)"
    table = "news"
    columns = [("gallery", "TEXT")]


MIGRATIONS: list[Migration] = [M0001NewsLocation(), M0002ProgramPresentation(), M0003NewsGallery()]


def _json_default(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return bytes(v).hex()
    return str(v)


def fingerprint(conn, skip: dict[str, set[str]] | None = None) -> dict[str, dict]:
    """จำนวนแถว + md5 ของข้อมูลทุกตาราง (ไม่รวมคอลัมน์ใน skip) เรียงตามคีย์หลัก"""
    skip = skip or {}
    insp = inspect(conn)
    out = {}
    for t in sorted(insp.get_table_names()):
        cols = [c["name"] for c in insp.get_columns(t) if c["name"] not in skip.get(t, set())]
        pk = insp.get_pk_constraint(t).get("constrained_columns") or cols
        q = f'SELECT {", ".join(chr(34) + c + chr(34) for c in cols)} FROM "{t}" ORDER BY {", ".join(chr(34) + c + chr(34) for c in pk)}'
        h = hashlib.md5()
        n = 0
        for row in conn.execute(text(q)):
            h.update(json.dumps(list(row), default=_json_default, ensure_ascii=False).encode())
            n += 1
        out[t] = {"rows": n, "md5": h.hexdigest()}
    return out


def server_running(port: int = 8000) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2):
            return True
    except Exception:
        return False


def _log(entry: dict) -> None:
    MIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(MIG_DIR / "migration-log.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False, default=_json_default) + "\n")


def safe_backup(tag: str, url: str) -> tuple[Path, dict]:
    """สำรอง + ตรวจ · เขียนไฟล์สำรองลงโฟลเดอร์ migrations โดยตรง (ไม่อยู่ในรอบลบไฟล์เก่าของ backup_db)
    ไม่ย้าย/คัดลอก/ลบไฟล์หลังสำรอง — ไฟล์ที่ตรวจคือไฟล์เดียวกับที่ pg_dump/sqlite backup เขียนและปิดแล้ว"""
    dest = backup_db.backup(tag=tag, out_dir=MIG_DIR)
    if dest.resolve().parent != MIG_DIR.resolve():
        raise SystemExit(f"ไฟล์สำรองไม่ได้อยู่ใน {MIG_DIR} — หยุด ไม่แก้ฐานข้อมูล")
    print(f"[1/4] สำรองแล้ว: {dest}")
    report = verify(dest, url, quiet=True)
    print(f"[2/4] ตรวจไฟล์สำรองผ่าน: {len(report['tables'])} ตาราง {report['total_rows']} แถว ตรงกับฐานข้อมูล · SHA-256 {report['sha256'][:16]}…")
    return dest, report


def _check_sqlite_drop(url: str) -> None:
    if make_url(url).get_backend_name() == "sqlite" and sqlite3.sqlite_version_info < (3, 35, 0):
        raise SystemExit(f"SQLite {sqlite3.sqlite_version} ลบคอลัมน์ไม่ได้ (ต้อง 3.35 ขึ้นไป) — ใช้ไฟล์สำรองกู้คืนแทน")


def status(url: str) -> list[tuple[Migration, bool | None]]:
    eng = create_engine(url)
    try:
        with eng.connect() as c:
            insp = inspect(c)
            return [(m, m.applied(insp)) for m in MIGRATIONS]
    finally:
        eng.dispose()


def upgrade(url: str, *, port: int = 8000, skip_server_check: bool = False) -> list[str]:
    todo = []
    for m, st in status(url):
        if st is None:
            raise SystemExit(f"ขั้น {m.id} ทำไปบางส่วน (มีบางคอลัมน์แล้ว) — หยุด ไม่แก้ไขอัตโนมัติ กรุณาแจ้งผู้ดูแลระบบ")
        if st is False:
            todo.append(m)
    if not todo:
        print("ฐานข้อมูลเป็นรุ่นล่าสุดแล้ว ไม่มีอะไรต้องทำ")
        return []
    if not skip_server_check and server_running(port):
        raise SystemExit("เซิร์ฟเวอร์ VORA ยังทำงานอยู่ — ปิดหน้าต่าง start.bat ก่อน แล้วรันใหม่")
    tag = "before-migrate-" + "-".join(m.id for m in todo) + "-"
    bfile, breport = safe_backup(tag, url)

    eng = create_engine(url)
    done = []
    try:
        with eng.connect() as c:
            before = fingerprint(c)
        print(f"[3/4] บันทึกลายนิ้วมือข้อมูลเดิม {len(before)} ตาราง")
        with eng.begin() as c:                        # ทรานแซกชันเดียว
            for m in todo:
                for col, typ in m.columns:
                    c.execute(text(f'ALTER TABLE "{m.table}" ADD COLUMN "{col}" {typ} NULL'))
                done.append(m.id)
        with eng.connect() as c:
            new_cols = {m.table: {col for col, _ in m.columns} for m in todo}
            after = fingerprint(c, skip=new_cols)
            insp = inspect(c)
            assert all(m.applied(insp) is True for m in todo)
            nulls = {m.table: c.execute(text(f'SELECT COUNT(*) FROM "{m.table}" WHERE ' + " OR ".join(
                f'"{col}" IS NOT NULL' for col, _ in m.columns))).scalar_one() for m in todo}
    finally:
        eng.dispose()
    diff = [t for t in before if before[t] != after.get(t)]
    if diff or any(nulls.values()):
        _log({"at": datetime.now(), "action": "upgrade", "migrations": done, "ok": False, "diff": diff, "backup": bfile.name})
        raise SystemExit(f"ตรวจหลังทำพบข้อมูลเดิมเปลี่ยน ({', '.join(diff) or 'คอลัมน์ใหม่มีค่า'}) — "
                         f"หยุดใช้งานและกู้คืนจาก {bfile} ด้วย backup_db.bat --restore")
    total = sum(v["rows"] for v in after.values())
    print(f"[4/4] ทำขั้น {', '.join(done)} สำเร็จ · ข้อมูลเดิม {len(after)} ตาราง {total} แถว ไม่เปลี่ยนแปลง (md5 ตรงทุกตาราง)")
    _log({"at": datetime.now(), "action": "upgrade", "migrations": done, "ok": True, "backup": bfile.name,
          "backup_sha256": breport["sha256"], "tables": len(after), "rows": total, "fingerprint": after})
    return done


def downgrade(url: str, mid: str, *, port: int = 8000, skip_server_check: bool = False, assume_yes: bool = False) -> Path | None:
    m = next((x for x in MIGRATIONS if x.id == mid), None)
    if m is None:
        raise SystemExit(f"ไม่รู้จักขั้น {mid}")
    later = [x.id for x, st in status(url) if x.id > mid and st is not False]
    if later:
        raise SystemExit(f"ต้องย้อนขั้นที่ใหม่กว่าก่อน: {', '.join(later)}")
    st = dict((x.id, s) for x, s in status(url))[mid]
    if st is False:
        print(f"ขั้น {mid} ยังไม่ได้ทำ ไม่มีอะไรต้องย้อน")
        return None
    if st is None:
        raise SystemExit(f"ขั้น {mid} ทำไปบางส่วน — หยุด กรุณาแจ้งผู้ดูแลระบบ")
    _check_sqlite_drop(url)
    if not skip_server_check and server_running(port):
        raise SystemExit("เซิร์ฟเวอร์ VORA ยังทำงานอยู่ — ปิดหน้าต่าง start.bat ก่อน แล้วรันใหม่")
    cols = [c for c, _ in m.columns]
    print(f"จะย้อนขั้น {m.id}: {m.title}")
    print(f"คอลัมน์ {', '.join(cols)} ในตาราง {m.table} จะถูกลบ · ข้อมูลในคอลัมน์เหล่านี้จะถูกส่งออกเป็นไฟล์ JSON และอยู่ในไฟล์สำรองก่อน")
    if not assume_yes and input("พิมพ์ YES เพื่อยืนยัน: ").strip() != "YES":
        raise SystemExit("ยกเลิก")
    bfile, breport = safe_backup(f"before-downgrade-{m.id}-", url)

    eng = create_engine(url)
    try:
        with eng.connect() as c:
            rows = [dict(r._mapping) for r in c.execute(text(
                f'SELECT id, {", ".join(chr(34) + x + chr(34) for x in cols)} FROM "{m.table}" WHERE '
                + " OR ".join(f'"{x}" IS NOT NULL' for x in cols) + " ORDER BY id"))]
            export = MIG_DIR / f"{m.table}-{m.id}-export-{datetime.now():%Y%m%d-%H%M%S}.json"
            export.write_text(json.dumps({"migration": m.id, "table": m.table, "columns": cols, "backup": bfile.name,
                                          "exported_at": datetime.now(), "rows": rows},
                                         ensure_ascii=False, indent=2, default=_json_default), encoding="utf-8")
            print(f"[3/4] ส่งออกข้อมูลสถานที่ {len(rows)} รายการ -> {export}")
            before = fingerprint(c, skip={m.table: set(cols)})
        with eng.begin() as c:
            for col in reversed(cols):
                c.execute(text(f'ALTER TABLE "{m.table}" DROP COLUMN "{col}"'))
        with eng.connect() as c:
            after = fingerprint(c)
            assert m.applied(inspect(c)) is False
    finally:
        eng.dispose()
    diff = [t for t in before if before[t] != after.get(t)]
    if diff:
        _log({"at": datetime.now(), "action": "downgrade", "migration": m.id, "ok": False, "diff": diff, "backup": bfile.name})
        raise SystemExit(f"ตรวจหลังย้อนพบข้อมูลเปลี่ยน ({', '.join(diff)}) — กู้คืนจาก {bfile}")
    total = sum(v["rows"] for v in after.values())
    print(f"[4/4] ย้อนขั้น {m.id} สำเร็จ · ข้อมูลอื่น {len(after)} ตาราง {total} แถว ไม่เปลี่ยนแปลง")
    print("หมายเหตุ: ต้องติดตั้งโค้ดรุ่นก่อน Phase 5 กลับด้วย ไม่เช่นนั้นเซิร์ฟเวอร์จะแจ้งให้รัน upgrade")
    _log({"at": datetime.now(), "action": "downgrade", "migration": m.id, "ok": True, "backup": bfile.name,
          "backup_sha256": breport["sha256"], "export": export.name, "exported_rows": len(rows)})
    return export


def main() -> None:
    ap = argparse.ArgumentParser(description="ปรับโครงสร้างฐานข้อมูล VORA")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    up = sub.add_parser("upgrade")
    dn = sub.add_parser("downgrade")
    dn.add_argument("migration")
    for p in (up, dn):
        p.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    url = backup_db.db_url()
    print(f"ฐานข้อมูล: {make_url(url).render_as_string(hide_password=True)}")
    try:
        if a.cmd == "status":
            for m, st in status(url):
                print(f"  {m.id}  {'ทำแล้ว' if st else 'ยังไม่ทำ' if st is False else 'ทำไปบางส่วน (ผิดปกติ)'}  {m.title}")
        elif a.cmd == "upgrade":
            upgrade(url, port=a.port)
        else:
            downgrade(url, a.migration, port=a.port)
    except BackupInvalid as e:
        raise SystemExit(f"{e}\nหยุด — ไม่ได้แก้ไขฐานข้อมูล") from None


if __name__ == "__main__":
    main()
