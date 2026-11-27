"""23 พ.ย. 2569: ตรวจว่า "ข้อมูลที่ค้นเจอ" ตอบคำถามนั้นจริง ก่อนนำไปตอบ (กันตอบผิดเรื่องเพราะคำคล้ายกัน)

ปัญหาที่พบจากชุดทดสอบ 115 คำถาม: ตัวค้นใช้ความคล้ายของตัวอักษร จึงจับคู่จากคำลงท้ายที่เหมือนกัน เช่น
  "ห้องทะเบียนอยู่ไหน"   → ได้ที่อยู่ของวิทยาลัย (คล้ายกันที่ "…อยู่ไหน")
  "วิทยาลัยเปิดกี่โมง"   → ได้ที่อยู่ของวิทยาลัย
  "มีการแข่งขัน STEM ไหม" → ได้ข้อมูลการแข่งขันทักษะ (ไม่มีคำว่า STEM)
  "Python คืออะไร"       → ได้ "อาชีวศึกษาคืออะไร"
กติกา (ไม่ใช้ AI · เร็ว · อธิบายได้):
  1) ถามสถานที่เฉพาะ (ห้องทะเบียน โรงอาหาร ตึก…) → ข้อมูลต้องพูดถึงสถานที่นั้น
  2) ถามชนิดคำตอบ (กี่โมง / เท่าไหร่ / กี่ปี / เมื่อไหร่ / กี่คน) → ข้อมูลต้องมีคำตอบชนิดนั้น (เวลา ตัวเลข วันที่)
  3) คำภาษาอังกฤษในคำถามภาษาไทย (STEM, Python, IoT) → ข้อมูลต้องมีคำนั้น (หรือคำแปลที่กำหนด)
  4) คำถามสั้นที่คะแนนความคล้ายต่ำ ("สมัครออนไลน์ได้ไหม" "ต้องสอบไหม") → แก่นคำถาม (ตัดคำลงท้าย ได้ไหม/ต้อง/คืออะไร)
     ต้องปรากฏในข้อมูลส่วนใหญ่ — กันการจับคู่ด้วยคำลงท้ายเหมือนกัน
ไม่ผ่าน = ไม่ใช้ข้อมูลชิ้นนั้น → ระบบไปชิ้นถัดไป หรือบอกว่าไม่มีข้อมูล (บันทึกให้เจ้าหน้าที่) · ปิด: VORA_ANSWER_CHECK=0
"""
from __future__ import annotations

import re
from typing import Any

from .text import normalize

_ASK_PLACE = re.compile(r"(อยู่ไหน|อยู่ที่ไหน|อยู่ตรงไหน|ตรงไหน|ไปทางไหน|ไปยังไง|ไปอย่างไร|ตึกไหน|อาคารไหน|ห้องไหน|ชั้นไหน|where)")
PLACES = ("ห้องทะเบียน", "งานทะเบียน", "ทะเบียน", "ห้องผู้อำนวยการ", "ผู้อำนวยการ", "ธุรการ", "สารบรรณ", "ห้องพยาบาล", "พยาบาล",
          "ห้องประชุม", "หอประชุม", "โรงอาหาร", "ห้องน้ำ", "ฝ่ายวิชาการ", "วิชาการ", "จุดรับสมัคร", "ห้องปฏิบัติการ", "ห้องแล็บ",
          "แล็บ", "ห้องสมุด", "สนาม", "ที่จอดรถ", "ลานจอด", "โรงฝึก", "ห้องเรียน", "ห้องคอม", "แนะแนว", "การเงิน", "อาคาร", "ตึก")
_TYPES = [
    (re.compile(r"(กี่โมง|เวลาเปิด|เวลาปิด|เวลาทำการ|เปิดกี่|ปิดกี่|what time|opening hour)"),
     re.compile(r"(โมง|นาฬิกา|\d{1,2}[.:]\d{2}|\d\s*น\.|เวลาราชการ|a\.m|p\.m|\d\s*(am|pm))")),
    (re.compile(r"(เท่าไหร่|เท่าไร|กี่บาท|ราคา|ค่าเทอม|ค่าเรียน|ค่าใช้จ่าย|ค่าสมัคร|how much|tuition|fee)"),
     re.compile(r"(บาท|ฟรี|ไม่เสียค่า|ไม่มีค่าใช้จ่าย|ไม่เก็บค่า|baht|free)")),       # ตัวเลขเฉย ๆ (ปี พ.ศ.) ไม่นับเป็นราคา
    (re.compile(r"(กี่ปี|กี่เทอม|ระยะเวลาเรียน|how many years|how long)"), re.compile(r"(\d\s*(ปี|เทอม|ภาค)|year)")),
    (re.compile(r"(เมื่อไหร่|เมื่อไร|วันไหน|วันที่เท่าไหร่|ช่วงไหน|when)"),
     re.compile(r"(\d|มกรา|กุมภา|มีนา|เมษา|พฤษภา|มิถุนา|กรกฎา|สิงหา|กันยา|ตุลา|พฤศจิกา|ธันวา|ม\.ค|ก\.พ|มี\.ค|เม\.ย|พ\.ค|มิ\.ย|ก\.ค|ส\.ค|ก\.ย|ต\.ค|พ\.ย|ธ\.ค|ตลอด|ทุกวัน|ประจำปี)")),
    (re.compile(r"(ระดับไหน|เปิดระดับ|ระดับอะไร|มีระดับ|which level)"), re.compile(r"(ปวช|ปวส|ทล\.?บ|ปริญญา|vocational certificate|diploma|bachelor)")),
    (re.compile(r"(ยากไหม|ยากมั้ย|ยากป่ะ|ยากหรือเปล่า|ง่ายไหม|หนักไหม|is it hard|difficult)"), re.compile(r"(ยาก|ง่าย|หนัก|ไม่ยาก|hard|easy|difficult)")),
    (re.compile(r"(กี่คน|กี่แห่ง|กี่สาขา|กี่แผนก|กี่ห้อง|how many)"), re.compile(r"\d")),
]
_MONEY = 1                                             # ลำดับกติการาคาใน _TYPES
_WHERE_ANS = re.compile(r"(เว็บ|www|เฟซบุ๊ก|facebook|เพจ|ไลน์|line|โทร|อาคาร|ชั้น|ตึก|ห้อง|อยู่|ถนน|ถ\.|ตำบล|ต\.|จังหวัด|จ\.|เลขที่|แผนที่|พิกัด|map|ทาง|ข้าง|ตรงข้าม|ด้าน|บริเวณ|building|floor|located)")
_NOT_MONEY = re.compile(r"(เกรด|คะแนน|gpa|อายุ|ส่วนสูง|น้ำหนัก|กี่คน|จำนวน|สัดส่วน|เปอร์เซ็นต์|ร้อยละ|แผนรับ|อัตรา|ตัวเลข|ประกวดราคา|สอบราคา)")   # 27 พ.ย.: สัดส่วน/แผนรับ "เท่าไร" ไม่ใช่ราคา
_ASCII = re.compile(r"[a-z][a-z0-9+#.\-]{1,}")
_THAI = re.compile(r"[฀-๿]")
_EN_STOP = {"bearer", "token", "key", "ok", "the", "a", "an", "is", "of", "and", "or", "to", "in", "on", "for", "vora", "ka", "na", "krub"}
EQUIV = {"it": ("it", "ไอที", "สารสนเทศ"), "ai": ("ai", "เอไอ", "ปัญญาประดิษฐ์"), "ev": ("ev", "ยานยนต์ไฟฟ้า"),
         "iot": ("iot", "ไอโอที"), "web": ("web", "เว็บ"), "website": ("website", "เว็บ"), "hardware": ("hardware", "ฮาร์ดแวร์"),
         "software": ("software", "ซอฟต์แวร์"), "developer": ("developer", "นักพัฒนา", "โปรแกรมเมอร์", "ซอฟต์แวร์"),
         "programmer": ("programmer", "โปรแกรมเมอร์"), "game": ("game", "เกม"), "cybersecurity": ("cybersecurity", "ไซเบอร์", "ความปลอดภัย"),
         "network": ("network", "เครือข่าย"), "robot": ("robot", "หุ่นยนต์"), "line": ("line", "ไลน์"), "facebook": ("facebook", "เฟซบุ๊ก"),
         "qr": ("qr", "คิวอาร์"), "gpa": ("gpa", "เกรด"), "online": ("online", "ออนไลน์"), "email": ("email", "อีเมล"),
         "vora": ("vora", "วอร่า")}


_FILLER = re.compile(r"(ได้ไหม|ได้มั้ย|ได้ป่ะ|ได้ปะ|ได้หรือเปล่า|ได้รึเปล่า|หรือเปล่า|รึเปล่า|หรือไม่|ไหม|มั้ย|ป่าว|"
                     r"คืออะไร|อะไรบ้าง|อะไร|ยังไง|อย่างไร|ต้อง|ควร|จะ|มีการ|มี|ที่นี่|ที่นี้|วิทยาลัย|เทคนิคน่าน|"
                     r"เป็น|คือ|เรา|หนู|ผม|ฉัน|เธอ|วอร่า|\s|[?!.,])")
# 27 พ.ย. 2569: คำลงท้าย/คำสุภาพ ตัดเฉพาะท้ายประโยค (เดิมตัดทุกที่ → "แนะนำ" เหลือ "แนำ" เพราะมี "นะ" อยู่ข้างใน)
_TAIL = re.compile(r"(ครับ|คะ|ค่ะ|นะ|จ้า|จ้ะ|หน่อย|บ้าง|ป่ะ|ปะ|สิ|ซิ|ที)+$")
LOW_SCORE = 0.5
EXACT = 0.7
MIN_COVER = 0.6


def _grams(s: str, n: int = 3) -> set[str]:
    return {s[i:i + n] for i in range(max(len(s) - n + 1, 1))} if s else set()


def _terms(question: str) -> list[tuple[str, bool]]:
    """คำภาษาอังกฤษที่เป็นหัวเรื่อง (STEM, Python, IoT) — ข้ามรหัส/คีย์/โทเค็น (มีตัวเลข ขีด หรือยาวเกิน)"""
    out = []
    for tok in re.findall(r"[^\s฀-๿]+", question or ""):
        tok = tok.strip("()[]{}\"'.,!?:;")
        if re.fullmatch(r"[A-Za-z][A-Za-z+#]{1,14}", tok):
            out.append((tok.lower(), tok != tok.lower()))
    return out


def core(question: str) -> str:
    """แก่นของคำถาม (ตัดคำลงท้าย/คำถาม/คำสุภาพ) · "เป็น" = "คือ" (เธอเป็นใคร ≈ เธอคือใคร)"""
    q = re.sub(r"[\s?!.,]+$", "", normalize(question))
    for _ in range(3):
        q = _TAIL.sub("", q).rstrip()
    return _FILLER.sub("", q)


_DONE_LEVEL = re.compile(r"(?:จบ|เรียนจบ|สำเร็จการศึกษา)\s*(?:การศึกษา)?\s*(?:ระดับ|ชั้น)?\s*(?:ปวช|ปวส|ม\.?\s*[36])\.?")
_LEVELS = (("ปวช", re.compile(r"ปวช")), ("ปวส", re.compile(r"ปวส")), ("ทลบ", re.compile(r"ทล\.?บ|ปริญญาตรี")))


def _hit_text(hit: Any) -> str:
    d = hit.doc
    return normalize(f"{d.title}\n{d.match_text}\n{d.answer_th}\n{d.answer_en}\n{d.content}")


def check(question: str, hit: Any) -> tuple[bool, str]:
    """(ผ่าน?, เหตุผล) — ฟังก์ชันล้วน"""
    q = normalize(question)
    h = _hit_text(hit)
    raw = f"{hit.doc.answer_th}\n{hit.doc.answer_en}".lower()
    ans = f"{raw}\n{normalize(raw)}"          # ต้นฉบับ (เก็บ 08.30 / ม.ค.) + แบบ normalize
    # 27 พ.ย. 2569: คำถามตรงกับคำถาม/คำถามอื่นที่เจ้าหน้าที่เขียนคู่กับคำตอบนี้ทุกตัวอักษร = เจ้าหน้าที่ยืนยันแล้ว → ผ่าน
    if is_exact(question, hit):
        return True, ""
    if _ASK_PLACE.search(q):
        found = [p for p in PLACES if p in q]
        if found:
            p = max(found, key=len)
            base = re.sub(r"^(ห้อง|งาน|ฝ่าย)", "", p) or p      # ห้องทะเบียน ≈ งานทะเบียน
            if p not in h and base not in h:
                return False, f"ถามสถานที่ '{p}' แต่ข้อมูลไม่ได้พูดถึง"
        exact = float(getattr(hit, "score", 0.0)) >= EXACT     # คำถามตรงกับ FAQ มาก = เชื่อได้ ข้ามข้อนี้
        if not exact and not _WHERE_ANS.search(ans):       # "ห้อง ผอ. อยู่ไหน" ≠ "ผอ. ชื่ออะไร"
            return False, "ถามสถานที่ แต่ข้อมูลไม่ได้บอกตำแหน่ง"
        subj = _FILLER.sub("", _ASK_PLACE.sub("", q))
        if not exact and len(subj) >= 4:                   # "อาคารแผนกคอมอยู่ไหน" ≠ "ห้องสมาร์ทคลาสรูมอยู่ไหน"
            g = _grams(subj, 3)
            qside = normalize(f"{hit.doc.title}\n{hit.doc.match_text}")
            if sum(1 for x in g if x in qside) / len(g) < 0.5 and sum(1 for x in g if x in h) / len(g) < 0.7:
                return False, f"ถามตำแหน่งของ '{subj}' แต่ข้อมูลเป็นของที่อื่น"
    for i, (ask, need) in enumerate(_TYPES):
        if i == _MONEY and _NOT_MONEY.search(q):           # "ใช้เกรดเท่าไหร่" ไม่ใช่ถามราคา
            continue
        if ask.search(q) and not need.search(ans):
            return False, f"ถาม '{ask.search(q).group(0)}' แต่ข้อมูลไม่มีคำตอบชนิดนั้น"
    if _THAI.search(q):
        low = float(getattr(hit, "score", 1.0)) < LOW_SCORE
        for w, cap in _terms(question):
            if w in _EN_STOP or not (cap or low):      # ตัวพิมพ์ใหญ่ (STEM, Python, AI) ตรวจเสมอ · ตัวเล็กตรวจเมื่อคะแนนต่ำ
                continue
            if not any(e in h for e in EQUIV.get(w, (w,))):
                return False, f"ถามเรื่อง '{w}' แต่ข้อมูลไม่มีคำนี้"
    # 27 พ.ย. 2569: ถามระดับหนึ่ง (ปวช.) แต่ข้อมูลเป็นของอีกระดับโดยเฉพาะ (หัวข้อ "คุณสมบัติ ... ปวส.") → ไม่ใช่คำตอบ
    q_lv = _DONE_LEVEL.sub(" ", q)                          # "จบ ปวช. สมัครอะไรได้" = ถามระดับถัดไป ไม่ใช่ ปวช.
    asked = {k for k, rx in _LEVELS if rx.search(q_lv)}
    title_lv = {k for k, rx in _LEVELS if rx.search(normalize(hit.doc.title))}
    if asked and title_lv and not (asked & title_lv):
        return False, f"ถามระดับ {'/'.join(sorted(asked))} แต่ข้อมูลเป็นของระดับ {'/'.join(sorted(title_lv))}"
    c = core(question)
    if _THAI.search(q) and 2 <= len(c) <= 14 and float(getattr(hit, "score", 1.0)) < LOW_SCORE:
        g = _grams(c, 4 if len(c) >= 6 else 3)            # 4 ตัวอักษร: กัน "ยาก" ไปตรงกับ "อยาก"
        qside = normalize(f"{hit.doc.title}\n{hit.doc.match_text}")      # เทียบกับ "คำถาม" ของข้อมูล (คำตอบมักมีคำทั่วไปเช่น สอบถาม)
        qside = qside + "\n" + _FILLER.sub("", qside)     # 27 พ.ย.: เทียบแบบตัดช่องว่าง/คำเชื่อมด้วย ("Fix it Center" ≈ "fixitcenter")
        cover = sum(1 for x in g if x in qside) / len(g)
        if cover < MIN_COVER:
            return False, f"แก่นคำถาม '{c}' ไม่อยู่ในข้อมูล ({cover:.0%})"
    return True, ""


def filter_hits(question: str, hits: list) -> tuple[list, list[dict]]:
    keep, dropped = [], []
    for h in hits:
        ok, why = check(question, h)
        if ok:
            keep.append(h)
        else:
            dropped.append({"title": h.doc.title[:80], "score": round(h.score, 3), "reason": why})
    # 27 พ.ย. 2569: FAQ ที่คำถาม/คำถามอื่นตรงกับที่ถามทุกตัวอักษรขึ้นก่อน (คำถามอื่นยิ่งมาก คะแนนยิ่งเจือจาง
    # เช่น "อาชีวศึกษาคืออะไร" 0.486 แพ้ "กฎหมายหลักของอาชีวศึกษาคืออะไร" 0.492) · ลำดับอื่นคงเดิม
    keep.sort(key=lambda h: not is_exact(question, h))
    return keep, dropped


def is_exact(question: str, hit: Any) -> bool:
    from ..config import settings                      # สวิตช์ VORA_EXACT_FAQ_FIRST
    if not settings.exact_faq_first:
        return False
    flat = lambda x: re.sub(r"[\s.?？!]", "", normalize(x))
    q = flat(question)
    return bool(q) and getattr(hit.doc, "type", "") == "faq" and \
        q in {flat(x) for x in f"{hit.doc.title}\n{hit.doc.match_text}".splitlines() if x.strip()}


_LEVEL = re.compile(r"(ปวช|ปวส|ทล\.?บ|ม\.?\s?3|ม\.?\s?6)")
PREFER_GAP = 0.15


def prefer_general(question: str, hits: list) -> list:
    """ผู้ใช้ไม่ได้ระบุระดับ ("เรียนกี่ปี") แต่ข้อมูลอันดับ 1 เป็นของระดับเดียว ("ปวส. เรียนกี่ปี")
    → ถ้ามีข้อมูลแบบรวม (ไม่ระบุระดับ) คะแนนใกล้กัน ใช้แบบรวมก่อน (ไม่ตอบแคบกว่าคำถาม)"""
    if not hits or _LEVEL.search(normalize(question)) or not _LEVEL.search(normalize(hits[0].doc.title)):
        return hits
    for i, h in enumerate(hits[1:], 1):
        if h.score >= hits[0].score - PREFER_GAP and not _LEVEL.search(normalize(h.doc.title)) and check(question, h)[0]:
            return [h] + hits[:i] + hits[i + 1:]
    return hits
