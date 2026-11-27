// ทดสอบระบบเสียงของหน้า Kiosk (8 พ.ย. 2569) — Chromium จริง + เซิร์ฟเวอร์ VORA จริง (AI/ฐานความรู้จริง)
// ไมโครโฟน: เครื่องทดสอบไม่มีไมค์/บริการแปลงเสียงของ Google จึงแทน SpeechRecognition ด้วยตัวจำลองที่ส่งเหตุการณ์ตามลำดับของ Chrome
//           (start → onstart → onaudiostart → onresult → onend · abort() → onerror "aborted" → onend แบบไม่พร้อมกัน)
//           ข้อความที่ "พูด" ส่งผ่านตัวจำลองเข้า Listener ตัวจริง → app.js → /api/chat จริง (ไม่ได้ข้ามระบบใด)
// เสียงพูด: speechSynthesis จำลองตามความยาวข้อความ · /api/tts จำลองด้วย page.route (ไม่เรียกบริการเสียงภายนอกเลย)
// วิธีรัน: เปิดเซิร์ฟเวอร์ที่ :8000 แล้ว `node voice-scenarios.js`
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8000';
const TONE = Buffer.from(fs.readFileSync(path.join(__dirname, 'tone.b64'), 'utf8'), 'base64');
const results = [];
const rec = (id, name, pass, note = '') => { results.push({ id, name, pass, note }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} ${note}`); };

const init = () => {
  // ---- ตัวจำลอง SpeechRecognition (ลำดับเหตุการณ์แบบ Chrome)
  const sr = window.__sr = { instances: [], active: 0, maxActive: 0, noAudio: false };
  class MockSR {
    constructor() { sr.instances.push(this); this.state = 'new'; }
    start() {
      if (this.state !== 'new') throw new DOMException('already started', 'InvalidStateError');
      this.state = 'started'; sr.active++; sr.maxActive = Math.max(sr.maxActive, sr.active);
      setTimeout(() => { if (this.state !== 'started') return; this.onstart && this.onstart(); if (!sr.noAudio) this.onaudiostart && this.onaudiostart(); }, 300);
    }
    stop() { if (this.state !== 'started') return; this.state = 'stopping'; setTimeout(() => this._end(), 60); }
    abort() { if (this.state !== 'started' && this.state !== 'stopping') return; this.state = 'aborting'; setTimeout(() => { this.onerror && this.onerror({ error: 'aborted' }); this._end(); }, 60); }
    _end() { if (this.state === 'ended') return; this.state = 'ended'; sr.active--; this.onend && this.onend(); }
    say(text, final = true) { const r = [{ transcript: text }]; r.isFinal = final; this.onresult && this.onresult({ resultIndex: 0, results: [r] }); }
    fail(code) { this.onerror && this.onerror({ error: code }); }
    speechEnd() { this.onspeechend && this.onspeechend(); }
  }
  window.SpeechRecognition = MockSR;
  window.webkitSpeechRecognition = MockSR;
  // ---- เสียงพูดของเบราว์เซอร์ (จำลองเวลา)
  window.__speech = [];
  const synth = {
    _cur: null, _t: null, speaking: false, onvoiceschanged: null, getVoices: () => [],
    speak(u) { this._cur = u; this.speaking = true; window.__speech.push({ ev: 'start', text: u.text });
      this._t = setTimeout(() => { this.speaking = false; this._cur = null; window.__speech.push({ ev: 'end', text: u.text }); u.onend && u.onend(); }, Math.min(2500, 300 + u.text.length * 8)); },
    cancel() { if (this._cur) { clearTimeout(this._t); const u = this._cur; this._cur = null; this.speaking = false; window.__speech.push({ ev: 'cancel', text: u.text }); u.onerror && u.onerror({ error: 'interrupted' }); } },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  // ---- บันทึกลำดับสถานะของหน้าจอ + นับเสียงที่เล่นพร้อมกัน
  window.__states = []; window.__audio = { playing: 0, max: 0, plays: 0 };
  const P = HTMLMediaElement.prototype, play = P.play;
  P.play = function () { if (!(this instanceof HTMLAudioElement)) return play.call(this); window.__audio.plays++; window.__audio.playing++; window.__audio.max = Math.max(window.__audio.max, window.__audio.playing);
    const dec = () => { if (!this.__dec) { this.__dec = 1; window.__audio.playing--; } }; this.addEventListener('ended', dec); this.addEventListener('pause', dec); this.addEventListener('error', dec);
    return play.call(this).catch((e) => { dec(); throw e; }); };
  document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    new MutationObserver(() => { const s = app.dataset.state + (app.dataset.voice ? ':' + app.dataset.voice : ''); if (window.__states[window.__states.length - 1] !== s) window.__states.push(s); })
      .observe(app, { attributes: true, attributeFilter: ['data-state', 'data-voice'] });
  });
};

async function open(browser, { serverTTS = false, tts = 'ok' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = []; page.chats = []; page.tts = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('request', (r) => { if (r.url().includes('/api/chat')) page.chats.push(JSON.parse(r.postData() || '{}')); });
  if (serverTTS) {
    await page.route('**/api/kiosk/config', async (route) => { const res = await route.fetch(); const j = await res.json(); j.server_tts = true; route.fulfill({ response: res, json: j }); });
    await page.route('**/api/tts?**', async (route) => {
      const u = new URL(route.request().url()); page.tts.push({ lang: u.searchParams.get('lang'), text: u.searchParams.get('text') });
      if (page.ttsMode === 'hang') return;            // ไม่ตอบเลย (จำลองบริการค้าง)
      if (page.ttsMode === '204') return route.fulfill({ status: 204, body: '' });
      route.fulfill({ status: 200, contentType: 'audio/wav', body: TONE });
    });
    page.ttsMode = tts;
  }
  await page.goto(`${BASE}/?debug=1&avatar=placeholder`);
  await page.waitForFunction(() => window.VORA && window.VORA.S.cfg, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}
const ev = (p, fn, arg) => p.evaluate(fn, arg);
const cur = (p, fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', `return (${f})(r, a)`)(window.__sr.instances[window.__sr.instances.length - 1], a), [fn.toString(), arg]);
const app = (p) => ev(p, () => ({ state: document.getElementById('app').dataset.state, voice: document.getElementById('app').dataset.voice || '', caption: document.getElementById('caption').textContent,
  wave: getComputedStyle(document.querySelector('.wave i')).animationName, n: window.__sr.instances.length, active: window.__sr.active, max: window.__sr.maxActive }));
const tap = async (p) => { await p.mouse.move(800, 400); await p.click('#micBtn'); };
const LIVE = 650;   // ตัวจำลองส่ง onaudiostart หลังเริ่ม 300ms
const tapLive = async (p) => { await tap(p); await p.waitForFunction(() => document.getElementById('app').dataset.voice === 'live', null, { timeout: 5000 }).catch(() => {}); };
const waitState = (p, s, ms = 15000) => p.waitForFunction((x) => document.getElementById('app').dataset.state === x, s, { timeout: ms });

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  let o = await open(browser), page = o.page;

  // V1 เปิดไมค์ → ไมค์รับเสียงจริงก่อนจึงแสดงว่ากำลังฟัง → พูด → ถาม AI จริง → พูดตอบ → ว่าง
  await tap(page);
  const s0 = await app(page);
  await page.waitForFunction(() => document.getElementById('app').dataset.voice === 'live', null, { timeout: 5000 }).catch(() => {});
  const s1 = await app(page);
  await cur(page, (r) => { r.say('มีสาขาอะไรบ้าง', true); r.speechEnd(); r._end(); });
  await waitState(page, 'speaking');
  const spk = await ev(page, () => ({ text: document.getElementById('caption').textContent }));
  await waitState(page, 'idle', 20000);
  const seq = await ev(page, () => window.__states.join(' > '));
  rec('V1', 'เปิดไมค์ → กำลังฟัง (หลังไมค์ทำงานจริง) → ส่งข้อความเข้า AI เดิม → พูดตอบ → กลับว่าง',
    s0.voice === 'starting' && s0.wave === 'none' && s1.voice === 'live' && s1.wave !== 'none' && page.chats.length === 1 && page.chats[0].text === 'มีสาขาอะไรบ้าง' && page.chats[0].input_mode === 'voice'
      && /listening:starting > listening:live.*thinking.*speaking.*idle/.test(seq) && spk.text.length > 20,
    JSON.stringify({ starting: s0.voice, wave0: s0.wave, live: s1.voice, chat: page.chats[0], seq }));

  // V2 ไม่พูดอะไร → แจ้งไม่ได้ยินเสียง → ว่าง (ไม่ค้างกำลังฟัง) → กดใหม่ได้
  await tapLive(page);
  await cur(page, (r) => { r.fail('no-speech'); r._end(); });
  await page.waitForTimeout(200);
  const n2 = await app(page);
  await tapLive(page);
  const n2b = await app(page);
  await cur(page, (r) => r.abort()); await page.click('#stopBtn'); await page.waitForTimeout(300);
  rec('V2', 'ไม่พูดอะไร → ข้อความไม่ได้ยินเสียง → กลับว่าง → กดไมค์ใหม่ได้ทันที', n2.state === 'idle' && n2.voice === 'error' && /ไม่ได้ยินเสียง/.test(n2.caption) && n2b.state === 'listening' && n2b.voice === 'live',
    JSON.stringify({ n2, after: n2b.voice }));

  // V3 (Root Cause) error แล้วกดไมค์ใหม่ทันที ก่อนรอบเก่าส่ง onend → รอบเก่าต้องไม่แตะรอบใหม่
  const chats3 = page.chats.length;
  await tapLive(page);
  await cur(page, (r) => { r.say('ข้อความรอบเก่า', false); r.fail('network'); });   // Chrome: onerror ก่อน แล้ว onend ตามมาทีหลัง
  await page.waitForTimeout(50);
  await tap(page);                       // ลองใหม่ทันที (ระหว่างนี้รอบเก่ายังไม่ onend)
  await ev(page, () => { const a = window.__sr.instances[window.__sr.instances.length - 2]; setTimeout(() => a._end(), 80); });   // onend ของรอบเก่ามาช้า
  await page.waitForFunction(() => document.getElementById('app').dataset.voice === 'live', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);   // ให้ onend ของรอบเก่า (80ms) เกิดแน่นอน
  const r3 = await app(page);
  await cur(page, (r) => { r.say('ทดสอบรอบใหม่', true); r._end(); });
  await waitState(page, 'speaking'); await waitState(page, 'idle', 20000);
  const new3 = page.chats.slice(chats3).map((c) => c.text);
  rec('V3', 'Root Cause: onend ของรอบเก่าที่มาช้าไม่ทำให้รอบใหม่หลุดเป็นว่าง และไม่ส่งข้อความเก่าไป AI', r3.state === 'listening' && r3.voice === 'live' && JSON.stringify(new3) === '["ทดสอบรอบใหม่"]',
    JSON.stringify({ afterStaleEnd: r3, chats: new3 }));

  // V4 พูดแล้วกดไมค์อีกครั้งเพื่อหยุด → ใช้คำที่พูดไปแล้วถาม AI
  const chats4 = page.chats.length;
  await tapLive(page);
  await cur(page, (r) => r.say('สมัครเรียนยังไง', false));
  await tap(page);                         // หยุดฟัง (ไม่ใช่ยกเลิก)
  await waitState(page, 'speaking'); await waitState(page, 'idle', 20000);
  rec('V4', 'Stop listening: กดไมค์ซ้ำ = จบการฟังแล้วส่งคำที่พูด', page.chats.slice(chats4).map((c) => c.text).join('|') === 'สมัครเรียนยังไง', page.chats.slice(chats4).map((c) => c.text).join('|'));

  // V5 ไม่ได้รับสิทธิ์ → ข้อความเข้าใจง่าย → ว่าง → ลองใหม่ได้
  await tapLive(page);
  await cur(page, (r) => { r.fail('not-allowed'); r._end(); });
  await page.waitForTimeout(200);
  const r5 = await app(page);
  const toast5 = await ev(page, () => document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent);
  await tapLive(page);
  const r5b = await app(page);
  await cur(page, (r) => { r.fail('audio-capture'); r._end(); }); await page.waitForTimeout(200);
  const r6 = await app(page);
  rec('V5', 'Permission denied / ไม่พบไมค์ → ข้อความชัดเจน → กลับว่าง → ลองใหม่ได้', r5.state === 'idle' && /อนุญาต/.test(toast5) && r5b.voice === 'live' && r6.state === 'idle' && /ไม่พบไมโครโฟน/.test(r6.caption),
    JSON.stringify({ toast5, retry: r5b.voice, cap6: r6.caption }));

  // V6 ไมค์ไม่ยอมเริ่มรับเสียง → ไม่แสดงว่ากำลังฟัง (ไม่มีคลื่น) → หมดเวลา → แจ้ง → ว่าง
  await ev(page, () => { window.__sr.noAudio = true; });
  await tap(page); await page.waitForTimeout(1500);
  const r7 = await app(page);
  await page.waitForTimeout(5200);
  const r7b = await app(page);
  await ev(page, () => { window.__sr.noAudio = false; });
  rec('V6', 'ไมค์ไม่ตอบสนอง: ระหว่างรอไม่แสดงคลื่นเสียง · 6 วิ แล้วแจ้งและกลับว่าง', r7.voice === 'starting' && r7.wave === 'none' && r7b.state === 'idle' && /ไมโครโฟนไม่ตอบสนอง/.test(r7b.caption) && r7b.active === 0,
    JSON.stringify({ during: [r7.voice, r7.wave], after: [r7b.state, r7b.caption, r7b.active] }));

  // V7 พูดหลายครั้งติดกัน + ประโยคยาว · ไม่มีการรับเสียงซ้อน
  const chats7 = page.chats.length;
  const long = 'อยากทราบว่าสาขาเทคโนโลยีสารสนเทศเรียนเกี่ยวกับอะไรบ้าง จบแล้วทำงานอะไรได้บ้าง และต้องใช้เอกสารอะไรในการสมัครเรียน มีทุนการศึกษาให้นักเรียนที่เรียนดีแต่ขาดแคลนทุนทรัพย์หรือไม่';
  for (const q of ['มีข่าวอะไรบ้าง', long, 'ค่าเทอมเท่าไหร่']) {
    await tapLive(page);
    await cur(page, (r, a) => { r.say(a, true); r._end(); }, q);
    await waitState(page, 'speaking'); await waitState(page, 'idle', 25000);
  }
  const r8 = await app(page);
  const sent7 = page.chats.slice(chats7).map((c) => c.text);
  rec('V7', 'พูดหลายครั้ง + ประโยคยาว: ส่งครบตรงคำ · ไมค์ทำงานพร้อมกันไม่เกิน 1 · สร้างตัวรับเสียง 1 ตัวต่อการกด', sent7.length === 3 && sent7[1] === long && r8.max === 1 && r8.active === 0,
    JSON.stringify({ sent: sent7.length, longOk: sent7[1] === long, maxActive: r8.max, instances: r8.n }));

  // V8 พูดแทรกตอน VORA กำลังตอบ → หยุดเสียงทันที → ฟังใหม่
  await page.fill('#askInput', 'มีสาขาอะไรบ้าง'); await page.press('#askInput', 'Enter');
  await waitState(page, 'speaking'); await page.waitForTimeout(300);
  await tap(page); await page.waitForTimeout(200);
  const r9 = await app(page);
  const cancelled = await ev(page, () => window.__speech.some((x) => x.ev === 'cancel'));
  await cur(page, (r) => r.abort()); await page.click('#stopBtn'); await page.waitForTimeout(300);
  rec('V8', 'Interrupt: กดไมค์ขณะ VORA พูด → เสียงหยุดจริง → กำลังฟัง', r9.state === 'listening' && cancelled, JSON.stringify({ state: r9.state, cancelled }));
  rec('V9', 'ไม่มี JavaScript error ตลอดการทดสอบเสียง', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)));
  await o.ctx.close();

  // ---- เสียงพูดจากเซิร์ฟเวอร์ (VORA voice) — /api/tts จำลอง
  o = await open(browser, { serverTTS: true }); page = o.page;
  await page.fill('#askInput', 'มีสาขาอะไรบ้าง'); await page.press('#askInput', 'Enter');
  await waitState(page, 'speaking');
  await page.waitForTimeout(200);
  const rig = await ev(page, () => ({ talking: VORA.avatar.talking, state: VORA.avatar.state }));
  await waitState(page, 'idle', 30000);
  const a1 = await ev(page, () => ({ ...window.__audio, path: VORA.speaker.lastPath, browser: window.__speech.length }));
  rec('T1', 'เสียง VORA จากเซิร์ฟเวอร์: ทีละประโยค (ไม่ตัดที่ 600 ตัวอักษร) · เล่นทีละเสียงไม่ซ้อน · อวตารพูดระหว่างเสียง แล้วกลับว่าง',
    page.tts.length >= 2 && page.tts.every((x) => x.text.length <= 600) && a1.max === 1 && a1.plays === page.tts.length && a1.path === 'server' && a1.browser === 0 && rig.talking,
    JSON.stringify({ requests: page.tts.length, maxLen: Math.max(...page.tts.map((x) => x.text.length)), audio: a1, avatar: rig }));

  // T2 ข้อความภาษาผสม / อังกฤษ: ไม่ล้ม ใช้ภาษาตามคำตอบ
  page.tts.length = 0;
  await ev(page, () => document.getElementById('tVoice').click());   // ปุ่มทดสอบเสียง: ตัวอย่างที่ 1 (ไทย)
  await waitState(page, 'idle', 20000);
  await ev(page, () => document.getElementById('tVoice').click());   // ตัวอย่างที่ 2 (ไทยปนอังกฤษ)
  await waitState(page, 'speaking'); await waitState(page, 'idle', 20000);
  await ev(page, () => document.getElementById('tVoice').click());   // ตัวอย่างที่ 3 (อังกฤษ)
  await waitState(page, 'speaking'); await waitState(page, 'idle', 20000);
  const langs = page.tts.map((x) => x.lang + ':' + x.text.slice(0, 18));
  rec('T2', 'ทดสอบเสียง ไทย / ไทยปนอังกฤษ / อังกฤษ ผ่านเส้นทางจริง', page.tts.some((x) => x.lang === 'th' && /Computer Technology/.test(x.text)) && page.tts.some((x) => x.lang === 'en' && /Hello/.test(x.text)) && page.errors.length === 0, JSON.stringify(langs));

  // T3 บริการเสียงไม่พร้อม (204) → เสียงเบราว์เซอร์แทน · ยังกลับว่าง
  page.ttsMode = '204';
  await ev(page, () => { window.__speech.length = 0; });
  await page.fill('#askInput', 'ค่าเทอมเท่าไหร่'); await page.press('#askInput', 'Enter');
  await waitState(page, 'speaking'); await waitState(page, 'idle', 20000);
  const p3 = await ev(page, () => ({ path: VORA.speaker.lastPath, spoke: window.__speech.filter((x) => x.ev === 'start').length }));
  rec('T3', 'TTS ไม่พร้อม → ใช้เสียงเบราว์เซอร์ต่อทันที → กลับว่าง', p3.path === 'browser' && p3.spoke >= 1, JSON.stringify(p3));

  // T4 บริการเสียงค้าง (timeout) → ไม่เกิน ~9 วิ ใช้เสียงเบราว์เซอร์ → กลับว่าง · ลองใหม่หลังบริการกลับมาได้
  page.ttsMode = 'hang';
  await ev(page, () => { window.__speech.length = 0; });
  const t0 = Date.now();
  await page.fill('#askInput', 'วิทยาลัยอยู่ที่ไหน'); await page.press('#askInput', 'Enter');
  await page.waitForFunction(() => window.__speech.some((x) => x.ev === 'start'), null, { timeout: 15000 });
  const fallbackMs = Date.now() - t0;
  await waitState(page, 'idle', 30000);
  page.ttsMode = 'ok';
  page.tts.length = 0;
  await page.fill('#askInput', 'ติดต่อวิทยาลัยยังไง'); await page.press('#askInput', 'Enter');
  await waitState(page, 'speaking'); await waitState(page, 'idle', 30000);
  const p4 = await ev(page, () => VORA.speaker.lastPath);
  rec('T4', 'TTS timeout → เสียงเบราว์เซอร์ภายในเวลาที่กำหนด → ลองใหม่ได้เมื่อบริการกลับมา', fallbackMs < 12000 && p4 === 'server', JSON.stringify({ fallbackMs, retryPath: p4 }));

  // T5 หยุดกลางคำตอบ → เสียงหยุดทันที ไม่มีประโยคถัดไปเล่นต่อ · คำถามใหม่ไม่มีเสียงเก่าซ้อน
  page.tts.length = 0;
  await page.fill('#askInput', 'มีสาขาอะไรบ้าง'); await page.press('#askInput', 'Enter');
  await waitState(page, 'speaking'); await page.waitForTimeout(250);
  await page.click('#stopBtn');
  const after = page.tts.length;
  await page.waitForTimeout(1500);
  const p5 = await ev(page, () => ({ ...window.__audio, state: document.getElementById('app').dataset.state, talking: VORA.avatar.talking }));
  rec('T5', 'หยุด/พูดแทรกระหว่างเสียง VORA: เสียงหยุด ไม่ดึงประโยคถัดไป อวตารเลิกขยับปาก', p5.playing === 0 && p5.max === 1 && page.tts.length <= after + 1 && p5.state === 'idle' && !p5.talking,
    JSON.stringify({ requestsAfterStop: page.tts.length - after, ...p5 }));
  rec('T6', 'ไม่มี JavaScript error ตลอดการทดสอบเสียงพูด', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)));
  await o.ctx.close();

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'voice-test-results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
