"""งาน A "สมองโปร่งใส" (21 พ.ย. 2569) — API หลังบ้านสำหรับดูขั้นตอนการตัดสินใจล่าสุด (สิทธิ์ viewer ขึ้นไป)"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import brain
from ..models import User
from ..security import require

router = APIRouter(prefix="/api/admin/brain", tags=["brain"])

# ชื่อด่าน Answer Guard 9 ข้อ (ภาษาไทยสำหรับจอแสดงผล) — ตรงกับหัวไฟล์ ai/guard.py
GUARD_CHECKS = [
    ["G1", "ชื่อสถานศึกษา"], ["G2", "หลักสูตร/สาขา/ระดับ"], ["G3", "สถานที่"], ["G4", "วันที่/เวลา"],
    ["G5", "ตัวเลข"], ["G6", "ข้อมูลติดต่อ"], ["G7", "ไม่รั่วคำสั่งระบบ"], ["G8", "ค่าตรงกับเรื่อง"], ["G9", "บุคลากร"],
]


@router.get("/recent")
def recent(n: int = 20, _: User = Depends(require("viewer"))):
    return {"enabled": brain.enabled(), "guard_checks": GUARD_CHECKS, "items": brain.recent(n)}
