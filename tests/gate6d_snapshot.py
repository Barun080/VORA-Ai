"""Phase 6 · Gate 6D — สร้างคำตอบของชุด 60 คำถามในฐานข้อมูลชั่วคราวแยกต่างหาก (ไม่ใช่ไฟล์ทดสอบ — ใช้โดย test_chat_contract.py)

ใช้เปรียบเทียบคำตอบก่อน/หลัง Gate 6D แบบตัวต่อตัวอักษร:
  * รันใน process ใหม่ + SQLite ชั่วคราวที่ seed ใหม่ทุกครั้ง → ไม่ขึ้นกับลำดับ/ข้อมูลของชุดทดสอบอื่น
  * ตั้งค่า AI เป็นค่าปัจจุบันของระบบ (VORA_LLM_PROVIDER=none · general ปิด) โดยไม่อ่านค่าจาก .env ที่ส่งผลต่อคำตอบ
  * random.seed คงที่ต่อคำถาม (คำตอบ "ขอบคุณ" สุ่มจากรายการ)
  * ตัดเฉพาะ session_id / message_id / latency_ms ที่เปลี่ยนทุกครั้ง

สร้างไฟล์อ้างอิง (ทำครั้งเดียวกับโค้ดก่อน 6D):  python tests/gate6d_snapshot.py > tests/data/gate6d_baseline_60.json
Eval 20 ข้อบนฐานข้อมูลใหม่:                    python tests/gate6d_snapshot.py --eval
"""
from __future__ import annotations

import json
import os
import random
import sys
import tempfile
from pathlib import Path

EXTRA_40 = [
    ("สวัสดีค่ะ", None), ("hello", None),
    ("ขอบคุณมากค่ะ", None), ("bye bye", None),
    ("เธอชื่ออะไร", None), ("What can you do?", None),
    ("มีสาขาอะไรให้เรียนบ้าง", None), ("ปวส. มีสาขาอะไร", None),
    ("ช่างยนต์เรียนอะไรบ้าง", None), ("Tell me about Electronics", None),
    ("เรียนไฟฟ้ากำลังจบแล้วทำงานอะไร", None), ("อิเล็กทรอนิกส์จบไปทำอาชีพอะไรได้", None),
    ("เปิดรับสมัครเมื่อไหร่", None), ("ใช้เอกสารอะไรสมัครเรียน", None),
    ("ค่าเทอมเท่าไหร่", None), ("How much is the tuition?", None),
    ("มีทุนการศึกษาไหม", None), ("ทุนเรียนดีมีไหม", None),
    ("มีข่าวอะไรบ้าง", None), ("Latest news", None),
    ("มีกิจกรรมอะไรบ้าง", None), ("มีชมรมอะไรบ้าง", None),
    ("ห้องน้ำอยู่ไหน", None), ("ห้องสมุดอยู่ตรงไหน", None),
    ("ติดต่อวิทยาลัยยังไง", None), ("เบอร์โทรวิทยาลัย", None),
    ("เต้นให้ดูหน่อย", None), ("โบกมือหน่อย", None),
    ("หวยงวดนี้ออกอะไร", None), ("ราคาทองวันนี้", None),
    ("โรงอาหารมีเมนูอะไร", None), ("asdfghjkl", None),
    ("ที่จอดรถมอเตอร์ไซค์อยู่ไหน", None), ("Where is the library?", None),
    # คำถามปกติที่มีคำคล้ายหมวดไม่ปลอดภัย — ต้องไม่ถูกจัดเป็น unsafe (ตรวจ Router false positive)
    ("สาขาเคมีอุตสาหกรรมมีไหม", None), ("มีโครงการต่อต้านยาเสพติดไหม", None),
    ("ปืนยิงกาวใช้ในวิชาไหน", None), ("ของหายถูกขโมยแจ้งที่ไหน", None),
    ("ระบบสารสนเทศของวิทยาลัยใช้ทำอะไร", None), ("ฆ่าเชื้อในห้องพยาบาลยังไง", None),
]


def questions() -> list[tuple[str, str | None]]:
    from app.seed import EVAL_CASES
    eval20 = [(q, None) for q, *_ in EVAL_CASES]
    return eval20 + EXTRA_40


def run(eval_only: bool = False) -> list[dict] | dict:
    tmp = tempfile.mkdtemp(prefix="vora-6d-snap-")
    os.environ.update({
        "VORA_DATA_DIR": tmp,
        "VORA_DATABASE_URL": f"sqlite:///{Path(tmp) / 'snap.db'}",
        "VORA_LLM_PROVIDER": "none", "VORA_LLM_FALLBACK_PROVIDER": "", "VORA_AI_GENERAL_ENABLED": "false",
        "VORA_AI_BUDGET_S": "0", "VORA_RETRIEVAL_THRESHOLD": "0.22", "VORA_MAX_ANSWER_CHARS": "420",
        "VORA_ROBOT_DRIVER": "simulator", "VORA_ROBOT_ENABLE_MOTION": "true", "VORA_SCHEDULER": "false",
        "VORA_TTS_PROVIDER": "browser", "VORA_ADMIN_USER": "admin", "VORA_ADMIN_PASSWORD": "vora1234",
        # Phase 6 · 6E-4: TestClient (IP "testclient") = หน้าจอบนตัวหุ่นยนต์ เหมือน localhost ก่อน 6E (คำถาม/คำตอบ 60 ข้อไม่เปลี่ยน)
        "VORA_KIOSK_TRUSTED_HOSTS": "127.0.0.1,::1,testclient", "VORA_CHANNEL_TRUST": "server",
    })
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from fastapi.testclient import TestClient

    from app.main import app

    out = []
    with TestClient(app) as c:
        if eval_only:                     # Eval 20 ข้อบนฐานข้อมูลใหม่ (ไม่ขึ้นกับข้อมูลที่ชุดทดสอบอื่นเพิ่ม)
            tok = c.post("/api/auth/login", json={"username": "admin", "password": "vora1234"}).json()["token"]
            h = {"Authorization": f"Bearer {tok}"}
            r = c.post("/api/admin/eval/run", headers=h, json={"label": "gate6d-snapshot"}).json()
            d = c.get(f"/api/admin/eval/runs/{r['id']}", headers=h).json()
            return {"total": r["total"], "passed": r["passed"],
                    "failed": [x["question"] for x in d.get("details", []) if not x.get("pass")]}
        for i, (q, lang) in enumerate(questions()):
            random.seed(6000 + i)
            r = c.post("/api/chat", json={"text": q, "lang": lang, "channel": "kiosk", "input_mode": "text"})
            body = r.json()
            for k in ("session_id", "message_id", "latency_ms"):
                body.pop(k, None)
            out.append({"q": q, "lang": lang, "status": r.status_code, "res": body})
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(run(eval_only="--eval" in sys.argv), ensure_ascii=False, indent=1, sort_keys=True))
