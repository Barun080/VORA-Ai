"""สำรองและกู้คืนฐานข้อมูล VORA (รองรับ PostgreSQL และ SQLite)

    python scripts\\backup_db.py                    # สำรองตอนนี้ -> _backups\\database\\
    python scripts\\backup_db.py --list             # ดูรายการไฟล์สำรอง
    python scripts\\backup_db.py --restore <ไฟล์>   # กู้คืน (ปิด start.bat ก่อน)

PostgreSQL ใช้ pg_dump/pg_restore ที่ติดตั้งมาพร้อม PostgreSQL, SQLite ใช้ backup API ของ sqlite3
เก็บไฟล์สำรองล่าสุดไว้ KEEP ไฟล์ ไฟล์ที่เก่ากว่านั้นจะถูกลบอัตโนมัติ
"""
from __future__ import annotations

import argparse
import contextlib
import glob
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from migrate_db import ROOT, default_sqlite_url, read_env  # noqa: E402

from sqlalchemy.engine import make_url  # noqa: E402

BACKUP_DIR = ROOT / "_backups" / "database"   # ไฟล์สำรองทุกชนิดอยู่ในโฟลเดอร์ _backups แยกจากงาน
KEEP = 30


def db_url() -> str:
    return (os.environ.get("VORA_DATABASE_URL") or read_env().get("VORA_DATABASE_URL", "")).strip() or default_sqlite_url()


def find_pg_tool(name: str) -> str:
    exe = shutil.which(name)
    if exe:
        return exe
    if os.name == "nt":
        found = sorted(glob.glob(rf"C:\Program Files\PostgreSQL\*\bin\{name}.exe"),
                       key=lambda p: int(Path(p).parents[1].name) if Path(p).parents[1].name.isdigit() else 0)
        if found:
            return found[-1]
    raise SystemExit(f"ไม่พบโปรแกรม {name} (มากับการติดตั้ง PostgreSQL) — ตรวจว่าติดตั้ง Command Line Tools แล้ว")


def pg_env_args(url: str) -> tuple[dict, list[str]]:
    u = make_url(url)
    env = dict(os.environ, PGPASSWORD=u.password or "")
    args = ["-h", u.host or "localhost", "-p", str(u.port or 5432), "-U", u.username or "postgres"]
    return env, args


def prune(keep: Path | None = None) -> None:
    files = sorted(BACKUP_DIR.glob("vora-*.*"), key=lambda p: p.stat().st_mtime)
    for old in files[:-KEEP]:
        if keep is None or old.resolve() != keep.resolve():
            old.unlink()


def _new_path(tag: str, ext: str, out_dir: Path | None = None) -> Path:
    """ชื่อไฟล์ไม่ซ้ำเสมอ (ป้องกันการเขียนทับไฟล์สำรองที่กำลังจะกู้คืน)"""
    out_dir = out_dir or BACKUP_DIR
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = out_dir / f"vora-{tag}{stamp}{ext}"
    n = 2
    while out.exists():
        out = out_dir / f"vora-{tag}{stamp}-{n}{ext}"
        n += 1
    return out


def backup(tag: str = "", keep: Path | None = None, out_dir: Path | None = None) -> Path:
    """สำรองฐานข้อมูลปัจจุบัน · out_dir = โฟลเดอร์ปลายทาง (ค่าเริ่มต้น BACKUP_DIR ซึ่งเก็บ KEEP ไฟล์ล่าสุด;
    โฟลเดอร์อื่นไม่ถูกลบไฟล์เก่าอัตโนมัติ) · คืนพาธไฟล์ที่ปิดเรียบร้อยแล้ว (ไม่มี handle ค้าง ย้าย/เปิดอ่านต่อได้ทันทีบน Windows)"""
    url = db_url()
    out_dir = out_dir or BACKUP_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    u = make_url(url)
    if u.get_backend_name() == "postgresql":
        out = _new_path(tag, ".dump", out_dir)
        env, args = pg_env_args(url)
        r = subprocess.run([find_pg_tool("pg_dump"), *args, "-d", u.database, "-Fc", "-f", str(out)], env=env)
        if r.returncode != 0:
            raise SystemExit("pg_dump ล้มเหลว — ตรวจว่าบริการ PostgreSQL ทำงานอยู่")
    else:
        src = Path(u.database)
        if not src.exists():
            raise SystemExit(f"ไม่พบไฟล์ฐานข้อมูล {src}")
        out = _new_path(tag, ".db", out_dir)
        # with sqlite3.connect(...) อย่างเดียว "ไม่ปิด" การเชื่อมต่อ (แค่ commit) และ Connection มีวงอ้างอิงภายใน
        # จึงค้างจนกว่า garbage collector จะทำงาน — บน Windows ไฟล์ถูกล็อก (WinError 32) ต้องปิดเองเสมอ
        with contextlib.closing(sqlite3.connect(src)) as s, contextlib.closing(sqlite3.connect(out)) as d:
            s.backup(d)          # ได้ข้อมูลครบรวมส่วนที่อยู่ใน WAL แม้เซิร์ฟเวอร์กำลังทำงาน
    if out_dir.resolve() == BACKUP_DIR.resolve():
        prune(keep)
    return out


def restore(path: str) -> None:
    f = Path(path)
    if not f.is_absolute() and not f.exists():
        f = BACKUP_DIR / path
    if not f.exists():
        raise SystemExit(f"ไม่พบไฟล์ {path}")
    url = db_url()
    u = make_url(url)
    print(f"จะกู้คืน {f.name} ทับข้อมูลปัจจุบันใน {u.render_as_string(hide_password=True)}")
    print("ข้อมูลที่เพิ่มหลังเวลาสำรองจะหายไป — ระบบจะสำรองข้อมูลปัจจุบันให้ก่อนอัตโนมัติ")
    if input("พิมพ์ YES เพื่อยืนยัน: ").strip() != "YES":
        raise SystemExit("ยกเลิก")
    safety = backup(tag="before-restore-", keep=f)
    assert safety.resolve() != f.resolve()
    print(f"สำรองข้อมูลปัจจุบันไว้ที่ {safety.name}")
    if u.get_backend_name() == "postgresql":
        if f.suffix != ".dump":
            raise SystemExit("ฐานข้อมูลปัจจุบันเป็น PostgreSQL ต้องใช้ไฟล์ .dump (ถ้าจะนำเข้าจาก .db ใช้ migrate_db.py --force)")
        env, args = pg_env_args(url)
        r = subprocess.run([find_pg_tool("pg_restore"), *args, "-d", u.database, "--clean", "--if-exists",
                            "--no-owner", "--single-transaction", str(f)], env=env)
        if r.returncode != 0:
            raise SystemExit("pg_restore ล้มเหลว ข้อมูลเดิมไม่ถูกเปลี่ยนแปลง")
    else:
        if f.suffix != ".db":
            raise SystemExit("ฐานข้อมูลปัจจุบันเป็น SQLite ต้องใช้ไฟล์ .db")
        dst = Path(u.database)
        for extra in (Path(f"{dst}-wal"), Path(f"{dst}-shm")):
            if extra.exists():
                extra.unlink()
        shutil.copy2(f, dst)
    print("กู้คืนสำเร็จ เปิด start.bat ได้เลย")


def main() -> None:
    ap = argparse.ArgumentParser(description="สำรอง/กู้คืนฐานข้อมูล VORA")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--restore", metavar="FILE")
    a = ap.parse_args()
    if a.list:
        files = sorted(BACKUP_DIR.glob("vora-*.*"))
        for p in files:
            print(f"{p.name}  {p.stat().st_size / 1e6:.2f} MB")
        print(f"รวม {len(files)} ไฟล์ ใน {BACKUP_DIR}")
    elif a.restore:
        restore(a.restore)
    else:
        out = backup()
        print(f"สำรองสำเร็จ: {out}  ({out.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
