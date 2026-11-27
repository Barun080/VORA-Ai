/*
 * VORA Robot Firmware — ต้นแบบอ้างอิง (Reference) สำหรับทีมฮาร์ดแวร์
 * ใช้ VORA Robot Protocol v1 (ดู docs/robot-protocol.md) ให้ซอฟต์แวร์สั่งงานได้ทันที
 *
 * บอร์ด: ESP32 DevKit (Arduino core 2.x/3.x)   ไลบรารี: ArduinoJson 7, ESP32Servo
 * ฮาร์ดแวร์ตัวอย่าง: มอเตอร์ DC 2 ล้อ + ไดรเวอร์ L298N/TB6612, เซอร์โวแขน 2 ตัว + หัว 1 ตัว,
 *                   อัลตราโซนิก HC-SR04 ด้านหน้า, ปุ่มหยุดฉุกเฉิน (NC), แบตเตอรี่ผ่านตัวแบ่งแรงดัน
 *
 * สำคัญ: ไฟล์นี้เป็นจุดเริ่มต้น ทีมฮาร์ดแวร์ต้องปรับขา (PIN) ค่าความเร็ว และทดสอบความปลอดภัยกับหุ่นจริงเอง
 * หลักความปลอดภัยที่ทำไว้ในบอร์ด (ไม่พึ่งคอมพิวเตอร์):
 *   1) Watchdog: ไม่ได้รับ heartbeat เกิน 1000 ms -> หยุดมอเตอร์ทันที
 *   2) สิ่งกีดขวางใกล้กว่า SAFE_CM ขณะเดินหน้า -> หยุด แล้วหลบหลีกเอง
 *   3) ปุ่มหยุดฉุกเฉิน -> ตัดการเคลื่อนที่จนกว่าจะได้คำสั่ง estop_reset
 *   4) จำกัดระยะ/ความเร็วสูงสุดต่อคำสั่ง
 */
#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ---------------- ขาต่อ (ปรับตามวงจรจริง) ----------------
const int PIN_L_IN1 = 25, PIN_L_IN2 = 26, PIN_L_PWM = 27;
const int PIN_R_IN1 = 14, PIN_R_IN2 = 12, PIN_R_PWM = 13;
const int PIN_TRIG = 5, PIN_ECHO = 18;
const int PIN_ESTOP = 4;            // ปุ่มแบบ NC ต่อลง GND, กดแล้วเป็น HIGH
const int PIN_SERVO_ARM_L = 19, PIN_SERVO_ARM_R = 21, PIN_SERVO_HEAD = 22;
const int PIN_BATT = 34;            // ADC ผ่านตัวแบ่งแรงดัน

// ---------------- ค่าคาลิเบรต (วัดจากหุ่นจริง) ----------------
const float CM_PER_SEC_AT_FULL = 100.0;   // ความเร็ว 1.0 เดินได้กี่ ซม./วินาที
const float DEG_PER_SEC_AT_FULL = 300.0;  // ความเร็ว 1.0 หมุนได้กี่องศา/วินาที
const float MAX_SPEED = 0.6, MAX_DIST = 300;
const int SAFE_CM = 45;
const unsigned long WATCHDOG_MS = 1000;

Servo armL, armR, head;
JsonDocument doc;

enum State { IDLE, MOVING, TURNING, GESTURING, AVOIDING, ESTOP };
State state = IDLE;
long curId = -1;
String curGesture;
unsigned long tStart = 0, tDuration = 0, lastHb = 0, lastStatus = 0;
int moveDir = 0;           // +1 เดินหน้า, -1 ถอยหลัง, สำหรับหมุน: -1 ซ้าย +1 ขวา
float moveSpeed = 0.3, remainingCm = 0;
int avoidPhase = 0, avoidSide = 1, avoidCount = 0;
float obstacleCm = 300;

// ---------------- มอเตอร์ ----------------
void motor(int in1, int in2, int pwm, float v) {
  int duty = (int)(fabs(v) * 255);
  digitalWrite(in1, v > 0); digitalWrite(in2, v < 0);
  analogWrite(pwm, duty);
}
void drive(float left, float right) { motor(PIN_L_IN1, PIN_L_IN2, PIN_L_PWM, left); motor(PIN_R_IN1, PIN_R_IN2, PIN_R_PWM, right); }
void stopMotors() { drive(0, 0); }

// ---------------- ส่งข้อความกลับ ----------------
void sendJson(JsonDocument &d) { serializeJson(d, Serial); Serial.print('\n'); }
void reply(const char *type, long id, const char *code = nullptr, const char *msg = nullptr) {
  JsonDocument r; r["type"] = type; r["id"] = id;
  if (!strcmp(type, "ack")) r["ok"] = true;
  if (code) r["code"] = code;
  if (msg) r["msg"] = msg;
  sendJson(r);
}
void event(const char *name) { JsonDocument r; r["type"] = "event"; r["name"] = name; r["obstacle_cm"] = obstacleCm; sendJson(r); }

float batteryPct() {
  float v = analogRead(PIN_BATT) / 4095.0 * 3.3 * 4.0;   // ตัวแบ่งแรงดัน 1:4 (ปรับตามวงจร)
  return constrain((v - 10.5) / (12.6 - 10.5) * 100.0, 0, 100);   // แบต 3S Li-ion
}

void sendStatus() {
  JsonDocument r;
  r["type"] = "status";
  const char *names[] = {"idle", "moving", "moving", "gesturing", "moving", "estop"};
  r["state"] = names[state];
  r["battery"] = batteryPct();
  r["estop"] = state == ESTOP;
  r["obstacle_cm"] = obstacleCm;
  r["busy"] = state != IDLE && state != ESTOP;
  r["avoid_count"] = avoidCount;
  JsonObject j = r["joints"].to<JsonObject>();
  j["arm_l"] = armL.read(); j["arm_r"] = armR.read(); j["head_pan"] = head.read() - 90;
  sendJson(r);
}

void finish(bool interrupted = false) {
  stopMotors();
  if (curId >= 0) { JsonDocument r; r["type"] = "done"; r["id"] = curId; if (interrupted) r["interrupted"] = true; sendJson(r); }
  curId = -1; state = state == ESTOP ? ESTOP : IDLE;
  armL.write(0); armR.write(180); head.write(90);
}

float readDistance() {
  digitalWrite(PIN_TRIG, LOW); delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10); digitalWrite(PIN_TRIG, LOW);
  long us = pulseIn(PIN_ECHO, HIGH, 20000);
  return us == 0 ? 300 : us / 58.0;
}

// ---------------- ท่าทาง (มุมเซอร์โวตามเวลา) ----------------
unsigned long gestureMs(const String &g) {
  if (g == "wave") return 2200; if (g == "bow") return 2000; if (g == "dance") return 4000; if (g == "spin") return 3500;
  if (g == "happy" || g == "present") return 1800; return 1300;
}
void updateGesture(float p, float t) {
  float s = sin(p * PI);
  if (curGesture == "wave") { armR.write(180 - 150 * s); }
  else if (curGesture == "happy" || curGesture == "dance") { armL.write(120 * s); armR.write(180 - 120 * s); if (curGesture == "dance") drive(0.25 * sin(t * 4), -0.25 * sin(t * 4)); }
  else if (curGesture == "bow") { head.write(90 - 25 * s); armL.write(35 * s); armR.write(180 - 35 * s); }
  else if (curGesture == "nod") { head.write(90 + 15 * sin(t * 10) * s); }
  else if (curGesture == "shake") { head.write(90 + 20 * sin(t * 10) * s); }
  else if (curGesture == "spin") { drive(0.35, -0.35); }
  else { armR.write(180 - 70 * s); }   // present / explain / point
}

// ---------------- รับคำสั่ง ----------------
void handle(const String &line) {
  doc.clear();
  if (deserializeJson(doc, line)) { reply("error", -1, "INVALID", "bad json"); return; }
  const char *cmd = doc["cmd"] | "";
  long id = doc["id"] | 0;
  if (!strcmp(cmd, "hb")) { lastHb = millis(); return; }
  if (!strcmp(cmd, "hello")) {
    JsonDocument r; r["type"] = "hello"; r["id"] = id; r["fw"] = "vora-esp32-1.0"; r["protocol"] = 1;
    JsonObject caps = r["caps"].to<JsonObject>(); caps["move"] = true; caps["turn"] = true; caps["head"] = true; caps["obstacle_sensor"] = "hc-sr04"; caps["estop"] = true;
    sendJson(r); return;
  }
  if (!strcmp(cmd, "status")) { sendStatus(); return; }
  if (!strcmp(cmd, "stop")) { finish(true); reply("ack", id); reply("done", id); return; }
  if (!strcmp(cmd, "estop_reset")) { if (digitalRead(PIN_ESTOP) == LOW) state = IDLE; reply("ack", id); reply("done", id); return; }
  if (state == ESTOP) { reply("error", id, "ESTOP", "emergency stop active"); return; }
  if (state != IDLE) { reply("error", id, "BUSY", "busy"); return; }
  if (batteryPct() < 5) { reply("error", id, "LOW_BATTERY"); return; }

  if (!strcmp(cmd, "move")) {
    moveDir = !strcmp(doc["dir"] | "forward", "backward") ? -1 : 1;
    moveSpeed = constrain((float)(doc["speed"] | 0.3), 0.05, MAX_SPEED);
    remainingCm = constrain((float)(doc["distance_cm"] | 50), 1, MAX_DIST);
    state = MOVING; curId = id; tStart = millis(); reply("ack", id);
  } else if (!strcmp(cmd, "turn")) {
    moveDir = !strcmp(doc["dir"] | "left", "left") ? -1 : 1;
    moveSpeed = constrain((float)(doc["speed"] | 0.3), 0.05, MAX_SPEED);
    float angle = constrain((float)(doc["angle"] | 90), 1, 360);
    tDuration = (unsigned long)(angle / (DEG_PER_SEC_AT_FULL * moveSpeed) * 1000);
    state = TURNING; curId = id; tStart = millis(); reply("ack", id);
  } else if (!strcmp(cmd, "gesture")) {
    curGesture = String((const char *)(doc["name"] | "wave"));
    tDuration = gestureMs(curGesture);
    state = GESTURING; curId = id; tStart = millis(); reply("ack", id);
  } else if (!strcmp(cmd, "head")) {
    head.write(90 + constrain((int)(doc["pan"] | 0), -90, 90)); reply("ack", id); reply("done", id);
  } else if (!strcmp(cmd, "led")) {
    reply("ack", id); reply("done", id);      // ต่อ LED strip ได้ตามต้องการ
  } else reply("error", id, "INVALID", "unknown cmd");
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_L_IN1, OUTPUT); pinMode(PIN_L_IN2, OUTPUT); pinMode(PIN_L_PWM, OUTPUT);
  pinMode(PIN_R_IN1, OUTPUT); pinMode(PIN_R_IN2, OUTPUT); pinMode(PIN_R_PWM, OUTPUT);
  pinMode(PIN_TRIG, OUTPUT); pinMode(PIN_ECHO, INPUT); pinMode(PIN_ESTOP, INPUT_PULLUP);
  armL.attach(PIN_SERVO_ARM_L); armR.attach(PIN_SERVO_ARM_R); head.attach(PIN_SERVO_HEAD);
  armL.write(0); armR.write(180); head.write(90);
  stopMotors();
  lastHb = millis();
}

String buf;
unsigned long lastLoop = 0;

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { if (buf.length()) handle(buf); buf = ""; }
    else if (buf.length() < 512) buf += c;
  }
  unsigned long now = millis();
  float dt = (now - lastLoop) / 1000.0; lastLoop = now;

  // ปุ่มหยุดฉุกเฉิน
  if (digitalRead(PIN_ESTOP) == HIGH && state != ESTOP) {
    long id = curId; stopMotors(); state = ESTOP;
    if (id >= 0) reply("error", id, "ESTOP", "button");
    curId = -1; event("estop_pressed");
  }
  // Watchdog: ซอฟต์แวร์เงียบเกินเวลา -> หยุด
  if (state != IDLE && state != ESTOP && now - lastHb > WATCHDOG_MS) {
    long id = curId; stopMotors(); state = IDLE; curId = -1;
    if (id >= 0) reply("error", id, "WATCHDOG", "no heartbeat");
    event("watchdog_stop");
  }

  obstacleCm = readDistance();
  float t = (now - tStart) / 1000.0;

  if (state == MOVING) {
    if (moveDir > 0 && obstacleCm < SAFE_CM) {         // เริ่มหลบหลีก: หมุน 60° เดินอ้อม 70 ซม. หมุนกลับ
      stopMotors(); event("obstacle_detected");
      state = AVOIDING; avoidPhase = 0; avoidSide = (avoidCount % 2) ? 1 : -1; tStart = now;
    } else {
      drive(moveDir * moveSpeed, moveDir * moveSpeed);
      remainingCm -= CM_PER_SEC_AT_FULL * moveSpeed * dt;
      if (remainingCm <= 0) finish();
    }
  } else if (state == AVOIDING) {
    unsigned long turnMs = (unsigned long)(60 / (DEG_PER_SEC_AT_FULL * 0.4) * 1000);
    unsigned long legMs = (unsigned long)(70 / (CM_PER_SEC_AT_FULL * moveSpeed) * 1000);
    unsigned long el = now - tStart;
    if (avoidPhase == 0) { drive(avoidSide * 0.4, -avoidSide * 0.4); if (el > turnMs) { avoidPhase = 1; tStart = now; } }
    else if (avoidPhase == 1) {
      if (obstacleCm < 25) { long id = curId; stopMotors(); reply("error", id, "OBSTACLE", "path blocked"); curId = -1; state = IDLE; event("obstacle_blocked"); }
      else { drive(moveSpeed, moveSpeed); if (el > legMs) { avoidPhase = 2; tStart = now; } }
    } else { drive(-avoidSide * 0.4, avoidSide * 0.4); if (el > turnMs) { avoidCount++; remainingCm -= 35; event("obstacle_avoided"); state = remainingCm > 0 ? MOVING : IDLE; if (state == IDLE) finish(); } }
  } else if (state == TURNING) {
    drive(moveDir * moveSpeed, -moveDir * moveSpeed);
    if (now - tStart >= tDuration) finish();
  } else if (state == GESTURING) {
    float p = min(1.0f, (float)(now - tStart) / tDuration);
    updateGesture(p, t);
    if (p >= 1.0) finish();
  }

  if (now - lastStatus > (state == IDLE ? 500UL : 150UL)) { lastStatus = now; sendStatus(); }
  delay(20);
}
