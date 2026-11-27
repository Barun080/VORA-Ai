"""Phase 6 · Gate 6D — Answer Guard (ตรวจคำตอบของ LLM ก่อนส่งให้ผู้ใช้)

หลัก: ข้อมูลสำคัญที่ "มีรูปแบบตรวจจับได้" ในคำตอบของ LLM ต้องอยู่ใน CONTEXT ที่ส่งให้ LLM สำหรับคำถามนั้น
(และสำหรับหลักสูตร: ต้องเป็นสาขาที่เผยแพร่แล้ว) — ถ้าไม่ผ่าน engine จะใช้คำตอบจากฐานความรู้ตรง ๆ แทน

ข้อจำกัด (ระบุตามจริง — Guard ไม่สามารถป้องกัน hallucination ได้ทั้งหมด):
  * ข้อความเชิงคุณภาพ/การตีความ ("ดีที่สุด", "รับรองมีงานทำ") ตรวจไม่ได้
  * ค่าและเรื่องที่อยู่ในรายการ CONTEXT เดียวกันแล้วถูกสลับกัน ตรวจไม่ได้ (G8 ตรวจได้เฉพาะข้ามรายการ)
  * ชื่อบุคคลที่ไม่มีคำนำหน้า, ชื่อย่อนอกรายการ alias, จำนวนเชิงคุณภาพ ("หลายร้อยคน") ตรวจไม่ได้
  * การถอดความคำสั่งระบบ ตรวจไม่ได้ (G7 จับได้เฉพาะ canary และข้อความตรงตัว)

G1 ชื่อสถานศึกษา · G2 หลักสูตร/สาขา/ระดับ · G3 สถานที่ · G4 วันที่/เวลา · G5 ตัวเลข · G6 ข้อมูลติดต่อ
G7 การรั่วคำสั่งระบบ · G8 ค่าผูกกับเรื่องผิดรายการ · G9 บุคลากร
"""
from __future__ import annotations

import re
import secrets
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable

INSTITUTIONAL = "institutional"
GENERAL = "general"

# canary ต่อการเริ่มระบบ — กลไกเสริมเท่านั้น (ไม่ใช่การป้องกันหลัก) · ไม่ใช่ความลับที่มีผลต่อระบบ
CANARY = f"VORA-CANARY-{secrets.token_hex(6)}"

_TH_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
_SPACE = re.compile(r"\s+")


@dataclass
class Program:
    name_th: str
    name_en: str = ""
    level: str = ""
    published: bool = True


@dataclass
class Verdict:
    ok: bool
    codes: list[str] = field(default_factory=list)


def _clean(s: str) -> str:
    return unicodedata.normalize("NFC", (s or "")).translate(_TH_DIGITS)


def _nospace(s: str) -> str:
    return _SPACE.sub("", _clean(s)).lower()


# ------------------------------------------------------------------ G4 เวลา (ปรับรูปแบบก่อนดึงตัวเลข)
_TIME = re.compile(r"\b(\d{1,2})[.:](\d{2})(?=\s*(?:น\.|นาฬิกา|น\b|[aApP]\.?[mM]\.?))")


def _times_norm(s: str) -> str:
    return _TIME.sub(lambda m: f"{int(m.group(1))}:{m.group(2)}", s)


# ------------------------------------------------------------------ G5 ตัวเลข
_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
_TH_NUM_WORD = re.compile(r"(?:ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน)+")
_TH_D = {"ศูนย์": 0, "หนึ่ง": 1, "เอ็ด": 1, "สอง": 2, "ยี่": 2, "สาม": 3, "สี่": 4, "ห้า": 5, "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9}
_TH_M = {"สิบ": 10, "ร้อย": 100, "พัน": 1000, "หมื่น": 10_000, "แสน": 100_000, "ล้าน": 1_000_000}
_TH_TOK = re.compile("|".join(sorted(list(_TH_D) + list(_TH_M), key=len, reverse=True)))
_TH_UNITS = re.compile(r"\s*(บาท|คน|ปี|เดือน|วัน|ชั่วโมง|ชม\.|นาที|หน่วยกิต|ภาคเรียน|เทอม|เปอร์เซ็นต์|ครั้ง|รอบ|ที่นั่ง|สาขา|"
                       r"แผนก|อาคาร|ชั้น|ห้อง|เมตร|กิโล|ทุน|เครื่อง|ระดับ|รุ่น|โครงการ|กิจกรรม|ชมรม|แห่ง)")
_EN_D = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
                                    "fifteen sixteen seventeen eighteen nineteen".split())}
_EN_D.update({"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90})
_EN_M = {"hundred": 100, "thousand": 1000, "million": 1_000_000}
_EN_NUM_WORD = re.compile(r"\b(?:(?:%s)(?:[\s-]+(?:and[\s-]+)?)?)+\b" % "|".join(sorted(list(_EN_D) + list(_EN_M), key=len, reverse=True)), re.I)
_EN_UNITS = re.compile(r"\s*(baht|students?|people|persons?|years?|months?|days?|hours?|minutes?|percent|credits?|semesters?|"
                       r"times|seats|programs?|programmes?|buildings?|floors?|rooms?|scholarships?|clubs?)\b", re.I)


def _thai_words_value(run: str) -> int | None:
    toks = _TH_TOK.findall(run)
    if not toks:
        return None
    total, cur = 0, None
    for t in toks:
        if t in _TH_D:
            cur = _TH_D[t]
        else:
            m = _TH_M[t]
            if m == 1_000_000:
                total = (total + (cur if cur is not None else 1)) * m
            else:
                total += (cur if cur is not None else 1) * m
            cur = None
    return total + (cur or 0)


def _en_words_value(run: str) -> int | None:
    total, cur = 0, 0
    seen = False
    for w in re.split(r"[\s-]+", run.lower()):
        if w in ("", "and"):
            continue
        if w in _EN_D:
            cur += _EN_D[w]
            seen = True
        elif w in _EN_M:
            m = _EN_M[w]
            seen = True
            if m == 100:
                cur = (cur or 1) * 100
            else:
                total += (cur or 1) * m
                cur = 0
    return total + cur if seen else None


def _canon_num(x: str) -> str:
    x = x.replace(",", "")
    if "." in x:
        a, b = x.split(".", 1)
        b = b.rstrip("0")
        a = a.lstrip("0") or "0"
        return f"{a}.{b}" if b else a
    return x.lstrip("0") or "0"


def numbers(text: str) -> set[str]:
    """ตัวเลขทุกตัวในข้อความ (อารบิก + เลขไทย + ตัวเลขที่เขียนเป็นคำพร้อมหน่วย/ตัวคูณ) ในรูป canonical"""
    s = _times_norm(_clean(text))
    out = {_canon_num(m.group(0)) for m in _NUM.finditer(s)}
    for m in _TH_NUM_WORD.finditer(s):
        run = m.group(0)
        toks = _TH_TOK.findall(run)
        has_digit = any(t in _TH_D for t in toks)
        has_mult = any(t in _TH_M for t in toks)
        followed_by_unit = bool(_TH_UNITS.match(s, m.end()))
        if (has_digit and has_mult) or ((has_digit or run == "สิบ") and followed_by_unit):
            v = _thai_words_value(run)
            if v is not None:
                out.add(str(v))
    for m in _EN_NUM_WORD.finditer(s):
        run = m.group(0).strip()
        words = [w for w in re.split(r"[\s-]+", run.lower()) if w and w != "and"]
        if not words:
            continue
        has_mult = any(w in _EN_M for w in words)
        if has_mult or _EN_UNITS.match(s, m.end()):
            v = _en_words_value(run)
            if v is not None:
                out.add(str(v))
    return out


def _with_era(nums: set[str]) -> set[str]:
    """พ.ศ. ↔ ค.ศ. (ปี 4 หลัก)"""
    out = set(nums)
    for n in nums:
        if n.isdigit() and len(n) == 4:
            y = int(n)
            if 2400 <= y <= 2700:
                out.add(str(y - 543))
            elif 1900 <= y <= 2200:
                out.add(str(y + 543))
    return out


# ------------------------------------------------------------------ G6 ข้อมูลติดต่อ
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL = re.compile(r"(?:https?://|www\.)[^\s<>\"'()\]]+|\b[\w-]+(?:\.[\w-]+)*\.(?:ac\.th|co\.th|go\.th|or\.th|in\.th|com|net|org|th)\b(?:/[^\s<>\"'()]*)?", re.I)
_PHONE = re.compile(r"(?<![\d])(?:\+66[\s-]?\d|0)[\d\s-]{6,14}\d(?![\d])")
_LINE = re.compile(r"(?<![\w.])@[A-Za-z0-9_.-]{3,}")


def _canon_url(u: str) -> str:
    u = u.lower().rstrip(".,;:/")
    u = re.sub(r"^https?://", "", u)
    return re.sub(r"^www\.", "", u)


def contacts(text: str) -> set[str]:
    s = _clean(text)
    out: set[str] = set()
    emails = _EMAIL.findall(s)
    out |= {f"email:{e.lower().rstrip('.')}" for e in emails}
    no_email = _EMAIL.sub(" ", s)
    out |= {f"url:{_canon_url(u)}" for u in _URL.findall(no_email)}
    no_url = _URL.sub(" ", no_email)
    for p in _PHONE.findall(no_url):
        d = re.sub(r"\D", "", p)
        if p.strip().startswith("+66"):
            d = "0" + d[2:]
        if len(d) >= 9:
            out.add(f"phone:{d}")
    out |= {f"line:{x.lower()}" for x in _LINE.findall(no_url)}
    return out


# ------------------------------------------------------------------ G4 วันที่
_MONTHS_TH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม",
              "พฤศจิกายน", "ธันวาคม"]
_MONTHS_TH_ABBR = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
_MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
              "December"]
_MONTH_TOKENS: list[tuple[str, int, bool]] = []      # (ข้อความ, เดือน 1-12, ต้องตรงตัวพิมพ์)
for i in range(12):
    _MONTH_TOKENS += [(_MONTHS_TH[i], i + 1, False), (_MONTHS_TH_ABBR[i], i + 1, False), (_MONTHS_TH_ABBR[i].rstrip("."), i + 1, False),
                      (_MONTHS_EN[i], i + 1, True)]
    if _MONTHS_EN[i] != "May":
        _MONTH_TOKENS.append((_MONTHS_EN[i][:3] + ".", i + 1, True))
        _MONTH_TOKENS.append((_MONTHS_EN[i][:3], i + 1, True))
_MONTH_TOKENS.sort(key=lambda t: len(t[0]), reverse=True)
_MONTH_RE = re.compile("|".join(re.escape(t[0]) for t in _MONTH_TOKENS))
_MONTH_OF = {t[0]: t[1] for t in _MONTH_TOKENS}
_MONTH_CASE = {t[0]: t[2] for t in _MONTH_TOKENS}


def dates(text: str) -> tuple[set[int], set[tuple[int, int]]]:
    """คืน (เดือนที่กล่าวถึง, คู่ (วัน, เดือน))"""
    s = _clean(text)
    months: set[int] = set()
    pairs: set[tuple[int, int]] = set()
    for m in _MONTH_RE.finditer(s):
        tok = m.group(0)
        if _MONTH_CASE[tok]:
            prev = s[m.start() - 1] if m.start() else " "
            nxt = s[m.end()] if m.end() < len(s) else " "
            if prev.isalpha() and prev.isascii() or (nxt.isalpha() and nxt.isascii()):
                continue                                   # อยู่กลางคำภาษาอังกฤษ
        elif tok == _MONTHS_TH_ABBR[_MONTH_OF[tok] - 1].rstrip("."):
            # ตัวย่อไม่มีจุดท้าย (เช่น "พ.ย") ต้องตามด้วยช่องว่าง/ตัวเลข/จบข้อความ
            nxt = s[m.end()] if m.end() < len(s) else " "
            if not (nxt.isspace() or nxt.isdigit()):
                continue
        mo = _MONTH_OF[tok]
        months.add(mo)
        before = re.search(r"(\d{1,2})\s*(?:th|st|nd|rd)?\s*$", s[max(0, m.start() - 6):m.start()])
        after = re.match(r"\s*(\d{1,2})(?!\d)", s[m.end():m.end() + 4])
        if before:
            pairs.add((int(before.group(1)), mo))
        elif after and _MONTH_CASE[tok]:
            pairs.add((int(after.group(1)), mo))
    return months, pairs


# ------------------------------------------------------------------ G3 สถานที่
_LOC = re.compile(r"(อาคาร|ตึก|ห้อง|ชั้น)\s*(\d+|[A-Za-z]\d*)|\b(Building|Bldg\.?|Room|Floor)\s*(\d+|[A-Z]\d*)\b|\b(\d+)(?:st|nd|rd|th)\s+floor\b", re.I)
_LOC_KIND = {"อาคาร": "bldg", "ตึก": "bldg", "ห้อง": "room", "ชั้น": "floor", "building": "bldg", "bldg": "bldg", "bldg.": "bldg",
             "room": "room", "floor": "floor"}


def locations(text: str) -> set[str]:
    s = _clean(text)
    out = set()
    for m in _LOC.finditer(s):
        if m.group(1):
            out.add(f"{_LOC_KIND[m.group(1)]}:{m.group(2).upper()}")
        elif m.group(3):
            out.add(f"{_LOC_KIND[m.group(3).lower()]}:{m.group(4).upper()}")
        else:
            out.add(f"floor:{m.group(5)}")
    return out


def _location_numbers(text: str) -> set[str]:
    return {_canon_num(v.split(":", 1)[1]) for v in locations(text) if v.split(":", 1)[1].isdigit()}


# ------------------------------------------------------------------ G1 / G2 / G9 คำที่ตามได้ทั่วไป
_GENERIC_TH = ("ฯ", "ที่", "ไหน", "ใด", "อะไร", "ต่าง", "ทั้ง", "ของ", "นี้", "นั้น", "เหล่า", "ใน", "และ", "หรือ", "ค่ะ", "คะ", "ครับ",
               "ได้", "จะ", "ก็", "มี", "เรียน", "อื่น", "ละ", "นะ", "เดียว", "หลัก", "เดิม", "ให้", "ไม่", "ตาม", "เลย", "ก่อน", "เปิด",
               "สนใจ", "ด้าน", "เรา", "แห่ง", "เป็น", "ยัง", "อยู่", "รับ", "ตั้ง", "สอน", "จัด", "ประจำ", "ผู้", "แนะแนว", "ที่ปรึกษา",
               "ทุก", "หลาย", "คอย", "ช่วย", "ดูแล", "เจ้าหน้าที่", "พิเศษ", "ฝ่าย", "งาน", "วิทยาลัย", "สาขา", "แผนก", "หัวหน้า",
               "นักศึกษา", "นักเรียน", "ใหญ่", "ท่าน", "ระดับ", "วิชา", "ต่อ", "จบ", "นั่น", "พวก", "แต่ละ", "บาง", "เกี่ยว", "ใกล้",
               "กับ", "แต่", "ซึ่ง", "เพื่อ", "จาก", "โดย", "ถึง", "เช่น", "คือ", "ว่า", "ต้อง", "ควร", "อาจ", "ยินดี", "ใจดี", "เก่ง",
               "น่ารัก", "บอก", "แนะนำ", "พา", "ตอบ", "ดู", "ตรวจ", "เข้า", "ออก", "มา", "ไป", "ทำ", "รอ", "เคย", "กำลัง", "คน")
_INSTITUTION_TYPES = ("เทคนิค", "อาชีวศึกษา", "การอาชีพ", "สารพัดช่าง", "เกษตร", "พณิชย", "เทคโนโลยี", "ประมง", "บริหารธุรกิจ",
                      "ช่างศิลป", "นาฏศิลป", "ชุมชน", "พยาบาล", "อาชีวะ")
_EN_COLLEGE = re.compile(r"\b((?:[A-Z][\w&.'-]*\s+){1,6})(College|Polytechnic|Institute)\b")
_PROGRAM_KW_RE = re.compile("สาขาวิชา|แผนกวิชา|หลักสูตร|สาขา|แผนก")
_STAFF_TH = re.compile(r"(รองผู้อำนวยการ|ผู้อำนวยการ|อาจารย์|ครู|ผอ\.|ดร\.)\s*([ก-๙]+)")
_STAFF_EN = re.compile(r"\b(Mr|Mrs|Ms|Dr|Teacher|Professor|Ajarn|Director)\.?\s+([A-Z][a-z]+)")
_LEVELS = ("ปวช", "ปวส", "ปริญญาตรี")


def _starts_generic(s: str) -> bool:
    return not s or any(s.startswith(g) for g in _GENERIC_TH)


# ------------------------------------------------------------------ ตัวช่วย
def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+|(?<=ค่ะ)\s+|(?<=ครับ)\s+|(?<=คะ)\s+|\s{2,}", _clean(text))
    return [p for p in parts if p.strip()]


def _program_mentions(text_ns: str, programs: list[Program], text_raw: str) -> list[Program]:
    """สาขาที่ถูกกล่าวถึง (จับคู่ยาวสุดก่อน แล้วลบช่วงที่จับได้ ไม่ให้นับซ้ำ)"""
    found = []
    work = text_ns
    raw_low = _clean(text_raw).lower()
    for p in sorted(programs, key=lambda p: -len(p.name_th or "")):
        th = _nospace(p.name_th)
        if len(th) >= 3 and th in work:
            found.append(p)
            work = work.replace(th, "\x00")
            continue
        en = (p.name_en or "").lower()
        if len(en) >= 4 and re.search(rf"\b{re.escape(en)}\b", raw_low):
            found.append(p)
    return found


class AnswerGuard:
    def check(self, answer: str, context_items: list[str], *, school_names: Iterable[str] = (), aliases: Iterable[str] = (),
              programs: Iterable[Program] = (), system_text: str = "", mode: str = INSTITUTIONAL) -> Verdict:
        codes: list[str] = []
        ans = _clean(answer or "")
        ans_ns = _nospace(ans)
        items = [_clean(c or "") for c in context_items]
        ctx_all = "\n".join(items)
        ctx_ns = _nospace(ctx_all)
        names = [n for n in school_names if n]
        alias_list = [a for a in aliases if a]
        progs = list(programs)
        general = mode == GENERAL

        # G7 — canary / ข้อความตรงตัวจากคำสั่งระบบ
        if CANARY.lower() in ans.lower():
            codes.append("G7_canary")
        st = _nospace(system_text)
        if st:
            for i in range(0, max(0, len(st) - 40) + 1, 10):
                w = st[i:i + 40]
                if len(w) == 40 and w in ans_ns and w not in ctx_ns:
                    codes.append("G7_prompt_echo")
                    break

        # G1 — ชื่อสถานศึกษา
        allowed_names_ns = [_nospace(n) for n in names + alias_list]
        for m in re.finditer("วิทยาลัย", ans_ns):
            rest = ans_ns[m.start():]
            if any(rest.startswith(a) for a in allowed_names_ns if a):
                if general and any(rest.startswith(_nospace(n)) for n in names):
                    codes.append("G1_general_mentions_school")
                continue
            tail = rest[len("วิทยาลัย"):]
            if any(tail.startswith(t) for t in _INSTITUTION_TYPES):
                cand = rest[:len("วิทยาลัย") + 16]
                if cand[:len("วิทยาลัย") + 6] not in ctx_ns:
                    codes.append("G1_school_name")
        for m in _EN_COLLEGE.finditer(ans):
            phrase = m.group(0).strip()
            first = phrase.split()[0].lower()
            if first in ("the", "our", "this", "a", "your", "my"):
                continue
            ok = any(_nospace(phrase) == _nospace(n) or _nospace(phrase).endswith(_nospace(n)) for n in names + alias_list)
            if ok:
                if general:
                    codes.append("G1_general_mentions_school")
                continue
            if _nospace(phrase) not in ctx_ns:
                codes.append("G1_school_name")

        # G2 — หลักสูตร/สาขา/ระดับ
        mentioned = _program_mentions(ans_ns, progs, ans)
        for p in mentioned:
            if general:
                codes.append("G2_general_mentions_program")
                break
            if not p.published:
                codes.append("G2_unpublished")
            elif _nospace(p.name_th) not in ctx_ns and (not p.name_en or p.name_en.lower() not in ctx_all.lower()):
                codes.append("G2_not_in_context")
        prog_ns = sorted({_nospace(p.name_th) for p in progs if p.name_th}, key=len, reverse=True)
        for m in _PROGRAM_KW_RE.finditer(ans_ns):
                kw = m.group(0)
                tail = ans_ns[m.end():m.end() + 40]
                pn = next((n for n in prog_ns if tail.startswith(n)), None)
                if pn:
                    rem = tail[len(pn):]
                    if rem.startswith("และ") and not any(rem[3:].startswith(n) for n in prog_ns) \
                            and not _starts_generic(rem[3:]) and (pn + rem[:9]) not in ctx_ns:
                        codes.append("G2_near_name")
                    continue
                if _starts_generic(tail):
                    continue
                if (kw + tail[:4]) in ctx_ns:
                    if general:
                        codes.append("G2_general_mentions_program")
                    continue
                codes.append("G2_unknown_program")
        for lv in _LEVELS:
            if lv in ans_ns.replace(".", "") and lv not in ctx_ns.replace(".", ""):
                codes.append("G2_level_not_in_context")

        # G3 — สถานที่
        ans_locs = locations(ans)
        ctx_locs = locations(ctx_all)
        if general and ans_locs:
            codes.append("G3_general_mentions_location")
        elif ans_locs - ctx_locs:
            codes.append("G3_location")

        # G4 — วันที่/เวลา
        a_months, a_pairs = dates(ans)
        c_months, c_pairs = dates(ctx_all)
        if not general:
            if a_months - c_months:
                codes.append("G4_month")
            if a_pairs - c_pairs:
                codes.append("G4_date")

        # G6 — ข้อมูลติดต่อ
        a_contacts = contacts(ans)
        c_contacts = contacts(ctx_all)
        if general and a_contacts:
            codes.append("G6_general_mentions_contact")
        elif a_contacts - c_contacts:
            codes.append("G6_contact")

        # G5 — ตัวเลข (ทุกตัวต้องอยู่ใน CONTEXT · พ.ศ.↔ค.ศ. เทียบได้)
        if not general:
            c_nums = _with_era(numbers(ctx_all))
            for c in c_contacts:
                if c.startswith("phone:"):
                    c_nums.add(_canon_num(c.split(":", 1)[1]))
            a_nums = numbers(ans)
            if a_nums - c_nums:
                codes.append("G5_number")

        # G9 — บุคลากร
        for m in _STAFF_TH.finditer(ans_ns):
            title, tail = m.group(1), m.group(2)
            if _starts_generic(tail):
                continue
            if general:
                codes.append("G9_general_mentions_staff")
                break
            if (title + tail[:3]) not in ctx_ns:
                codes.append("G9_staff")
        for m in _STAFF_EN.finditer(ans):
            if general:
                codes.append("G9_general_mentions_staff")
                break
            if m.group(2).lower() not in ctx_all.lower():
                codes.append("G9_staff")

        # G8 — ค่าผูกกับเรื่อง: คู่ (เอนทิตี, ค่า) ในประโยคเดียวกันต้องอยู่ร่วมใน "รายการ CONTEXT เดียวกัน"
        if not general and len(items) > 1:
            items_ns = [_nospace(i) for i in items]
            item_nums = [_with_era(numbers(i)) | {_canon_num(c.split(":", 1)[1]) for c in contacts(i) if c.startswith("phone:")}
                         for i in items]
            item_dates = [dates(i)[1] for i in items]
            item_contacts = [contacts(i) for i in items]
            item_locs = [locations(i) for i in items]
            for sent in _sentences(ans):
                s_ns = _nospace(sent)
                ents = [("p", _nospace(p.name_th)) for p in _program_mentions(s_ns, progs, sent)]
                ents += [("l", loc) for loc in locations(sent)]
                vals_n = numbers(sent) - _location_numbers(sent)
                vals_d = dates(sent)[1]
                vals_c = contacts(sent)
                if not ents or not (vals_n or vals_d or vals_c):
                    continue
                ok = False
                for k in range(len(items)):
                    if not all((v in items_ns[k]) if kind == "p" else (v in item_locs[k]) for kind, v in ents):
                        continue
                    if vals_n - item_nums[k] or vals_d - item_dates[k] or vals_c - item_contacts[k]:
                        continue
                    ok = True
                    break
                if not ok and not (set(codes) & {"G5_number", "G4_date", "G6_contact", "G2_not_in_context", "G3_location"}):
                    codes.append("G8_binding")

        return Verdict(ok=not codes, codes=sorted(set(codes)))


guard = AnswerGuard()
