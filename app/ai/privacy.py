"""ตัดข้อมูลลับและข้อมูลส่วนบุคคลออกจากข้อความ (Phase 6 · Gate 6C)

redact_secrets() — ใช้กับทุกข้อความที่ออกจากชั้นเรียก AI ไปยัง log / system_events / last_error / LLMError / หน้าจอสถานะ
    (แก้ S1: คีย์ API อาจติดมากับข้อความผิดพลาดของ httpx ซึ่งมี URL ของคำขอ)
redact_pii()     — ตัดเบอร์โทร อีเมล เลขบัตรประชาชน เลขบัญชี LINE ID ก่อนส่งคำถามของผู้ใช้ออกนอกเครื่อง
    ** ยังไม่ได้เรียกใช้ใน engine.py ** (ต้องตัดเฉพาะส่วน "คำถามของผู้ใช้" ไม่ใช่ CONTEXT ที่มีเบอร์ติดต่อทางการของวิทยาลัย
    — การต่อสายต้องแก้ engine.py ซึ่งรออนุมัติ) · ชื่อบุคคลตรวจจับไม่ได้อย่างน่าเชื่อถือ (ข้อจำกัดที่ทราบ)
"""
from __future__ import annotations

import re
from typing import Iterable

MASK = "[REDACTED]"

_SECRET_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # key=… / api_key=… / token=… ใน query string
    (re.compile(r"([?&](?:key|api_key|apikey|api-key|token|access_token|auth)=)[^&\s'\"<>]+", re.I), r"\1" + MASK),
    # header ที่มีคีย์
    (re.compile(r"((?:x-goog-api-key|x-api-key|api-key|authorization)['\"]?\s*[:=]\s*['\"]?)(?:Bearer\s+)?[^\s,'\"}]+", re.I), r"\1" + MASK),
    (re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=\-]{6,}"), r"\1" + MASK),
    # user:password@ ใน URL
    (re.compile(r"(\b[a-z][a-z0-9+.\-]*://)[^/\s:@]+:[^/\s@]+@", re.I), r"\1" + MASK + "@"),
    # รูปแบบคีย์ที่รู้จัก (Google AIza…, OpenAI/Anthropic sk-…)
    (re.compile(r"\bAIza[0-9A-Za-z_\-]{20,}"), MASK),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"), MASK),
]


def redact_secrets(text: object, secrets: Iterable[str] = ()) -> str:
    """แทนค่าคีย์ที่ตั้งไว้ (ตรงตัว) และรูปแบบคีย์/credential ที่รู้จักด้วย [REDACTED]"""
    s = "" if text is None else str(text)
    for sec in sorted({x for x in secrets if x and len(x) >= 6}, key=len, reverse=True):
        s = s.replace(sec, MASK)
    for pat, rep in _SECRET_PATTERNS:
        s = pat.sub(rep, s)
    return s


def redact_url(url: str) -> str:
    """ตัด user:password@ และ query ที่มีคีย์ออกจาก URL (สำหรับแสดงสถานะ)"""
    return redact_secrets(url)


_PII_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?<!\d)\d(?:[\s-]?\d){12}(?!\d)"), "[เลขบัตรประชาชน]"),                 # 13 หลัก (ก่อนเบอร์โทร)
    (re.compile(r"[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+"), "[อีเมล]"),
    (re.compile(r"(?<![\d+])(?:\+66[\s-]?|0)\d(?:[\s-]?\d){7,8}(?!\d)"), "[เบอร์โทร]"),
    (re.compile(r"(?<!\d)\d{3}-\d-\d{5}-\d(?!\d)"), "[เลขบัญชี]"),
    (re.compile(r"(?i)((?:line|ไลน์)\s*(?:id|ไอดี)?\s*[:：]?\s*)@?[A-Za-z0-9._\-]{3,}"), r"\1[LINE ID]"),
]


def redact_pii(text: object) -> str:
    s = "" if text is None else str(text)
    for pat, rep in _PII_PATTERNS:
        s = pat.sub(rep, s)
    return s
