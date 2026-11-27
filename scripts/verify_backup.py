"""ตรวจความสมบูรณ์ของไฟล์สำรองฐานข้อมูล VORA (ไม่แก้ไขฐานข้อมูลใด ๆ)

    python scripts\\verify_backup.py <ไฟล์สำรอง>     # ตรวจไฟล์ที่ระบุ เทียบกับฐานข้อมูลปัจจุบัน
    python scripts\\verify_backup.py --latest        # ตรวจไฟล์สำรองล่าสุด

PostgreSQL (.dump):
  1. pg_restore --list ต้องอ่านสารบัญได้ และมีข้อมูล (TABLE DATA) ครบทุกตารางของฐานข้อมูลปัจจุบัน
  2. pg_restore -f - (กู้แบบสตรีมออกเป็นข้อความ ไม่เขียนลงฐานข้อมูลใด) แล้วนับแถว COPY ทีละตาราง
     จำนวนแถวต้องเท่ากับฐานข้อมูลปัจจุบันทุกตาราง
SQLite (.db):
  1. PRAGMA integrity_check ต้องได้ ok
  2. จำนวนแถวทุกตารางต้องเท่ากับฐานข้อมูลปัจจุบัน
ทั้งสองแบบบันทึก SHA-256 ของไฟล์และผลตรวจไว้ใน <ไฟล์>.verify.json

ควรตรวจขณะปิด start.bat (ถ้าเซิร์ฟเวอร์เขียนข้อมูลระหว่างตรวจ จำนวนแถวอาจต่างได้)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backup_db import BACKUP_DIR, db_url, find_pg_tool, pg_env_args  # noqa: E402

from sqlalchemy import create_engine, inspect, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

_COPY = re.compile(r'^COPY (?:"?(\w+)"?\.)?"?(\w+)"? .*FROM stdin;$')


class BackupInvalid(SystemExit):
    """ไฟล์สำรองไม่ผ่านการตรวจ — ห้ามทำขั้นตอนถัดไป"""


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def live_counts(url: str) -> dict[str, int]:
    eng = create_engine(url)
    try:
        with eng.connect() as c:
            names = inspect(c).get_table_names()
            return {t: c.execute(text(f'SELECT COUNT(*) FROM "{t}"')).scalar_one() for t in sorted(names)}
    finally:
        eng.dispose()


def pg_dump_counts(path: Path, url: str) -> tuple[list[str], dict[str, int]]:
    """คืน (ตารางที่มี TABLE DATA ในสารบัญ, จำนวนแถวที่นับได้จากการกู้แบบสตรีม)"""
    exe = find_pg_tool("pg_restore")
    env, _ = pg_env_args(url)
    r = subprocess.run([exe, "--list", str(path)], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise BackupInvalid(f"อ่านสารบัญไฟล์สำรองไม่ได้ (pg_restore --list): {r.stderr.strip()[:300]}")
    listed = sorted({m.group(1) for m in re.finditer(r"TABLE DATA \S+ (\S+) ", r.stdout)})

    counts: dict[str, int] = {}
    p = subprocess.Popen([exe, "--data-only", "-f", "-", str(path)], env=env, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE)
    current = None
    assert p.stdout is not None
    for raw in p.stdout:
        line = raw.rstrip(b"\r\n")
        if current is None:
            if line.startswith(b"COPY "):
                m = _COPY.match(line.decode("utf-8", "replace"))
                if m:
                    current = m.group(2)
                    counts[current] = 0
        elif line == b"\\.":
            current = None
        else:
            counts[current] += 1      # รูปแบบ COPY ข้อความ: 1 บรรทัด = 1 แถว (ขึ้นบรรทัดใหม่ในข้อมูลถูก escape เป็น \n)
    err = p.stderr.read().decode("utf-8", "replace") if p.stderr else ""
    if p.wait() != 0 or current is not None:
        raise BackupInvalid(f"กู้ข้อมูลจากไฟล์สำรองไม่สำเร็จ (ไฟล์อาจเสียหรือไม่ครบ): {err.strip()[:300]}")
    return listed, counts


def sqlite_counts(path: Path) -> dict[str, int]:
    con = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)   # as_uri เข้ารหัสช่องว่าง/ภาษาไทย/#/? ในพาธให้
    try:
        ok = con.execute("PRAGMA integrity_check").fetchone()[0]
        if ok != "ok":
            raise BackupInvalid(f"ไฟล์สำรอง SQLite ไม่สมบูรณ์: {ok}")
        names = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {t: con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in sorted(names)}
    except sqlite3.DatabaseError as e:
        raise BackupInvalid(f"เปิดไฟล์สำรอง SQLite ไม่ได้: {e}") from e
    finally:
        con.close()


def verify(path: Path, url: str | None = None, quiet: bool = False) -> dict:
    """ตรวจไฟล์สำรองเทียบฐานข้อมูล url · ไม่ผ่าน -> BackupInvalid · ผ่าน -> คืนรายงานและเขียน .verify.json"""
    url = url or db_url()
    path = Path(path)
    if not path.exists() or path.stat().st_size == 0:
        raise BackupInvalid(f"ไม่พบไฟล์สำรองหรือไฟล์ว่าง: {path}")
    backend = make_url(url).get_backend_name()
    live = live_counts(url)
    problems: list[str] = []
    if backend == "postgresql":
        if path.suffix != ".dump":
            raise BackupInvalid("ฐานข้อมูลเป็น PostgreSQL ต้องตรวจไฟล์ .dump")
        listed, dumped = pg_dump_counts(path, url)
        for t in live:
            if t not in listed:
                problems.append(f"ตาราง {t}: ไม่มีข้อมูลในสารบัญไฟล์สำรอง")
    else:
        if path.suffix != ".db":
            raise BackupInvalid("ฐานข้อมูลเป็น SQLite ต้องตรวจไฟล์ .db")
        dumped = sqlite_counts(path)
    for t, n in live.items():
        got = dumped.get(t)
        if got is None:
            problems.append(f"ตาราง {t}: ไม่พบในไฟล์สำรอง")
        elif got != n:
            problems.append(f"ตาราง {t}: ไฟล์สำรอง {got} แถว แต่ฐานข้อมูล {n} แถว")
    for t in dumped:
        if t not in live:
            problems.append(f"ตาราง {t}: มีในไฟล์สำรองแต่ไม่มีในฐานข้อมูล")
    report = {
        "file": path.name, "bytes": path.stat().st_size, "sha256": sha256(path),
        "database": make_url(url).render_as_string(hide_password=True), "backend": backend,
        "checked_at": datetime.now().isoformat(timespec="seconds"),
        "tables": {t: {"live": live[t], "backup": dumped.get(t)} for t in live},
        "total_rows": sum(live.values()), "ok": not problems, "problems": problems,
    }
    Path(f"{path}.verify.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not quiet:
        for t, v in report["tables"].items():
            mark = "OK " if v["live"] == v["backup"] else "ERR"
            print(f"  {mark} {t:<18} ฐานข้อมูล {v['live']:>6}  ไฟล์สำรอง {v['backup'] if v['backup'] is not None else '-':>6}")
        print(f"  SHA-256 {report['sha256']}")
    if problems:
        raise BackupInvalid("ไฟล์สำรองไม่ผ่านการตรวจ:\n  - " + "\n  - ".join(problems))
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description="ตรวจไฟล์สำรองฐานข้อมูล VORA")
    ap.add_argument("file", nargs="?")
    ap.add_argument("--latest", action="store_true")
    a = ap.parse_args()
    if a.latest:
        files = sorted((p for pat in ("vora-*.dump", "vora-*.db", "migrations/vora-*.dump", "migrations/vora-*.db")
                        for p in BACKUP_DIR.glob(pat)), key=lambda p: p.stat().st_mtime)
        if not files:
            raise SystemExit("ยังไม่มีไฟล์สำรอง")
        f = files[-1]
    elif a.file:
        f = Path(a.file)
        if not f.exists():
            f = BACKUP_DIR / a.file
    else:
        ap.error("ระบุไฟล์ หรือใช้ --latest")
    print(f"ตรวจ {f}")
    r = verify(f)
    print(f"ผ่าน: {len(r['tables'])} ตาราง {r['total_rows']} แถว ตรงกับฐานข้อมูลทุกตาราง")


if __name__ == "__main__":
    main()
