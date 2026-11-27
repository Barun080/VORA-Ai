// Camera & Visitor Controller — รวมงานกล้องและผู้เข้าชมไว้ที่เดียว แล้วสื่อสารออกไปด้วย Event เท่านั้น
// ใช้ของเดิมทั้งหมดโดยไม่แก้: CameraManager (วงจรชีวิตกล้อง) → VisionSystem/MediaPipe (shared/vision.js)
//                            VisitorTracker (Visitor Session + Tracking ID ชั่วคราว)
// ย้ายมาจาก startCamera() ใน app.js เดิม — ไม่ได้เขียนระบบกล้องใหม่
// ไม่ขึ้นกับโหมด Idle/Active ของหน้าจอ: กล้องและการตรวจจับทำงานต่อเนื่องตลอด

import { api } from "/shared/api.js";
import { EV } from "../core/event-bus.js";
import { CameraManager } from "./CameraManager.js";
import { VisitorTracker } from "./VisitorTracker.js";

export class CameraVisitorController {
  /**
   * bus: EventBus กลาง · video: <video> ที่ใช้รับภาพ
   * visitor: ค่าจาก KIOSK_CONFIG.visitor · camera: ค่าจาก KIOSK_CONFIG.camera
   * returnWindowMs(): ช่วงเวลาที่ถือว่า "คนเดิมกลับมา" (ใช้คูลดาวน์การทักทายจากเซิร์ฟเวอร์)
   */
  constructor(bus, video, { visitor, camera, returnWindowMs = () => 25000 }) {
    this.bus = bus;
    this.cfg = { visitor, camera };
    this.returnWindowMs = returnWindowMs;
    this.lastSessionEnd = 0;
    this.state = "idle";
    this.detail = "";
    this.stats = { faceFrames: 0, lastFrameAt: 0, sessions: 0, returned: 0 };

    // Hysteresis: ตัวตรวจจับส่งใบหน้าที่เล็กลงได้ถึง keepFaceRatio × minFaceWidth (คนที่ติดตามอยู่ไม่หลุดง่าย)
    // ส่วนการเริ่มนับคนใหม่ยังใช้ minFaceWidth เดิม (ระยะทักทายเท่าเดิม) — ไม่ได้แก้โมเดล/ตัวตรวจจับใน shared/vision.js
    const keep = Math.min(1, Math.max(0.5, visitor.keepFaceRatio || 1));
    this.tracker = new VisitorTracker({ ...visitor, minNewWidth: visitor.minFaceWidth }, {
      onSessionStart: (s) => this.onSessionStart(s),
      onSessionEnd: (s) => { this.lastSessionEnd = Date.now(); bus.emit(EV.VISITOR_LEFT, { session: s }); },
      onPersonJoin: (s, n) => bus.emit(EV.VISITOR_JOINED, { session: s, added: n }),
    });
    this.camera = new CameraManager(video, {
      onLook: (x, y) => bus.emit(EV.FACE_POSITION, { x, y }),
      onFaces: (faces, ts) => { this.stats.faceFrames++; this.stats.lastFrameAt = ts; this.tracker.update(faces, ts); },
      onGesture: (name, score) => bus.emit(EV.CAMERA_GESTURE, { name, score }),
      onSign: (label, prob) => bus.emit(EV.CAMERA_SIGN, { label, prob }),
    }, {
      retryMinMs: camera.retryMinMs, retryMaxMs: camera.retryMaxMs,
      visionOptions: { minFaceWidth: visitor.minFaceWidth * keep, arriveMs: visitor.arriveMs, leaveMs: visitor.leaveMs },
      onState: (state, detail) => {
        this.state = state; this.detail = detail;
        if (state !== "on") this.tracker.reset();
        bus.emit(EV.CAMERA_STATUS_CHANGED, { state, detail });
      },
    });
  }

  /** ผู้เข้าชมใหม่ vs คนเดิมเดินกลับมาในช่วงสั้น ๆ (ไม่ใช้การจดจำใบหน้า ใช้แค่ช่วงเวลา) */
  onSessionStart(session) {
    this.stats.sessions++;
    const gap = Date.now() - this.lastSessionEnd;
    if (this.lastSessionEnd && gap < this.returnWindowMs()) {
      this.stats.returned++;
      session.returned = true;
      this.bus.emit(EV.VISITOR_RETURNED, { session, gapMs: gap });
    } else {
      this.bus.emit(EV.VISITOR_DETECTED, { session, people: session.people });
    }
  }

  async start() {
    if (!this.cfg.camera.autoStart) return false;
    const ok = await this.camera.start();
    if (ok) await this.loadSignModel();
    return ok;
  }

  async loadSignModel() {
    try { this.camera.setSignModel(await api("/api/vision/model")); } catch { /* ยังไม่มีโมเดลป้าย */ }
  }

  /** เปิดกล้องอีกครั้ง (เช่น ผู้ใช้แตะปุ่มกล้อง) — ปลอดภัยแม้เรียกซ้ำ */
  retry() { return this.camera.start(); }
  /** 24 พ.ย. 2569: ภาพนิ่ง + ผลจำแนกป้าย (ผู้ใช้ถาม "นี่คืออะไร") — ไม่ใช่ snapshot() ของผู้เข้าชมด้านล่าง */
  frameSnapshot() { return this.camera.snapshot(); }

  async staffToggle() {
    if (this.state === "staff-off") {
      const ok = await this.camera.staffEnable();
      if (ok) await this.loadSignModel();
    } else {
      this.camera.staffDisable();
    }
  }

  /** Privacy Pause ของผู้เข้าชม (Phase 2): พัก ↔ กลับมาใช้ · คืน true เมื่อพักอยู่หลังเรียก */
  async privacyToggle(ms) {
    if (this.camera.paused) await this.camera.privacyResume();
    else this.camera.privacyPause(ms);
    const paused = this.camera.paused;
    this.bus.emit(EV.CAMERA_PRIVACY, { paused, until: paused ? this.camera.pausedUntil : 0 });
    if (!paused && this.state === "on") await this.loadSignModel();
    return paused;
  }

  get paused() { return this.camera.paused; }
  get pausedUntil() { return this.camera.pausedUntil; }

  get session() { return this.tracker.session; }
  get retryAt() { return this.camera.retryAt; }
  snapshot() { return this.tracker.snapshot(); }

  /** ข้อมูลสำหรับตรวจว่ากล้องและ MediaPipe ยังทำงานต่อเนื่อง */
  health() {
    const v = this.camera.vision;
    return { state: this.state, running: v.running, loopTicks: v.tick || 0, faceFrames: this.stats.faceFrames, videoTime: v.video ? v.video.currentTime : 0 };
  }
}
