"""สวิตช์เลือกโมเดล AI จากหลังบ้าน (22 พ.ย. 2569) — ดูสถานะ: viewer · เปลี่ยน: admin (บันทึก audit ไม่มีคีย์)"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..ai import providers
from ..db import get_db
from ..models import User
from ..security import require
from ..services import audit, set_setting

router = APIRouter(prefix="/api/admin/ai/models", tags=["ai-models"])


class ChoiceIn(BaseModel):
    mode: str = "custom"                       # custom | env (ตามไฟล์ .env)
    primary: Optional[str] = None
    fallback: Optional[str] = "none"
    models: dict[str, str] = {}


@router.get("")
async def get_models(_: User = Depends(require("viewer"))):
    return providers.describe(await providers.ollama_models())


@router.post("")
async def set_models(body: ChoiceIn, db: Session = Depends(get_db), user: User = Depends(require("admin"))):
    choice: dict[str, Any] = body.model_dump()
    try:
        clean = providers.apply(choice)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    set_setting(db, providers.SETTING_KEY, None if clean["mode"] == "env" else clean)
    audit(db, user.username, "ai_model_switch", "ai", "", mode=clean["mode"], primary=clean.get("primary"),
          fallback=clean.get("fallback"), models=clean.get("models", {}))
    db.commit()
    return providers.describe(await providers.ollama_models())


@router.post("/reload")
async def reload_keys(db: Session = Depends(get_db), user: User = Depends(require("admin"))):
    """อ่าน VORA_KEY_* จาก .env ใหม่ แล้วใช้กับค่าที่เลือกอยู่ (ไม่ต้องรีสตาร์ต)"""
    try:
        providers.apply(providers.current())
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    audit(db, user.username, "ai_model_reload_keys", "ai", "")
    db.commit()
    return providers.describe(await providers.ollama_models())
