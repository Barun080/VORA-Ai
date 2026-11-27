"""Phase 6 · Gate 6D — QueryRouter (จัดเส้นทางคำถามก่อนเรียก AI · ไม่ใช้ LLM · ไม่ค้นคืนเอง)

ขั้น A  initial(text, intent, conf, program) → (route0, reason)   — ก่อนเส้นทางกฎ / RAG / LLM
        unsafe  : injection:* (ตรวจก่อน) หรือ content:*      → ไม่เรียกผู้ให้บริการ ไม่ค้นคืน ตอบปฏิเสธคงที่
        institutional : เจตนาหมวดสถาบัน / พบชื่อสาขา / คำสำคัญสถาบัน
        out_of_scope  : เจตนา out_of_scope ความมั่นใจ ≥ 0.5 (เงื่อนไขเดียวกับ engine เดิม)
        pending       : ยังตัดสินไม่ได้ — รอผลค้นคืน
ขั้น B  refine(route0, best, threshold) → route                 — หลัง RAG
        อนุญาตเฉพาะ pending → institutional | general · unsafe ไม่เปลี่ยนเสมอ

ข้อจำกัด: รายการคำเป็นรายการคงที่ — อาจจับไม่ได้บางรูปแบบ (false negative) และอาจจับคำถามปกติบางคำ (false positive)
ซึ่งวัดและรายงานในชุดทดสอบ ไม่ได้อ้างว่าครอบคลุมทุกกรณี
"""
from __future__ import annotations

import re
from typing import Any

from .text import normalize

UNSAFE = "unsafe"
INSTITUTIONAL = "institutional"
OUT_OF_SCOPE = "out_of_scope"
PENDING = "pending"
GENERAL = "general"

INSTITUTIONAL_INTENTS = {
    "programs_list", "program_detail", "career", "admission", "tuition", "scholarship",
    "news", "activity", "location", "contact", "about_robot",
}

INSTITUTIONAL_WORDS_TH = (
    "วิทยาลัย", "สาขา", "แผนก", "หลักสูตร", "สมัครเรียน", "รับสมัคร", "ค่าเทอม", "ค่าเล่าเรียน", "ทุนการศึกษา",
    "ปวช", "ปวส", "อาจารย์", "ครู", "อาคาร", "ตึก", "ห้องเรียน", "นักศึกษา", "นักเรียน", "เปิดเทอม", "ภาคเรียน",
    "งานทะเบียน", "ฝ่ายวิชาการ", "ประชาสัมพันธ์", "วอร่า", "ห้องแล็บ", "ห้องแลบ", "ห้องสมุด", "ห้องพยาบาล", "ห้องน้ำ", "ห้องประชุม",
    "ห้องปฏิบัติการ", "ห้องคอม", "ห้องพักครู", "โรงอาหาร", "ที่จอดรถ", "โรงฝึก", "ชมรม", "กิจกรรม",
    "ระเบียบ", "เครื่องแบบ", "ชุดนักศึกษา", "ตารางเรียน", "ทะเบียน", "จบการศึกษา", "เรียนต่อ", "ฝึกงาน",
)
INSTITUTIONAL_WORDS_EN = (
    "college", "campus", "program", "programme", "major", "department", "tuition", "admission", "apply",
    "scholarship", "semester", "teacher", "lecturer", "building", "vora",
)

# --------------------------------------------------------------- unsafe: prompt injection (ตรวจกับข้อความเดิม ตัวพิมพ์เล็ก)
_INJECTION: list[tuple[str, re.Pattern[str]]] = [
    ("injection:delimiter", re.compile(r"<{3,}|>{3,}|<\|[a-z_]*\|?>|\[/?(system|inst)\]|(^|\n)\s*#{0,3}\s*(system|assistant|developer)\s*:", re.I)),
    ("injection:reveal_prompt", re.compile(
        r"system\s*prompt|initial\s+instructions|your\s+(instructions|prompt|rules|configuration)|reveal\s+your|"
        r"repeat\s+(the\s+)?(text|words|everything)\s+above|print\s+your\s+prompt|"
        r"(ซิส|ซิสเต็ม|ระบบ)\s*(พรอมต์|พรอมท์|prompt)|(พรอมต์|พรอมท์|prompt)\s*(ระบบ|ของคุณ|ของเธอ|ของหนู)|คำสั่งระบบ|"
        r"(กฎ|คำสั่ง|ข้อกำหนด)ที่(คุณ|เธอ|หนู)ได้รับ|(คุณ|เธอ|หนู)ถูกตั้งค่า|การตั้งค่าของ(คุณ|เธอ|หนู)|"
        r"เปิดเผยคำสั่ง|บอกคำสั่งที่", re.I)),
    ("injection:override", re.compile(
        r"ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)|disregard\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above)|"
        r"forget\s+(all\s+|everything|your|previous)|you\s+are\s+now\s+|from\s+now\s+on\s+you|pretend\s+(to\s+be|you\s+are)|"
        r"(ไม่ต้อง|อย่า)(สนใจ|ทำตาม)คำสั่ง|ลืมคำสั่ง|เพิกเฉย(ต่อ)?คำสั่ง|ละเว้นคำสั่ง|ยกเลิกคำสั่ง(ก่อนหน้า|เดิม)|"
        r"จากนี้(ไป)?ให้(คุณ|เธอ|หนู)(เป็น|ทำตัว|ตอบ)|สวมบทบาท|แกล้งทำเป็น", re.I)),
    ("injection:privilege", re.compile(
        r"developer\s+mode|admin\s+mode|god\s+mode|jailbreak|\bdan\b\s+mode|sudo\s|api[\s_-]*key|"
        r"โหมด(ผู้ดูแล|นักพัฒนา|แอดมิน)|สิทธิ์(ผู้ดูแล|แอดมิน|admin)|ให้สิทธิ์|คีย์\s*api|"
        r"เปลี่ยน(ผู้ให้บริการ|provider|โมเดล)|เปิด(โหมด)?\s*general|สั่ง(หุ่นยนต์|มอเตอร์)ผ่าน", re.I)),
]

# --------------------------------------------------------------- unsafe: คำขอเนื้อหาที่ไม่ปลอดภัย
# ไทย: ตรวจกับข้อความที่ normalize แล้วและตัดช่องว่าง · อังกฤษ: ตรวจกับข้อความ normalize (มีช่องว่าง)
_DRUG = r"(ยาบ้า|ยาไอซ์|ไอซ์|ยาเสพติด|เฮโรอีน|โคเคน|กัญชา|ยาอี|เคตามีน)"
_CONTENT_TH: list[tuple[str, re.Pattern[str]]] = [
    ("content:self_harm", re.compile(r"ฆ่าตัวตาย|ทำร้ายตัวเอง|ทำร้ายตนเอง|กรีดข้อมือ|อยากตาย|จบชีวิตตัวเอง|ไม่อยากมีชีวิต")),
    ("content:weapon", re.compile(r"(ทำ|สร้าง|ประกอบ|ผลิต|วิธีทำ)(ลูก)?ระเบิด|วัตถุระเบิด|ระเบิดแสวงเครื่อง|"
                                  r"(ทำ|สร้าง|ประกอบ|ผลิต|ซื้อ|หา)(อาวุธ|ปืน(?!ยิงกาว|กาว|ฉีด|ลม))|ปืนเถื่อน|อาวุธ(สงคราม|ร้ายแรง)")),
    ("content:violence", re.compile(r"ฆ่า(คน|ครู|อาจารย์|เพื่อน|นักเรียน|นักศึกษา)|ทำร้าย(คน|ร่างกาย|ครู|เพื่อน)|"
                                    r"(ยิง|แทง)(คน|ครู|เพื่อน)|วางยาพิษ|กราดยิง|วางแผนทำร้าย")),
    ("content:sexual", re.compile(r"เซ็กส์|เซ็กซ์|หนังโป๊|ภาพโป๊|คลิปโป๊|คลิปหลุด|ลามกอนาจาร|ภาพเปลือย")),
    ("content:drugs", re.compile(rf"(ซื้อ|ขาย|ผลิต|ทำ|เสพ|สูบ|หา|สั่ง){_DRUG}")),
    ("content:illegal", re.compile(r"(วิธี|ช่วย|สอน)(ขโมย|ลักขโมย|โกงข้อสอบ|ปลอมเอกสาร|ปลอมใบ|ปลอมลายเซ็น|แฮก|แฮ็ก|เจาะระบบ)|"
                                   r"แฮก(เฟซ|เฟส|ไอจี|บัญชี|ระบบ)|แฮ็ก(เฟซ|เฟส|ไอจี|บัญชี|ระบบ)|เว็บพนัน|พนันออนไลน์|บาคาร่า|ฟอกเงิน")),
    ("content:personal_data", re.compile(r"(เบอร์|เบอร์โทร|โทรศัพท์|ไลน์|ไอจี|เฟซ|เฟส|อีเมล)ส่วนตัว|"
                                         r"(ที่อยู่บ้าน|บ้าน)(ของ)?(ครู|อาจารย์|ผอ|ผู้อำนวยการ|นักเรียน|นักศึกษา|รุ่นพี่|เพื่อน)[ก-๙]*(อยู่|ที่ไหน)|"
                                         r"เลขบัตรประชาชน(ของ)?(ครู|อาจารย์|ผอ|ผู้อำนวยการ|นักเรียน|นักศึกษา|รุ่นพี่|เพื่อน)")),
]
_CONTENT_EN: list[tuple[str, re.Pattern[str]]] = [
    ("content:self_harm", re.compile(r"\b(suicide|kill myself|self harm|selfharm|hurt myself|end my life)\b")),
    ("content:weapon", re.compile(r"\b(make|build|buy|assemble)\s+(a\s+)?(bomb|explosive|gun|weapon|firearm)s?\b|\bpipe bomb\b|\bexplosives?\b")),
    ("content:violence", re.compile(r"\b(kill|murder|stab|shoot|poison)\s+(someone|people|a person|my teacher|teachers?|students?)\b|\bschool shooting\b")),
    ("content:sexual", re.compile(r"\b(porn|porno|pornography|nude|nudes|sex video|nsfw)\b")),
    ("content:drugs", re.compile(r"\b(buy|sell|make|cook)\s+(meth|cocaine|heroin|drugs|ecstasy|ketamine)\b")),
    ("content:illegal", re.compile(r"\b(how to\s+)?(steal|hack into|cheat on (the |an )?exam|forge|fake (a )?certificate)\b|\bonline gambling\b|\blaunder money\b")),
    ("content:personal_data", re.compile(r"\b(home address|(personal|private) (phone |mobile )?(number|phone))\s+of\b")),
]

REASONS = tuple(r for r, _ in _INJECTION) + tuple(dict.fromkeys(r for r, _ in _CONTENT_TH + _CONTENT_EN))

# การเปลี่ยนเส้นทางที่อนุญาตในขั้น B (ทุกอย่างนอกตารางนี้ = คงค่าเดิม)
ALLOWED_TRANSITIONS = {
    UNSAFE: {UNSAFE},
    INSTITUTIONAL: {INSTITUTIONAL},
    OUT_OF_SCOPE: {OUT_OF_SCOPE},
    PENDING: {INSTITUTIONAL, GENERAL},
}


def detect_unsafe(text: str) -> str | None:
    """คืน reason ของ unsafe (injection ตรวจก่อน content) หรือ None"""
    raw = (text or "")
    low = raw.lower()
    for reason, pat in _INJECTION:
        if pat.search(low):
            return reason
    n = normalize(raw)
    ns = n.replace(" ", "")
    for reason, pat in _CONTENT_TH:
        if pat.search(ns):
            return reason
    for reason, pat in _CONTENT_EN:
        if pat.search(n):
            return reason
    return None


def _has_institutional_word(text: str, extra: tuple[str, ...] = ()) -> bool:
    n = normalize(text)
    ns = n.replace(" ", "")
    if any(w in ns for w in INSTITUTIONAL_WORDS_TH + tuple(normalize(e).replace(" ", "") for e in extra if e)):
        return True
    return any(re.search(rf"\b{w}\b", n) for w in INSTITUTIONAL_WORDS_EN)


def initial(text: str, intent_used: str, conf: float, program: Any = None,
            school_names: tuple[str, ...] = ()) -> tuple[str, str]:
    """ขั้น A — คืน (route0, reason) · reason ว่างเมื่อไม่ใช่ unsafe"""
    reason = detect_unsafe(text)
    if reason:
        return UNSAFE, reason
    if intent_used in INSTITUTIONAL_INTENTS or program is not None or _has_institutional_word(text, school_names):
        return INSTITUTIONAL, ""
    if intent_used == "out_of_scope" and conf >= 0.5:
        return OUT_OF_SCOPE, ""
    return PENDING, ""


def refine(route0: str, best: float, threshold: float) -> str:
    """ขั้น B — หลังค้นคืน · unsafe/institutional/out_of_scope ไม่เปลี่ยน · pending → institutional (พบ) | general (ไม่พบ)"""
    if route0 != PENDING:
        new = route0
    else:
        new = INSTITUTIONAL if best >= threshold else GENERAL
    if new not in ALLOWED_TRANSITIONS.get(route0, {route0}):    # ป้องกันชั้นที่ 2 — ไม่มีทางเกิดตามโค้ดข้างบน
        return route0
    return new


def general_after_no_info(route0: str, text: str, program: Any = None, school_names: tuple[str, ...] = ()) -> bool:
    """11 พ.ย. 2569 — หลัง LLM อ่าน CONTEXT ที่ค้นเจอแล้วตอบ NO_INFO (ค้นเจอ FAQ แต่ไม่เกี่ยวกับคำถามจริง)
    อนุญาตเส้นทาง general เฉพาะเมื่อคำถาม "ไม่มี" ชื่อสาขา/คำสำคัญของสถาบัน/ชื่อสถานศึกษา
    ใช้แก้กรณีโมเดลเจตนาจัดคำถามทั่วไปเป็นเจตนาสถาบัน หรือคำว่า "…คืออะไร" ไปตรงกับ FAQ ทั่วไป
    unsafe และ out_of_scope ไม่ผ่านฟังก์ชันนี้ (ตัดสินไปแล้วในขั้น A)"""
    if route0 in (UNSAFE, OUT_OF_SCOPE) or program is not None:
        return False
    return not _has_institutional_word(text, school_names)
