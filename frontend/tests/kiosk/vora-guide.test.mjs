// VORA Guide (17 พ.ย. 2569) — unit tests แบบออฟไลน์ (ไม่ต้องมีเซิร์ฟเวอร์/เบราว์เซอร์)
// รัน: node --test frontend/tests/kiosk/vora-guide.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseVoiceCommand, parseGuideCommand } from "../../kiosk/voice/commands.js";
import { GUIDE_STEPS, GUIDE_UI, GUIDE_TIMEOUT_MS, GUIDE_ALWAYS_ALLOW } from "../../kiosk/guide/guide-steps.js";

const KIOSK = join(dirname(fileURLToPath(import.meta.url)), "../../kiosk");
const read = (p) => readFileSync(join(KIOSK, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ------------------------------------------------------------------ คำสั่งเสียง
test("parseGuideCommand: approved phrases only (+ polite endings)", () => {
  const ok = {
    GUIDE_START: ["แนะนำการใช้งาน", "แนะนำวิธีใช้งาน", "สอนการใช้งาน", "เริ่มแนะนำการใช้งาน", "แนะนำการใช้งานค่ะ", "สอน การใช้งาน ครับ", "แนะนำวิธีใช้งานนะคะ",
      "แนะนำการใช้งานหน่อย", "แนะนำการใช้งานหน่อยค่ะ", "ช่วยแนะนำการใช้งานหน่อย", "สอนวิธีใช้ให้หน่อย", "วิธีใช้งาน", "ใช้งานยังไง", "ใช้ยังไงคะ", "ขอแนะนำการใช้งานด้วยครับ"],
    GUIDE_NEXT: ["ถัดไป", "ถัดไปค่ะ", "ถัด ไป ครับ", "ถัดไป!"],
    GUIDE_BACK: ["ย้อนกลับ", "ย้อนกลับนะคะ"],
    GUIDE_CLOSE: ["หยุดแนะนำ", "ปิด", "ปิดครับ", "หยุดแนะนำค่ะ"],
  };
  for (const [cmd, list] of Object.entries(ok)) for (const t of list) assert.equal(parseGuideCommand(t), cmd, t);
  for (const t of ["อันนี้คืออะไร", "ปิดไฟ", "ถัดไปเลย", "แนะนำสาขา", "next", "close", "หยุดพูด", "ทำไมต้องถัดไป", "", null, undefined,
    "แนะนำวิทยาลัยหน่อย", "เครื่องนี้ใช้ทำอะไร", "ใช้งานได้ไหม", "สมัครเรียนยังไง", "แนะนำการใช้งานโปรแกรมบัญชี"])
    assert.equal(parseGuideCommand(t), null, String(t));
});

test("parseVoiceCommand unchanged: still only หยุดพูด; guide phrases are not STOP_SPEAKING", () => {
  assert.equal(parseVoiceCommand("หยุดพูดค่ะ"), "STOP_SPEAKING");
  for (const t of ["แนะนำการใช้งาน", "ถัดไป", "ย้อนกลับ", "หยุดแนะนำ", "ปิด"]) assert.equal(parseVoiceCommand(t), null, t);
  const src = read("voice/commands.js");
  assert.ok(src.includes('const STOP = /^หยุดพูด(?:ก่อน)?(?:นะ)?(?:คะ|ค่ะ|ครับ|จ้ะ|จ้า|จ๊ะ)?$/;'));
  assert.ok(src.includes('  if (STOP.test(t)) return "STOP_SPEAKING";\n  return null;\n}'));
});

// ------------------------------------------------------------------ ขั้นตอนและข้อความ (อนุมัติแล้ว)
test("steps: approved order, targets and complete TH/EN text", () => {
  assert.deepEqual(GUIDE_STEPS.map((s) => s.id), ["avatar", "mic", "chat", "nav", "qr", "camera", "status", "lang", "settings", "fullscreen"]);
  assert.deepEqual(GUIDE_STEPS.find((s) => s.id === "camera").targets, [["#camBtn"], ["#camPill"]]);
  assert.deepEqual(GUIDE_STEPS.find((s) => s.id === "nav").targets, [["#homeBtn", "#railMenu > *"]]);   // #railMenu = display:contents
  assert.deepEqual(GUIDE_STEPS.find((s) => s.id === "avatar").targets, [["#avatar canvas || #avatar img || #avatar"]]);
  for (const s of GUIDE_STEPS) for (const l of ["th", "en"]) assert.ok(s[l].title && s[l].body, `${s.id}.${l}`);
  assert.equal(GUIDE_STEPS[0].th.body, "สวัสดีค่ะ หนูคือ VORA ผู้ช่วย AI ของวิทยาลัย ถามเรื่องสาขาวิชา การสมัครเรียน ข่าว และกิจกรรมได้เลยค่ะ");
  assert.equal(GUIDE_UI.th.counter(3, 10), "ขั้นที่ 3 จาก 10");
  assert.equal(GUIDE_UI.en.counter(3, 10), "Step 3 of 10");
  assert.equal(GUIDE_UI.en.voiceHint, "");          // โหมด English = ปุ่มอย่างเดียว
  assert.equal(GUIDE_TIMEOUT_MS, 60000);
  assert.deepEqual([...GUIDE_ALWAYS_ALLOW], ["#stopBtn"]);
});

test("every step target exists in index.html", () => {
  const html = read("index.html");
  for (const s of GUIDE_STEPS) for (const g of s.targets) for (const sel of g) {
    const base = sel.split("||").pop().trim();   // ตัวสำรองสุดท้ายต้องมีอยู่ในหน้า
    const m = base.replace(/\s*>\s*\*$/, "").match(/#([\w-]+)$/) || base.match(/\.([\w-]+)$/);
    assert.ok(m && (html.includes(`id="${m[1]}"`) || html.includes(`class="${m[1]}"`)), sel);
  }
});

// ------------------------------------------------------------------ การแยกตัวจากระบบเดิม
test("guide module: no TTS/STT/theme/storage/robot of its own", () => {
  for (const f of readdirSync(join(KIOSK, "guide")).filter((f) => f.endsWith(".js"))) {
    const s = strip(read(`guide/${f}`));
    for (const bad of [/SpeechRecognition/, /speechSynthesis/, /localStorage/, /sessionStorage/, /\/api\//, /data-vora-theme/, /applyTheme/, /fetch\(/, /new Audio/, /listener\.start/])
      assert.ok(!bad.test(s), `${f}: ${bad}`);
  }
});

test("guide.css: only vg- classes and no new theme tokens", () => {
  const css = strip(read("guide/guide.css"));
  const classes = [...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]).filter((c) => !/^\d/.test(c));
  assert.ok(classes.length && classes.every((c) => c.startsWith("vg-")), classes.filter((c) => !c.startsWith("vg-")).join(","));
  assert.ok(!/--[\w-]+\s*:/.test(css), "must not declare CSS variables");
  assert.ok(/prefers-reduced-motion:\s*reduce/.test(css));
  assert.ok(!/\.vora-/.test(read("guide/guide.css")));
});

test("index.html: ✦ button between language and settings, css linked after kiosk-reference.css", () => {
  const html = read("index.html");
  const iLang = html.indexOf('<div class="lang"'), iBtn = html.indexOf('id="vgBtn"'), iTools = html.indexOf('id="toolsBtn"');
  assert.ok(iLang > 0 && iLang < iBtn && iBtn < iTools);
  assert.match(html, /<button type="button" class="hdr-ico vg-launch" id="vgBtn" aria-label="VORA Guide" title="VORA Guide"><span class="vg-launch-ico" aria-hidden="true">✦<\/span><\/button>/);
  assert.ok(html.indexOf('href="kiosk-reference.css"') < html.indexOf('href="guide/guide.css"'));
});

test("app.js: guide hooks are minimal and keep existing contracts", () => {
  const app = read("app.js");
  // คำสั่งเสียงเดิม (สัญญาของ voice-integration.test.mjs) ยังอยู่ครบ · Guide ตรวจก่อน
  assert.match(app, /onFinal: \(txt\) => \{ S\.partial = ""; setVoice\(""\); if \(onGuideVoice\(txt\)\) return; if \(parseVoiceCommand\(txt\) === "STOP_SPEAKING"\) \{ stopSpeaking\(\); return; \} ask\(txt, "voice"\);/);
  assert.match(app, /if \(!text\) return;\n  if \(!internal && guide && guide\.active\) guide\.end\("question"\);/);
  // 25 พ.ย. 2569: พิมพ์คำสั่งเริ่ม Guide ได้เหมือนพูด (ไม่ส่งเข้า AI)
  assert.match(app, /if \(!internal && guide && guide\.available && parseGuideCommand\(text\) === "GUIDE_START"\) \{ guide\.start\("text"\); return; \}/);
  const fn = app.slice(app.indexOf("function onGuideVoice("), app.indexOf("// ====", app.indexOf("function onGuideVoice(")));
  assert.ok(!fn.includes("/api/robot") && !fn.includes("listener.start") && !fn.includes("startListening"));
  const wiring = app.slice(app.indexOf("guide = new VoraGuide("), app.indexOf('$("vgBtn").onclick'));
  assert.ok(wiring.includes("respond({ text, lang, answered: true }, { record: false, user: true })"));
  assert.ok(!wiring.includes("/api/robot") && !wiring.includes("stopAll"));
  // ไม่เปลี่ยน Esc เดิม: keydown ของ document ยังเรียก stopAll() เหมือนเดิม
  assert.ok(app.includes('    if (e.key === "Escape") stopAll();\n'));
});

// ------------------------------------------------------------------ ตรรกะของ VoraGuide (ไม่มี DOM จริง: ตัด DOM ออก)
function fakeBus() {
  const map = new Map();
  return { on: (t, f) => { (map.get(t) || map.set(t, []).get(t)).push(f); return () => {}; }, emit: (t, d) => (map.get(t) || []).forEach((f) => f(d)), map };
}
const EV = { EXPERIENCE_MODE: "experience:mode", UI_LANG: "ui:lang", UI_ACTIVITY: "ui:activity", AVATAR_HINT: "avatar:hint" };

async function makeGuide({ presenting = false } = {}) {
  globalThis.document = globalThis.document || { activeElement: null };
  globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((f) => setTimeout(f, 0));
  globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || ((id) => clearTimeout(id));
  const { VoraGuide } = await import("../../kiosk/guide/VoraGuide.js");
  const bus = fakeBus();
  const log = { speak: [], stops: 0, emitted: [], cleared: [], started: 0, alive: 0 };
  const origEmit = bus.emit;
  bus.emit = (t, d) => { log.emitted.push([t, d]); origEmit(t, d); };
  let resolveSpeak = null;
  const env = { lang: "th", presenting, t: 1000 };
  const button = { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, focus() {} };
  const g = new VoraGuide({
    bus, EV, button, getLang: () => env.lang, now: () => env.t,
    speak: (text, lang) => { log.speak.push([text, lang]); return new Promise((r) => { resolveSpeak = r; }); },
    stopSpeech: () => { log.stops++; resolveSpeak && resolveSpeak(); },
    clearCaption: (t) => log.cleared.push(t), isPresenting: () => env.presenting,
    onStart: () => log.started++, keepAlive: () => log.alive++,
  });
  // ตัดส่วน DOM ออก (ทดสอบในเบราว์เซอร์จริงด้วย Playwright)
  g.build = function () { this.panel = { open: false, show() { this.open = true; }, close() { this.open = false; } }; this.layer = {}; this.btnNext = { focus() {} }; };
  g.attach = g.detach = g.render = g.layout = () => {};
  const done = () => { resolveSpeak && resolveSpeak(); return new Promise((r) => setTimeout(r, 0)); };
  return { g, bus, log, env, button, done };
}

test("start → speaks step 1 (TH) via deps.speak · no auto-advance after speech ends", async () => {
  const { g, log, done } = await makeGuide();
  assert.equal(g.start("button"), true);
  assert.equal(log.started, 1);
  assert.deepEqual(log.speak[0], [GUIDE_STEPS[0].th.body, "th"]);
  assert.ok(log.emitted.some(([t, d]) => t === EV.AVATAR_HINT && d.state === "pointing"));
  await done();
  assert.equal(g.index, 0);
  assert.equal(g.speaking, false);
  g.end("close");
});

test("next / back / finish / voice commands", async () => {
  const { g, log, done } = await makeGuide();
  g.start();
  g.back(); assert.equal(g.index, 0);
  assert.equal(g.command("GUIDE_NEXT"), true); assert.equal(g.index, 1);
  assert.equal(g.command("GUIDE_BACK"), true); assert.equal(g.index, 0);
  assert.equal(g.command("GUIDE_START"), true); assert.equal(g.index, 0);   // เปิดอยู่แล้ว = ไม่ทำอะไร
  assert.equal(log.speak.length, 3);
  for (let i = 0; i < 9; i++) g.next();
  assert.equal(g.index, 9);
  await done();
  g.next();
  assert.equal(g.active, false); assert.equal(g.lastEnd, "finish");
  assert.equal(g.command("GUIDE_NEXT"), false);   // ปิดแล้ว → ไม่ใช่คำสั่งของ Guide
});

test("end while speaking stops only guide speech and clears its caption", async () => {
  const { g, log } = await makeGuide();
  g.start();
  assert.equal(g.command("GUIDE_CLOSE"), true);
  assert.equal(log.stops, 1);
  assert.equal(g.lastEnd, "voice");
  assert.ok(log.cleared.includes(GUIDE_STEPS[0].th.body) && log.cleared.includes(GUIDE_STEPS[0].en.body));
});

test("end when not speaking does not call stopSpeech", async () => {
  const { g, log, done } = await makeGuide();
  g.start(); await done();
  g.end("close");
  assert.equal(log.stops, 0);
});

test("timeout: 60 s without interaction (not counted while speaking) → end", async () => {
  const { g, log, env, done } = await makeGuide();
  g.start();
  env.t += 120000; g.tick();                 // ยังพูดอยู่ → ไม่ timeout
  assert.equal(g.active, true);
  await done();
  env.t += 59000; g.tick(); assert.equal(g.active, true);
  env.t += 1000; g.tick(); assert.equal(g.active, false);
  assert.equal(g.lastEnd, "timeout");
  assert.ok(log.alive >= 2);
});

test("presentation: button disabled, start refused, open guide ends", async () => {
  const { g, bus, env, button } = await makeGuide();
  g.start();
  env.presenting = true;
  bus.emit(EV.EXPERIENCE_MODE, { mode: "presentation" });
  assert.equal(g.active, false); assert.equal(g.lastEnd, "presentation");
  assert.equal(button.disabled, true); assert.equal(button.attrs["aria-disabled"], "true");
  assert.equal(g.start(), false);
  env.presenting = false;
  bus.emit(EV.EXPERIENCE_MODE, { mode: "active" });
  assert.equal(button.disabled, false);
  assert.equal(g.start(), true);
  g.end();
});

test("language switch: re-speaks current step in new language only while speaking", async () => {
  const { g, bus, env, log, done } = await makeGuide();
  g.start(); g.next();
  env.lang = "en";
  bus.emit(EV.UI_LANG, { lang: "en" });
  assert.deepEqual(log.speak.at(-1), [GUIDE_STEPS[1].en.body, "en"]);
  await done();
  const n = log.speak.length;
  env.lang = "th"; bus.emit(EV.UI_LANG, { lang: "th" });
  assert.equal(log.speak.length, n);           // ไม่ได้พูดอยู่ → เปลี่ยนแค่ข้อความ
  assert.equal(g.index, 1);
  g.end();
});

test("placePanel: avoids the spotlight, reports overlap when there is no room", async () => {
  const { placePanel } = await import("../../kiosk/guide/VoraGuide.js");
  const hole = { left: 600, top: 100, right: 700, bottom: 150, width: 100, height: 50 };
  const p = placePanel(hole, [hole], 400, 200, 1366, 768);
  assert.equal(p.side, "below"); assert.equal(p.overlap, false);
  const big = { left: 0, top: 0, right: 1366, bottom: 768, width: 1366, height: 768 };
  assert.equal(placePanel(big, [big], 400, 200, 1366, 768).overlap, true);
});
