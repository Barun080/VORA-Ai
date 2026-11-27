"""ตรวจและซ่อมเสียงพูดของ VORA (12 พ.ย. 2569)

ผลตรวจที่เครื่องจริง: edge-tts 7.3.1 ได้ "No audio was received" แทบทุกครั้ง
ผู้ใช้หลายรายรายงานว่ารุ่นใหม่บางรุ่นเจออาการนี้ แต่รุ่น 7.2.1 ใช้ได้ → สคริปต์นี้ทดลองให้ที่เครื่องนี้จริง

ขั้นตอน (ไม่แตะฐานข้อมูล):
  1) ทดสอบ edge-tts รุ่นที่ติดตั้งอยู่ กับเสียงผู้หญิงไทย 2 แบบ
  2) ถ้าไม่ได้ → ทดลองรุ่นอื่นในโฟลเดอร์ชั่วคราว (ยังไม่เปลี่ยนของจริง)
  3) ทดสอบเสียงสำรอง Google
  4) ถามก่อนเปลี่ยน: ติดตั้งรุ่นที่ใช้ได้ / เปิดเสียงสำรองใน .env (สำรอง .env ไว้ก่อนเสมอ)
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
TEXT = "สวัสดีค่ะ หนูชื่อวอร่า ยินดีต้อนรับค่ะ"
VOICES = ["th-TH-PremwadeeNeural", "th-TH-AcharaNeural"]
CANDIDATES = ["7.2.1", "7.2.0", "7.0.2", "6.1.19"]

PROBE = r'''
import asyncio, sys, time, edge_tts
async def m(v):
    t = time.time(); n = 0
    async for c in edge_tts.Communicate(sys.argv[1], v, rate="-5%", pitch="+0Hz").stream():
        if c["type"] == "audio": n += len(c["data"])
    return n, time.time() - t
for v in sys.argv[2:]:
    try:
        n, s = asyncio.run(asyncio.wait_for(m(v), 20))
        print(f"RESULT {v} {'OK' if n else 'EMPTY'} {n} {s:.1f}")
    except Exception as e:
        print(f"RESULT {v} FAIL 0 0 {type(e).__name__}: {str(e)[:90]}")
print("VERSION", getattr(edge_tts, "__version__", "?"))
'''


def probe(extra_path: str | None = None) -> tuple[str, dict]:
    env = dict(os.environ)
    if extra_path:
        env["PYTHONPATH"] = extra_path + os.pathsep + env.get("PYTHONPATH", "")
    out = subprocess.run([sys.executable, "-c", PROBE, TEXT, *VOICES], capture_output=True, text=True, env=env, timeout=120,
                         encoding="utf-8", errors="replace").stdout
    res, ver = {}, "?"
    for ln in out.splitlines():
        p = ln.split(" ", 5)
        if p[0] == "RESULT":
            res[p[1]] = (p[2] == "OK", " ".join(p[3:]))
        elif p[0] == "VERSION":
            ver = p[1]
    return ver, res


def show(ver: str, res: dict) -> bool:
    ok = False
    for v, (good, info) in res.items():
        print(f"     {'[ OK ]' if good else '[FAIL]'} {v}: {info}")
        ok = ok or good
    return ok


def set_env(key: str, value: str) -> None:
    if not ENV.exists():
        print("  ไม่พบไฟล์ .env")
        return
    bak = ENV.with_name(f".env.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(ENV, bak)
    lines = ENV.read_text(encoding="utf-8").splitlines()
    done = False
    for i, ln in enumerate(lines):
        if ln.strip().startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            done = True
    if not done:
        lines.append(f"{key}={value}")
    ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"  ตั้ง {key}={value} ใน .env แล้ว (สำรองไฟล์เดิมไว้ที่ {bak.name})")


async def google_test() -> tuple[bool, str]:
    sys.path.insert(0, str(ROOT / "backend"))
    os.environ.setdefault("VORA_DATABASE_URL", f"sqlite:///{tempfile.gettempdir()}/vora-tts-doctor.db")
    import httpx
    t = time.time()
    try:
        async with httpx.AsyncClient(timeout=10, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://translate.google.com/"}) as c:
            r = await c.get("https://translate.google.com/translate_tts", params={"ie": "UTF-8", "client": "tw-ob", "tl": "th", "q": TEXT})
        ok = r.status_code == 200 and len(r.content) > 1000
        return ok, f"http {r.status_code} · {len(r.content)} ไบต์ · {time.time() - t:.1f} วิ"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {str(e)[:100]}"


def ask(q: str) -> bool:
    try:
        return input(f"  {q} (y/n): ").strip().lower() in ("y", "yes", "ใช่")
    except EOFError:
        return False


def main() -> int:
    print("=" * 62)
    print("VORA ตรวจเสียงพูด (edge-tts / เสียงสำรอง)")
    print("=" * 62)
    print("1) edge-tts รุ่นที่ติดตั้งอยู่")
    ver, res = probe()
    print(f"   รุ่น {ver}")
    current_ok = show(ver, res)

    working = None
    if not current_ok:
        print("\n2) ทดลอง edge-tts รุ่นอื่น (ในโฟลเดอร์ชั่วคราว ยังไม่เปลี่ยนของจริง)")
        for cand in CANDIDATES:
            tmp = tempfile.mkdtemp(prefix=f"edgetts-{cand}-")
            pip = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--no-deps", "--target", tmp, f"edge-tts=={cand}"],
                                 capture_output=True, text=True)
            if pip.returncode != 0:
                print(f"   {cand}: ติดตั้งไม่ได้ ({pip.stderr.strip()[-120:]})")
                continue
            v2, r2 = probe(tmp)
            print(f"   รุ่น {cand}")
            if show(v2, r2):
                working = cand
                shutil.rmtree(tmp, ignore_errors=True)
                break
            shutil.rmtree(tmp, ignore_errors=True)
    else:
        print("\n2) รุ่นปัจจุบันใช้ได้ — ข้ามการทดลองรุ่นอื่น")

    print("\n3) เสียงสำรอง Google")
    g_ok, g_info = asyncio.run(google_test())
    print(f"     {'[ OK ]' if g_ok else '[FAIL]'} {g_info}")

    print("\n4) สรุปและแก้ไข")
    if working:
        print(f"  edge-tts รุ่น {working} ใช้ได้ที่เครื่องนี้ (รุ่นปัจจุบัน {ver} ใช้ไม่ได้)")
        if ask(f"ติดตั้ง edge-tts=={working} แทนรุ่นปัจจุบันเลยไหม"):
            r = subprocess.run([sys.executable, "-m", "pip", "install", f"edge-tts=={working}"])
            print("  ติดตั้งแล้ว" if r.returncode == 0 else "  ติดตั้งไม่สำเร็จ")
    elif not current_ok:
        print("  edge-tts ทุกรุ่นที่ลองใช้ไม่ได้จากเครือข่ายนี้ตอนนี้ (Microsoft อาจจำกัดการใช้งานชั่วคราว)")
    if g_ok:
        print("  เสียงสำรอง Google ใช้ได้ — เปิดไว้แล้วเมื่อ edge-tts ไม่ได้เสียง โวร่าจะพูดด้วยเสียงผู้หญิงของ Google แทนการเงียบ")
        print("  (เป็นบริการไม่เป็นทางการของ Google ไม่มีการรับประกัน)")
        if ask("เปิดเสียงสำรอง Google (VORA_TTS_FALLBACK=google) ไหม"):
            set_env("VORA_TTS_FALLBACK", "google")
    print("\n  เสร็จแล้ว — ปิดหน้าต่าง start.bat แล้วเปิดใหม่ ให้การตั้งค่ามีผล")
    print("  ส่งข้อความในหน้าต่างนี้ให้ผู้พัฒนาได้ (ไม่มีคีย์หรือข้อมูลลับ)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
