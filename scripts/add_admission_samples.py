"""ข้อมูลตัวอย่างเรื่องการรับสมัครเรียน (12 พ.ย. 2569)

เพิ่ม "ข้อมูลตัวอย่าง" ให้หุ่นยนต์ตอบเรื่องการสมัครได้ก่อน แล้วให้เจ้าหน้าที่แก้เป็นข้อมูลจริงที่
หลังบ้าน > การรับสมัคร (ทุกรายการที่สคริปต์นี้เพิ่มมีป้าย "ตัวอย่าง" ในหลังบ้าน จนกว่าจะแก้ไข)

  1) คำถามที่พบบ่อยเรื่องการสมัคร 9 ข้อ (ฐานความรู้ อนุมัติแล้ว) — เนื้อหาทั่วไป ไม่ใส่วันที่/ราคาที่แต่งขึ้นเอง
  2) ประกาศรับสมัคร 2 รายการ (เผยแพร่ หมดอายุใน 180 วัน) — ชื่อมีคำว่า "(ตัวอย่าง)"
  3) ขั้นตอนสมัครออนไลน์ + ช่องทางติดต่อ (เฉพาะช่องที่ยังว่าง ไม่ทับข้อมูลที่เจ้าหน้าที่กรอกไว้)

ความปลอดภัยของข้อมูล: สำรองฐานข้อมูลก่อนเสมอ · ข้ามรายการที่มีคำถาม/หัวข้อเดียวกันอยู่แล้ว · ย้อนกลับได้

    python scripts\\add_admission_samples.py          # เพิ่ม
    python scripts\\add_admission_samples.py --undo   # ลบเฉพาะรายการตัวอย่างที่ยังไม่ถูกแก้ และคืนค่าตั้งค่าเดิม
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from app.config import DATA_DIR  # noqa: E402
from app.db import SessionLocal, wait_for_db  # noqa: E402
from app.models import KnowledgeItem, News  # noqa: E402
from app.services import all_settings, set_setting  # noqa: E402

TAG = "sample-admission-20261112"
UNDO = DATA_DIR / "admission_samples_undo.json"

FAQ = [
    ("admission", "สมัครเรียนอย่างไร", "สมัครเรียนยังไง|วิธีสมัครเรียน|ขั้นตอนการสมัครเรียน|สมัครเรียนได้ที่ไหน|อยากสมัครเรียนต้องทำอะไร",
     "สมัครเรียนได้ 2 ช่องทางค่ะ คือสมัครออนไลน์ผ่านเว็บไซต์รับสมัครของวิทยาลัย หรือสมัครด้วยตนเองที่งานทะเบียน "
     "เลือกระดับและสาขาวิชาที่สนใจ กรอกใบสมัคร แนบเอกสาร แล้วติดตามประกาศรายชื่อผู้มีสิทธิ์สอบหรือสัมภาษณ์ค่ะ",
     "You can apply online through the college's admission website or in person at the registrar's office. Choose your level and program, "
     "fill in the form, attach the documents, then follow the announcement of applicants eligible for the test or interview."),
    ("admission", "เอกสารที่ใช้สมัครเรียน", "ต้องใช้เอกสารอะไรบ้าง|สมัครเรียนใช้เอกสารอะไร|เตรียมเอกสารอะไรบ้าง|เอกสารสมัคร",
     "เอกสารที่ใช้โดยทั่วไป ได้แก่ ใบแสดงผลการเรียนหรือใบรับรองผลการเรียน สำเนาทะเบียนบ้านและสำเนาบัตรประชาชนของผู้สมัคร "
     "สำเนาบัตรประชาชนของผู้ปกครอง และรูปถ่ายหน้าตรงขนาด 1 นิ้ว รายการที่แน่นอนให้ยึดตามประกาศรับสมัครของแต่ละปีค่ะ",
     "Usually you need your transcript or a certificate of study, copies of the applicant's house registration and ID card, "
     "a copy of a parent's ID card and a 1-inch photo. Check the year's admission announcement for the exact list."),
    ("admission", "เปิดรับสมัครเมื่อไหร่", "รับสมัครวันไหน|ช่วงเวลารับสมัคร|เปิดรับสมัครช่วงไหน|รับสมัครถึงเมื่อไหร่|รอบโควตาเปิดเมื่อไหร่",
     "โดยทั่วไปวิทยาลัยเปิดรับสมัครรอบโควตาก่อน แล้วจึงเปิดรอบทั่วไปก่อนเปิดภาคเรียนที่ 1 "
     "วันเวลาที่แน่นอนดูได้จากประกาศรับสมัครบนหน้าจอนี้ เว็บไซต์ หรือเพจของวิทยาลัยค่ะ",
     "The college usually opens a quota round first, then a general round before the first semester. "
     "See the admission announcement on this screen, the website or the college page for exact dates."),
    ("admission", "คุณสมบัติผู้สมัครระดับ ปวช.", "จบ ม.3 สมัครอะไรได้|ปวช. รับใครบ้าง|คุณสมบัติ ปวช.|จบ ม.3 เรียนต่อที่นี่ได้ไหม",
     "ระดับ ปวช. รับผู้ที่จบชั้นมัธยมศึกษาปีที่ 3 หรือเทียบเท่า หรือกำลังเรียนชั้น ม.3 และจะจบก่อนวันรายงานตัว "
     "บางสาขาอาจมีเงื่อนไขเพิ่ม เช่น การตรวจสุขภาพ ดูได้ในประกาศรับสมัครค่ะ",
     "Vocational Certificate (Por Wor Chor) applicants must have finished Grade 9 (Mathayom 3) or equivalent, or be finishing it before enrolment. "
     "Some programs have extra requirements listed in the announcement."),
    ("admission", "คุณสมบัติผู้สมัครระดับ ปวส.", "จบ ปวช. สมัครอะไรได้|จบ ม.6 เรียน ปวส. ได้ไหม|คุณสมบัติ ปวส.|ปวส. รับใครบ้าง",
     "ระดับ ปวส. รับผู้ที่จบ ปวช. ในสาขาที่เกี่ยวข้อง หรือจบชั้นมัธยมศึกษาปีที่ 6 "
     "ผู้ที่จบ ม.6 บางสาขาต้องเรียนรายวิชาปรับพื้นฐานวิชาชีพเพิ่ม สอบถามรายละเอียดได้ที่งานทะเบียนค่ะ",
     "Higher Vocational Diploma (Por Wor Sor) applicants must hold a related Vocational Certificate or have finished Grade 12. "
     "Grade 12 graduates may need extra foundation courses in some programs."),
    ("tuition", "ค่าเทอมเท่าไหร่", "ค่าเล่าเรียนเท่าไร|ค่าธรรมเนียมการศึกษา|เรียนฟรีไหม|ค่าใช้จ่ายในการเรียน|ค่าสมัครเท่าไหร่",
     "ระดับ ปวช. ได้รับการสนับสนุนค่าเล่าเรียนตามนโยบายเรียนฟรีของรัฐ ส่วนค่าธรรมเนียมอื่น "
     "และค่าใช้จ่ายระดับ ปวส. แตกต่างกันตามสาขา ยอดที่แน่นอนดูได้ในประกาศรับสมัครหรือสอบถามงานการเงินค่ะ",
     "Tuition for the Vocational Certificate level is supported by the government's free education policy. "
     "Other fees and the Higher Diploma costs vary by program; see the announcement or ask the finance office."),
    ("scholarship", "มีทุนการศึกษาไหม", "ทุนเรียนมีไหม|กยศ.|ขอทุนได้ไหม|ทุนการศึกษามีอะไรบ้าง|กู้ยืมเพื่อการศึกษา",
     "มีค่ะ นักเรียนนักศึกษาสามารถขอกู้ยืมจากกองทุนเงินให้กู้ยืมเพื่อการศึกษา หรือ กยศ. "
     "และยังมีทุนเรียนดีและทุนช่วยเหลือจากวิทยาลัยและหน่วยงานภายนอก สอบถามได้ที่งานแนะแนวค่ะ",
     "Yes. Students can apply for the Student Loan Fund (Kor Yor Sor) and for merit or need-based scholarships "
     "from the college and outside organisations. Ask the guidance office."),
    ("admission", "สมัครแล้วต้องสอบไหม", "มีสอบเข้าไหม|ต้องสัมภาษณ์ไหม|สอบคัดเลือกอะไรบ้าง|ประกาศผลเมื่อไหร่",
     "หลังปิดรับสมัคร วิทยาลัยจะประกาศรายชื่อผู้มีสิทธิ์สอบหรือสัมภาษณ์ แล้วจึงประกาศรายชื่อผู้ผ่านการคัดเลือก "
     "วิธีคัดเลือกของแต่ละรอบและแต่ละสาขาอาจต่างกัน ดูได้ในประกาศรับสมัครค่ะ",
     "After applications close, the college announces who may take the test or interview, then announces the selected students. "
     "Selection methods differ by round and program."),
    ("admission", "รายงานตัวและมอบตัวอย่างไร", "มอบตัวต้องทำอะไร|รายงานตัวเมื่อไหร่|ผ่านการคัดเลือกแล้วทำอะไรต่อ|มอบตัวใช้เอกสารอะไร",
     "ผู้ผ่านการคัดเลือกต้องมารายงานตัวและมอบตัวพร้อมผู้ปกครองตามวันที่วิทยาลัยกำหนด "
     "นำเอกสารตัวจริงและสำเนามาด้วย และชำระค่าธรรมเนียมตามประกาศ หากไม่มารายงานตัวตามกำหนดอาจถือว่าสละสิทธิ์ค่ะ",
     "Selected students must report and enrol with a parent on the date set by the college, bringing original documents and copies "
     "and paying the fees in the announcement. Missing the date may forfeit the place."),
]

NEWS = [
    ("เปิดรับสมัครนักเรียน นักศึกษาใหม่ ปีการศึกษา 2570 (ตัวอย่าง)", "New student admission for academic year 2027 (sample)",
     "วิทยาลัยเปิดรับสมัครนักเรียนระดับ ปวช. และนักศึกษาระดับ ปวส. หลายสาขาวิชา สมัครได้ทั้งออนไลน์และที่งานทะเบียน "
     "ดูขั้นตอนการสมัครได้ที่หุ่นยนต์วอร่า หรือถามว่า สมัครเรียนออนไลน์ยังไง",
     "The college is accepting Vocational Certificate and Higher Diploma students in many programs, online or at the registrar. "
     "Ask VORA how to apply online.", 5),
    ("รับสมัครรอบโควตา ระดับ ปวช. (ตัวอย่าง)", "Quota round for the Vocational Certificate (sample)",
     "นักเรียนชั้น ม.3 ที่มีผลการเรียนตามเกณฑ์ สามารถสมัครรอบโควตาได้ โดยยื่นใบสมัครพร้อมใบรับรองผลการเรียน "
     "ติดตามกำหนดการได้ที่เว็บไซต์และเพจของวิทยาลัย",
     "Grade 9 students who meet the grade criteria can apply in the quota round with their certificate of study. "
     "Follow the schedule on the college website and page.", 4),
]

# 12 พ.ย. 2569 (รอบ 2): ประกาศหลักแบบละเอียด (เดิมมีแค่ย่อหน้าเดียว) — {programs} เติมจากสาขาที่เผยแพร่จริงในระบบ
MAIN_TITLE = NEWS[0][0]
MAIN_BODY_TH = """วิทยาลัยเปิดรับสมัครนักเรียนระดับประกาศนียบัตรวิชาชีพ (ปวช.) และนักศึกษาระดับประกาศนียบัตรวิชาชีพชั้นสูง (ปวส.) ประจำปีการศึกษา 2570

กำหนดการรับสมัคร (ตัวอย่าง)
• รอบโควตา สำหรับนักเรียน ม.3 ที่มีผลการเรียนตามเกณฑ์: ธันวาคม 2569 ถึง มกราคม 2570
• รอบทั่วไป ระดับ ปวช. และ ปวส.: กุมภาพันธ์ ถึง มีนาคม 2570
• ประกาศรายชื่อผู้มีสิทธิ์สอบหรือสัมภาษณ์: ภายใน 7 วันหลังปิดรับสมัครแต่ละรอบ
• รายงานตัวและมอบตัว: ตามวันที่ประกาศพร้อมรายชื่อผู้ผ่านการคัดเลือก

สาขาวิชาที่เปิดรับ
{programs}

คุณสมบัติผู้สมัคร
• ระดับ ปวช. จบหรือกำลังเรียนชั้นมัธยมศึกษาปีที่ 3 หรือเทียบเท่า
• ระดับ ปวส. จบ ปวช. ในสาขาที่เกี่ยวข้อง หรือจบมัธยมศึกษาปีที่ 6

เอกสารประกอบการสมัคร
• ใบแสดงผลการเรียน หรือใบรับรองผลการเรียน
• สำเนาทะเบียนบ้านและสำเนาบัตรประชาชนของผู้สมัคร
• สำเนาบัตรประชาชนของผู้ปกครอง
• รูปถ่ายหน้าตรงขนาด 1 นิ้ว จำนวน 2 รูป

ช่องทางการสมัคร
• สมัครออนไลน์ผ่านเว็บไซต์รับสมัครของวิทยาลัย ถามวอร่าว่า สมัครเรียนออนไลน์ยังไง เพื่อดูทีละขั้นตอน
• สมัครด้วยตนเองที่งานทะเบียน ในวันและเวลาราชการ
• พิมพ์ใบสมัครได้จากเส้นทางการสมัครเรียนบนหน้าจอนี้ หรือสแกนคิวอาร์โค้ดในขั้นสุดท้าย

ค่าใช้จ่ายและทุน
• ระดับ ปวช. ได้รับการสนับสนุนค่าเล่าเรียนตามนโยบายเรียนฟรีของรัฐ
• สามารถขอกู้ยืม กยศ. และสมัครทุนการศึกษาของวิทยาลัยได้ สอบถามที่งานแนะแนว

สอบถามเพิ่มเติม: งานทะเบียนของวิทยาลัย วันจันทร์ถึงวันศุกร์ เวลาราชการ

หมายเหตุ: ประกาศนี้เป็นข้อมูลตัวอย่าง รอเจ้าหน้าที่แก้ไขเป็นประกาศรับสมัครจริงของวิทยาลัย"""
MAIN_BODY_EN = """The college is accepting Vocational Certificate and Higher Vocational Diploma students for academic year 2027.

Schedule (sample)
• Quota round for Grade 9 students who meet the grade criteria: December 2026 to January 2027
• General round for both levels: February to March 2027
• List of applicants for the test or interview: within 7 days after each round closes
• Reporting and enrolment: on the date announced with the list of selected students

Programs open
{programs}

Requirements
• Vocational Certificate: finished or finishing Grade 9 or equivalent
• Higher Diploma: a related Vocational Certificate or Grade 12

Documents
• Transcript or certificate of study
• Copies of the applicant's house registration and ID card
• Copy of a parent's ID card
• Two 1-inch photos

How to apply
• Online through the college's admission website — ask VORA "how do I apply online"
• In person at the registrar's office during office hours
• Print the application form from the admission journey on this screen

Fees and scholarships
• Vocational Certificate tuition is supported by the government's free education policy
• Student loans (Kor Yor Sor) and college scholarships are available — ask the guidance office

Note: this is sample information waiting for staff to replace it with the official announcement."""


def _programs_text(db, en: bool) -> str:
    """สาขาที่เผยแพร่จริงในระบบ แยกตามระดับ (ไม่มีข้อมูล = ข้อความแนะนำให้ดูที่เมนูสาขาวิชา)"""
    from app.models import Program
    rows = db.query(Program).filter(Program.status == "published").order_by(Program.level, Program.name_th).all()
    groups: dict[str, list[str]] = {}
    for p in rows:
        name = (p.name_en or p.name_th) if en else p.name_th
        groups.setdefault(p.level or ("Other" if en else "อื่น ๆ"), []).append(name)
    if not groups:
        return "• See the Programs menu on this screen" if en else "• ดูรายชื่อสาขาวิชาได้ที่เมนูสาขาวิชาบนหน้าจอนี้"
    return "\n".join(f"• {lv}: {', '.join(names[:12])}{' …' if len(names) > 12 else ''}" for lv, names in groups.items())


SETTINGS = {
    "apply_steps_th": "\n".join([
        "เข้าเว็บไซต์รับสมัครของวิทยาลัย แล้วเลือกเมนูสมัครเรียน",
        "เลือกระดับการศึกษา ปวช. หรือ ปวส. และสาขาวิชาที่ต้องการ",
        "กรอกข้อมูลผู้สมัครและข้อมูลผู้ปกครองให้ครบถ้วน",
        "อัปโหลดรูปถ่ายและเอกสารตามที่ประกาศกำหนด",
        "ตรวจสอบข้อมูล แล้วกดยืนยันการสมัคร จดเลขที่ใบสมัครไว้",
        "ติดตามประกาศรายชื่อผู้มีสิทธิ์สอบหรือสัมภาษณ์ทางเว็บไซต์และเพจของวิทยาลัย",
    ]),
    "apply_steps_en": "\n".join([
        "Open the college's admission website and choose Apply",
        "Choose the level (Vocational Certificate or Higher Diploma) and the program",
        "Fill in the applicant's and parent's details",
        "Upload a photo and the required documents",
        "Check your details, confirm, and keep your application number",
        "Follow the list of applicants for the test or interview on the website and college page",
    ]),
    "apply_contact_th": "งานทะเบียนของวิทยาลัย วันจันทร์ถึงวันศุกร์ เวลาราชการ",
    "apply_contact_en": "The college registrar's office, Monday to Friday during office hours",
}


def add() -> int:
    from backup_db import backup
    p = backup(tag="before-admission-samples")
    print(f"สำรองฐานข้อมูลไว้ที่ {p}")
    db = SessionLocal()
    undo = {"settings": {}, "added_settings": []}
    try:
        k_add = n_add = 0
        for cat, q, alts, th, en in FAQ:
            if db.query(KnowledgeItem).filter(KnowledgeItem.question == q).first():
                print(f"  ข้าม (มีอยู่แล้ว): {q}")
                continue
            db.add(KnowledgeItem(kind="faq", category=cat, question=q, alt_questions=alts.replace("|", "\n"), answer_th=th, answer_en=en,
                                 source="import", status="approved", created_by=TAG, approved_by=TAG))
            k_add += 1
        now = datetime.now()
        main_th = MAIN_BODY_TH.replace("{programs}", _programs_text(db, False))
        main_en = MAIN_BODY_EN.replace("{programs}", _programs_text(db, True))
        for th, en, bth, ben, pri in NEWS:
            short = bth                                       # เนื้อหาฉบับย่อรอบแรก (ใช้ตรวจว่ายังไม่มีใครแก้)
            if th == MAIN_TITLE:
                bth, ben = main_th, main_en
            old = db.query(News).filter(News.title_th == th).first()
            if old:
                # อัปเดตเฉพาะเมื่อยังเป็นฉบับย่อเดิมทุกตัวอักษร — เจ้าหน้าที่แก้แล้ว (แม้ชื่อยังมีคำว่าตัวอย่าง) = ไม่ทับ
                if old.created_by == TAG and old.body_th == short and short != bth:
                    old.body_th, old.body_en = bth, ben
                    print(f"  อัปเดตเป็นฉบับละเอียด: {th}")
                else:
                    print(f"  ข้าม (มีอยู่แล้ว): {th}")
                continue
            db.add(News(kind="admission", title_th=th, title_en=en, body_th=bth, body_en=ben, priority=pri, status="published",
                        publish_at=now, expire_at=now + timedelta(days=180), created_by=TAG, approved_by=TAG))
            n_add += 1
        cfg = all_settings(db)
        for k, v in SETTINGS.items():
            if (cfg.get(k) or "").strip():
                print(f"  ไม่ทับค่าตั้งค่าที่มีอยู่: {k}")
                continue
            undo["settings"][k] = cfg.get(k) or ""
            set_setting(db, k, v)
            undo["added_settings"].append(k)
        if undo["added_settings"]:
            set_setting(db, "admission_sample", True)
        db.commit()
    finally:
        db.close()
    prev = json.loads(UNDO.read_text(encoding="utf-8")) if UNDO.exists() else {"settings": {}, "added_settings": []}
    prev["settings"].update(undo["settings"])
    prev["added_settings"] = sorted(set(prev["added_settings"]) | set(undo["added_settings"]))
    UNDO.write_text(json.dumps(prev, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"เพิ่มคำถามที่พบบ่อย {k_add} ข้อ · ประกาศรับสมัคร {n_add} รายการ · ตั้งค่า {len(undo['added_settings'])} ช่อง")
    print("แก้เป็นข้อมูลจริงได้ที่ หลังบ้าน > การรับสมัคร (รายการตัวอย่างมีป้าย \"ตัวอย่าง\")")
    print("ปิดแล้วเปิด start.bat ใหม่ เพื่อให้หุ่นยนต์ใช้ข้อมูลใหม่")
    return 0


def undo() -> int:
    from backup_db import backup
    p = backup(tag="before-admission-samples-undo")
    print(f"สำรองฐานข้อมูลไว้ที่ {p}")
    db = SessionLocal()
    try:
        # ลบเฉพาะรายการที่ยังไม่ถูกแก้ (version 1 สำหรับความรู้) — รายการที่เจ้าหน้าที่แก้แล้วถือเป็นข้อมูลจริง ไม่ลบ
        kb = db.query(KnowledgeItem).filter(KnowledgeItem.created_by == TAG).all()
        k_del = [x for x in kb if (x.version or 1) <= 1]
        for x in k_del:
            db.delete(x)
        nw = db.query(News).filter(News.created_by == TAG).all()
        n_del = [x for x in nw if "(ตัวอย่าง)" in (x.title_th or "")]
        for x in n_del:
            db.delete(x)
        cfg = all_settings(db)
        data = json.loads(UNDO.read_text(encoding="utf-8")) if UNDO.exists() else {"settings": {}, "added_settings": []}
        restored = 0
        for k in data.get("added_settings", []):
            if (cfg.get(k) or "") == SETTINGS.get(k):            # ยังเป็นค่าตัวอย่าง → คืนค่าเดิม
                set_setting(db, k, data["settings"].get(k, ""))
                restored += 1
        set_setting(db, "admission_sample", False)
        db.commit()
    finally:
        db.close()
    if UNDO.exists():
        UNDO.unlink()
    print(f"ลบคำถามตัวอย่าง {len(k_del)} ข้อ (ข้ามที่แก้แล้ว {len(kb) - len(k_del)}) · ประกาศตัวอย่าง {len(n_del)} · คืนค่าตั้งค่า {restored} ช่อง")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="ข้อมูลตัวอย่างเรื่องการรับสมัคร")
    ap.add_argument("--undo", action="store_true")
    a = ap.parse_args()
    wait_for_db()
    sys.exit(undo() if a.undo else add())
