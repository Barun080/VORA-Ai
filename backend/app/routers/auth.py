from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..security import create_token, current_user, hash_password, verify_password
from ..services import audit

router = APIRouter(prefix="/api/auth", tags=["auth"])

_failed: dict[str, list[float]] = {}


class LoginIn(BaseModel):
    username: str
    password: str


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str


def user_out(u: User) -> dict:
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "role": u.role, "active": u.active,
            "last_login_at": u.last_login_at}


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    import time

    attempts = [t for t in _failed.get(body.username, []) if time.time() - t < 300]
    if len(attempts) >= 5:
        raise HTTPException(429, "เข้าสู่ระบบผิดหลายครั้ง กรุณารอ 5 นาที")
    u = db.query(User).filter(User.username == body.username.strip()).first()
    if not u or not u.active or not verify_password(body.password, u.password_hash):
        _failed[body.username] = attempts + [time.time()]
        raise HTTPException(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
    _failed.pop(body.username, None)
    u.last_login_at = datetime.now()
    audit(db, u.username, "login", "user", u.id)
    db.commit()
    return {"token": create_token(u), "user": user_out(u)}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.post("/change-password")
def change_password(body: ChangePasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(body.old_password, user.password_hash):
        raise HTTPException(400, "รหัสผ่านเดิมไม่ถูกต้อง")
    if len(body.new_password) < 8:
        raise HTTPException(400, "รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร")
    u = db.get(User, user.id)
    u.password_hash = hash_password(body.new_password)
    audit(db, user.username, "change_password", "user", user.id)
    db.commit()
    return {"ok": True}
