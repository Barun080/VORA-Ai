"""25 พ.ย. 2569: คำถามที่ตรงกับ FAQ ที่อนุมัติแล้ว → อ่านคำตอบเต็ม ไม่ให้ AI ย่อ/ไม่ตัดที่ 420 ตัวอักษร (VORA_FAQ_FULL)
และไฟล์แก้ไข data/knowledge/fixes/20261125_tvqf.json ถูกต้องตามแหล่งอ้างอิง"""
import json
from pathlib import Path

import pytest

from app.ai import engine
from app.ai.retriever import retriever
from app.config import settings
from app.db import SessionLocal
from app.models import KnowledgeItem

ROOT = Path(__file__).resolve().parents[2]
FIX = json.loads((ROOT / "data" / "knowledge" / "fixes" / "20261125_tvqf.json").read_text(encoding="utf-8"))["fixes"][0]
Q = "กรอบคุณวุฒิอาชีวศึกษาแห่งชาติคืออะไร"


@pytest.fixture
def tvqf():
    db = SessionLocal()
    k = KnowledgeItem(kind="faq", category="general", question=Q, alt_questions=FIX["alt_questions"],
                      answer_th=FIX["answer_th"], answer_en=FIX["answer_en"], status="approved", source="import")
    db.add(k)
    db.commit()
    kid = k.id
    db.close()
    retriever.mark_dirty()
    engine._llm_cache.clear()
    yield kid
    db = SessionLocal()
    db.delete(db.get(KnowledgeItem, kid))
    db.commit()
    db.close()
    retriever.mark_dirty()


def ask(client, text, lang="th"):
    r = client.post("/api/chat", json={"text": text, "lang": lang, "channel": "kiosk"})
    assert r.status_code == 200
    return r.json()


def test_fix_file_is_complete_and_sourced():
    a = FIX["answer_th"]
    for must in ("พ.ศ. 2567", "2 กุมภาพันธ์ 2567", "ยกเลิกฉบับ พ.ศ. 2562", "ประกาศกระทรวงศึกษาธิการ",
                 "(ปวช.)", "(ปวส.)", "ปริญญาตรีสายเทคโนโลยีหรือสายปฏิบัติการ", "อย่างน้อย 4 ด้าน",
                 "คุณธรรม จริยธรรม", "ด้านความรู้", "ด้านทักษะ", "ความสามารถในการประยุกต์ใช้และความรับผิดชอบ"):
        assert must in a, must
    assert "เอกสารไม่มีรายละเอียด" not in a and "คณะกรรมการการอาชีวศึกษาที่ลงในราชกิจจานุเบกษา" not in a
    assert FIX["sources"] and "ตอนพิเศษ ๓๓ ง" in FIX["sources"][0]["title"] and FIX["sources"][0]["url"].startswith("https://")
    assert len(a) > settings.max_answer_chars                                  # ยาวกว่าขีดเดิม → ต้องไม่ถูกตัด


def test_exact_faq_is_read_in_full(client, tvqf):
    r = ask(client, Q)
    assert r["answered"] and r["provider"] == "knowledge-base"
    assert r["text"] == FIX["answer_th"]                                       # ครบทุกประโยค ไม่ถูกย่อ
    assert r["text"].endswith("ความสามารถในการประยุกต์ใช้และความรับผิดชอบค่ะ")


def test_switch_off_keeps_old_length_limit(client, tvqf, monkeypatch):
    monkeypatch.setattr(settings, "faq_full", False)
    r = ask(client, Q)
    assert r["answered"] and len(r["text"]) <= settings.max_answer_chars * 2
    assert r["text"] != FIX["answer_th"] or len(FIX["answer_th"]) <= settings.max_answer_chars * 2


def test_full_faq_skips_ai_even_when_ai_available(client, tvqf, monkeypatch):
    called = []

    async def spy(*a, **k):
        called.append(1)
        return ("ย่อแล้วค่ะ", "fake")
    monkeypatch.setattr(engine, "_compose_with_llm", spy)
    monkeypatch.setattr(type(engine.llm), "available", property(lambda self: True))
    r = ask(client, Q)
    assert called == [] and r["text"] == FIX["answer_th"]
    monkeypatch.setattr(settings, "faq_full", False)
    engine._llm_cache.clear()
    r2 = ask(client, Q)
    assert called == [1] and r2["text"] == "ย่อแล้วค่ะ"                       # ปิดสวิตช์ = เส้นทางเดิม (AI เรียบเรียง)


def test_vtcn_review_fix_file_is_sourced_and_current():
    """25 พ.ย. 2569: ไฟล์ตรวจคำตอบชุด vtcn-pdf — ทุกข้อที่แก้มีแหล่งอ้างอิง · ข้อที่ปิดมีเหตุผล · ข้อมูลล้าสมัยถูกแก้"""
    fixes = json.loads((ROOT / "data" / "knowledge" / "fixes" / "20261125_vtcn_review.json").read_text(encoding="utf-8"))["fixes"]
    by_q = {f["match_question"]: f for f in fixes}
    for f in fixes:
        if f.get("action") == "retire":
            assert f["reason"]
        else:
            assert f["sources"] and f["answer_th"].strip() and "เอกสารไม่" not in f["answer_th"] and "ตามรายงาน" not in f["answer_th"]
    assert "วิทวัต ปัญจมะวัต" in by_q["ใครเป็นเลขาธิการ กอศ."]["answer_th"]
    assert "054-719552" in by_q["เบอร์โทรวิทยาลัยเทคนิคน่านคืออะไร"]["answer_th"]
    assert "429" in by_q["ทั้งประเทศมีวิทยาลัยอาชีวะกี่แห่ง"]["answer_th"]
    assert by_q["ผลประเมินวิทยาลัยเทคนิคน่านเป็นอย่างไร"]["action"] == "retire"
