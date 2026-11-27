// ท่าทางตามสถานะ + ปากขยับตามเสียงจริง ของอวตาร VORA (19 พ.ย. 2569 · ขั้นที่ 2–3)
// ทำงานบน VoraLiveRig โดยไม่แก้ vora-rig.js: คำนวณ "ค่าชดเชย" ทุกเฟรม แล้ว VoraRigRenderer บวกเข้ากับท่าของ rig เฉพาะตอนวาด
//
//  ว่าง        ถ่ายน้ำหนักซ้าย/ขวา · มองไปรอบ ๆ (เมื่อไม่มีใครอยู่หน้ากล้อง) · ยืดตัวเป็นครั้งคราว
//  ฟัง         เอียงหัว ก้มเข้าหาเล็กน้อย เลิกคิ้ว พยักหน้าเป็นจังหวะ
//  คิด         เงยหน้า เหลือบตาขึ้นข้าง ขมวดคิ้ว โยกหัวช้า ๆ
//  พูด/ประกาศ  พยักหน้าตามจังหวะคำ (จับจากเสียงที่เริ่มดังขึ้น) · คิ้วขยับตามความดัง
//  ทักทาย/ดีใจ เด้งตัว 2 จังหวะ เอียงหัว เลิกคิ้ว ขยับแขน
//  ขัดข้อง     ก้มหน้าเล็กน้อย คิ้วตก
//  ปาก        ขณะพูดใช้ระดับเสียงจริงจากลำโพง (voice.js → AvatarController.mouthOpen) แทนจังหวะเวลาของ rig
//
// ทุกท่าคูณด้วยระดับ "ความมีชีวิตชีวา" (หลังบ้าน 0–200 %) · 0 % = ไม่มีท่าเพิ่ม (ปากยังขยับตามเสียง)

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** ซองความแรง 0→1→0 แบบนุ่ม (u = 0..1) */
const bell = (u) => (u <= 0 || u >= 1 ? 0 : Math.pow(Math.sin(Math.PI * u), 1.5));

const GROUP = {
  idle: "idle", listening: "listen", thinking: "think",
  speaking: "speak", announcing: "speak", presenting: "speak", pointing: "speak",
  greeting: "cheer", waving: "cheer", happy: "cheer", thanking: "cheer",
  error: "sad",
};

/** ท่าค้าง (ค่อย ๆ เข้า/ออก) ของแต่ละกลุ่ม — หน่วยเดียวกับ state ของ rig (องศา / พิกเซลบนผืน 710×1650 / หน่วยตาของ rig) */
const HOLD = {
  idle:   {},
  listen: { headTiltDeg: 2.4, headLiftY: 2.2, browLiftY: -1.2 },
  think:  { headTiltDeg: -2.8, headLiftY: -2.6, browLiftY: 1.8, gazeX: -4.2, gazeY: -2.4 },
  speak:  { browLiftY: -0.4 },
  cheer:  { headTiltDeg: 2.6, browLiftY: -1.6 },
  sad:    { headTiltDeg: -1.8, headLiftY: 3.0, browLiftY: 1.2, gazeY: 1.2 },
};

export const BEHAVIOR_FIELDS = ["headTiltDeg", "headSwayX", "headLiftY", "bodySwayX", "chestLiftY", "browLiftY", "gazeX", "gazeY"];

export class VoraBehavior {
  constructor(canvas) {
    this.canvas = canvas;
    this.group = "idle";
    this.since = performance.now();
    this.off = Object.fromEntries(BEHAVIOR_FIELDS.map((f) => [f, 0]));
    this.events = [];             // { t0, dur, f: {field: amp}, kind }
    this.hop = null;              // เด้งทั้งตัว (CSS บน canvas) { t0, dur }
    this.side = 1;
    this.camLook = false;
    this.lip = 0;                 // ปากเปิด 0..1 (หลังหน่วง)
    this.lipTarget = 0;
    this.talking = false;
    this.lowSince = 0;
    this.lastNod = 0;
    this.lastLevel = 0;
    const now = performance.now();
    this.next = { shift: now + rnd(3000, 6000), look: now + rnd(5000, 9000), stretch: now + rnd(25000, 45000), nod: now + rnd(1500, 2500), sway: 0 };
    this.shift = { bodySwayX: 0, headTiltDeg: 0 };
    canvas.style.transformOrigin = "50% 100%";
    canvas.style.willChange = "transform";
  }

  setState(state, rig) {
    const g = GROUP[state] || "idle";
    if (g === this.group) return;
    const now = performance.now();
    const prev = this.group;
    this.group = g;
    this.since = now;
    this.events = this.events.filter((e) => e.keep);          // ล้างท่าค้างของสถานะก่อน (ยกเว้นท่าที่ต้องเล่นให้จบ)
    if (g === "listen") { this.side = -this.side; this.next.nod = now + rnd(900, 1600); }
    if (g === "cheer") {
      this.hop = { t0: now, dur: 900 };
      try { rig && rig.triggerArmGesture && rig.triggerArmGesture("adjust"); } catch { /* ignore */ }
    }
    if (g === "speak" && prev !== "speak") this.lastNod = now;
    if (g === "idle") {
      this.next.shift = now + rnd(2500, 5000);
      this.next.look = now + rnd(4000, 8000);
    }
  }

  /** p.mouth === "talk" และระดับเสียง 0..1 จาก AvatarController */
  setSpeech(talking, level) {
    this.talking = talking;
    this.lipTarget = talking ? clamp(((level || 0) - 0.05) * 1.35, 0, 1) : 0;
    this.level = talking ? (level || 0) : 0;
  }

  setCameraLook(on) { this.camLook = on; }

  _event(now, dur, f, keep = false) { this.events.push({ t0: now, dur, f, keep }); }

  /** เรียกทุกเฟรมก่อนวาด → คืนค่าชดเชย (คูณระดับแล้ว) */
  frame(now, dt, k) {
    const g = this.group;
    const hold = HOLD[g] || {};

    // --- ตัวจุดชนวนตามสถานะ
    if (k > 0.01) {
      if (g === "idle") {
        if (now >= this.next.shift) {                         // ถ่ายน้ำหนักไปอีกข้าง
          const s = Math.sign(this.shift.bodySwayX || rnd(-1, 1)) * -1 || 1;
          this.shift = { bodySwayX: s * rnd(1.4, 2.6), headTiltDeg: -s * rnd(0.6, 1.4) };
          this.next.shift = now + rnd(5500, 9500);
        }
        if (!this.camLook && now >= this.next.look) {         // มองไปรอบ ๆ
          const dir = Math.random() < 0.5 ? -1 : 1, d = rnd(1000, 1700);
          this._event(now, d, { gazeX: dir * rnd(2.6, 3.6), gazeY: rnd(-0.8, 0.6), headSwayX: dir * 1.6, headTiltDeg: dir * 0.9 });
          this.next.look = now + d + rnd(5000, 10000);
        }
        if (now >= this.next.stretch) {                       // ยืดตัว
          this._event(now, 1700, { chestLiftY: -3.2, headLiftY: -3.0, browLiftY: -1.4, headTiltDeg: this.side * 1.2 });
          this.next.stretch = now + rnd(35000, 60000);
        }
      } else if (g === "listen") {
        if (now >= this.next.nod) {                           // พยักหน้ารับฟัง
          this._event(now, 480, { headLiftY: 4.0, browLiftY: -0.6 });
          this.next.nod = now + rnd(2200, 3600);
        }
      } else if (g === "speak") {
        // พยักหน้าตามคำ: เสียงเริ่มดังขึ้นหลังช่วงเงียบสั้น ๆ (ต้นวลี) · เว้นอย่างน้อย 0.8 วิ
        const lv = this.level || 0;
        if (lv < 0.12) { if (!this.lowSince) this.lowSince = now; }
        else {
          if (this.lowSince && now - this.lowSince > 160 && lv > 0.3 && now - this.lastNod > 800) {
            this._event(now, 380, { headLiftY: 2.8, headTiltDeg: rnd(-0.8, 0.8) });
            this.lastNod = now;
          }
          this.lowSince = 0;
        }
      }
    }

    // --- ค่าเป้าหมาย = ท่าค้างของสถานะ + การถ่ายน้ำหนัก (เฉพาะตอนว่าง) + โยกช้า ๆ ตอนคิด/พูด
    const t = (now - this.since) / 1000;
    const tgt = {};
    for (const f of BEHAVIOR_FIELDS) tgt[f] = (hold[f] || 0) * (f === "headTiltDeg" && g === "listen" ? this.side : 1);
    if (g === "idle") { tgt.bodySwayX += this.shift.bodySwayX; tgt.headTiltDeg += this.shift.headTiltDeg; }
    if (g === "think") tgt.headSwayX += 1.1 * Math.sin(t * 0.9);
    if (g === "speak") { tgt.bodySwayX += 0.9 * Math.sin(t * 0.8); tgt.browLiftY += -1.1 * (this.level || 0); }

    const a = 1 - Math.exp(-dt * (g === "cheer" ? 7 : 3.2));
    for (const f of BEHAVIOR_FIELDS) this.off[f] += (tgt[f] - this.off[f]) * a;

    // --- ท่าชั่วคราว (ซองความแรง)
    const out = { ...this.off };
    this.events = this.events.filter((e) => {
      const u = (now - e.t0) / e.dur;
      if (u >= 1) return false;
      const w = bell(u);
      for (const [f, v] of Object.entries(e.f)) out[f] += v * w;
      return true;
    });
    for (const f of BEHAVIOR_FIELDS) out[f] *= k;

    // --- เด้งทั้งตัว (ทักทาย/ดีใจ): 2 จังหวะ สูง ~1.4 % ของความสูงตัวละคร × ระดับ
    let y = 0;
    if (this.hop) {
      const u = (now - this.hop.t0) / this.hop.dur;
      if (u >= 1) this.hop = null;
      else y = -(u < 0.55 ? Math.sin(Math.PI * u / 0.55) * 1.4 : Math.sin(Math.PI * (u - 0.55) / 0.45) * 0.7);
    }
    const tr = y && k > 0.01 ? `translateY(${(y * Math.min(k, 1.6)).toFixed(3)}%)` : "";
    if (tr !== this._tr) { this.canvas.style.transform = tr; this._tr = tr; }

    // --- ปาก: เปิดเร็ว ปิดช้ากว่าเล็กน้อย (ไม่กระพริบ)
    const la = 1 - Math.exp(-dt * (this.lipTarget > this.lip ? 32 : 18));
    this.lip += (this.lipTarget - this.lip) * la;
    if (!this.talking && this.lip < 0.01) this.lip = 0;
    return out;
  }
}
