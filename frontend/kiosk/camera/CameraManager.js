// ผู้จัดการวงจรชีวิตกล้อง (Always-on Camera) — ครอบ VisionSystem เดิม (MediaPipe) ไม่ได้สร้างระบบกล้องใหม่
// - มีกล้องได้เพียงชุดเดียวต่อหน้า (กันเปิดซ้อน แม้สคริปต์ถูกเรียกซ้ำ)
// - เปิดเองเมื่อได้รับอนุญาต, แยกแยะ: ปฏิเสธสิทธิ์ / ไม่พบกล้อง / กล้องถูกโปรแกรมอื่นใช้ / กล้องหลุด
// - ลองเชื่อมต่อใหม่อัตโนมัติ (ยกเว้นถูกปฏิเสธสิทธิ์ ซึ่งจะรอจนผู้ใช้เปลี่ยนสิทธิ์)
// - เจ้าหน้าที่ปิดกล้องได้ และค่าปิดจะจำไว้ในเครื่องนี้จนกว่าจะเปิดใหม่
// ความเป็นส่วนตัว: ภาพประมวลผลในเบราว์เซอร์ ไม่บันทึก ไม่ส่งออกนอกเครื่อง (ส่งเฉพาะชื่อท่ามือ/ป้ายที่จำได้)

import { VisionSystem } from "/shared/vision.js";

const STAFF_OFF_KEY = "vora.camera.staffOff";

export const CAMERA_STATES = ["idle", "requesting", "loading", "on", "denied", "not-found", "in-use", "lost", "error", "model-error", "staff-off", "unsupported", "paused"];

export class CameraManager {
  constructor(video, handlers, { retryMinMs = 3000, retryMaxMs = 30000, visionOptions = {}, onState } = {}) {
    if (window.__voraCamera) return window.__voraCamera;    // ป้องกันกล้องหลาย Instance
    window.__voraCamera = this;
    this.onState = onState;
    this.retryMinMs = retryMinMs;
    this.retryMaxMs = retryMaxMs;
    this.retryDelay = retryMinMs;
    this.state = "idle";
    this.detail = "";
    this.starting = null;
    this.pausedUntil = 0;
    this.handlers = handlers;
    this.vision = new VisionSystem(video, {
      ...handlers,
      onStatus: (s) => {
        if (s === "on") this.set("on");
        else if (s === "loading" && this.state !== "requesting") this.set("loading");
        else if (s === "model-error") this.set("model-error");
        handlers.onStatus && handlers.onStatus(s);
      },
      onTrackEnded: () => { this.set("lost"); this.scheduleRetry(); },
    }, visionOptions);

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      // เสียบกล้องกลับ/เปลี่ยนกล้อง: ลองใหม่ทันที
      navigator.mediaDevices.addEventListener("devicechange", () => {
        if (["not-found", "lost", "in-use", "error"].includes(this.state)) { this.retryDelay = this.retryMinMs; this.start(); }
      });
    }
    addEventListener("pagehide", () => this.vision.stop());   // ปิด Kiosk: หยุด Track ของกล้องทุกครั้ง
    this.watchPermission();
  }

  get staffOff() { try { return localStorage.getItem(STAFF_OFF_KEY) === "1"; } catch { return false; } }

  set(state, detail = "") {
    if (this.state === state && this.detail === detail) return;
    this.state = state;
    this.detail = detail;
    this.onState && this.onState(state, detail);
  }

  async watchPermission() {
    try {
      const p = await navigator.permissions.query({ name: "camera" });
      this.permission = p.state;
      p.onchange = () => {
        this.permission = p.state;
        if (p.state === "granted" && !["on", "loading", "requesting", "staff-off", "paused"].includes(this.state)) this.start();
        if (p.state === "denied" && this.state === "on") { this.vision.stop(); this.set("denied"); }
      };
    } catch { this.permission = "unknown"; }
  }

  /** เปิดกล้อง (เรียกซ้ำได้อย่างปลอดภัย: ถ้ากำลังเปิดหรือเปิดอยู่แล้วจะไม่เปิดซ้อน) */
  start() {
    if (this.starting) return this.starting;
    if (this.state === "on") return Promise.resolve(true);
    if (this.staffOff) { this.set("staff-off"); return Promise.resolve(false); }
    if (this.paused) { this.set("paused"); return Promise.resolve(false); }   // Phase 2: ผู้เข้าชมพักกล้องอยู่
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.set("unsupported", window.isSecureContext ? "" : "insecure");
      return Promise.resolve(false);
    }
    clearTimeout(this.retryTimer);
    this.set("requesting");
    this.starting = (async () => {
      try {
        await this.vision.start();
        this.retryDelay = this.retryMinMs;
        this.set("on");
        return true;
      } catch (e) {
        const n = (e && e.name) || "";
        // บางเบราว์เซอร์รายงานการปฏิเสธสิทธิ์ด้วยชื่อ error อื่น จึงตรวจสถานะสิทธิ์จริงประกอบด้วย
        let perm = "unknown";
        try { perm = (await navigator.permissions.query({ name: "camera" })).state; } catch { /* ignore */ }
        if (n === "NotAllowedError" || n === "SecurityError" || perm === "denied") this.set("denied");
        else if (n === "NotFoundError" || n === "OverconstrainedError" || n === "DevicesNotFoundError") { this.set("not-found"); this.scheduleRetry(); }
        else if (n === "NotReadableError" || n === "TrackStartError" || n === "AbortError") { this.set("in-use"); this.scheduleRetry(); }
        else if (this.vision.status === "model-error") this.set("model-error", e.message || "");
        else { this.set("error", e.message || n); this.scheduleRetry(); }
        try { this.vision.stop(); } catch { /* ignore */ }
        // vision.stop() ตั้งสถานะ off — คืนสถานะความผิดพลาดที่แท้จริงไว้
        return false;
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  scheduleRetry() {
    if (this.staffOff || this.paused) return;
    clearTimeout(this.retryTimer);
    const wait = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, this.retryMaxMs);
    this.retryAt = Date.now() + wait;
    this.retryTimer = setTimeout(() => this.start(), wait);
  }

  /** ปิดกล้องโดยเจ้าหน้าที่ — จำค่าไว้ เปิดหน้าใหม่ก็ยังปิดอยู่ */
  staffDisable() {
    try { localStorage.setItem(STAFF_OFF_KEY, "1"); } catch { /* ignore */ }
    clearTimeout(this.resumeTimer);
    this.pausedUntil = 0;
    clearTimeout(this.retryTimer);
    this.vision.stop();
    this.set("staff-off");
  }

  staffEnable() {
    try { localStorage.removeItem(STAFF_OFF_KEY); } catch { /* ignore */ }
    this.retryDelay = this.retryMinMs;
    this.set("idle");
    return this.start();
  }

  // ---------------------------------------------------------------- Privacy Pause (VORA NEXT Phase 2)
  // ผู้เข้าชมพักกล้องเองได้: หยุด Track จริง (ไฟกล้องดับ) ไม่จำค่าข้ามการเปิดหน้าใหม่ และกลับมาเองเมื่อครบเวลา
  // ต่างจาก staffDisable() ที่เจ้าหน้าที่ปิดถาวรจนกว่าจะเปิดเอง
  get paused() { return this.pausedUntil > Date.now(); }

  privacyPause(ms = 300000) {
    if (this.staffOff) return false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.resumeTimer);
    this.pausedUntil = Date.now() + Math.max(1000, ms);
    this.vision.stop();
    this.set("paused");
    this.resumeTimer = setTimeout(() => this.privacyResume(), Math.max(1000, ms));
    return true;
  }

  privacyResume() {
    clearTimeout(this.resumeTimer);
    if (!this.pausedUntil) return Promise.resolve(this.state === "on");
    this.pausedUntil = 0;
    this.retryDelay = this.retryMinMs;
    this.set("idle");
    return this.start();
  }

  setSignModel(m) { this.vision.setSignModel(m); }
  snapshot() { return this.vision && this.vision.snapshot ? this.vision.snapshot() : null; }   // 24 พ.ย. 2569
  get running() { return this.vision.running; }
}
