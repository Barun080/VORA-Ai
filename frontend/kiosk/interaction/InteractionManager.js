// ผู้จัดการลำดับความสำคัญของการพูด/แสดงท่าทาง — มีผู้สั่งอวตารพูดได้ทีละรายเท่านั้น
// ลำดับความสำคัญ: 1) safety (หยุดฉุกเฉิน) 2) greeting 3) conversation 4) announcing 5) idle
//
// กติกาการแทรก (ตัดสินที่ฟังก์ชัน canPreempt):
//   - safety แทรกได้ทุกอย่างเสมอ
//   - greeting แทรก announcing ได้ (หยุดประกาศ แล้วนำข่าวกลับเข้าคิวไปประกาศต่อภายหลัง)
//   - greeting อัตโนมัติจะ "ไม่ตัด" คำตอบที่กำลังพูดกับผู้ใช้ (รอให้จบก่อน) เพราะมีคนใช้งานอยู่แล้ว
//   - การกระทำที่ผู้ใช้สั่งเอง (พูด/พิมพ์/แตะ) เป็น conversation และแทรก greeting/announcing ได้ทันที
//     เพราะเป็นความต้องการที่ชัดเจนของคนตรงหน้า (เหมือนการพูดแทรกที่ระบบเดิมรองรับอยู่แล้ว)
//   - announcing ไม่แทรกใคร รอจนว่าง

export const PRIORITY = { safety: 5, greeting: 4, conversation: 3, announcing: 2, idle: 1 };

export class InteractionManager {
  constructor({ onPreempt, onChange } = {}) {
    this.current = null;
    this.seq = 0;
    this.onPreempt = onPreempt;
    this.onChange = onChange;
  }

  canPreempt(kind, cur, { user = false } = {}) {
    if (!cur) return true;
    if (kind === "safety") return true;
    if (cur.kind === "safety") return false;
    if (user && kind === "conversation") return true;
    if (kind === "greeting") return cur.kind === "announcing" || cur.kind === "idle";
    if (kind === "conversation") return true;   // คำตอบของผู้ใช้แทนการทักทาย/ประกาศ/คำตอบก่อนหน้าได้
    return PRIORITY[kind] > PRIORITY[cur.kind];
  }

  /** ขอสิทธิ์พูด/แสดง คืน token ถ้าได้ ไม่ได้คืน null */
  begin(kind, { user = false, meta = null } = {}) {
    const cur = this.current;
    if (!this.canPreempt(kind, cur, { user })) return null;
    if (cur) this.onPreempt && this.onPreempt(cur, kind);
    this.current = { kind, token: ++this.seq, meta, since: Date.now() };
    this.onChange && this.onChange(this.current);
    return this.current.token;
  }

  /** ยังถือสิทธิ์อยู่หรือไม่ (ถูกแทรกไปแล้วจะได้ false) */
  holds(token) { return !!this.current && this.current.token === token; }

  end(token) {
    if (this.holds(token)) {
      this.current = null;
      this.onChange && this.onChange(null);
    }
  }

  get kind() { return this.current ? this.current.kind : "idle"; }
}
