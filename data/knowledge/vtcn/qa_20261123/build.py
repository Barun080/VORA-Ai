"""สร้างไฟล์จาก qa_data.py: ตารางรวม / CSV นำเข้าฐานความรู้ / ชุดประเมิน / รายการที่ต้องถามทีม
    python data\\knowledge\\vtcn\\qa_20261123\\build.py"""
import csv, json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from qa_data import ROWS, SRC   # noqa: E402

COLS = ["id", "หมวด", "คำถาม", "คำถามรูปแบบอื่น", "หมวดฐานความรู้", "คำตอบ", "สถานะข้อมูล", "แหล่งอ้างอิง",
        "เส้นทางที่คาด", "เจตนาที่คาด", "คำสำคัญที่ต้องมี", "ต้องตอบได้", "หมายเหตุ"]


def src_urls(s):
    return " ; ".join(f"[{k}] {SRC[k]}" for k in s.split("|") if k)


def main():
    rows = [dict(zip(COLS, [f"Q{i:03d}", r[0], r[1], r[2], r[3], r[4], r[5], src_urls(r[6]), r[7], r[8], r[9],
                            "ใช่" if r[10] else "ไม่ (ควรบอกว่าไม่มีข้อมูล)", r[11]])) for i, r in enumerate(ROWS, 1)]
    with open(HERE / "vora_qa_set_20261123.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, COLS); w.writeheader(); w.writerows(rows)
    kb = [r for r in ROWS if r[5] in ("VERIFIED", "GUIDANCE", "SOURCED") and r[4]]   # SOURCED = ต้นฉบับผ่านสรุป Perplexity (ตรวจก่อนอนุมัติ)
    with open(HERE / "kb_import_20261123.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, ["category", "question", "alt_questions", "answer_th", "answer_en"]); w.writeheader()
        for r in kb:
            w.writerow({"category": r[3] or "general", "question": r[1], "alt_questions": r[2], "answer_th": r[4], "answer_en": ""})
    ev = [{"qid": f"Q{i:03d}", "question": r[1], "expected_intent": r[8], "expected_keywords": r[9],
           "expect_answered": bool(r[10]), "expected_route": r[7], "status": r[5]}
          for i, r in enumerate(ROWS, 1) if r[5] != "ASK" and not (r[7] == "followup")]
    (HERE / "eval_cases_20261123.json").write_text(json.dumps(ev, ensure_ascii=False, indent=1), encoding="utf-8")
    ask = [(f"Q{i:03d}", r) for i, r in enumerate(ROWS, 1) if r[5] == "ASK"]
    lines = ["# คำถามที่ยังไม่มีข้อมูลจริง — รอทีมยืนยัน (23 พ.ย. 2569)", "",
             "ค้นจากเว็บไซต์วิทยาลัยและแหล่งทางการแล้วไม่พบ หรือพบแต่ไม่ชัด จึงเว้นคำตอบไว้ (ห้ามเดา) — "
             "ส่งข้อมูลจริงพร้อมแหล่ง (เอกสาร/ประกาศ/ผู้ให้ข้อมูล) แล้วจะเติมให้", "",
             "| id | คำถาม | สิ่งที่ต้องการ |", "|---|---|---|"]
    lines += [f"| {q} | {r[1]} | {r[11] or '-'} |" for q, r in ask]
    try:
        from qa_update_20261123b import TEAM_DRAFTS
        lines += ["", "## ร่างจากเอกสาร Perplexity ที่ยังไม่ได้ยืนยันกับต้นฉบับ (ไม่ได้นำเข้า KB)", "",
                  "| เรื่อง | ร่าง/สิ่งที่ต้องยืนยัน |", "|---|---|"] + [f"| {a} | {b} |" for a, b in TEAM_DRAFTS]
    except ImportError:
        pass
    (HERE / "QUESTIONS_FOR_TEAM.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    from collections import Counter
    print(f"ทั้งหมด {len(rows)} · KB {len(kb)} · ประเมิน {len(ev)} · รอทีม {len(ask)} ·", dict(Counter(r[5] for r in ROWS)))


if __name__ == "__main__":
    main()
