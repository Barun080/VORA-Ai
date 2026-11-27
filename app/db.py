"""การเชื่อมต่อฐานข้อมูล รองรับทั้ง PostgreSQL (แนะนำสำหรับใช้งานจริง) และ SQLite (สำรอง/ทดสอบ)

เลือกฐานข้อมูลด้วย VORA_DATABASE_URL ในไฟล์ .env
  PostgreSQL: postgresql+psycopg://vora:รหัสผ่าน@localhost:5432/vora
  SQLite:     sqlite:///C:/VORA_Robot/data/vora.db   (ค่าเริ่มต้นเมื่อไม่ได้ตั้งค่า)
"""
from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from sqlalchemy import String, create_engine, event, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

log = logging.getLogger("vora.db")


class Base(DeclarativeBase):
    pass


_url = make_url(settings.database_url)
_is_sqlite = _url.get_backend_name() == "sqlite"
DIALECT = _url.get_backend_name()        # "postgresql" | "sqlite"

if _is_sqlite:
    engine = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False, "timeout": 15},
        pool_pre_ping=True,
    )

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):  # pragma: no cover - ตั้งค่าครั้งเดียว
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")      # อ่าน/เขียนพร้อมกันได้ ลดอาการ database locked
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
else:
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,          # ตรวจการเชื่อมต่อก่อนใช้ ถ้า PostgreSQL รีสตาร์ทระบบจะต่อใหม่เอง
        pool_size=10, max_overflow=20, pool_timeout=30, pool_recycle=1800,
        connect_args={"connect_timeout": 5, "application_name": "vora"},
    )

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@event.listens_for(SessionLocal, "before_flush")
def _fit_strings(session: Session, _ctx, _instances) -> None:
    """ทำให้ข้อมูลข้อความบันทึกได้เหมือนกันทุกฐานข้อมูล

    PostgreSQL ปฏิเสธข้อความที่ยาวเกินขนาดคอลัมน์และอักขระ NUL (\\x00) ขณะที่ SQLite ยอมรับเงียบๆ
    จึงตัดความยาวให้พอดีคอลัมน์และลบอักขระ NUL ก่อนบันทึก เพื่อไม่ให้คำขอล้มด้วย error 500
    """
    for obj in list(session.new) + list(session.dirty):
        state = inspect(obj)
        for attr in state.mapper.column_attrs:
            value = getattr(obj, attr.key, None)
            if not isinstance(value, str):
                continue
            new = value.replace("\x00", "") if "\x00" in value else value
            col_type = attr.columns[0].type
            limit = getattr(col_type, "length", None) if isinstance(col_type, String) else None
            if limit and len(new) > limit:
                log.warning("ตัดข้อความ %s.%s จาก %d เหลือ %d ตัวอักษร", state.mapper.class_.__name__,
                            attr.key, len(new), limit)
                new = new[:limit]
            if new is not value:
                setattr(obj, attr.key, new)


def wait_for_db(timeout_s: float = 60.0) -> None:
    """รอให้ฐานข้อมูลพร้อม (ตอนเปิดเครื่อง บริการ PostgreSQL อาจเริ่มช้ากว่าเซิร์ฟเวอร์ VORA)"""
    deadline = time.monotonic() + timeout_s
    attempt = 0
    while True:
        attempt += 1
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            if attempt > 1:
                log.info("เชื่อมต่อฐานข้อมูลสำเร็จหลังลอง %d ครั้ง", attempt)
            return
        except Exception as e:  # noqa: BLE001
            if time.monotonic() >= deadline:
                raise RuntimeError(
                    f"เชื่อมต่อฐานข้อมูล {DIALECT} ไม่ได้: {e}\n"
                    "ตรวจว่าบริการ PostgreSQL ทำงานอยู่ และค่า VORA_DATABASE_URL ในไฟล์ .env ถูกต้อง "
                    "(ดูวิธีแก้ใน docs/database.md)") from e
            log.warning("รอฐานข้อมูล %s (ครั้งที่ %d): %s", DIALECT, attempt, str(e).splitlines()[0][:160])
            time.sleep(2)


def db_info() -> dict[str, Any]:
    """ข้อมูลฐานข้อมูลสำหรับหน้าสถานะระบบ (ไม่แสดงรหัสผ่าน)"""
    info: dict[str, Any] = {"engine": DIALECT, "database": _url.database or "", "host": _url.host or "",
                            "port": _url.port, "ok": False}
    try:
        with engine.connect() as conn:
            if _is_sqlite:
                info["version"] = "SQLite " + conn.execute(text("select sqlite_version()")).scalar()
                p = Path(_url.database or "")
                size = sum(f.stat().st_size for f in (p, Path(f"{p}-wal")) if f.exists())
            else:
                info["version"] = conn.execute(text("show server_version")).scalar()
                size = conn.execute(text("select pg_database_size(current_database())")).scalar()
            info["size_mb"] = round((size or 0) / 1e6, 2)
            info["ok"] = True
    except Exception as e:  # noqa: BLE001
        info["error"] = str(e).splitlines()[0][:200]
    return info


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
