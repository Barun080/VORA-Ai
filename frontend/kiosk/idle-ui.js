// UI Controller — โหมดหน้าจอว่าง (Idle) / ใช้งาน (Active)
// พัฒนาต่อจาก idle-ui.js เดิม (ตรรกะ busy(), กันสั่นของจอสัมผัส, MutationObserver ยังเป็นของเดิม)
// รับผิดชอบเฉพาะการแสดงผล: Activity, Idle Timer, การซ่อน/แสดงแผง, Animation ของแผง, ข้อความแนะนำ
// ไม่ยุ่งกับกล้อง AI WebSocket หรือหุ่นยนต์ — การเปลี่ยนโหมดเป็นเพียงการสลับ class บนหน้าจอ
//
// Event ที่ส่ง: UI_IDLE, UI_ACTIVE   · Event ที่รับ: UI_ACTIVITY (จากเมาส์/แตะ/คีย์บอร์ด หรือ app.js เช่นท่ามือ)
// การตรวจพบผู้เข้าชมอย่างเดียว "ไม่" ทำให้กลับเป็น Active — อวตารทักทายในโหมด Idle ได้เลย

import { EV } from "./core/event-bus.js";

export class UIController {
  constructor(app, bus, { idleAfterMs = 15000, startIdle = false, idleHint = true, extraBusy = null } = {}) {
    this.app = app;
    // ตัวตรวจ "ไม่ว่าง" เพิ่มเติมจากภายนอก (Phase 1: Experience Orchestrator ใช้กันไม่ให้ซ่อนเครื่องมือระหว่างโหมดนำเสนอ)
    this.extraBusy = typeof extraBusy === "function" ? extraBusy : () => false;
    this.bus = bus;
    this.idleAfterMs = Math.max(2000, idleAfterMs);
    this.idleHint = idleHint;
    this.mode = null;
    this.timer = 0;
    this.lastMove = 0;
    this.offs = [];
    this.setMode(startIdle ? "idle" : "active");
  }

  /** ตรรกะเดิมจาก idle-ui.js: ห้ามซ่อนเครื่องมือระหว่างกำลังฟัง/คิด/ตอบในบทสนทนา มีหน้าต่างเปิด หรือกำลังพิมพ์ */
  busy() {
    return this.extraBusy() || this.busyIgnoringExtra();
  }

  /** ตรรกะ busy() เดิมทั้งหมด (ไม่รวม extraBusy) — Orchestrator ใช้ตรวจ "งานค้าง" ระหว่างโหมดนำเสนอ */
  busyIgnoringExtra() {
    const s = this.app.dataset.state;
    if (s === "listening" || s === "thinking") return true;
    // กำลังตอบผู้ใช้ = ไม่ว่าง แต่การทักทาย/ประกาศ (data-avatar = greeting/announcing) ไม่นับ
    // เพื่อให้อวตารทักผู้เข้าชมในโหมด Idle ได้โดยหน้าจอไม่เด้งเป็น Active (ข้อกำหนดใหม่ — ของเดิมปลุกหน้าจอเมื่อทักทาย)
    if (s === "speaking" && this.app.dataset.phase === "convo" && this.app.dataset.avatar === "speaking") return true;
    if (document.querySelector("dialog[open]")) return true;
    if (this.app.querySelector(".drawer:not([hidden])")) return true;
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
  }

  start() {
    const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); this.offs.push(() => target.removeEventListener(type, fn, opts)); };
    const activity = (source) => this.bus.emit(EV.UI_ACTIVITY, { source });
    listen(window, "pointermove", (e) => {
      // กันการสั่นเล็กน้อยของจอสัมผัส/เมาส์ (ของเดิม)
      const now = performance.now();
      if (now - this.lastMove < 120) return;
      this.lastMove = now;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 1 || e.pointerType !== "mouse") activity("pointer");
    }, { passive: true });
    for (const type of ["pointerdown", "wheel", "keydown", "touchstart"]) listen(window, type, () => activity(type), { passive: true, capture: true });
    this.offs.push(this.bus.on(EV.UI_ACTIVITY, () => this.wake()));
    // เมื่อบทสนทนาเริ่ม (ผู้ใช้พูด/พิมพ์) ให้เครื่องมือโผล่ — ของเดิม
    this.mo = new MutationObserver(() => { if (this.busy()) this.wake(); });
    this.mo.observe(this.app, { attributes: true, attributeFilter: ["data-state", "data-phase"] });
    this.arm();
  }

  /** ยกเลิก Listener และ Timer ทั้งหมด (ใช้ตอนทดสอบ/เปลี่ยนหน้า) */
  destroy() {
    clearTimeout(this.timer);
    this.offs.forEach((off) => off());
    this.offs = [];
    this.mo && this.mo.disconnect();
  }

  arm() {
    clearTimeout(this.timer);      // มี Timer ได้ตัวเดียวเสมอ
    this.timer = setTimeout(() => {
      if (this.busy()) { this.arm(); return; }
      this.goIdle();
    }, this.idleAfterMs);
  }

  wake() {
    if (this.mode !== "active") this.setMode("active");
    this.arm();
  }

  /** เข้าโหมดว่างทันที (เช่น ปุ่ม "ซ่อนแผงควบคุม" ของเจ้าหน้าที่) */
  goIdle() {
    if (this.busy()) return false;
    this.setMode("idle");
    return true;
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    const idle = mode === "idle";
    this.app.classList.toggle("is-idle", idle);
    this.app.classList.toggle("is-active", !idle);
    this.app.classList.toggle("show-hint", idle && this.idleHint);
    if (idle && document.activeElement && this.app.contains(document.activeElement)) document.activeElement.blur();
    this.bus.emit(idle ? EV.UI_IDLE : EV.UI_ACTIVE, { mode });
  }
}
