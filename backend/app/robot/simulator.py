"""หุ่นยนต์จำลอง (Virtual Robot) ที่พูดภาษา VORA Robot Protocol v1 เหมือนบอร์ดจริงทุกประการ

ใช้พัฒนาและทดสอบซอฟต์แวร์ได้ก่อนฮาร์ดแวร์เสร็จ และใช้สาธิตการทำงานบนหน้าจอ
จำลอง: ตำแหน่ง/ทิศทางในห้อง 2 มิติ, เซนเซอร์วัดระยะด้านหน้า, การหลบหลีกสิ่งกีดขวาง,
มุมข้อต่อแขน/หัวระหว่างทำท่าทาง, แบตเตอรี่, ปุ่มหยุดฉุกเฉิน และ watchdog ของ heartbeat
"""
from __future__ import annotations

import asyncio
import json
import math
import random
import time
from typing import Any

from .protocol import (ANGULAR_DEG_S_AT_FULL, GESTURES, LINEAR_CM_S_AT_FULL, PROTOCOL_VERSION, WATCHDOG_MS)

TICK = 0.05
ROOM_W, ROOM_H = 800.0, 500.0         # ขนาดห้องจำลอง (ซม.)
ROBOT_R = 25.0                        # รัศมีฐานหุ่นยนต์ (ซม.)
SAFE_DIST = 45.0                      # ระยะที่เริ่มหลบสิ่งกีดขวาง (ซม.)
SENSOR_RANGE = 300.0


class VirtualRobot:
    def __init__(self) -> None:
        self.x, self.y, self.th = 200.0, 250.0, 0.0           # th = องศา, 0 = หันไปทางขวา (แกน x)
        self.home = (self.x, self.y, self.th)
        self.obstacles: list[dict[str, float]] = [
            {"x": 520, "y": 210, "w": 60, "h": 80, "id": 1},  # โต๊ะประชาสัมพันธ์
            {"x": 120, "y": 60, "w": 140, "h": 40, "id": 2},  # บอร์ดนิทรรศการ
        ]
        self.battery = 100.0
        self.estop = False
        self.state = "idle"
        self.joints = {"arm_l": 0.0, "arm_r": 0.0, "head_pan": 0.0, "head_tilt": 0.0}
        self.led = {"color": "#00AEEF", "mode": "solid"}
        self.current: dict[str, Any] | None = None
        self.queue_out: asyncio.Queue[str] = asyncio.Queue()
        self.last_hb = time.time()
        self.task: asyncio.Task | None = None
        self.odometer_cm = 0.0
        self.avoid_count = 0
        self._last_status = 0.0
        self.obstacle_cm = SENSOR_RANGE

    # ------------------------------------------------------------------ I/O ตามโปรโตคอล
    def start(self) -> None:
        if not self.task or self.task.done():
            self.task = asyncio.create_task(self._loop())

    async def stop_loop(self) -> None:
        if self.task:
            self.task.cancel()

    def _emit(self, obj: dict[str, Any]) -> None:
        self.queue_out.put_nowait(json.dumps(obj, ensure_ascii=False))

    async def receive_line(self, line: str) -> None:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            self._emit({"type": "error", "id": None, "code": "INVALID", "msg": "bad json"})
            return
        c, mid = msg.get("cmd"), msg.get("id")
        if c == "hb":
            self.last_hb = time.time()
            return
        if c == "hello":
            self._emit({"type": "hello", "id": mid, "fw": "vora-sim-1.0", "protocol": PROTOCOL_VERSION,
                        "caps": {"move": True, "turn": True, "gesture": sorted(GESTURES), "head": True, "led": True,
                                 "obstacle_sensor": "ultrasonic-sim", "estop": True}})
            return
        if c == "status":
            self._emit(self.status())
            return
        if c == "stop":
            self._halt("stopped")
            self._emit({"type": "ack", "id": mid, "ok": True})
            self._emit({"type": "done", "id": mid})
            return
        if c == "estop_reset":
            self.estop = False
            self.state = "idle"
            self._emit({"type": "ack", "id": mid, "ok": True})
            self._emit({"type": "done", "id": mid})
            return
        if self.estop:
            self._emit({"type": "error", "id": mid, "code": "ESTOP", "msg": "emergency stop active"})
            return
        if self.battery < 5:
            self._emit({"type": "error", "id": mid, "code": "LOW_BATTERY", "msg": "battery too low"})
            return
        if c in ("move", "turn", "gesture"):
            if self.current is not None:
                self._emit({"type": "error", "id": mid, "code": "BUSY", "msg": "another command running"})
                return
            self.current = {**msg, "t0": time.time(), "progress": 0.0, "phase": "main"}
            self.state = "moving" if c in ("move", "turn") or GESTURES.get(msg.get("name", ""), ("", 0, False))[2] else "gesturing"
            self._emit({"type": "ack", "id": mid, "ok": True})
            return
        if c == "head":
            self.joints["head_pan"], self.joints["head_tilt"] = float(msg.get("pan", 0)), float(msg.get("tilt", 0))
            self._emit({"type": "ack", "id": mid, "ok": True})
            self._emit({"type": "done", "id": mid})
            return
        if c == "led":
            self.led = {"color": msg.get("color", "#00AEEF"), "mode": msg.get("mode", "solid")}
            self._emit({"type": "ack", "id": mid, "ok": True})
            self._emit({"type": "done", "id": mid})
            return
        self._emit({"type": "error", "id": mid, "code": "INVALID", "msg": f"unknown cmd {c}"})

    # ------------------------------------------------------------------ การจำลองทางฟิสิกส์
    def press_estop(self) -> None:
        self.estop = True
        self._halt("estop")
        self._emit({"type": "event", "name": "estop_pressed"})

    def add_obstacle_ahead(self, dist: float = 90.0) -> dict[str, float]:
        """วางสิ่งกีดขวาง (เช่น คนเดินตัดหน้า) ไว้ด้านหน้าหุ่นยนต์ ใช้สาธิตการหลบหลีก"""
        rad = math.radians(self.th)
        cx, cy = self.x + math.cos(rad) * dist, self.y + math.sin(rad) * dist
        ob = {"x": cx - 20, "y": cy - 20, "w": 40, "h": 40, "id": random.randint(100, 9999), "temp": True}
        self.obstacles.append(ob)
        return ob

    def clear_temp_obstacles(self) -> None:
        self.obstacles = [o for o in self.obstacles if not o.get("temp")]

    def reset_pose(self) -> None:
        self._halt("idle")
        self.x, self.y, self.th = self.home
        self.clear_temp_obstacles()

    def _halt(self, state: str) -> None:
        if self.current is not None:
            mid = self.current.get("id")
            if state in ("estop", "watchdog"):
                self._emit({"type": "error", "id": mid, "code": "ESTOP" if state == "estop" else "WATCHDOG", "msg": state})
            else:
                self._emit({"type": "done", "id": mid, "interrupted": True})
        self.current = None
        self.state = "estop" if self.estop else ("idle" if state in ("stopped", "idle") else state)
        for k in ("arm_l", "arm_r"):
            self.joints[k] = 0.0

    def _ray(self, angle_deg: float) -> float:
        rad = math.radians(angle_deg)
        dx, dy = math.cos(rad), math.sin(rad)
        step = 4.0
        d = 0.0
        while d < SENSOR_RANGE:
            px, py = self.x + dx * (d + ROBOT_R), self.y + dy * (d + ROBOT_R)
            if px <= 0 or py <= 0 or px >= ROOM_W or py >= ROOM_H:
                return d
            for o in self.obstacles:
                if o["x"] <= px <= o["x"] + o["w"] and o["y"] <= py <= o["y"] + o["h"]:
                    return d
            d += step
        return SENSOR_RANGE

    def _tick(self, dt: float) -> None:
        self.obstacle_cm = round(self._ray(self.th), 1)
        cur = self.current
        if cur is None:
            for k in ("arm_l", "arm_r"):
                self.joints[k] *= 0.8
            return
        c = cur["cmd"]
        speed = float(cur.get("speed", 0.3))
        elapsed = time.time() - cur["t0"]
        if c == "move":
            if cur["phase"] == "main":
                sign = 1 if cur.get("dir") == "forward" else -1
                if sign > 0 and self.obstacle_cm < SAFE_DIST:
                    # เริ่มหลบหลีก: เลือกฝั่งที่โล่งกว่า หมุน 60 องศา เดินอ้อม แล้วหมุนกลับแนวเดิม
                    left, right = self._ray(self.th - 60), self._ray(self.th + 60)
                    side = -1 if left > right else 1
                    if max(left, right) < SAFE_DIST:
                        self._emit({"type": "event", "name": "obstacle_blocked", "obstacle_cm": self.obstacle_cm})
                        self._emit({"type": "error", "id": cur.get("id"), "code": "OBSTACLE", "msg": "path blocked"})
                        self.current, self.state = None, "idle"
                        return
                    self._emit({"type": "event", "name": "obstacle_detected", "obstacle_cm": self.obstacle_cm,
                                "avoid_side": "left" if side < 0 else "right"})
                    cur.update(phase="avoid_turn", side=side, turned=0.0, avoid_leg=0.0, heading=self.th)
                    return
                v = LINEAR_CM_S_AT_FULL * speed * dt
                remaining = cur["distance_cm"] - cur["progress"]
                v = min(v, remaining)
                self._advance(sign * v)
                cur["progress"] += v
                if cur["progress"] >= cur["distance_cm"] - 0.01:
                    self._finish()
            elif cur["phase"] == "avoid_turn":
                w = ANGULAR_DEG_S_AT_FULL * 0.4 * dt
                self.th = (self.th + cur["side"] * w) % 360
                cur["turned"] += w
                if cur["turned"] >= 60:
                    cur["phase"] = "avoid_leg"
            elif cur["phase"] == "avoid_leg":
                v = LINEAR_CM_S_AT_FULL * speed * dt
                if self._ray(self.th) < ROBOT_R:
                    cur["avoid_leg"] = 999
                else:
                    self._advance(v)
                    cur["avoid_leg"] += v
                if cur["avoid_leg"] >= 70:
                    cur["phase"] = "avoid_back"
                    cur["turned"] = 0.0
            elif cur["phase"] == "avoid_back":
                w = ANGULAR_DEG_S_AT_FULL * 0.4 * dt
                self.th = (self.th - cur["side"] * w) % 360
                cur["turned"] += w
                if cur["turned"] >= 60:
                    self.th = cur["heading"]
                    cur["phase"] = "main"
                    cur["progress"] += 35      # ระยะที่ได้ตามแนวเดิมจากการเดินอ้อม (70 x cos60)
                    self.avoid_count += 1
                    self._emit({"type": "event", "name": "obstacle_avoided", "count": self.avoid_count})
                    if cur["progress"] >= cur["distance_cm"]:
                        self._finish()
        elif c == "turn":
            w = ANGULAR_DEG_S_AT_FULL * speed * dt
            remaining = cur["angle"] - cur["progress"]
            w = min(w, remaining)
            self.th = (self.th + (-w if cur.get("dir") == "left" else w)) % 360
            cur["progress"] += w
            if cur["progress"] >= cur["angle"] - 0.01:
                self._finish()
        elif c == "gesture":
            name = cur.get("name", "idle")
            dur = GESTURES.get(name, ("", 1000, False))[1] / 1000
            p = min(1.0, elapsed / dur)
            s = math.sin(p * math.pi)
            j = self.joints
            if name == "wave":
                j["arm_r"] = 150 * s
                j["arm_l"] = 0
                j["head_tilt"] = 8 * math.sin(elapsed * 9) * s
            elif name in ("bow",):
                j["head_tilt"] = -25 * s
                j["arm_l"] = j["arm_r"] = 35 * s
            elif name in ("nod",):
                j["head_tilt"] = 15 * math.sin(elapsed * 10) * s
            elif name in ("shake",):
                j["head_pan"] = 20 * math.sin(elapsed * 10) * s
            elif name in ("happy", "dance"):
                j["arm_l"] = j["arm_r"] = 120 * abs(math.sin(elapsed * 6)) * s + 20 * s
                if name == "dance":
                    self.th = (self.th + 40 * math.sin(elapsed * 4) * dt * 3) % 360
            elif name == "spin":
                self.th = (self.th + 360 / dur * dt) % 360
                j["arm_l"] = j["arm_r"] = 80 * s
            elif name in ("present", "point_screen", "point_direction", "explain"):
                j["arm_r"] = 75 * s
                j["arm_l"] = (40 * s) if name == "present" else 10 * math.sin(elapsed * 5) * s
            elif name == "shrug":
                j["arm_l"] = j["arm_r"] = 45 * s
                j["head_tilt"] = 10 * s
            elif name in ("think", "listen"):
                j["head_tilt"] = 12 * s
                j["head_pan"] = 10 * s
            if p >= 1.0:
                j["head_pan"] = j["head_tilt"] = 0.0
                self._finish()

    def _advance(self, dist: float) -> None:
        rad = math.radians(self.th)
        self.x = max(ROBOT_R, min(ROOM_W - ROBOT_R, self.x + math.cos(rad) * dist))
        self.y = max(ROBOT_R, min(ROOM_H - ROBOT_R, self.y + math.sin(rad) * dist))
        self.odometer_cm += abs(dist)

    def _finish(self) -> None:
        if self.current is not None:
            self._emit({"type": "done", "id": self.current.get("id")})
        self.current = None
        self.state = "idle"

    def status(self) -> dict[str, Any]:
        return {"type": "status", "state": self.state, "battery": round(self.battery, 1), "estop": self.estop,
                "obstacle_cm": self.obstacle_cm, "busy": self.current is not None,
                "pose": {"x": round(self.x, 1), "y": round(self.y, 1), "th": round(self.th, 1)},
                "joints": {k: round(v, 1) for k, v in self.joints.items()}, "led": self.led,
                "odometer_cm": round(self.odometer_cm), "avoid_count": self.avoid_count}

    def world(self) -> dict[str, Any]:
        return {"room": {"w": ROOM_W, "h": ROOM_H}, "robot_radius": ROBOT_R, "obstacles": self.obstacles}

    async def _loop(self) -> None:
        last = time.time()
        while True:
            await asyncio.sleep(TICK)
            now = time.time()
            dt = min(0.2, now - last)
            last = now
            try:
                self._tick(dt)
            except Exception as e:  # pragma: no cover - ไม่ให้ลูปจำลองตาย
                self._emit({"type": "event", "name": "hw_fault", "msg": str(e)})
                self.current = None
            busy = self.current is not None
            self.battery = max(0.0, self.battery - (0.004 if busy else 0.0008) * dt * 20)
            if busy and (now - self.last_hb) * 1000 > WATCHDOG_MS:
                self._emit({"type": "event", "name": "watchdog_stop"})
                self._halt("watchdog")
                self.state = "idle"
            if now - self._last_status >= (0.1 if busy else 0.5):
                self._last_status = now
                self._emit(self.status())
