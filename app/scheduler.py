"""ระบบประชาสัมพันธ์เชิงรุกอัตโนมัติ (Autonomous Notification / PR Event)

- ประกาศตามเวลา (times) หรือทุก N นาที (interval) ตามวันที่กำหนด
- จัดลำดับความสำคัญ (priority) และป้องกันการประกาศซ้ำ/รบกวนเกินไป:
  ช่วงงดเสียง (quiet hours), จำกัดจำนวนครั้งต่อชั่วโมง, ไม่แทรกขณะผู้ใช้กำลังคุย (เลื่อนไปก่อน)
- โหมดดึงดูดความสนใจเมื่อว่าง (attract mode): หมุนเวียนข่าว/สาขาตามลำดับความสำคัญ
- สั่งหุ่นยนต์เดินประชาสัมพันธ์ตามเส้นทางที่กำหนด
"""
from __future__ import annotations

import asyncio
import random
import time
from collections import deque
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from .ai.engine import active_news
from .config import settings
from .db import SessionLocal
from .models import News, PatrolRoute, Program, Schedule
from .realtime import hub
from .robot.bridge import RobotError, bridge
from .services import all_settings, record_event

CHECK_EVERY_S = 15
DEFER_MAX_S = 180            # เลื่อนได้สูงสุดกี่วินาทีถ้าผู้ใช้กำลังคุยอยู่
DEDUPE_S = 600               # เนื้อหาเดียวกันห้ามประกาศซ้ำภายในกี่วินาที


def _in_quiet_hours(spec: str, now: datetime) -> bool:
    for part in (spec or "").split(","):
        if "-" not in part:
            continue
        a, b = [x.strip() for x in part.split("-", 1)]
        try:
            ha, ma = map(int, a.split(":"))
            hb, mb = map(int, b.split(":"))
        except ValueError:
            continue
        cur = now.hour * 60 + now.minute
        s, e = ha * 60 + ma, hb * 60 + mb
        if (s <= cur < e) if s <= e else (cur >= s or cur < e):
            return True
    return False


def is_due(s: Schedule, now: datetime) -> bool:
    if not s.active:
        return False
    if s.start_date and now < s.start_date:
        return False
    if s.end_date and now > s.end_date:
        return False
    if str(now.weekday()) not in (s.days or "0123456"):
        return False
    last = s.last_run_at
    if s.interval_min and s.interval_min > 0:
        if not last or (now - last) >= timedelta(minutes=s.interval_min):
            return True
    for t in (s.times or "").split(","):
        t = t.strip()
        if not t:
            continue
        try:
            hh, mm = map(int, t.split(":"))
        except ValueError:
            continue
        slot = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        # ถึงเวลาแล้ว (ภายใน 10 นาที) และยังไม่ได้ทำตั้งแต่เวลานั้น
        if slot <= now <= slot + timedelta(minutes=10) and (not last or last < slot):
            return True
    return False


_IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".svg")


def _media_kind(url: str) -> str:
    """27 พ.ย. 2569: ช่อง "วิดีโอ/สื่อ" ของตารางรับได้ทั้งรูปและวิดีโอ → แยกตามนามสกุลไฟล์"""
    u = (url or "").split("?")[0].lower()
    return "image" if u.endswith(_IMG_EXT) else "video" if u else ""


def _first_gallery(p: Program) -> str:
    return next((u.strip() for u in (p.gallery or "").splitlines() if u.strip()), "")


def program_text(p: Program, lang: str = "th") -> str:
    """ข้อความแนะนำสาขาจากข้อมูลจริงในหลังบ้าน · ไม่มีระดับ/คำอธิบาย = ไม่พูดส่วนนั้น (เดิมพูด "ระดับ ␣")"""
    if lang == "en":
        name = (p.name_en or "").strip()
        if not name:
            return ""
        lvl = f" ({p.level.strip()})" if (p.level or "").strip() else ""
        desc = (p.description_en or "").strip()
        return f"Meet our {name} program{lvl}." + (f" {desc}" if desc else "")
    lvl = f" เปิดสอนระดับ{p.level.strip()}" if (p.level or "").strip() else ""
    desc = (p.description_th or "").strip()
    return f"แนะนำสาขา{p.name_th}ค่ะ{lvl}" + (f" {desc}" if desc else "")


def _news_payload(n: News, s: Schedule | None = None) -> dict[str, Any]:
    out = {"kind": "news", "news_kind": n.kind, "id": n.id, "title_th": n.title_th, "title_en": n.title_en,
           "text_th": f"ประกาศค่ะ {n.title_th} {n.body_th}", "text_en": f"Announcement: {n.title_en}. {n.body_en}" if n.title_en else "",
           "image": n.image_url, "video": n.video_url, "priority": n.priority}
    return _override(out, s)


def _program_payload(p: Program, s: Schedule | None = None) -> dict[str, Any]:
    out = {"kind": "program", "id": p.id, "title_th": f"สาขา{p.name_th}", "title_en": p.name_en,
           "text_th": program_text(p, "th"), "text_en": program_text(p, "en"),
           "image": p.image_url or _first_gallery(p), "video": p.video_url, "priority": 2}
    return _override(out, s)


def _override(out: dict[str, Any], s: Schedule | None) -> dict[str, Any]:
    """ข้อความ/สื่อที่เจ้าหน้าที่แก้ในตาราง มีผลก่อนข้อมูลต้นทาง"""
    if s is None:
        return out
    if (s.text_th or "").strip():
        out["text_th"] = s.text_th.strip()
    if (s.text_en or "").strip():
        out["text_en"] = s.text_en.strip()
    mk = _media_kind(s.media_url)
    if mk:
        out[mk] = s.media_url
    out["priority"] = s.priority
    return out


class PRScheduler:
    def __init__(self) -> None:
        self.task: asyncio.Task | None = None
        self.recent: deque[tuple[float, str]] = deque(maxlen=200)
        self.history: deque[dict[str, Any]] = deque(maxlen=50)
        self.deferred_since: dict[int, float] = {}
        self._promo_index = 0
        self.shown: deque[tuple[float, str]] = deque(maxlen=200)   # 27 พ.ย. 2569: การ์ดหมุนเวียน (แค่แสดง) แยกจากการประกาศจริง
        self.enabled = settings.scheduler_enabled

    def start(self) -> None:
        if not self.task or self.task.done():
            self.task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()

    def _count_last_hour(self) -> int:
        cutoff = time.time() - 3600
        return sum(1 for t, _ in self.recent if t >= cutoff)

    def _recently(self, key: str) -> bool:
        cutoff = time.time() - DEDUPE_S
        return any(k == key and t >= cutoff for t, k in self.recent)

    async def _loop(self) -> None:
        await asyncio.sleep(5)
        while True:
            try:
                if self.enabled:
                    await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                record_event("error", "scheduler", f"scheduler tick failed: {e}")
            await asyncio.sleep(CHECK_EVERY_S)

    async def tick(self, now: datetime | None = None) -> list[str]:
        now = now or datetime.now()
        fired: list[str] = []
        db = SessionLocal()
        try:
            cfg = all_settings(db)
            due = [s for s in db.query(Schedule).filter(Schedule.active.is_(True)).all() if is_due(s, now)]
            due.sort(key=lambda s: -s.priority)
            for s in due:
                reason = self._blocked_reason(cfg, now, s)
                if reason == "busy":
                    first = self.deferred_since.setdefault(s.id, time.time())
                    if time.time() - first < DEFER_MAX_S:
                        continue          # รอให้ผู้ใช้คุยจบก่อน
                    reason = "skipped_busy"
                self.deferred_since.pop(s.id, None)
                if reason:
                    s.last_run_at = now     # ข้ามรอบนี้ ไม่ประกาศย้อนหลังจนรบกวน
                    self._log_history(s.name, reason)
                    continue
                ok = await self.run_schedule(db, s)
                s.last_run_at = now
                if ok:
                    s.run_count += 1
                    fired.append(s.name)
            db.commit()
        finally:
            db.close()
        return fired

    def _blocked_reason(self, cfg: dict, now: datetime, s: Schedule) -> str:
        if _in_quiet_hours(cfg.get("quiet_hours", ""), now) and s.priority < 5:
            return "quiet_hours"
        if self._count_last_hour() >= settings.max_announcements_per_hour and s.priority < 5:
            return "rate_limited"
        if (hub.kiosk_state.get("state") in ("listening", "thinking", "speaking", "conversation") and s.action != "patrol"
                and not settings.pr_schedule_only):
            return "busy"          # 27 พ.ย. 2569: โหมดใหม่ส่งไปให้หน้าจอรอคุยจบเอง (ไม่ทิ้งหลัง 3 นาที)
        if hub.count("kiosk") == 0 and s.action != "patrol":
            return "no_kiosk"
        return ""

    def _log_history(self, name: str, result: str, payload: dict | None = None) -> None:
        self.history.appendleft({"name": name, "result": result, "at": datetime.now().isoformat(timespec="seconds"),
                                 "title": (payload or {}).get("title_th", "")})

    async def run_schedule(self, db: Session, s: Schedule) -> bool:
        payload: dict[str, Any] | None = None
        if s.action == "announce_news" and s.target_id:
            n = db.get(News, s.target_id)
            if n and n.status == "published":
                payload = _news_payload(n, s)
        elif s.action == "announce_program" and s.target_id:
            p = db.get(Program, s.target_id)
            if p and p.status == "published":
                payload = _program_payload(p, s)
        elif s.action == "top_news":
            items = active_news(db, limit=1)
            if items:
                payload = _news_payload(items[0], s)
        elif s.action in ("announce_text", "play_media"):
            mk = _media_kind(s.media_url)
            payload = {"kind": "text", "id": f"s{s.id}", "title_th": s.name, "title_en": s.name, "text_th": s.text_th,
                       "text_en": s.text_en, "image": s.media_url if mk == "image" else "",
                       "video": s.media_url if mk == "video" else "", "priority": s.priority}
            if not (s.text_th or "").strip() and not s.media_url:
                payload = None
        elif s.action == "patrol":
            route = db.get(PatrolRoute, s.target_id) if s.target_id else None
            if not route:
                self._log_history(s.name, "no_route")
                return False
            try:
                bridge.start_patrol(route.name, route.steps)
                self._log_history(s.name, "patrol_started")
                self.recent.append((time.time(), f"patrol:{route.id}"))
                return True
            except RobotError as e:
                self._log_history(s.name, f"robot_{e.code.lower()}")
                return False
        if not payload:
            self._log_history(s.name, "no_content")
            return False
        payload.update(schedule_id=s.id, schedule_name=s.name, source="schedule", wait_convo=s.priority < 5)
        await self.announce(payload)
        self._log_history(s.name, "announced", payload)
        return True

    async def announce(self, payload: dict[str, Any]) -> None:
        key = f"{payload.get('kind')}:{payload.get('id')}"
        self.recent.append((time.time(), key))
        await hub.broadcast("announce", payload, roles=("kiosk",))
        await hub.broadcast("announce.sent", payload, roles=("admin",))
        record_event("info", "scheduler", f"announce {key} {payload.get('title_th', '')}", origin=payload.get("source"))

    def next_promo(self, db: Session) -> dict[str, Any] | None:
        """เลือกเนื้อหาสำหรับโหมดดึงดูดความสนใจ: ข่าวสำคัญก่อน สลับกับแนะนำสาขา ไม่ซ้ำในช่วงเวลาสั้น"""
        pool: list[dict[str, Any]] = [_news_payload(n) for n in active_news(db, limit=8)]
        progs = db.query(Program).filter(Program.status == "published").all()
        random.shuffle(progs)
        pool += [_program_payload(p) for p in progs[:4]]
        pool.sort(key=lambda p: -p["priority"])
        # 27 พ.ย. 2569: การ์ดหมุนเวียนจดใน shown (ไม่ใช่ recent) → ไม่นับเป็นการประกาศ ไม่กินโควตาต่อชั่วโมงของตาราง
        cutoff = time.time() - DEDUPE_S
        fresh = [p for p in pool if not any(k == f"{p['kind']}:{p['id']}" and t >= cutoff for t, k in self.shown)]
        choice_pool = fresh or pool
        if not choice_pool:
            return None
        item = choice_pool[self._promo_index % len(choice_pool)] if not fresh else choice_pool[0]
        self._promo_index += 1
        self.shown.append((time.time(), f"{item['kind']}:{item['id']}"))
        return {**item, "source": "attract"}

    def status(self) -> dict[str, Any]:
        return {"enabled": self.enabled, "running": bool(self.task and not self.task.done()),
                "announcements_last_hour": self._count_last_hour(),
                "max_per_hour": settings.max_announcements_per_hour, "history": list(self.history)[:20]}


scheduler = PRScheduler()
