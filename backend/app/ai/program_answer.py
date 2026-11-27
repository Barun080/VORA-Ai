"""23 พ.ย. 2569: ตอบคำถามเรื่องสาขาให้ "ตรงประเด็นที่ถาม" (เดิมทุกคำถามได้คำอธิบายสาขาประโยคเดียวกัน)

ปัญหาที่พบจริง (สมองโปร่งใส 23 พ.ย.):
  "มีแผนกเทคโนโลยีคอมพิวเตอร์ไหม" → ตอบคำอธิบายสาขา ไม่ได้ตอบว่า "มี"
  "เรียนเกี่ยวกับอะไรบ้าง"         → ตอบประโยคเดียวกันทุกตัวอักษร
  "คอมเรียนกี่ปี" / "ยากไหม"      → ก็ได้คำอธิบายสาขาเหมือนกัน (ไม่ตรงคำถามเลย)

วิธีทำ: แยก "ประเด็นที่ถาม" (aspect) ด้วยคำบ่งชี้ แล้วเลือกข้อมูลจากช่องของสาขาให้ตรงประเด็น
  exists  มี…ไหม / เปิดสอนไหม     → "มีค่ะ …" + ระดับที่เปิดสอน (ถ้ามีข้อมูล) + เรียนอะไร + อาชีพ
  learn   เรียนอะไร / วิชาอะไร       → เรียนเกี่ยวกับ…
  suits   เหมาะกับใคร / ใครควรเรียน → เหมาะกับ…
  career  (ตัดสินที่ engine เดิม)     → จบแล้วทำงาน…
  overview ชื่อสาขาเฉย ๆ / คืออะไร  → ภาพรวมสั้น ๆ
  other   กี่ปี ค่าเทอม ทุน ยากไหม ต่อ ป.ตรี ฯลฯ → ไม่ตอบจากช่องสาขา (ไม่มีข้อมูลตรงนั้น) — ส่งไปค้นฐานความรู้/ให้ AI เรียบเรียง
          ถ้าไม่มีข้อมูลจริง → บอกตรง ๆ ว่ายังไม่มีข้อมูลเรื่องนั้น + สิ่งที่บอกได้ และบันทึกเป็นคำถามที่ตอบไม่ได้
ทั้งหมดใช้เฉพาะข้อมูลในฐานข้อมูล ไม่มีการแต่งข้อมูล · เร็ว (< 1 ms) · ปิดได้ด้วย VORA_PROGRAM_SMART=0 (กลับไปแบบเดิม)
"""
from __future__ import annotations

import re
from typing import Any

from .text import normalize

EXISTS, LEARN, SUITS, CAREER, OVERVIEW, OTHER, RECOMMEND = "exists", "learn", "suits", "career", "overview", "other", "recommend"
ASPECT_TH = {EXISTS: "มีหรือไม่", LEARN: "เรียนอะไร", SUITS: "เหมาะกับใคร", CAREER: "จบแล้วทำงานอะไร",
             OVERVIEW: "ภาพรวมสาขา", RECOMMEND: "แนะนำสาขาให้", OTHER: "เรื่องเฉพาะ (ค้นฐานความรู้)"}

# เรื่องที่ "ช่องของสาขา" ไม่มีข้อมูล → ต้องค้นฐานความรู้ (มาก่อนประเด็นอื่น เพราะเจาะจงกว่า)
_OTHER = ("กี่ปี", "กี่เทอม", "ระยะเวลา", "นานไหม", "นานมั้ย", "ค่าเทอม", "ค่าเรียน", "ค่าใช้จ่าย", "ทุน", "รับกี่คน", "รับสมัคร",
          "สมัคร", "เกรด", "คุณสมบัติ", "ต้องใช้อะไร", "ต่อปริญญา", "ต่อป.ตรี", "ต่อ ป.ตรี", "เรียนต่อ", "ยากไหม", "ยากมั้ย",
          "ยากป่ะ", "ยากหรือเปล่า", "หนักไหม", "ฝึกงาน", "ทวิภาคี", "ที่ไหน", "ตึก", "อาคาร", "ห้องเรียน", "อาจารย์", "ครูประจำ",
          "หัวหน้าแผนก", "ต่างกัน", "ต่างจาก", "เปรียบเทียบ", "ชุดนักศึกษา", "เครื่องแบบ", "ผู้หญิงเรียนได้", "รอบเช้า", "รอบบ่าย",
          "ภาคค่ำ", "เทียบโอน",
          # 23 พ.ย. 2569 (จากชุดทดสอบ 115 คำถาม): เรื่องที่ช่องของสาขาไม่มีข้อมูล → ค้นฐานความรู้
          "ระดับไหน", "เปิดระดับ", "สาขาอะไร", "มีสาขาไหน", "มี ปวส", "มีปวส", "มี ปวช", "มีปวช", "เขียนโปรแกรม", "เขียนโค้ด",
          "กิจกรรม", "ตรงไหน", "อยู่ไหน", "ตึกไหน", "ห้อง", "พื้นฐาน", "เก่ง", "อาจารย์", "ครู", "สอบ", "โควตา", "ชุด",
          "how long", "how many years", "tuition", "fee", "scholarship", "apply", "requirement", "difficult", "hard",
          "internship", "where is", "teacher", "compare", "difference")
_EXISTS = re.compile(r"(มี|เปิด(สอน|รับ)?)\s*(แผนก|สาขา|หลักสูตร|วิชา)?.{0,40}?(ไหม|มั้ย|มั๊ย|หรือเปล่า|หรือไม่|ป่ะ|ปะ|รึเปล่า|ไม๊)\s*(คะ|ครับ|ค่ะ|จ้ะ|จ๊ะ)?\s*$"
                     r"|^\s*(do you|does the college|is there|are there).*(have|offer)?")
_LEARN = ("เรียนอะไร", "เรียนเกี่ยวกับ", "เรียนวิชา", "วิชาอะไร", "ได้เรียน", "เนื้อหา", "ฝึกอะไร", "เรียนแบบไหน", "เรียนยังไง",
          "what do", "what will i learn", "subjects", "study")
_SUITS = ("เหมาะกับ", "ใครควรเรียน", "ควรเรียนไหม", "ควรเรียนมั้ย", "ชอบอะไรถึง", "นิสัยแบบไหน", "who is it for", "suitable")
_RECOMMEND = ("ควรเรียนสาขาไหน", "ควรเรียนอะไร", "เรียนสาขาไหนดี", "เรียนอะไรดี", "แนะนำสาขา", "สาขาไหนดี", "which program should")
_OVERVIEW = ("คืออะไร", "เป็นยังไง", "เป็นอย่างไร", "รายละเอียด", "แนะนำ", "เล่า", "what is", "tell me about")


_CAREER = re.compile(r"(เป็น|ทำงาน|อาชีพ|ทำอาชีพ).{0,25}ได้(ไหม|มั้ย|ป่ะ|ปะ|หรือเปล่า|รึเปล่า|บ้าง)")


def aspect(text: str, intent_used: str) -> str:
    """ประเด็นที่ผู้ใช้ถามเกี่ยวกับสาขา (ฟังก์ชันล้วน ทดสอบได้)"""
    q = normalize(text)
    if intent_used == "career" or _CAREER.search(q):
        return CAREER
    if any(c in q for c in _RECOMMEND):
        return RECOMMEND
    if any(c in q for c in _OTHER):
        return OTHER
    if any(c in q for c in _SUITS):
        return SUITS
    if any(c in q for c in _LEARN):
        return LEARN
    if _EXISTS.search(q):
        return EXISTS
    return OVERVIEW


def _clean(s: str | None) -> str:
    s = re.sub(r"\s+", " ", (s or "")).strip()
    return re.sub(r"(ค่ะ|ครับ|นะคะ)?\s*[.。]?$", "", s).strip()


def _label(p: Any) -> str:
    n = (p.name_th or "").strip()
    return n if n.startswith(("สาขา", "แผนก")) else f"สาขา{n}"


def _learn_th(p: Any) -> str:
    d = _clean(p.description_th)
    if not d:
        return ""
    if d.startswith(("เรียน", "สาขา", "แผนก", "หลักสูตร", "ฝึก")) or len(d) > 90:
        return d
    return f"เรียนเกี่ยวกับ{d}"


def _levels(levels: list[str], lang: str) -> str:
    lv = [x for x in dict.fromkeys(l.strip() for l in levels if l and l.strip())]
    if not lv:
        return ""
    if lang == "en":
        return " It is offered at " + " and ".join(lv) + " level."
    return " เปิดสอนระดับ " + " และ ".join(lv)


def compose(p: Any, asp: str, lang: str, levels: list[str] | None = None) -> str:
    """ประกอบคำตอบจากช่องข้อมูลของสาขา · คืน "" ถ้าช่องที่ต้องใช้ว่าง (ให้ engine ไปค้นฐานความรู้ต่อ)"""
    levels = levels if levels is not None else [p.level or ""]
    if lang == "en":
        name = p.name_en or p.name_th
        learn, careers, suits = _clean(p.description_en), _clean(p.careers_en), _clean(p.suits_en)
        if asp == EXISTS:
            out = f"Yes, we offer {name}." + _levels(levels, "en")
            out += f" You'll study {learn[0].lower() + learn[1:]}." if learn else ""
            return out + (f" Graduates can work as {careers}." if careers else "")
        if asp == LEARN:
            return f"In {name} you'll study {learn[0].lower() + learn[1:]}." if learn else ""
        if asp == SUITS:
            return f"{name} suits {suits[0].lower() + suits[1:]}" if suits else ""
        if asp == CAREER:
            return f"Graduates of {name} can work as {careers}" if careers else ""
        if asp == RECOMMEND:
            return (f"I'd suggest {name}." + (f" It suits {suits[0].lower() + suits[1:]}." if suits else "")
                    + (f" You'll study {learn[0].lower() + learn[1:]}." if learn else ""))
        if asp == OVERVIEW:
            return f"{name}{f' ({p.level})' if p.level else ''}: {learn}." + (f" Graduates can work as {careers}." if careers else "") if learn else ""
        return ""
    lab = _label(p)
    learn, careers, suits = _learn_th(p), _clean(p.careers_th), _clean(p.suits_th)
    if asp == EXISTS:
        out = f"มีค่ะ วิทยาลัยมี{lab}" + _levels(levels, "th")
        out += f" {learn}" if learn else ""
        out += f" จบแล้วทำงานเป็น{careers}ได้" if careers else ""
        return out + " สนใจเรื่องไหนถามต่อได้เลยนะคะ"
    if asp == LEARN:
        if not learn:
            return ""
        out = f"{lab}{learn}ค่ะ"
        return out + (f" {suits}" if suits and len(out) < 160 else "")
    if asp == SUITS:
        if not suits:
            return ""
        return f"{lab}{suits if suits.startswith('เหมาะ') else 'เหมาะกับ' + suits}ค่ะ"
    if asp == CAREER:
        return f"จบ{lab}แล้ว ทำงานเป็น{careers}ได้ค่ะ" if careers else ""
    if asp == RECOMMEND:
        out = f"แนะนำ{lab}ค่ะ"
        out += f" {suits if suits.startswith('เหมาะ') else 'เหมาะกับ' + suits}" if suits else ""
        return out + (f" {learn}" if learn else "")
    if asp == OVERVIEW:
        if not learn:
            return ""
        out = f"{lab}{_lv(p.level)} {learn}"
        return out + (f" จบแล้วทำงานเป็น{careers}ได้ค่ะ" if careers else "ค่ะ")
    return ""


def _lv(level: str | None) -> str:
    return f" ระดับ {level}" if level else ""


def not_found(p: Any, lang: str, text: str) -> str:
    """ประเด็นเฉพาะที่ยังไม่มีข้อมูล → บอกตรง ๆ (ไม่เดา) + สิ่งที่บอกได้"""
    if lang == "en":
        name = p.name_en or p.name_th
        learn = _clean(p.description_en)
        return (f"I don't have that information about {name} yet. Please ask the registration office."
                + (f" What I can tell you: you'll study {learn[0].lower() + learn[1:]}." if learn else ""))
    lab, learn = _label(p), _learn_th(p)
    return (f"เรื่องนี้ของ{lab}ยังไม่มีข้อมูลในระบบค่ะ แนะนำสอบถามงานทะเบียนหรือแผนกโดยตรงนะคะ"
            + (f" ที่บอกได้ตอนนี้คือ {lab}{learn}ค่ะ" if learn else ""))
