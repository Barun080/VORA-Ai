"""API ควบคุมและตรวจสอบหุ่นยนต์สำหรับเจ้าหน้าที่"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import PatrolRoute, User
from ..robot.bridge import RobotError, bridge
from ..robot.protocol import GESTURES, MAX_DISTANCE_CM, MAX_SPEED, PROTOCOL_VERSION, WATCHDOG_MS
from ..security import require
from ..services import audit

router = APIRouter(prefix="/api/robot", tags=["robot"])


class CommandIn(BaseModel):
    command: dict[str, Any]
    wait: bool = True


class FlagIn(BaseModel):
    enabled: bool


class DriverIn(BaseModel):
    driver: str


class RouteIn(BaseModel):
    name: str
    steps: list[dict[str, Any]]
    active: bool = True


def _err(e: RobotError):
    raise HTTPException(409, {"code": e.code, "message": e.msg})


@router.get("/status")
def status(_: User = Depends(require("viewer"))):
    return {**bridge.public_status(), "events": list(bridge.events)[:40]}


@router.get("/capabilities")
def capabilities(_: User = Depends(require("viewer"))):
    return {"protocol": PROTOCOL_VERSION, "gestures": {k: v[0] for k, v in GESTURES.items()},
            "limits": {"max_speed": MAX_SPEED, "max_distance_cm": MAX_DISTANCE_CM, "watchdog_ms": WATCHDOG_MS}}


@router.post("/command")
async def command(body: CommandIn, user: User = Depends(require("editor"))):
    try:
        res = await bridge.execute(body.command, wait=body.wait, source=f"staff:{user.username}")
    except RobotError as e:
        _err(e)
    return res


@router.post("/stop")
async def stop(user: User = Depends(require("viewer"))):
    await bridge.stop(f"staff:{user.username}")
    return {"ok": True}


@router.post("/estop-reset")
async def estop_reset(user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    try:
        res = await bridge.execute({"cmd": "estop_reset"}, source=f"staff:{user.username}")
    except RobotError as e:
        _err(e)
    audit(db, user.username, "estop_reset", "robot")
    db.commit()
    return res


@router.post("/motion")
def set_motion(body: FlagIn, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    bridge.motion_enabled = body.enabled
    audit(db, user.username, "motion_enabled" if body.enabled else "motion_disabled", "robot")
    db.commit()
    return {"motion_enabled": bridge.motion_enabled}


@router.post("/driver")
async def set_driver(body: DriverIn, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    if body.driver not in ("simulator", "serial", "websocket"):
        raise HTTPException(400, "driver ไม่ถูกต้อง")
    await bridge.switch_driver(body.driver)
    audit(db, user.username, "switch_driver", "robot", body.driver)
    db.commit()
    return {"driver": bridge.driver_kind}


# ------------------------------------------------------------ เส้นทางเดินประชาสัมพันธ์
@router.get("/routes")
def routes(db: Session = Depends(get_db), _: User = Depends(require("viewer"))):
    return [{"id": r.id, "name": r.name, "steps": r.steps, "active": r.active} for r in db.query(PatrolRoute).all()]


@router.post("/routes")
def create_route(body: RouteIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    r = PatrolRoute(name=body.name, steps=body.steps, active=body.active)
    db.add(r)
    db.flush()
    audit(db, user.username, "create", "patrol_route", r.id)
    db.commit()
    return {"id": r.id}


@router.put("/routes/{rid}")
def update_route(rid: int, body: RouteIn, user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    r = db.get(PatrolRoute, rid)
    if not r:
        raise HTTPException(404, "ไม่พบเส้นทาง")
    r.name, r.steps, r.active = body.name, body.steps, body.active
    audit(db, user.username, "update", "patrol_route", rid)
    db.commit()
    return {"ok": True}


@router.delete("/routes/{rid}")
def delete_route(rid: int, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    r = db.get(PatrolRoute, rid)
    if r:
        db.delete(r)
        audit(db, user.username, "delete", "patrol_route", rid)
        db.commit()
    return {"ok": True}


@router.post("/routes/{rid}/run")
async def run_route(rid: int, lang: str = "th", user: User = Depends(require("editor")), db: Session = Depends(get_db)):
    r = db.get(PatrolRoute, rid)
    if not r:
        raise HTTPException(404, "ไม่พบเส้นทาง")
    try:
        bridge.start_patrol(r.name, r.steps, lang)
    except RobotError as e:
        _err(e)
    audit(db, user.username, "run", "patrol_route", rid)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------ เครื่องมือหุ่นจำลอง (สาธิตการหลบสิ่งกีดขวาง ฯลฯ)
@router.post("/sim/obstacle")
def sim_obstacle(distance: float = 90, _: User = Depends(require("editor"))):
    try:
        return bridge.sim().add_obstacle_ahead(distance)
    except RobotError as e:
        _err(e)


@router.post("/sim/clear")
def sim_clear(_: User = Depends(require("editor"))):
    try:
        bridge.sim().clear_temp_obstacles()
    except RobotError as e:
        _err(e)
    return {"ok": True}


@router.post("/sim/reset")
def sim_reset(_: User = Depends(require("editor"))):
    try:
        bridge.sim().reset_pose()
    except RobotError as e:
        _err(e)
    return {"ok": True}


@router.post("/sim/estop")
def sim_estop(_: User = Depends(require("editor"))):
    try:
        bridge.sim().press_estop()
    except RobotError as e:
        _err(e)
    return {"ok": True}
