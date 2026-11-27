"""รายงานและการประเมินผล: สถิติการใช้งาน หัวข้อที่สนใจ สัดส่วนตอบได้/ไม่ได้ ความพึงพอใจ และความเสถียรของระบบ"""
from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ChatSession, Feedback, Message, News, Program, SystemEvent, UnansweredQuestion, User
from ..security import require

router = APIRouter(prefix="/api/reports", tags=["reports"])
EXCLUDED_CHANNELS = ("test", "eval")

INTENT_LABELS = {
    "greeting": "ทักทาย", "thanks_bye": "ขอบคุณ/ลา", "about_robot": "เกี่ยวกับหุ่นยนต์", "programs_list": "สาขาที่เปิดสอน",
    "program_detail": "รายละเอียดสาขา", "career": "อาชีพ/เรียนต่อ", "admission": "การสมัครเรียน", "tuition": "ค่าเล่าเรียน",
    "scholarship": "ทุนการศึกษา", "news": "ข่าว", "activity": "กิจกรรม", "location": "สถานที่", "contact": "ติดต่อ",
    "robot_action": "สั่งท่าทางหุ่นยนต์", "out_of_scope": "นอกขอบเขต", "unknown": "ไม่ทราบเจตนา", "vision": "จำภาพ/ป้าย",
    "auto_greeting": "ทักทายอัตโนมัติ",
}


def _since(days: int) -> datetime:
    return datetime.now() - timedelta(days=max(1, min(days, 365)))


@router.get("/overview")
def overview(days: int = 7, db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    since = _since(days)
    sessions = db.query(ChatSession).filter(ChatSession.started_at >= since,
                                            ~ChatSession.channel.in_(EXCLUDED_CHANNELS)).all()
    sid_set = {s.id for s in sessions}
    msgs = db.query(Message).filter(Message.created_at >= since).all()
    msgs = [m for m in msgs if m.session_id in sid_set]
    all_user = [m for m in msgs if m.role == "user"]
    user_msgs = [m for m in all_user if m.input_mode in ("text", "voice", "vision")]   # คำถาม (ไม่รวมท่ามือ)
    bot_msgs = [m for m in msgs if m.role == "bot"]
    qa_bots = [m for m in bot_msgs if m.intent not in ("auto_greeting",)]
    answered = sum(1 for m in qa_bots if m.answered)
    lat = [m.latency_ms for m in qa_bots if m.latency_ms]

    fbs = db.query(Feedback).filter(Feedback.created_at >= since).all()
    thumbs = [f for f in fbs if f.kind == "thumb"]
    ratings = [f.rating for f in fbs if f.kind in ("rating", "survey") and 1 <= f.rating <= 5]
    up = sum(1 for f in thumbs if f.rating > 0)

    intents = Counter(m.intent or "unknown" for m in bot_msgs)
    modes = Counter(m.input_mode for m in all_user)
    langs = Counter(m.lang for m in user_msgs)
    channels = Counter(s.channel for s in sessions)
    triggers = Counter(s.trigger for s in sessions)

    q_counter = Counter(m.text.strip() for m in user_msgs if not m.text.startswith("["))
    by_day: dict[str, dict[str, int]] = {}
    for i in range(min(days, 60)):
        d = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        by_day[d] = {"sessions": 0, "questions": 0, "answered": 0, "unanswered": 0}
    for s in sessions:
        d = s.started_at.strftime("%Y-%m-%d")
        if d in by_day:
            by_day[d]["sessions"] += 1
    for m in user_msgs:
        d = m.created_at.strftime("%Y-%m-%d")
        if d in by_day:
            by_day[d]["questions"] += 1
    for m in qa_bots:
        d = m.created_at.strftime("%Y-%m-%d")
        if d in by_day:
            by_day[d]["answered" if m.answered else "unanswered"] += 1
    hours = [0] * 24
    for m in user_msgs:
        hours[m.created_at.hour] += 1

    events = db.query(SystemEvent).filter(SystemEvent.created_at >= since).all()
    errors_by_source = Counter(e.source for e in events if e.level == "error")
    warns_by_source = Counter(e.source for e in events if e.level == "warn")
    robot_ev = Counter()
    for e in events:
        if e.source == "robot":
            name = (e.data or {}).get("name") or ""
            if name:
                robot_ev[name] += 1
    announces = sum(1 for e in events if e.source == "scheduler" and e.message.startswith("announce"))

    return {
        "period_days": days,
        "totals": {
            "sessions": len(sessions), "questions": len(user_msgs), "bot_replies": len(bot_msgs),
            "answered": answered, "unanswered": len(qa_bots) - answered,
            "answer_rate": round(answered / len(qa_bots), 4) if qa_bots else None,
            "avg_latency_ms": int(sum(lat) / len(lat)) if lat else 0,
            "p95_latency_ms": sorted(lat)[int(len(lat) * 0.95) - 1] if len(lat) >= 2 else (lat[0] if lat else 0),
            "auto_greetings": triggers.get("greeting", 0), "vision_interactions": modes.get("vision", 0), "gesture_interactions": modes.get("gesture", 0),
            "voice_questions": modes.get("voice", 0), "announcements": announces,
            "feedback_count": len(fbs), "thumbs_up": up, "thumbs_down": len(thumbs) - up,
            "satisfaction_thumb": round(up / len(thumbs), 4) if thumbs else None,
            "avg_rating": round(sum(ratings) / len(ratings), 2) if ratings else None, "ratings": len(ratings),
            "wrong_answer_reports": sum(1 for f in fbs if f.kind == "wrong_answer"),
            "open_unanswered": db.query(func.count(UnansweredQuestion.id)).filter(UnansweredQuestion.status == "new").scalar(),
            "errors": sum(errors_by_source.values()),
        },
        "intents": [{"intent": k, "label": INTENT_LABELS.get(k, k), "count": v} for k, v in intents.most_common()],
        "input_modes": dict(modes), "languages": dict(langs), "channels": dict(channels), "triggers": dict(triggers),
        "rating_distribution": {str(i): ratings.count(i) for i in range(1, 6)},
        "top_questions": [{"text": k, "count": v} for k, v in q_counter.most_common(15)],
        "daily": [{"date": d, **v} for d, v in sorted(by_day.items())],
        "hourly": hours,
        "top_programs": [{"name": p.name_th, "views": p.view_count} for p in
                         db.query(Program).order_by(Program.view_count.desc()).limit(8).all()],
        "top_news": [{"title": n.title_th, "views": n.view_count} for n in
                     db.query(News).order_by(News.view_count.desc()).limit(8).all()],
        "errors_by_source": dict(errors_by_source), "warnings_by_source": dict(warns_by_source),
        "robot_events": dict(robot_ev),
    }


@router.get("/conversations")
def conversations(limit: int = 100, db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    msgs = db.query(Message).join(ChatSession, ChatSession.id == Message.session_id) \
        .filter(~ChatSession.channel.in_(EXCLUDED_CHANNELS)).order_by(Message.id.desc()).limit(min(limit, 500)).all()
    return [{"id": m.id, "session_id": m.session_id, "role": m.role, "text": m.text, "intent": m.intent,
             "confidence": m.intent_confidence, "answered": m.answered, "mode": m.input_mode, "lang": m.lang,
             "provider": m.provider, "latency_ms": m.latency_ms, "created_at": m.created_at} for m in msgs]


@router.get("/export.csv")
def export_csv(days: int = 30, db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    since = _since(days)
    rows = db.query(Message, ChatSession).join(ChatSession, ChatSession.id == Message.session_id) \
        .filter(Message.created_at >= since, ~ChatSession.channel.in_(EXCLUDED_CHANNELS)).order_by(Message.id).all()
    buf = io.StringIO()
    buf.write("﻿")   # ให้ Excel อ่านภาษาไทยถูกต้อง
    w = csv.writer(buf)
    w.writerow(["เวลา", "รหัสเซสชัน", "ช่องทาง", "ผู้พูด", "ข้อความ", "รูปแบบการป้อน", "ภาษา", "เจตนา",
                "ความมั่นใจ", "ตอบได้", "แหล่งคำตอบ", "เวลาตอบ(ms)"])
    for m, s in rows:
        w.writerow([m.created_at.strftime("%Y-%m-%d %H:%M:%S"), m.session_id, s.channel, m.role, m.text, m.input_mode,
                    m.lang, INTENT_LABELS.get(m.intent, m.intent), m.intent_confidence, "ใช่" if m.answered else "ไม่",
                    m.provider, m.latency_ms])
    buf.seek(0)
    name = f"vora-report-{datetime.now():%Y%m%d}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f"attachment; filename={name}"})
