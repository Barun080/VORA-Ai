"""ทำให้ log ในหน้าต่าง start.bat ปลอดภัยและอ่านง่าย (21 พ.ย. 2569)

1) ปิดบังรหัสเข้าหลังบ้าน (JWT) ที่ติดมากับที่อยู่ — ข้อค้นพบความปลอดภัยระดับ HIGH ในเอกสารฉบับ C
   เดิม: หน้าหลังบ้านเชื่อม WebSocket ด้วย /ws?role=admin&token=<JWT> และ uvicorn พิมพ์ที่อยู่เต็มลง log
   → ใครเห็นหน้าต่าง/ภาพหน้าจอ/ไฟล์ log ก็นำรหัสไปเข้าหลังบ้านได้จนหมดอายุ (12 ชม.)
   ใหม่: ตัวกรองแทนค่า token=…, access_token=…, Authorization: Bearer … ด้วย *** ก่อนพิมพ์
   (การยืนยันตัวตนทำงานเหมือนเดิมทุกประการ — เปลี่ยนเฉพาะข้อความที่พิมพ์ลง log)
2) ซ่อนบรรทัดตรวจอินเทอร์เน็ตที่สำเร็จ (ทุก 15 วิ) ของงาน F — ตอนเน็ตล่ม/กลับมา ยังมีข้อความ [network] จาก connectivity.py
   และคำขอตรวจที่ "ล้มเหลว" httpx ไม่ได้พิมพ์อยู่แล้ว
"""
from __future__ import annotations

import logging
import re

from .config import settings

_TOKEN_RE = re.compile(r"((?:^|[?&;\s\"'])(?:access_)?token=)[^&\s\"'#]+", re.I)
_BEARER_RE = re.compile(r"(bearer\s+)[A-Za-z0-9._~+/=-]{8,}", re.I)
MASK = "***"


def redact(text: str) -> str:
    if not isinstance(text, str) or ("token" not in text.lower() and "bearer" not in text.lower()):
        return text
    return _BEARER_RE.sub(r"\1" + MASK, _TOKEN_RE.sub(r"\1" + MASK, text))


class RedactTokens(logging.Filter):
    """แทนค่ารหัสใน msg และ args ของบันทึก (uvicorn ส่งที่อยู่มาใน args)"""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, str):
                record.msg = redact(record.msg)
            if isinstance(record.args, tuple):
                record.args = tuple(redact(a) if isinstance(a, str) else a for a in record.args)
            elif isinstance(record.args, dict):
                record.args = {k: (redact(v) if isinstance(v, str) else v) for k, v in record.args.items()}
        except Exception:  # noqa: BLE001 — ตัวกรองล้มต้องไม่ทำให้ log หาย
            pass
        return True


class HideNetProbe(logging.Filter):
    """ไม่พิมพ์ "HTTP Request: GET <ที่อยู่ตรวจเน็ต>" ของ httpx (คำขออื่นของ httpx พิมพ์ตามเดิม)"""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            urls = settings.net_check_urls
            args = record.args if isinstance(record.args, tuple) else ()
            text = " ".join(str(a) for a in args) if args else str(record.msg)
            return not any(u and u in text for u in urls)
        except Exception:  # noqa: BLE001
            return True


_TOKEN_LOGGERS = ("uvicorn", "uvicorn.access", "uvicorn.error", "vora", "httpx")


def install() -> None:
    """ติดตั้งตัวกรอง (เรียกซ้ำได้ ไม่ติดซ้ำ)"""
    for name in _TOKEN_LOGGERS:
        lg = logging.getLogger(name)
        if not any(isinstance(f, RedactTokens) for f in lg.filters):
            lg.addFilter(RedactTokens())
    hx = logging.getLogger("httpx")
    if not any(isinstance(f, HideNetProbe) for f in hx.filters):
        hx.addFilter(HideNetProbe())
