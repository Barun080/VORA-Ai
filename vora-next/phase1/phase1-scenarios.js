// VORA NEXT — Phase 1 Gate Tests (Spatial Experience Foundation)
// รันกับเซิร์ฟเวอร์ VORA จริง (start.bat) ใน Chromium จริง: npm i playwright && mkdir shots && node phase1-scenarios.js
// ผลลัพธ์: phase1-test-results.json + ภาพใน shots/
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.VORA_URL || 'http://localhost:8000';
const results = [];
const rec = (id, name, pass, note = '') => { results.push({ id, name, pass: !!pass, note }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} ${note}`); };

const init = () => {
  // นับการเปิดกล้อง / WebSocket ทั้งหมดตลอดอายุหน้า
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) { const o = md.getUserMedia.bind(md); window.__gum = 0; md.getUserMedia = (c) => { window.__gum++; return o(c); }; }
  const WS = window.WebSocket; window.__ws = [];
  window.WebSocket = function (...a) { const s = new WS(...a); window.__ws.push(s); return s; };
  window.WebSocket.prototype = WS.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
  // เสียงพูดจำลอง (เครื่องทดสอบไม่มีเสียงไทย)
  window.__speech = [];
  const synth = { _cur: null, _timer: null, speaking: false, onvoiceschanged: null, getVoices: () => [],
    speak(u) { this._cur = u; this.speaking = true; window.__speech.push({ text: u.text, ev: 'start' });
      this._timer = setTimeout(() => { this.speaking = false; this._cur = null; window.__speech.push({ text: u.text, ev: 'end' }); u.onend && u.onend(); }, Math.min(3000, 400 + u.text.length * 10)); },
    cancel() { if (this._cur) { clearTimeout(this._timer); const u = this._cur; this._cur = null; this.speaking = false; window.__speech.push({ text: u.text, ev: 'cancel' }); u.onerror && u.onerror({ error: 'interrupted' }); } } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
};

async function open(browser, w, h, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['camera', 'microphone'], ...extra });
  await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.VORA && VORA.orch && VORA.S.cam === 'on' && VORA.S.cfg, null, { timeout: 30000 });
  return { ctx, page };
}
const ev = (p, fn, a) => p.evaluate(fn, a);
// รอให้ transition ของแผงและปุ่มเมนูจบจริง (เครื่องไม่มี GPU ช้ากว่าจริง)
const settle = (p) => p.waitForFunction(() => {
  const els = [...document.querySelectorAll('.hdr,.left,.right,.dock,.orb,#stage')];
  return els.every((e) => e.getAnimations().filter((a) => a.constructor.name === 'CSSTransition').length === 0);
}, null, { timeout: 15000, polling: 100 }).then(() => p.waitForTimeout(120));
const wake = async (p) => { await p.mouse.move(5, 200); await p.mouse.move(25, 230); await p.waitForFunction(() => VORA.ui.mode === 'active'); await settle(p); };
const idleNow = async (p) => { await ev(p, () => { VORA.orch.close('test'); VORA.ui.goIdle(); }); await settle(p); };
const R = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height });
const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const geom = (p) => ev(p, () => {
  const r = (e) => { const x = e.getBoundingClientRect(); return { l: x.left, t: x.top, r: x.right, b: x.bottom, w: x.width, h: x.height }; };
  const svg = r(document.querySelector('#avatar svg'));
  const face = { ...svg, b: svg.t + svg.h * 0.3 };
  return { layout: VORA.menu.layoutMode, svg, face, stage: r(document.getElementById('stage')), vw: innerWidth, vh: innerHeight,
    orbs: [...document.querySelectorAll('.orb')].map(r), bubble: document.getElementById('bubble').hidden ? null : r(document.getElementById('bubble')) };
});
const health = (p) => ev(p, () => {
  const v = document.getElementById('camVideo'); const tr = v.srcObject && v.srcObject.getVideoTracks()[0];
  const ws = window.__ws.filter((s) => /\/ws/.test(s.url));
  return { gum: window.__gum, cam: VORA.S.cam, track: tr ? tr.readyState : 'none', vt: v.currentTime, ws: ws.length, wsOpen: ws.filter((s) => s.readyState === 1).length,
    svgCount: document.querySelectorAll('#avatar svg').length, svgId: document.querySelector('#avatar svg') === window.__svg0 };
});

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  // ------------------------------------------------ 1–4 : Idle / Active / ตำแหน่ง Orbital Menu ที่ 3 ความละเอียด
  for (const [w, h] of [[1366, 768], [1600, 900], [1920, 1080]]) {
    const { ctx, page } = await open(browser, w, h);
    await wake(page);
    let g = await geom(page);
    const vis = await ev(page, () => [...document.querySelectorAll('.orb')].map((b) => +getComputedStyle(b).opacity));
    const inStage = g.orbs.every((o) => o.l >= g.stage.l - 1 && o.r <= g.stage.r + 1 && o.t >= g.stage.t - 1 && o.b <= g.stage.b + 1);
    const noFace = g.orbs.every((o) => !hit(o, g.face));
    const noBody = g.orbs.every((o) => o.r <= g.svg.l + 1 || o.l >= g.svg.r - 1);
    const noOverlap = g.orbs.every((a, i) => g.orbs.every((b, j) => i === j || !hit(a, b)));
    await page.screenshot({ path: `shots/p1_active_${w}x${h}.png` });
    rec(`1@${w}`, `Active: Orbital Menu 6 หมวด แสดงรอบอวตาร ไม่บังใบหน้า/ตัวอวตาร ไม่ทับกัน อยู่ในเวที (${w}×${h})`,
      g.layout === 'orbital' && g.orbs.length === 6 && vis.every((o) => o === 1) && inStage && noFace && noBody && noOverlap,
      `layout=${g.layout} faceBottom=${g.face.b.toFixed(0)} minOrbTop=${Math.min(...g.orbs.map((o) => o.t)).toFixed(0)} inStage=${inStage} noFace=${noFace} noBody=${noBody} noOverlap=${noOverlap}`);
    // กล่องคำพูดยาวสุด (5 บรรทัด) ต้องไม่ทับปุ่มเมนู
    await ev(page, () => VORA.bus.emit('avatar:caption', { text: 'ทดสอบกล่องคำพูดยาว '.repeat(30) }));
    await page.waitForTimeout(400);
    g = await geom(page);
    rec(`2@${w}`, `กล่องคำพูดยาวสุดไม่ทับปุ่มเมนู (${w}×${h})`, g.bubble && g.orbs.every((o) => !hit(o, g.bubble)), g.bubble ? `bubble.b=${g.bubble.b.toFixed(0)} orbTop=${Math.min(...g.orbs.map((o) => o.t)).toFixed(0)}` : 'no bubble');
    await ev(page, () => VORA.bus.emit('avatar:caption', { text: '' }));
    // Active แสดงองค์ประกอบครบ
    const act = await ev(page, () => {
      const shown = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).opacity === '1' && e.getBoundingClientRect().width > 0; };
      return { chat: shown('.chat'), quick: shown('.quick'), tools: shown('#toolsBtn'), mic: shown('#micBtn'), input: shown('#askInput'), textMenu: shown('#textMenuBtn'), menu: shown('.left') };
    });
    rec(`3@${w}`, `Active: แสดง Chat, Quick Actions, Tool Icons, Voice Controls ครบ (${w}×${h})`, Object.values(act).every(Boolean), JSON.stringify(act));
    await idleNow(page);
    const idle = await ev(page, () => ({ mode: VORA.orch.mode, dmode: document.getElementById('app').dataset.mode,
      orbs: [...document.querySelectorAll('.orb')].every((b) => +getComputedStyle(b).opacity === 0 && getComputedStyle(b).pointerEvents === 'none'),
      panels: ['.hdr', '.left', '.right', '.dock'].every((s) => +getComputedStyle(document.querySelector(s)).opacity === 0),
      hint: +getComputedStyle(document.getElementById('idleHint')).opacity === 1, avatar: document.querySelector('#avatar svg').getBoundingClientRect().height > 100 }));
    await page.screenshot({ path: `shots/p1_idle_${w}x${h}.png` });
    rec(`4@${w}`, `Idle: ซ่อนแผงและเมนูทั้งหมด เหลืออวตาร + ข้อความแนะนำ (${w}×${h})`, idle.mode === 'idle' && idle.dmode === 'idle' && idle.orbs && idle.panels && idle.hint && idle.avatar, JSON.stringify(idle));
    rec(`E@${w}`, `ไม่มี JavaScript error (${w}×${h})`, page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ------------------------------------------------ 5 : Compact Menu บนจอเล็ก (มือถือ / แท็บเล็ตแนวตั้ง)
  for (const [w, h, name] of [[390, 844, 'mobile'], [768, 1024, 'tablet']]) {
    const { ctx, page } = await open(browser, w, h, { hasTouch: true, isMobile: name === 'mobile' });
    await wake(page);
    const g = await geom(page);
    const sc = await ev(page, () => { const o = document.getElementById('orbit'); return { sw: o.scrollWidth, cw: o.clientWidth }; });
    const noFace = g.orbs.every((o) => !hit(o, g.face));
    // ปุ่มแรกต้องเริ่มในจอ (ไม่ถูกตัดซ้าย) และปุ่มสุดท้ายเลื่อนถึงได้
    const firstOk = g.orbs[0].l >= -1;
    await page.screenshot({ path: `shots/p1_compact_${name}.png` });
    rec(`5@${name}`, `จอเล็ก (${w}×${h}): ${g.layout === 'compact' ? 'เปลี่ยนเป็น Compact Menu' : 'ใช้ Orbital'} ไม่บังใบหน้า ปุ่มแรกไม่ถูกตัด`, noFace && firstOk && g.orbs.every((o) => o.h >= 44), `layout=${g.layout} faceBottom=${g.face.b.toFixed(0)} orbTop=${Math.min(...g.orbs.map((o) => o.t)).toFixed(0)} firstL=${g.orbs[0].l.toFixed(0)} scroll=${sc.sw}/${sc.cw}`);
    // แตะ (Touch) เปิดการนำเสนอได้
    await page.tap('.orb[data-section="news"]');
    await page.waitForFunction(() => document.querySelectorAll('#present .pcard').length > 0, null, { timeout: 10000 }).catch(() => {});
    const pr = await ev(page, () => { const r = document.getElementById('present').getBoundingClientRect(); return { mode: VORA.orch.mode, cards: document.querySelectorAll('#present .pcard').length, w: r.width, vw: innerWidth }; });
    await page.screenshot({ path: `shots/p1_present_${name}.png` });
    rec(`5b@${name}`, `จอเล็ก: แตะเมนู → นำเสนอเต็มจอ ใช้งานได้`, pr.mode === 'presentation' && pr.cards === 4 && pr.w >= pr.vw - 2, JSON.stringify(pr));
    rec(`E@${name}`, `ไม่มี JavaScript error (${name})`, page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ------------------------------------------------ 6–17 : การทำงานหลักที่ 1600×900
  const { ctx, page } = await open(browser, 1600, 900);
  await ev(page, () => { window.__svg0 = document.querySelector('#avatar svg'); });
  const h0 = await health(page);

  // 6 Trigger เข้า Active: เมาส์ขยับ / คลิก / แตะ / คีย์บอร์ด / เสียง(ปุ่มไมค์) / ท่ามือ
  const triggers = {
    mouse: async () => { await page.mouse.move(300, 300); await page.mouse.move(330, 330); },
    click: async () => { await ev(page, () => document.getElementById('stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); },
    touch: async () => { await ev(page, () => window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))); },
    keyboard: async () => { await page.keyboard.press('Shift'); },
    // การโต้ตอบด้วยเสียง: ระบบเสียงเดิมตั้ง data-state="listening" เมื่อเริ่มฟัง (เครื่องทดสอบไม่มีไมโครโฟน จึงตั้งสถานะตรง)
    voice: async () => { await ev(page, () => { document.getElementById('app').dataset.state = 'listening'; }); },
    gesture: async () => { await ev(page, () => VORA.bus.emit('camera:gesture', { name: 'Open_Palm', score: .9 })); },
  };
  const trig = {};
  for (const [k, fn] of Object.entries(triggers)) {
    await idleNow(page);
    await fn();
    trig[k] = await page.waitForFunction(() => VORA.orch.mode === 'active', null, { timeout: 4000 }).then(() => true).catch(() => false);
    await ev(page, () => { document.getElementById('app').dataset.state = 'idle'; });
  }
  rec(6, 'Trigger เข้า Active: เมาส์ คลิก แตะ คีย์บอร์ด ปุ่มเสียง ท่ามือ', Object.values(trig).every(Boolean), JSON.stringify(trig));

  // 6b ผู้เข้าชม: ค่าเริ่มต้น wakeOnVisitor=false ทักทายในโหมด Idle (พฤติกรรมเดิม) · ตั้ง true แล้วเปิด Active
  await idleNow(page);
  await ev(page, () => { VORA.S.lastGreetAt = 0; VORA.tracker.end(); });
  await ev(page, () => VORA.simulateVisitor(1600));
  const visOff = await ev(page, () => VORA.orch.mode);
  await ev(page, () => VORA.simulateEmpty(6600));
  await page.waitForTimeout(6000);
  await idleNow(page);
  await ev(page, () => { VORA.config.experience.wakeOnVisitor = true; VORA.S.lastGreetAt = 0; });
  await ev(page, () => VORA.simulateVisitor(1600));
  const visOn = await page.waitForFunction(() => VORA.orch.mode === 'active', null, { timeout: 4000 }).then(() => true).catch(() => false);
  await ev(page, () => { VORA.config.experience.wakeOnVisitor = false; });
  await ev(page, () => VORA.simulateEmpty(6600));
  rec('6b', 'Visitor Detection: ค่าเริ่มต้นไม่ปลุกหน้าจอ (ทักใน Idle) · เปิด wakeOnVisitor แล้วเข้า Active', visOff === 'idle' && visOn, `default=${visOff} wakeOnVisitor=${visOn}`);

  // 7 Presentation ทั้ง 4 หมวด: ข้อมูลตรงกับ API จริง
  const api = await ev(page, async () => {
    const j = (u) => fetch(u).then((r) => r.json());
    const [p, n] = await Promise.all([j('/api/programs?lang=th'), j('/api/news?limit=20&lang=th')]);
    return { programs: p.length, news: n.length, admission: n.filter((x) => x.kind === 'admission').length, about: 7 };
  });
  const sec = {};
  for (const s of ['departments', 'news', 'admission', 'college']) {
    await wake(page);
    await page.click(`.orb[data-section="${s}"]`);
    await page.waitForFunction(() => VORA.orch.mode === 'presentation' && !document.querySelector('#present .present-state.loading') && document.querySelectorAll('#present .pcard').length > 0, null, { timeout: 10000 }).catch(() => {});
    sec[s] = await ev(page, () => ({ mode: VORA.orch.mode, cards: document.querySelectorAll('#present .pcard[data-id]').length, qa: document.querySelectorAll('#present .pcard[data-q]').length,
      left: getComputedStyle(document.querySelector('.left')).display, right: getComputedStyle(document.querySelector('.right')).display, title: document.querySelector('.present-title').textContent }));
    await page.screenshot({ path: `shots/p1_present_${s}.png` });
    await page.click('.present-close');
    await settle(page);
  }
  const sOK = sec.departments.cards === api.programs && sec.news.cards === api.news && sec.admission.cards === api.admission && sec.admission.qa === 4 && sec.college.qa === api.about
    && Object.values(sec).every((x) => x.mode === 'presentation' && x.left === 'none' && x.right === 'none');
  rec(7, 'Presentation: 4 หมวดแสดงข้อมูลตรงกับ API จริง (สาขา/ข่าว/รับสมัคร/วิทยาลัย) ซ่อนแผงซ้าย-ขวา', sOK, JSON.stringify({ api, sec: Object.fromEntries(Object.entries(sec).map(([k, v]) => [k, [v.cards, v.qa]])) }));
  const afterClose = await ev(page, () => ({ mode: VORA.orch.mode, left: getComputedStyle(document.querySelector('.left')).display, hidden: document.getElementById('present').hidden }));
  rec('7b', 'ปุ่มปิด: กลับสู่ Active และแผงซ้าย-ขวากลับมา', afterClose.mode === 'active' && afterClose.left !== 'none' && afterClose.hidden, JSON.stringify(afterClose));

  // 8 รายละเอียด + การบรรยายของอวตาร + ย้อนกลับ + Esc
  await page.click('.orb[data-section="departments"]');
  await page.waitForSelector('#present .pcard[data-id]');
  const sp0 = await ev(page, () => window.__speech.length);
  await page.click('#present .pcard[data-id]');
  await page.waitForSelector('#present .pdetail', { timeout: 10000 });
  await page.waitForFunction((n) => window.__speech.length > n, sp0, { timeout: 8000 }).catch(() => {});
  const det = await ev(page, () => ({ title: document.querySelector('.present-title').textContent, back: !document.querySelector('.present-back').hidden, spoke: window.__speech.slice(-3).map((x) => x.text.slice(0, 20)), avatar: document.getElementById('app').dataset.avatar }));
  await page.screenshot({ path: 'shots/p1_present_detail.png' });
  await page.click('.present-back');
  await page.waitForSelector('#present .pcard[data-id]', { timeout: 10000 }).catch(() => {});
  const back = await ev(page, () => document.querySelectorAll('#present .pcard[data-id]').length);
  await page.focus('.present-title');
  await page.keyboard.press('Escape');
  const esc = await ev(page, () => VORA.orch.mode);
  rec(8, 'รายละเอียดสาขา: อวตารบรรยายด้วยเสียงจริง, ปุ่มกลับ, Esc ปิดการนำเสนอ', det.back && det.spoke.some((x) => x.includes('ช่างยนต์')) && back === api.programs && esc === 'active', JSON.stringify({ ...det, cardsAfterBack: back, esc }));
  await page.waitForTimeout(3500);

  // 9 กลับสู่ Idle เมื่อไม่มีการใช้งาน "และไม่มีงานค้าง"
  await ev(page, () => { VORA.orch.presentationIdleMs = 3000; });
  await page.click('.orb[data-section="news"]');
  await ev(page, () => { document.getElementById('app').dataset.state = 'thinking'; });   // จำลองงานค้าง (AI กำลังคิด)
  await page.waitForTimeout(4500);
  const busyStay = await ev(page, () => VORA.orch.mode);
  await ev(page, () => { document.getElementById('app').dataset.state = 'idle'; });
  const toIdle = await page.waitForFunction(() => VORA.orch.mode === 'idle' && VORA.ui.mode === 'idle', null, { timeout: 9000 }).then(() => true).catch(() => false);
  const hist = await ev(page, () => VORA.orch.history.slice(-3).map((x) => `${x.prev}->${x.mode}(${x.reason})`));
  rec(9, 'Presentation → Idle เมื่อไม่มีการใช้งานและไม่มีงานค้าง (มีงานค้าง = ยังไม่ปิด)', busyStay === 'presentation' && toIdle, `whileBusy=${busyStay} thenIdle=${toIdle} ${hist.join(' ')}`);
  await ev(page, () => { VORA.orch.presentationIdleMs = 45000; });
  await settle(page);

  // 10 ระหว่างนำเสนอ UIController ไม่เข้า Idle เอง (Idle Timer 15 วิ)
  await wake(page);
  await page.click('.orb[data-section="college"]');
  const uiIdleRefused = await ev(page, () => VORA.ui.goIdle());
  rec(10, 'ระหว่างนำเสนอ Idle Timer ของ UIController ไม่ซ่อนหน้าจอ', uiIdleRefused === false && (await ev(page, () => VORA.orch.mode)) === 'presentation');
  await page.click('.present-close');

  // 11 Keyboard Navigation
  await wake(page);
  await page.focus('.orb[data-section="college"]');
  const order = [];
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'End', 'Home']) { await page.keyboard.press(k); order.push(await ev(page, () => document.activeElement.dataset.section)); }
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => VORA.orch.mode === 'presentation', null, { timeout: 4000 }).catch(() => {});
  const kbOpen = await ev(page, () => ({ mode: VORA.orch.mode, section: VORA.orch.section, focus: document.activeElement.className }));
  await page.keyboard.press('Escape');
  const expect = ['departments', 'news', 'feedback', 'assistant', 'departments', 'feedback', 'college'];
  rec(11, 'Keyboard Navigation: ลูกศร/Home/End เลื่อนโฟกัสตามวง, Enter เปิด, Esc ปิด, โฟกัสย้ายเข้าพื้นที่นำเสนอ',
    JSON.stringify(order) === JSON.stringify(expect) && kbOpen.mode === 'presentation' && kbOpen.section === 'departments' && /present-title/.test(kbOpen.focus) && (await ev(page, () => VORA.orch.mode)) === 'active',
    `order=${order.join(',')} open=${JSON.stringify(kbOpen)}`);

  // 12 เมนูตัวอักษรใหญ่ (ผู้สูงอายุ)
  await wake(page);
  await page.click('#textMenuBtn');
  const tm = await ev(page, () => { const items = [...document.querySelectorAll('#textMenuList .text-item')]; return { open: document.getElementById('textMenu').open, n: items.length, font: parseFloat(getComputedStyle(items[0].querySelector('b')).fontSize), h: items[0].getBoundingClientRect().height }; });
  await page.screenshot({ path: 'shots/p1_text_menu.png' });
  await page.click('#textMenuList [data-section="admission"]');
  await page.waitForFunction(() => VORA.orch.mode === 'presentation', null, { timeout: 4000 }).catch(() => {});
  const tmRes = await ev(page, () => ({ mode: VORA.orch.mode, section: VORA.orch.section, dialog: document.getElementById('textMenu').open }));
  rec(12, 'เมนูตัวอักษรใหญ่: 6 หมวด ตัวอักษร ≥ 24px ปุ่มสูง ≥ 72px และเปิดหมวดได้', tm.open && tm.n === 6 && tm.font >= 24 && tm.h >= 72 && tmRes.mode === 'presentation' && tmRes.section === 'admission' && !tmRes.dialog, JSON.stringify({ ...tm, ...tmRes }));
  await page.click('.present-close');

  // 13 ภาษาอังกฤษ
  await wake(page);
  await page.click('.lang button[data-lang="en"]');
  await page.click('.orb[data-section="departments"]');
  const en = await ev(page, () => ({ orb: document.querySelector('.orb[data-section="departments"] .orb-t').textContent, title: document.querySelector('.present-title').textContent, close: document.querySelector('.present-close span').textContent }));
  await page.click('.present-close');
  await page.click('.lang button[data-lang="th"]');
  rec(13, 'สลับภาษาอังกฤษ: เมนูรอบตัวและหน้าการนำเสนอเปลี่ยนภาษา', en.orb === 'Departments' && en.title === 'Departments' && en.close === 'Close', JSON.stringify(en));

  // 14 กล้อง / WebSocket / อวตาร ต่อเนื่องตลอดการสลับโหมด (หลายรอบ)
  const vt0 = (await health(page)).vt;
  for (let i = 0; i < 5; i++) {
    await wake(page);
    await ev(page, () => VORA.bus.emit('experience:open', { section: 'news', source: 'test' }));
    await page.waitForTimeout(200);
    await ev(page, () => VORA.orch.close('test'));
    await idleNow(page);
  }
  await wake(page);
  const h1 = await health(page);
  rec(14, 'กล้องไม่หยุด/ไม่เปิดซ้ำ ระหว่าง Idle ⇄ Active ⇄ Presentation (5 รอบ)', h1.gum === h0.gum && h1.gum === 1 && h1.cam === 'on' && h1.track === 'live' && h1.vt > vt0, `gum ${h0.gum}→${h1.gum} track=${h1.track} videoTime ${vt0.toFixed(1)}→${h1.vt.toFixed(1)}`);
  rec(15, 'WebSocket ไม่หลุด/ไม่เชื่อมต่อซ้ำ ระหว่างสลับโหมด', h1.ws === 1 && h1.wsOpen === 1 && h0.ws === 1, `ws ${h0.ws}→${h1.ws} open=${h1.wsOpen}`);
  rec(16, 'อวตารไม่ถูกสร้างใหม่ (SVG เดิม ตัวเดียว) ระหว่างสลับโหมด', h1.svgCount === 1 && h1.svgId, JSON.stringify({ svgCount: h1.svgCount, same: h1.svgId }));

  // 17 สลับรัว ๆ ไม่ค้าง/ไม่ซ้อน และ Listener ไม่สะสม
  const l0 = await ev(page, () => VORA.bus.listenerCount());
  await ev(page, async () => {
    const s = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 30; i++) { VORA.bus.emit('experience:open', { section: ['news', 'departments', 'college'][i % 3] }); await s(15); if (i % 2) VORA.orch.close('rapid'); VORA.bus.emit('ui:activity', {}); await s(10); }
    VORA.orch.close('rapid');
  });
  await settle(page);
  const r17 = await ev(page, () => ({ mode: VORA.orch.mode, presentHidden: document.getElementById('present').hidden, cls: document.getElementById('app').classList.contains('is-presenting'), listeners: VORA.bus.listenerCount(), timers: 0 }));
  rec(17, 'สลับโหมดรัว 30 ครั้ง: จบสถานะถูกต้อง ไม่มีพื้นที่ค้าง Listener ไม่เพิ่ม', r17.mode === 'active' && r17.presentHidden && !r17.cls && r17.listeners === l0, JSON.stringify({ ...r17, l0 }));

  // 18 ระบบเดิมยังทำงาน: ถาม-ตอบ AI, เมนูซ้ายเดิม (ลิ้นชัก), ปุ่มหยุด
  await wake(page);
  await page.fill('#askInput', 'มีสาขาอะไรบ้าง');
  await page.press('#askInput', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#messages .msg.bot').length >= 2, null, { timeout: 15000 }).catch(() => {});
  await page.click('.nav[data-nav="news"]');
  await page.waitForSelector('#drawerBody [data-id]', { timeout: 10000 }).catch(() => {});   // ลิ้นชักโหลดข้อมูลจาก API (async)
  const drawer = await ev(page, () => document.querySelectorAll('#drawerBody [data-id]').length);
  await page.click('#drawerClose');
  const stopReq = page.waitForRequest((r) => r.url().includes('/api/robot/stop'), { timeout: 5000 }).then(() => true).catch(() => false);
  await page.click('#stopBtn');
  const r18 = { bots: await ev(page, () => document.querySelectorAll('#messages .msg.bot').length), drawer, stop: await stopReq };
  rec(18, 'ระบบเดิม: ถาม-ตอบ AI, เมนูซ้าย (ลิ้นชักข้อมูล), ปุ่มหยุด → /api/robot/stop ยังทำงาน', r18.bots >= 2 && r18.drawer === api.news && r18.stop, JSON.stringify(r18));
  rec('E', 'ไม่มี JavaScript error ตลอดการทดสอบหลัก', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();

  // 19 Reduced Motion
  {
    const { ctx: c2, page: p2 } = await open(browser, 1366, 768, { reducedMotion: 'reduce' });
    await wake(p2);
    const rm = await ev(p2, () => ({ anim: getComputedStyle(document.querySelector('.orb-in')).animationName, tr: getComputedStyle(document.querySelector('.orb')).transitionDuration }));
    rec(19, 'Reduced Motion: ปิด Animation ลอย/เคลื่อนของเมนู', rm.anim === 'none', JSON.stringify(rm));
    await c2.close();
  }

  await browser.close();
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync('phase1-test-results.json', JSON.stringify({ date: new Date().toISOString(), pass, total: results.length, results }, null, 2));
})();
