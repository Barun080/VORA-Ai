// ระบบเสียงของ VORA: รับเสียงพูด (STT) และพูดตอบ (TTS) โดยไม่ให้ฟังกับพูดชนกัน
// STT: Web Speech API ของเบราว์เซอร์ (แนะนำ Chrome/Edge)  TTS: เสียงจากเซิร์ฟเวอร์ (edge-tts) ถ้ามี ไม่เช่นนั้นใช้เสียงของเบราว์เซอร์
// 12 พ.ย. 2569 (Phase 4 · voice integration): Speaker ใช้ voice core (voice/profile.js · voice/speech-text.js · voice/eq.js)
//   - ข้อความผ่าน normalizeForSpeech ก่อนส่ง TTS (คงเวลา/วันที่/เบอร์/URL)
//   - ล็อกผู้ให้บริการเสียงหนึ่งรายต่อหนึ่งคำตอบ (ส่ง provider ไปกับ /api/tts/session และ /api/tts) · สำรองได้เฉพาะที่ขอบเขตชัดเจน ไม่วนกลับ
//   - ไฟล์เสียงที่เตรียมไว้ (assets/voices) ใช้เมื่อข้อความตรงทั้งข้อความและผู้ให้บริการตรงกัน
//   - เสียง: แหล่งเสียง → Analyser (ปากอวตารวัดจากเสียงต้นฉบับ) → EQ → Gain(volume) → ลำโพง · analyser/EQ สร้างครั้งเดียว · ปลด source หลังเล่นจบ
//   - เสียงเบราว์เซอร์: ผู้หญิงเท่านั้น เลือกแบบคงที่ (profile.pickFemaleVoice)
//   Listener ไม่เปลี่ยน · ไม่มี wake word / การฟังตลอดเวลา
import { profileFor, pickFemaleVoice, findPrecached } from "./voice/profile.js";
import { splitSentences, speechChunks, speechText } from "./voice/speech-text.js";
import { sharedVoiceEq, eqParams } from "./voice/eq.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export class Listener {
  // 8 พ.ย. 2569: แก้ Root Cause — ตัวจัดการเหตุการณ์ของรอบฟังเก่า (onend/onerror ที่มาช้าหลัง abort) ไปเปลี่ยนสถานะของรอบใหม่
  //   เดิม: onend ของรอบเก่าตั้ง active=false, ล้างตัวจับเวลาของรอบใหม่ และเรียก onEnd/onFinal → หน้าจอกลับเป็นว่างทั้งที่ไมค์รอบใหม่ยังฟังอยู่
  //         หรือส่งข้อความเก่าไปถาม AI ซ้ำ · ตอนนี้ทุกเหตุการณ์ตรวจว่าเป็นของรอบปัจจุบัน (this.rec) ก่อนเสมอ
  // เพิ่ม: onAudioStart (ไมค์เริ่มรับเสียงจริง), onSpeechEnd (หยุดพูดแล้ว กำลังแปลงเสียง), เวลารอไมค์เริ่มทำงาน
  constructor({ onPartial, onFinal, onError, onEnd, onAudioStart, onSpeechEnd } = {}) {
    this.cb = { onPartial, onFinal, onError, onEnd, onAudioStart, onSpeechEnd };
    this.supported = !!SR;
    this.active = false;
    this.live = false;          // ไมค์รับเสียงอยู่จริง (หลัง onaudiostart)
    this.lastError = "";
    this.stats = { created: 0, starts: 0, ends: 0, errors: 0, stale: 0 };
  }

  start(lang = "th") {
    if (!this.supported) { this.cb.onError && this.cb.onError("not-supported"); return false; }
    this.stop(true);
    const rec = new SR();
    this.stats.created++;
    rec.lang = lang === "en" ? "en-US" : "th-TH";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    let interimText = "";
    let gotFinal = false;
    const mine = () => { if (this.rec === rec) return true; this.stats.stale++; return false; };
    rec.onaudiostart = () => {
      if (!mine()) return;
      clearTimeout(this.startGuard);
      this.live = true;
      this.cb.onAudioStart && this.cb.onAudioStart();
    };
    rec.onspeechend = () => { if (mine()) this.cb.onSpeechEnd && this.cb.onSpeechEnd(); };
    rec.onresult = (ev) => {
      if (!mine()) return;
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      interimText = interim;
      this.cb.onPartial && this.cb.onPartial((finalText + interim).trim());
    };
    rec.onerror = (ev) => {
      if (!mine() || ev.error === "aborted") return;
      this.stats.errors++;
      this.lastError = ev.error;
      this.cb.onError && this.cb.onError(ev.error);
    };
    rec.onend = () => {
      if (!mine()) return;     // รอบเก่าที่ถูกยกเลิกไปแล้ว: ไม่แตะสถานะของรอบใหม่
      this.stats.ends++;
      this.active = false;
      this.live = false;
      this.rec = null;
      clearTimeout(this.guard);
      clearTimeout(this.startGuard);
      if (!gotFinal) {
        gotFinal = true;
        // บางเบราว์เซอร์จบรอบโดยไม่ส่งผล isFinal → ใช้ข้อความระหว่างพูดล่าสุดแทน (เป็นคำที่ผู้ใช้พูดจริง ไม่ใช่ข้อความปลอม)
        const t = (finalText || interimText).trim();
        if (t) this.cb.onFinal && this.cb.onFinal(t);
        else this.cb.onEnd && this.cb.onEnd();
      }
    };
    this.rec = rec;
    // รอบเก่ายังปิดไม่เสร็จ (abort เป็นแบบไม่พร้อมกัน) → รอให้จบก่อนค่อยเปิดรอบใหม่ (สูงสุด 400ms) ไม่ให้ไมค์สองรอบทำงานซ้อนกัน
    const go = () => {
      if (this.rec !== rec) return;
      try { rec.start(); this.stats.starts++; } catch (e) {
        this.rec = null;
        this.active = false;
        clearTimeout(this.startGuard); clearTimeout(this.guard);
        this.lastError = (e && e.name) || "start-failed";
        this.cb.onError && this.cb.onError("start-failed");
      }
    };
    if (this.closing) this.closing.then(go); else go();
    if (!this.rec) return false;
    this.active = true;
    this.live = false;
    // ไมค์ไม่เริ่มรับเสียงภายใน 6 วิ (อุปกรณ์ถูกใช้อยู่/ไดรเวอร์ค้าง) → ยกเลิกและแจ้ง ไม่ปล่อยให้หน้าจอแสดงว่ากำลังฟังทั้งที่ไม่ได้ฟัง
    this.startGuard = setTimeout(() => {
      if (this.rec !== rec || this.live) return;
      this.lastError = "mic-timeout";
      this.stop(true);
      this.cb.onError && this.cb.onError("mic-timeout");
    }, 6000);
    // กันกรณีเบราว์เซอร์ค้างไม่จบการฟัง
    this.guard = setTimeout(() => { if (this.rec === rec) this.stop(); }, 12000);
    return true;
  }

  stop(abort = false) {
    clearTimeout(this.guard);
    clearTimeout(this.startGuard);
    const rec = this.rec;
    if (rec && abort) {
      this.rec = null;   // ยกเลิก = เหตุการณ์ที่ตามมาของรอบนี้ถูกละเลยทั้งหมด
      // จำไว้ว่ารอบนี้กำลังปิด (start() รอบถัดไปจะรอ onend ของรอบนี้ก่อน)
      const closing = new Promise((done) => {
        const prev = rec.onend;
        const t = setTimeout(done, 400);
        rec.onend = (e) => { clearTimeout(t); try { prev && prev(e); } finally { done(); } };
      });
      this.closing = closing;
      closing.then(() => { if (this.closing === closing) this.closing = null; });
    }
    if (rec) { try { abort ? rec.abort() : rec.stop(); } catch { /* ignore */ } }
    this.active = abort ? false : this.active && !!this.rec;
    if (abort) this.live = false;
  }
}

/** สตรีมขาดที่วินาที at → ประโยคที่ควรพูดต่อ (ประมาณ ~12 ตัวอักษรต่อวินาที) */
function resumeFrom(chunks, at) {
  const spoken = Math.max(0, at) * 12;
  let sum = 0;
  for (let i = 0; i < chunks.length; i++) {
    sum += chunks[i].length + 1;
    if (sum > spoken) return chunks.slice(i);
  }
  return [];
}

// 21 พ.ย. 2569 (งาน F): splitSentences / speechChunks / speechText ย้ายไป ./voice/speech-text.js (ไม่มีโค้ดเบราว์เซอร์)
// เพื่อให้หน้าหลังบ้าน ("เตรียมเสียงล่วงหน้า") ใช้ฟังก์ชันเดียวกับหน้าจอหุ่น → ข้อความ/คีย์แคชเสียงตรงกันทุกตัวอักษร
export { speechChunks, speechText };

/** 27 พ.ย. 2569: iPad/iPhone — เบราว์เซอร์ไม่ยอมเล่นเสียงจนกว่าผู้ใช้จะแตะจอ (คำทักทายอัตโนมัติจึงเงียบ)
 *  ?audiounlock=1 / 0 บังคับเปิด/ปิด */
export function needsAudioUnlock(ua = (typeof navigator !== "undefined" && navigator.userAgent) || "", touch = (typeof navigator !== "undefined" && navigator.maxTouchPoints) || 0,
  search = (typeof location !== "undefined" && location.search) || "") {
  const f = new URLSearchParams(search).get("audiounlock");
  if (f === "1" || f === "0") return f === "1";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
}
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export class Speaker {
  constructor({ onLevel, onStart, onEnd, onAudio } = {}) {
    this.cb = { onLevel, onStart, onEnd, onAudio };     // onAudio(on): 11 พ.ย. 2569 เสียงออกลำโพงจริง (ใช้ให้ปากขยับตรงกับเสียง)
    this.prefetched = new Map();
    this.serverTTS = false;
    this.rate = 1;
    this.speaking = false;
    this.token = 0;
    this.voices = [];
    this.fetchTimeoutMs = 9000;     // ประโยคละไม่เกิน 9 วิ (เซิร์ฟเวอร์จำกัด 8 วิ) แล้วใช้เสียงเบราว์เซอร์ต่อ
    this.profile = profileFor("vora");   // Phase 4: หนึ่ง character = หนึ่ง voice profile (EQ อย่างเดียว · speed 1.0 · pitch 0)
    this.order = [];                // ลำดับผู้ให้บริการจากเซิร์ฟเวอร์ (cfg.tts.order) · ว่าง = ไม่ส่ง provider (ทำงานแบบเดิม)
    this.lastProvider = "";         // ผู้ให้บริการ/แหล่งเสียงที่ใช้จริงของคำตอบล่าสุด (precached:google · google · edge · browser)
    if ("speechSynthesis" in window) {
      const load = () => (this.voices = speechSynthesis.getVoices());
      load();
      speechSynthesis.onvoiceschanged = load;
    }
    if (needsAudioUnlock()) this.installUnlock();
  }

  /** iPad: แตะจอครั้งแรก → ปลดล็อก <audio> ตัวเดียวที่ใช้เล่นทุกประโยค + AudioContext + เสียงเบราว์เซอร์
   *  หลังจากนั้นคำทักทายเมื่อกล้องเห็นคนจะมีเสียงได้โดยไม่ต้องแตะอีก (ต่อการเปิดหน้าหนึ่งครั้ง) */
  installUnlock() {
    this.sharedEl = new Audio();
    this.sharedEl.setAttribute("playsinline", "");
    this.unlocked = false;
    const evs = ["pointerdown", "touchend", "keydown", "click"];
    const unlock = () => {
      if (this.unlocked) return;
      const el = this.sharedEl;
      try {
        this.ctx = this.ctx || new AudioContext();
        if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      } catch { /* ไม่มี Web Audio */ }
      try { if ("speechSynthesis" in window) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } } catch { /* */ }
      if (this.audio === el) return;           // กำลังเล่นอยู่ = ปลดล็อกแล้ว
      el.muted = true;
      el.src = SILENT_WAV;
      el.play().then(() => {
        el.pause(); el.muted = false; this.unlocked = true;
        evs.forEach((t) => document.removeEventListener(t, unlock, true));
      }).catch(() => { el.muted = false; });
    };
    evs.forEach((t) => document.addEventListener(t, unlock, true));
  }

  pickVoice(lang) {
    // 11 พ.ย. 2569: ใช้เฉพาะเสียงผู้หญิง (เสียงประจำตัว VORA) — Chrome บน Windows มีเสียงไทยแค่ "Pattara" ซึ่งเป็นเสียงผู้ชาย
    // ไม่มีเสียงผู้หญิง = ไม่พูดด้วยเสียงเบราว์เซอร์ (ข้อความยังแสดงครบ)
    // Phase 4: ลำดับคงที่ตาม profile (Premwadee > Kanya > Narisa > Achara > Google ไทย) · บล็อกเสียงผู้ชายรวม ภัทระ/นิวัฒน์/Male
    return pickFemaleVoice(this.voices, lang);
  }

  /** ผู้ให้บริการที่ล็อกได้ตามลำดับ (ว่าง = เซิร์ฟเวอร์รุ่นเก่า/ไม่ได้ตั้ง → ไม่ส่ง provider) */
  providers() {
    return (Array.isArray(this.order) ? this.order : []).filter((p) => p === "edge" || p === "google");
  }

  async speak(text, lang = "th") {
    this.stop();
    const my = ++this.token;
    if (!text || !text.trim()) return;
    const chunks = speechChunks(text);          // Phase 4: normalize ก่อนส่ง TTS
    if (!chunks.length) return;
    this.speaking = true;
    this.lastPath = "";
    this.lastProvider = "";
    this.cb.onStart && this.cb.onStart();
    try {
      let rest = chunks;
      const providers = this.serverTTS ? this.providers() : [];
      // 1) ไฟล์เสียงที่เตรียมไว้: ข้อความตรงทั้งข้อความ + ผู้ให้บริการหลักเป็นรายเดียวกับที่อัดไฟล์ (ไม่ผสมเสียง)
      const pre = providers.length ? findPrecached(text, { provider: providers[0], lang }) : null;
      if (pre) {
        const r = await this.playSrc(pre, my, 8000);
        if (my !== this.token) return;
        if (r.status === "ok") { rest = []; this.lastPath = "precached"; this.lastProvider = `precached:${providers[0]}`; }
      }
      if (rest.length && this.serverTTS) {
        // 12 พ.ย. 2569: สตรีมเสียงทั้งคำตอบในการเชื่อมต่อเดียว (เริ่มพูดเมื่อได้เสียงชิ้นแรก ไม่มีช่องว่างระหว่างประโยค)
        // เริ่มไม่ได้ → ใช้วิธีเดิมทีละประโยค · สตรีมขาดกลางทาง → พูดต่อจากประโยคที่น่าจะค้างอยู่
        // Phase 4: ล็อกผู้ให้บริการทีละราย (ตามลำดับ cfg.tts.order) — เปลี่ยนรายได้เฉพาะเมื่อคำตอบนี้ยังไม่มีเสียงออกเลย และไม่วนกลับ
        const plan = providers.length ? providers : [null];
        for (let i = 0; i < plan.length && rest.length; i++) {
          const lock = plan[i];
          const before = rest.length;
          this.playedServer = false;
          const r = await this.speakStream(rest.join(" "), lang, my, lock);
          if (my !== this.token) return;
          if (r.status === "ok") rest = [];
          else if (r.status === "broken") rest = resumeFrom(rest, r.at);
          this.lastPath = (r.status === "ok" ? "stream" : `stream-${r.status}`) + (lock ? `:${lock}` : "");
          const streamed = r.status !== "nostart";
          if (rest.length) rest = await this.speakServer(rest, lang, my, lock);
          if (my !== this.token) return;
          if (streamed || this.playedServer || rest.length < before) { this.lastProvider = lock || "server"; break; }   // มีเสียงออกแล้ว: ห้ามเปลี่ยนผู้ให้บริการในคำตอบนี้
        }
      }
      if (rest.length && my === this.token) {
        this.lastPath = this.lastPath ? this.lastPath + "+browser" : "browser";
        this.lastProvider = this.lastProvider ? this.lastProvider + "+browser" : "browser";
        await this.speakBrowser(rest.join(" "), lang, my);
      }
    } finally {
      if (my === this.token) {
        this.speaking = false;
        this.cb.onLevel && this.cb.onLevel(0);
        this.cb.onEnd && this.cb.onEnd();
      }
    }
  }

  /** ดาวน์โหลดเสียงหนึ่งประโยค (จำกัดเวลา) → Blob หรือ null */
  /** 11 พ.ย. 2569: เตรียมเสียงล่วงหน้า (เช่น สไลด์ถัดไปของพรีเซนเทชัน) — เซิร์ฟเวอร์เก็บไฟล์เสียงไว้ พอถึงเวลาพูดจึงเล่นได้ทันที */
  prefetch(texts, lang = "th") {
    // 12 พ.ย. 2569: เตรียมเสียง "ทั้งข้อความ" เก็บแคชที่เซิร์ฟเวอร์ทีละข้อความ (เซิร์ฟเวอร์รอให้งานพูดจริงก่อน) → พอพูดจริงสตรีมจากแคชทันที
    if (!this.serverTTS) return;
    this.warmQueue = this.warmQueue || [];
    for (const text of texts || []) { const x = speechText(text); if (x) this.warmQueue.push({ text: x, lang }); }   // Phase 4: ข้อความเดียวกับที่จะพูดจริง
    this.pumpWarm();
  }

  async pumpWarm() {
    if (this.warming) return;
    this.warming = true;
    try {
      while (this.warmQueue.length) {
        const job = this.warmQueue.shift();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 30000);
        await fetch("/api/tts/warm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job), signal: ctl.signal }).catch(() => null);
        clearTimeout(timer);
      }
    } finally { this.warming = false; }
  }

  /** สตรีมเสียงทั้งข้อความ → { status: "ok" | "nostart" | "broken", at: วินาทีที่เล่นไปแล้ว } */
  async speakStream(text, lang, my, provider = null) {
    let id;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const payload = { text: text.slice(0, 1500), lang };
      if (provider) payload.provider = provider;            // Phase 4: ล็อกผู้ให้บริการของคำตอบนี้
      const r = await fetch("/api/tts/session", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: ctl.signal });
      clearTimeout(timer);
      if (!r.ok) return { status: "nostart", at: 0 };
      id = (await r.json()).id;
    } catch { return { status: "nostart", at: 0 }; }
    if (my !== this.token) return { status: "ok", at: 0 };
    return this.playSrc(`/api/tts/stream/${encodeURIComponent(id)}`, my, 15000);
  }

  prefetchChunks(texts, lang = "th") {
    // 11 พ.ย. 2569 (แก้รอบ 2): เดิมขอเสียงทุกสไลด์พร้อมกัน ~10 คำขอ → บริการเสียงล้ม → เข้าช่วงพัก → พรีเซนต์เงียบทั้งชุด
    // ตอนนี้: เข้าคิว ขอทีละประโยคตามลำดับ (เซิร์ฟเวอร์สร้างพร้อมกันได้ 2 → อีกช่องว่างไว้ให้ประโยคที่กำลังจะพูด)
    if (!this.serverTTS) return;
    this.preQueue = this.preQueue || [];
    const provider = this.providers()[0] || null;          // Phase 4: เตรียมด้วยผู้ให้บริการหลักที่จะล็อกตอนพูด
    for (const text of texts || []) {
      for (const chunk of speechChunks(text).slice(0, 2)) {
        const key = `${provider || ""}|${lang}|${chunk}`;
        if (!chunk || this.prefetched.has(key)) continue;
        if (this.prefetched.size > 200) this.prefetched.clear();
        let resolve;
        this.prefetched.set(key, new Promise((r) => (resolve = r)));
        this.preQueue.push({ key, chunk, lang, provider, resolve });
      }
    }
    this.pumpPrefetch();
  }

  async pumpPrefetch() {
    if (this.prePumping) return;
    this.prePumping = true;
    try {
      while (this.preQueue.length) {
        const job = this.preQueue.shift();
        if (!this.prefetched.has(job.key)) { job.resolve(null); continue; }   // ถูกพูดไปแล้ว/ล้างแคช
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 15000);
        const blob = await fetch(`/api/tts?lang=${job.lang}&pre=1${job.provider ? `&provider=${job.provider}` : ""}&text=${encodeURIComponent(job.chunk)}`, { signal: ctl.signal })
          .then((r) => (r.status === 200 ? r.blob() : null)).then((b) => (b && b.size ? b : null)).catch(() => null);
        clearTimeout(timer);
        job.resolve(blob);
      }
    } finally { this.prePumping = false; }
  }

  async fetchChunk(text, lang, signal, provider = null) {
    const pkey = `${provider || ""}|${lang}|${text}`;     // Phase 4: เสียงที่เตรียมไว้ใช้ได้เฉพาะผู้ให้บริการเดียวกัน
    const pre = this.prefetched.get(pkey);
    if (pre) {
      this.prefetched.delete(pkey);
      // รอเสียงที่เตรียมไว้ไม่เกิน 2.5 วิ (ยังอยู่ในคิว) แล้วขอเองโดยตรง — เซิร์ฟเวอร์รวมคำขอซ้ำให้ ไม่สร้างเสียงสองครั้ง
      const b = await Promise.race([pre, new Promise((r) => setTimeout(() => r(null), 2500))]);
      if (b) return b;
    }
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal.addEventListener("abort", onAbort);
    const timer = setTimeout(() => ctl.abort(), Math.max(12000, 3000 + text.length * 60));
    try {
      const res = await fetch(`/api/tts?lang=${lang}${provider ? `&provider=${provider}` : ""}&text=${encodeURIComponent(text)}`, { signal: ctl.signal });
      if (res.status !== 200) return null;
      const blob = await res.blob();
      return blob.size > 0 ? blob : null;
    } catch { return null; } finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
  }

  /** ต่อเสียงเข้าตัววิเคราะห์ความดังตัวเดียวของหน้า (ใช้ขยับปากอวตารและเอฟเฟกต์) — AudioContext ถูกระงับ = เล่นตรง ไม่ผ่านตัววิเคราะห์ */
  attachAnalyser(audio) {
    try {
      this.ctx = this.ctx || new AudioContext();
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      if (this.ctx.state !== "running") return null;   // ถ้าต่อผ่าน context ที่ถูกระงับ เสียงจะเงียบทั้งที่อวตารขยับปาก (บั๊กเดิม)
      if (!this.analyser) {
        // Phase 4: แหล่งเสียง → Analyser → EQ(bass/clarity/treble/lowpass) → Gain(volume) → ลำโพง · สร้างครั้งเดียวต่อหน้า
        // analyser อยู่ก่อน EQ: ปากอวตารวัดจากเสียงต้นฉบับ (EQ/volume ไม่ทำให้ปากขยับน้อยลง)
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.eq = sharedVoiceEq(this.ctx, this.ctx.destination, eqParams(this.profile));
        this.analyser.connect(this.eq.input);
      }
      if (audio._voraSource) return this.analyser;            // <audio> ตัวเดียวที่ใช้ซ้ำ (iPad) ต่อไว้แล้ว
      const src = this.ctx.createMediaElementSource(audio);   // หนึ่ง source ต่อหนึ่ง <audio> (เบราว์เซอร์อนุญาตครั้งเดียวต่อ element)
      src.connect(this.analyser);
      audio._voraSource = src;                                 // ปลดหลังเล่นจบใน playSrc (กัน audio graph โตขึ้นทุกประโยค)
      return this.analyser;
    } catch { return null; }
  }

  /** เสียงจากเซิร์ฟเวอร์ทีละประโยค: ดาวน์โหลดประโยคถัดไประหว่างเล่นประโยคปัจจุบัน (เริ่มพูดเร็ว ไม่ต้องรอทั้งคำตอบ และไม่ถูกตัดที่ 600 ตัวอักษร)
   *  คืนรายการประโยคที่ยังไม่ได้พูด (ให้เสียงของเบราว์เซอร์พูดต่อ) — ว่าง = พูดครบ */
  async speakServer(chunks, lang, my, provider = null) {
    const abort = new AbortController();
    this.abortFetch = abort;
    let next = this.fetchChunk(chunks[0], lang, abort.signal, provider);
    for (let i = 0; i < chunks.length; i++) {
      let blob = await next;
      if (my !== this.token) { abort.abort(); return []; }
      if (!blob && !abort.signal.aborted) {   // 11 พ.ย. 2569: ลองดาวน์โหลดเสียงประโยคนี้ใหม่ 1 ครั้ง ก่อนยอมใช้เสียงเบราว์เซอร์
        await new Promise((r) => setTimeout(r, 250));
        if (my !== this.token) { abort.abort(); return []; }
        blob = await this.fetchChunk(chunks[i], lang, abort.signal, provider);
        if (my !== this.token) { abort.abort(); return []; }
      }
      if (!blob) {
        this.ttsFailures = (this.ttsFailures || 0) + 1;
        // 11 พ.ย. 2569 (รอบ 4): ไม่มีเสียงผู้หญิงในเบราว์เซอร์ → ข้ามเฉพาะประโยคที่สร้างเสียงไม่ได้ แล้วพูดประโยคถัดไปต่อ
        // (เดิมยกประโยคที่เหลือทั้งหมดให้เบราว์เซอร์ → เงียบตั้งแต่ประโยคนั้นจนจบ เช่น สรุปผลค้นเว็บพูดไม่ครบ)
        if (!this.pickVoice(lang) && i + 1 < chunks.length) { next = this.fetchChunk(chunks[i + 1], lang, abort.signal, provider); continue; }
        abort.abort(); return chunks.slice(i);
      }
      next = i + 1 < chunks.length ? this.fetchChunk(chunks[i + 1], lang, abort.signal, provider) : null;
      this.lastPath = provider ? `server:${provider}` : "server";
      const ok = await this.playBlob(blob, my);
      if (ok) this.playedServer = true;
      if (my !== this.token) { abort.abort(); return []; }
      if (!ok) { abort.abort(); return chunks.slice(i); }   // เล่นไม่ได้ (เช่น ถูกบล็อก autoplay) → เบราว์เซอร์พูดต่อตั้งแต่ประโยคนี้
    }
    return [];
  }

  async playBlob(blob, my) {
    const url = URL.createObjectURL(blob);
    const r = await this.playSrc(url, my, 8000);
    URL.revokeObjectURL(url);
    return r.status === "ok" && my === this.token;
  }

  /** เล่นเสียงจาก URL (ไฟล์หรือสตรีม) พร้อมขยับปาก · startMs = เวลารอเสียงแรกก่อนถือว่าเริ่มไม่ได้ */
  async playSrc(url, my, startMs = 8000) {
    const shared = !!(this.sharedEl && this.unlocked);
    const audio = shared ? this.sharedEl : new Audio();
    const lc = new AbortController();                 // ตัวรับเหตุการณ์ของประโยคนี้เท่านั้น (ตัว <audio> ที่ใช้ซ้ำไม่สะสม)
    const on = (t, f) => audio.addEventListener(t, f, { signal: lc.signal });
    audio.preload = "auto";
    audio.src = url;
    if ("preservesPitch" in audio) audio.preservesPitch = true;   // Phase 4: ความเร็วไม่เปลี่ยน pitch (pitch คงที่ 0)
    audio.playbackRate = this.rate;
    this.audio = audio;
    const an = this.attachAnalyser(audio);
    if (!an) audio.volume = this.profile.volume;            // ไม่ผ่าน Web Audio (context ถูกระงับ) → volume ตาม profile ที่ element
    const buf = an ? new Uint8Array(an.frequencyBinCount) : null;
    const tick = () => {
      if (audio.paused || audio.ended || this.audio !== audio) return;
      if (an) {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const b of buf) peak = Math.max(peak, Math.abs(b - 128));
        this.cb.onLevel && this.cb.onLevel(Math.min(1, peak / 50));
      } else {
        this.cb.onLevel && this.cb.onLevel(0.35 + 0.4 * Math.abs(Math.sin(performance.now() / 90)));   // ไม่มีตัววิเคราะห์: จังหวะปากโดยประมาณ
      }
      requestAnimationFrame(tick);
    };
    on("play", tick);
    let started = false, status = "ok";
    on("playing", () => { started = true; this.cb.onAudio && this.cb.onAudio(true); });
    await new Promise((resolve) => {
      let safety = null, stall = null, startT = null;
      const done = () => { clearTimeout(safety); clearTimeout(stall); clearTimeout(startT); resolve(); };
      // เริ่มไม่ทัน = ถือว่าเริ่มไม่ได้ · สะดุดค้างนานเกิน 8 วิ = สตรีมขาด (ไม่ค้างทั้งหน้าจอ)
      startT = setTimeout(() => { if (!started) { status = "nostart"; try { audio.pause(); } catch { /* */ } done(); } }, startMs);
      on("waiting", () => { if (!started) return; clearTimeout(stall); stall = setTimeout(() => { status = "broken"; try { audio.pause(); } catch { /* */ } done(); }, 8000); });
      on("playing", () => clearTimeout(stall));
      on("loadedmetadata", () => { clearTimeout(safety); safety = setTimeout(done, Math.min(180000, ((isFinite(audio.duration) ? audio.duration : 90) + 10) * 1000)); });
      safety = setTimeout(done, 180000);
      audio.onended = done;
      audio.onerror = () => { status = started ? "broken" : "nostart"; done(); };
      this.stopAudio = done;      // stop(): ให้ประโยคที่ค้างจบทันที
      audio.play().catch(() => { status = "nostart"; done(); });
    });
    const at = audio.currentTime || 0;
    this.cb.onAudio && this.cb.onAudio(false);
    lc.abort();
    if (this.audio === audio) { try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch { /* */ } this.audio = null; }
    if (audio._voraSource && !shared) { try { audio._voraSource.disconnect(); } catch { /* */ } audio._voraSource = null; }
    return { status: my === this.token ? status : "ok", at };
  }

  async speakBrowser(text, lang, my) {
    if (!("speechSynthesis" in window)) {
      await new Promise((r) => setTimeout(r, Math.min(8000, 800 + text.length * 60)));
      return;
    }
    const voice = this.pickVoice(lang);
    if (!voice) {   // ไม่มีเสียงผู้หญิงในเบราว์เซอร์นี้ → ไม่พูด (ไม่ให้เบราว์เซอร์เลือกเสียงผู้ชายเอง) แต่รอเท่าเวลาพูดโดยประมาณให้จังหวะหน้าจอคงเดิม
      this.lastPath = (this.lastPath || "browser") + "-silent";
      this.silentFallbacks = (this.silentFallbacks || 0) + 1;
      await new Promise((r) => setTimeout(r, Math.min(6000, 600 + text.length * 40)));
      return;
    }
    for (const chunk of splitSentences(text)) {
      if (my !== this.token) return;
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.lang = lang === "en" ? "en-US" : "th-TH";
        if (voice) u.voice = voice;
        u.rate = this.rate;
        u.onboundary = () => { this.cb.onLevel && this.cb.onLevel(0.6 + Math.random() * 0.4); };
        u.onstart = () => this.cb.onAudio && this.cb.onAudio(true);
        const safety = setTimeout(resolve, 2500 + chunk.length * 160);   // กันกรณีเบราว์เซอร์ไม่ส่ง onend
        u.onend = u.onerror = () => { clearTimeout(safety); this.cb.onAudio && this.cb.onAudio(false); resolve(); };
        speechSynthesis.speak(u);
      });
    }
  }

  stop() {
    this.token++;
    if (this.abortFetch) { this.abortFetch.abort(); this.abortFetch = null; }
    if (this.audio) { try { this.audio.pause(); } catch { /* ignore */ } this.audio = null; }
    if (this.stopAudio) { const f = this.stopAudio; this.stopAudio = null; f(); }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.cb.onAudio && this.cb.onAudio(false);
    if (this.speaking) {
      this.speaking = false;
      this.cb.onLevel && this.cb.onLevel(0);
      this.cb.onEnd && this.cb.onEnd();
    }
  }
}
