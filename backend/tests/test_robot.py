"""ทดสอบ Robot Integration Layer และหุ่นยนต์จำลอง: การเคลื่อนที่ 4 สถานการณ์ตามเกณฑ์ ความปลอดภัย และการเดินประชาสัมพันธ์"""
import time

import pytest

from app.robot.protocol import ProtocolError, validate_command


def cmd(client, h, command, expect=200):
    r = client.post("/api/robot/command", headers=h, json={"command": command})
    assert r.status_code == expect, r.text
    return r.json()


def status(client, h):
    return client.get("/api/robot/status", headers=h).json()


def wait_idle(client, h, timeout=8):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if status(client, h).get("state") == "idle":
            return
        time.sleep(0.1)


@pytest.fixture(autouse=True)
def reset_sim(client, admin_headers):
    client.post("/api/robot/stop", headers=admin_headers)
    time.sleep(0.2)
    client.post("/api/robot/sim/reset", headers=admin_headers)
    s = status(client, admin_headers)
    if s.get("estop"):
        client.post("/api/robot/estop-reset", headers=admin_headers)
    time.sleep(0.6)
    wait_idle(client, admin_headers)
    yield


def test_protocol_rejects_unsafe_commands():
    with pytest.raises(ProtocolError):
        validate_command({"cmd": "move", "dir": "forward", "distance_cm": 1000})
    with pytest.raises(ProtocolError):
        validate_command({"cmd": "move", "dir": "forward", "distance_cm": 50, "speed": 2})
    with pytest.raises(ProtocolError):
        validate_command({"cmd": "gesture", "name": "backflip"})
    assert validate_command({"cmd": "turn", "dir": "left", "angle": 90})["angle"] == 90


def test_situation1_forward_and_backward(client, admin_headers):
    x0 = status(client, admin_headers)["pose"]["x"]
    cmd(client, admin_headers, {"cmd": "move", "dir": "forward", "distance_cm": 50, "speed": 0.5})
    time.sleep(0.6)
    x1 = status(client, admin_headers)["pose"]["x"]
    assert x1 - x0 == pytest.approx(50, abs=4)
    cmd(client, admin_headers, {"cmd": "move", "dir": "backward", "distance_cm": 30, "speed": 0.5})
    time.sleep(0.6)
    assert status(client, admin_headers)["pose"]["x"] == pytest.approx(x1 - 30, abs=4)


def test_situation2_turn_left_and_right(client, admin_headers):
    cmd(client, admin_headers, {"cmd": "turn", "dir": "left", "angle": 90, "speed": 0.5})
    time.sleep(0.6)
    assert status(client, admin_headers)["pose"]["th"] == pytest.approx(270, abs=3)
    cmd(client, admin_headers, {"cmd": "turn", "dir": "right", "angle": 180, "speed": 0.5})
    time.sleep(0.6)
    assert status(client, admin_headers)["pose"]["th"] == pytest.approx(90, abs=3)


def test_situation3_obstacle_avoidance(client, admin_headers):
    client.post("/api/robot/sim/obstacle?distance=90", headers=admin_headers)
    before = status(client, admin_headers)["avoid_count"]
    cmd(client, admin_headers, {"cmd": "move", "dir": "forward", "distance_cm": 160, "speed": 0.5})
    time.sleep(0.6)
    st = status(client, admin_headers)
    assert st["avoid_count"] == before + 1
    names = [e.get("name") for e in st["events"]]
    assert "obstacle_detected" in names and "obstacle_avoided" in names
    assert st["pose"]["th"] == pytest.approx(0, abs=1)        # กลับมาแนวเดิมหลังหลบ


def test_situation4_body_part_gestures(client, admin_headers):
    r = client.post("/api/robot/command", headers=admin_headers, json={"command": {"cmd": "gesture", "name": "wave"}, "wait": False})
    assert r.status_code == 200
    time.sleep(1.0)
    assert status(client, admin_headers)["joints"]["arm_r"] > 60      # แขนขวายกขึ้นระหว่างโบกมือ
    wait_idle(client, admin_headers)
    cmd(client, admin_headers, {"cmd": "head", "pan": 30, "tilt": 10})
    time.sleep(0.6)
    assert status(client, admin_headers)["joints"]["head_pan"] == 30


def test_stop_interrupts_motion(client, admin_headers):
    client.post("/api/robot/command", headers=admin_headers,
                json={"command": {"cmd": "move", "dir": "forward", "distance_cm": 200, "speed": 0.2}, "wait": False})
    time.sleep(0.5)
    assert client.post("/api/robot/stop").status_code == 200        # ปุ่มหยุดไม่ต้องเข้าสู่ระบบ
    time.sleep(0.6)
    st = status(client, admin_headers)
    assert st["state"] == "idle" and not st["busy"]


def test_estop_blocks_commands_until_reset(client, admin_headers):
    client.post("/api/robot/sim/estop", headers=admin_headers)
    time.sleep(0.7)
    r = cmd(client, admin_headers, {"cmd": "gesture", "name": "nod"}, expect=409)
    assert r["detail"]["code"] == "ESTOP"
    assert client.post("/api/robot/estop-reset", headers=admin_headers).status_code == 200
    time.sleep(0.7)
    cmd(client, admin_headers, {"cmd": "gesture", "name": "nod"})


def test_motion_can_be_disabled(client, admin_headers):
    client.post("/api/robot/motion", headers=admin_headers, json={"enabled": False})
    r = cmd(client, admin_headers, {"cmd": "move", "dir": "forward", "distance_cm": 20}, expect=409)
    assert r["detail"]["code"] == "MOTION_DISABLED"
    cmd(client, admin_headers, {"cmd": "gesture", "name": "nod"})       # ท่าทางที่ไม่เคลื่อนฐานยังทำได้
    client.post("/api/robot/motion", headers=admin_headers, json={"enabled": True})


def test_patrol_runs_and_blocks_manual_motion(client, admin_headers):
    assert client.post("/api/robot/routes/1/run", headers=admin_headers).status_code == 200
    time.sleep(0.4)
    assert status(client, admin_headers)["patrol"]
    r = cmd(client, admin_headers, {"cmd": "turn", "dir": "left", "angle": 30}, expect=409)
    assert r["detail"]["code"] == "BUSY"
    client.post("/api/robot/stop", headers=admin_headers)
    time.sleep(0.4)
    assert status(client, admin_headers)["patrol"] == ""


def test_viewer_cannot_command(client, admin_headers):
    client.post("/api/admin/users", headers=admin_headers,
                json={"username": "viewer1", "password": "viewer1234", "role": "viewer"})
    tok = client.post("/api/auth/login", json={"username": "viewer1", "password": "viewer1234"}).json()["token"]
    r = client.post("/api/robot/command", headers={"Authorization": f"Bearer {tok}"},
                    json={"command": {"cmd": "gesture", "name": "wave"}})
    assert r.status_code == 403
