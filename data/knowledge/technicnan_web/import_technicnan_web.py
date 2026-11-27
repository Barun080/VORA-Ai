"""นำข้อมูลจากเว็บไซต์วิทยาลัยเทคนิคน่าน (ดึงเมื่อ 26 พ.ย. 2569) เข้า VORA แบบ "รออนุมัติ"

    python data\\knowledge\\technicnan_web\\import_technicnan_web.py              # ตรวจอย่างเดียว (ค่าเริ่มต้น ไม่แก้ฐานข้อมูล)
    python data\\knowledge\\technicnan_web\\import_technicnan_web.py --apply      # ใส่จริง (ไฟล์ .bat สำรองฐานข้อมูลให้ก่อน)
    python data\\knowledge\\technicnan_web\\import_technicnan_web.py --finish     # หลังเจ้าหน้าที่อนุมัติ: ปิดคำตอบเดิมที่ถูกแทนแล้ว
    python data\\knowledge\\technicnan_web\\import_technicnan_web.py --undo FILE  # ย้อนกลับ (ลบเฉพาะรายการที่ยังรออนุมัติ)

ตรวจอย่างเดียว: อ่านฐานข้อมูลจริง เทียบกับไฟล์ที่เตรียมไว้ แล้วเขียน check_live_<เวลา>.csv ในโฟลเดอร์นี้ — ไม่แก้ฐานข้อมูล
--apply:
  * ความรู้ (kb_candidates_20261126.csv) → "กล่องตรวจข้อมูล" (หลังบ้าน → ปัญญาประดิษฐ์ → กล่องตรวจข้อมูล) สถานะรอตรวจ
    ยังไม่ถูกใช้ตอบจนกว่าผู้ดูแลจะกด "อนุมัตินำเข้า" · ข้อที่ฐานข้อมูลมีคำตอบเหมือนเดิมอยู่แล้วจะข้าม
  * ข่าว/กิจกรรม (news_candidates_20261126.csv) → ตารางข่าว สถานะ "รออนุมัติ" (หลังบ้าน → ข่าว → แท็บรออนุมัติ → ปุ่มอนุมัติ)
    ข้ามข่าวที่มีชื่อเดียวกันอยู่แล้ว และแถวที่ทำเครื่องหมายว่าซ้ำ
  * ไม่แก้ ไม่ลบ ข้อมูลเดิมใด ๆ · บันทึก id ที่เพิ่มไว้ใน undo_<เวลา>.json
--finish: ข้อที่เป็น "แทนคำตอบเดิม" และเจ้าหน้าที่อนุมัติแล้ว → เปลี่ยนความรู้เดิมข้อนั้นเป็น "ไม่อนุมัติ" (บันทึก audit, แก้กลับได้ในหลังบ้าน)
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "backend"))
OUT = Path(os.environ.get("TN_OUT_DIR", str(HERE)))
BATCH = "technicnan-web-20261126"
KB_FILE = HERE / "kb_candidates_20261126.csv"
NEWS_FILE = HERE / "news_candidates_20261126.csv"
DEPTS = ["การตลาด", "การจัดการสำนักงาน", "การบัญชี", "เทคโนโลยีสารสนเทศ", "สามัญสัมพันธ์", "ช่างไฟฟ้ากำลัง", "ช่างกลโรงงาน",
         "ช่างเชื่อมโลหะ", "ช่างอิเล็กทรอนิกส์", "ช่างยนต์", "ช่างก่อสร้าง", "เทคโนโลยีคอมพิวเตอร์", "เมคคาทรอนิกส์และหุ่นยนต์",
         "เทคนิคพื้นฐาน", "อาหารและโภชนาการ", "เทคนิคยานยนต์ไฟฟ้า", "เทคโนโลยีธุรกิจดิจิทัล", "เทคนิคอุตสาหกรรม"]


def norm(s: str) -> str:
    return re.sub(r"[\s\"“”'()?？ค่ะครับนะ]+", "", s or "")


def read(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def kb_index(db, KnowledgeItem):
    idx = {}
    for k in db.query(KnowledgeItem).all():
        for q in [k.question] + (k.alt_questions or "").replace("|", "\n").split("\n"):
            if q.strip():
                idx.setdefault(norm(q), []).append(k)
    return idx


def compare(db, models) -> tuple[list[dict], list[dict], list[dict]]:
    KnowledgeItem, News, Program, KnowledgeCandidate = models
    idx = kb_index(db, KnowledgeItem)
    have_cand = {r for (r,) in db.query(KnowledgeCandidate.ref).filter(KnowledgeCandidate.batch == BATCH).all()}
    kb_rows = []
    for c in read(KB_FILE):
        hits = []
        for q in [c["question"]] + [x for x in c["alt_questions"].split("|") if x]:
            hits += idx.get(norm(q), [])
        hits = list({h.id: h for h in hits}.values())
        live = [h for h in hits if h.status == "approved"] or hits
        if c["ref"] in have_cand:
            state = "ALREADY_IN_SANDBOX"
        elif not live:
            state = "NEW"
        elif any(norm(h.answer_th) == norm(c["answer_th"]) for h in live):
            state = "SAME"
        else:
            state = "UPDATE"
        kb_rows.append(dict(ref=c["ref"], live_state=state, file_state=c["action"], question=c["question"],
                            live_ids=" ".join(str(h.id) for h in live), live_status=" ".join(h.status for h in live),
                            live_answer=(live[0].answer_th if live else "")[:500], proposed_answer=c["answer_th"]))
    titles = {norm(n.title_th): n for n in db.query(News).all()}
    news_rows = []
    for n in read(NEWS_FILE):
        old = titles.get(norm(n["title_th"]))
        state = "SKIP_DUP_IN_FILE" if n["status"] != "pending" else ("EXISTS" if old else "NEW")
        news_rows.append(dict(ref=n["ref"], live_state=state, title=n["title_th"][:120], group=n["group"],
                              live_id=old.id if old else "", live_status=old.status if old else ""))
    progs = db.query(Program).all()
    prog_rows = []
    pnames = {}
    for p in sorted(progs, key=lambda p: p.status == "published"):   # ชื่อซ้ำ: ให้สาขาที่เผยแพร่อยู่ชนะ
        pnames[norm(p.name_th.removeprefix("แผนก").removeprefix("วิชา"))] = p
    for dname in DEPTS:
        p = pnames.get(norm(dname))
        prog_rows.append(dict(website_department=dname, vora_program=(p.name_th if p else ""), vora_code=(p.code if p else ""),
                              vora_status=(p.status if p else ""),
                              result=("OK" if p and p.status == "published" else "NOT_PUBLISHED" if p else
                                      "NOT_A_PROGRAM (สอนวิชาพื้นฐาน ไม่รับสมัคร)" if dname == "สามัญสัมพันธ์" else "MISSING")))
    shown = {id(r) for r in pnames.values()}
    for p in progs:
        if id(p) in shown:
            continue
        if norm(p.name_th.removeprefix("แผนก").removeprefix("วิชา")) in {norm(x) for x in DEPTS}:
            prog_rows.append(dict(website_department="", vora_program=p.name_th, vora_code=p.code, vora_status=p.status,
                                  result="DUPLICATE_NAME" + (" (ไม่ได้เผยแพร่)" if p.status != "published" else "")))
        else:
            prog_rows.append(dict(website_department="", vora_program=p.name_th, vora_code=p.code, vora_status=p.status,
                                  result="NOT_ON_WEBSITE" if p.status == "published" else "NOT_ON_WEBSITE (ไม่ได้เผยแพร่)"))
    return kb_rows, news_rows, prog_rows


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def dt(s: str):
    return datetime.fromisoformat(s) if s else None


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--apply", action="store_true")
    g.add_argument("--finish", action="store_true")
    g.add_argument("--undo")
    a = ap.parse_args()

    from app.db import Base, SessionLocal, engine, wait_for_db
    from app.models import KnowledgeCandidate, KnowledgeItem, News, Program
    from app.services import audit
    models = (KnowledgeItem, News, Program, KnowledgeCandidate)
    wait_for_db(30)
    Base.metadata.create_all(engine, tables=[KnowledgeCandidate.__table__])   # มีอยู่แล้วจะไม่ทำอะไร
    stamp = f"{datetime.now():%Y%m%d-%H%M%S}"

    with SessionLocal() as db:
        if a.undo:
            info = json.loads(Path(a.undo).read_text(encoding="utf-8"))
            gone_c = gone_n = kept = 0
            for i in info.get("candidate_ids", []):
                c = db.get(KnowledgeCandidate, int(i))
                if c is None:
                    continue
                if c.status == "pending":
                    db.delete(c)
                    gone_c += 1
                else:
                    kept += 1
            for i in info.get("news_ids", []):
                n = db.get(News, int(i))
                if n is None:
                    continue
                if n.status == "pending":
                    db.delete(n)
                    gone_n += 1
                else:
                    kept += 1
            audit(db, "script", "undo", "import_technicnan_web", 0, candidates=gone_c, news=gone_n, kept=kept)
            db.commit()
            print(f"ลบความรู้ที่ยังรอตรวจ {gone_c} · ข่าวที่ยังรออนุมัติ {gone_n} · คงไว้ {kept} รายการที่เจ้าหน้าที่ตรวจ/แก้แล้ว")
            return 0

        if a.finish:
            done = 0
            for c in db.query(KnowledgeCandidate).filter(KnowledgeCandidate.batch == BATCH,
                                                          KnowledgeCandidate.status == "approved").all():
                m = re.search(r"\[แทน id: ([\d ]+)\]", c.reason or "")
                if not m:
                    continue
                for oid in map(int, m.group(1).split()):
                    k = db.get(KnowledgeItem, oid)
                    if k and k.status == "approved" and k.id != c.knowledge_id:
                        k.status = "rejected"
                        k.version += 1
                        audit(db, "script", "retire", "knowledge", k.id, replaced_by=c.knowledge_id, batch=BATCH)
                        done += 1
                        print(f"  ปิดคำตอบเดิม id {k.id}: {k.question[:60]} → ใช้ id {c.knowledge_id} แทน")
            db.commit()
            print(f"ปิดคำตอบเดิมที่ถูกแทนแล้ว {done} ข้อ (เปลี่ยนกลับได้ที่ หลังบ้าน → ฐานความรู้ AI)")
            if done:
                print("สำคัญ: เซิร์ฟเวอร์ VORA ที่เปิดอยู่ยังจำดัชนีเดิม — กดปุ่มสร้างดัชนีใหม่ในหน้าฐานความรู้ AI หรือปิดแล้วเปิด start.bat ใหม่")
            return 0

        kb_rows, news_rows, prog_rows = compare(db, models)
        report = OUT / f"check_live_{stamp}"
        write_csv(Path(f"{report}_knowledge.csv"), kb_rows)
        write_csv(Path(f"{report}_news.csv"), news_rows)
        write_csv(Path(f"{report}_programs.csv"), prog_rows)
        from collections import Counter
        print("ความรู้ :", dict(Counter(r["live_state"] for r in kb_rows)))
        print("ข่าว    :", dict(Counter(r["live_state"] for r in news_rows)))
        print("สาขา    :", dict(Counter(r["result"].split(" ")[0] for r in prog_rows)))
        print(f"รายงานเทียบกับฐานข้อมูลจริง: {report}_*.csv")
        if not a.apply:
            print("\nยังไม่ได้แก้อะไร — ใส่ --apply เพื่อนำเข้าจริง")
            return 0

        state = {r["ref"]: r for r in kb_rows}
        cand_ids, news_ids = [], []
        for c in read(KB_FILE):
            s = state[c["ref"]]
            if s["live_state"] in ("SAME", "ALREADY_IN_SANDBOX"):
                continue
            if s["live_state"] == "UPDATE":
                reason = (f"แทนคำตอบเดิม [แทน id: {s['live_ids']}] — อนุมัติแล้วรัน --finish เพื่อปิดคำตอบเดิม "
                          f"หรือไปเปลี่ยนข้อเดิมเป็น 'ไม่อนุมัติ' เอง · {c['note']}").strip(" ·")
            else:
                reason = ("ข้อมูลใหม่จากเว็บไซต์วิทยาลัย (ดึง 26 พ.ย. 2569) · " + c["note"]).strip(" ·")
            k = KnowledgeCandidate(batch=BATCH, ref=c["ref"], status="pending", category=c["category"], question=c["question"],
                                   alt_questions="\n".join(x for x in c["alt_questions"].split("|") if x),
                                   answer_th=c["answer_th"], answer_en=c["answer_en"], choices=[],
                                   sources=[{"title": "เว็บไซต์วิทยาลัยเทคนิคน่าน", "url": c["source_url"]}],
                                   evidence="A", data_year="2569" if "2568" not in c["answer_th"] else "2568", reason=reason[:2000])
            db.add(k)
            db.flush()
            cand_ids.append(k.id)
        nstate = {r["ref"]: r for r in news_rows}
        for n in read(NEWS_FILE):
            if nstate[n["ref"]]["live_state"] != "NEW":
                continue
            row = News(kind=n["kind"], title_th=n["title_th"][:255], body_th=n["body_th"], image_url=n["image_url"][:500],
                       gallery=n["gallery"], priority=int(n["priority"]), status="pending", publish_at=dt(n["publish_at"]),
                       event_date=dt(n["event_date"]), expire_at=dt(n["expire_at"]), created_by="import:technicnan-web")
            db.add(row)
            db.flush()
            news_ids.append(row.id)
        if not cand_ids and not news_ids:
            print("\nไม่มีรายการใหม่ต้องนำเข้า (มีครบแล้ว) — ไม่ได้แก้ฐานข้อมูล")
            return 0
        audit(db, "script", "import", "import_technicnan_web", 0, batch=BATCH, candidates=len(cand_ids), news=len(news_ids))
        db.commit()
        undo = OUT / f"undo_{stamp}.json"
        undo.write_text(json.dumps({"batch": BATCH, "candidate_ids": cand_ids, "news_ids": news_ids}, ensure_ascii=False, indent=1),
                        encoding="utf-8")
        print(f"\nเพิ่มเข้ากล่องตรวจข้อมูล {len(cand_ids)} ข้อ · ข่าว/กิจกรรมรออนุมัติ {len(news_ids)} รายการ")
        print(f"ย้อนกลับ: import_technicnan_web.bat --undo \"{undo}\"")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
