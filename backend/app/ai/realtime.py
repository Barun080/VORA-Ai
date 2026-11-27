"""ข้อมูลเรียลไทม์ (11 พ.ย. 2569): เวลา วันที่ เดือน ปี และสภาพอากาศจริง

- เวลา/วันที่: นาฬิกาของเครื่องเซิร์ฟเวอร์ คิดเป็นเวลาประเทศไทย (UTC+7 ไม่มีเวลาออมแสง) · ปีแสดงเป็น พ.ศ.
- สภาพอากาศ: Open-Meteo (ฟรี ไม่ต้องใช้คีย์ · https://open-meteo.com) ที่พิกัดใน .env (ค่าเริ่มต้น จังหวัดน่าน)
  ส่งออกนอกเครื่องเฉพาะพิกัดของสถานศึกษา ไม่ส่งข้อความหรือข้อมูลผู้ใช้ · เก็บผลไว้ 10 นาที
- 22 พ.ย. 2569: ถามจังหวัดอื่นได้ ("อากาศที่แพร่", "โคราชร้อนไหม") ด้วยพิกัดอำเภอเมืองใน provinces.py (ส่งออกเฉพาะพิกัด)
  และถามพรุ่งนี้ได้ ("พรุ่งนี้ฝนตกไหม") · ไม่ระบุจังหวัด = จังหวัดของสถานศึกษาเหมือนเดิม
- ดึงข้อมูลไม่ได้ = บอกตรง ๆ ว่ายังดูสภาพอากาศไม่ได้ ไม่เดาตัวเลข
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone

import httpx

from ..config import settings
from . import provinces
from .text import normalize

TH_TZ = timezone(timedelta(hours=7))
_DAYS_TH = ["วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์", "วันอาทิตย์"]
_MONTHS_TH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]

_TIME = re.compile(r"กี่โมง|เวลาเท่าไ|ตอนนี้เวลา|ขอทราบเวลา|บอกเวลา|\bwhat time\b|\bcurrent time\b|\btime is it\b")
_DATE = re.compile(r"วันนี้วันที่|วันนี้วันอะไร|วันนี้คือวัน|วันที่เท่าไ|วันนี้วันไหน|(?:พรุ่งนี้|เมื่อวาน)(?:วัน|ตรงกับ|เป็นวัน)|เดือนอะไร|เดือนนี้เดือน|ปีอะไร|ปีนี้ปี|ปีนี้พ\.?ศ|ปีนี้ค\.?ศ|"
                   r"\bwhat(?:'s| is) (?:the )?date\b|\btoday'?s date\b|\bwhat day is (?:it|today)\b|\bwhat month\b|\bwhat year\b")
_WEATHER = re.compile(r"อากาศ(?:วันนี้|ตอนนี้|เป็น|ดี|ร้อน|หนาว|เย็น|ยังไง|อย่างไร|ข้างนอก)|สภาพอากาศ|พยากรณ์อากาศ|ฝนจะตก|ฝนตกไหม|ฝนตกมั้ย|ฝนตกหรือเปล่า|"
                      r"อุณหภูมิ|กี่องศา|ร้อนไหม|หนาวไหม|\bweather\b|\btemperature\b|\bis it (?:raining|hot|cold)\b|\bwill it rain\b")
_NOT_TIME = re.compile(r"สมัคร|เปิด|ปิด|เลิก|ภาคเรียน|เรียนกี่|เข้าเรียน|ทำการ|สอบ|กิจกรรม|ประชุม|เข้าแถว|งาน|เริ่ม|จัด|แข่ง|พิธี|\b(?:open|close|opening|closing)\b")   # เวลาของวิทยาลัย/กิจกรรม = ฐานความรู้ · 23 พ.ย.: +งาน เริ่ม จัด แข่ง พิธี ("งานเริ่มกี่โมง" ≠ นาฬิกา)


# 22 พ.ย. 2569: "อากาศที่…/อากาศแถว…/อากาศจังหวัด…/อากาศ<ชื่อจังหวัด>" · ไม่นับ "เครื่องปรับอากาศ" "อากาศยาน" (ชื่อสาขา)
_NOT_WEATHER = re.compile(r"ปรับอากาศ|อากาศยาน|ช่างอากาศ|\bair\s*-?\s*con")
_WEATHER_AT = re.compile(r"อากาศ(?:ที่|แถว|ใน|จังหวัด|พรุ่งนี้)|ฝน(?:ตก)?(?:ที่|แถว)|พรุ่งนี้(?:ฝน|ร้อน|หนาว|อากาศ)|\bweather\s+(?:in|at|for|tomorrow)\b")
TOMORROW = re.compile(r"พรุ่งนี้|\btomorrow\b")


def detect(text: str) -> str | None:
    """คืน weather | time | date หรือ None (เวลาเกี่ยวกับวิทยาลัย เช่น "รับสมัครกี่โมง" ไม่ใช่คำถามนาฬิกา)"""
    n = normalize(text or "")
    if not _NOT_WEATHER.search(n) and (_WEATHER.search(n) or _WEATHER_AT.search(n)
                                       or ("อากาศ" in n and provinces.find(n))):
        return "weather"
    if _NOT_TIME.search(n):
        return None
    if _TIME.search(n):
        return "time"
    if _DATE.search(n):
        return "date"
    return None


def now() -> datetime:
    return datetime.now(TH_TZ)


def time_text(lang: str, dt: datetime | None = None) -> str:
    dt = dt or now()
    if lang == "en":
        return f"It's {dt.strftime('%H:%M')} (Thailand time)."
    return f"ตอนนี้เวลา {dt.hour} นาฬิกา {dt.minute} นาที ค่ะ"


def date_text(lang: str, dt: datetime | None = None, offset: int = 0) -> str:
    """offset: 0 วันนี้ · 1 พรุ่งนี้ · -1 เมื่อวาน (22 พ.ย. 2569)"""
    dt = (dt or now()) + timedelta(days=offset)
    if lang == "en":
        word = {1: "Tomorrow is", -1: "Yesterday was"}.get(offset, "Today is")
        return f"{word} {dt.strftime('%A, %d %B %Y')}."
    word = {1: "พรุ่งนี้", -1: "เมื่อวาน"}.get(offset, "วันนี้")
    return f"{word}{_DAYS_TH[dt.weekday()]}ที่ {dt.day} {_MONTHS_TH[dt.month - 1]} พ.ศ. {dt.year + 543} ค่ะ"


_WMO_TH = {0: "ท้องฟ้าแจ่มใส", 1: "มีเมฆเล็กน้อย", 2: "มีเมฆบางส่วน", 3: "เมฆมาก", 45: "มีหมอก", 48: "มีหมอกน้ำค้างแข็ง",
           51: "ฝนปรอยเล็กน้อย", 53: "ฝนปรอย", 55: "ฝนปรอยหนาแน่น", 56: "ฝนปรอยเย็นจัด", 57: "ฝนปรอยเย็นจัด",
           61: "ฝนตกเล็กน้อย", 63: "ฝนตกปานกลาง", 65: "ฝนตกหนัก", 66: "ฝนเย็นจัด", 67: "ฝนเย็นจัด",
           71: "หิมะตกเล็กน้อย", 73: "หิมะตก", 75: "หิมะตกหนัก", 77: "เกล็ดหิมะ", 80: "ฝนตกเป็นช่วง ๆ", 81: "ฝนตกเป็นช่วง ๆ ปานกลาง",
           82: "ฝนตกหนักเป็นช่วง ๆ", 85: "หิมะตกเป็นช่วง ๆ", 86: "หิมะตกหนักเป็นช่วง ๆ", 95: "พายุฝนฟ้าคะนอง", 96: "พายุฝนฟ้าคะนองมีลูกเห็บ",
           99: "พายุฝนฟ้าคะนองมีลูกเห็บ"}
_WMO_EN = {0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "foggy", 48: "foggy", 51: "light drizzle", 53: "drizzle",
           55: "heavy drizzle", 61: "light rain", 63: "moderate rain", 65: "heavy rain", 80: "rain showers", 81: "moderate rain showers",
           82: "heavy rain showers", 95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with hail"}
_cache: dict[str, tuple[float, dict]] = {}
CACHE_S = 600


async def fetch_weather(lat: float | None = None, lon: float | None = None, day: int = 0) -> dict | None:
    """สภาพอากาศปัจจุบัน + วันนี้ (day=0) หรือพรุ่งนี้ (day=1) จาก Open-Meteo · ไม่ระบุพิกัด = สถานศึกษา · ผิดพลาด = None"""
    lat = settings.weather_lat if lat is None else lat
    lon = settings.weather_lon if lon is None else lon
    key = f"{lat},{lon},{day}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    params = {"latitude": lat, "longitude": lon, "timezone": "Asia/Bangkok", "forecast_days": 1 + day,
              "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
              "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max"}
    try:
        async with httpx.AsyncClient(timeout=6.0) as c:
            r = await c.get("https://api.open-meteo.com/v1/forecast", params=params)
            r.raise_for_status()
            d = r.json()
        cur, daily, day_i = d.get("current") or {}, d.get("daily") or {}, day
        out = {"temp": cur.get("temperature_2m"), "feels": cur.get("apparent_temperature"), "humidity": cur.get("relative_humidity_2m"),
               "code": cur.get("weather_code"), "wind": cur.get("wind_speed_10m"), "time": cur.get("time"),
               "max": _at(daily.get("temperature_2m_max"), day_i), "min": _at(daily.get("temperature_2m_min"), day_i),
               "rain": _at(daily.get("precipitation_probability_max"), day_i), "day": day_i}
        if out["temp"] is None or (day_i and out["max"] is None):
            return None
        _cache[key] = (time.time(), out)
        return out
    except Exception:  # noqa: BLE001 — เครือข่ายหลุด/บริการล่ม → บอกผู้ใช้ตรง ๆ
        return None


def _at(xs, i: int):
    return xs[i] if isinstance(xs, list) and len(xs) > i else None


def _r(x) -> str:
    return str(round(float(x))) if x is not None else "-"


def weather_text(w: dict | None, lang: str, place: str | None = None) -> str:
    place = place or (settings.weather_place_en if lang == "en" else settings.weather_place_th)
    if w and w.get("day") == 1:                   # 22 พ.ย. 2569: พยากรณ์พรุ่งนี้ (ไม่มีค่า "ตอนนี้")
        if lang == "en":
            s = f"Tomorrow in {place}: high {_r(w['max'])}°C, low {_r(w['min'])}°C"
            return s + (f", {_r(w['rain'])}% chance of rain." if w.get("rain") is not None else ".")
        s = f"พรุ่งนี้ที่{place} อุณหภูมิสูงสุด {_r(w['max'])} ต่ำสุด {_r(w['min'])} องศาเซลเซียส"
        return s + (f" โอกาสฝนตก {_r(w['rain'])} เปอร์เซ็นต์ ค่ะ" if w.get("rain") is not None else " ค่ะ")
    if not w:
        return ("Sorry, I can't get the live weather right now. Please try again in a moment."
                if lang == "en" else "ขออภัยค่ะ ตอนนี้หนูยังดึงข้อมูลสภาพอากาศไม่ได้ ลองถามใหม่อีกครั้งนะคะ")
    code = int(w["code"]) if w.get("code") is not None else -1
    if lang == "en":
        s = f"Right now in {place} it's {_r(w['temp'])}°C, {_WMO_EN.get(code, 'mixed conditions')}, feels like {_r(w['feels'])}°C."
        if w.get("max") is not None:
            s += f" Today's high is {_r(w['max'])}°C and low {_r(w['min'])}°C"
            s += f", with a {_r(w['rain'])}% chance of rain." if w.get("rain") is not None else "."
        return s
    s = f"ตอนนี้ที่{place} อุณหภูมิ {_r(w['temp'])} องศาเซลเซียส {_WMO_TH.get(code, 'อากาศแปรปรวน')} รู้สึกเหมือน {_r(w['feels'])} องศา"
    if w.get("max") is not None:
        s += f" วันนี้สูงสุด {_r(w['max'])} ต่ำสุด {_r(w['min'])} องศา"
        if w.get("rain") is not None:
            s += f" โอกาสฝนตก {_r(w['rain'])} เปอร์เซ็นต์"
    return s + " ค่ะ"


def weather_target(text: str) -> dict:
    """จังหวัด + วัน จากคำถาม · ไม่ระบุจังหวัด/เป็นจังหวัดของสถานศึกษา = พิกัดสถานศึกษาเดิม (lat/lon = None)"""
    p = provinces.find(text)
    home = normalize(settings.weather_place_th or "")
    if p and normalize(p["th"]) in home:
        p = None
    return {"province": p, "day": 1 if TOMORROW.search(normalize(text or "")) else 0}


async def answer(kind: str, lang: str, text: str = "") -> tuple[str, dict]:
    """คืน (ข้อความ, การ์ดข้อมูลสำหรับหน้าจอ) · text = คำถาม (ใช้หาจังหวัด/วันของสภาพอากาศ)"""
    dt = now()
    if kind == "time":
        return time_text(lang, dt), {"type": "realtime", "kind": "time", "value": dt.strftime("%H:%M")}
    if kind == "date":
        n = normalize(text or "")
        off = 1 if TOMORROW.search(n) else (-1 if re.search(r"เมื่อวาน|\byesterday\b", n) else 0)
        return date_text(lang, dt, off), {"type": "realtime", "kind": "date", "value": (dt + timedelta(days=off)).date().isoformat()}
    tg = weather_target(text)
    p = tg["province"]
    # จังหวัดของสถานศึกษา + วันนี้ = เรียกแบบเดิม (ไม่ส่งอาร์กิวเมนต์) ให้เข้ากับโค้ด/ชุดทดสอบเดิม
    w = await (fetch_weather() if not p and not tg["day"] else fetch_weather(p["lat"] if p else None, p["lon"] if p else None, tg["day"]))
    place = (f"จังหวัด{p['th']}" if lang != "en" else f"{p['en']} province") if p else None
    card = {"type": "realtime", "kind": "weather", "ok": bool(w), "source": "Open-Meteo", "place": place or "",
            "day": tg["day"], **({k: w[k] for k in ("temp", "code", "max", "min", "rain")} if w else {})}
    return weather_text(w, lang, place), card
