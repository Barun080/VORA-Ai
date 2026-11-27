// VORA voice core (Phase 3) — unit tests แบบออฟไลน์ ไม่ใช้เบราว์เซอร์/เครือข่าย/TTS จริง
// รัน: node --test frontend/tests/voice/voice-core.test.mjs   (Node 18+ · ไม่ต้องติดตั้งแพ็กเกจเพิ่ม)
// อยู่นอก frontend/kiosk จึงไม่ถูกเสิร์ฟเป็นหน้าเว็บ
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeForSpeech as n, lookupKey } from "../../kiosk/voice/speech-text.js";
import { profileFor, PROFILES, FALLBACK_ORDER, pickFemaleVoice, MALE_VOICE, findPrecached, PRECACHED } from "../../kiosk/voice/profile.js";
import { EQ_BANDS, eqParams, VoiceEq, sharedVoiceEq } from "../../kiosk/voice/eq.js";

const src = (p) => readFileSync(fileURLToPath(new URL(`../../kiosk/voice/${p}`, import.meta.url)), "utf8");

// ------------------------------------------------------------ text normalization: เวลา / วันที่ / ตัวเลข / URL / เบอร์โทร
test("time range 08:00-16:30 is preserved", () => {
  assert.equal(n("เปิดทำการ 08:00-16:30 น. ค่ะ"), "เปิดทำการ 08:00-16:30 น. ค่ะ");
  assert.match(n("เวลา 8.30–16.30 น.!"), /8\.30–16\.30/);
  assert.match(n("ช่วง 8~10 โมง~"), /8~10 โมง$/);
});

test("dates 12/11/2569 and 2026-11-12 are preserved", () => {
  assert.equal(n("วันที่ 12/11/2569 ค่ะ!"), "วันที่ 12/11/2569 ค่ะ");
  assert.match(n("deadline 2026-11-12?"), /2026-11-12$/);
});

test("numbers: phone, decimals, thousands, percent, signs", () => {
  const out = n("โทร 054-710-259 หรือ 0 5471 0259 ค่าเทอม 3,500.50 บาท ลด 10% อุณหภูมิ -5 ถึง +3 องศา version 2.5");
  for (const keep of ["054-710-259", "0 5471 0259", "3,500.50", "10%", "-5", "+3", "2.5"]) assert.ok(out.includes(keep), keep);
});

test("URL and email are preserved exactly", () => {
  const out = n("ดูที่ https://www.technicnan.ac.th/apply?x=1&y=2 หรือ www.technicnan.ac.th และ info@technicnan.ac.th นะคะ!");
  assert.ok(out.includes("https://www.technicnan.ac.th/apply?x=1&y=2"));
  assert.ok(out.includes("www.technicnan.ac.th"));
  assert.ok(out.includes("info@technicnan.ac.th"));
  assert.ok(!/[!]/.test(out.replace("https://www.technicnan.ac.th/apply?x=1&y=2", "")));
});

test("meaningful marks kept: parentheses content, e-mail, COVID-19, snake_case, Thai ๆ ฯ", () => {
  const out = n("(ปวช.) e-mail COVID-19 snake_case ไปๆ มาๆ กรุงเทพฯ");
  assert.equal(out, "(ปวช.) e-mail COVID-19 snake_case ไปๆ มาๆ กรุงเทพฯ");
});

test("markdown / emoji / ? ! ~ … removed without losing words", () => {
  assert.equal(n("## หลักสูตร\n- ปวช. 3 ปี\n- **ปวส.** 2 ปี 😊"), "หลักสูตร ปวช. 3 ปี ปวส. 2 ปี");
  assert.equal(n("เอ๊~ มีอะไรรึเปล่าคะ?..."), "เอ๊ มีอะไรรึเปล่าคะ");
  assert.equal(n("[สมัครเรียน](https://x.y/z) `code`\n> คำพูด"), "สมัครเรียน code คำพูด");   // > ต้นบรรทัด = blockquote
  assert.equal(n("เกรดเฉลี่ย > 2.00 ขึ้นไป"), "เกรดเฉลี่ย > 2.00 ขึ้นไป");                       // > กลางประโยคมีความหมาย: คงไว้
  assert.equal(n("```\nprint(1)\n```ต่อ"), "ต่อ");
  assert.equal(n(null), "");
  assert.equal(n("   "), "");
});

test("normalization is idempotent", () => {
  for (const t of ["เปิด 08:00-16:30 น. วันที่ 12/11/2569 โทร 054-710-259 ค่ะ!", "**A** ~ B? 😊", "https://a.b/c?d=1!"]) {
    assert.equal(n(n(t)), n(t));
  }
});

// ------------------------------------------------------------ 16 พ.ย. 2569: ชื่อ VORA → พูดว่า "โวร่า" (เฉพาะเสียงพูด ประโยคไทย)
test('name "VORA" is spoken as โวร่า in Thai sentences', () => {
  assert.equal(n("สวัสดีค่ะ 😊 ลองถาม VORA ได้เลยนะคะ"), "สวัสดีค่ะ ลองถาม โวร่า ได้เลยนะคะ");
  assert.equal(n("VORA พร้อมช่วยแล้วนะคะ"), "โวร่า พร้อมช่วยแล้วนะคะ");
  assert.equal(n("หนูชื่อ Vora ค่ะ และ vora ยินดีช่วย (VORA)"), "หนูชื่อ โวร่า ค่ะ และ โวร่า ยินดีช่วย (โวร่า)");
  assert.equal(n("**VORA** คือหุ่นยนต์ประชาสัมพันธ์"), "โวร่า คือหุ่นยนต์ประชาสัมพันธ์");
});

test("VORA replacement leaves English sentences, URLs, e-mail and longer identifiers alone", () => {
  assert.equal(n("Hello! I'm VORA, the college's PR robot."), "Hello I'm VORA, the college's PR robot.");
  const t = n("ดูเว็บ https://vora.example.com/VORA หรืออีเมล vora@example.com ค่ะ");
  assert.ok(t.includes("https://vora.example.com/VORA") && t.includes("vora@example.com") && !t.includes("โวร่า"), t);
  assert.equal(n("ตั้งค่า VORA_TTS_RATE และรุ่น VORA2 กับ myVORA ค่ะ"), "ตั้งค่า VORA_TTS_RATE และรุ่น VORA2 กับ myVORA ค่ะ");
  assert.equal(n("โวร่า พร้อมช่วยค่ะ"), "โวร่า พร้อมช่วยค่ะ");
});

test("VORA replacement is idempotent and keeps lookup keys consistent on both sides", () => {
  const t = "สวัสดีค่ะ ✨ VORA พร้อมพาไปรู้จักสาขาวิชาค่ะ อยากเริ่มจากเรื่องไหนดีคะ?";
  assert.equal(n(n(t)), n(t));
  assert.ok(!/VORA/i.test(n(t)));
  assert.equal(lookupKey("ถาม VORA ได้เลยค่ะ!"), lookupKey("ถาม vora ได้เลยค่ะ"));
});

// ------------------------------------------------------------ voice profile / character → voice
test("profile: VORA is EQ-only, speed 1.0, pitch 0", () => {
  const p = profileFor("vora");
  assert.equal(p.character_id, "vora");
  assert.equal(p.voice_id, "vora_female_th");
  assert.equal(p.language, "th");
  assert.equal(p.speed, 1.0);
  assert.equal(p.pitch, 0);
  assert.equal(p.preset, "eq_only");
  for (const k of ["character_id", "voice_id", "language", "speaking_style", "speed", "pitch", "volume", "preset"]) assert.ok(k in p, k);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.eq));
});

test("character → voice is deterministic; unknown character → VORA (no random)", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(profileFor(i % 2 ? "vora" : "VORA ").voice_id);
  assert.deepEqual([...seen], ["vora_female_th"]);
  assert.equal(profileFor("unknown"), PROFILES.vora);
  assert.equal(profileFor(undefined), PROFILES.vora);
});

test("no random / no pitch-by-playbackRate in voice core sources", () => {
  for (const f of ["profile.js", "eq.js", "speech-text.js"]) {
    const code = src(f).replace(/\/\/.*$/gm, "");
    assert.ok(!/Math\.random/.test(code), `${f}: Math.random`);
    assert.ok(!/playbackRate\s*(\.value)?\s*=/.test(code), `${f}: playbackRate assignment`);
    assert.ok(!/detune\s*(\.value)?\s*=/.test(code), `${f}: detune assignment`);
  }
});

// ------------------------------------------------------------ fallback policy / browser voice
test("fallback order is fixed", () => {
  assert.deepEqual([...FALLBACK_ORDER], ["precached", "server-cache", "server-primary", "server-secondary", "browser-female", "silent"]);
  assert.ok(Object.isFrozen(FALLBACK_ORDER));
});

test("browser voice: female only, stable priority, never male", () => {
  const V = (name, lang = "th-TH") => ({ name, lang });
  const winChrome = [V("Microsoft Pattara - Thai (Thailand)"), V("Google ไทย")];
  assert.equal(pickFemaleVoice(winChrome, "th").name, "Google ไทย");
  const edge = [V("Microsoft Niwat Online (Natural) - Thai"), V("Google ไทย"), V("Microsoft Premwadee Online (Natural) - Thai (Thailand)")];
  assert.equal(pickFemaleVoice(edge, "th").name, "Microsoft Premwadee Online (Natural) - Thai (Thailand)");
  assert.equal(pickFemaleVoice([V("Kanya"), V("Narisa")], "th").name, "Kanya");
  assert.equal(pickFemaleVoice([V("Microsoft Pattara"), V("ภัทระ"), V("นิวัฒน์"), V("Thai Male")], "th"), null);
  assert.equal(pickFemaleVoice([], "th"), null);
  for (const m of ["Pattara", "Niwat", "David", "Mark", "Male", "ภัทระ", "นิวัฒน์"]) assert.ok(MALE_VOICE.test(m), m);
  for (const f of ["Premwadee", "Kanya", "Narisa", "Achara", "Google ไทย", "Microsoft Zira"]) assert.ok(!MALE_VOICE.test(f), f);
  assert.equal(pickFemaleVoice([V("Google US English", "en-US"), V("Microsoft David", "en-US")], "en").name, "Google US English");
});

// ------------------------------------------------------------ precached cache lookup
test("precached lookup finds all 10 phrases (with or without ? ! ~)", () => {
  const texts = Object.keys(PRECACHED);
  assert.equal(texts.length, 10);
  for (const t of texts) {
    assert.equal(findPrecached(t), PRECACHED[t]);
    assert.equal(findPrecached(t.replace(/[?!~]/g, "") + "  "), PRECACHED[t]);
  }
  assert.equal(findPrecached("มีอะไรให้ช่วยมั้ยคะ"), "/assets/voices/vora_click_1.mp3");
});

test("precached lookup: other text / other provider / English → null", () => {
  assert.equal(findPrecached("สวัสดีค่ะ ยินดีต้อนรับสู่ VORA มีอะไรให้หนูช่วยค้นหาข้อมูลไหมคะ"), null);   // คำทักทายปัจจุบันของ VORA
  assert.equal(findPrecached("มีอะไรให้ช่วยมั้ยคะ?", { provider: "edge" }), null);                     // ห้ามผสมเสียง Google ในโหมด Microsoft
  assert.equal(findPrecached("มีอะไรให้ช่วยมั้ยคะ?", { lang: "en" }), null);
  assert.equal(lookupKey("A  b?"), lookupKey("a b"));
});

test("every precached URL points to an existing asset file", () => {
  for (const url of Object.values(PRECACHED)) {
    const p = fileURLToPath(new URL(`../../${url.replace(/^\//, "")}`, import.meta.url));
    assert.ok(readFileSync(p).length > 1000, url);
  }
});

// ------------------------------------------------------------ EQ configuration (fake Web Audio)
class FakeParam { constructor(v = 0) { this.value = v; } }
class FakeNode {
  constructor(kind) { this.kind = kind; this.out = []; this.gain = new FakeParam(1); this.frequency = new FakeParam(350); this.Q = new FakeParam(1); this.type = ""; }
  connect(n) { this.out.push(n); return n; }
}
class FakeCtx {
  constructor() { this.made = []; }
  createBiquadFilter() { const n = new FakeNode("biquad"); this.made.push(n); return n; }
  createGain() { const n = new FakeNode("gain"); this.made.push(n); return n; }
}

test("EQ bands match the specified chain", () => {
  assert.deepEqual(EQ_BANDS.bass, { type: "lowshelf", frequency: 260 });
  assert.deepEqual(EQ_BANDS.clarity, { type: "peaking", frequency: 2400, Q: 1.1 });
  assert.deepEqual(EQ_BANDS.treble, { type: "highshelf", frequency: 5500 });
  assert.deepEqual(EQ_BANDS.smooth, { type: "lowpass", frequency: 11200 });
});

test("EQ chain (Phase 4 order): source → analyser → bass → clarity → treble → lowpass → gain → destination", () => {
  const ctx = new FakeCtx();
  const destination = new FakeNode("destination");
  const analyser = new FakeNode("analyser");
  const eq = new VoiceEq(ctx, destination, eqParams(profileFor("vora")));
  analyser.connect(eq.input);                       // เหมือน voice.js attachAnalyser
  const src = new FakeNode("mediaElementSource");
  src.connect(analyser);
  const path = [];
  let node = src;
  while (node.out.length) { node = node.out[0]; path.push(node.kind === "biquad" ? node.type : node.kind); }
  assert.deepEqual(path, ["analyser", "lowshelf", "peaking", "highshelf", "lowpass", "gain", "destination"]);
  assert.equal(eq.bass.gain.value, 2.0);
  assert.equal(eq.clarity.gain.value, 1.5);
  assert.equal(eq.clarity.Q.value, 1.1);
  assert.equal(eq.treble.gain.value, 1.0);
  assert.equal(eq.smooth.frequency.value, 11200);
  assert.equal(eq.gain.gain.value, 0.9);
  assert.equal(ctx.made.length, 5);                // 4 filters + 1 gain เท่านั้น ไม่มี node อื่น
});

test("EQ live update and safe clamping", () => {
  const eq = new VoiceEq(new FakeCtx(), new FakeNode("analyser"), {});
  eq.update({ bassDb: 6, volume: 0.5 });
  assert.equal(eq.bass.gain.value, 6);
  assert.equal(eq.gain.gain.value, 0.5);
  const p = eqParams({ volume: 9, eq: { bassDb: 99, clarityDb: "x", trebleDb: -99, lowpassHz: 1 } });
  assert.deepEqual(p, { bassDb: 12, clarityDb: 0, trebleDb: -12, lowpassHz: 4000, volume: 1 });
});

test("one shared EQ per destination (no duplicate pipelines)", () => {
  const ctx = new FakeCtx();
  const destination = new FakeNode("destination");
  const a = sharedVoiceEq(ctx, destination, eqParams(profileFor("vora")));
  const b = sharedVoiceEq(ctx, destination, eqParams(profileFor("vora")));
  assert.equal(a, b);
  assert.equal(ctx.made.length, 5);
  assert.equal(a.gain.out.length, 1);              // gain → ปลายทางเส้นเดียว ไม่ต่อซ้ำ
});
