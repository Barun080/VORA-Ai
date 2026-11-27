// VORA — EQ 3 แบนด์สำหรับเสียงพูด (Phase 3 · 12 พ.ย. 2569)
// ต่อแทรกใน audio pipeline เดิมของ VORA (voice.js → attachAnalyser) — ไม่สร้าง pipeline ใหม่ซ้อน
// Phase 4 (ตามที่อนุมัติ): MediaElementSource → Analyser เดิม → Bass(lowshelf 260) → Clarity(peaking 2400, Q 1.1) → Treble(highshelf 5500)
//   → LowPass(11200) → Gain(volume) → ลำโพง · analyser อยู่ก่อน EQ เพื่อให้ปากอวตารวัดจากเสียงต้นฉบับ
// หนึ่ง AudioContext + ปลายทางเดียว = EQ ชุดเดียว (ใช้ร่วมกันทุกเสียงพูด)
// ไม่แตะ playbackRate / detune (Phase 3: speed 1.0, pitch 0)
// ไฟล์นี้ยังไม่ถูกเรียกใช้จนกว่าจะเชื่อมใน Phase 4

export const EQ_BANDS = Object.freeze({
  bass: Object.freeze({ type: "lowshelf", frequency: 260 }),
  clarity: Object.freeze({ type: "peaking", frequency: 2400, Q: 1.1 }),
  treble: Object.freeze({ type: "highshelf", frequency: 5500 }),
  smooth: Object.freeze({ type: "lowpass", frequency: 11200 }),
});

const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);

/** profile → ค่าที่ใช้กับ node (จำกัดช่วงปลอดภัย · ค่าผิดรูปแบบใช้ค่าเริ่มต้น) */
export function eqParams(profile = {}) {
  const eq = profile.eq || {};
  return {
    bassDb: clamp(eq.bassDb, -12, 12, 0),
    clarityDb: clamp(eq.clarityDb, -10, 10, 0),
    trebleDb: clamp(eq.trebleDb, -12, 12, 0),
    lowpassHz: clamp(eq.lowpassHz, 4000, 20000, EQ_BANDS.smooth.frequency),
    volume: clamp(profile.volume, 0.01, 1, 1),
  };
}

export class VoiceEq {
  /** @param {AudioContext} ctx  @param {AudioNode} destination  ปลายทางของเสียงหลัง EQ (ctx.destination) */
  constructor(ctx, destination, params = {}) {
    this.ctx = ctx;
    const mk = (band) => {
      const f = ctx.createBiquadFilter();
      f.type = band.type;
      f.frequency.value = band.frequency;
      if (band.Q) f.Q.value = band.Q;
      return f;
    };
    this.bass = mk(EQ_BANDS.bass);
    this.clarity = mk(EQ_BANDS.clarity);
    this.treble = mk(EQ_BANDS.treble);
    this.smooth = mk(EQ_BANDS.smooth);
    this.gain = ctx.createGain();
    this.bass.connect(this.clarity);
    this.clarity.connect(this.treble);
    this.treble.connect(this.smooth);
    this.smooth.connect(this.gain);
    this.gain.connect(destination);
    this.input = this.bass;
    this.update(params);
  }

  /** ปรับค่าได้ทันทีระหว่างพูด (applyLiveVoiceParams) — รับ object จาก eqParams() */
  update(p = {}) {
    if ("bassDb" in p) this.bass.gain.value = p.bassDb;
    if ("clarityDb" in p) this.clarity.gain.value = p.clarityDb;
    if ("trebleDb" in p) this.treble.gain.value = p.trebleDb;
    if ("lowpassHz" in p) this.smooth.frequency.value = p.lowpassHz;
    if ("volume" in p) this.gain.gain.value = p.volume;
    return this;
  }

  /** ต่อแหล่งเสียง (MediaElementSource ของประโยคที่กำลังเล่น) เข้า EQ */
  connect(source) {
    source.connect(this.input);
    return source;
  }
}

const _shared = new WeakMap();   // destination → VoiceEq (กันการสร้างชุดซ้ำต่อปลายทางเดียวกัน)

/** EQ ชุดเดียวต่อปลายทาง — เรียกซ้ำได้ ได้ตัวเดิมทุกครั้ง (อัปเดตค่าตาม params ล่าสุด) */
export function sharedVoiceEq(ctx, destination, params) {
  let eq = _shared.get(destination);
  if (!eq || eq.ctx !== ctx) {
    eq = new VoiceEq(ctx, destination, params);
    _shared.set(destination, eq);
  } else if (params) {
    eq.update(params);
  }
  return eq;
}
