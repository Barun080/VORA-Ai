// ช่องทางสื่อสารกลางระหว่าง Controller ทั้ง 3 ตัว (UI / Avatar / Camera & Visitor) และตัวประสานงาน app.js
// แต่ละ Controller ไม่เรียกกันโดยตรง: ส่ง Event ออก แล้วใครสนใจก็รับไป — เปลี่ยนส่วนหนึ่งไม่กระทบส่วนอื่น

export const EV = {
  // UI Controller
  UI_ACTIVITY: "ui:activity",            // ผู้ใช้ขยับเมาส์/แตะ/พิมพ์ (หรือท่ามือหน้ากล้อง)
  UI_IDLE: "ui:idle",                    // เข้าโหมดว่าง: ซ่อนเครื่องมือ อวตารขยายใหญ่ (Avatar Focus Mode)
  UI_ACTIVE: "ui:active",                // เข้าโหมดใช้งาน: แสดงเครื่องมือ อวตารกลับขนาดปกติ
  UI_LANG: "ui:lang",                    // เปลี่ยนภาษา { lang }

  // Camera & Visitor Controller
  CAMERA_STATUS_CHANGED: "camera:status", // { state, detail }
  VISITOR_DETECTED: "visitor:detected",   // ผู้เข้าชมใหม่ { session, people }
  VISITOR_RETURNED: "visitor:returned",   // กลับเข้ามาอีกครั้งในช่วงคูลดาวน์ (ไม่ทักซ้ำ) { session }
  VISITOR_JOINED: "visitor:joined",       // มีคนเพิ่มระหว่าง Session { session }
  VISITOR_LEFT: "visitor:left",           // ไม่มีใครในพื้นที่แล้ว { session }
  FACE_POSITION: "camera:face",           // ทิศที่อวตารควรมอง { x, y } (-1..1)
  CAMERA_GESTURE: "camera:gesture",       // ท่ามือที่จำได้ { name, score }
  CAMERA_SIGN: "camera:sign",             // ป้าย/วัตถุที่จำได้ { label, prob }

  // ตัวประสานงาน (app.js) → Avatar Controller
  GREETING_STARTED: "greeting:started",
  GREETING_FINISHED: "greeting:finished",
  AVATAR_LISTENING: "avatar:listening",
  AVATAR_THINKING: "avatar:thinking",
  AVATAR_SPEAKING: "avatar:speaking",     // { kind: conversation | greeting | announcing }
  AVATAR_IDLE: "avatar:idle",
  AVATAR_CAPTION: "avatar:caption",       // { text, partial }
  AVATAR_GESTURE: "avatar:gesture",       // { name }
  AVATAR_EMOTION: "avatar:emotion",       // { emotion, flashMs }
  AVATAR_ALERT: "avatar:alert",           // { error: boolean } เช่น หยุดฉุกเฉิน/ขาดการเชื่อมต่อ
  AVATAR_MOUTH: "avatar:mouth",           // ระดับเสียง 0..1 สำหรับขยับปาก
  AVATAR_AUDIO: "avatar:audio",           // 11 พ.ย. 2569: { on } เสียงพูดกำลังออกลำโพงจริงหรือไม่ (ปากขยับเฉพาะตอนมีเสียง)
  AVATAR_HINT: "avatar:hint",             // Phase 2: สถานะนำเสนอ { state: presenting|pointing|waving|thanking|null, ms? }

  // Camera (Phase 2)
  CAMERA_PRIVACY: "camera:privacy",       // ผู้เข้าชมพักกล้อง/กลับมาใช้ { paused, until }
  VISITOR_GREETED: "visitor:greeted",     // ทักทายจบแล้ว พร้อมแนะนำเมนู { session, suggest: [sectionId] }

  // Experience Orchestrator (VORA NEXT Phase 1) — เพิ่มใหม่ ไม่เปลี่ยนชื่อ Event เดิม
  EXPERIENCE_MODE: "experience:mode",     // { mode: idle | active | presentation, prev, reason }
  EXPERIENCE_OPEN: "experience:open",     // ผู้ใช้เลือกหมวดจาก Spatial Menu { section, source }
  EXPERIENCE_CLOSE: "experience:close",   // ปิดการนำเสนอ กลับโหมดใช้งาน { reason }
};

export class EventBus {
  constructor() { this.map = new Map(); this.debug = false; this.log = []; }

  /** สมัครรับ Event คืนฟังก์ชันยกเลิก (กัน Listener ค้าง) */
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) { const s = this.map.get(type); if (s) s.delete(fn); }

  emit(type, detail = {}) {
    if (this.debug && type !== EV.AVATAR_MOUTH && type !== EV.FACE_POSITION) {
      this.log.push({ t: Math.round(performance.now()), type });
      if (this.log.length > 300) this.log.shift();
    }
    const s = this.map.get(type);
    if (!s) return;
    for (const fn of [...s]) {
      try { fn(detail); } catch (e) { console.warn(`event ${type}:`, e); }   // Controller หนึ่งพัง ไม่ลามไปตัวอื่น
    }
  }

  /** จำนวน Listener ทั้งหมด — ใช้ตรวจว่าไม่มี Listener สะสมเพิ่มขึ้นเรื่อย ๆ */
  listenerCount() { let n = 0; for (const s of this.map.values()) n += s.size; return n; }
}

export const bus = new EventBus();
