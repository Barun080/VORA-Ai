"""เครื่องมือประมวลผลข้อความภาษาไทย/อังกฤษ"""
from __future__ import annotations

import re
import unicodedata

_THAI = re.compile(r"[฀-๿]")
_LATIN = re.compile(r"[A-Za-z]")
# คำลงท้ายสุภาพที่ไม่มีผลต่อความหมาย ตัดออกก่อนจับคู่
_PARTICLES = re.compile(r"(นะครับ|นะคะ|ครับผม|ครับ|คับ|ค่ะ|คะ|จ้ะ|จ้า|จ๊ะ)(?=\s|$|[?!.])")
_PUNCT = re.compile(r"[\"'`~!@#$%^&*()_+=\[\]{}|\\:;<>,.?/…“”‘’\-–—]+")
_SPACES = re.compile(r"\s+")
_REPEAT = re.compile(r"(.)\1{2,}")        # เช่น "ดีมากกกก" -> "ดีมาก"


def detect_lang(text: str) -> str:
    th = len(_THAI.findall(text))
    en = len(_LATIN.findall(text))
    if th == 0 and en == 0:
        return "th"
    return "th" if th >= en * 0.5 else "en"


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFC", text or "").lower().strip()
    t = t.replace("ๆ", "")
    t = _REPEAT.sub(r"\1", t)
    t = _PARTICLES.sub(" ", t)
    t = _PUNCT.sub(" ", t)
    t = t.replace("ป.ว.ช", "ปวช").replace("ป.ว.ส", "ปวส").replace("ม.3", "ม3").replace("ม.6", "ม6")
    return _SPACES.sub(" ", t).strip()


_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|(?<=ค่ะ)\s+|(?<=ครับ)\s+|\s{2,}")


def shorten(text: str, max_chars: int) -> str:
    """ตัดคำตอบให้สั้นพอสำหรับการพูด โดยตัดที่ขอบประโยค"""
    text = (text or "").strip()
    if len(text) <= max_chars:
        return text
    parts = _SENT_SPLIT.split(text)
    out = ""
    for p in parts:
        if len(out) + len(p) + 1 > max_chars:
            break
        out = f"{out} {p}".strip()
    if not out:
        cut = text[:max_chars]
        sp = cut.rfind(" ")
        out = cut[:sp] if sp > max_chars * 0.6 else cut
    return out.strip()
