"""24 พ.ย. 2569: รายละเอียดของสิ่งที่กล้องจำได้ แยกตามประเภท + ตอบคำถามต่อจากข้อมูลของสิ่งนั้น (ฟังก์ชันล้วน ทดสอบได้)

ประเภท (KINDS) — แต่ละประเภทมีช่องต่างกัน · หลังบ้านอ่านโครงสร้างนี้ไปสร้างฟอร์ม (/api/admin/vision/kinds)
ตอบเมื่อเห็น   : summary() พูดสรุปสั้น + view() ข้อมูลสำหรับป๊อปอัปนำเสนอ
ถามต่อ (ป๊อปอัปเปิดอยู่): decide() → ("close" | "field" | "describe" | None)
   ถามตรงช่องของประเภทนั้น ("จัดที่ไหน" "ราคาเท่าไหร่") หรือชี้ถึง ("อันนี้" "งานนี้") = ตอบจากข้อมูลสิ่งนั้นเท่านั้น (ไม่มี = บอกว่าไม่มี)
   ถามเรื่องอื่น ("ค่าเทอมเท่าไหร่") = None → ระบบตอบตามปกติ และสั่งปิดป๊อปอัป
ไม่ใช้ AI ภายนอก — คำตอบมาจากช่องที่เจ้าหน้าที่กรอกเท่านั้น
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Optional

from .text import normalize, shorten

# (ช่อง, ชื่อช่องในหลังบ้าน, ชนิดช่องในฟอร์ม)
KINDS: dict[str, dict[str, Any]] = {
    "sign": {"th": "ป้าย/สัญลักษณ์", "en": "Sign", "icon": "🪧", "title": "name", "fields": [
        ("name", "ชื่อป้าย", "text"), ("meaning", "ความหมาย/คำอธิบาย", "textarea"), ("department", "แผนก/หน่วยงาน", "text"),
        ("location", "ติดตั้งอยู่ที่ไหน", "text"), ("extra", "รายละเอียดเพิ่มเติม", "textarea")]},
    "poster": {"th": "โปสเตอร์/ประกาศ", "en": "Poster", "icon": "📢", "title": "title", "fields": [
        ("title", "หัวข้อ", "text"), ("detail", "รายละเอียด", "textarea"), ("start_date", "วันเริ่ม", "text"), ("end_date", "วันสิ้นสุด", "text"),
        ("location", "สถานที่", "text"), ("organizer", "ผู้จัด", "text"), ("eligibility", "ใครเข้าร่วมได้", "text"),
        ("how_to_join", "วิธีสมัคร/ติดต่อ", "textarea"), ("link", "ลิงก์ (https://)", "text"), ("expire_at", "โปสเตอร์หมดอายุวันที่", "date")]},
    "event": {"th": "กิจกรรม/ภาพเหตุการณ์", "en": "Event", "icon": "📸", "title": "title", "fields": [
        ("title", "ชื่อกิจกรรม", "text"), ("date", "วันที่จัด", "text"), ("location", "สถานที่", "text"),
        ("people", "ผู้เกี่ยวข้อง/แผนก", "text"), ("detail", "รายละเอียด", "textarea"), ("result", "ผลงาน/รางวัล", "textarea")]},
    "object": {"th": "วัตถุ/อุปกรณ์", "en": "Object", "icon": "🔧", "title": "name", "fields": [
        ("name", "ชื่อ", "text"), ("purpose", "ใช้ทำอะไร", "textarea"), ("department", "แผนกที่ใช้", "text"),
        ("caution", "ข้อควรระวัง", "textarea"), ("detail", "รายละเอียดเพิ่มเติม", "textarea")]},
    "product": {"th": "ผลิตภัณฑ์/ผลงาน", "en": "Product", "icon": "🏆", "title": "name", "fields": [
        ("name", "ชื่อ", "text"), ("maker", "ผู้ผลิต/แผนก", "text"), ("highlights", "จุดเด่น", "textarea"),
        ("price", "ราคา/ช่องทางซื้อ", "text"), ("award", "รางวัล", "text"), ("detail", "รายละเอียดเพิ่มเติม", "textarea")]},
}
KIND_KEYS = tuple(KINDS)
MAX_IMAGES = 8


def schema() -> list[dict[str, Any]]:
    """โครงสร้างฟอร์มสำหรับหลังบ้าน"""
    return [{"kind": k, "label": v["th"], "icon": v["icon"],
             "fields": [{"key": f, "label": lab, "type": typ} for f, lab, typ in v["fields"]]} for k, v in KINDS.items()]


def clean_details(kind: str, details: dict | None) -> dict[str, str]:
    """เก็บเฉพาะช่องของประเภทนั้น ตัดช่องว่าง ยาวไม่เกิน 2,000 ตัวอักษร"""
    keys = {f for f, _, _ in KINDS.get(kind, KINDS["sign"])["fields"]}
    out = {}
    for k, v in (details or {}).items():
        if k in keys and isinstance(v, (str, int, float)) and str(v).strip():
            out[k] = str(v).strip()[:2000]
    if out.get("link") and not re.match(r"^https?://", out["link"], re.I):
        out.pop("link")
    return out


def _thai_date(d: Optional[datetime]) -> str:
    if not d:
        return ""
    months = "ม.ค. ก.พ. มี.ค. เม.ย. พ.ค. มิ.ย. ก.ค. ส.ค. ก.ย. ต.ค. พ.ย. ธ.ค.".split()
    s = f"{d.day} {months[d.month - 1]} {d.year + 543}"
    return s + (f" เวลา {d:%H:%M} น." if (d.hour or d.minute) else "")


def merged(kind: str, details: dict, news: Any = None) -> dict[str, str]:
    """ช่องของรายการ + ข้อมูลจากข่าวที่ผูกไว้ (ช่องที่เจ้าหน้าที่กรอกเองสำคัญกว่า)"""
    d = dict(details or {})
    if news is not None:
        base = {"title": news.title_th or "", "detail": news.body_th or "", "location": news.location or ""}
        when = _thai_date(news.event_date)
        base["start_date" if kind == "poster" else "date"] = when
        for k, v in base.items():
            if v and not d.get(k) and k in {f for f, _, _ in KINDS[kind]["fields"]}:
                d[k] = v
    return d


def title_of(kind: str, d: dict, fallback: str) -> str:
    return d.get(KINDS[kind]["title"]) or d.get("name") or d.get("title") or fallback


def expired(d: dict, today: Optional[date] = None) -> bool:
    try:
        return bool(d.get("expire_at")) and date.fromisoformat(d["expire_at"][:10]) < (today or date.today())
    except ValueError:
        return False


def view(vc: Any, item: Any, news: Any = None, samples: Optional[list[str]] = None, lang: str = "th") -> dict[str, Any]:
    """ข้อมูลสำหรับป๊อปอัปนำเสนอบนหน้าจอหุ่น"""
    kind = item.kind if item.kind in KINDS else "sign"
    k = KINDS[kind]
    d = merged(kind, item.details or {}, news)
    imgs = [u for u in (item.images or []) if isinstance(u, str) and u][:MAX_IMAGES]
    if news is not None:
        extra = [news.image_url or ""] + [x.strip() for x in (getattr(news, "gallery", "") or "").splitlines()]
        imgs += [u for u in extra if u and u not in imgs]
    if not imgs:
        imgs = list(samples or [])[:3]                     # ไม่มีรูป → ภาพตัวอย่างที่เก็บตอนสอนกล้อง
    fields = [{"key": f, "label": lab, "value": d[f]} for f, lab, _ in k["fields"]
              if d.get(f) and f != k["title"] and f not in ("expire_at",)]
    return {"id": item.id, "label": vc.label, "kind": kind, "kind_label": k["en" if lang == "en" else "th"], "icon": k["icon"],
            "title": title_of(kind, d, vc.display_name or vc.label), "fields": fields, "images": imgs[:MAX_IMAGES],
            "link": d.get("link", ""), "expired": expired(d), "news_id": item.news_id}


def summary(v: dict[str, Any], lang: str = "th", max_chars: int = 320) -> str:
    """คำพูดเมื่อเห็น: บอกว่าคืออะไร + สาระสำคัญ 1–2 ช่อง + ชวนถามต่อ"""
    f = {x["key"]: x["value"] for x in v["fields"]}
    title, kind = v["title"], v["kind"]
    if lang == "en":
        return shorten(f"This is {title}. Ask me anything about it.", max_chars)
    first = {"sign": f.get("meaning"), "poster": f.get("detail"), "event": f.get("detail"),
             "object": f.get("purpose"), "product": f.get("highlights") or f.get("detail")}.get(kind) or ""
    where_when = ""
    if kind == "poster":
        when = " ถึง ".join(x for x in (f.get("start_date"), f.get("end_date")) if x)
        where_when = " ".join(x for x in ((f"วันที่ {when}" if when else ""), (f"ที่ {f['location']}" if f.get("location") else "")) if x)
    elif kind == "event":
        where_when = " ".join(x for x in ((f"เมื่อ {f['date']}" if f.get("date") else ""), (f"ที่ {f['location']}" if f.get("location") else "")) if x)
    elif kind == "sign" and f.get("location"):
        where_when = f"อยู่ที่ {f['location']}"
    lead = {"sign": "นี่คือป้าย", "poster": "นี่คือโปสเตอร์", "event": "นี่คือภาพกิจกรรม", "object": "นี่คือ", "product": "นี่คือผลงาน"}[kind]
    head = f"{lead}{'' if kind == 'object' else ' '}{title}{' ' if re.search(r'[A-Za-z0-9)]$', title) else ''}ค่ะ"
    note = " (โปสเตอร์นี้หมดอายุแล้วนะคะ)" if v.get("expired") else ""
    body = " ".join(x for x in (shorten(first, 160) if first else "", where_when) if x)
    tail = " อยากรู้อะไรเพิ่มถามได้เลยค่ะ"
    return shorten(f"{head}{note} {body}".strip(), max_chars - len(tail)) + tail


# ---------------------------------------------------------------- ถามต่อขณะป๊อปอัปเปิด
_CLOSE = re.compile(r"^(ปิด|ปิดเลย|ปิดหน้าต่าง|ปิดป๊อปอัพ|ปิดป๊อปอัป|พอแล้ว|พอ|ขอบคุณ|ขอบใจ|โอเคขอบคุณ|ไม่เป็นไร|close|thanks|thank you|ok thanks)(ค่ะ|คะ|ครับ|จ้า|นะ)*$", re.I)
_DEIXIS = re.compile(r"(อันนี้|อันนั้น|ตัวนี้|ตัวนั้น|ป้ายนี้|ป้ายนั้น|โปสเตอร์นี้|ประกาศนี้|งานนี้|กิจกรรมนี้|รูปนี้|ภาพนี้|ผลงานนี้|สินค้านี้|"
                     r"ผลิตภัณฑ์นี้|อุปกรณ์นี้|เครื่องนี้|ชิ้นนี้|^นี่|^นั่น|มัน|\bthis\b|\bthat\b|\bit\b)")
_POLITE = re.compile(r"(ครับ|คะ|ค่ะ|นะ|จ้า|หน่อย|ได้ไหม|ได้มั้ย|ไหม|มั้ย|หนู|เธอ|บอก|ช่วย|ขอ|\s)")
# คำถามเรื่องของวิทยาลัยทั่วไป (ไม่ใช่เรื่องของสิ่งบนจอ) — ไม่มีคำชี้ถึง = ถามเรื่องอื่น
_OTHER = re.compile(r"(ค่าเทอม|ค่าเรียน|ค่าสมัคร|สมัครเรียน|เรียนกี่ปี|สาขาอะไร|มีสาขา|แผนกอะไร|ทุนการศึกษา|กยศ|อากาศ|ตอนนี้กี่โมง|"
                    r"วันนี้วันที่|เบอร์วิทยาลัย|วิทยาลัยอยู่|ผู้อำนวยการ|หัวหน้าแผนก|โควตา|ข่าวล่าสุด)")
CUES: list[tuple[re.Pattern[str], tuple[str, ...], str]] = [
    (re.compile(r"(ที่ไหน|ตรงไหน|สถานที่|อยู่ไหน|จัดที่|ติดที่|where)"), ("location",), "สถานที่"),
    (re.compile(r"(เมื่อไหร่|เมื่อไร|วันไหน|วันที่|กี่โมง|ถึงวันไหน|หมดเขต|ปิดรับ|จัดวัน|when|date)"), ("start_date", "end_date", "date"), "วันเวลา"),
    (re.compile(r"(ใครเข้าร่วม|ใครสมัคร|ใครไปได้|เข้าร่วมได้|คุณสมบัติ|ใครบ้าง|ใครมา|who can)"), ("eligibility", "people"), "ผู้เข้าร่วม"),
    (re.compile(r"(ใครจัด|ผู้จัด|ใครทำ|ใครผลิต|ใครสร้าง|ทำโดย|แผนกไหน|ของแผนก|หน่วยงาน|ใครเป็นเจ้าของ|who made|organi)"),
     ("organizer", "maker", "department", "people"), "ผู้จัดทำ/หน่วยงาน"),
    (re.compile(r"(สมัคร|ติดต่อ|ลงทะเบียน|เข้าร่วมยังไง|เข้าร่วมอย่างไร|join|register|contact)"), ("how_to_join", "link"), "วิธีสมัคร/ติดต่อ"),
    (re.compile(r"(ราคา|เท่าไหร่|เท่าไร|กี่บาท|ซื้อ|ขาย|price|buy)"), ("price",), "ราคา/ช่องทางซื้อ"),
    (re.compile(r"(ใช้ทำอะไร|ใช้ยังไง|ใช้อย่างไร|มีไว้ทำ|ประโยชน์|ใช้งาน|what is it for|use)"), ("purpose",), "การใช้งาน"),
    (re.compile(r"(อันตราย|ระวัง|ปลอดภัย|safe|danger)"), ("caution",), "ข้อควรระวัง"),
    (re.compile(r"(รางวัล|ได้ที่|ชนะ|award|prize)"), ("award", "result"), "รางวัล/ผลงาน"),
    (re.compile(r"(ผลงาน|ผลเป็น|ผลออก|ผลการ|result)"), ("result", "award"), "ผลงาน"),
    (re.compile(r"(จุดเด่น|เด่น|พิเศษ|ดียังไง|ดีอย่างไร|highlight)"), ("highlights",), "จุดเด่น"),
    (re.compile(r"(หมายถึง|ความหมาย|meaning)"), ("meaning",), "ความหมาย"),
    (re.compile(r"(ลิงก์|ลิ้ง|เว็บ|คิวอาร์|qr|link)"), ("link",), "ลิงก์"),
]
_DESCRIBE = re.compile(r"(คืออะไร|คือ|อะไร|เกี่ยวกับ|รายละเอียด|เล่า|อธิบาย|ข้อมูล|เพิ่มเติม|what|tell me|more)")
SAY = {
    "location": lambda v, k: f"{'ติดตั้ง' if k in ('sign', 'object') else 'จัด'}อยู่ที่ {v}" if k != "product" else f"อยู่ที่ {v}",
    "start_date": lambda v, k: f"เริ่มวันที่ {v}", "end_date": lambda v, k: f"ถึงวันที่ {v}", "date": lambda v, k: f"จัดเมื่อ {v}",
    "eligibility": lambda v, k: f"ผู้ที่เข้าร่วมได้คือ {v}", "people": lambda v, k: f"ผู้เกี่ยวข้องคือ {v}",
    "organizer": lambda v, k: f"จัดโดย {v}", "maker": lambda v, k: f"ผลิตโดย {v}", "department": lambda v, k: f"เป็นของ{v}" if not v.startswith(("แผนก", "งาน", "ฝ่าย")) else f"เป็นของ{v}",
    "how_to_join": lambda v, k: f"วิธีสมัครหรือติดต่อ: {v}", "link": lambda v, k: "สแกนคิวอาร์โค้ดบนจอเพื่อเปิดลิงก์ได้เลย",
    "price": lambda v, k: f"ราคาและช่องทางซื้อ: {v}", "purpose": lambda v, k: f"ใช้สำหรับ {v}", "caution": lambda v, k: f"ข้อควรระวัง: {v}",
    "award": lambda v, k: f"ได้รับ {v}", "result": lambda v, k: f"ผลงาน: {v}", "highlights": lambda v, k: f"จุดเด่นคือ {v}",
    "meaning": lambda v, k: f"หมายถึง {v}",
}


def decide(question: str, kind: str, title: str = "") -> Optional[tuple[str, tuple[str, ...], str]]:
    """("close"|"field"|"describe", ช่องที่ถาม, ชื่อเรื่อง) หรือ None = ถามเรื่องอื่น (ตอบตามปกติ + ปิดป๊อปอัป)"""
    q = normalize(question)
    if _CLOSE.match(re.sub(r"\s+", "", q)):
        return "close", (), ""
    keys = {f for f, _, _ in KINDS.get(kind, KINDS["sign"])["fields"]}
    t = normalize(title)
    pointed = bool(_DEIXIS.search(q)) or (len(t) >= 4 and t in q)
    if _OTHER.search(q) and not pointed:
        return None
    for pat, fields, topic in CUES:
        if pat.search(q):
            mine = tuple(f for f in fields if f in keys)
            if mine:
                return "field", mine, topic
            if pointed:                                 # ชี้ถึงสิ่งนี้แต่ประเภทนี้ไม่มีช่องเรื่องนั้น → บอกว่าไม่มีข้อมูล
                return "field", (), topic
    rest = _POLITE.sub("", _DESCRIBE.sub("", q))          # "คืออะไร" / "เล่าหน่อย" = ถามถึงสิ่งบนจอ · "Python คืออะไร" = เรื่องอื่น
    if pointed or (_DESCRIBE.search(q) and len(rest) <= 3):
        return "describe", (), ""
    return None


def answer_focus(v: dict[str, Any], question: str, lang: str = "th", max_chars: int = 320) -> Optional[tuple[str, str]]:
    """(คำตอบ, ชนิด) จากข้อมูลของสิ่งบนจอ · None = ไม่เกี่ยว"""
    d = decide(question, v["kind"], v.get("title", ""))
    if d is None:
        return None
    mode, fields, topic = d
    if mode == "close":
        return ("Okay, closing it now." if lang == "en" else "ได้เลยค่ะ ปิดหน้าต่างให้แล้วนะคะ"), "close"
    if mode == "describe":
        return summary(v, lang, max_chars).replace(" อยากรู้อะไรเพิ่มถามได้เลยค่ะ", "") + _rest(v), "describe"
    f = {x["key"]: x["value"] for x in v["fields"]}
    if v.get("link"):
        f["link"] = v["link"]
    parts = [SAY[k](f[k], v["kind"]) for k in fields if f.get(k) and k in SAY]
    kind_th = KINDS[v["kind"]]["th"].split("/")[0]
    if not parts:
        if lang == "en":
            return f"Sorry, there's no information about that for {v['title']} yet.", "missing"
        return f"{kind_th} {v['title']} ยังไม่มีข้อมูลเรื่อง{topic or 'นี้'}ค่ะ สอบถามเพิ่มเติมได้ที่วิทยาลัยนะคะ", "missing"
    if lang == "en":
        return shorten(f"{v['title']}: " + "; ".join(parts), max_chars), "field"
    return shorten(f"{v['title']} {' '.join(parts)} ค่ะ", max_chars), "field"


def _rest(v: dict[str, Any]) -> str:
    """อธิบายเพิ่ม: ช่องที่ยังไม่ได้พูดในสรุป (สั้น ๆ)"""
    said = {"meaning", "detail", "purpose", "highlights", "location", "date", "start_date", "end_date"}
    more = [f"{x['label']} {x['value']}" for x in v["fields"] if x["key"] not in said][:2]
    return (" " + " · ".join(more)) if more else ""
