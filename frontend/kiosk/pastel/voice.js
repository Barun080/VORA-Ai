// ระบบเสียงของ VORA: รับเสียงพูด (STT) และพูดตอบ (TTS) โดยไม่ให้ฟังกับพูดชนกัน
// STT: Web Speech API ของเบราว์เซอร์ (แนะนำ Chrome/Edge)  TTS: เสียงจากเซิร์ฟเวอร์ (edge-tts) ถ้ามี ไม่เช่นนั้นใช้เสียงของเบราว์เซอร์

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export class Listener {
  constructor({ onPartial, onFinal, onError, onEnd } = {}) {
    this.cb = { onPartial, onFinal, onError, onEnd };
    this.supported = !!SR;
    this.active = false;
  }

  start(lang = "th") {
    if (!this.supported) { this.cb.onError && this.cb.onError("not-supported"); return false; }
    this.stop(true);
    const rec = new SR();
    rec.lang = lang === "en" ? "en-US" : "th-TH";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    let gotFinal = false;
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.cb.onPartial && this.cb.onPartial((finalText + interim).trim());
    };
    rec.onerror = (ev) => { if (ev.error !== "aborted") this.cb.onError && this.cb.onError(ev.error); };
    rec.onend = () => {
      this.active = false;
      clearTimeout(this.guard);
      if (!gotFinal) {
        gotFinal = true;
        const t = finalText.trim();
        if (t) this.cb.onFinal && this.cb.onFinal(t);
        else this.cb.onEnd && this.cb.onEnd();
      }
    };
    this.rec = rec;
    try { rec.start(); } catch { return false; }
    this.active = true;
    // กันกรณีเบราว์เซอร์ค้างไม่จบการฟัง
    this.guard = setTimeout(() => this.stop(), 12000);
    return true;
  }

  stop(abort = false) {
    clearTimeout(this.guard);
    if (this.rec) { try { abort ? this.rec.abort() : this.rec.stop(); } catch { /* ignore */ } }
    this.active = false;
  }
}

function splitSentences(text) {
  const parts = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+|(?<=ค่ะ)\s+|(?<=ครับ)\s+|(?<=นะคะ)\s+/);
  const out = [];
  for (const p of parts) {
    if (!p.trim()) continue;
    if (out.length && (out[out.length - 1].length + p.length) < 140) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out.length ? out : [text];
}

export class Speaker {
  constructor({ onLevel, onStart, onEnd } = {}) {
    this.cb = { onLevel, onStart, onEnd };
    this.serverTTS = false;
    this.rate = 1;
    this.speaking = false;
    this.token = 0;
    this.voices = [];
    if ("speechSynthesis" in window) {
      const load = () => (this.voices = speechSynthesis.getVoices());
      load();
      speechSynthesis.onvoiceschanged = load;
    }
  }

  pickVoice(lang) {
    const want = lang === "en" ? "en" : "th";
    const vs = this.voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(want));
    const prefer = lang === "en" ? ["Aria", "Jenny", "Ava", "Google US", "Samantha"] : ["Premwadee", "Achara", "Pattara", "Google", "Kanya", "Narisa"];
    for (const p of prefer) { const v = vs.find((x) => x.name.includes(p)); if (v) return v; }
    return vs[0] || null;
  }

  async speak(text, lang = "th") {
    this.stop();
    const my = ++this.token;
    if (!text || !text.trim()) return;
    this.speaking = true;
    this.cb.onStart && this.cb.onStart();
    try {
      let done = false;
      if (this.serverTTS) done = await this.speakServer(text, lang, my);
      if (!done && my === this.token) await this.speakBrowser(text, lang, my);
    } finally {
      if (my === this.token) {
        this.speaking = false;
        this.cb.onLevel && this.cb.onLevel(0);
        this.cb.onEnd && this.cb.onEnd();
      }
    }
  }

  async speakServer(text, lang, my) {
    try {
      const res = await fetch(`/api/tts?lang=${lang}&text=${encodeURIComponent(text)}`);
      if (res.status !== 200 || my !== this.token) return false;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = this.rate;
      this.audio = audio;
      // วิเคราะห์ความดังเพื่อขยับปากอวตาร์ให้ตรงกับเสียง
      try {
        this.ctx = this.ctx || new AudioContext();
        const src = this.ctx.createMediaElementSource(audio);
        const an = this.ctx.createAnalyser();
        an.fftSize = 256;
        src.connect(an); an.connect(this.ctx.destination);
        const buf = new Uint8Array(an.frequencyBinCount);
        const tick = () => {
          if (audio.paused || audio.ended) return;
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (const b of buf) peak = Math.max(peak, Math.abs(b - 128));
          this.cb.onLevel && this.cb.onLevel(Math.min(1, peak / 50));
          requestAnimationFrame(tick);
        };
        audio.addEventListener("play", tick);
      } catch { /* ไม่มี WebAudio ก็ยังพูดได้ */ }
      await new Promise((resolve) => {
        audio.onended = audio.onerror = resolve;
        audio.play().catch(resolve);
        setTimeout(resolve, 60000);
      });
      URL.revokeObjectURL(url);
      return true;
    } catch {
      return false;
    }
  }

  async speakBrowser(text, lang, my) {
    if (!("speechSynthesis" in window)) {
      await new Promise((r) => setTimeout(r, Math.min(8000, 800 + text.length * 60)));
      return;
    }
    const voice = this.pickVoice(lang);
    for (const chunk of splitSentences(text)) {
      if (my !== this.token) return;
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.lang = lang === "en" ? "en-US" : "th-TH";
        if (voice) u.voice = voice;
        u.rate = this.rate;
        u.onboundary = () => { this.cb.onLevel && this.cb.onLevel(0.6 + Math.random() * 0.4); };
        const safety = setTimeout(resolve, 2500 + chunk.length * 160);   // กันกรณีเบราว์เซอร์ไม่ส่ง onend
        u.onend = u.onerror = () => { clearTimeout(safety); resolve(); };
        speechSynthesis.speak(u);
      });
    }
  }

  stop() {
    this.token++;
    if (this.audio) { try { this.audio.pause(); } catch { /* ignore */ } this.audio = null; }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    if (this.speaking) {
      this.speaking = false;
      this.cb.onLevel && this.cb.onLevel(0);
      this.cb.onEnd && this.cb.onEnd();
    }
  }
}
