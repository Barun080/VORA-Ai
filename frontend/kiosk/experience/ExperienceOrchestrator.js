// Experience Orchestrator — VORA NEXT Phase 1
// เจ้าของ State ของประสบการณ์หน้าจอ: IDLE ⇄ ACTIVE ⇄ PRESENTATION
// - ครอบ UIController เดิม (idle-ui.js) ไม่ได้เขียนใหม่: UIController ยังคุม Activity/Idle Timer/การซ่อนแผง
// - เพิ่มโหมด PRESENTATION: ขยายพื้นที่แสดงข้อมูล ระหว่างนี้ UIController จะไม่เข้า Idle เอง (extraBusy)
//   แล้ว Orchestrator ตัดสินเองว่า "ไม่มีการใช้งานและไม่มีงานค้าง" นานพอ → ปิดการนำเสนอ → Idle
// - ไม่แตะกล้อง WebSocket AI หรือหุ่นยนต์เลย: เปลี่ยนแค่ class / data-mode บน #app
//
// Event ที่ส่ง: EXPERIENCE_MODE, EXPERIENCE_CLOSE · Event ที่รับ: UI_IDLE, UI_ACTIVE, UI_ACTIVITY, EXPERIENCE_OPEN

import { EV } from "../core/event-bus.js";

export const MODES = Object.freeze({ IDLE: "idle", ACTIVE: "active", PRESENTATION: "presentation" });

export class ExperienceOrchestrator {
  /**
   * app: #app · bus: EventBus · ui: UIController เดิม
   * busy(): งานค้างของระบบสนทนา (กำลังฟัง/คิด/ตอบ) — ใช้ตัวเดียวกับ UIController
   * presentationIdleMs: ไม่มีการใช้งานนานเท่านี้ระหว่างนำเสนอ → กลับ Idle (ถ้าไม่มีงานค้าง)
   */
  constructor(app, bus, ui, { presentationIdleMs = 45000 } = {}) {
    this.app = app;
    this.bus = bus;
    this.ui = ui;
    this.presentationIdleMs = Math.max(5000, presentationIdleMs);
    this.mode = ui.mode === "idle" ? MODES.IDLE : MODES.ACTIVE;
    this.section = null;
    this.timer = 0;
    this.offs = [];
    this.history = [];      // บันทึกการเปลี่ยนโหมด (ใช้ตรวจในชุดทดสอบ) เก็บสูงสุด 50 รายการ
    this.view = null;       // PresentationView (ตั้งค่าภายหลังด้วย attachView)
  }

  /** ใช้เป็น extraBusy ของ UIController: ระหว่างนำเสนอห้าม UIController ซ่อนเครื่องมือเอง */
  isPresenting() { return this.mode === MODES.PRESENTATION; }

  attachView(view) { this.view = view; }

  start() {
    const on = (t, fn) => this.offs.push(this.bus.on(t, fn));
    on(EV.UI_IDLE, () => this.set(MODES.IDLE, "ui-idle"));
    on(EV.UI_ACTIVE, () => { if (this.mode !== MODES.PRESENTATION) this.set(MODES.ACTIVE, "ui-active"); });
    on(EV.UI_ACTIVITY, () => { if (this.mode === MODES.PRESENTATION) this.arm(); });
    on(EV.EXPERIENCE_OPEN, (d) => this.present(d.section, d.source || "menu"));
    this.apply();
  }

  destroy() {
    clearTimeout(this.timer);
    this.offs.forEach((off) => off());
    this.offs = [];
  }

  /** เปิดโหมดนำเสนอของหมวดที่เลือก (ถ้าเปิดอยู่แล้วเปลี่ยนหมวดได้ทันที ไม่ต้องปิดก่อน) */
  present(section, source = "menu") {
    if (!this.view || !this.view.has(section)) return false;
    this.section = section;
    if (this.ui.mode !== "active") this.ui.wake();
    this.set(MODES.PRESENTATION, `open:${section}:${source}`);
    this.view.open(section);
    this.arm();
    return true;
  }

  /** ปิดการนำเสนอ กลับโหมดใช้งาน (หรือ Idle ถ้าเรียกจากตัวจับเวลา) */
  close(reason = "user") {
    if (this.mode !== MODES.PRESENTATION) return false;
    clearTimeout(this.timer);
    this.view && this.view.close();
    this.section = null;
    this.set(MODES.ACTIVE, `close:${reason}`);
    this.bus.emit(EV.EXPERIENCE_CLOSE, { reason });
    this.ui.arm();          // เริ่มนับ Idle Timer ของ UIController ใหม่
    return true;
  }

  /** ตัวจับเวลาของโหมดนำเสนอ — มีได้ตัวเดียวเสมอ */
  arm() {
    clearTimeout(this.timer);
    if (this.mode !== MODES.PRESENTATION) return;
    this.timer = setTimeout(() => {
      // มีงานค้าง (กำลังฟัง/คิด/ตอบ หรือมีหน้าต่างเปิด) → รอต่อ
      if (this.ui.busyIgnoringExtra()) { this.arm(); return; }
      this.close("timeout");
      this.ui.goIdle();
    }, this.presentationIdleMs);
  }

  set(mode, reason) {
    if (this.mode === mode) return;
    const prev = this.mode;
    this.mode = mode;
    this.history.push({ t: Math.round(performance.now()), mode, prev, reason });
    if (this.history.length > 50) this.history.shift();
    this.apply();
    this.bus.emit(EV.EXPERIENCE_MODE, { mode, prev, reason });
  }

  apply() {
    this.app.dataset.mode = this.mode;
    this.app.classList.toggle("is-presenting", this.mode === MODES.PRESENTATION);
    if (this.section) this.app.dataset.section = this.section; else delete this.app.dataset.section;
  }
}
