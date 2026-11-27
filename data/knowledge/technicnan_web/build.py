"""จัดระเบียบข้อมูลที่ดึงจาก technicnan.ac.th (26 พ.ย. 2569) ให้เป็นข้อมูลพร้อมนำเข้า VORA

อินพุต : technicnan_crawl_20261126.json (ดึงผ่านเบราว์เซอร์), ไฟล์ความรู้เดิมของ VORA (CSV) สำหรับเทียบ
เอาต์พุต: kb_candidates_20261126.csv, news_candidates_20261126.csv, conflicts_20261126.csv
กติกา  : ไม่ใส่อีเมล/เบอร์ส่วนตัว ไม่ใส่รายชื่อนักเรียน ไม่เดาข้อมูล — ทุกแถวมี source_url
"""
from __future__ import annotations

import csv
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

CRAWL = Path(sys.argv[1])
OLD = [Path(p) for p in sys.argv[2].split(",")]
OUT = Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
d = json.loads(CRAWL.read_text(encoding="utf-8"))
BASE = "https://www.technicnan.ac.th/"

old = []
for f in OLD:
    for r in csv.DictReader(f.open(encoding="utf-8-sig")):
        r["_file"] = f.name
        old.append(r)
old_q = {r["question"].strip(): r for r in old}

TH_MONTH = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม",
            "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
TH_SHORT = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]


def thd(iso: str, short=True) -> str:
    y, m, dd = map(int, iso.split("-"))
    return f"{dd} {(TH_SHORT if short else TH_MONTH)[m]} {y + 543}"


kb: list[dict] = []
conflicts: list[dict] = []


def add(ref, category, question, answer, src, alts=(), note=""):
    q = question.strip()
    m = old_q.get(q)
    for a in alts:
        m = m or old_q.get(a)
    if m and re.sub(r"\s+", "", m["answer_th"]) == re.sub(r"\s+", "", answer):
        action = "SAME"
    elif m:
        action = "UPDATE"
    else:
        action = "NEW"
    kb.append(dict(ref=ref, action=action, category=category, question=q, alt_questions="|".join(alts),
                   answer_th=answer.strip(), answer_en="", source_url=src,
                   existing_question=(m or {}).get("question", ""), existing_file=(m or {}).get("_file", ""),
                   existing_answer=(m or {}).get("answer_th", ""), note=note))


def short(text: str, n: int) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= n:
        return text
    cut = text[:n]
    sp = max(cut.rfind(" "), cut.rfind(","))
    return (cut[:sp] if sp > n * 0.6 else cut).rstrip(" ,") + " ฯลฯ"


# ---------------------------------------------------------------- 1. จำนวนนักเรียน (IS_student.php ปีการศึกษา 2568)
page = {p["url"].split("/")[-1]: p for p in d["pages"]}
st = page["IS_student.php"]["text"].split("\n")
stats, level, dept = {}, None, None
for i, line in enumerate(st):
    if line.startswith("ระดับประกาศนียบัตรวิชาชีพชั้นสูง"):
        level = "ปวส."
    elif line.startswith("ระดับประกาศนียบัตรวิชาชีพ (ปวช.)"):
        level = "ปวช."
    elif line.startswith("ระดับปริญญาตรี"):
        level = None
    elif line.startswith("แผนกวิชา:") and level:
        dept = line.split(":", 1)[1].strip()
    elif level and dept and re.match(r"ประกาศนียบัตรวิชาชีพ.*\)\s*(\d)$", line) and i + 1 < len(st) and st[i + 1].isdigit():
        yr = re.search(r"(\d)$", line).group(1)
        stats.setdefault(dept, {}).setdefault(level, {})[yr] = int(st[i + 1])
sum_pvc = sum(sum(v.get("ปวช.", {}).values()) for v in stats.values())
sum_pvs = sum(sum(v.get("ปวส.", {}).values()) for v in stats.values())
site_tot = {k: int(re.search(r"\d+", st[st.index(k) + 1]).group()) for k in st if k.startswith("รวมยอด")}
SRC_STU = BASE + "IS_student.php"
assert sum_pvc == site_tot["รวมยอดนักศึกษาระดับ ปวช. :"], (sum_pvc, site_tot)
assert sum_pvs == site_tot["รวมยอดนักศึกษาระดับปวส."], (sum_pvs, site_tot)
total = sum_pvc + sum_pvs
assert total == site_tot["รวมยอดนักเรียนนักศึกษาทั้งสิ้น :"]
add("TN-STU-01", "general", "วิทยาลัยเทคนิคน่านมีนักเรียนกี่คน",
    f"ปีการศึกษา 2568 วิทยาลัยเทคนิคน่านมีนักเรียน นักศึกษารวม {total:,} คนค่ะ แบ่งเป็นระดับ ปวช. {sum_pvc:,} คน "
    f"และระดับ ปวส. {sum_pvs:,} คน (ตามหน้าข้อมูลนักเรียนนักศึกษาบนเว็บไซต์วิทยาลัย) ข้อมูลปีการศึกษา 2569 ยังไม่ได้ประกาศบนเว็บค่ะ",
    SRC_STU, ("มีนักเรียนกี่คน", "นักเรียนทั้งหมดกี่คน", "วิทยาลัยมีนักศึกษากี่คน"),
    note="เดิมตอบว่าไม่มีข้อมูล — ตัวเลขรวมตรวจด้วยการบวกทุกแผนกแล้ว ตรงกับยอดรวมบนเว็บ")

NAME = {"เทคโนโลยีสารสนเทศ / เทคโนโลยีธุรกิจดิจิทัล": "เทคโนโลยีสารสนเทศและเทคโนโลยีธุรกิจดิจิทัล (นับรวมกัน)",
        "การจัดการ": "การจัดการสำนักงาน", "แมคคาทรอนิกส์": "เมคคาทรอนิกส์และหุ่นยนต์", "ยานยนต์ไฟฟ้า": "เทคนิคยานยนต์ไฟฟ้า"}
tot = sorted(((sum(sum(x.values()) for x in v.values()), k) for k, v in stats.items()), reverse=True)
add("TN-STU-02", "general", "แผนกไหนมีนักเรียนมากที่สุด",
    "ปีการศึกษา 2568 แผนกที่มีนักเรียนมากที่สุด 5 อันดับคือ " +
    " ".join(f"{i + 1}) {NAME.get(k, k)} {n:,} คน" for i, (n, k) in enumerate(tot[:5])) +
    " ค่ะ (รวม ปวช. และ ปวส. ตามเว็บไซต์วิทยาลัย)", SRC_STU,
    ("แผนกไหนคนเยอะที่สุด", "สาขาไหนนักเรียนเยอะ", "แต่ละแผนกมีนักเรียนกี่คน"))
for n, k in tot:
    parts = []
    for lv in ("ปวช.", "ปวส."):
        if lv in stats[k]:
            yrs = stats[k][lv]
            parts.append(f"{lv} " + " ".join(f"ปี {y} {c} คน" for y, c in sorted(yrs.items())))
    nm = NAME.get(k, k)
    add(f"TN-STU-D-{len(kb):02d}", "program", f"แผนก{nm.split(' (')[0]}มีนักเรียนกี่คน",
        f"ปีการศึกษา 2568 แผนก{nm} มีนักเรียน นักศึกษารวม {n:,} คนค่ะ ได้แก่ " + " และ ".join(parts) +
        " (ตามเว็บไซต์วิทยาลัย ชั้นปีที่ไม่ได้ระบุคือไม่มีข้อมูลบนเว็บ)", SRC_STU)

# อัตราสำเร็จการศึกษา ปวช. รุ่นแรกเข้า 2565 จบ 2567
so = page["student_out.php"]["text"].split("\n")
i0 = so.index("ร้อยละของผู้สำเร็จการศึกษา") + 1
rows = []
while i0 + 3 < len(so) and not so[i0].startswith(">>"):
    rows.append((so[i0], int(so[i0 + 1]), int(so[i0 + 2]), float(so[i0 + 3])))
    i0 += 4
enr, grad = sum(r[1] for r in rows), sum(r[2] for r in rows)
for r in rows:
    assert abs(r[2] / r[1] * 100 - r[3]) < 0.01, r
add("TN-STU-03", "general", "นักเรียนเรียนจบกี่เปอร์เซ็นต์",
    f"ข้อมูลบนเว็บไซต์วิทยาลัย นักเรียน ปวช. ที่เข้าเรียนปีการศึกษา 2565 จำนวน {enr} คน สำเร็จการศึกษาในปี 2567 จำนวน {grad} คน "
    f"คิดเป็นร้อยละ {grad / enr * 100:.2f} ค่ะ แผนกที่จบครบตามกำหนดสูงสุดคือ " +
    ", ".join(f"{NAME.get(r[0], r[0])} ร้อยละ {r[3]:.2f}" for r in sorted(rows, key=lambda r: -r[3])[:3]) +
    " ส่วนระดับ ปวส. ยังไม่มีข้อมูลบนเว็บค่ะ", BASE + "student_out.php",
    ("อัตราการจบการศึกษาเท่าไหร่", "เรียนจบตามกำหนดกี่คน"))

# ---------------------------------------------------------------- 2. โครงสร้างฝ่ายและงาน (HR_detail.php)
FAI = {"ฝ่ายบริหารทรัพยากร": [5, 6, 8, 9, 10, 11, 52, 67],
       "ฝ่ายยุทธศาสตร์และแผนงาน": [25, 26, 28, 29, 58, 65],
       "ฝ่ายกิจการนักเรียน นักศึกษา": [18, 22, 23, 61, 63],
       "ฝ่ายวิชาการ": [14, 17, 24, 38, 53, 64]}
units = {u["id"]: u for u in d["units"]}
fai_of = {i: f for f, ids in FAI.items() for i in ids}
add("TN-ORG-01", "general", "วิทยาลัยมีฝ่ายอะไรบ้าง",
    "วิทยาลัยเทคนิคน่านแบ่งการบริหารเป็น 4 ฝ่ายค่ะ ได้แก่ " + ", ".join(FAI) +
    " แต่ละฝ่ายมีงานย่อยหลายงาน ถามชื่อฝ่ายที่สนใจได้เลยค่ะ (ตามเว็บไซต์วิทยาลัย)",
    BASE + "main_index.php", ("โครงสร้างวิทยาลัยเป็นอย่างไร", "วิทยาลัยแบ่งเป็นกี่ฝ่าย", "มีหน่วยงานอะไรบ้าง"))
for k, (f, ids) in enumerate(FAI.items()):
    add(f"TN-ORG-F{k + 1}", "general", f"{f}มีงานอะไรบ้าง",
        f"{f} ของวิทยาลัยเทคนิคน่าน มีงาน" + ", ".join(units[i]["name"].removeprefix("งาน") for i in ids) + " ค่ะ (ตามเว็บไซต์วิทยาลัย)",
        BASE + "main_index.php", (f"{f}ดูแลอะไร", f"{f}ทำอะไร"))


def head_of(u):
    hs = [h for h in u["heads"] if h["position"].startswith("หัวหน้า")]
    return hs[0] if hs else None


for uid, f in fai_of.items():
    u = units[uid]
    duties = [x for x in u["duties"] if not x.startswith("(")]
    h = head_of(u)
    ans = f"{u['name']} อยู่ใน{f} ทำหน้าที่ เช่น {short(' '.join(duties[:2]), 260)}"
    ans += f" หัวหน้างานคือ {h['name']} ค่ะ" if h else " ค่ะ"
    nm = u["name"].removeprefix("งาน")
    add(f"TN-UNIT-{uid:02d}", "general", f"{u['name']}ทำหน้าที่อะไร", ans, u["url"],
        (f"{u['name']}ทำอะไร", f"ติดต่อ{u['name']}เรื่องอะไรได้บ้าง", f"ใครเป็นหัวหน้า{u['name']}", f"งาน{nm}คืออะไร"))

# ---------------------------------------------------------------- 3. หัวหน้าแผนกวิชา + จำนวนครู
for u in d["units"]:
    if not u["name"].startswith("แผนกวิชา"):
        continue
    h = head_of(u)
    nm = u["name"].removeprefix("แผนกวิชา")
    if not h:
        conflicts.append(dict(topic=f"หัวหน้า{u['name']}", website=u["url"], vora="", issue="หน้าแผนกบนเว็บไม่ระบุหัวหน้าแผนก", action="ASK"))
        continue
    continue  # 26 พ.ย.: ฐานข้อมูลจริงมีหัวหน้าแผนกครบ 18 แผนกแล้ว (6 แผนกเจ้าหน้าที่เลือกชื่อจากตารางเรียน 2/2569 ในกล่องตรวจข้อมูล) — ไม่นำเข้าซ้ำ
    add(f"TN-HEAD-{u['id']:02d}", "program", f"ใครเป็นหัวหน้าแผนก{nm}",
        f"หัวหน้าแผนกวิชา{nm} คือ {h['name']} ค่ะ ปัจจุบันแผนกมีครูและบุคลากรตามเว็บไซต์วิทยาลัย {u['staff_count']} คน",
        u["url"], (f"หัวหน้าแผนก{nm}ชื่ออะไร", f"แผนก{nm}มีครูกี่คน"))

# ---------------------------------------------------------------- 4. ข้อมูลจากข่าว/กิจกรรมปีการศึกษา 2569
A = {a["id_pic"]: a for a in d["activities"]}
N = {n["view"]: n for n in d["news"]}
PIC = BASE + "detail_pic.php?id_pic="
NEWS = BASE + "main_index.php?view="
add("TN-EVT-01", "general", "วิทยาลัยเทคนิคน่านก่อตั้งมากี่ปีแล้ว",
    "ปี 2569 วิทยาลัยเทคนิคน่านครบรอบ 88 ปีค่ะ จัดงานวันสถาปนาเมื่อ 8 สิงหาคม 2569 มีพิธีทำบุญตักบาตร ทอดผ้าป่าสามัคคี "
    "และมูลนิธิวิทยาลัยเทคนิคน่าน 27 มอบทุนการศึกษา 7 ทุน ทุนละ 2,000 บาท", PIC + "373",
    ("วิทยาลัยอายุกี่ปี", "วันสถาปนาวิทยาลัยคือวันไหน", "ครบรอบกี่ปี"))
add("TN-EVT-02", "admission", "เปิดภาคเรียนที่ 1 ปีการศึกษา 2569 เมื่อไหร่",
    "วิทยาลัยเทคนิคน่านเปิดภาคเรียนที่ 1 ปีการศึกษา 2569 อย่างเป็นทางการเมื่อวันจันทร์ที่ 18 พฤษภาคม 2569 ค่ะ "
    "ก่อนหน้านั้นจัดปฐมนิเทศนักเรียนใหม่ ปวช. วันที่ 7 พฤษภาคม และ ปวส. วันที่ 8 พฤษภาคม 2569 ที่หอประชุมวิษณุรักษ์",
    PIC + "362", ("เปิดเทอมวันไหน", "ปฐมนิเทศวันไหน", "เปิดเรียนวันไหน"))
add("TN-EVT-03", "activity", "อวท. คืออะไร",
    "อวท. คือองค์การนักวิชาชีพในอนาคตแห่งประเทศไทย เป็นองค์การของนักเรียน นักศึกษาอาชีวศึกษา ที่วิทยาลัยเทคนิคน่านค่ะ "
    "ปีการศึกษา 2569 จัดปฐมนิเทศสมาชิกใหม่ ปวช.1 และ ปวส.1 เมื่อ 20 พฤษภาคม 2569 และจัดงานประชุมวิชาการ อวท. "
    "พร้อมแข่งขันทักษะวิชาชีพระดับจังหวัดน่าน (ข่าว 17 พ.ย. 2569)", PIC + "363",
    ("องค์การนักวิชาชีพในอนาคตแห่งประเทศไทยคืออะไร", "อวท ทำอะไร"))
add("TN-EVT-04", "activity", "Fix it Center คืออะไร",
    "Fix it Center หรือศูนย์ซ่อมสร้างเพื่อชุมชน เป็นภารกิจที่วิทยาลัยเทคนิคน่านให้บริการซ่อมแซมและช่วยเหลือประชาชนค่ะ "
    "เช่น เดือนกันยายน 2569 ได้รับเงินสนับสนุน 30,000 บาทจากบริษัท ฮีโน่มอเตอร์ส เพื่อช่วยผู้ประสบอุทกภัยในจังหวัดน่าน "
    "และ 25 พฤศจิกายน 2569 ร่วมกับ อบจ.น่าน ให้บริการเปลี่ยนถ่ายน้ำมันเครื่องและซ่อมรถจักรยานยนต์ที่ที่ว่าการอำเภอเมืองน่าน",
    PIC + "389", ("ศูนย์ซ่อมสร้างเพื่อชุมชนคืออะไร", "วิทยาลัยช่วยซ่อมของให้ชาวบ้านไหม", "บริการชุมชนมีอะไรบ้าง"))
add("TN-EVT-05", "activity", "ศูนย์บ่มเพาะผู้ประกอบการของวิทยาลัยทำอะไร",
    "วิทยาลัยเทคนิคน่านมีศูนย์บ่มเพาะผู้ประกอบการอาชีวศึกษา ดูแลโดยงานส่งเสริมธุรกิจและการเป็นผู้ประกอบการค่ะ "
    "เดือนสิงหาคม 2569 นำโมเดลธุรกิจ \"วู๊ดคอนน่าน\" ของนักศึกษาแผนกช่างก่อสร้างร่วมกับแผนกการตลาด เข้ารับการประเมินระดับภาคเหนือ "
    "และจัดโครงการเขียนและประกวดแผนธุรกิจด้านการตลาดดิจิทัล", PIC + "375",
    ("วู๊ดคอนน่านคืออะไร", "อยากทำธุรกิจระหว่างเรียนได้ไหม", "ศูนย์บ่มเพาะคืออะไร"))
add("TN-EVT-06", "activity", "แผนกอาหารและโภชนาการมีกิจกรรมอะไรบ้าง",
    "เช่น วันที่ 5 สิงหาคม 2569 แผนกวิชาอาหารและโภชนาการร่วมกับแผนกการจัดการสำนักงาน จัดโครงการ \"กาดหมั้วคัวฮอม\" "
    "พร้อมประกวดอาหารคาว-หวานและแข่งทำอาหารจานด่วน ให้นักเรียนได้ฝึกทักษะวิชาชีพจริงค่ะ", PIC + "372",
    ("กาดหมั้วคัวฮอมคืออะไร",))
add("TN-EVT-07", "general", "วิทยาลัยมีหอประชุมหรือห้องประชุมอะไรบ้าง",
    "จากข่าวของวิทยาลัย มีหอประชุมวิษณุรักษ์ (ใช้จัดปฐมนิเทศ) ห้องประชุมภูมินทร์และห้องสมาร์ทคลาสรูม (ชั้น 2) ที่อาคารวิทยบริการ "
    "และห้องโสตทัศนศึกษาที่อาคารอำนวยการ ชั้น 3 ค่ะ ส่วนตำแหน่งอาคารบนผังวิทยาลัยหนูยังไม่มีข้อมูล สอบถามเจ้าหน้าที่ได้เลยค่ะ",
    PIC + "359", ("หอประชุมชื่ออะไร", "ห้องประชุมอยู่ไหน"),
    note="ชื่อห้องรวบรวมจากข่าว 359, 389, 404, 605 — ข่าว 373 เขียน 'หอประชุมรักษ์' (น่าจะพิมพ์ตก) ตำแหน่งยังต้องขอจากทีม")
add("TN-EVT-08", "scholarship", "มีทุนการศึกษาจากวิทยาลัยเองไหม",
    "มีค่ะ ปีการศึกษา 2569 เช่น ทุนวันไหว้ครู (ประกาศรายชื่อผู้ได้รับ 17 มิ.ย. 2569) ทุนจากมูลนิธิวิทยาลัยเทคนิคน่าน 27 "
    "มอบในวันสถาปนา 7 ทุน ทุนละ 2,000 บาท และทุนมูลนิธิทุนศึกษาสร้างฝัน (CYF) สำหรับนักเรียนเรียนดีแต่ขาดแคลนทุนทรัพย์ "
    "รอบใหม่สอบถามงานสวัสดิการนักเรียน นักศึกษา หรืองานแนะแนวได้ค่ะ", NEWS + "598",
    ("ทุนวันไหว้ครูคืออะไร", "มูลนิธิวิทยาลัยให้ทุนไหม"))

# ---------------------------------------------------------------- 5. บริการออนไลน์และลิงก์ (ไม่มีข้อมูลส่วนบุคคล — เป็นลิงก์ไปยังระบบที่ต้องล็อกอินเอง)
LINKS = [
    ("TN-SVC-01", "ตรวจผลการเรียนได้ที่ไหน", ("ดูเกรดได้ที่ไหน", "เช็คผลการเรียน", "ระบบ RMS คืออะไร"),
     "ตรวจผลการเรียนได้ที่ระบบบริหารจัดการสถานศึกษา RMS ของวิทยาลัยค่ะ เข้าจากเมนู \"ตรวจสอบผลการเรียน\" บนเว็บไซต์ www.technicnan.ac.th "
     "แล้วล็อกอินด้วยบัญชีนักเรียนของตัวเอง ถ้าเข้าไม่ได้ติดต่องานทะเบียนค่ะ", BASE + "main_index.php"),
    ("TN-SVC-02", "ดูตารางเรียนได้ที่ไหน", ("ตารางเรียนเทอมนี้", "ตารางสอนครูดูที่ไหน"),
     "ดูตารางเรียนได้ที่เว็บไซต์วิทยาลัย เมนู บริการสารสนเทศ > สำหรับนักเรียน-นักศึกษา > ตารางเรียน (มีภาคเรียนที่ 1, 2 และภาคฤดูร้อน) "
     "ส่วนตารางสอนของครูอยู่ในเมนูสำหรับครู-บุคลากรค่ะ", BASE + "ST_table.php?type_stu=2"),
    ("TN-SVC-03", "แบบฟอร์มสำหรับนักศึกษาดาวน์โหลดที่ไหน", ("ขอแบบฟอร์ม", "ใบลา ดาวน์โหลดที่ไหน", "แบบฟอร์มคำร้อง"),
     "ดาวน์โหลดแบบฟอร์มสำหรับนักเรียน นักศึกษาได้ที่เว็บไซต์วิทยาลัย เมนู บริการสารสนเทศ > แบบฟอร์มสำหรับนักศึกษา "
     "(www.technicnan.ac.th/ST_form.php) ค่ะ", BASE + "ST_form.php"),
    ("TN-SVC-04", "ระบบ ศธ.02 ออนไลน์เข้าอย่างไร", ("ขอใบ รบ ออนไลน์", "ศธ.02 เข้าไม่ได้", "Thai-ID ศธ.02"),
     "ตั้งแต่สิงหาคม 2569 ระบบ ศธ.02 ออนไลน์ต้องยืนยันตัวตนด้วยแอปพลิเคชัน Thai-ID ค่ะ ขั้นตอนอยู่ในประกาศของงานทะเบียน "
     "ถ้ายังเข้าไม่ได้ ติดต่อห้องงานทะเบียน หรืองานศูนย์ดิจิทัลและสื่อสารองค์กรของวิทยาลัยค่ะ", NEWS + "604"),
    ("TN-SVC-05", "ร้องเรียนวิทยาลัยได้ที่ไหน", ("ช่องทางร้องเรียน", "อยากแจ้งปัญหา", "ส่งข้อเสนอแนะ"),
     "ร้องเรียนหรือแจ้งปัญหาได้ที่เมนู \"ช่องทางการร้องเรียน\" บนเว็บไซต์วิทยาลัย (www.technicnan.ac.th/appeal.php) "
     "หรือตั้งคำถามที่เมนู \"ถาม-ตอบ / ข้อเสนอแนะ\" ค่ะ", BASE + "appeal.php"),
    ("TN-SVC-06", "วิทยาลัยมีเฟซบุ๊กอะไรบ้าง", ("เพจวิทยาลัย", "facebook วิทยาลัยเทคนิคน่าน", "ติดตามข่าวทางไหน"),
     "เพจเฟซบุ๊กของวิทยาลัยเทคนิคน่านที่ลิงก์จากเว็บไซต์ ได้แก่ เพจวิทยาลัยเทคนิคน่าน, Information Of Nan Technical College, "
     "ศูนย์ข้อมูลและสารสนเทศ, งานทะเบียน, งานแนะแนว, งานศูนย์บ่มเพาะผู้ประกอบการ และชมรมเด็กช่างภาพ R-Radio ค่ะ "
     "ข่าวรับสมัครติดตามที่เพจงานทะเบียนหรืองานแนะแนวได้", BASE + "main_index.php"),
    ("TN-SVC-07", "วารสารวิทยาลัยอ่านได้ที่ไหน", ("วารสารวิทยาลัยเทคนิคน่าน",),
     "อ่านวารสารวิทยาลัยเทคนิคน่าน (ฉบับรายสัปดาห์) ได้ที่เว็บไซต์ www.technicnan.ac.th/total_magazine.php ค่ะ", BASE + "total_magazine.php"),
    ("TN-SVC-08", "ผลงานวิจัยของครูดูได้ที่ไหน", ("ผลงานวิชาการ", "งานวิจัยวิทยาลัย"),
     "ผลงานวิชาการและผลงานวิจัยของครูอยู่ที่เว็บไซต์วิทยาลัย หน้า \"ผลงานวิชาการหรือผลงานวิจัย\" (www.technicnan.ac.th/total_doc.php) "
     "เช่น งานวิจัย RBL สื่อการสอนออนไลน์ และแผนการจัดการเรียนรู้ค่ะ", BASE + "total_doc.php"),
    ("TN-SVC-09", "รายงานการประเมินตนเอง SAR ดูได้ที่ไหน", ("SAR วิทยาลัย", "ประกันคุณภาพ", "ITA วิทยาลัย"),
     "รายงานการประเมินตนเอง (SAR) ปี 2564–2568 และข้อมูลสาธารณะ ITA อยู่ในเมนู \"ประกันคุณภาพสถานศึกษา\" และ \"ITA/ข้อมูลสาธารณะ\" "
     "บนเว็บไซต์ www.technicnan.ac.th ค่ะ", BASE + "ITA.php"),
    ("TN-SVC-10", "ระเบียบการแต่งกายของนักเรียนเป็นอย่างไร", ("ชุดนักเรียน", "แต่งกายอย่างไร", "ทรงผม"),
     "วิทยาลัยมีหน้า \"การแต่งกายตามระเบียบ\" เป็นภาพประกอบบนเว็บไซต์ (www.technicnan.ac.th/IS_his5.php) ค่ะ "
     "หนูยังอ่านรายละเอียดจากภาพไม่ได้ สอบถามงานปกครองและงานปลอดภัยนักเรียนนักศึกษาได้ค่ะ", BASE + "IS_his5.php"),
    ("TN-SVC-11", "แผนกเมคคาทรอนิกส์มีเว็บไซต์ไหม", ("เว็บไซต์แผนกหุ่นยนต์",),
     "มีค่ะ เว็บไซต์แผนกเมคคาทรอนิกส์และหุ่นยนต์อยู่ที่ sites.google.com/view/nanrobot ค่ะ", BASE + "main_index.php"),
    ("TN-SVC-12", "ประกาศจัดซื้อจัดจ้างดูได้ที่ไหน", ("ประกวดราคา", "แผนจัดซื้อจัดจ้าง"),
     "ประกาศจัดซื้อจัดจ้างและประกวดราคาของวิทยาลัยอยู่ที่ www.technicnan.ac.th/total_new.php?type_d=5 ค่ะ "
     "ล่าสุดเป็นประกวดราคาชุดฝึกปฏิบัติงานสาขาช่างกลโรงงานและเทคนิคการผลิต (25 พ.ย. 2569)", BASE + "total_new.php?type_d=5"),
]
for ref, q, alts, a, src in LINKS:
    cat = "contact" if ref in ("TN-SVC-05", "TN-SVC-06") else "general"
    add(ref, cat, q, a, src, alts)

jobs = [n for n in d["news"] if re.search(r"ลูกจ้างชั่วคราว|พนักงานราชการ", n["title"]) and re.search(r"รับสมัคร", n["title"])]
assert jobs[0]["view"] == 619 and jobs[1]["view"] == 612, [j["view"] for j in jobs]
add("TN-JOB-01", "general", "วิทยาลัยรับสมัครงานไหม",
    "วิทยาลัยประกาศรับสมัครบุคคลเป็นระยะทางเว็บไซต์ค่ะ ล่าสุดคือรับสมัครลูกจ้างชั่วคราวรายเดือน ตำแหน่งนักการภารโรง 2 อัตรา (ประกาศ 12 พ.ย. 2569) "
    "ก่อนหน้านั้นมีตำแหน่งเจ้าหน้าที่การเงิน (30 ต.ค. 2569) ซึ่งประกาศรายชื่อผู้ผ่านการคัดเลือกแล้ว ประกาศอาจปิดรับแล้ว "
    "ดูประกาศล่าสุดที่ www.technicnan.ac.th/total_new.php?type_d=1 ค่ะ",
    BASE + "total_new.php?type_d=1", ("รับสมัครครูไหม", "สมัครงานที่วิทยาลัย", "มีตำแหน่งงานว่างไหม"))

# ข่าวล่าสุด (แทนคำตอบเดิมเมื่อ 23 พ.ย.)
latest = sorted(d["activities"], key=lambda a: (a["list_date"], a["id_pic"]), reverse=True)[:5]
EVENT_DAY = {405: "25 พ.ย.", 404: "21 พ.ย.", 403: "21 พ.ย.", 402: "17 พ.ย.", 401: "3 พ.ย."}
items = {405: "ร่วมกับ อบจ.น่าน ซ่อมรถจักรยานยนต์ให้ประชาชน",
         404: "ประชุมชี้แจงทุนนวัตกรรมสายอาชีพชั้นสูง ปี 2570",
         403: "อบรมเผยแพร่งานประกันสังคม รุ่นที่ 10",
         402: "ประชุมวิชาการ อวท. และแข่งขันทักษะระดับจังหวัด",
         401: "มูลนิธิ CYF มอบทุนให้นักเรียน"}
assert [a["id_pic"] for a in latest] == [405, 404, 403, 402, 401], [a["id_pic"] for a in latest]
latest_ans = ("ข่าวจากเว็บไซต์วิทยาลัยช่วงเดือนพฤศจิกายน 2569 ค่ะ " +
              " ".join(f"{k + 1}) {EVENT_DAY[a['id_pic']]} {items[a['id_pic']]}" for k, a in enumerate(latest)) +
              " และเปิดรับสมัครรอบโควตา ปีการศึกษา 2570 ถึง 11 ธันวาคม 2569 ค่ะ")
add("TN-NEWS-01", "news", "ข่าวล่าสุดของวิทยาลัยมีอะไรบ้าง", latest_ans, BASE + "total_pic.php",
    note="เพิ่มข่าว 25 พ.ย. (id_pic 405) ที่คำตอบเดิมยังไม่มี · คงประโยครับสมัครโควตาจากแหล่งเดิม (ไม่อยู่ในหน้าที่ดึงรอบนี้)")
add("TN-NEWS-02", "news", "วิทยาลัยมีข่าวอะไรบ้าง", latest_ans, BASE + "total_pic.php", note="คำตอบเดียวกับ TN-NEWS-01")

# ---------------------------------------------------------------- 6. ตรวจข้อขัดแย้งกับคำตอบเดิม
DEP = {}
for kind in ("activities", "news"):
    for a in d[kind]:
        for m in re.finditer(r"(นาย|นางสาว|นาง)\s?([ก-๙]+\s[ก-๙]+)\s+รองผู้อำนวยการ(ฝ่าย[ก-๙ ]+?)(?=\s(?:เป็น|พร้อม|นำ|คณะ)|$)", a["text"]):
            DEP.setdefault(m.group(1) + m.group(2), set()).add((m.group(3).strip(), a["list_date"], a.get("id_pic") or a.get("view")))
director_page = page["IS_director.php"]["text"]
for person, roles in sorted(DEP.items()):
    rs = sorted(roles, key=lambda r: r[1])
    names = {r[0].replace("พัฒนากิจการ", "กิจการ").split(" นัก")[0] for r in rs}
    on_page = re.search(re.escape(person) + r"รองผู้อำนวยการ(ฝ่าย[^:]+)", director_page)
    page_role = on_page.group(1).strip() if on_page else ""
    if len(names) > 1 or (page_role and not any(page_role.startswith(n[:10]) for n in names)):
        conflicts.append(dict(topic=f"ตำแหน่งรองผู้อำนวยการ: {person}",
                              website=f"หน้าคณะผู้บริหาร: {page_role or '-'} | ข่าว: " + "; ".join(f"{r[0]} ({thd(r[1])}, #{r[2]})" for r in rs),
                              vora="คำตอบ 'รองผู้อำนวยการมีใครบ้าง' ใช้ตามหน้าคณะผู้บริหาร",
                              issue="ฝ่ายที่รับผิดชอบไม่ตรงกันระหว่างหน้าคณะผู้บริหารกับข่าวปี 2569",
                              action="ASK — ขอทีมยืนยันกับวิทยาลัยก่อนแก้ ยังไม่แก้คำตอบเดิม"))

conflicts.append(dict(topic="ชื่อแผนกการจัดการสำนักงาน", website="เมนูเว็บ: แผนกวิชาการจัดการสำนักงาน | ข่าว 372: แผนกวิชาการจัดการสำนักงานดิจิทัล | หน้าสถิติ: การจัดการ",
                      vora="สาขาใน VORA ใช้ชื่อ 'การจัดการสำนักงาน'", issue="ชื่อแผนกบนเว็บใช้ไม่ตรงกัน 3 แบบ", action="ASK — ยังคงชื่อเดิม"))
conflicts.append(dict(topic="ไฟล์ PDF ข้อมูลพื้นฐาน", website="ประวัติ วิสัยทัศน์/พันธกิจ คำขวัญ ข้อมูลพื้นฐาน เป็นไฟล์ PDF/ภาพ (IS_his*.php, IS_history.php, IS_struc.php, IS_his3.php เพลง, IS_his5.php การแต่งกาย)",
                      vora="ประวัติ คำขวัญ ปรัชญา มีอยู่แล้ว (kb_import 23 พ.ย.)", issue="รอบนี้อ่านข้อความใน PDF/ภาพไม่ได้ จึงตรวจได้เฉพาะหน้า PDF ประวัติที่เปิดดูด้วยตา: ตรงกับคำตอบเดิม (โรงเรียนช่างไม้น่าน 2481 → วิทยาลัยเทคนิคน่าน 2523)",
                      action="วิสัยทัศน์ พันธกิจ เพลงประจำวิทยาลัย แผนภูมิการบริหาร ยังไม่มีใน VORA — ขอไฟล์ข้อความจากทีม หรืออนุญาตให้อ่าน PDF ทีละหน้า"))

# ---------------------------------------------------------------- 7. ข่าวและกิจกรรม -> ตาราง news ของ VORA
def body_of(text: str, title: str) -> str:
    lines = [l for l in text.split("\n") if l.strip()]
    lines = [l for l in lines if not re.match(r"^(»\s*)?" + re.escape(title[:30]), l)]
    out = []
    for l in lines:
        l = re.sub(r"^รายละเอียด\s*:\s*", "", l).strip()
        if not l or re.match(r"^(วันที่\s*:|เอกสารที่เกี่ยวข้อง|\[ แสดงเอกสาร \]|ตามลิงค์ นี้)", l):
            continue
        out.append(l)
    return "\n".join(out)


TH_MON = {m: i for i, m in enumerate(TH_MONTH) if m}


def event_date(text: str, fallback: str) -> str:
    m = re.search(r"(\d{1,2})\s*(" + "|".join(TH_MON) + r")\s*(?:พ\.ศ\.\s*)?(25\d\d)", text)
    if m:
        return f"{int(m.group(3)) - 543}-{TH_MON[m.group(2)]:02d}-{int(m.group(1)):02d}"
    return fallback


STUDENT_KW = r"ปฐมนิเทศ|เปิดภาคเรียน|หยุด.*การเรียน|ทุน|แข่งขัน|อวท|ต้านทุจริต|ศธ\.02|นักเรียน|นักศึกษา|ผู้เรียน"
news_rows = []
for n in d["news"]:
    t = n["title"]
    kind = "news"
    if n["src_type"] == 5:
        group, prio = "จัดซื้อจัดจ้าง", 1
    elif re.search(r"ลูกจ้าง|พนักงานราชการ|ผู้มีสิทธิ์|ผู้ผ่านการ", t):
        group, prio = "รับสมัครงาน/ประกาศผลคัดเลือกบุคลากร", 1
    elif re.search(STUDENT_KW, t):
        group, prio = "ประกาศสำหรับนักเรียน", 4
    else:
        group, prio = "ข่าวทั่วไป", 2
    body = body_of(n["text"], t)
    if n["attachments"]:
        body += "\nเอกสารแนบ: " + " ".join(n["attachments"])
    body += f"\nที่มา: {n['url']}"
    exp = (date.fromisoformat(n["list_date"]) + timedelta(days=30)).isoformat() if prio == 1 else ""
    news_rows.append(dict(ref=f"TN-N{n['view']}", kind=kind, group=group, title_th=t, body_th=body,
                          image_url="", gallery="", priority=prio, status="pending",
                          publish_at=n["list_date"], event_date=event_date(n["text"], n["list_date"]), expire_at=exp,
                          source_url=n["url"]))
for a in d["activities"]:
    t = a["title"].strip('"“” ')
    if re.search(r"พวงมาลา|ถวาย|พระราช|ราชสดุดี|เทียนพรรษา|น้อมรำลึก|จุดเทียน", t):
        group, prio = "พิธีการ/วันสำคัญ", 2
    elif re.search(STUDENT_KW + r"|ประกวด|โครงการ|อบรม", t):
        group, prio = "กิจกรรมนักเรียน/โครงการ", 3
    else:
        group, prio = "กิจกรรมวิทยาลัย", 2
    imgs = [u for u in a["images"] if re.search(r"\.(jpe?g|png|webp)$", u, re.I)]
    large = [u for u in imgs if "/images_large/" in u]
    imgs = large or imgs
    news_rows.append(dict(ref=f"TN-A{a['id_pic']}", kind="activity", group=group, title_th=t,
                          body_th=body_of(a["text"], t) + f"\nที่มา: {a['url']}",
                          image_url=imgs[0] if imgs else "", gallery="\n".join(imgs[1:8]), priority=prio, status="pending",
                          publish_at=a["list_date"], event_date=event_date(a["text"], a["list_date"]), expire_at="",
                          source_url=a["url"]))

# ข่าว 605 กับกิจกรรม 385 เป็นเรื่องเดียวกัน -> เก็บกิจกรรม (มีรูป) ตัดข่าวซ้ำ
dup_pairs = []
by_title = {}
for r in news_rows:
    key = re.sub(r"[\s\"“”()]", "", r["title_th"])
    if key in by_title:
        keep, drop = (by_title[key], r) if by_title[key]["kind"] == "activity" else (r, by_title[key])
        drop["status"] = "skip-duplicate"
        drop["group"] += f" (ซ้ำกับ {keep['ref']})"
        dup_pairs.append((keep["ref"], drop["ref"]))
    else:
        by_title[key] = r

# ---------------------------------------------------------------- เขียนไฟล์
def write(name, rows, cols):
    with (OUT / name).open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)


write("kb_candidates_20261126.csv", kb, ["ref", "action", "category", "question", "alt_questions", "answer_th", "answer_en",
                                         "source_url", "existing_question", "existing_file", "existing_answer", "note"])
write("news_candidates_20261126.csv", news_rows, ["ref", "kind", "group", "title_th", "body_th", "image_url", "gallery", "priority",
                                                  "status", "publish_at", "event_date", "expire_at", "source_url"])
write("conflicts_20261126.csv", conflicts, ["topic", "website", "vora", "issue", "action"])

from collections import Counter
print("KB:", len(kb), Counter(k["action"] for k in kb), Counter(k["category"] for k in kb))
print("NEWS:", len(news_rows), Counter((r["kind"], r["group"]) for r in news_rows), "dups", dup_pairs)
print("CONFLICTS:", len(conflicts))
print("students", total, sum_pvc, sum_pvs, "grad", enr, grad)
print("max answer len", max(len(k["answer_th"]) for k in kb), [k["ref"] for k in kb if len(k["answer_th"]) > 420])
