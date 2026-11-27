"""ติดตั้งและเชื่อมต่อ PostgreSQL ให้ VORA (เรียกผ่าน setup_postgres.bat)

ขั้นตอนที่สคริปต์ทำ:
 1. ตรวจว่ามี PostgreSQL ทำงานที่ localhost:5432 หรือไม่ ถ้าไม่มี (Windows) ติดตั้ง PostgreSQL 16 ด้วย winget
 2. สร้างผู้ใช้ฐานข้อมูล "vora" (รหัสผ่านสุ่ม) และฐานข้อมูล "vora" กับ "vora_test"
 3. บันทึก VORA_DATABASE_URL และ VORA_TEST_DATABASE_URL ลง .env (สำรอง .env เดิมไว้ก่อน)
 4. ย้ายข้อมูลเดิมจาก data\\vora.db ถ้ามี
 5. ทดสอบการเชื่อมต่อด้วยบัญชีของแอป

รันซ้ำได้อย่างปลอดภัย: ถ้ามีผู้ใช้/ฐานข้อมูลอยู่แล้วจะไม่สร้างซ้ำ (แต่จะตั้งรหัสผ่านของผู้ใช้ vora ใหม่ให้ตรงกับ .env)
"""
from __future__ import annotations

import argparse
import getpass
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from migrate_db import ROOT, default_sqlite_url, migrate, read_env  # noqa: E402

ENV_FILE = ROOT / ".env"
WINGET_ID = "PostgreSQL.PostgreSQL.16"
APP_USER = "vora"


def say(msg: str = "") -> None:
    print(msg, flush=True)


def ask_yes(question: str, default: bool = True, assume_yes: bool = False) -> bool:
    if assume_yes:
        return True
    hint = "[Y/n]" if default else "[y/N]"
    ans = input(f"{question} {hint}: ").strip().lower()
    return default if not ans else ans in ("y", "yes", "ใช่")


def port_open(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def wait_port(host: str, port: int, seconds: int) -> bool:
    end = time.time() + seconds
    while time.time() < end:
        if port_open(host, port):
            return True
        time.sleep(2)
    return False


def install_with_winget(super_pw: str, port: int) -> bool:
    if os.name != "nt":
        say("การติดตั้งอัตโนมัติรองรับเฉพาะ Windows — บน Linux ใช้: sudo apt install postgresql")
        return False
    if not shutil.which("winget"):
        say("ไม่พบ winget ในเครื่องนี้ ติดตั้ง PostgreSQL เองตาม docs/database.md หัวข้อ 'ติดตั้งเอง'")
        return False
    override = (f'--mode unattended --unattendedmodeui minimal --superpassword "{super_pw}" '
                f"--serverport {port} --disable-components stackbuilder")
    cmd = ["winget", "install", "-e", "--id", WINGET_ID, "--accept-package-agreements",
           "--accept-source-agreements", "--override", override]
    say(f"กำลังติดตั้ง {WINGET_ID} ด้วย winget (อาจใช้เวลา 3-10 นาที และ Windows อาจถามสิทธิ์ผู้ดูแลเครื่อง ให้กด Yes)...")
    r = subprocess.run(cmd)
    if r.returncode != 0:
        say(f"winget จบด้วยรหัส {r.returncode}")
    return wait_port("localhost", port, 120)


def connect_admin(host: str, port: int, user: str, password: str):
    import psycopg
    return psycopg.connect(host=host, port=port, user=user, password=password, dbname="postgres",
                           autocommit=True, connect_timeout=5)


def ensure_role_and_dbs(conn, app_pw: str, dbs: list[str]) -> None:
    from psycopg import sql
    exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (APP_USER,)).fetchone()
    if exists:
        conn.execute(sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(sql.Identifier(APP_USER), sql.Literal(app_pw)))
        say(f"  - ผู้ใช้ {APP_USER}: มีอยู่แล้ว ตั้งรหัสผ่านใหม่ให้ตรงกับ .env")
    else:
        conn.execute(sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD {}").format(sql.Identifier(APP_USER), sql.Literal(app_pw)))
        say(f"  - สร้างผู้ใช้ {APP_USER}")
    for name in dbs:
        if conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
            say(f"  - ฐานข้อมูล {name}: มีอยู่แล้ว")
        else:
            conn.execute(sql.SQL("CREATE DATABASE {} OWNER {} ENCODING 'UTF8' TEMPLATE template0").format(
                sql.Identifier(name), sql.Identifier(APP_USER)))
            say(f"  - สร้างฐานข้อมูล {name}")


def update_env(values: dict[str, str]) -> Path | None:
    """แทนค่าบรรทัดเดิมใน .env หรือต่อท้าย พร้อมสำรองไฟล์เดิม"""
    backup = None
    if ENV_FILE.exists():
        env_dir = ROOT / "_backups" / "env"          # เก็บ .env เดิมไว้ในโฟลเดอร์สำรอง ไม่ปนกับงาน
        env_dir.mkdir(parents=True, exist_ok=True)
        backup = env_dir / f".env.bak-{datetime.now():%Y%m%d-%H%M%S}"
        shutil.copy2(ENV_FILE, backup)
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    elif (ROOT / ".env.example").exists():
        lines = (ROOT / ".env.example").read_text(encoding="utf-8").splitlines()
    else:
        lines = []
    done: set[str] = set()
    out = []
    for line in lines:
        key = line.split("=", 1)[0].strip()
        if key in values and not line.lstrip().startswith("#"):
            out.append(f"{key}={values[key]}")
            done.add(key)
        else:
            out.append(line)
    missing = [k for k in values if k not in done]
    if missing:
        out += ["", "# ===== ฐานข้อมูล PostgreSQL (ตั้งค่าโดย setup_postgres.bat) ====="]
        out += [f"{k}={values[k]}" for k in missing]
    ENV_FILE.write_text("\n".join(out) + "\n", encoding="utf-8")
    return backup


def main() -> int:
    ap = argparse.ArgumentParser(description="ติดตั้งและเชื่อมต่อ PostgreSQL ให้ VORA")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=5432)
    ap.add_argument("--superuser", default="postgres")
    ap.add_argument("--superuser-password", default=os.environ.get("VORA_PG_SUPERPASSWORD", ""))
    ap.add_argument("--db", default="vora")
    ap.add_argument("--yes", action="store_true", help="ตอบใช่ทุกคำถาม (ใช้กับการติดตั้งอัตโนมัติ)")
    ap.add_argument("--no-migrate", action="store_true", help="ไม่ย้ายข้อมูลจาก data\\vora.db")
    a = ap.parse_args()

    try:
        import psycopg  # noqa: F401
    except ImportError:
        say("ไม่พบไดรเวอร์ psycopg — รัน setup.bat ใหม่ หรือ: pip install -r backend\\requirements.txt")
        return 1

    say("=" * 60)
    say("  VORA - ตั้งค่าฐานข้อมูล PostgreSQL")
    say("=" * 60)

    if port_open("localhost", 8000):
        say("[!] เซิร์ฟเวอร์ VORA กำลังทำงานอยู่ (พอร์ต 8000) กรุณาปิดหน้าต่าง start.bat ก่อน")
        if not a.yes:
            input("    ปิดแล้วกด Enter เพื่อทำต่อ...")

    super_pw = a.superuser_password
    if port_open(a.host, a.port):
        say(f"[1/5] พบ PostgreSQL ทำงานอยู่ที่ {a.host}:{a.port}")
    else:
        say(f"[1/5] ไม่พบ PostgreSQL ที่ {a.host}:{a.port}")
        if a.host not in ("localhost", "127.0.0.1") or not ask_yes("ติดตั้ง PostgreSQL 16 ลงเครื่องนี้อัตโนมัติ?", True, a.yes):
            say("ยกเลิก — ติดตั้ง PostgreSQL ตาม docs/database.md แล้วรันสคริปต์นี้อีกครั้ง")
            return 1
        while not super_pw:
            p1 = getpass.getpass("ตั้งรหัสผ่านผู้ดูแล PostgreSQL (postgres) อย่างน้อย 8 ตัว — จดเก็บไว้: ")
            p2 = getpass.getpass("พิมพ์รหัสผ่านอีกครั้ง: ")
            if len(p1) >= 8 and p1 == p2 and '"' not in p1:
                super_pw = p1
            else:
                say("รหัสผ่านไม่ตรงกัน สั้นเกินไป หรือมีเครื่องหมาย \" ลองใหม่")
        if not install_with_winget(super_pw, a.port):
            say("ติดตั้งไม่สำเร็จหรือบริการยังไม่เริ่ม — ดูวิธีติดตั้งเองใน docs/database.md")
            return 1
        say("ติดตั้ง PostgreSQL สำเร็จ บริการเริ่มทำงานแล้ว (เปิดอัตโนมัติทุกครั้งที่เปิดเครื่อง)")

    say(f"[2/5] เชื่อมต่อในฐานะผู้ดูแล ({a.superuser})")
    conn = None
    for attempt in range(3):
        if not super_pw:
            super_pw = getpass.getpass(f"รหัสผ่านของผู้ใช้ {a.superuser} ใน PostgreSQL: ")
        try:
            conn = connect_admin(a.host, a.port, a.superuser, super_pw)
            break
        except Exception as e:  # noqa: BLE001
            say(f"เชื่อมต่อไม่สำเร็จ: {str(e).strip().splitlines()[-1]}")
            super_pw = ""
            if a.yes:
                break
    if conn is None:
        return 1

    say("[3/5] สร้างผู้ใช้และฐานข้อมูลของ VORA")
    env = read_env()
    old_url = env.get("VORA_DATABASE_URL", "")
    app_pw = secrets.token_hex(16)        # ตัวอักษร 0-9a-f ไม่ต้องเข้ารหัสใน URL
    test_db = f"{a.db}_test"
    with conn:
        ensure_role_and_dbs(conn, app_pw, [a.db, test_db])
    url = f"postgresql+psycopg://{APP_USER}:{app_pw}@{a.host}:{a.port}/{a.db}"
    test_url = f"postgresql+psycopg://{APP_USER}:{app_pw}@{a.host}:{a.port}/{test_db}"
    backup = update_env({"VORA_DATABASE_URL": url, "VORA_TEST_DATABASE_URL": test_url})
    say(f"  - บันทึกการเชื่อมต่อลง .env แล้ว" + (f" (ไฟล์เดิมสำรองที่ _backups\\env\\{backup.name})" if backup else ""))

    say("[4/5] ย้ายข้อมูลเดิม")
    src = old_url if old_url.startswith("sqlite") else default_sqlite_url()
    src_file = Path(src.replace("sqlite:///", "", 1))
    if a.no_migrate:
        say("  - ข้าม (--no-migrate)")
    elif not src_file.exists():
        say("  - ไม่มีข้อมูลเดิม (data\\vora.db) ระบบจะสร้างข้อมูลเริ่มต้นให้ตอนเปิด start.bat")
    elif ask_yes(f"  ย้ายข้อมูลจาก {src_file.name} ({src_file.stat().st_size / 1e6:.1f} MB + WAL) ไป PostgreSQL?", True, a.yes):
        try:
            migrate(src, url, force=False, log=say)
        except SystemExit as e:
            say(f"  {e}")
            if "--force" in str(e) and ask_yes("  เขียนทับข้อมูลใน PostgreSQL ด้วยข้อมูลจาก SQLite?", False, a.yes):
                migrate(src, url, force=True, log=say)
            else:
                say("  - ไม่ได้ย้ายข้อมูล")
        say(f"  - ไฟล์ {src_file.name} เดิมยังอยู่ ใช้เป็นสำรองได้")

    say("[5/5] ทดสอบการเชื่อมต่อด้วยบัญชีของแอป")
    import psycopg
    with psycopg.connect(host=a.host, port=a.port, user=APP_USER, password=app_pw, dbname=a.db, connect_timeout=5) as c:
        ver = c.execute("show server_version").fetchone()[0]
    say(f"  - สำเร็จ: PostgreSQL {ver}")
    say("")
    say("เสร็จแล้ว! เปิด start.bat ได้เลย — หน้าหลังบ้าน > แดชบอร์ด จะแสดง 'ฐานข้อมูล: PostgreSQL'")
    say("สำรองข้อมูล: ดับเบิลคลิก backup_db.bat  |  คู่มือ: docs\\database.md")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        say("\nยกเลิกแล้ว")
        sys.exit(1)
