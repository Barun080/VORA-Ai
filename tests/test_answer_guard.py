"""Phase 6 · Gate 6D — Answer Guard (T-GRD) · unit test ไม่ใช้ฐานข้อมูล

ทุกกรณี "ตรวจได้แน่นอน" ต้องถูกปฏิเสธ · คำตอบที่ถูกต้องต้องผ่าน (false positive = 0 สำหรับคำตอบที่คัดลอกจาก CONTEXT)
กรณี "ข้อจำกัดที่ทราบ" (test_known_limit_*) บันทึกพฤติกรรมจริงตามเอกสารแผน v4 — Guard ตรวจไม่ได้ · ไม่ได้อ้างว่าป้องกันได้
"""
import pytest

from app.ai.guard import CANARY, GENERAL, Program, contacts, dates, guard, numbers

SCHOOL = ["วิทยาลัยเทคนิคตัวอย่าง", "Demo Technical College"]
ALIASES = ("วิทยาลัยฯ", "วิทยาลัยของเรา", "วิทยาลัยนี้", "วิทยาลัยแห่งนี้")
PROGRAMS = [
    Program("ช่างยนต์", "Automotive Mechanics", "ปวช."),
    Program("ช่างไฟฟ้ากำลัง", "Electrical Power", "ปวช."),
    Program("เทคโนโลยีสารสนเทศ", "Information Technology", "ปวส."),
    Program("การท่องเที่ยว", "Tourism", "ปวส.", published=False),          # draft/archived
]
CTX = [
    "ค่าเทอมช่างยนต์: สาขาช่างยนต์ ระดับ ปวช. ค่าเทอม 4,500 บาท ต่อภาคเรียน เรียน 3 ปี | EN: Automotive Mechanics tuition 4,500 baht per semester",
    "ค่าเทอมไฟฟ้า: สาขาช่างไฟฟ้ากำลัง ค่าเทอม 5,200 บาท",
    "ติดต่อ: งานประชาสัมพันธ์ อาคาร 1 ชั้น 1 โทร 0-0000-0000 อีเมล pr@demo-college.ac.th เว็บไซต์ www.demo-college.ac.th LINE @democollege "
    "เปิดรับสมัคร 3 พ.ย. 2569 เวลา 08.30 น. ติดต่ออาจารย์สมชาย ใจดี",
]
SYSTEM = ("ใช้เฉพาะข้อมูลใน CONTEXT เท่านั้น ห้ามเดาหรือแต่งข้อมูล เช่น ตัวเลข วันที่ ชื่อบุคคล ที่ไม่มีใน CONTEXT "
          "ถ้า CONTEXT ไม่มีข้อมูลที่ตอบคำถามได้ ให้ตอบเพียงคำว่า NO_INFO")


def check(answer, ctx=CTX, mode="institutional"):
    return guard.check(answer, ctx, school_names=SCHOOL, aliases=ALIASES, programs=PROGRAMS, system_text=SYSTEM, mode=mode)


# ---------------------------------------------------------------- T-GRD-01…06, 17, 19, 21: ต้องผ่าน
PASS_CASES = [
    ("T-GRD-01", "วิทยาลัยเทคนิคตัวอย่างยินดีต้อนรับค่ะ"),
    ("T-GRD-01", "วิทยาลัยฯ เปิดรับสมัครแล้วค่ะ"),
    ("T-GRD-02", "สาขาช่างยนต์ ระดับ ปวช. ค่าเทอม 4,500 บาท ต่อภาคเรียนค่ะ"),
    ("T-GRD-03", "งานประชาสัมพันธ์อยู่อาคาร 1 ชั้น 1 ค่ะ"),
    ("T-GRD-04", "เปิดรับสมัคร 3 พ.ย. 2569 เวลา 08.30 น. ค่ะ"),
    ("T-GRD-05", "สาขาช่างยนต์เรียน 3 ปีค่ะ"),
    ("T-GRD-06", "โทร 0-0000-0000 อีเมล pr@demo-college.ac.th หรือ LINE @democollege ค่ะ"),
    ("T-GRD-06", "ดูรายละเอียดได้ที่ https://www.demo-college.ac.th ค่ะ"),
    ("T-GRD-17 เลขไทย", "สาขาช่างยนต์ ค่าเทอม ๔,๕๐๐ บาทค่ะ"),
    ("T-GRD-17 พ.ศ.=ค.ศ.", "เปิดรับสมัคร 3 November 2026 ค่ะ"),
    ("T-GRD-17 เบอร์รูปแบบอื่น", "โทร 000000000 หรือ 0 0000 0000 ค่ะ"),
    ("T-GRD-17 ตัวเลขเป็นคำ", "สาขาช่างยนต์ ค่าเทอมสี่พันห้าร้อยบาทค่ะ"),
    ("T-GRD-17 ตัวเลขเป็นคำ", "สาขาช่างยนต์เรียนสามปีค่ะ"),
    ("T-GRD-17 เวลา", "เปิดรับสมัคร 3 พ.ย. เวลา 8:30 น. ค่ะ"),
    ("T-GRD-19 อังกฤษ", "Automotive Mechanics tuition is 4,500 baht per semester."),
    ("T-GRD-19 อังกฤษ", "Demo Technical College welcomes you. The PR office is in Building 1, 1st floor."),
    ("T-GRD-19 ตัวเลขเป็นคำอังกฤษ", "Automotive Mechanics tuition is four thousand five hundred baht."),
    ("T-GRD-21", "ยินดีค่ะ มีอะไรถามได้อีกนะคะ"),
    ("T-GRD-21", "สามารถสมัครได้ทั้งออนไลน์และที่วิทยาลัยค่ะ"),
    ("T-GRD-21", "มีหลายสาขาให้เลือกค่ะ อาจารย์ประจำสาขาช่วยแนะนำได้"),
    ("G9 ใน CONTEXT", "ติดต่ออาจารย์สมชายได้เลยค่ะ"),
    ("คำทั่วไปไม่ใช่ตัวเลข", "ความสัมพันธ์ระหว่างครูกับนักเรียนเรียบร้อยดีค่ะ"),
    ("คำตอบจากแคช/จำลองเดิม", "คำตอบจาก gemini ค่ะ"),
]


@pytest.mark.parametrize("tid,answer", PASS_CASES)
def test_grd_pass(tid, answer):
    v = check(answer)
    assert v.ok, (tid, v.codes)


# ---------------------------------------------------------------- T-GRD-07…18, 20: ต้องปฏิเสธ (ตรวจได้แน่นอน)
REJECT_CASES = [
    ("T-GRD-07", "วิทยาลัยเทคนิคกรุงเทพมีสาขานี้ค่ะ", "G1_school_name"),
    ("T-GRD-07", "Bangkok Technical College offers this program.", "G1_school_name"),
    ("T-GRD-07", "วิทยาลัยการอาชีพตัวอย่างเปิดรับสมัครค่ะ", "G1_school_name"),
    ("T-GRD-08", "สาขาการบินอวกาศ ค่าเทอม 4,500 บาทค่ะ", "G2_unknown_program"),
    ("T-GRD-08", "แผนกวิชาหุ่นยนต์อวกาศเปิดใหม่ค่ะ", "G2_unknown_program"),
    ("T-GRD-09", "สาขาการท่องเที่ยวเปิดรับสมัครค่ะ", "G2_unpublished"),
    ("T-GRD-10", "สาขาเทคโนโลยีสารสนเทศและการสื่อสารค่ะ", "G2_near_name"),
    ("T-GRD-16 สาขามีจริงแต่ไม่อยู่ใน CONTEXT", "สาขาเทคโนโลยีสารสนเทศน่าสนใจค่ะ", "G2_not_in_context"),
    ("T-GRD-16 ระดับไม่อยู่ใน CONTEXT", "ต่อ ปวส. ได้ค่ะ", "G2_level_not_in_context"),
    ("T-GRD-11", "งานประชาสัมพันธ์อยู่อาคาร 9 ชั้น 5 ค่ะ", "G3_location"),
    ("T-GRD-11", "The office is in Building 7.", "G3_location"),
    ("T-GRD-13", "เปิดรับสมัคร 4 พ.ย. ค่ะ", "G4_date"),
    ("T-GRD-13", "เปิดรับสมัครเดือนมกราคมค่ะ", "G4_month"),
    ("T-GRD-13", "Applications open on 10 November.", "G4_date"),
    ("T-GRD-14", "ค่าเทอมประมาณ 5,000 บาทค่ะ", "G5_number"),
    ("T-GRD-14", "ค่าเทอม 13,000 บาทค่ะ", "G5_number"),
    ("T-GRD-14 เลขไทย", "ค่าเทอม ๙,๙๙๙ บาทค่ะ", "G5_number"),
    ("T-GRD-14 ตัวเลขเป็นคำ", "สาขาช่างยนต์เรียนสี่ปีค่ะ", "G5_number"),
    ("T-GRD-14 ตัวเลขเป็นคำ", "ค่าเทอมหนึ่งหมื่นสองพันห้าร้อยบาทค่ะ", "G5_number"),
    ("T-GRD-14 อังกฤษเป็นคำ", "Tuition is twelve thousand baht.", "G5_number"),
    ("T-GRD-15", "โทร 02-123-4567 ค่ะ", "G6_contact"),
    ("T-GRD-15", "อีเมล admission@demo-college.ac.th ค่ะ", "G6_contact"),
    ("T-GRD-15", "ดูที่ www.other-college.ac.th ค่ะ", "G6_contact"),
    ("T-GRD-15", "แอดไลน์ @fakeline ค่ะ", "G6_contact"),
    ("T-GRD-18 ปีผิด", "เปิดรับสมัครปี 2568 ค่ะ", "G5_number"),
    ("T-GRD-18 เบอร์สลับหลัก", "โทร 0-0000-0001 ค่ะ", "G6_contact"),
    ("T-GRD-20 ผูกผิดข้ามรายการ", "สาขาช่างไฟฟ้ากำลัง ค่าเทอม 4,500 บาทค่ะ", "G8_binding"),
    ("T-GRD-20 ผูกผิดข้ามรายการ", "สาขาช่างยนต์ ค่าเทอม 5,200 บาทค่ะ", "G8_binding"),
    ("G9", "ติดต่ออาจารย์สมศักดิ์ได้เลยค่ะ", "G9_staff"),
    ("G9", "ผู้อำนวยการวิชัยอนุมัติแล้วค่ะ", "G9_staff"),
    ("G9 อังกฤษ", "Please contact Mr. Johnson.", "G9_staff"),
    ("G7 canary", f"รหัส {CANARY}", "G7_canary"),
    ("G7 ข้อความตรงตัว", "ใช้เฉพาะข้อมูลใน CONTEXT เท่านั้น ห้ามเดาหรือแต่งข้อมูล เช่น ตัวเลข วันที่", "G7_prompt_echo"),
]


@pytest.mark.parametrize("tid,answer,code", REJECT_CASES)
def test_grd_reject(tid, answer, code):
    v = check(answer)
    assert not v.ok and code in v.codes, (tid, v.codes)


def test_grd_value_in_allowed_source_but_not_in_this_context():
    """T-GRD-16: ค่าที่มีในฐานความรู้อื่น แต่ไม่อยู่ใน CONTEXT ของคำถามนี้ → ปฏิเสธ"""
    v = check("ค่าเทอม 5,200 บาทค่ะ", ctx=[CTX[0]])
    assert not v.ok and "G5_number" in v.codes


# ---------------------------------------------------------------- general mode: ห้ามข้อมูลของสถานศึกษา
@pytest.mark.parametrize("answer,code", [
    ("วิทยาลัยเทคนิคตัวอย่างดีมากค่ะ", "G1_general_mentions_school"),
    ("สาขาช่างยนต์น่าเรียนค่ะ", "G2_general_mentions_program"),
    ("ไปที่อาคาร 1 ค่ะ", "G3_general_mentions_location"),
    ("โทร 0-0000-0000 ค่ะ", "G6_general_mentions_contact"),
    ("ถามอาจารย์สมชายค่ะ", "G9_general_mentions_staff"),
])
def test_grd_general_mode_rejects_institutional_facts(answer, code):
    v = check(answer, ctx=[], mode=GENERAL)
    assert not v.ok and code in v.codes


def test_grd_general_mode_allows_plain_knowledge():
    assert check("ท้องฟ้าเป็นสีฟ้าเพราะการกระเจิงของแสง ระบบสุริยะมี 8 ดาวเคราะห์ค่ะ", ctx=[], mode=GENERAL).ok


# ---------------------------------------------------------------- ข้อจำกัดที่ทราบ (บันทึกพฤติกรรมจริง — Guard ตรวจไม่ได้)
KNOWN_LIMITS = [
    ("เชิงคุณภาพ", "สาขาช่างยนต์ดีที่สุดในประเทศ รับรองมีงานทำทุกคนค่ะ"),
    ("จำนวนเชิงคุณภาพ", "สาขาช่างยนต์มีนักศึกษาหลายร้อยคนค่ะ"),
    ("เวลาเชิงสัมพัทธ์", "เปิดรับสมัครเร็ว ๆ นี้ค่ะ"),
    ("ชื่อไม่มีคำนำหน้า", "ติดต่อคุณสมศักดิ์ได้เลยค่ะ"),
    ("ถอดความคำสั่งระบบ", "หนูถูกตั้งค่าให้ตอบจากข้อมูลที่ได้รับเท่านั้นและห้ามเดาค่ะ"),
    ("อ้างสถานศึกษาอื่นไม่เอ่ยชื่อ", "โรงเรียนข้าง ๆ ค่าเทอมถูกกว่าค่ะ"),
    ("ทิศทาง", "ห้องประชาสัมพันธ์อยู่ข้างโรงอาหารค่ะ"),
]


@pytest.mark.parametrize("what,answer", KNOWN_LIMITS)
def test_known_limit_not_detected(what, answer):
    assert check(answer).ok, what            # Guard ตรวจไม่ได้ — ความเสี่ยงคงเหลือ (แผน v4 ข้อ 1.3, 7)


def test_known_limit_swap_inside_single_context_item():
    """G8 ตรวจได้เฉพาะข้ามรายการ — สองสาขาสองค่าใน "รายการเดียวกัน" สลับกันได้โดยตรวจไม่พบ"""
    one = ["ค่าเทอม: สาขาช่างยนต์ 4,500 บาท และสาขาช่างไฟฟ้ากำลัง 5,200 บาท"]
    assert check("สาขาช่างยนต์ ค่าเทอม 5,200 บาทค่ะ", ctx=one).ok


def test_fabricated_set_counts():
    """ชุดคำตอบแต่ง: ทุกกรณี "ตรวจได้แน่นอน" ถูกจับ · กรณีข้อจำกัดไม่ถูกจับ (ตามเอกสาร) · รวม ≥ 60 กรณีตรวจสอบ"""
    caught = sum(not check(a).ok for _, a, _ in REJECT_CASES)
    limits = sum(check(a).ok for _, a in KNOWN_LIMITS)
    assert caught == len(REJECT_CASES)
    assert limits == len(KNOWN_LIMITS)
    assert len(REJECT_CASES) + len(KNOWN_LIMITS) + len(PASS_CASES) >= 60


# ---------------------------------------------------------------- ตัวช่วย normalize
def test_helpers_equivalences():
    assert numbers("๑๒,๕๐๐") == {"12500"}
    assert "12500" in numbers("หนึ่งหมื่นสองพันห้าร้อย")
    assert "12500" in numbers("twelve thousand five hundred baht")
    assert numbers("สามารถ เรียบร้อย ความสัมพันธ์ แสนสนุก") == set()
    assert contacts("0-0000-0000") == contacts("000000000") == {"phone:000000000"}
    assert contacts("+66 81 234 5678") == contacts("081-234-5678")
    assert dates("3 พ.ย.")[1] == dates("3 November")[1] == dates("3 พฤศจิกายน")[1] == {(3, 11)}
    assert dates("You may apply")[0] == set()                           # "may" ไม่ใช่เดือน
