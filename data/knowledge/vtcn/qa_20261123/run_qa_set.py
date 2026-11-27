"""ทดสอบชุดคำถามกับระบบจริงในเครื่อง (ใช้ฐานข้อมูลทดสอบ SQLite แยก — ไม่แตะฐานข้อมูลจริง)
นำเข้า KB เดิม + KB ใหม่ (อนุมัติในฐานข้อมูลทดสอบเท่านั้น) แล้วถามทุกคำถาม + บทสนทนาถามต่อ เขียนรายงาน CSV

    set VORA_DATABASE_URL=sqlite:///C:/temp/vora_test_qa.db   (ชื่อไฟล์ต้องมีคำว่า test)
    python data\\knowledge\\vtcn\\qa_20261123\\run_qa_set.py
ใช้ AI ตามการตั้งค่าเครื่อง (ไม่มีคีย์ = ตอบจากฐานความรู้ตรง ๆ)"""
import asyncio, csv, json, os, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "backend")); sys.path.insert(0, str(HERE))
url = os.environ.get("VORA_DATABASE_URL", "")
if "test" not in url:
    sys.exit("ต้องตั้ง VORA_DATABASE_URL เป็นฐานข้อมูลทดสอบ (ชื่อมีคำว่า test) — สคริปต์นี้ห้ามรันกับฐานข้อมูลจริง")

from app import brain                                   # noqa: E402
from app.db import Base, SessionLocal, engine as dbe   # noqa: E402
from app.models import KnowledgeItem                    # noqa: E402
from app.seed import seed                               # noqa: E402
from app.ai import engine                               # noqa: E402
from app.ai.retriever import retriever                  # noqa: E402
from qa_data import ROWS                                # noqa: E402
from app.models import Program                          # noqa: E402
from app.ai.training import retrain_intent, load_active_models   # noqa: E402
sys.path.insert(0, str(ROOT / "scripts"))
import import_vtcn_programs                             # noqa: E402
AS_IS = "--as-is" in sys.argv          # ไม่ปิดข้อมูลตัวอย่าง seed (ดูผลแบบก่อนทำความสะอาด)

CHAINS = [
    ["มีแผนกเทคโนโลยีคอมพิวเตอร์ไหม", "เรียนเกี่ยวกับอะไรบ้าง", "เรียนกี่ปี", "ต้องเรียนเขียนโปรแกรมไหม", "แผนกนี้มีสาขาอะไรบ้าง", "แผนกนี้อยู่ตึกไหน", "จบแล้วทำงานอะไร"],
    ["มีแผนกช่างไฟมั้ย", "แผนกนี้มีสาขาอะไรบ้าง", "เกี่ยวกับเทคนิคอุตสาหกรรม", "เรียนกี่ปี", "ต้องเรียนเขียนโปรแกรมไหม"],
    ["วันนี้มีข่าวอะไร", "งานนี้จัดที่ไหน", "งานจัดวันไหน", "งานเริ่มกี่โมง", "ข่าวถัดไป"],
    ["อากาศวันนี้", "ที่แพร่ล่ะ", "แล้วพรุ่งนี้ล่ะ"],
]


def load_kb(db):
    n = 0
    for f in (ROOT / "data/knowledge/vtcn/vora_import_knowledge.csv", HERE / "kb_import_20261123.csv"):
        for r in csv.DictReader(open(f, encoding="utf-8-sig")):
            db.add(KnowledgeItem(category=r["category"] or "general", question=r["question"],
                                 alt_questions=(r.get("alt_questions") or "").replace("|", "\n"),
                                 answer_th=r["answer_th"], answer_en=r.get("answer_en") or "", source="import", status="approved"))
            n += 1
    db.commit()
    return n


async def ask(db, text, sid):
    res = await engine.answer(db, text, sid, "th", "test", "text")
    t = getattr(res, "trace", {}) or {}
    pa = t.get("program_answer") or {}
    return res, {"intent": res["intent"], "conf": round(res["confidence"], 2), "source": res.contract["answer_source"] if hasattr(res, "contract") else "",
                 "answered": res["answered"], "provider": res["provider"], "route": (t.get("route") or {}).get("final"),
                 "aspect": pa.get("aspect", ""), "followup": (t.get("followup") or {}).get("text", ""), "text": res["text"]}


async def main():
    Base.metadata.create_all(dbe)
    with SessionLocal() as db:
        seed(db)
        have = {c for (c,) in db.query(Program.code).all()}
        for r in import_vtcn_programs.build():
            if r["code"] not in have:
                db.add(Program(**r))
        if not AS_IS:                      # จำลองหลังรัน scripts/retire_seed_samples.py --apply
            db.query(KnowledgeItem).filter(KnowledgeItem.created_by == "seed").update({"status": "draft"})
            db.query(Program).filter(~Program.code.like("VTCN-%")).update({"status": "draft"}, synchronize_session=False)
        db.commit()
        retrain_intent(db, "qa-test"); load_active_models(db)
        print("นำเข้า KB", load_kb(db), "รายการ (อนุมัติเฉพาะในฐานข้อมูลทดสอบ)")
        retriever.rebuild(db) if hasattr(retriever, "rebuild") else retriever.ensure(db)
        out = []
        for i, r in enumerate(ROWS, 1):
            if r[7] == "followup":
                continue
            res, d = await ask(db, r[1], None)
            exp_ans, kws = bool(r[10]), [k for k in r[9].split("|") if k]
            ok_ans = d["answered"] == exp_ans if r[5] != "ASK" else (not d["answered"])
            ok_kw = (not kws) or any(k in d["text"] for k in kws)
            ok_int = (not r[8]) or d["intent"] == r[8]
            out.append({"qid": f"Q{i:03d}", "หมวด": r[0], "คำถาม": r[1], "สถานะข้อมูล": r[5], "เส้นทางที่คาด": r[7],
                        **d, "ผ่าน_ตอบได้": ok_ans, "ผ่าน_คำสำคัญ": ok_kw, "ผ่าน_เจตนา": ok_int})
        for c, chain in enumerate(CHAINS, 1):
            sid = None
            for j, q in enumerate(chain):
                res, d = await ask(db, q, sid)
                sid = res["session_id"]
                out.append({"qid": f"C{c}.{j + 1}", "หมวด": "บทสนทนาถามต่อ", "คำถาม": q, "สถานะข้อมูล": "", "เส้นทางที่คาด": "followup",
                            **d, "ผ่าน_ตอบได้": "", "ผ่าน_คำสำคัญ": "", "ผ่าน_เจตนา": ""})
    rep = HERE / ("qa_run_report_asis.csv" if AS_IS else "qa_run_report.csv")
    with open(rep, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, list(out[0].keys())); w.writeheader(); w.writerows(out)
    single = [o for o in out if not o["qid"].startswith("C")]
    for k in ("ผ่าน_ตอบได้", "ผ่าน_คำสำคัญ", "ผ่าน_เจตนา"):
        print(k, sum(1 for o in single if o[k] is True), "/", len(single))
    print("รายงาน:", rep)


if __name__ == "__main__":
    asyncio.run(main())
