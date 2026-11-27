"""ตรวจการค้นข้อมูลจากอินเทอร์เน็ตและเสียงพูด ทีละขั้น (ไม่แก้ข้อมูลความรู้ ไม่แสดงคีย์ · บันทึกเหตุการณ์ผิดพลาดและไฟล์เสียงทดสอบในแคชตามปกติ)

ใช้: diag_web.bat  [คำค้น]   เช่น  diag_web.bat ดาวอังคาร
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.chdir(ROOT)

import httpx  # noqa: E402

from app import tts  # noqa: E402
from app.ai import web  # noqa: E402
from app.config import settings  # noqa: E402


def line(ok: bool | None, msg: str) -> None:
    print(("  [ OK ] " if ok else "  [FAIL] " if ok is False else "  [ -- ] ") + msg)


async def main(q: str) -> int:
    print("=" * 60)
    print(f"VORA ตรวจการค้นข้อมูลจากอินเทอร์เน็ต · คำค้น: {q}")
    print("=" * 60)
    print("1) การตั้งค่า (.env)")
    line(settings.ai_web_enabled, f"VORA_AI_WEB_ENABLED = {settings.ai_web_enabled}")
    line(settings.llm_provider not in ("", "none", "off"), f"VORA_LLM_PROVIDER = {settings.llm_provider} · โมเดล {settings.llm_model or '-'}")
    line(bool(settings.llm_api_key), "VORA_LLM_API_KEY = " + ("ตั้งไว้แล้ว (ไม่แสดงค่า)" if settings.llm_api_key else "ว่าง"))
    print(f"  proxy ของเครื่อง: HTTPS_PROXY={'มี' if os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy') else 'ไม่มี'}")

    print("\n2) Wikipedia (ค้นและรูปประกอบ)")
    t = time.monotonic()
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as c:
        pages = await web._wikipedia(q, "th", c)
    line(bool(pages), f"{len(pages)} หน้า ใน {time.monotonic() - t:.1f} วิ" + ("" if pages else f" · สาเหตุ: {web.last['wikipedia']}"))
    for p in pages[:3]:
        print(f"         - {p['title']} ({p['lang']}) {'มีรูป' if p['image'] else 'ไม่มีรูป'}")

    print("\n3) Gemini + Google Search")
    t = time.monotonic()
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as c:
        g = await web._gemini_grounded(q, "th", c)
    line(bool(g), f"{time.monotonic() - t:.1f} วิ · " + (f"แหล่งอ้างอิง {len(g['sources'])} แห่ง" if g else f"สาเหตุ: {web.last['gemini'] or 'ไม่ได้ตั้งค่า Gemini'}"))
    if g:
        print(f"         สรุป: {g['summary'][:160]}")

    print("\n4) ทั้งระบบ (เหมือนที่หุ่นยนต์ใช้)")
    web._cache.clear()
    t = time.monotonic()
    r = await web.search(q, "th")
    line(bool(r), f"{time.monotonic() - t:.1f} วิ · " + (f"ใช้ {r['engine']} · รูป {len(r['images'])} รูป" if r else web.last["result"]))
    if r and time.monotonic() - t > 20:
        line(False, "ใช้เวลาเกิน 20 วิ หน้าจอหุ่นยนต์อาจหมดเวลารอ (25 วิ) — ลด VORA_WEB_TIMEOUT")

    print("\n5) เสียงพูด (edge-tts)")
    line(tts.available(), f"ผู้ให้บริการ {settings.tts_provider} · เสียง {tts.voice_for('th')}")
    if tts.available():
        texts = [f"ทดสอบเสียงประโยคที่ {i} ค่ะ {int(time.time())}" for i in range(1, 5)]
        t = time.monotonic()
        res = []
        for x in texts:                     # ทีละประโยค เหมือนตอนหุ่นยนต์พูดจริง
            t1 = time.monotonic()
            res.append(await tts.synthesize(x, "th", prefetch=True))
            print(f"         ประโยคที่ {len(res)}: {'ได้เสียง' if res[-1] else 'ไม่ได้เสียง'} {time.monotonic() - t1:.1f} วิ")
        n = sum(1 for a in res if a)
        line(n == len(texts), f"สร้างเสียง {len(texts)} ประโยค สำเร็จ {n} ใน {time.monotonic() - t:.1f} วิ"
             + ("" if n == len(texts) else f" · สาเหตุ: {tts.status()['last_error']}"))
        if r:   # เสียงของคำสรุปจริง (ข้อความยาว = จุดที่เคยเงียบ)
            t = time.monotonic()
            a = await tts.synthesize(r["summary"][:110], "th")
            line(bool(a), f"เสียงคำสรุปผลค้น ({len(r['summary'][:110])} ตัวอักษร) {time.monotonic() - t:.1f} วิ"
                 + ("" if a else f" · สาเหตุ: {tts.status()['last_error']}"))
    print("\nส่งข้อความในหน้าต่างนี้ทั้งหมดให้ผู้พัฒนาได้เลย (ไม่มีคีย์หรือข้อมูลลับ)")
    return 0 if r else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(" ".join(sys.argv[1:]).strip() or "ดาวอังคาร")))
