"""เพิ่มประโยคตัวอย่างเจตนา "นอกขอบเขต" (out_of_scope) ให้โมเดลเข้าใจคำถาม — 11 พ.ย. 2569

ปัญหาเดิม: ตัวอย่างนอกขอบเขตมี 24 ประโยค (หวย ราคาทอง ดูดวง ฯลฯ) แคบเกินไป
คำถามความรู้ทั่วไป เช่น "ดาวอังคารอยู่ไกลแค่ไหน" จึงถูกจัดเป็นเจตนาของวิทยาลัย แล้วตอบว่า "ไม่มีข้อมูล"
ผลจำลอง (ฝึกด้วยข้อมูลตั้งต้น + ประโยคชุดนี้): คำถามทั่วไปชุดทดสอบแยก 17 ข้อ ถูกจัดเป็นนอกขอบเขต 5 → 14 ข้อ
และคำถามในฐานความรู้ 316 ข้อ ไม่มีข้อใดถูกดึงไปเป็นนอกขอบเขตแบบมั่นใจ (≥ 0.5)

สคริปต์นี้ "เพิ่มประโยค" เท่านั้น ไม่ฝึกโมเดลเอง → หลังรัน ให้ไปที่หลังบ้าน > ฝึกโมเดลเข้าใจคำถาม > ฝึกโมเดลใหม่
(เซิร์ฟเวอร์ที่เปิดอยู่จะใช้โมเดลใหม่ทันที และได้กราฟความแม่นยำก่อน/หลังไว้ใส่รายงาน)

    python scripts\\add_oos_examples.py           # เพิ่ม (ข้ามประโยคที่มีอยู่แล้ว)
    python scripts\\add_oos_examples.py --undo    # ลบเฉพาะประโยคที่สคริปต์นี้เพิ่ม
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.ai.text import detect_lang  # noqa: E402
from app.db import SessionLocal, wait_for_db  # noqa: E402
from app.models import IntentExample  # noqa: E402

TAG = "oos-20261111"
EXAMPLES = [
    'ท้องฟ้าทำไมเป็นสีฟ้า',
    'ทำไมน้ำทะเลถึงเค็ม',
    'ดวงจันทร์อยู่ไกลแค่ไหน',
    'ดาวเคราะห์ในระบบสุริยะมีกี่ดวง',
    'ไดโนเสาร์สูญพันธุ์ได้อย่างไร',
    'ฝนตกเกิดจากอะไร',
    'รุ้งกินน้ำเกิดได้ยังไง',
    'ทำไมใบไม้มีสีเขียว',
    'แมวชอบกินอะไร',
    'สุนัขพันธุ์ไหนน่าเลี้ยง',
    'ช้างกินอาหารวันละเท่าไร',
    '2 บวก 3 เท่ากับเท่าไหร่',
    'ช่วยคิดเลขให้หน่อย',
    'สูตรพื้นที่วงกลมคืออะไร',
    'ภาษาอังกฤษคำว่าแมวคืออะไร',
    'ช่วยแปลประโยคนี้เป็นภาษาอังกฤษ',
    'ประเทศญี่ปุ่นเมืองหลวงชื่ออะไร',
    'ประเทศไทยมีกี่จังหวัด',
    'ภูเขาที่สูงที่สุดในโลกคือภูเขาอะไร',
    'สงครามโลกครั้งที่สองจบเมื่อไหร่',
    'แนะนำหนังสนุกๆ',
    'แนะนำเพลงเพราะๆ ให้หน่อย',
    'การ์ตูนเรื่องไหนสนุก',
    'ไข่เจียวทำยังไงให้ฟู',
    'ต้มยำกุ้งใส่อะไรบ้าง',
    'ทำไมต้องนอนหลับ',
    'ดื่มน้ำวันละกี่แก้วดี',
    'ออกกำลังกายแบบไหนดี',
    'เล่านิทานให้ฟังหน่อย',
    'เล่าเรื่องตลกให้ฟังหน่อย',
    'ขอคำคมให้กำลังใจหน่อย',
    'วันนี้อากาศร้อนไหม',
    'ปัญญาประดิษฐ์คืออะไร',
    'อินเทอร์เน็ตทำงานยังไง',
    'why is the sky blue',
    'how far is the moon',
    'who invented the light bulb',
    'what is the capital of japan',
    'tell me a fun fact',
    'recommend a good movie',
    'how do i cook fried rice',
    'what is photosynthesis',
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--undo", action="store_true", help="ลบประโยคที่สคริปต์นี้เพิ่ม")
    a = ap.parse_args()
    wait_for_db(30)
    with SessionLocal() as db:
        if a.undo:
            n = db.query(IntentExample).filter(IntentExample.source == TAG).delete()
            db.commit()
            print(f"ลบประโยคที่เพิ่มไว้ {n} ประโยค · กดฝึกโมเดลใหม่ในหลังบ้านเพื่อให้มีผล")
            return 0
        existing = {t.strip().lower() for (t,) in db.query(IntentExample.text).all()}
        before = db.query(IntentExample).filter(IntentExample.intent == "out_of_scope", IntentExample.active.is_(True)).count()
        added = 0
        for t in EXAMPLES:
            if t.strip().lower() in existing:
                continue
            db.add(IntentExample(text=t, intent="out_of_scope", lang=detect_lang(t), source=TAG, active=True))
            existing.add(t.strip().lower())
            added += 1
        db.commit()
        print(f"ตัวอย่างนอกขอบเขต: {before} → {before + added} ประโยค (เพิ่ม {added}, ข้ามที่มีแล้ว {len(EXAMPLES) - added})")
        print("ขั้นต่อไป: หลังบ้าน > ฝึกโมเดลเข้าใจคำถาม > กด 'ฝึกโมเดลใหม่'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
