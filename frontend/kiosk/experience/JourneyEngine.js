// Journey Engine — เส้นทางการค้นหาข้อมูลแบบเป็นขั้น (VORA NEXT Phase 3)
// ตรรกะล้วน ไม่มี DOM ไม่มีข้อมูลวิทยาลัย: ตัวเลือกทุกขั้นสร้างจากข้อมูลจริงใน API ที่ JourneyView ส่งเข้ามา
// เก็บเฉพาะ "สิ่งที่ผู้ใช้เลือก" (ระดับ/แผนก/รหัสสาขา) ใน sessionStorage ของเครื่องนี้ มีอายุ (TTL) และล้างได้ทันที
// ไม่บันทึกลงฐานข้อมูล ไม่มีข้อมูลระบุตัวบุคคล

export const JOURNEYS = {
  // Admission Journey: Start → Education Level → Department → Curriculum → Career → Application Information → QR Handoff
  admission: {
    steps: [
      { id: "level", choice: "level" },            // ระดับการศึกษา (programs.level)
      { id: "department", choice: "department" },  // แผนก (programs.department ในระดับที่เลือก)
      { id: "program", choice: "programId" },      // สาขา/หลักสูตร (programs ในระดับ+แผนกที่เลือก)
      { id: "career", choice: null },              // อาชีพ (programs.careers_*)
      { id: "apply", choice: null },               // ข้อมูลการสมัคร (ข่าวรับสมัคร + AI ตอบจากฐานความรู้)
      { id: "handoff", choice: null },             // QR ไปดูต่อบนมือถือ
    ],
  },
};

const KEY = "vora.journey";

export class JourneyEngine {
  constructor({ storage, ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    this.storage = storage !== undefined ? storage : (() => { try { return window.sessionStorage; } catch { return null; } })();
    this.ttlMs = ttlMs;
    this.now = now;
    this.state = null;
    this.load();
  }

  get def() { return JOURNEYS[(this.state && this.state.id) || "admission"]; }
  get steps() { return this.def.steps; }
  get active() { return !!this.state; }
  get step() { return this.state ? this.steps[this.state.step] : null; }

  /** อ่านเส้นทางที่ค้างอยู่ (หมดอายุแล้ว = ล้าง) */
  load() {
    this.state = null;
    try {
      const raw = this.storage && this.storage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !JOURNEYS[s.id] || this.now() - s.updatedAt > this.ttlMs) { this.clear("expired"); return null; }
      this.state = s;
    } catch { this.clear("corrupt"); }
    return this.state;
  }

  save() {
    if (!this.state) return;
    this.state.updatedAt = this.now();
    try { this.storage && this.storage.setItem(KEY, JSON.stringify(this.state)); } catch { /* storage ใช้ไม่ได้: ทำงานต่อในหน่วยความจำ */ }
  }

  clear(reason = "user") {
    this.state = null;
    this.lastClear = reason;
    try { this.storage && this.storage.removeItem(KEY); } catch { /* ignore */ }
  }

  /** หมดอายุแล้วหรือยัง (ตรวจตอนกลับมาใช้) */
  expired() { return !!this.state && this.now() - this.state.updatedAt > this.ttlMs; }

  start(id = "admission") {
    this.state = { id, step: 0, choices: {}, maxStep: 0, startedAt: this.now(), updatedAt: this.now(), interjections: 0, detours: 0 };
    this.save();
    return this.state;
  }

  /** เลือกตัวเลือกของขั้นปัจจุบัน → ล้างตัวเลือกของขั้นหลังจากนี้ (Branching) แล้วไปขั้นถัดไป */
  choose(value) {
    const st = this.step;
    if (!st || !st.choice) return false;
    const prev = this.state.choices[st.choice];
    this.state.choices[st.choice] = value;
    if (prev !== value) {
      // เปลี่ยนเส้นทาง: ตัวเลือกของขั้นหลังจากนี้ไม่ถูกต้องแล้ว
      this.steps.slice(this.state.step + 1).forEach((s) => { if (s.choice) delete this.state.choices[s.choice]; });
      this.state.maxStep = this.state.step + 1;
    }
    return this.next();
  }

  /** ไปขั้นถัดไปได้เมื่อขั้นปัจจุบันไม่ต้องเลือก หรือเลือกแล้ว */
  canNext() {
    const st = this.step;
    if (!st || this.state.step >= this.steps.length - 1) return false;
    return !st.choice || this.state.choices[st.choice] !== undefined;
  }

  next() {
    if (!this.canNext()) return false;
    this.state.step++;
    this.state.maxStep = Math.max(this.state.maxStep, this.state.step);
    this.save();
    return true;
  }

  back() {
    if (!this.state || this.state.step === 0) return false;
    this.state.step--;
    this.save();
    return true;
  }

  /** กระโดดไปขั้นที่เคยไปถึงแล้วเท่านั้น (Progress Timeline) */
  goTo(i) {
    if (!this.state || i < 0 || i > this.state.maxStep || i >= this.steps.length) return false;
    this.state.step = i;
    this.save();
    return true;
  }

  /** ผู้ใช้ถามแทรกระหว่างเส้นทาง (เส้นทางคงอยู่ที่ขั้นเดิม) */
  interject() { if (!this.state) return; this.state.interjections++; this.save(); }

  /** ผู้ใช้เปลี่ยนไปดูหัวข้ออื่น (เส้นทางคงอยู่ กลับมาทำต่อได้) */
  detour() { if (!this.state) return; this.state.detours++; this.save(); }

  progress() {
    const i = this.state ? this.state.step : 0;
    return { index: i, total: this.steps.length, percent: Math.round(((i + 1) / this.steps.length) * 100), maxStep: this.state ? this.state.maxStep : 0 };
  }

  /** ขั้นถัดไปที่แนะนำ (id) หรือ null ถ้าเป็นขั้นสุดท้าย */
  suggestion() {
    if (!this.state) return "level";
    const n = this.steps[this.state.step + 1];
    return n ? n.id : null;
  }

  get choices() { return (this.state && this.state.choices) || {}; }
}
