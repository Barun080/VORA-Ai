"""11 พ.ย. 2569 — migration 0002 (ข้อมูลพรีเซนเทชันสาขา: suits_th, suits_en, gallery) · SQLite ชั่วคราว ไม่แตะข้อมูลจริง"""
import sqlite3
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import backup_db  # noqa: E402
import migrate_schema  # noqa: E402
from app.db import Base  # noqa: E402
from app.schema_guard import missing_columns  # noqa: E402

PROG = ["suits_th", "suits_en", "gallery"]
needs_drop = pytest.mark.skipif(sqlite3.sqlite_version_info < (3, 35, 0), reason="SQLite < 3.35 ลบคอลัมน์ไม่ได้")


@pytest.fixture
def db_0001(tmp_path, monkeypatch):
    """โครงสร้างหลังขั้น 0001 (ก่อน 0002) พร้อมสาขาเดิม 2 สาขา"""
    url = f"sqlite:///{(tmp_path / 'p.db').as_posix()}"
    eng = create_engine(url)
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        for col in PROG:
            c.execute(text(f'ALTER TABLE programs DROP COLUMN "{col}"'))
        for i in range(2):
            c.execute(text("INSERT INTO programs (code, level, department, name_th, name_en, description_th, description_en, careers_th,"
                           " careers_en, keywords, image_url, video_url, status, view_count, created_at, updated_at) VALUES"
                           " (:c, 'ปวช.', '', :n, '', 'เรียน', '', 'อาชีพ', '', '', '', '', 'published', 0, '2026-11-01 00:00:00', '2026-11-01 00:00:00')"),
                      {"c": f"P{i}", "n": f"สาขาเดิม {i}"})
    eng.dispose()
    monkeypatch.setenv("VORA_DATABASE_URL", url)
    monkeypatch.setattr(backup_db, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(migrate_schema, "MIG_DIR", tmp_path / "backups" / "migrations")
    return url


@needs_drop
def test_0002_upgrade_adds_nullable_columns_keeps_programs(db_0001):
    eng = create_engine(db_0001)
    assert missing_columns(eng) == {"programs": PROG}
    with eng.connect() as c:
        before = migrate_schema.fingerprint(c)
    eng.dispose()
    assert migrate_schema.upgrade(db_0001, skip_server_check=True) == ["0002"]
    eng = create_engine(db_0001)
    cols = {c["name"]: c for c in inspect(eng).get_columns("programs")}
    assert all(cols[c]["nullable"] for c in PROG) and missing_columns(eng) == {}
    with eng.connect() as c:
        assert migrate_schema.fingerprint(c, {"programs": set(PROG)}) == before     # สาขาเดิมไม่เปลี่ยน
    eng.dispose()


@needs_drop
def test_0002_downgrade_restores_schema(db_0001):
    migrate_schema.upgrade(db_0001, skip_server_check=True)
    migrate_schema.downgrade(db_0001, "0003", skip_server_check=True, assume_yes=True)   # 12 พ.ย. 2569: ย้อน 0003 ก่อน
    migrate_schema.downgrade(db_0001, "0002", skip_server_check=True, assume_yes=True)
    eng = create_engine(db_0001)
    assert missing_columns(eng) == {"programs": PROG, "news": ["gallery"]}
    eng.dispose()
