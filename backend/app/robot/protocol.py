"""สัญญาการเชื่อมต่อ (Interface Contract) ระหว่างซอฟต์แวร์ VORA กับตัวควบคุมหุ่นยนต์ — VORA Robot Protocol v1

รูปแบบ: JSON 1 ข้อความต่อ 1 บรรทัด (ลงท้าย \\n) ผ่าน Serial (USB/UART) หรือ WebSocket (text frame)
รายละเอียดฉบับเต็มอยู่ใน docs/robot-protocol.md
"""
from __future__ import annotations

from typing import Any

PROTOCOL_VERSION = 1

# ขีดจำกัดความปลอดภัยฝั่งซอฟต์แวร์ (ฝั่งบอร์ดต้องมีขีดจำกัดของตัวเองซ้ำอีกชั้น)
MAX_SPEED = 0.6                # ความเร็วแบบ normalize 0..1 (1 = ความเร็วสูงสุดที่ฮาร์ดแวร์กำหนด)
MAX_DISTANCE_CM = 300          # ระยะสูงสุดต่อคำสั่ง ห้ามมีคำสั่ง "เดินไปเรื่อยๆ"
MAX_TURN_DEG = 360
WATCHDOG_MS = 1000             # บอร์ดต้องหยุดเองถ้าไม่ได้รับ heartbeat เกินเวลานี้

GESTURES = {
    # ชื่อท่า: (คำอธิบาย, เวลาโดยประมาณ ms, ต้องเคลื่อนฐานหรือไม่)
    "idle": ("ท่ายืนพัก", 300, False),
    "wave": ("โบกมือทักทาย", 2200, False),
    "bow": ("ไหว้/คำนับ", 2000, False),
    "nod": ("พยักหน้า", 1200, False),
    "shake": ("ส่ายหน้า", 1200, False),
    "present": ("ผายมือนำเสนอ", 1800, False),
    "point_screen": ("ชี้ไปที่หน้าจอ", 1500, False),
    "point_direction": ("ชี้บอกทาง", 1500, False),
    "explain": ("ขยับมือขณะอธิบาย", 1600, False),
    "think": ("ท่าครุ่นคิด", 1200, False),
    "happy": ("ท่าดีใจ ยกแขนสองข้าง", 1800, False),
    "shrug": ("ยักไหล่ (ไม่มีข้อมูล)", 1400, False),
    "listen": ("เอียงหัวฟัง", 800, False),
    "dance": ("เต้น", 4000, True),
    "spin": ("หมุนรอบตัว 360 องศา", 3500, True),
}

COMMANDS = {"hello", "status", "move", "turn", "gesture", "head", "led", "stop", "estop_reset", "hb"}
ERROR_CODES = {"INVALID", "BUSY", "OBSTACLE", "ESTOP", "WATCHDOG", "LOW_BATTERY", "TIMEOUT", "HW_FAULT", "DISCONNECTED"}


class ProtocolError(ValueError):
    pass


def _num(v: Any, name: str, lo: float, hi: float) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ProtocolError(f"{name} ต้องเป็นตัวเลข")
    if not lo <= f <= hi:
        raise ProtocolError(f"{name} ต้องอยู่ระหว่าง {lo} ถึง {hi}")
    return f


def validate_command(cmd: dict[str, Any]) -> dict[str, Any]:
    """ตรวจสอบและทำความสะอาดคำสั่งก่อนส่งให้หุ่นยนต์ (ปฏิเสธค่าที่เกินขีดจำกัดความปลอดภัย)"""
    name = cmd.get("cmd")
    if name not in COMMANDS:
        raise ProtocolError(f"ไม่รู้จักคำสั่ง {name}")
    out: dict[str, Any] = {"cmd": name}
    if name == "move":
        d = cmd.get("dir", "forward")
        if d not in ("forward", "backward"):
            raise ProtocolError("dir ต้องเป็น forward หรือ backward")
        out.update(dir=d, distance_cm=round(_num(cmd.get("distance_cm", 50), "distance_cm", 1, MAX_DISTANCE_CM), 1),
                   speed=round(_num(cmd.get("speed", 0.3), "speed", 0.05, MAX_SPEED), 2))
    elif name == "turn":
        d = cmd.get("dir", "left")
        if d not in ("left", "right"):
            raise ProtocolError("dir ต้องเป็น left หรือ right")
        out.update(dir=d, angle=round(_num(cmd.get("angle", 90), "angle", 1, MAX_TURN_DEG), 1),
                   speed=round(_num(cmd.get("speed", 0.3), "speed", 0.05, MAX_SPEED), 2))
    elif name == "gesture":
        g = cmd.get("name")
        if g not in GESTURES:
            raise ProtocolError(f"ไม่รู้จักท่าทาง {g}")
        out["name"] = g
    elif name == "head":
        out.update(pan=round(_num(cmd.get("pan", 0), "pan", -90, 90)), tilt=round(_num(cmd.get("tilt", 0), "tilt", -30, 30)))
    elif name == "led":
        out.update(color=str(cmd.get("color", "#00AEEF"))[:9], mode=str(cmd.get("mode", "solid"))[:12])
    return out


def is_motion(cmd: dict[str, Any]) -> bool:
    return cmd.get("cmd") in ("move", "turn") or (cmd.get("cmd") == "gesture" and GESTURES.get(cmd.get("name", ""), ("", 0, False))[2])


LINEAR_CM_S_AT_FULL = 100.0      # ความเร็ว 1.0 ≈ 100 ซม./วินาที (ฮาร์ดแวร์จริงให้ปรับตามที่วัดได้)
ANGULAR_DEG_S_AT_FULL = 300.0    # ความเร็ว 1.0 ≈ 300 องศา/วินาที


def estimate_duration_ms(cmd: dict[str, Any]) -> int:
    """ประมาณเวลาที่คำสั่งควรเสร็จ ใช้ตั้ง timeout"""
    c = cmd.get("cmd")
    if c == "move":
        return int(cmd["distance_cm"] / (LINEAR_CM_S_AT_FULL * cmd["speed"]) * 1000)
    if c == "turn":
        return int(cmd["angle"] / (ANGULAR_DEG_S_AT_FULL * cmd["speed"]) * 1000)
    if c == "gesture":
        return GESTURES[cmd["name"]][1]
    return 300
