"""ทดสอบระบบ AI: การประมวลผลข้อความ โมเดลเจตนา การค้นคืน การตอบ และวงจรการปรับปรุงความรู้"""
import numpy as np

from app.ai.text import detect_lang, normalize, shorten


def ask(client, text, sid=None, lang=None):
    r = client.post("/api/chat", json={"text": text, "session_id": sid, "lang": lang})
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ ข้อความ
def test_normalize_removes_particles_but_keeps_words():
    assert normalize("สมัครเรียนยังไงครับ?") == "สมัครเรียนยังไง"
    assert normalize("คะแนนเท่าไหร่") == "คะแนนเท่าไหร่"          # "คะ" ในคำต้องไม่ถูกตัด
    assert normalize("ดีมากกกกก") == "ดีมาก"


def test_detect_lang():
    assert detect_lang("สวัสดี") == "th"
    assert detect_lang("How do I apply?") == "en"
    assert detect_lang("สาขา IT เรียนอะไร") == "th"


def test_shorten_cuts_at_sentence():
    text = "ประโยคแรกค่ะ ประโยคที่สองยาวมากกว่าเดิมค่ะ ประโยคที่สามค่ะ"
    out = shorten(text, 30)
    assert len(out) <= 30 and out.endswith("ค่ะ")


# ------------------------------------------------------------------ การตอบคำถาม
def test_program_question_answered_from_database(client):
    r = ask(client, "สาขาไฟฟ้าเรียนอะไร")
    assert r["answered"] and "ไฟฟ้า" in r["text"]
    assert r["media"]["image"].endswith(".svg")
    assert r["gesture"] in ("present", "explain")


def test_follow_up_uses_conversation_context(client):
    r1 = ask(client, "เมคคาทรอนิกส์คืออะไร")
    r2 = ask(client, "จบแล้วทำงานอะไร", sid=r1["session_id"])
    assert r2["intent"] == "career"
    assert "อัตโนมัติ" in r2["text"] or "หุ่นยนต์" in r2["text"]


def test_english_answer(client):
    r = ask(client, "How do I apply?")
    assert r["lang"] == "en" and r["answered"]
    assert "apply" in r["text"].lower()


def test_unknown_question_is_not_invented_and_is_logged(client, admin_headers):
    q = "สระว่ายน้ำของวิทยาลัยเปิดวันอาทิตย์ไหม"
    r = ask(client, q)
    assert r["answered"] is False
    assert "ยังไม่มีข้อมูล" in r["text"]
    rows = client.get("/api/admin/unanswered?status=new", headers=admin_headers).json()
    assert any(u["text"] == q for u in rows)


def test_improvement_loop_unanswered_to_knowledge(client, admin_headers):
    """วงจรปรับปรุง: คำถามที่ตอบไม่ได้ -> เจ้าหน้าที่เพิ่มความรู้ -> ถามซ้ำแล้วตอบได้"""
    q = "ห้องสมุดเปิดถึงกี่โมงคะ"
    assert ask(client, q)["answered"] is False
    u = next(x for x in client.get("/api/admin/unanswered?status=new", headers=admin_headers).json() if x["text"] == q)
    r = client.post(f"/api/admin/unanswered/{u['id']}/resolve", headers=admin_headers,
                    json={"action": "knowledge", "category": "location", "answer_th": "ห้องสมุดเปิดวันจันทร์ถึงศุกร์ 8 โมงถึง 6 โมงเย็นค่ะ"})
    assert r.status_code == 200
    r2 = ask(client, "ห้องสมุดเปิดกี่โมง")
    assert r2["answered"] and "6 โมงเย็น" in r2["text"]


def test_pending_knowledge_is_not_used_until_approved(client, editor_headers, admin_headers):
    body = {"question": "ชมรมอีสปอร์ตรับสมาชิกไหม", "answer_th": "ชมรมอีสปอร์ตเปิดรับสมาชิกทุกต้นภาคเรียนค่ะ",
            "category": "activity", "status": "pending"}
    kid = client.post("/api/admin/knowledge", headers=editor_headers, json=body).json()["id"]
    assert "อีสปอร์ต" not in ask(client, "ชมรมอีสปอร์ตรับสมาชิกไหม")["text"]
    assert client.post(f"/api/admin/knowledge/{kid}/approve", headers=admin_headers).status_code == 200
    assert "อีสปอร์ต" in ask(client, "ชมรมอีสปอร์ตรับสมาชิกไหม")["text"]


def test_out_of_scope_declined(client):
    r = ask(client, "หวยงวดนี้ออกอะไร")
    assert r["intent"] == "out_of_scope"
    assert "เฉพาะเรื่องของวิทยาลัย" in r["text"]


def test_robot_action_by_voice(client):
    r = ask(client, "เต้นให้ดูหน่อย")
    assert r["robot_action"] == "dance"


def test_vision_recognized_program(client):
    r = client.post("/api/vision/recognized", json={"label": "sign_it", "confidence": 0.93}).json()
    assert r["answered"] and "เทคโนโลยีสารสนเทศ" in r["text"]


def test_auto_greeting(client):
    r = client.post("/api/greet", json={"lang": "th", "people": 2}).json()
    assert r["text"].startswith("สวัสดีค่ะทุกคน")
    assert r["gesture"] == "wave"


# ------------------------------------------------------------------ การฝึกโมเดลซ้ำ
def test_intent_retrain_creates_new_version_and_rollback(client, admin_headers):
    before = client.get("/api/admin/models?kind=intent", headers=admin_headers).json()
    v0 = before[0]["version"]
    for t in ["อยากรู้เรื่องทุนเรียนฟรี", "ขอทุนได้ที่ไหน", "มีทุนสำหรับเด็กกิจกรรมไหม"]:
        client.post("/api/admin/intents/examples", headers=admin_headers, json={"text": t, "intent": "scholarship"})
    r = client.post("/api/admin/intents/retrain", headers=admin_headers, json={"notes": "test"})
    assert r.status_code == 200
    m = r.json()
    assert m["version"] == v0 + 1 and m["active"]
    assert m["n_samples"] > before[0]["n_samples"]
    assert 0 < m["metrics"]["accuracy"] <= 1
    assert m["metrics"]["previous_version"] == v0
    old = next(x for x in before if x["version"] == v0)
    assert client.post(f"/api/admin/models/{old['id']}/activate", headers=admin_headers).status_code == 200
    assert client.get("/api/health").json()["intent_model"] == v0


def test_vision_retrain_and_exported_model_matches_sklearn(client, admin_headers):
    rng = np.random.default_rng(0)
    centers = {"sign_it": rng.normal(size=64), "sign_elec": rng.normal(size=64), "background": rng.normal(size=64)}
    for label, c in centers.items():
        embs = [(c + rng.normal(scale=0.3, size=64)).tolist() for _ in range(12)]
        r = client.post("/api/admin/vision/samples", headers=admin_headers, json={"label": label, "embeddings": embs})
        assert r.status_code == 200
    r = client.post("/api/admin/vision/retrain", headers=admin_headers, json={})
    assert r.status_code == 200, r.text
    assert r.json()["metrics"]["accuracy"] >= 0.9
    model = client.get("/api/vision/model").json()
    assert model["available"] and set(model["labels"]) == set(centers)
    # จำลองการคำนวณแบบเดียวกับเบราว์เซอร์ (shared/vision.js: classifySign)
    x = centers["sign_elec"] + rng.normal(scale=0.3, size=64)
    x = x / np.linalg.norm(x)
    logits = np.array(model["coef"]) @ x + np.array(model["intercept"])
    p = np.exp(logits - logits.max())
    p /= p.sum()
    label = model["labels"][int(p.argmax())]
    assert label == "sign_elec" and p.max() > 0.6
    assert float(np.array(model["centroids"][label]) @ x) >= model["sim_threshold"]


# ------------------------------------------------------------------ ชุดทดสอบระบบ
def test_evaluation_suite_passes(client, admin_headers):
    r = client.post("/api/admin/eval/run", headers=admin_headers, json={"label": "pytest"}).json()
    assert r["total"] >= 20
    assert r["answer_accuracy"] >= 0.9, [d for d in r["details"] if not d["pass"]]
    assert r["avg_latency_ms"] < 500
