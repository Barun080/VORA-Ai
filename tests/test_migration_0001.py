"""Phase 5 · Gate 5B — migration 0001 (สถานที่จัดกิจกรรมในข่าว)

ทดสอบกับไฟล์ SQLite ชั่วคราวแยกจากฐานข้อมูลทดสอบหลัก (ไม่แตะข้อมูลจริง)
"""
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import backup_db  # noqa: E402
import migrate_schema  # noqa: E402
import verify_backup  # noqa: E402
from app.db import Base  # noqa: E402
from app.schema_guard import SchemaOutdated, check_schema, missing_columns  # noqa: E402

LOC = ["location", "location_type", "location_map_url"]
PROG = {"suits_th", "suits_en", "gallery"}       # ขั้น 0002 (มีอยู่แล้วใน fixture นี้ เพราะสร้างจากโค้ดรุ่นปัจจุบัน)
needs_drop = pytest.mark.skipif(sqlite3.sqlite_version_info < (3, 35, 0), reason="SQLite < 3.35 ลบคอลัมน์ไม่ได้")


@pytest.fixture
def old_db(tmp_path, monkeypatch):
    """ฐานข้อมูลโครงสร้างก่อน Phase 5 พร้อมข่าวเดิม 3 รายการ"""
    db = tmp_path / "old.db"
    url = f"sqlite:///{db.as_posix()}"
    eng = create_engine(url)
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        for col in LOC:
            c.execute(text(f'ALTER TABLE news DROP COLUMN "{col}"'))
        for i in range(3):
            c.execute(text("INSERT INTO news (kind, title_th, title_en, body_th, body_en, image_url, video_url, priority,"
                           " status, event_date, created_by, approved_by, view_count, created_at, updated_at) VALUES"
                           " ('activity', :t, '', 'เนื้อหา\nบรรทัดสอง', '', '', '', 3, 'published', :d, 'admin', '', 0, :d, :d)"),
                      {"t": f"ข่าวเดิม {i}", "d": datetime(2026, 11, 10 + i).isoformat(sep=" ")})   # รูปแบบเดียวกับที่ SQLAlchemy เก็บใน SQLite
    eng.dispose()
    bdir = tmp_path / "backups"
    monkeypatch.setenv("VORA_DATABASE_URL", url)
    monkeypatch.setattr(backup_db, "BACKUP_DIR", bdir)
    monkeypatch.setattr(migrate_schema, "MIG_DIR", bdir / "migrations")
    return url


def _cols(url):
    eng = create_engine(url)
    try:
        return {c["name"] for c in inspect(eng).get_columns("news")}
    finally:
        eng.dispose()


def _fp(url, skip=None):
    eng = create_engine(url)
    try:
        with eng.connect() as c:
            return migrate_schema.fingerprint(c, skip)
    finally:
        eng.dispose()


def test_guard_blocks_old_schema_without_changing_it(old_db):
    eng = create_engine(old_db)
    assert missing_columns(eng) == {"news": LOC}
    with pytest.raises(SchemaOutdated, match="migrate.bat upgrade"):
        check_schema(eng)
    eng.dispose()
    assert not set(LOC) & _cols(old_db)


def test_upgrade_adds_nullable_columns_and_keeps_data(old_db):
    before = _fp(old_db)
    done = migrate_schema.upgrade(old_db, skip_server_check=True)
    assert done == ["0001"]
    eng = create_engine(old_db)
    cols = {c["name"]: c for c in inspect(eng).get_columns("news")}
    assert all(cols[c]["nullable"] for c in LOC)
    check_schema(eng)                                   # ผ่านแล้ว
    with eng.connect() as c:
        assert c.execute(text("SELECT COUNT(*) FROM news WHERE location IS NOT NULL OR location_type IS NOT NULL"
                              " OR location_map_url IS NOT NULL")).scalar_one() == 0
    eng.dispose()
    assert _fp(old_db, {"news": set(LOC)}) == before
    mig = backup_db.BACKUP_DIR / "migrations"
    backups = list(mig.glob("vora-before-migrate-0001-*.db"))
    assert len(backups) == 1 and Path(f"{backups[0]}.verify.json").exists()
    log = [json.loads(x) for x in (mig / "migration-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert log[-1]["action"] == "upgrade" and log[-1]["ok"] is True


def test_upgrade_is_idempotent(old_db):
    migrate_schema.upgrade(old_db, skip_server_check=True)
    assert migrate_schema.upgrade(old_db, skip_server_check=True) == []
    assert len(list((backup_db.BACKUP_DIR / "migrations").glob("vora-*.db"))) == 1   # ไม่สำรองซ้ำเมื่อไม่มีงาน


@needs_drop
def test_downgrade_exports_location_then_restores_old_schema(old_db):
    before = _fp(old_db, {"programs": PROG, "news": {"gallery"}})
    migrate_schema.upgrade(old_db, skip_server_check=True)
    eng = create_engine(old_db)
    with eng.begin() as c:
        c.execute(text("UPDATE news SET location='หอประชุม', location_type='campus' WHERE title_th='ข่าวเดิม 0'"))
    eng.dispose()
    with pytest.raises(SystemExit, match="0002"):                 # ต้องย้อนขั้นที่ใหม่กว่าก่อน
        migrate_schema.downgrade(old_db, "0001", skip_server_check=True, assume_yes=True)
    migrate_schema.downgrade(old_db, "0003", skip_server_check=True, assume_yes=True)   # 12 พ.ย. 2569: ย้อน 0003 ก่อน
    migrate_schema.downgrade(old_db, "0002", skip_server_check=True, assume_yes=True)
    export = migrate_schema.downgrade(old_db, "0001", skip_server_check=True, assume_yes=True)
    assert not set(LOC) & _cols(old_db)
    assert _fp(old_db, {"programs": PROG, "news": {"gallery"}}) == before                       # ข้อมูลเดิมทุกตารางเหมือนก่อน upgrade
    data = json.loads(export.read_text(encoding="utf-8"))
    assert data["columns"] == LOC and len(data["rows"]) == 1
    assert data["rows"][0]["location"] == "หอประชุม" and data["rows"][0]["location_type"] == "campus"
    assert list((backup_db.BACKUP_DIR / "migrations").glob("vora-before-downgrade-0001-*.db"))


def test_downgrade_requires_yes(old_db, monkeypatch):
    migrate_schema.upgrade(old_db, skip_server_check=True)
    monkeypatch.setattr("builtins.input", lambda *_: "no")
    migrate_schema.downgrade(old_db, "0003", skip_server_check=True, assume_yes=True)   # 12 พ.ย. 2569: ย้อน 0003 ก่อน
    migrate_schema.downgrade(old_db, "0002", skip_server_check=True, assume_yes=True)
    with pytest.raises(SystemExit, match="ยกเลิก"):
        migrate_schema.downgrade(old_db, "0001", skip_server_check=True)
    assert set(LOC) <= _cols(old_db)


def test_partial_state_stops_without_changes(old_db):
    eng = create_engine(old_db)
    with eng.begin() as c:
        c.execute(text('ALTER TABLE news ADD COLUMN "location" VARCHAR(255)'))
    eng.dispose()
    with pytest.raises(SystemExit, match="บางส่วน"):
        migrate_schema.upgrade(old_db, skip_server_check=True)
    assert _cols(old_db) & set(LOC) == {"location"}
    assert not (backup_db.BACKUP_DIR / "migrations").exists()


def test_invalid_backup_stops_before_migration(old_db, monkeypatch):
    def broken(tag="", keep=None, out_dir=None):
        p = (out_dir or backup_db.BACKUP_DIR) / f"vora-{tag}broken.db"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"not a database" * 100)
        return p
    monkeypatch.setattr(backup_db, "backup", broken)
    with pytest.raises(verify_backup.BackupInvalid):
        migrate_schema.upgrade(old_db, skip_server_check=True)
    assert not set(LOC) & _cols(old_db)


def test_server_running_blocks_upgrade(old_db, monkeypatch):
    monkeypatch.setattr(migrate_schema, "server_running", lambda port=8000: True)
    with pytest.raises(SystemExit, match="start.bat"):
        migrate_schema.upgrade(old_db)
    assert not set(LOC) & _cols(old_db)


def test_verify_backup_detects_row_mismatch(old_db):
    good = backup_db.backup(tag="t-")
    assert verify_backup.verify(good, old_db, quiet=True)["ok"]
    eng = create_engine(old_db)
    with eng.begin() as c:
        c.execute(text("DELETE FROM news WHERE title_th='ข่าวเดิม 2'"))
    eng.dispose()
    with pytest.raises(verify_backup.BackupInvalid, match="news"):
        verify_backup.verify(good, old_db, quiet=True)


# ---------------------------------------------------------------- Windows file lock (WinError 32) — 1 พ.ย. 2569
def _held(path: Path) -> bool:
    """ไฟล์ยังถูกเปิดค้างใน process นี้หรือไม่
    Linux: ดู /proc/self/fd · Windows: ไฟล์ที่ยังเปิดอยู่เปลี่ยนชื่อไม่ได้ (WinError 32) จึงลองเปลี่ยนชื่อแล้วเปลี่ยนกลับ"""
    target = str(Path(path).resolve())
    fd_dir = Path("/proc/self/fd")
    if fd_dir.is_dir():
        for fd in os.listdir(fd_dir):
            try:
                if os.readlink(fd_dir / fd) == target:
                    return True
            except OSError:
                continue
        return False
    probe = Path(f"{target}.lockprobe")
    try:
        os.replace(target, probe)
    except PermissionError:
        return True
    os.replace(probe, target)
    return False


def test_sqlite_backup_releases_all_file_handles(old_db):
    """ต้นเหตุ WinError 32: backup() ต้องปิดการเชื่อมต่อทั้งต้นทางและไฟล์สำรองก่อนคืนค่า (ไม่พึ่ง garbage collector)"""
    src = Path(old_db.replace("sqlite:///", ""))
    out = backup_db.backup(tag="h-")
    assert out.exists() and out.stat().st_size > 0
    assert not _held(out), "ไฟล์สำรองยังถูกเปิดค้าง"
    assert not _held(src), "ฐานข้อมูลต้นทางยังถูกเปิดค้าง"
    moved = out.with_name(out.name + ".moved")
    os.replace(out, moved)                 # ย้ายได้ทันที (บน Windows จะล้มถ้ายังมี handle ค้าง)
    assert moved.exists() and not out.exists()


def test_migration_backup_written_directly_and_verified(old_db):
    """ไฟล์สำรองของ migration เขียนลง migrations/ โดยตรง ไม่มีการย้าย/ลบไฟล์ และไม่มี handle ค้างหลัง upgrade"""
    migrate_schema.upgrade(old_db, skip_server_check=True)
    mig = backup_db.BACKUP_DIR / "migrations"
    files = list(mig.glob("vora-before-migrate-0001-*.db"))
    assert len(files) == 1
    assert not list(backup_db.BACKUP_DIR.glob("vora-*.db"))            # ไม่มีไฟล์ค้างในโฟลเดอร์หลัก
    report = json.loads(Path(f"{files[0]}.verify.json").read_text(encoding="utf-8"))
    assert report["ok"] is True and report["sha256"] == verify_backup.sha256(files[0])   # ไฟล์ที่ตรวจ = ไฟล์ที่เก็บ
    assert not _held(files[0])
    assert not _held(Path(old_db.replace("sqlite:///", "")))


def test_default_backup_location_and_prune_unchanged(old_db):
    """backup_db.bat เดิม: ไม่ระบุโฟลเดอร์ = BACKUP_DIR และยังเก็บ KEEP ไฟล์ล่าสุดเหมือนเดิม"""
    out = backup_db.backup()
    assert out.parent == backup_db.BACKUP_DIR
    assert not _held(out)
