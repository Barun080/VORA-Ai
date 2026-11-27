// VORA voice integration (Phase 4) — ทดสอบ Speaker/Listener ของ voice.js จริง ในสภาพแวดล้อมเบราว์เซอร์จำลอง
// ไม่มีเครือข่าย: fetch / Audio / AudioContext / speechSynthesis / SpeechRecognition เป็นตัวจำลองทั้งหมด
// รัน: node --test frontend/tests/voice/voice-integration.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const KIOSK = fileURLToPath(new URL("../../kiosk/", import.meta.url));
const read = (p) => readFileSync(join(KIOSK, p), "utf8");

// ------------------------------------------------------------------ fake browser
const log = { fetch: [], audio: [], synth: [], cancel: 0, sessions: new Map(), recs: [] };
const server = {
  stream: {},          // provider|"none" → ok | nostart | broken | hang
  chunk: {},           // provider|"none" → ok | none
  asset: "ok",
};
let sid = 0;

class FakeParam { constructor(v = 0) { this.value = v; } }
class FakeNode {
  constructor(kind) { this.kind = kind; this.out = []; this.disconnected = false; this.gain = new FakeParam(1); this.frequency = new FakeParam(350); this.Q = new FakeParam(1); this.type = ""; this.frequencyBinCount = 128; this.fftSize = 2048; }
  connect(n) { this.out.push(n); return n; }
  disconnect() { this.disconnected = true; this.out = []; }
  getByteTimeDomainData(buf) { buf.fill(160); }
}
class FakeAudioContext {
  constructor() { FakeAudioContext.made++; this.state = "running"; this.nodes = []; this.destination = new FakeNode("destination"); }
  resume() { return Promise.resolve(); }
  mk(kind) { const n = new FakeNode(kind); this.nodes.push(n); return n; }
  createAnalyser() { return this.mk("analyser"); }
  createBiquadFilter() { return this.mk("biquad"); }
  createGain() { return this.mk("gain"); }
  createMediaElementSource(el) { const n = this.mk("source"); n.el = el; return n; }
}
FakeAudioContext.made = 0;

class FakeAudio {
  constructor() { this.ls = {}; this.paused = true; this.ended = false; this.currentTime = 0; this.volume = 1; this.playbackRate = 1; this.preservesPitch = true; this.duration = NaN; this.src = ""; }
  addEventListener(e, f) { (this.ls[e] ||= []).push(f); }
  emit(e) { for (const f of this.ls[e] || []) f(); const h = this["on" + e]; if (h) h(); }
  removeAttribute() {} load() {} pause() { this.paused = true; }
  play() {
    log.audio.push(this);
    const how = behaviour(this.src);
    this.paused = false;
    setTimeout(() => {
      if (how === "ok") { this.emit("play"); this.emit("playing"); this.currentTime = 1.5; this.paused = true; this.ended = true; this.emit("ended"); }
      else if (how === "nostart") { this.emit("error"); }
      else if (how === "broken") { this.emit("play"); this.emit("playing"); this.currentTime = 1; this.emit("error"); }
      else if (how === "hang") { this.emit("play"); this.emit("playing"); }
    }, 1);
    return Promise.resolve();
  }
}
function behaviour(src) {
  if (src.startsWith("/api/tts/stream/")) { const s = log.sessions.get(src.split("/").pop()); return server.stream[s.provider || "none"] || "ok"; }
  if (src.startsWith("/assets/voices/")) return server.asset;
  return "ok";                                              // blob: (ประโยคจาก /api/tts)
}

const blobUrls = new Map();
globalThis.URL.createObjectURL = (b) => { const u = `blob:fake/${blobUrls.size}`; blobUrls.set(u, b); return u; };
globalThis.URL.revokeObjectURL = () => {};

function fakeFetch(url, opts = {}) {
  log.fetch.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
  if (url === "/api/tts/session") {
    const body = JSON.parse(opts.body);
    const id = `s${++sid}`;
    log.sessions.set(id, body);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ id, provider: body.provider || null }) });
  }
  if (url.startsWith("/api/tts?")) {
    const p = new URL(url, "http://x").searchParams.get("provider") || "none";
    const ok = (server.chunk[p] || "ok") === "ok";
    return Promise.resolve({ ok, status: ok ? 200 : 204, blob: async () => new Blob([ok ? "MP3" : ""]) });
  }
  if (url === "/api/tts/warm") return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  return Promise.reject(new Error("unexpected fetch " + url));
}

let voices = [];
class Utterance { constructor(text) { this.text = text; } }
const synth = {
  getVoices: () => voices,
  speak(u) { log.synth.push({ text: u.text, voice: u.voice ? u.voice.name : null, rate: u.rate }); setTimeout(() => { u.onstart && u.onstart(); u.onend && u.onend(); }, 1); },
  cancel() { log.cancel++; },
  onvoiceschanged: null,
};
class FakeSR {
  constructor() { log.recs.push(this); this.continuous = undefined; }
  start() { this.started = true; } stop() {} abort() {}
}

globalThis.window = globalThis;
globalThis.fetch = fakeFetch;
globalThis.Audio = FakeAudio;
globalThis.AudioContext = FakeAudioContext;
globalThis.speechSynthesis = synth;
globalThis.SpeechSynthesisUtterance = Utterance;
globalThis.SpeechRecognition = FakeSR;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 5);

const { Speaker, Listener, speechChunks } = await import("../../kiosk/voice.js");
const { parseVoiceCommand } = await import("../../kiosk/voice/commands.js");

function reset({ stream = {}, chunk = {}, asset = "ok", v = [] } = {}) {
  log.fetch = []; log.audio = []; log.synth = []; log.cancel = 0; log.sessions = new Map();
  server.stream = stream; server.chunk = chunk; server.asset = asset; voices = v;
}
const V = (name, lang = "th-TH") => ({ name, lang });
const FEMALE = [V("Microsoft Pattara - Thai"), V("Google ไทย"), V("Microsoft Premwadee Online (Natural) - Thai")];
function makeSpeaker(order, serverTTS = true) {
  const sp = new Speaker({ onLevel: () => {}, onAudio: () => {} });
  sp.serverTTS = serverTTS;
  sp.order = order;
  sp.voices = voices;
  return sp;
}
const providersRequested = () => log.fetch.flatMap((f) => {
  if (f.url === "/api/tts/session") return [f.body.provider || "none"];
  if (f.url.startsWith("/api/tts?")) return [new URL(f.url, "http://x").searchParams.get("provider") || "none"];
  return [];
});

// ------------------------------------------------------------------ provider lock
test("provider lock: whole response uses the locked provider (session carries provider)", async () => {
  reset();
  const sp = makeSpeaker(["google"]);
  await sp.speak("สวัสดีค่ะ ยินดีต้อนรับสู่ VORA ค่ะ วันนี้มีอะไรให้ช่วยไหมคะ", "th");
  assert.deepEqual(providersRequested(), ["google"]);
  assert.equal(sp.lastProvider, "google");
  assert.match(sp.lastPath, /^stream:google$/);
});

test("stream broken midway → rest of the same response stays on the same provider (never another server voice)", async () => {
  reset({ stream: { edge: "broken" }, chunk: { edge: "ok" }, v: FEMALE });
  const sp = makeSpeaker(["edge", "google"]);
  await sp.speak("ประโยคแรกยาวพอสมควรค่ะ ประโยคที่สองค่ะ ประโยคที่สามค่ะ ประโยคที่สี่ค่ะ", "th");
  const used = providersRequested();
  assert.ok(used.length >= 2 && used.every((p) => p === "edge"), used.join(","));
  assert.equal(sp.lastProvider, "edge");
});

test("edge fails mid-response and its sentences fail → remaining goes to browser female voice, NOT google", async () => {
  reset({ stream: { edge: "broken" }, chunk: { edge: "none" }, v: FEMALE });
  const sp = makeSpeaker(["edge", "google"]);
  await sp.speak("ประโยคหนึ่งค่ะ ประโยคสองค่ะ ประโยคสามค่ะ ประโยคสี่ค่ะ ประโยคห้าค่ะ", "th");
  assert.ok(!providersRequested().includes("google"));
  assert.ok(log.synth.length > 0 && log.synth.every((u) => u.voice === "Microsoft Premwadee Online (Natural) - Thai"));
  assert.equal(sp.lastProvider, "edge+browser");
});

test("primary gives no audio at all → fallback provider locked from the START of the response, no return to primary", async () => {
  reset({ stream: { edge: "nostart", google: "ok" }, chunk: { edge: "none" }, v: FEMALE });
  const sp = makeSpeaker(["edge", "google"]);
  await sp.speak("คำตอบทดสอบค่ะ มีสองประโยคค่ะ", "th");
  const used = providersRequested();
  const firstGoogle = used.indexOf("google");
  assert.ok(firstGoogle > 0, used.join(","));
  assert.ok(used.slice(firstGoogle).every((p) => p === "google"), used.join(","));   // ไม่วนกลับไป edge
  const googleSession = log.fetch.find((f) => f.url === "/api/tts/session" && f.body.provider === "google");
  assert.equal(googleSession.body.text, speechChunks("คำตอบทดสอบค่ะ มีสองประโยคค่ะ").join(" "));   // เริ่มทั้งคำตอบใหม่
  assert.equal(sp.lastProvider, "google");
  assert.equal(log.synth.length, 0);
});

test("old server config (no order) → no provider param sent (legacy behaviour)", async () => {
  reset({ stream: { none: "nostart" }, chunk: { none: "ok" } });
  const sp = makeSpeaker([]);
  await sp.speak("ทดสอบแบบเดิมค่ะ อีกประโยคค่ะ", "th");
  assert.ok(log.fetch.filter((f) => f.url.startsWith("/api/tts")).length >= 2);
  assert.ok(log.fetch.every((f) => !(f.body && "provider" in f.body) && !f.url.includes("provider=")));
});

test("no random switching: 10 responses in a row use one provider and one browser voice", async () => {
  reset({ v: FEMALE });
  const sp = makeSpeaker(["google"]);
  for (let i = 0; i < 10; i++) await sp.speak(`ข้อความที่ ${i} ค่ะ`, "th");
  assert.deepEqual([...new Set(providersRequested())], ["google"]);
  reset({ v: FEMALE });
  const b = makeSpeaker([], false);
  for (let i = 0; i < 5; i++) await b.speak(`ข้อความที่ ${i} ค่ะ`, "th");
  assert.deepEqual([...new Set(log.synth.map((u) => u.voice))], ["Microsoft Premwadee Online (Natural) - Thai"]);
});

// ------------------------------------------------------------------ precached MP3
test("precached MP3: exact text + matching provider → asset played, no server TTS call", async () => {
  reset();
  const sp = makeSpeaker(["google"]);
  await sp.speak("คะ โวร่าอยู่นี่ค่ะ พร้อมฟังคำถามแล้วค่ะ", "th");
  assert.equal(log.audio[0].src, "/assets/voices/vora_wake_2.mp3");
  assert.equal(log.fetch.length, 0);
  assert.equal(sp.lastProvider, "precached:google");
});

test("precached MP3 not used for non-matching text, other provider, or when the asset fails", async () => {
  reset();
  await makeSpeaker(["google"]).speak("สวัสดีค่ะ ยินดีต้อนรับสู่ VORA มีอะไรให้หนูช่วยค้นหาข้อมูลไหมคะ", "th");   // คำทักทายปัจจุบัน (ไม่ตรงไฟล์)
  assert.ok(log.audio.every((a) => !a.src.startsWith("/assets/voices/")));
  reset();
  await makeSpeaker(["edge"]).speak("คะ โวร่าอยู่นี่ค่ะ พร้อมฟังคำถามแล้วค่ะ", "th");                           // ไฟล์เป็นเสียง Google
  assert.ok(log.audio.every((a) => !a.src.startsWith("/assets/voices/")));
  reset({ asset: "nostart" });
  const sp = makeSpeaker(["google"]);
  await sp.speak("คะ โวร่าอยู่นี่ค่ะ พร้อมฟังคำถามแล้วค่ะ", "th");
  assert.deepEqual(providersRequested(), ["google"]);                                                   // ต่อด้วยผู้ให้บริการเดียวกัน
});

// ------------------------------------------------------------------ text normalization through Speaker
test("Speaker sends normalized text; time/date/phone/URL/decimal/percent preserved", async () => {
  reset();
  const sp = makeSpeaker(["google"]);
  await sp.speak("**เปิด** 08:00-16:30 น. วันที่ 12/11/2569 โทร 054-710-259 ค่าเทอม 3,500.50 บาท ลด 10% ดู https://www.technicnan.ac.th/apply?x=1 ค่ะ! 😊", "th");
  const text = log.fetch.find((f) => f.url === "/api/tts/session").body.text;
  for (const keep of ["08:00-16:30", "12/11/2569", "054-710-259", "3,500.50", "10%", "https://www.technicnan.ac.th/apply?x=1"]) assert.ok(text.includes(keep), keep);
  assert.ok(!/[*!😊]/u.test(text.replace("https://www.technicnan.ac.th/apply?x=1", "")), text);
});

test("emoji/markdown-only text → nothing spoken, no TTS call", async () => {
  reset();
  const sp = makeSpeaker(["google"]);
  await sp.speak("😊 ** ~ !!", "th");
  assert.equal(log.fetch.length, 0);
  assert.equal(sp.speaking, false);
});

test("prefetch uses the same normalized text as speaking (cache keys match)", async () => {
  reset();
  const sp = makeSpeaker(["google"]);
  sp.prefetch(["สไลด์ **ถัดไป** ค่ะ!"], "th");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(log.fetch.find((f) => f.url === "/api/tts/warm").body.text, speechChunks("สไลด์ **ถัดไป** ค่ะ!").join(" "));
});

// ------------------------------------------------------------------ audio pipeline
test("pipeline: source → analyser → EQ (lowshelf, peaking, highshelf, lowpass) → gain 0.9 → destination", async () => {
  reset();
  const sp = makeSpeaker(["google"]);
  await sp.speak("ทดสอบเสียงค่ะ", "th");
  const ctx = sp.ctx;
  const src = ctx.nodes.find((n) => n.kind === "source");
  assert.ok(src.disconnected, "source released after playback");
  const analyser = ctx.nodes.find((n) => n.kind === "analyser");
  const path = [];
  let node = analyser;
  while (node.out.length) { node = node.out[0]; path.push(node.kind === "biquad" ? node.type : node.kind); }
  assert.deepEqual(path, ["lowshelf", "peaking", "highshelf", "lowpass", "gain", "destination"]);
  assert.equal(sp.eq.gain.gain.value, 0.9);
});

test("no audio-graph leak: one AudioContext, one analyser, one EQ across many responses; every source released", async () => {
  reset();
  const before = FakeAudioContext.made;
  const sp = makeSpeaker(["google"]);
  for (let i = 0; i < 5; i++) await sp.speak(`ประโยคที่ ${i} ค่ะ`, "th");
  const ctx = sp.ctx;
  assert.equal(FakeAudioContext.made - before, 1);
  assert.equal(ctx.nodes.filter((n) => n.kind === "analyser").length, 1);
  assert.equal(ctx.nodes.filter((n) => n.kind === "biquad").length, 4);
  assert.equal(ctx.nodes.filter((n) => n.kind === "gain").length, 1);
  const sources = ctx.nodes.filter((n) => n.kind === "source");
  assert.equal(sources.length, 5);
  assert.ok(sources.every((s) => s.disconnected));
});

test("mouth level comes from the analyser (before EQ)", async () => {
  reset();
  const levels = [];
  const sp = new Speaker({ onLevel: (l) => levels.push(l), onAudio: () => {} });
  sp.serverTTS = true; sp.order = ["google"];
  await sp.speak("ขยับปากค่ะ", "th");
  assert.ok(levels.some((l) => l > 0.5), levels.join(","));          // ค่าจาก getByteTimeDomainData (160-128)/50 → 0.64
});

test("no pitch manipulation: preservesPitch stays true, playbackRate = speed setting (1.0), no detune", async () => {
  reset();
  const sp = makeSpeaker(["google"]);
  await sp.speak("ความเร็วปกติค่ะ", "th");
  assert.ok(log.audio.every((a) => a.preservesPitch === true && a.playbackRate === 1));
  const code = read("voice.js").replace(/\/\/.*$/gm, "");
  assert.ok(!/detune/.test(code));
  assert.ok(!/preservesPitch\s*=\s*false/.test(code));
  assert.equal(sp.profile.pitch, 0);
  assert.equal(sp.profile.speed, 1.0);
});

// ------------------------------------------------------------------ browser voice
test("browser fallback: deterministic female voice; male-only machine → silent, never male", async () => {
  reset({ v: [V("Microsoft Pattara - Thai"), V("Google ไทย")] });
  const sp = makeSpeaker([], false);
  await sp.speak("ทดสอบค่ะ", "th");
  await sp.speak("อีกครั้งค่ะ", "th");
  assert.deepEqual(log.synth.map((u) => u.voice), ["Google ไทย", "Google ไทย"]);
  reset({ v: [V("Microsoft Pattara - Thai"), V("Microsoft Niwat"), V("ภัทระ")] });
  const m = makeSpeaker([], false);
  await m.speak("ไม่มีเสียงผู้หญิงค่ะ", "th");
  assert.equal(log.synth.length, 0);
  assert.match(m.lastPath, /silent/);
});

// ------------------------------------------------------------------ stop / "หยุดพูด"
test("stop(): halts playing audio and browser speech, resets state, next speak works", async () => {
  reset({ stream: { google: "hang" } });
  let ended = 0;
  const sp = new Speaker({ onLevel: () => {}, onAudio: () => {}, onEnd: () => ended++ });
  sp.serverTTS = true; sp.order = ["google"];
  const p = sp.speak("พูดยาว ๆ ค่ะ", "th");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sp.speaking, true);
  sp.stop();
  await p;
  assert.equal(sp.speaking, false);
  assert.ok(log.cancel >= 1 && ended >= 1);
  assert.equal(sp.audio, null);
  server.stream = { google: "ok" };
  await sp.speak("พูดต่อได้ค่ะ", "th");
  assert.equal(sp.lastProvider, "google");
});

test('voice command: only "หยุดพูด" (with polite endings) → STOP_SPEAKING', () => {
  for (const t of ["หยุดพูด", "หยุดพูดค่ะ", "หยุด พูด ครับ", "หยุดพูดนะคะ", "หยุดพูดก่อน", " หยุดพูด! "]) assert.equal(parseVoiceCommand(t), "STOP_SPEAKING", t);
  for (const t of ["ทำไมหยุดพูด", "หยุดพูดเรื่องอะไร", "หยุด", "เงียบ", "stop", "เปิดแชท", "โหมดมืด", "", null]) assert.equal(parseVoiceCommand(t), null, String(t));
});

test('app.js: "หยุดพูด" is handled before ask() and does not stop the robot', () => {
  const app = read("app.js");
  assert.match(app, /onFinal: \(txt\) => \{[^\n]*parseVoiceCommand\(txt\) === "STOP_SPEAKING"\) \{ stopSpeaking\(\); return; \} ask\(txt, "voice"\);/);
  const fn = app.slice(app.indexOf("function stopSpeaking()"), app.indexOf("// ====", app.indexOf("function stopSpeaking()")));
  assert.ok(fn.includes("speaker.stop()") && !fn.includes("/api/robot"));
});

// ------------------------------------------------------------------ wake word OFF / Listener compatibility
function kioskJs(dir = KIOSK, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!["classic", "pastel"].includes(f)) kioskJs(p, out); }
    else if (f.endsWith(".js")) out.push(p);
  }
  return out;
}

test("wake word OFF: no always-on recognition anywhere in the kiosk; only voice.js creates SpeechRecognition", () => {
  const files = kioskJs();
  const owners = files.filter((p) => /new SR\(|new (webkit)?SpeechRecognition\(/.test(readFileSync(p, "utf8")));
  assert.deepEqual(owners.map((p) => p.slice(KIOSK.length)), ["voice.js"]);
  for (const p of files) assert.ok(!/continuous\s*=\s*true/.test(readFileSync(p, "utf8")), p);
  assert.ok(!files.some((p) => p.endsWith("wake.js")));
});

test("Listener unchanged: one recognizer per start, continuous=false, interim results on", () => {
  log.recs = [];
  const l = new Listener({});
  assert.equal(l.supported, true);
  assert.equal(l.start("th"), true);
  assert.equal(log.recs.length, 1);
  assert.equal(log.recs[0].continuous, false);
  assert.equal(log.recs[0].interimResults, true);
  assert.equal(log.recs[0].lang, "th-TH");
  l.stop(true);
});

test("Speaker public API kept", () => {
  const sp = new Speaker({});
  for (const m of ["speak", "stop", "prefetch", "prefetchChunks", "pickVoice", "playSrc", "playBlob", "speakServer", "speakStream", "speakBrowser", "fetchChunk", "attachAnalyser"]) assert.equal(typeof sp[m], "function", m);
  assert.equal(sp.serverTTS, false);
  assert.equal(sp.rate, 1);
  assert.equal(sp.speaking, false);
});

test("no random voice selection in voice.js (Math.random only drives browser mouth level)", () => {
  const lines = read("voice.js").split("\n").filter((l) => l.includes("Math.random"));
  assert.ok(lines.every((l) => l.includes("onLevel")), lines.join("\n"));
});
