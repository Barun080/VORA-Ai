"""migration 0003 (12 พ.ย. 2569): ตาราง news เพิ่ม gallery (TEXT) — ข่าวเดิมไม่เปลี่ยน · ย้อนกลับได้"""
from __future__ import annotations

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

needs_drop = pytest.mark.skipif(sqlite3.sqlite_version_info < (3, 35, 0), reason="SQLite < 3.35 ลบคอลัมน์ไม่ได้")


@pytest.fixture
def db_0002(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'n.db').as_posix()}"
    eng = create_engine(url)
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        c.execute(text('ALTER TABLE news DROP COLUMN "gallery"'))
        for i in range(3):
            c.execute(text("INSERT INTO news (kind, title_th, title_en, body_th, body_en, image_url, video_url, priority, status, created_by,"
                           " approved_by, view_count, created_at, updated_at) VALUES ('news', :t, '', 'เนื้อหา', '', '/a.png', '', 3, 'published', 'x', 'x', 0,"
                           " '2026-11-01 00:00:00', '2026-11-01 00:00:00')"), {"t": f"ข่าวเดิม {i}"})
    eng.dispose()
    monkeypatch.setenv("VORA_DATABASE_URL", url)
    monkeypatch.setattr(backup_db, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(migrate_schema, "MIG_DIR", tmp_path / "backups" / "migrations")
    return url


@needs_drop
def test_0003_upgrade_keeps_news_and_downgrade_restores(db_0002):
    eng = create_engine(db_0002)
    assert missing_columns(eng) == {"news": ["gallery"]}
    with eng.connect() as c:
        before = migrate_schema.fingerprint(c)
    eng.dispose()
    assert migrate_schema.upgrade(db_0002, skip_server_check=True) == ["0003"]
    eng = create_engine(db_0002)
    cols = {c["name"]: c for c in inspect(eng).get_columns("news")}
    assert cols["gallery"]["nullable"] and missing_columns(eng) == {}
    with eng.connect() as c:
        assert migrate_schema.fingerprint(c, {"news": {"gallery"}}) == before          # ข่าวเดิมไม่เปลี่ยน
    eng.dispose()
    migrate_schema.downgrade(db_0002, "0003", skip_server_check=True, assume_yes=True)
    eng = create_engine(db_0002)
    assert missing_columns(eng) == {"news": ["gallery"]}
    with eng.connect() as c:
        assert migrate_schema.fingerprint(c) == before
    eng.dispose()
