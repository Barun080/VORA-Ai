"""VORA NEXT Phase 4 — Knowledge Constellation: Node/Edge ต้องมาจากข้อมูลจริงในฐานข้อมูลเท่านั้น"""
from app.db import SessionLocal
from app.models import KnowledgeItem, Program


def _graph(client, lang="th"):
    r = client.get(f"/api/constellation?lang={lang}")
    assert r.status_code == 200
    return r.json()


def test_nodes_match_database(client):
    g = _graph(client)
    with SessionLocal() as db:
        progs = db.query(Program).filter(Program.status == "published").all()
        approved = db.query(KnowledgeItem).filter(KnowledgeItem.status == "approved").all()
    ids = {n["id"] for n in g["nodes"]}
    assert len(ids) == len(g["nodes"]), "Node id ต้องไม่ซ้ำ"
    assert {f"program:{p.id}" for p in progs} == {i for i in ids if i.startswith("program:")}
    assert {f"level:{p.level}" for p in progs} == {i for i in ids if i.startswith("level:")}
    assert {f"dept:{p.level}:{p.department}" for p in progs} == {i for i in ids if i.startswith("dept:")}
    assert {f"knowledge:{k.id}" for k in approved} == {i for i in ids if i.startswith("knowledge:")}
    assert {f"topic:{k.category}" for k in approved} == {i for i in ids if i.startswith("topic:")}
    assert {f"career:{p.id}" for p in progs if p.careers_th} == {i for i in ids if i.startswith("career:")}
    for n in g["nodes"]:
        assert set(("id", "title", "category", "description", "knowledge_reference")) <= set(n)
        assert n["knowledge_reference"]


def test_every_edge_is_backed_by_data(client):
    g = _graph(client)
    nodes = {n["id"]: n for n in g["nodes"]}
    with SessionLocal() as db:
        progs = {p.id: p for p in db.query(Program).filter(Program.status == "published").all()}
        know = {k.id: k for k in db.query(KnowledgeItem).filter(KnowledgeItem.status == "approved").all()}
    assert g["edges"], "ต้องมีความสัมพันธ์อย่างน้อยหนึ่งเส้น"
    for e in g["edges"]:
        assert e["source"] in nodes and e["target"] in nodes
        assert e["relation_type"] in g["relations"]
        s, t, rel = e["source"], e["target"], e["relation_type"]
        if rel == "offers_level":
            assert s == "college" and any(p.level == t.split(":", 1)[1] for p in progs.values())
        elif rel == "has_department":
            lv = s.split(":", 1)[1]
            _, lv2, dep = t.split(":", 2)
            assert lv == lv2 and any(p.level == lv and p.department == dep for p in progs.values())
        elif rel == "has_program":
            _, lv, dep = s.split(":", 2)
            p = progs[int(t.split(":")[1])]
            assert p.level == lv and p.department == dep
        elif rel == "leads_to":
            p = progs[int(s.split(":")[1])]
            assert t == f"career:{p.id}" and p.careers_th and nodes[t]["description"] == p.careers_th
        elif rel == "has_topic":
            assert s == "college" and any(k.category == t.split(":", 1)[1] for k in know.values())
        elif rel == "contains":
            k = know[int(t.split(":")[1])]
            assert s == f"topic:{k.category}" and nodes[t]["description"] == k.answer_th
    # ทุก Node (ยกเว้นราก) ต้องมีเส้นเชื่อมเข้าเพียงเส้นเดียว = เป็นต้นไม้ เจาะลึกได้ทางเดียว
    incoming = {}
    for e in g["edges"]:
        incoming[e["target"]] = incoming.get(e["target"], 0) + 1
    assert all(incoming.get(n, 0) == 1 for n in nodes if n != "college")


def test_unapproved_knowledge_and_unpublished_programs_are_excluded(client):
    with SessionLocal() as db:
        k = KnowledgeItem(kind="faq", category="test_pending_cat", question="คำถามทดสอบที่ยังไม่อนุมัติ", answer_th="x", status="pending")
        p = Program(code="TEST-DRAFT-C", level="ทดสอบ", department="ทดสอบ", name_th="สาขาฉบับร่าง", status="draft")
        db.add_all([k, p]); db.commit(); kid, pid = k.id, p.id
    try:
        ids = {n["id"] for n in _graph(client)["nodes"]}
        assert f"knowledge:{kid}" not in ids and "topic:test_pending_cat" not in ids
        assert f"program:{pid}" not in ids and "level:ทดสอบ" not in ids
    finally:
        with SessionLocal() as db:
            db.query(KnowledgeItem).filter(KnowledgeItem.id == kid).delete()
            db.query(Program).filter(Program.id == pid).delete()
            db.commit()


def test_missing_data_is_reported_not_invented(client):
    with SessionLocal() as db:
        p = Program(code="TEST-NOCAREER", level="ปวช.", department="แผนกทดสอบ", name_th="สาขาไม่มีข้อมูลอาชีพ", careers_th="", description_th="", status="published")
        db.add(p); db.commit(); pid = p.id
    try:
        g = _graph(client)
        ids = {n["id"] for n in g["nodes"]}
        assert f"program:{pid}" in ids and f"career:{pid}" not in ids
        gap = [i for i in g["insufficient"] if i["node"] == f"program:{pid}"]
        assert gap and set(gap[0]["missing"]) == {"careers", "description"}
    finally:
        with SessionLocal() as db:
            db.query(Program).filter(Program.id == pid).delete()
            db.commit()


def test_english_uses_english_names(client):
    g = _graph(client, "en")
    with SessionLocal() as db:
        p = db.query(Program).filter(Program.status == "published", Program.name_en != "").first()
    n = next(x for x in g["nodes"] if x["id"] == f"program:{p.id}")
    assert n["title"] == p.name_en and g["lang"] == "en"
