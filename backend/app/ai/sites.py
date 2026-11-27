"""เปิดเว็บไซต์ตามคำขอ (12 พ.ย. 2569)

ใช้เมื่อผู้ใช้ขอชัดเจน: "เปิดเว็บไซต์…", "ขอดูเว็บ…", "ต้องการดูเว็บไซต์…/เกี่ยวกับ…", "open the website of …"
หาที่อยู่เว็บตามลำดับ:
  1) ไม่ระบุ / พูดถึงวิทยาลัย → เว็บไซต์วิทยาลัย (หลังบ้าน หรือโดเมนในคลังความรู้)
  2) พิมพ์ชื่อโดเมน/ลิงก์มาเอง → ใช้ตามนั้น
  3) "เกี่ยวกับ/เรื่อง X" → บทความ Wikipedia ของ X
  4) ชื่อหน่วยงาน/บริการ → ให้ AI บอกเว็บไซต์ทางการ แล้วตรวจว่าเปิดได้จริง (ไม่ได้ → Wikipedia)
ความปลอดภัย: ผ่านด่าน unsafe ก่อนเสมอ · ไม่เปิดที่อยู่ภายในเครือข่าย (กันใช้เซิร์ฟเวอร์ไปเรียกเครื่องอื่นในวิทยาลัย)
· ไม่เปิดเว็บผู้ใหญ่/พนัน · ตรวจว่าเว็บยอมให้แสดงในกรอบได้ไหม (X-Frame-Options / CSP) — ไม่ได้ = แสดงคิวอาร์โค้ดใหญ่แทน
"""
from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
import time
from urllib.parse import quote, urlparse

import httpx

from .llm import LLMError, llm
from .text import normalize

_REQ_TH = re.compile(
    r"^(?:ช่วย|รบกวน|ขอ|อยาก(?:จะ)?|ต้องการ|หนู|เธอ|vora|วอร่า|\s)*"
    r"(?:เปิด|ดู|แสดง|เข้า|พา(?:ไป)?(?:ดู)?|ไป)\s*(?:ดู)?\s*(?:หน้า)?\s*"
    r"(?:เว็บ\s*ไซ?ต์|เว็บไซท์|เวป\s*ไซ?ต์|เว็ป\s*ไซ?ต์|เว็บ|เวป|เว็ป|website|web\s*site|homepage)\s*"
    r"(?P<about>เกี่ยวกับ|เรื่อง)?\s*(?:ของ)?\s*(?P<q>.*?)\s*"
    r"(?:ให้หน่อย|ให้ดูหน่อย|ให้ดู|ให้ที|ให้|หน่อย|ที|ได้ไหม|ได้มั้ย|ได้ป่าว|นะ|จ้า|ค่ะ|คะ|ครับ|\s)*$", re.I)
# 12 พ.ย. 2569 (รอบ 3): "เว็บไซต์เกี่ยวกับ X" / "มีเว็บไซต์อะไรเกี่ยวกับ X บ้าง" / "แนะนำเว็บเรื่อง X" (ไม่มีคำว่าเปิด/ดู) → ค้นเว็บที่เกี่ยวข้อง + สรุป
_ABOUT_TH = re.compile(
    r"^(?:ช่วย|รบกวน|ขอ|อยาก(?:ได้|รู้)?|ต้องการ|หนู|มี|หา|ค้นหา|ค้น|แนะนำ|\s)*"
    r"(?:เว็บ\s*ไซ?ต์|เว็บไซท์|เวป\s*ไซ?ต์|เว็ป\s*ไซ?ต์|เว็บ|เวป|เว็ป|website|web\s*site)\s*(?:อะไร(?:บ้าง)?|ไหน)?\s*(?:ที่)?\s*"
    r"(?:เกี่ยวกับ|เรื่อง|ด้าน|สำหรับ)\s*(?P<q>.+?)\s*"
    r"(?:มีอะไรบ้าง|มีไหม|มีบ้างไหม|อะไรบ้าง|บ้าง|ให้หน่อย|ให้ดูหน่อย|ให้|หน่อย|ได้ไหม|ได้มั้ย|นะ|จ้า|ค่ะ|คะ|ครับ|\?|\s)*$", re.I)
_ABOUT_EN = re.compile(r"^(?:please\s+|can\s+you\s+)?(?:find\s+|recommend\s+|suggest\s+|show\s+me\s+|any\s+)?(?:some\s+|good\s+)?"
                       r"(?:web\s*sites?|sites?)\s+(?:about|on|for)\s+(?P<q>.+?)[\s?.!]*$", re.I)
_REQ_EN = re.compile(
    r"^(?:please\s+|can\s+you\s+|could\s+you\s+|i\s+want\s+to\s+|i'd\s+like\s+to\s+)*(?:open|show(?:\s+me)?|go\s+to|visit|see)\s+"
    r"(?:the\s+)?(?:web\s*site|webpage|homepage|site)\s*(?P<about>about|on)?\s*(?:of|for)?\s*(?:the\s+)?(?P<q>.*?)[\s?.!]*(?:please)?[\s?.!]*$", re.I)
_DOMAIN = re.compile(r"((?:https?://)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/[^\s]*)?)", re.I)
_SCHOOL_REF = re.compile(r"^(?:วิทยาลัย(?:นี้|เรา|ของเรา)?|โรงเรียน(?:นี้)?|ที่นี่|ที่นี้|สถานศึกษา(?:นี้)?|this\s+college|the\s+college|our\s+college|college|school)$", re.I)
_BLOCK = re.compile(r"porn|xxx|xvideo|xnxx|sex|hentai|onlyfans|casino|gambl|ufabet|slot|บาคาร่า|คาสิโน|พนัน|สล็อต|หนังโป๊|เว็บโป๊|18\+", re.I)
_KNOWN = {"facebook": "https://www.facebook.com", "เฟซบุ๊ก": "https://www.facebook.com", "เฟสบุ๊ค": "https://www.facebook.com",
          "youtube": "https://www.youtube.com", "ยูทูบ": "https://www.youtube.com", "google": "https://www.google.com", "กูเกิล": "https://www.google.com",
          "wikipedia": "https://th.wikipedia.org", "วิกิพีเดีย": "https://th.wikipedia.org"}
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VORA-kiosk"}
_cache: dict[str, tuple[float, dict]] = {}


def detect(text: str) -> tuple[str, bool] | None:
    """คืน (สิ่งที่ต้องการเปิด, เป็นหัวข้อ "เกี่ยวกับ" ไหม) ถ้าผู้ใช้ขอเปิด/ดูเว็บไซต์ · None = ไม่ใช่คำขอเปิดเว็บ"""
    raw = (text or "").strip()
    low = re.sub(r"\s+", " ", raw).lower()
    m = _REQ_EN.match(raw) or _REQ_TH.match(low)   # ไม่ใช้ normalize (ตัดจุดในชื่อโดเมน)
    if not m:
        a = _ABOUT_EN.match(raw) or _ABOUT_TH.match(low)
        if a and len(a.group("q").strip(" ?!.\"'")) >= 2:
            return a.group("q").strip(" ?!.\"'")[:120], True
        return None
    q = (m.group("q") or "").strip(" ?!.\"'")
    return q[:120], bool(m.group("about"))


def blocked(s: str) -> bool:
    return bool(_BLOCK.search(s or ""))


async def _host_kind(host: str) -> str:
    """public | private (ที่อยู่ภายใน/เครื่องตัวเอง — ไม่เปิด) | unknown (หาชื่อไม่พบ/ไม่มีเน็ต)"""
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None)
    except (OSError, UnicodeError):
        return "unknown"
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return "private"
    return "public" if infos else "unknown"


async def check(url: str) -> dict:
    """เปิดได้ไหม · แสดงในกรอบได้ไหม · ที่อยู่จริงหลัง redirect (เก็บผล 1 ชม.)"""
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    out = {"url": url, "ok": False, "embeddable": False, "reason": ""}
    host = urlparse(url).hostname or ""
    kind = await _host_kind(host) if host else "unknown"
    if kind != "public":
        out["reason"] = "private host" if kind == "private" else "unresolved"
        return out
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True, headers=UA) as c:
            r = await c.get(url)
        final = urlparse(str(r.url)).hostname or ""
        if final != host and await _host_kind(final) == "private":
            out["reason"] = "private host"
            return out
        xfo = (r.headers.get("x-frame-options") or "").lower()
        csp = (r.headers.get("content-security-policy") or "").lower()
        fa = csp.split("frame-ancestors", 1)[1].split(";", 1)[0] if "frame-ancestors" in csp else ""
        stop = xfo in ("deny", "sameorigin") or (fa and "*" not in fa)
        out.update(url=str(r.url), ok=r.status_code < 400, embeddable=r.status_code < 400 and not stop,
                   reason=f"http {r.status_code}" if r.status_code >= 400 else ("blocked by site" if stop else ""))
    except Exception as e:  # noqa: BLE001
        out["reason"] = type(e).__name__
    _cache[url] = (time.time(), out)
    return out


def _as_url(s: str) -> str:
    s = s.strip().rstrip(".,)")
    return s if s.lower().startswith(("http://", "https://")) else "https://" + s


async def _wikipedia(topic: str, lang: str) -> tuple[str, str] | None:
    wl = "en" if lang == "en" else "th"
    try:
        async with httpx.AsyncClient(timeout=6.0, headers={"User-Agent": "VORA-PR-Robot/1.0 (school PR kiosk, Thailand)"}) as c:
            r = await c.get(f"https://{wl}.wikipedia.org/w/api.php", params={"action": "query", "format": "json", "formatversion": "2",
                                                                          "list": "search", "srsearch": topic, "srlimit": "1"})
            hits = (r.json().get("query") or {}).get("search") or []
    except Exception:  # noqa: BLE001
        return None
    if not hits:
        return None
    t = hits[0]["title"]
    return f"https://{wl}.wikipedia.org/wiki/{quote(t.replace(' ', '_'))}", t


async def _official(name: str) -> str | None:
    """ให้ AI บอกเว็บไซต์ทางการ (ตอบเฉพาะโดเมน) — ใช้โควตา AI 1 ครั้ง"""
    if not llm.available:
        return None
    try:
        out = await llm.complete("ตอบเฉพาะที่อยู่หน้าแรกของเว็บไซต์ทางการ (URL เดียว) หรือ NONE ถ้าไม่แน่ใจ ห้ามอธิบาย",
                                 f"เว็บไซต์ทางการของ: {name}\nบริบท: ผู้ใช้อยู่ในประเทศไทย", max_tokens=40, temperature=0)
    except LLMError:
        return None
    m = _DOMAIN.search(out or "")
    return _as_url(m.group(1)) if m and "NONE" not in (out or "").upper() else None


def _is_school(nq: str, school_name: str) -> bool:
    """พูดถึงวิทยาลัย — รวมคำที่ระบบฟังเสียงได้ยินเพี้ยน (เช่น "วิลัย", "วิทลัย") ด้วยความคล้ายของตัวอักษร
    12 พ.ย. 2569: เดิม "วิลัย" ไม่ตรง → ให้ AI เดาเว็บ → ได้โดเมนที่ไม่มีจริง (wilai.ac.th) ขึ้นบนจอ"""
    from difflib import SequenceMatcher
    sn = normalize(school_name or "")
    if not nq or _SCHOOL_REF.match(nq) or "เทคนิคน่าน" in nq or (sn and (sn in nq or nq in sn)):
        return True
    core = re.sub(r"^(?:ของ)?\s*|\s*(?:นี้|เรา|ของเรา)$", "", nq)
    if "มหาวิทยาลัย" in core or len(core) > 14:     # มหาวิทยาลัยอื่น / ชื่อยาว = หน่วยงานอื่น ไม่ใช่วิทยาลัยของเรา
        return False
    return any(SequenceMatcher(None, core, ref).ratio() >= 0.7 for ref in ("วิทยาลัย", sn) if ref)


def is_direct(q: str, school_name: str) -> bool:
    """เกี่ยวกับวิทยาลัย / พิมพ์โดเมนมา = เปิดเว็บนั้นตรง ๆ ไม่ต้องค้นเว็บที่เกี่ยวข้อง"""
    return bool(_is_school(normalize(q), school_name) or _DOMAIN.search(q))


async def resolve(q: str, about: bool, lang: str, school_url: str, school_name: str) -> dict | None:
    """→ {url, title, embeddable, reason, kind} หรือ None (หาไม่พบ/ไม่อนุญาต)"""
    nq = normalize(q)
    if blocked(q):
        return {"blocked": True}
    url, title, kind = "", "", ""
    if _is_school(nq, school_name) and school_url:
        url, title, kind = school_url, school_name, "school"
    elif m := _DOMAIN.search(q):
        url, title, kind = _as_url(m.group(1)), m.group(1), "domain"
    elif nq in _KNOWN:
        url, title, kind = _KNOWN[nq], q, "known"
    elif about:
        w = await _wikipedia(q, lang)
        if w:
            url, title, kind = w[0], w[1], "wikipedia"
    else:
        off = await _official(q)
        if off and not blocked(off):
            url, title, kind = off, q, "official"
    if not url:
        w = await _wikipedia(q, lang) if q else None
        if not w:
            return None
        url, title, kind = w[0], w[1], "wikipedia"
    if blocked(url):
        return {"blocked": True}
    c = await check(url)
    if not c["ok"] and kind == "official":
        # ที่อยู่ที่ AI เดาต้องเปิดได้จริงเท่านั้น (ไม่แสดงโดเมนที่ไม่มีอยู่) → ไม่ได้ = Wikipedia · ไม่มีอีก = แจ้งว่าหาไม่พบ
        w = await _wikipedia(q, lang)
        if not w:
            return None
        url, title, kind = w[0], w[1], "wikipedia"
        c = await check(url)
        if not c["ok"] and c["reason"] != "unresolved":
            return None
    if c["reason"] == "private host":                 # ไม่เปิดเครื่องในเครือข่ายภายใน
        return None
    return {"url": c["url"] if c["ok"] else url, "title": title or q, "embeddable": bool(c["embeddable"]),
            "reason": c["reason"], "kind": kind}


async def related(q: str, lang: str, question: str = "") -> dict | None:
    """12 พ.ย. 2569 (รอบ 3): "เว็บไซต์เกี่ยวกับ X" → ค้นเว็บที่เกี่ยวข้อง (Gemini + Google / Wikipedia) สรุปเนื้อหาคร่าว ๆ
    และคืนเว็บหลักที่แสดงบนจอ + เว็บอื่นที่เกี่ยวข้อง (ทุกลิงก์ตรวจแล้วว่าเปิดได้ ไม่ใช่เครือข่ายภายใน ไม่ใช่เว็บต้องห้าม)"""
    from . import web

    if blocked(q):
        return {"blocked": True}
    found = await web.search(q, lang, question=question) if web.enabled() else None
    cands = [(s["url"], s.get("title") or "") for s in ((found or {}).get("sources") or [])][:6]
    if not cands:
        w = await _wikipedia(q, lang)
        if w:
            cands = [w]
    if not cands:
        return None
    checks = await asyncio.gather(*(check(u) for u, _ in cands), return_exceptions=True)
    out, hosts = [], set()
    for (u, t), c in zip(cands, checks):
        if isinstance(c, Exception) or c.get("reason") == "private host":
            continue
        final = c["url"] if c.get("ok") else u
        host = (urlparse(final).hostname or "").replace("www.", "")
        if not c.get("ok") and "vertexaisearch" in host:     # ลิงก์ส่งต่อของ Google ที่ตามไปไม่ได้ = ไม่รู้ปลายทาง
            continue
        if not host or host in hosts or blocked(final):
            continue
        hosts.add(host)
        out.append({"url": final, "title": (t or host).strip()[:80], "embeddable": bool(c.get("embeddable")), "ok": bool(c.get("ok")),
                    "reason": c.get("reason") or ""})
    if not out:
        return None
    main = next((x for x in out if x["ok"] and x["embeddable"]), None) or next((x for x in out if x["ok"]), out[0])
    rest = [{"url": x["url"], "title": x["title"], "embeddable": x["embeddable"]} for x in out if x is not main][:4]
    return {"url": main["url"], "title": main["title"], "embeddable": main["embeddable"], "reason": main["reason"], "kind": "related",
            "topic": q, "summary": (found or {}).get("summary") or "", "points": ((found or {}).get("points") or [])[:4],
            "related": rest, "engine": (found or {}).get("engine") or "wikipedia"}
