"""ระบบค้นคืนความรู้ (Retrieval) จากฐานความรู้ของสถานศึกษา

ใช้เฉพาะข้อมูลที่ผ่านการอนุมัติแล้ว (FAQ ที่ approved, ข่าวและหลักสูตรที่ published)
คะแนน = max(ความคล้ายกับคำถาม, 0.75 x ความคล้ายกับเนื้อหา) + โบนัสหมวดที่ตรงกับเจตนา + โบนัสคำสำคัญ
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import KnowledgeItem, News, Program
from .text import normalize


@dataclass
class Doc:
    key: str                      # เช่น kb:3, program:2, news:5
    type: str                     # faq | program | news
    ref_id: int
    category: str
    title: str
    match_text: str               # ข้อความที่ใช้จับคู่กับคำถาม
    content: str                  # เนื้อหาเต็ม
    answer_th: str
    answer_en: str
    image_url: str = ""
    video_url: str = ""
    keywords: list[str] = field(default_factory=list)


@dataclass
class Hit:
    doc: Doc
    score: float
    detail: dict[str, float]

    def as_dict(self) -> dict[str, Any]:
        return {"key": self.doc.key, "type": self.doc.type, "id": self.doc.ref_id, "title": self.doc.title,
                "category": self.doc.category, "score": round(self.score, 3)}


def _news_category(kind: str) -> str:
    return {"admission": "admission", "activity": "activity"}.get(kind, "news")


def collect_docs(db: Session) -> list[Doc]:
    docs: list[Doc] = []
    for k in db.query(KnowledgeItem).filter(KnowledgeItem.status == "approved").all():
        qs = [k.question] + [q for q in (k.alt_questions or "").splitlines() if q.strip()]
        docs.append(Doc(key=f"kb:{k.id}", type="faq", ref_id=k.id, category=k.category, title=k.question,
                        match_text="\n".join(qs), content=f"{k.answer_th}\n{k.answer_en}",
                        answer_th=k.answer_th, answer_en=k.answer_en or "", image_url=k.image_url, video_url=k.video_url))
    for p in db.query(Program).filter(Program.status == "published").all():
        kws = [w.strip().lower() for w in (p.keywords or "").split(",") if w.strip()]
        kws += [p.name_th.lower(), (p.name_en or "").lower()]
        lv = f" ระดับ {p.level}" if (p.level or "").strip() else ""      # 27 พ.ย. 2569: เดิมพูด "ระดับ ␣" เมื่อไม่มีข้อมูลระดับ
        a_th = f"สาขา{p.name_th}{lv} {p.description_th} จบแล้วทำงานเป็น {p.careers_th}".strip()
        a_en = f"{p.name_en} ({p.level}): {p.description_en} Careers: {p.careers_en}".strip()
        docs.append(Doc(key=f"program:{p.id}", type="program", ref_id=p.id, category="program",
                        title=f"สาขา{p.name_th}", match_text=f"สาขา{p.name_th} {p.name_en} {p.level} {' '.join(kws)}",
                        content=f"{p.description_th} {p.careers_th} {p.description_en}", answer_th=a_th, answer_en=a_en,
                        image_url=p.image_url, video_url=p.video_url, keywords=[k for k in kws if k]))
    now = datetime.now()
    q = db.query(News).filter(News.status == "published").filter(or_(News.publish_at.is_(None), News.publish_at <= now)) \
        .filter(or_(News.expire_at.is_(None), News.expire_at > now))
    for n in q.all():
        docs.append(Doc(key=f"news:{n.id}", type="news", ref_id=n.id, category=_news_category(n.kind), title=n.title_th,
                        match_text=f"{n.title_th} {n.title_en}", content=f"{n.body_th} {n.body_en}",
                        answer_th=f"{n.title_th} {n.body_th}", answer_en=f"{n.title_en}. {n.body_en}" if n.title_en else "",
                        image_url=n.image_url, video_url=n.video_url))
    return docs


class Retriever:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.docs: list[Doc] = []
        self._vec: TfidfVectorizer | None = None
        self._q_mat = None
        self._c_mat = None
        self.version = 0
        self.dirty = True
        self.built_at: datetime | None = None

    def mark_dirty(self) -> None:
        self.dirty = True

    def rebuild(self, db: Session) -> int:
        docs = collect_docs(db)
        with self._lock:
            self.docs = docs
            if docs:
                corpus = [normalize(d.match_text) for d in docs] + [normalize(d.content) for d in docs]
                vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True)
                vec.fit(corpus)
                self._vec = vec
                self._q_mat = vec.transform([normalize(d.match_text) for d in docs])
                self._c_mat = vec.transform([normalize(d.content) for d in docs])
            else:
                self._vec = None
            self.version += 1
            self.dirty = False
            self.built_at = datetime.now()
        return len(docs)

    def ensure(self, db: Session) -> None:
        if self.dirty:
            self.rebuild(db)

    def search(self, text: str, categories: list[str] | None = None, top_k: int = 4,
               types: list[str] | None = None) -> list[Hit]:
        with self._lock:
            if not self._vec or not self.docs:
                return []
            qn = normalize(text)
            qv = self._vec.transform([qn])
            s_q = (self._q_mat @ qv.T).toarray().ravel()
            s_c = (self._c_mat @ qv.T).toarray().ravel()
            hits: list[Hit] = []
            for i, d in enumerate(self.docs):
                if types and d.type not in types:
                    continue
                base = max(float(s_q[i]), 0.75 * float(s_c[i]))
                bonus_cat = 0.08 if categories and d.category in categories else 0.0
                bonus_kw = 0.0
                if d.keywords and any(k and len(k) >= 2 and k in qn for k in d.keywords):
                    bonus_kw = 0.25
                score = base + bonus_cat + bonus_kw
                hits.append(Hit(d, score, {"q": round(float(s_q[i]), 3), "c": round(float(s_c[i]), 3),
                                           "cat": bonus_cat, "kw": bonus_kw}))
            hits.sort(key=lambda h: h.score, reverse=True)
            return hits[:top_k]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_type: dict[str, int] = {}
            for d in self.docs:
                by_type[d.type] = by_type.get(d.type, 0) + 1
            return {"documents": len(self.docs), "by_type": by_type, "version": self.version,
                    "built_at": self.built_at.isoformat() if self.built_at else None, "dirty": self.dirty,
                    "vocabulary": len(self._vec.vocabulary_) if self._vec else 0}


retriever = Retriever()


def find_program(db: Session, text: str) -> Program | None:
    """หาสาขาที่ผู้ใช้พูดถึงจากชื่อหรือคำสำคัญ (เลือกคำที่ยาวที่สุดที่ตรง เพื่อลดการจับผิด)"""
    qn = normalize(text)
    best, best_len = None, 0
    for p in db.query(Program).filter(Program.status == "published").all():
        cands = [p.name_th, p.name_en, p.code] + [w for w in (p.keywords or "").split(",")]
        for c in cands:
            c = normalize(c or "")
            if len(c) >= 2 and c in qn and len(c) > best_len:
                if len(c) <= 3 and c.isascii() and f" {c} " not in f" {qn} ":
                    continue   # คำอังกฤษสั้น เช่น "it" ต้องเป็นคำเดี่ยว
                best, best_len = p, len(c)
    return best
