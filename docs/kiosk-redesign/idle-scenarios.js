// ทดสอบ Smart Idle / Active + Avatar Focus Mode + 3 Controller ใน Chromium จริง กับเซิร์ฟเวอร์ VORA จริง
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8000';
const results = [];
const rec = (id, name, pass, note = '') => { results.push({ id, name, pass, note }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} ${note}`); };

const speechStub = () => {
  window.__speech = [];
  const synth = {
    _cur: null, _timer: null, speaking: false, onvoiceschanged: null, getVoices: () => [],
    speak(u) { this._cur = u; this.speaking = true; window.__speech.push({ text: u.text, ev: 'start' });
      this._timer = setTimeout(() => { this.speaking = false; this._cur = null; window.__speech.push({ text: u.text, ev: 'end' }); u.onend && u.onend(); }, Math.min(6000, 600 + u.text.length * 25)); },
    cancel() { if (this._cur) { clearTimeout(this._timer); const u = this._cur; this._cur = null; this.speaking = false; window.__speech.push({ text: u.text, ev: 'cancel' }); u.onerror && u.onerror({ error: 'interrupted' }); } },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
};

async function open(browser, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(speechStub);
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
  page.reqs = []; page.on('request', (r) => { if (r.url().includes('/api/')) page.reqs.push(r.method() + ' ' + new URL(r.url()).pathname); });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.VORA && VORA.S.cam === 'on' && document.querySelector('#messages .welcome .txt')?.textContent.length > 5, null, { timeout: 25000 });
  return { ctx, page };
}
const ev = (p, fn, a) => p.evaluate(fn, a);
const rect = (p) => ev(p, () => { const r = document.querySelector('#avatar svg').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, w: r.width, cx: r.left + r.width / 2, cy: r.top + r.height / 2, vw: innerWidth, vh: innerHeight }; });
// เครื่องทดสอบไม่มี GPU: MediaPipe ใช้ CPU จน main thread ช้า จึงรอ "ให้ transition จบจริง" แทนการรอเวลาตายตัว
const settle = (p) => p.waitForFunction(() => {
  const els = ['stage', 'idleHint'].map((id) => document.getElementById(id)).concat([...document.querySelectorAll('.hdr,.left,.right,.dock')]);
  return els.every((e) => e.getAnimations().filter((a) => a.constructor.name === 'CSSTransition').length === 0);
}, null, { timeout: 15000, polling: 100 }).then(() => p.waitForTimeout(150));
const idleNow = async (p) => { await ev(p, () => VORA.ui.goIdle()); await settle(p); };
const wake = async (p) => { await p.mouse.move(200, 300); await p.mouse.move(260, 340); await settle(p); };

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  // ---------------------------------------------------------------- 1, 2, 3, 11 : ขนาด ไม่หลุดจอ กลับขนาดเดิม ที่ 2 ความละเอียด (+1600)
  for (const [w, h] of [[1366, 768], [1600, 900], [1920, 1080]]) {
    const { ctx, page } = await open(browser, w, h);
    const a = await rect(page);
    await idleNow(page);
    const i = await rect(page);
    const s = i.h / a.h;
    const ui = await ev(page, () => ({ mode: VORA.ui.mode, cls: document.getElementById('app').className, hdr: getComputedStyle(document.querySelector('.hdr')).opacity, dock: getComputedStyle(document.querySelector('.dock')).opacity, hint: getComputedStyle(document.getElementById('idleHint')).opacity }));
    await page.screenshot({ path: `shots/idle_${w}x${h}.png` });
    rec(`1@${w}`, `Idle แล้วอวตารขยาย 1.3–1.5 เท่า และซ่อนเครื่องมือ (${w}×${h})`, s >= 1.3 && s <= 1.5 && ui.mode === 'idle' && +ui.hdr === 0 && +ui.dock === 0 && +ui.hint === 1, `scale=${s.toFixed(3)}`);
    const inside = i.top >= 0 && i.bottom <= h && i.left >= 0 && i.right <= w;
    const centered = Math.abs(i.cx - w / 2) <= 3 && Math.abs(i.cy - h / 2) <= 3;
    rec(`2@${w}`, `อวตารไม่ถูกตัดขอบจอ และอยู่กึ่งกลางทั้งแนวนอน/ตั้ง (${w}×${h})`, inside && centered, `top=${i.top.toFixed(0)} bottom=${i.bottom.toFixed(0)}/${h} cx=${i.cx.toFixed(0)}/${w / 2} cy=${i.cy.toFixed(0)}/${h / 2}`);
    await wake(page);
    const b = await rect(page);
    const ui2 = await ev(page, () => ({ mode: VORA.ui.mode, hdr: getComputedStyle(document.querySelector('.hdr')).opacity, right: getComputedStyle(document.querySelector('.right')).opacity }));
    await page.screenshot({ path: `shots/active_after_idle_${w}x${h}.png` });
    const same = ['top', 'bottom', 'left', 'right'].every((k) => Math.abs(b[k] - a[k]) <= 1);
    rec(`3@${w}`, `กลับ Active แล้วอวตารลดขนาดกลับตำแหน่งเดิม และเครื่องมือกลับมา (${w}×${h})`, same && ui2.mode === 'active' && +ui2.hdr === 1 && +ui2.right === 1, `Δtop=${(b.top - a.top).toFixed(1)} Δh=${(b.h - a.h).toFixed(1)}`);
    rec(`E@${w}`, `ไม่มี JavaScript error (${w}×${h})`, page.errors.length === 0, page.errors.join('; '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- 4–10 ที่ 1366×768
  const { ctx, page } = await open(browser, 1366, 768);

  // 4 พูดได้ในโหมด Idle (ประกาศข่าว)
  await idleNow(page);
  const ann = 'ประกาศค่ะ ทดสอบพูดในโหมดหน้าจอว่าง วิทยาลัยเปิดรับสมัครนักเรียนใหม่';
  const n0 = await ev(page, () => window.__speech.length);
  await ev(page, (t) => { VORA.S.resumeAt = 0; VORA.enqueue({ kind: 'text', text_th: t, text_en: t, priority: 2 }); }, ann);
  await page.waitForFunction(() => document.getElementById('app').dataset.avatar === 'announcing', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  let s = await ev(page, (n0) => ({ mode: VORA.ui.mode, avatar: document.getElementById('app').dataset.avatar, bubble: !document.getElementById('bubble').hidden, spoke: window.__speech.slice(n0).some((x) => x.ev === 'start') }), n0);
  await page.screenshot({ path: 'shots/idle_speaking.png' });
  rec(4, 'อวตารยังพูดได้ในโหมด Idle (ไม่ปลุกหน้าจอ แสดงกล่องคำพูด)', s.mode === 'idle' && s.avatar === 'announcing' && s.bubble && s.spoke, JSON.stringify(s));
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'idle' && !VORA.im.current, null, { timeout: 15000 });

  // 5 ทักทายได้ในโหมด Idle + ลำดับ Event
  await ev(page, () => { VORA.S.cfg.greeting_cooldown_s = 3; VORA.S.lastGreetAt = 0; VORA.bus.log.length = 0; });
  const vp = ev(page, () => VORA.simulateVisitor(3500));
  const greetSeen = await page.waitForFunction(() => document.getElementById('app').dataset.avatar === 'greeting', null, { timeout: 6000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/idle_greeting.png' });
  s = await ev(page, () => ({ mode: VORA.ui.mode, bubble: document.getElementById('caption').textContent.slice(0, 30) }));
  await vp;
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'idle' && !VORA.im.current, null, { timeout: 20000 });
  const log = await ev(page, () => VORA.bus.log.map((x) => x.type));
  const order = ['visitor:detected', 'greeting:started', 'avatar:speaking', 'greeting:finished', 'avatar:idle'];
  let k = 0; for (const t of log) if (t === order[k]) k++;
  rec(5, 'อวตารทักทายได้ในโหมด Idle และหน้าจอไม่สลับเป็น Active เพราะเห็นคนอย่างเดียว', greetSeen && s.mode === 'idle' && page.reqs.includes('POST /api/greet'), JSON.stringify(s));
  rec('5b', 'ลำดับ Event: VISITOR_DETECTED → GREETING_STARTED → AVATAR_SPEAKING → GREETING_FINISHED → AVATAR_IDLE', k === order.length, log.filter((t) => !t.startsWith('ui:')).join(' → '));

  // VISITOR_RETURNED: ออกไปแล้วกลับมาในช่วงคูลดาวน์ → ไม่ทักซ้ำ
  await ev(page, () => { VORA.S.cfg.greeting_cooldown_s = 60; VORA.bus.log.length = 0; });
  await ev(page, () => VORA.simulateEmpty(6800));
  const greets0 = page.reqs.filter((r) => r === 'POST /api/greet').length;
  await ev(page, () => VORA.simulateVisitor(2000));
  await page.waitForTimeout(500);
  const log2 = await ev(page, () => VORA.bus.log.map((x) => x.type));
  rec('5c', 'คนเดิมกลับเข้ามาในช่วงคูลดาวน์ → VISITOR_RETURNED ไม่ทักซ้ำ', log2.includes('visitor:left') && log2.includes('visitor:returned') && !log2.includes('visitor:detected') && page.reqs.filter((r) => r === 'POST /api/greet').length === greets0, log2.filter((t) => t.startsWith('visitor')).join(' → '));
  await ev(page, () => VORA.simulateEmpty(6800));

  // 6, 7, 8 กล้อง / Face Detection / MediaPipe ทำงานต่อเนื่องขณะ Idle
  // วัดอัตราในโหมด Active ก่อน เป็นค่าอ้างอิงของเครื่องนี้ แล้ววัดซ้ำในโหมด Idle
  await wake(page);
  const a0 = await ev(page, () => VORA.cam.health()); await page.waitForTimeout(8000); const a1 = await ev(page, () => VORA.cam.health());
  await idleNow(page);
  const h0 = await ev(page, () => ({ ...VORA.cam.health(), face: !!VORA.camera.vision.faceDet, gest: !!VORA.camera.vision.gestureRec, ws: VORA.S.wsOnline }));
  await page.waitForTimeout(8000);
  const h1 = await ev(page, () => ({ ...VORA.cam.health(), mode: VORA.ui.mode, ws: VORA.S.wsOnline, robot: document.querySelector('#statusList [data-k="robot"]').className }));
  const rate = (x0, x1, k) => x1[k] - x0[k];
  rec(6, 'กล้องทำงานต่อเนื่องขณะ Idle (stream เดิน, สถานะ on)', h1.mode === 'idle' && h1.state === 'on' && h1.running && h1.videoTime > h0.videoTime + 5, `videoTime ${h0.videoTime.toFixed(1)}→${h1.videoTime.toFixed(1)}s ใน 8 วิ`);
  const fI = rate(h0, h1, 'faceFrames'), fA = rate(a0, a1, 'faceFrames'), tI = rate(h0, h1, 'loopTicks'), tA = rate(a0, a1, 'loopTicks');
  rec(7, 'Face Detection ทำงานต่อเนื่องขณะ Idle (อัตราไม่ต่ำกว่าโหมด Active)', h0.face && fI > 0 && fI >= fA * 0.8, `faceFrames ใน 8 วิ: Active ${fA} / Idle ${fI}`);
  rec(8, 'MediaPipe (ใบหน้า+ท่ามือ) ทำงานต่อเนื่องขณะ Idle (อัตราไม่ต่ำกว่าโหมด Active)', h0.face && h0.gest && tI > 0 && tI >= tA * 0.8, `loop ticks ใน 8 วิ: Active ${tA} / Idle ${tI}`);
  rec('8b', 'WebSocket และสถานะหุ่นยนต์ไม่หยุดระหว่าง Idle', h0.ws && h1.ws && h1.robot === 'ok', JSON.stringify({ ws: h1.ws, robot: h1.robot }));

  // ท่ามือปลุกหน้าจอ (ป้อนชื่อท่าผ่าน Event ของจริง)
  await ev(page, () => VORA.bus.emit('camera:gesture', { name: 'Thumb_Up', score: .9 }));
  await page.waitForTimeout(300);
  rec('8c', 'ท่ามือหน้ากล้อง (Event CAMERA_GESTURE) ปลุกหน้าจอเป็น Active', (await ev(page, () => VORA.ui.mode)) === 'active');

  // 9 สลับ State ถี่ ๆ ไม่เกิด Animation ซ้อน
  await settle(page);
  const anim0 = await ev(page, () => document.getAnimations().filter((a) => a.constructor.name === 'CSSAnimation').length);
  await ev(page, async () => { for (let i = 0; i < 40; i++) { if (i % 2) VORA.ui.wake(); else VORA.ui.goIdle(); await new Promise((r) => setTimeout(r, 25)); } VORA.ui.goIdle(); });
  await settle(page);
  s = await ev(page, () => {
    const st = document.getElementById('stage');
    const running = document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity);
    return { mode: VORA.ui.mode, cls: document.getElementById('app').classList.contains('is-idle'), transform: getComputedStyle(st).transform, expected: VORA.avatar.focusGeom.s, finiteRunning: running.length, total: document.getAnimations().filter((a) => a.constructor.name === 'CSSAnimation').length };
  });
  const m = s.transform.match(/matrix\(([^,]+)/);
  rec(9, 'สลับ Idle/Active 40 ครั้งติดกัน: จบที่สถานะถูกต้อง ไม่มี Animation ค้าง/ซ้อน', s.mode === 'idle' && s.cls && m && Math.abs(+m[1] - s.expected) < 0.005 && s.finiteRunning === 0 && s.total === anim0, JSON.stringify({ scale: m && (+m[1]).toFixed(3), expected: s.expected.toFixed(3), finiteRunning: s.finiteRunning, animations: `CSS animations ${anim0}→${s.total}` }));

  // 10 Memory leak / Event Listener
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const listeners = async () => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    return listeners.length;
  };
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(300); await cdp.send('HeapProfiler.collectGarbage'); return (await ev(page, () => performance.memory.usedJSHeapSize)); };
  const l0 = await listeners(); const b0 = await ev(page, () => VORA.bus.listenerCount()); const m0 = await heap();
  await ev(page, async () => { for (let i = 0; i < 300; i++) { if (i % 2) VORA.ui.wake(); else VORA.ui.goIdle(); if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0)); } VORA.ui.wake(); });
  await page.waitForTimeout(1200);
  const l1 = await listeners(); const b1 = await ev(page, () => VORA.bus.listenerCount()); const m1 = await heap();
  rec(10, 'สลับ 300 ครั้ง: จำนวน Event Listener ไม่เพิ่ม และหน่วยความจำไม่โตผิดปกติ', l1 === l0 && b1 === b0 && (m1 - m0) < 2e6, `window listeners ${l0}→${l1}, bus listeners ${b0}→${b1}, heap ${(m0 / 1e6).toFixed(1)}→${(m1 / 1e6).toFixed(1)} MB`);

  // ระบบเดิมหลังกลับมา Active: ถาม-ตอบ + ปุ่มหยุด
  await wake(page);
  await page.fill('#askInput', 'มีทุนไหม'); await page.press('#askInput', 'Enter');
  const chatOk = await page.waitForFunction(() => [...document.querySelectorAll('#messages .msg.bot[data-mid]')].length >= 1, null, { timeout: 12000 }).then(() => true).catch(() => false);
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'speaking', null, { timeout: 8000 }).catch(() => {});
  await page.click('#stopBtn');
  await page.waitForTimeout(400);
  rec('R', 'หลังสลับโหมดหลายร้อยครั้ง: ถาม-ตอบ AI และปุ่มหยุด (/api/robot/stop) ยังทำงาน', chatOk && page.reqs.includes('POST /api/robot/stop'));
  // ระหว่างสนทนา ห้ามเข้า Idle
  await ev(page, () => { VORA.ui.idleAfterMs = 2000; VORA.ui.arm(); });
  await page.fill('#askInput', 'สมัครเรียนยังไง'); await page.press('#askInput', 'Enter');
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'speaking', null, { timeout: 8000 });
  await page.waitForTimeout(2600);
  const midConvo = await ev(page, () => VORA.ui.mode);
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'idle', null, { timeout: 15000 });
  await page.waitForFunction(() => VORA.ui.mode === 'idle', null, { timeout: 12000 }).catch(() => {});
  const afterConvo = await ev(page, () => VORA.ui.mode);
  rec('T', 'Idle Timer: ไม่ซ่อนเครื่องมือระหว่างตอบคำถาม และเข้า Idle เองเมื่อว่างครบเวลา', midConvo === 'active' && afterConvo === 'idle', `ระหว่างตอบ=${midConvo}, หลังว่าง=${afterConvo}`);
  rec('E', 'ไม่มี JavaScript error ตลอดการทดสอบ', page.errors.length === 0, page.errors.join('; '));
  await ctx.close();
  await browser.close();
  fs.writeFileSync('shots/idle-results.json', JSON.stringify(results, null, 2));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
})().catch((e) => { console.error('SCRIPT ERROR', e); fs.writeFileSync('shots/idle-results.json', JSON.stringify(results, null, 2)); process.exit(1); });
