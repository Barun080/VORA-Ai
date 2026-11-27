// ติดตามผู้เข้าชม (Visitor Session) จากกล่องใบหน้าที่ MediaPipe ตรวจพบ
// - ใช้ Tracking ID ชั่วคราว (T1, T2, …) จับคู่ด้วยตำแหน่งกล่องระหว่างเฟรมเท่านั้น
// - ไม่ใช้ Face Recognition ไม่เก็บภาพ ไม่สร้าง Face Embedding และล้าง ID ทุกครั้งที่ Session จบ
//   จึงระบุตัวบุคคลข้ามการเข้าชมไม่ได้โดยการออกแบบ
// เหตุการณ์: onSessionStart(session) ครั้งเดียวเมื่อมีผู้เข้าชมใหม่ (ใช้ทักทาย)
//            onPersonJoin(session)    มีคนเพิ่มเข้ามาระหว่าง Session (ไม่ทักซ้ำ)
//            onSessionEnd(session)    ไม่มีใครอยู่ในพื้นที่นานเกิน leaveMs

export class VisitorTracker {
  // minNewWidth (10 พ.ย. 2569): ใบหน้าเล็กกว่านี้ใช้ต่ออายุคนที่ติดตามอยู่ได้ แต่ไม่เริ่มนับคนใหม่ (Hysteresis — กันคนที่ยืนตรงขอบระยะหลุดเข้า-ออกถี่ ๆ)
  constructor({ arriveMs = 800, leaveMs = 6000, trackTtlMs = 1500, matchDistance = 0.22, minNewWidth = 0 } = {}, events = {}) {
    this.cfg = { arriveMs, leaveMs, trackTtlMs, matchDistance, minNewWidth };
    this.ev = events;
    this.tracks = [];
    this.nextTrack = 1;
    this.nextSession = 1;
    this.session = null;
    this.lastPresence = 0;
  }

  /** faces: [{x,y,w,h}] พิกัด 0..1, ts: มิลลิวินาที (performance.now) */
  update(faces, ts) {
    const c = this.cfg;
    const centers = faces.map((f) => ({ cx: f.x + f.w / 2, cy: f.y + f.h / 2, w: f.w }));
    const used = new Set();
    // จับคู่ track เดิมกับใบหน้าที่ใกล้ที่สุด (greedy) — เพียงพอสำหรับคนจำนวนน้อยหน้าหุ่น
    for (const tr of this.tracks) {
      let best = -1, bestD = c.matchDistance;
      centers.forEach((f, i) => {
        if (used.has(i)) return;
        const d = Math.hypot(f.cx - tr.cx, f.cy - tr.cy);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) {
        used.add(best);
        Object.assign(tr, centers[best], { lastSeen: ts });
      }
    }
    centers.forEach((f, i) => {
      if (!used.has(i) && f.w >= c.minNewWidth) this.tracks.push({ id: `T${this.nextTrack++}`, ...f, firstSeen: ts, lastSeen: ts, confirmed: false });
    });
    this.tracks = this.tracks.filter((tr) => ts - tr.lastSeen <= c.trackTtlMs);

    const newly = [];
    for (const tr of this.tracks) {
      if (!tr.confirmed && tr.lastSeen === ts && ts - tr.firstSeen >= c.arriveMs) { tr.confirmed = true; newly.push(tr); }
    }
    const present = this.tracks.filter((tr) => tr.confirmed && tr.lastSeen === ts);
    if (present.length) this.lastPresence = ts;

    if (!this.session && newly.length) {
      this.session = { id: `V${this.nextSession++}`, startedAt: ts, people: present.length, maxPeople: present.length, greeted: false };
      this.ev.onSessionStart && this.ev.onSessionStart(this.session);
    } else if (this.session && newly.length) {
      this.session.people = present.length;
      this.session.maxPeople = Math.max(this.session.maxPeople, present.length);
      this.ev.onPersonJoin && this.ev.onPersonJoin(this.session, newly.length);
    } else if (this.session) {
      this.session.people = present.length;
    }

    if (this.session && ts - this.lastPresence > c.leaveMs) this.end(ts);
  }

  end(ts = performance.now()) {
    if (!this.session) return;
    const s = { ...this.session, endedAt: ts, durationMs: ts - this.session.startedAt };
    this.session = null;
    this.tracks = [];          // ล้าง Tracking ID ทั้งหมดเมื่อจบ Session
    this.ev.onSessionEnd && this.ev.onSessionEnd(s);
  }

  /** เมื่อกล้องปิด/หลุด: ปิด Session ที่ค้างอยู่ */
  reset() { this.end(); this.tracks = []; }

  snapshot() {
    return {
      session: this.session ? { id: this.session.id, people: this.session.people, maxPeople: this.session.maxPeople } : null,
      tracks: this.tracks.map((t) => ({ id: t.id, confirmed: t.confirmed })),
    };
  }
}
