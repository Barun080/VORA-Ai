// ตัวกรองท่ามือให้เสถียร (11 พ.ย. 2569) — ใช้กับผล GestureRecognizer ของ MediaPipe ทีละเฟรม
// ปัญหาเดิม: ต้องเห็นท่าเดียวกัน 3 เฟรม "ติดกัน" (เฟรมหลุดเฟรมเดียว = ไม่นับ → ทำท่าแล้วไม่ตอบสนอง)
//            และค้างท่าไว้ = ทำงานซ้ำทุก 2.5 วินาที (เช่น แบมือค้าง = หยุดพูดซ้ำ ๆ, ชูนิ้วค้าง = ให้คะแนนซ้ำ)
// วิธีใหม่:
//  1) โหวตในหน้าต่าง 6 เฟรมล่าสุด ต้องเป็นท่าเดียวกันอย่างน้อย 4 เฟรม (ทนเฟรมหลุด/สั่นได้)
//  2) เกณฑ์ความมั่นใจแยกตามท่า — ท่าที่สับสนง่าย (คว่ำนิ้ว ชูสองนิ้ว I love you กำมือ) ต้องมั่นใจสูงกว่า
//  3) ตัดมือที่เล็กเกินไป (คนเดินผ่านด้านหลัง) ด้วยขนาดกรอบนิ้วมือเทียบกับภาพ
//  4) ท่าเดิมจะทำงานซ้ำได้ต่อเมื่อ "ลดมือ/เปลี่ยนท่า" ก่อน (ไม่ใช่แค่รอเวลา) + เว้นระยะระหว่างท่าใดก็ได้ 1.2 วินาที

export const GESTURE_MIN_SCORE = { default: 0.62, Thumb_Down: 0.72, Victory: 0.7, ILoveYou: 0.78, Closed_Fist: 0.75, Pointing_Up: 0.66 };

export class GestureStabilizer {
  constructor(opt = {}) {
    this.opt = { window: 6, need: 4, releaseFrames: 3, minGapMs: 1200, minHandSize: 0.09, ...opt };
    this.buf = [];             // [{ name|null, score }]
    this.armed = {};           // armed[name] === false → ต้องปล่อยท่าก่อนจึงทำงานซ้ำได้
    this.absent = {};          // นับเฟรมที่ไม่เห็นท่านั้นติดกัน
    this.lastFireAt = -Infinity;
    this.handSeenAt = -Infinity;
  }

  /** ขนาดมือ (สัดส่วน 0..1 ของภาพ) จาก landmarks ของมือแรก · ไม่มีข้อมูล = ถือว่าผ่าน */
  static handSize(landmarks) {
    if (!landmarks || !landmarks.length) return 1;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of landmarks) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return Math.max(x1 - x0, y1 - y0);
  }

  /** ผลดิบหนึ่งเฟรม → { name, score } ที่ผ่านเกณฑ์ หรือ name=null */
  frame(res) {
    const g = res && res.gestures && res.gestures[0] && res.gestures[0][0];
    if (!g || !g.categoryName || g.categoryName === "None") return { name: null, score: 0, hand: !!(res && res.landmarks && res.landmarks.length) };
    const min = GESTURE_MIN_SCORE[g.categoryName] ?? GESTURE_MIN_SCORE.default;
    const big = GestureStabilizer.handSize(res.landmarks && res.landmarks[0]) >= this.opt.minHandSize;
    return { name: g.score >= min && big ? g.categoryName : null, score: g.score, hand: true };
  }

  /** ป้อนผลหนึ่งเฟรม คืน { name, score } เมื่อยืนยันท่าได้ หรือ null */
  push(res, ts) {
    const f = this.frame(res);
    if (f.hand) this.handSeenAt = ts;
    this.buf.push(f);
    if (this.buf.length > this.opt.window) this.buf.shift();
    // นับการปล่อยท่า: ท่าไหนไม่ปรากฏในเฟรมนี้ = ห่างจากท่านั้นอีก 1 เฟรม
    for (const n of Object.keys(this.armed)) {
      if (f.name === n) this.absent[n] = 0;
      else if (++this.absent[n] >= this.opt.releaseFrames) this.armed[n] = true;
    }
    if (!f.name) return null;
    const same = this.buf.filter((x) => x.name === f.name);
    if (same.length < this.opt.need) return null;
    if (this.armed[f.name] === false) return null;                       // ยังค้างท่าเดิมอยู่
    if (ts - this.lastFireAt < this.opt.minGapMs) return null;
    const score = same.reduce((a, x) => a + x.score, 0) / same.length;
    this.lastFireAt = ts;
    this.armed[f.name] = false;
    this.absent[f.name] = 0;
    this.buf = [];
    return { name: f.name, score };
  }

  /** มีมืออยู่ในภาพเมื่อไม่นานนี้ (ใช้เร่งความถี่การตรวจท่ามือ) */
  handActive(ts, withinMs = 1200) { return ts - this.handSeenAt < withinMs; }
}
