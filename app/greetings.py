"""คำทักทายตามบริบทของ VORA (Context-aware Greeting) — 16 พ.ย. 2569

ใช้กับการทักทายอัตโนมัติ (POST /api/greet) ทั้งไทยและอังกฤษ · ไม่ใช้ LLM · ข้อความทั้งหมดเป็นแม่แบบคงที่ที่ทีมอนุมัติ
อังกฤษ (เพิ่ม 16 พ.ย. 2569 รอบ 3): คำแปลของ 12 ประโยคเดียวกัน ใช้ pool / Emoji / กันซ้ำชุดเดียวกับไทย
  ขึ้นต้นด้วย Good morning / Good afternoon / Good evening ตามเวลาปัจจุบัน (แทน Hello) · หลายคน = "..., everyone"

ลำดับการทำงาน:
  1) ระบุบริบท (resolve_context):
       หน้านำเสนอที่เปิดอยู่ → ช่วงรับสมัคร → กล้องเห็นคนใหม่ (kiosk) → general
     ช่วงรับสมัครไม่ทับ kiosk ทุกครั้ง: ใช้ชุดรับสมัครได้ไม่เกิน 1 ครั้งในทุก ADMISSION_EVERY ครั้ง
     ระบุบริบทไม่ได้ → general
  2) เลือกประโยคจาก pool ของบริบทนั้นเท่านั้น (ไม่หยิบจากบริบทอื่น)
  3) กันซ้ำ (Anti-Repetition) — ทำหลังเลือกบริบทแล้ว:
       ตัดประโยคที่พูดไปใน HISTORY_SIZE ครั้งล่าสุด (ทุกบริบทรวมกัน) และที่ใช้แล้วในรอบปัจจุบันของบริบทนี้ → สุ่มจากที่เหลือ
       ไม่เหลือ → ล้างประวัติ "เฉพาะบริบทนี้" แล้วเริ่มรอบใหม่ โดยไม่ใช้ประโยคที่เพิ่งพูดล่าสุด (ถ้า pool มีมากกว่า 1 ประโยค)
     เทียบความซ้ำจาก "ข้อความที่พูด" (ตัด Emoji แล้ว) — Emoji ต่างกันแต่พูดเหมือนกัน = ประโยคเดียวกัน
     กรองก่อนแล้วจึงสุ่ม (ไม่มีการสุ่มซ้ำจนกว่าจะได้) · ประวัติเก็บในหน่วยความจำ รีสตาร์ทเซิร์ฟเวอร์ = เริ่มใหม่

ข้อจำกัด (ระบุตามจริง): บริบท parent / student มี pool แล้ว แต่ระบบยังไม่มีสัญญาณที่บอกได้ว่าผู้ใช้เป็นใคร
(ไม่มีการจดจำใบหน้า) จึงจะถูกใช้ก็ต่อเมื่อผู้เรียกส่ง context มาเองเท่านั้น
"""
from __future__ import annotations

import random
import re
import threading
from collections import deque
from dataclasses import dataclass
from typing import Iterable, Optional

HELLO = "สวัสดีค่ะ"
HELLO_ALL = "สวัสดีค่ะทุกคน"
HISTORY_SIZE = 5            # จำประโยคที่พูดล่าสุดกี่ครั้ง (ทุกบริบทรวมกัน)
ADMISSION_EVERY = 3         # ช่วงรับสมัคร: ใช้ชุดรับสมัคร 1 ครั้งในทุกกี่ครั้งของการทักทาย
DEFAULT_CONTEXT = "general"
KIOSK_TRIGGERS = frozenset({"face", "gesture", "touch", "patrol"})

# ข้อความหลัง "สวัสดีค่ะ" — ชุดที่ทีมอนุมัติ 12 ประโยค (เลขตรงกับเอกสารที่อนุมัติ)
GREETINGS: dict[int, str] = {
    # กึ่งทางการ (หลัก)
    1: "มีอะไรอยากรู้เกี่ยวกับการเรียนสายอาชีพ ลองถาม VORA ได้เลยนะคะ",
    2: "VORA พร้อมช่วยแล้วนะคะ อยากรู้เรื่องสาขา การเรียน หรือกิจกรรมของวิทยาลัย ถามได้เลยค่ะ",
    3: "มีคำถามเกี่ยวกับวิทยาลัยหรือการเรียนสายอาชีพ ถาม VORA ได้เลยนะคะ",
    4: "อยากรู้จักสาขาวิชาไหน หรืออยากรู้ว่าที่นี่มีอะไรน่าสนใจ ถาม VORA ได้เลยค่ะ",
    5: "VORA พร้อมพาไปรู้จักสาขาวิชาและเรื่องราวน่าสนใจของวิทยาลัยค่ะ อยากเริ่มจากเรื่องไหนดีคะ?",
    # เป็นกันเอง
    6: "เข้ามาแล้วอย่าลืมแวะมาคุยกับ VORA นะคะ อยากรู้อะไรเกี่ยวกับวิทยาลัยถามได้เลยค่ะ",
    7: "กำลังสนใจเรียนสายอาชีพอยู่หรือเปล่าคะ? VORA ช่วยแนะนำข้อมูลให้ได้นะคะ",
    8: "วันนี้อยากให้ VORA พาไปรู้จักเรื่องอะไรเกี่ยวกับวิทยาลัยดีคะ?",
    9: "อยากรู้จักสาขาไหน กิจกรรมอะไร หรือผลงานของนักเรียน ลองถาม VORA ได้เลยค่ะ",
    # ทางการ
    10: "หากต้องการข้อมูลเกี่ยวกับหลักสูตร สาขาวิชา หรือการสมัครเรียน VORA พร้อมให้ข้อมูลค่ะ",
    11: "VORA พร้อมให้ข้อมูลเกี่ยวกับการศึกษาและเรื่องราวต่าง ๆ ของวิทยาลัยค่ะ ต้องการสอบถามเรื่องใดคะ?",
    12: "หากกำลังมองหาเส้นทางการศึกษาสายอาชีพ VORA พร้อมช่วยค้นหาข้อมูลที่เหมาะกับคุณค่ะ",
}

# คำแปลอังกฤษของประโยคเดียวกัน (เลขตรงกัน) — ข้อความหลังคำทักตามเวลา (Good morning ฯลฯ)
GREETINGS_EN: dict[int, str] = {
    1: "Curious about vocational education? Just ask VORA.",
    2: "VORA is ready to help. Ask me about our programs, studying here, or college activities.",
    3: "Have a question about the college or vocational education? Ask VORA anytime.",
    4: "Want to explore a program, or see what's interesting here? Just ask VORA.",
    5: "VORA can show you our programs and stories from around the college. Where would you like to start?",
    6: "Since you're here, come and chat with VORA. Ask me anything about the college.",
    7: "Thinking about vocational education? VORA can point you in the right direction.",
    8: "What would you like VORA to show you about the college today?",
    9: "Programs, activities, or student projects, just ask VORA about any of them.",
    10: "If you need information about our curricula, programs, or admission, VORA is ready to assist you.",
    11: "VORA can provide information about education and life at the college. What would you like to know?",
    12: "If you are looking for a path in vocational education, VORA can help you find the information that suits you.",
}
FORMAL_IDS = frozenset({10, 11, 12})     # กลุ่มทางการ: อังกฤษลงท้ายคำทักด้วย "." (กลุ่มอื่น "!")


def salutation_en(hour: int) -> str:
    """คำทักตามเวลา — เกณฑ์เดียวกับ /api/greet เดิม: ก่อน 12 น. / ก่อน 17 น. / หลังจากนั้น"""
    return "Good morning" if hour < 12 else "Good afternoon" if hour < 17 else "Good evening"


# บริบท → (เลขประโยค, Emoji ตามบริบท) · "" = ไม่มี Emoji (ตั้งใจให้บางประโยคไม่มี)
POOL_SPEC: dict[str, tuple[tuple[int, str], ...]] = {
    "general":   ((1, "😊"), (3, "👋"), (6, ""), (8, "✨")),
    "program":   ((2, ""), (4, "🎓"), (5, "📚")),
    "admission": ((10, "📝"), (12, "")),
    "activity":  ((2, "✨"), (9, "🏆"), (11, "")),
    "parent":    ((10, ""), (11, ""), (12, "")),
    "student":   ((1, "😊"), (7, "👋"), (8, "")),
    "kiosk":     ((6, "😊"), (7, "👋"), (9, "✨")),
}

# ค่าที่ผู้เรียกส่งมา (ชื่อหน้านำเสนอของ Kiosk หรือชื่อบริบทโดยตรง) → บริบท
CONTEXT_ALIASES: dict[str, str] = {
    "general": "general", "college": "general",
    "program": "program", "programs": "program", "department": "program", "departments": "program",
    "admission": "admission",
    "activity": "activity", "event": "activity", "news": "activity",
    "parent": "parent", "student": "student", "kiosk": "kiosk",
}

# ช่วงอักขระเดียวกับ frontend/kiosk/voice/speech-text.js (EMOJI) — ใช้ทำ "ข้อความที่พูด" สำหรับเทียบความซ้ำ
_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️‍⃣\U000E0020-\U000E007F]")
_SPACES = re.compile(r"\s+")


def strip_emoji(text: str) -> str:
    return _SPACES.sub(" ", _EMOJI.sub(" ", str(text or ""))).strip()


@dataclass(frozen=True)
class Greeting:
    context: str
    id: int
    emoji: str
    body: str

    def display(self, people: int = 1, emoji: bool = True, lang: str = "th", hour: int = 12) -> str:
        """display_text — ข้อความบนหน้าจอ (มี Emoji ได้) · emoji=False สำหรับผู้เรียกที่ไม่ได้ตัด Emoji ก่อนส่งเสียงพูด
        lang="en": คำแปลอังกฤษ ขึ้นต้นด้วยคำทักตามเวลา (hour = ชั่วโมงปัจจุบัน 0–23)"""
        mark = f" {self.emoji}" if emoji and self.emoji else ""
        if lang == "en":
            head = salutation_en(hour) + (", everyone" if people > 1 else "")
            return f"{head}{'.' if self.id in FORMAL_IDS else '!'}{mark} {GREETINGS_EN[self.id]}"
        head = HELLO_ALL if people > 1 else HELLO
        return f"{head}{mark} {self.body}"

    def tts_text(self, people: int = 1, lang: str = "th", hour: int = 12) -> str:
        """tts_text — ข้อความที่พูด (ไม่มี Emoji)"""
        return strip_emoji(self.display(people, emoji=False, lang=lang, hour=hour))

    @property
    def key(self) -> str:
        """คีย์กันซ้ำ = ข้อความที่พูด (Emoji ต่างกันแต่พูดเหมือนกัน = คีย์เดียวกัน) · ไทย/อังกฤษของประโยคเดียวกันใช้คีย์เดียวกัน"""
        return strip_emoji(self.body)


def build_pools(spec: Optional[dict] = None) -> dict[str, tuple[Greeting, ...]]:
    return {ctx: tuple(Greeting(ctx, gid, emo, GREETINGS[gid]) for gid, emo in rows)
            for ctx, rows in (spec or POOL_SPEC).items()}


POOLS = build_pools()


def normalize_context(value: object) -> Optional[str]:
    return CONTEXT_ALIASES.get(str(value or "").strip().lower())


def resolve_context(requested: object = None, *, trigger: str = "face", admission_period: bool = False,
                    recent_contexts: Iterable[str] = ()) -> str:
    """หน้านำเสนอที่เปิดอยู่ → ช่วงรับสมัคร (ไม่ถี่เกิน 1 ใน ADMISSION_EVERY) → kiosk → general"""
    ctx = normalize_context(requested)
    if ctx:
        return ctx
    if admission_period and "admission" not in list(recent_contexts)[-(ADMISSION_EVERY - 1):]:
        return "admission"
    if str(trigger or "").strip().lower() in KIOSK_TRIGGERS:
        return "kiosk"
    return DEFAULT_CONTEXT


class GreetingSelector:
    """เลือกคำทักทายจาก pool ของบริบท พร้อมกันซ้ำ · สถานะอยู่ในหน่วยความจำ (หนึ่งตัวต่อเซิร์ฟเวอร์ = หนึ่งหน้าจอ Kiosk)"""

    def __init__(self, pools: Optional[dict[str, tuple[Greeting, ...]]] = None,
                 rng: Optional[random.Random] = None, history_size: int = HISTORY_SIZE):
        self.pools = pools or POOLS
        self.rng = rng or random.Random()
        self.recent: deque[str] = deque(maxlen=max(1, history_size))      # คีย์ที่พูดล่าสุด (ทุกบริบท)
        self.contexts: deque[str] = deque(maxlen=max(1, history_size))    # บริบทของการทักทายล่าสุด
        self.used: dict[str, set[str]] = {}                               # บริบท → คีย์ที่ใช้แล้วในรอบปัจจุบัน
        self._lock = threading.Lock()

    def reset(self) -> None:
        with self._lock:
            self.recent.clear()
            self.contexts.clear()
            self.used.clear()

    def pick(self, context: object = None) -> Greeting:
        with self._lock:
            return self._pick(context)

    def choose(self, requested: object = None, *, trigger: str = "face", admission_period: bool = False) -> Greeting:
        """ระบุบริบท แล้วเลือกประโยค (ทำในล็อกเดียวกัน)"""
        with self._lock:
            ctx = resolve_context(requested, trigger=trigger, admission_period=admission_period,
                                  recent_contexts=self.contexts)
            return self._pick(ctx)

    def _pick(self, context: object) -> Greeting:
        ctx = context if isinstance(context, str) and context in self.pools else DEFAULT_CONTEXT
        pool = self.pools.get(ctx) or self.pools[DEFAULT_CONTEXT]
        if ctx not in self.pools:
            ctx = DEFAULT_CONTEXT
        recent = set(self.recent)
        used = self.used.setdefault(ctx, set())
        candidates = [g for g in pool if g.key not in used and g.key not in recent]
        if not candidates:
            used.clear()                                  # ล้างเฉพาะบริบทนี้ แล้วเริ่มรอบใหม่
            last = self.recent[-1] if self.recent else None
            rest = [g for g in pool if g.key != last]     # ไม่ซ้ำกับครั้งล่าสุด (ถ้ามีตัวเลือกอื่น)
            candidates = [g for g in rest if g.key not in recent] or rest or list(pool)
        choice = self.rng.choice(candidates)
        used.add(choice.key)
        self.recent.append(choice.key)
        self.contexts.append(ctx)
        return choice


selector = GreetingSelector()


def choose(requested: object = None, *, trigger: str = "face", admission_period: bool = False) -> Greeting:
    return selector.choose(requested, trigger=trigger, admission_period=admission_period)
