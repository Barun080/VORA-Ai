"""โมเดลจำแนกเจตนาของคำถาม (Intent Classifier) ที่ฝึกซ้ำ (Retrain) ได้จากข้อมูลของสถานศึกษาเอง

อัลกอริทึม: TF-IDF แบบ n-gram ระดับตัวอักษร (เหมาะกับภาษาไทยที่ไม่มีการเว้นวรรคระหว่างคำ)
+ Logistic Regression แบบหลายคลาส  ประเมินผลด้วย Stratified K-Fold Cross Validation
ทุกครั้งที่ฝึกจะได้เวอร์ชันใหม่ เก็บผลการวัดไว้เปรียบเทียบก่อน/หลัง และย้อนกลับเวอร์ชันได้
"""
from __future__ import annotations

import pickle
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import FeatureUnion, Pipeline

from ..config import DATA_DIR
from .text import normalize

MODEL_DIR = DATA_DIR / "models"


def build_pipeline() -> Pipeline:
    # ทดลองเปรียบเทียบแล้ว (5-fold CV): char_wb 1-4 + LR ให้ผลดีที่สุดกับข้อมูลชุดนี้
    # เทียบกับ word-level (ตัดคำด้วย PyThaiNLP) และ Naive Bayes / SVM — ดู docs/ai-model.md
    features = FeatureUnion([
        ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(1, 4), sublinear_tf=True, min_df=1)),
    ])
    clf = LogisticRegression(C=12.0, max_iter=3000, class_weight="balanced")
    return Pipeline([("features", features), ("clf", clf)])


def train_model(texts: list[str], labels: list[str]) -> tuple[Pipeline, dict[str, Any]]:
    """ฝึกโมเดลและคำนวณผลการวัดด้วย cross-validation"""
    if len(set(labels)) < 2:
        raise ValueError("ต้องมีเจตนาอย่างน้อย 2 ประเภทจึงจะฝึกโมเดลได้")
    X = [normalize(t) for t in texts]
    y = np.array(labels)
    t0 = time.time()

    counts = Counter(labels)
    k = min(5, min(counts.values()))
    metrics: dict[str, Any] = {"n_samples": len(X), "n_classes": len(counts), "class_counts": dict(counts)}
    if k >= 2:
        cv = StratifiedKFold(n_splits=k, shuffle=True, random_state=42)
        pred = cross_val_predict(build_pipeline(), X, y, cv=cv)
        classes = sorted(counts)
        metrics.update(
            cv_folds=k,
            accuracy=round(float(accuracy_score(y, pred)), 4),
            f1_macro=round(float(f1_score(y, pred, average="macro")), 4),
            per_class={c: {kk: round(float(v), 3) for kk, v in d.items() if kk in ("precision", "recall", "f1-score", "support")}
                       for c, d in classification_report(y, pred, output_dict=True, zero_division=0).items() if c in counts},
            labels=classes,
            confusion=confusion_matrix(y, pred, labels=classes).tolist(),
        )
        errors = [{"text": texts[i], "expected": str(y[i]), "predicted": str(pred[i])} for i in range(len(X)) if y[i] != pred[i]]
        metrics["errors"] = errors[:30]
    else:
        metrics.update(cv_folds=0, accuracy=None, f1_macro=None, note="ตัวอย่างบางเจตนาน้อยกว่า 2 ประโยค จึงข้ามการทดสอบไขว้")

    model = build_pipeline()
    model.fit(X, y)
    metrics["train_seconds"] = round(time.time() - t0, 2)
    return model, metrics


class IntentClassifier:
    """ตัวห่อโมเดลที่ใช้งานจริง โหลด/สลับเวอร์ชันได้แบบ thread-safe"""

    def __init__(self) -> None:
        self._model: Pipeline | None = None
        self.version: int = 0
        self._lock = threading.RLock()

    @property
    def ready(self) -> bool:
        return self._model is not None

    def load(self, path: str | Path, version: int) -> None:
        with open(path, "rb") as f:
            model = pickle.load(f)
        with self._lock:
            self._model, self.version = model, version

    def set(self, model: Pipeline, version: int) -> None:
        with self._lock:
            self._model, self.version = model, version

    @staticmethod
    def save(model: Pipeline, version: int) -> Path:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        path = MODEL_DIR / f"intent_v{version}.pkl"
        with open(path, "wb") as f:
            pickle.dump(model, f)
        return path

    def predict(self, text: str, top_k: int = 3) -> tuple[str, float, list[tuple[str, float]]]:
        with self._lock:
            model = self._model
        if model is None:
            return "unknown", 0.0, []
        proba = model.predict_proba([normalize(text)])[0]
        classes = model.classes_
        order = np.argsort(proba)[::-1][:top_k]
        top = [(str(classes[i]), round(float(proba[i]), 4)) for i in order]
        return top[0][0], top[0][1], top


intent_classifier = IntentClassifier()
