"""การฝึกโมเดลซ้ำ (Retrain) การจัดการเวอร์ชัน และการประเมินผลระบบถาม-ตอบ"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sqlalchemy.orm import Session

from ..config import DATA_DIR
from ..models import EvalCase, EvalRun, IntentExample, ModelVersion, VisionSample
from ..services import audit, record_event
from .intent import IntentClassifier, intent_classifier, train_model
from .retriever import retriever
from .text import normalize

_train_lock = threading.Lock()
MODEL_DIR = DATA_DIR / "models"


def _next_version(db: Session, kind: str) -> int:
    last = db.query(ModelVersion).filter(ModelVersion.kind == kind).order_by(ModelVersion.version.desc()).first()
    return (last.version + 1) if last else 1


def _activate(db: Session, mv: ModelVersion) -> None:
    db.query(ModelVersion).filter(ModelVersion.kind == mv.kind).update({"active": False})
    mv.active = True


# ------------------------------------------------------------------------- Intent model
def retrain_intent(db: Session, username: str = "system", notes: str = "") -> ModelVersion:
    if not _train_lock.acquire(blocking=False):
        raise RuntimeError("กำลังฝึกโมเดลอยู่ กรุณารอสักครู่")
    try:
        rows = db.query(IntentExample).filter(IntentExample.active.is_(True)).all()
        texts = [r.text for r in rows]
        labels = [r.intent for r in rows]
        prev = db.query(ModelVersion).filter(ModelVersion.kind == "intent", ModelVersion.active.is_(True)).first()
        model, metrics = train_model(texts, labels)
        version = _next_version(db, "intent")
        path = IntentClassifier.save(model, version)
        if prev:
            metrics["previous_version"] = prev.version
            metrics["previous_accuracy"] = prev.metrics.get("accuracy")
            metrics["previous_n_samples"] = prev.n_samples
        mv = ModelVersion(kind="intent", version=version, n_samples=len(texts), n_classes=len(set(labels)),
                          metrics=metrics, path=str(path), notes=notes, created_by=username)
        db.add(mv)
        _activate(db, mv)
        audit(db, username, "retrain", "intent_model", version, accuracy=metrics.get("accuracy"), n=len(texts))
        db.commit()
        intent_classifier.set(model, version)
        record_event("info", "ai", f"Intent model v{version} trained: acc={metrics.get('accuracy')} n={len(texts)}")
        return mv
    finally:
        _train_lock.release()


def activate_intent_version(db: Session, version_id: int, username: str) -> ModelVersion:
    mv = db.get(ModelVersion, version_id)
    if not mv or mv.kind != "intent" or not Path(mv.path).exists():
        raise ValueError("ไม่พบไฟล์โมเดลเวอร์ชันนี้")
    intent_classifier.load(mv.path, mv.version)
    _activate(db, mv)
    audit(db, username, "rollback", "intent_model", mv.version)
    db.commit()
    return mv


def load_active_models(db: Session) -> None:
    """เรียกตอนเริ่มระบบ: โหลดโมเดลที่ active ถ้าไม่มี/ไฟล์เสีย จะฝึกใหม่อัตโนมัติ"""
    mv = db.query(ModelVersion).filter(ModelVersion.kind == "intent", ModelVersion.active.is_(True)).first()
    try:
        if mv and Path(mv.path).exists():
            intent_classifier.load(mv.path, mv.version)
        else:
            retrain_intent(db, "system", "ฝึกอัตโนมัติตอนเริ่มระบบ")
    except Exception as e:  # noqa: BLE001
        record_event("error", "ai", f"load intent model failed, retraining: {e}")
        retrain_intent(db, "system", "ฝึกใหม่เพราะโหลดโมเดลเดิมไม่สำเร็จ")
    retriever.rebuild(db)


# ------------------------------------------------------------------------- Vision model
VISION_UNKNOWN_MIN_SAMPLES = 3


def _pending_labels(db: Session) -> set[str]:
    """ป้ายที่นำเข้าแล้วยังรอตรวจ (มีแถวใน vision_pending และยังปิดอยู่) — ไม่นำไปฝึกจนกว่าจะยืนยัน"""
    try:
        from ..models import VisionClass, VisionPending
        ids = [p.vision_class_id for p in db.query(VisionPending).all()]
        if not ids:
            return set()
        return {v.label for v in db.query(VisionClass).filter(VisionClass.id.in_(ids), VisionClass.active.is_(False)).all()}
    except Exception:                                   # ตารางยังไม่ถูกสร้าง ฯลฯ → ทำงานแบบเดิม
        return set()


def retrain_vision(db: Session, username: str = "system", notes: str = "") -> ModelVersion:
    """ฝึกตัวจำแนกภาพจากเวกเตอร์คุณลักษณะ (embedding) ที่เจ้าหน้าที่/นักเรียนเก็บผ่านกล้อง
    โมเดล: Logistic Regression บน L2-normalized embedding (Transfer Learning จาก MobileNetV3)
    ส่งออกเป็น JSON (น้ำหนัก W, b) ให้เบราว์เซอร์คำนวณได้ทันทีแบบเรียลไทม์โดยไม่ต้องส่งภาพไปเซิร์ฟเวอร์
    """
    rows = [r for r in db.query(VisionSample).all() if r.label not in _pending_labels(db)]   # 24 พ.ย. 2569: ไม่ฝึกรายการ "รอตรวจ"
    labels = [r.label for r in rows]
    counts: dict[str, int] = {}
    for l in labels:
        counts[l] = counts.get(l, 0) + 1
    usable = {l for l, c in counts.items() if c >= VISION_UNKNOWN_MIN_SAMPLES}
    if len(usable) < 2:
        raise ValueError("ต้องมีอย่างน้อย 2 ป้าย และป้ายละไม่น้อยกว่า 3 ภาพ จึงจะฝึกโมเดลได้")
    data = [(np.array(r.embedding, dtype=np.float32), r.label) for r in rows if r.label in usable]
    X = np.stack([d[0] for d in data])
    X = X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-8)
    y = np.array([d[1] for d in data])
    t0 = time.time()
    metrics: dict[str, Any] = {"n_samples": len(y), "class_counts": {l: counts[l] for l in sorted(usable)}}
    k = min(5, min(counts[l] for l in usable))
    if k >= 2:
        pred = cross_val_predict(LogisticRegression(C=4.0, max_iter=2000), X, y,
                                 cv=StratifiedKFold(n_splits=k, shuffle=True, random_state=7))
        metrics["accuracy"] = round(float((pred == y).mean()), 4)
        metrics["cv_folds"] = k
    clf = LogisticRegression(C=4.0, max_iter=2000).fit(X, y)
    # ค่าความคล้ายขั้นต่ำกับตัวอย่างใกล้สุด ใช้ปฏิเสธภาพที่ไม่ใช่ป้ายที่รู้จัก (open-set rejection)
    centroids = {}
    for l in sorted(usable):
        c = X[y == l].mean(axis=0)
        centroids[l] = (c / (np.linalg.norm(c) + 1e-8)).round(5).tolist()
    sims = [float(X[i] @ np.array(centroids[y[i]])) for i in range(len(y))]
    sim_threshold = round(max(0.35, float(np.percentile(sims, 5)) - 0.08), 3)
    metrics.update(train_seconds=round(time.time() - t0, 2), sim_threshold=sim_threshold)

    version = _next_version(db, "vision")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    path = MODEL_DIR / f"vision_v{version}.json"
    payload = {
        "version": version, "labels": [str(c) for c in clf.classes_],
        # กรณี 2 คลาส: softmax([0, z]) = sigmoid(z) ให้ผลเท่ากับ predict_proba ของ sklearn
        "coef": clf.coef_.round(6).tolist() if len(clf.classes_) > 2 else
        [[0.0] * clf.coef_.shape[1], clf.coef_[0].round(6).tolist()],
        "intercept": clf.intercept_.round(6).tolist() if len(clf.classes_) > 2 else
        [0.0, float(clf.intercept_[0])],
        "centroids": centroids, "sim_threshold": sim_threshold, "prob_threshold": 0.6,
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    mv = ModelVersion(kind="vision", version=version, n_samples=len(y), n_classes=len(usable), metrics=metrics,
                      path=str(path), notes=notes, created_by=username)
    db.add(mv)
    _activate(db, mv)
    audit(db, username, "retrain", "vision_model", version, accuracy=metrics.get("accuracy"), n=len(y))
    db.commit()
    record_event("info", "ai", f"Vision model v{version} trained: acc={metrics.get('accuracy')} n={len(y)}")
    return mv


def active_vision_model(db: Session) -> dict | None:
    mv = db.query(ModelVersion).filter(ModelVersion.kind == "vision", ModelVersion.active.is_(True)).first()
    if not mv or not Path(mv.path).exists():
        return None
    return json.loads(Path(mv.path).read_text(encoding="utf-8"))


# ------------------------------------------------------------------------- QA evaluation
async def run_evaluation(db: Session, username: str = "system", label: str = "") -> EvalRun:
    """รันชุดทดสอบทั้งหมดผ่าน Answer Pipeline จริง แล้วบันทึกผลไว้เปรียบเทียบก่อน/หลังปรับปรุง"""
    from .engine import answer   # import ภายในเพื่อเลี่ยง circular import

    cases = db.query(EvalCase).filter(EvalCase.active.is_(True)).all()
    details = []
    intent_ok = answer_ok = 0
    latencies = []
    intent_total = 0
    for c in cases:
        res = await answer(db, c.question, session_id=None, lang=c.lang, channel="eval", input_mode="text")
        kws = [k for k in (c.expected_keywords or "").split("|") if k.strip()]
        text_n = normalize(res["text"])
        kw_ok = (not kws) or any(normalize(k) in text_n for k in kws)
        ans_ok = (res["answered"] == c.expect_answered) and kw_ok
        it_ok = None
        if c.expected_intent:
            intent_total += 1
            it_ok = res["intent"] == c.expected_intent or res["intent_raw"] == c.expected_intent
            intent_ok += int(it_ok)
        answer_ok += int(ans_ok)
        latencies.append(res["latency_ms"])
        details.append({"id": c.id, "question": c.question, "expected_intent": c.expected_intent,
                        "predicted_intent": res["intent"], "confidence": res["confidence"], "intent_ok": it_ok,
                        "answered": res["answered"], "expect_answered": c.expect_answered, "keyword_ok": kw_ok,
                        "pass": ans_ok, "answer": res["text"][:200], "latency_ms": res["latency_ms"],
                        "provider": res["provider"]})
    total = len(cases)
    run = EvalRun(label=label or "ทดสอบระบบถาม-ตอบ", total=total, passed=answer_ok,
                  intent_accuracy=round(intent_ok / intent_total, 4) if intent_total else 0.0,
                  answer_accuracy=round(answer_ok / total, 4) if total else 0.0,
                  avg_latency_ms=int(sum(latencies) / len(latencies)) if latencies else 0,
                  intent_model_version=intent_classifier.version, kb_documents=len(retriever.docs),
                  details=details, created_by=username)
    db.add(run)
    audit(db, username, "evaluate", "qa", "", passed=answer_ok, total=total)
    db.commit()
    return run
