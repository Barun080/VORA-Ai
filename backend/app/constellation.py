"""Knowledge Constellation — กราฟความรู้จากข้อมูลจริงในฐานข้อมูล (VORA NEXT Phase 4)

หลักการ: สร้าง Node/Edge จาก "ความสัมพันธ์ที่มีอยู่ในข้อมูล" เท่านั้น ไม่ใช้ AI เดาความสัมพันธ์ ไม่ตัดคำ/แยกข้อความเอง
- วิทยาลัย → ระดับ      : programs.level ของสาขาที่เผยแพร่ (offers_level)
- ระดับ → แผนก          : programs.department ภายในระดับนั้น (has_department)
- แผนก → สาขา           : programs ที่ level + department ตรงกัน (has_program)
- สาขา → อาชีพ          : programs.careers_* ของสาขานั้น (ทั้งข้อความ ไม่แยกเป็นหลายอาชีพเอง) (leads_to)
- วิทยาลัย → หมวดความรู้ : knowledge.category ของรายการที่ "อนุมัติแล้ว" (has_topic)
- หมวด → คำถาม-คำตอบ    : knowledge ที่อนุมัติในหมวดนั้น (contains)
ทุก Node มี knowledge_reference ชี้กลับไปยังแถวในฐานข้อมูล · ข้อมูลไม่พอ (เช่น สาขาไม่มีอาชีพ) → รายงานใน insufficient
ไม่สร้างตารางใหม่ ไม่แก้ข้อมูล — อ่านอย่างเดียว
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import KnowledgeItem, Program
from .services import all_settings

# ป้ายชื่อหมวดความรู้สำหรับแสดงผล (เป็นคำแปลชื่อหมวด ไม่ใช่ข้อมูลของวิทยาลัย) — หมวดที่ไม่มีในรายการแสดงชื่อเดิม
TOPIC_LABELS = {
    "admission": ("การรับสมัคร", "Admission"), "tuition": ("ค่าเล่าเรียน", "Tuition"), "scholarship": ("ทุนการศึกษา", "Scholarships"),
    "location": ("สถานที่", "Location"), "contact": ("ติดต่อ", "Contact"), "activity": ("กิจกรรม", "Activities"),
    "career": ("อาชีพ", "Careers"), "program": ("สาขาวิชา", "Programs"), "robot": ("หุ่นยนต์ VORA", "About VORA"),
    "general": ("ทั่วไป", "General"),
}
RELATIONS = ("offers_level", "has_department", "has_program", "leads_to", "has_topic", "contains")


def _pick(th: str | None, en: str | None, lang: str) -> str:
    return (en or th or "") if lang == "en" else (th or en or "")


def build_constellation(db: Session, lang: str = "th") -> dict[str, Any]:
    lang = "en" if lang == "en" else "th"
    cfg = all_settings(db)
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, str]] = []
    insufficient: list[dict[str, Any]] = []

    def node(nid: str, title: str, category: str, description: str, ref: str, **extra: Any) -> None:
        nodes.append({"id": nid, "title": title, "category": category, "description": description, "knowledge_reference": ref, **extra})

    def edge(src: str, dst: str, rel: str) -> None:
        edges.append({"source": src, "target": dst, "relation_type": rel})

    school = _pick(cfg.get("school_name_th"), cfg.get("school_name_en"), lang)
    node("college", school, "college", "", "settings:school_name_th")

    progs = db.query(Program).filter(Program.status == "published").order_by(Program.level, Program.department, Program.id).all()
    levels: dict[str, list[Program]] = {}
    for p in progs:
        levels.setdefault(p.level or "", []).append(p)

    for lv, plist in levels.items():
        lv_id = f"level:{lv}"
        node(lv_id, lv or ("ไม่ระบุระดับ" if lang == "th" else "Unspecified level"), "level", "", f"programs.level={lv}", count=len(plist))
        edge("college", lv_id, "offers_level")
        if not lv:
            insufficient.append({"node": lv_id, "missing": ["level"], "programs": [p.id for p in plist]})
        depts: dict[str, list[Program]] = {}
        for p in plist:
            depts.setdefault(p.department or "", []).append(p)
        for dep, dlist in depts.items():
            d_id = f"dept:{lv}:{dep}"
            node(d_id, dep or ("ไม่ระบุแผนก" if lang == "th" else "Unspecified department"), "department", "",
                 f"programs.department={dep};level={lv}", count=len(dlist))
            edge(lv_id, d_id, "has_department")
            if not dep:
                insufficient.append({"node": d_id, "missing": ["department"], "programs": [p.id for p in dlist]})
            for p in dlist:
                p_id = f"program:{p.id}"
                desc = _pick(p.description_th, p.description_en, lang)
                node(p_id, _pick(p.name_th, p.name_en, lang), "program", desc, f"programs:{p.id}",
                     code=p.code, level=p.level, department=p.department, image=p.image_url or "")
                edge(d_id, p_id, "has_program")
                missing = []
                if not desc:
                    missing.append("description")
                careers = _pick(p.careers_th, p.careers_en, lang)
                if careers:
                    c_id = f"career:{p.id}"
                    node(c_id, "อาชีพหลังเรียนจบ" if lang == "th" else "Careers", "career", careers, f"programs:{p.id}.careers_{lang}")
                    edge(p_id, c_id, "leads_to")
                else:
                    missing.append("careers")
                if missing:
                    insufficient.append({"node": p_id, "missing": missing})

    items = db.query(KnowledgeItem).filter(KnowledgeItem.status == "approved").order_by(KnowledgeItem.category, KnowledgeItem.id).all()
    topics: dict[str, list[KnowledgeItem]] = {}
    for k in items:
        topics.setdefault(k.category or "general", []).append(k)
    for cat, klist in topics.items():
        t_id = f"topic:{cat}"
        th, en = TOPIC_LABELS.get(cat, (cat, cat))
        node(t_id, en if lang == "en" else th, "topic", "", f"knowledge.category={cat}", count=len(klist))
        edge("college", t_id, "has_topic")
        for k in klist:
            ans = _pick(k.answer_th, k.answer_en, lang)
            node(f"knowledge:{k.id}", k.question or "", "knowledge", ans, f"knowledge:{k.id}")
            edge(t_id, f"knowledge:{k.id}", "contains")
            if not ans:
                insufficient.append({"node": f"knowledge:{k.id}", "missing": ["answer"]})

    return {
        "root": "college", "lang": lang, "nodes": nodes, "edges": edges, "insufficient": insufficient,
        "relations": list(RELATIONS),
        "counts": {"programs": len(progs), "levels": len(levels), "knowledge": len(items), "topics": len(topics),
                   "nodes": len(nodes), "edges": len(edges)},
    }
