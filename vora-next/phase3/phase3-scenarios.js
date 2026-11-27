// VORA NEXT — Phase 3 Gate Tests (Conversation Journey)
// รันกับเซิร์ฟเวอร์ VORA จริง (start.bat): npm i playwright && mkdir shots && node phase3-scenarios.js
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.VORA_URL || 'http://localhost:8000';
const results = [];
const rec = (id, name, pass, note = '') => { results.push({ id, name, pass: !!pass, note }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} ${note}`); };

const init = () => {
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) { const o = md.getUserMedia.bind(md); window.__gum = 0; md.getUserMedia = (c) => { window.__gum++; return o(c); }; }
  window.__speech = [];
  const synth = { _cur: null, _timer: null, speaking: false, onvoiceschanged: null, getVoices: () => [],
    speak(u) { this._cur = u; this.speaking = true; window.__speech.push({ text: u.text, ev: 'start' });
      this._timer = setTimeout(() => { this.speaking = false; this._cur = null; window.__speech.push({ text: u.text, ev: 'end' }); u.onend && u.onend(); }, Math.min(1500, 200 + u.text.length * 6)); },
    cancel() { if (this._cur) { clearTimeout(this._timer); const u = this._cur; this._cur = null; this.speaking = false; window.__speech.push({ text: u.text, ev: 'cancel' }); u.onerror && u.onerror({ error: 'interrupted' }); } } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.VORA && VORA.orch && VORA.S.cfg && VORA.S.cam === 'on', null, { timeout: 30000 });
  const ev = (fn, a) => page.evaluate(fn, a);
  const wake = async () => { await page.mouse.move(5, 200); await page.mouse.move(25, 230); await page.waitForFunction(() => VORA.ui.mode === 'active'); await page.waitForTimeout(800); };
  // ข้อมูลจริงจาก API (ใช้ตรวจว่าตัวเลือกทุกขั้นมาจากฐานข้อมูล)
  const db = await ev(async () => {
    const programs = await (await fetch('/api/programs?lang=th')).json();
    const news = await (await fetch('/api/news?limit=20&lang=th')).json();
    return { programs, admission: news.filter((n) => n.kind === 'admission').length };
  });
  const opts = () => ev(() => [...document.querySelectorAll('#present .jopt b')].map((b) => b.textContent));
  const stepId = () => ev(() => VORA.journey.state && VORA.journey.step.id);
  const waitStep = (id) => page.waitForFunction((x) => document.querySelector(`#present .jstep[data-step="${x}"]`), id, { timeout: 10000 }).catch(() => {});
  const quiet = () => page.waitForFunction(() => VORA.S.state === 'idle' && !VORA.im.current, null, { timeout: 20000 }).catch(() => {});

  // 1 เริ่มจากหมวดรับสมัคร
  await wake();
  await page.click('.orb[data-section="admission"]');
  await page.waitForSelector('#present [data-journey="start"]', { timeout: 10000 });
  await page.click('#present [data-journey="start"]');
  await waitStep('level');
  const levels = [...new Set(db.programs.map((p) => p.level))];
  const o1 = await opts();
  const tl = await ev(() => ({ n: document.querySelectorAll('#present .jtl li').length, now: document.querySelector('#present .jtl li.now .l')?.textContent, title: document.querySelector('.present-title').textContent }));
  await page.screenshot({ path: 'shots/p3_level.png' });
  rec(1, 'เริ่มเส้นทางจากหมวดรับสมัคร: ขั้น 1 แสดงระดับการศึกษาจากฐานข้อมูลจริง + Progress Timeline 6 ขั้น', JSON.stringify(o1) === JSON.stringify(levels) && tl.n === 6 && tl.now === 'ระดับการศึกษา', JSON.stringify({ o1, levels, tl }));

  // 2 เดินหน้าทุกขั้นด้วยข้อมูลจริง
  const lv = levels[0];
  await page.click(`#present .jopt[data-value="${lv}"]`);
  await waitStep('department');
  const deps = [...new Set(db.programs.filter((p) => p.level === lv).map((p) => p.department || '—'))];
  const o2 = await opts();
  const dep = deps[0];
  await page.click(`#present .jopt[data-value="${dep}"]`);
  await waitStep('program');
  const progs = db.programs.filter((p) => p.level === lv && (p.department || '—') === dep);
  const o3 = await opts();
  await page.click(`#present .jopt[data-value="${progs[0].id}"]`);
  await waitStep('career');
  await page.waitForSelector('#present [data-slot="career"] h3', { timeout: 10000 });
  const detail = await ev(async (id) => (await fetch(`/api/programs/${id}`)).json(), progs[0].id);
  const car = await ev(() => document.querySelector('#present [data-slot="career"]').textContent);
  await page.screenshot({ path: 'shots/p3_career.png' });
  rec(2, 'เดินหน้า: แผนก/สาขา กรองตามที่เลือกจากข้อมูลจริง และขั้นอาชีพแสดงรายละเอียด+อาชีพตรงกับฐานข้อมูล',
    JSON.stringify(o2) === JSON.stringify(deps) && JSON.stringify(o3) === JSON.stringify(progs.map((p) => p.name_th)) && car.includes(detail.careers_th) && car.includes(detail.description_th),
    JSON.stringify({ lv, o2, dep, o3, careerOk: car.includes(detail.careers_th) }));

  // 3 ขั้นการสมัคร: ข่าวรับสมัครจริง + คำตอบ AI จากฐานความรู้
  await quiet();
  await page.click('#present [data-jnav="next"]');
  await waitStep('apply');
  await page.waitForFunction(() => { const s = document.querySelector('#present [data-slot="apply-ai"]'); return s && s.querySelector('h4'); }, null, { timeout: 20000 }).catch(() => {});
  const ap = await ev(() => ({ news: document.querySelectorAll('#present [data-slot="apply-news"] [data-news]').length, ai: document.querySelector('#present [data-slot="apply-ai"]').textContent, nodata: document.querySelector('#present [data-slot="apply-ai"]').classList.contains('nodata') }));
  const real = await ev(async () => (await (await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'สมัครเรียนยังไง', lang: 'th' }) })).json()));
  await page.screenshot({ path: 'shots/p3_apply.png' });
  rec(3, 'ขั้นการสมัคร: ประกาศรับสมัครจากฐานข้อมูล + คำตอบของ AI จากฐานความรู้ (ตรงกับ /api/chat)', ap.news === db.admission && ap.ai.includes(real.text.slice(0, 30)) && ap.nodata === !real.answered, JSON.stringify({ ...ap, ai: ap.ai.slice(0, 60), answered: real.answered }));

  // 4 QR Handoff
  await quiet();
  await page.click('#present [data-jnav="next"]');
  await waitStep('handoff');
  const qr = await ev(() => ({ url: document.querySelector('#present .jqr .qr-url').textContent, svg: !!document.querySelector('#present .jqr .qr svg'), done: !!document.querySelector('#present [data-jnav="done"]') }));
  await page.screenshot({ path: 'shots/p3_handoff.png' });
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(qr.url.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' });
  await m.waitForSelector('article.detail h2', { timeout: 10000 }).catch(() => {});
  const mob = await m.evaluate(() => document.querySelector('article.detail h2')?.textContent);
  await m.screenshot({ path: 'shots/p3_mobile_handoff.png' });
  await m.close();
  rec(4, 'QR Handoff: QR มีเพียงรหัสสาขา เปิดบนมือถือแล้วแสดงสาขาที่เลือกทันที', qr.svg && new URL(qr.url).searchParams.get('program') === String(progs[0].id) && [...new URL(qr.url).searchParams.keys()].length === 1 && mob === progs[0].name_th && qr.done, JSON.stringify({ ...qr, mob }));

  // 5 ย้อนกลับ + Progress Timeline
  await page.click('#present [data-jnav="back"]');
  await waitStep('apply');
  const tl2 = await ev(() => ({ done: document.querySelectorAll('#present .jtl li.done').length, enabled: [...document.querySelectorAll('#present .jtl button')].map((b) => !b.disabled) }));
  await page.click('#present [data-jgo="2"]');
  await waitStep('program');
  const back = await ev(() => ({ step: VORA.journey.step.id, on: document.querySelector('#present .jopt.on b')?.textContent, sug: document.querySelector('#present .jsug')?.textContent }));
  rec(5, 'ย้อนกลับ (ปุ่ม + แตะ Timeline): กลับขั้นก่อนได้ ตัวเลือกเดิมยังถูกเลือกไว้ และแสดงขั้นถัดไปที่แนะนำ', tl2.done === 4 && tl2.enabled.every(Boolean) && back.step === 'program' && back.on === progs[0].name_th && /อาชีพ/.test(back.sug), JSON.stringify({ tl2, back }));

  // 6 เปลี่ยนเส้นทาง (Branching): เลือกระดับใหม่ → ตัวเลือกหลังจากนั้นถูกล้าง ขั้นข้างหน้าถูกปิด
  await page.click('#present [data-jgo="0"]');
  await waitStep('level');
  const lv2 = levels[1] || levels[0];
  await page.click(`#present .jopt[data-value="${lv2}"]`);
  await waitStep('department');
  const br = await ev(() => ({ c: { ...VORA.journey.choices }, max: VORA.journey.progress().maxStep, future: [...document.querySelectorAll('#present .jtl button')].slice(2).every((b) => b.disabled) }));
  const o2b = await opts();
  const deps2 = [...new Set(db.programs.filter((p) => p.level === lv2).map((p) => p.department || '—'))];
  rec(6, 'เปลี่ยนเส้นทาง: เลือกระดับใหม่ → ล้างแผนก/สาขาเดิม ปิดขั้นข้างหน้า และแสดงแผนกของระดับใหม่', br.c.level === lv2 && br.c.department === undefined && br.c.programId === undefined && br.max === 1 && br.future && JSON.stringify(o2b) === JSON.stringify(deps2), JSON.stringify({ ...br, o2b }));

  // 7 ถามแทรก: เส้นทางอยู่ขั้นเดิม AI ตอบจากข้อมูลจริง
  await quiet();
  const before = await ev(() => ({ step: VORA.journey.state.step, n: VORA.journey.state.interjections, bots: document.querySelectorAll('#messages .msg.bot').length }));
  await page.fill('#askInput', 'ค่าเทอมเท่าไหร่');
  await page.press('#askInput', 'Enter');
  await page.waitForFunction((n) => document.querySelectorAll('#messages .msg.bot').length > n, before.bots, { timeout: 15000 }).catch(() => {});
  await quiet();
  const after = await ev(() => ({ step: VORA.journey.state.step, n: VORA.journey.state.interjections, mode: VORA.orch.mode, section: VORA.orch.section, jstep: document.querySelector('#present .jstep')?.dataset.step, bot: document.querySelector('#messages .msg.bot:last-child')?.textContent.slice(0, 50) }));
  const tuition = await ev(async () => (await (await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'ค่าเทอมเท่าไหร่', lang: 'th' }) })).json()).text);
  rec(7, 'ถามแทรก: ได้คำตอบจาก AI (ตรงกับ /api/chat) แล้วเส้นทางยังอยู่ขั้นเดิมบนจอ', after.step === before.step && after.n === before.n + 1 && after.mode === 'presentation' && after.section === 'journey' && after.jstep === 'department' && tuition.startsWith(after.bot.slice(0, 20)), JSON.stringify({ before, after }));

  // 8 เปลี่ยนหัวข้อแล้วกลับมาทำต่อ
  await page.click('#textMenuBtn');
  await page.click('#textMenuList [data-section="news"]');
  await page.waitForFunction(() => VORA.orch.section === 'news' && document.querySelectorAll('#present .pcard').length > 0, null, { timeout: 10000 });
  const rs = await ev(() => ({ shown: !document.querySelector('.present-resume').hidden, text: document.querySelector('.present-resume span').textContent, detours: VORA.journey.state.detours }));
  await page.screenshot({ path: 'shots/p3_resume_chip.png' });
  await page.click('.present-resume');
  await waitStep('department');
  const rs2 = await ev(() => ({ section: VORA.orch.section, step: VORA.journey.step.id, level: VORA.journey.choices.level }));
  rec(8, 'เปลี่ยนหัวข้อ (ไปดูข่าว) แล้วกลับสู่เส้นทางเดิมที่ขั้นเดิมด้วยปุ่ม "ทำต่อ"', rs.shown && /ขั้นที่ 2/.test(rs.text) && rs.detours === 1 && rs2.section === 'journey' && rs2.step === 'department' && rs2.level === lv2, JSON.stringify({ rs, rs2 }));

  // 9 Session ไม่สูญหายระหว่างสนทนา: ปิดโหมดนำเสนอ/สลับภาษา แล้วกลับมาทำต่อได้ · เก็บเฉพาะตัวเลือก
  await page.click('.present-close');
  await page.click('.lang button[data-lang="en"]');
  await page.click('.lang button[data-lang="th"]');
  await page.click('.orb[data-section="admission"]');
  await page.waitForSelector('#present [data-journey="resume"]', { timeout: 10000 });
  const resumeTxt = await ev(() => document.querySelector('#present [data-journey="resume"]').textContent);
  await page.click('#present [data-journey="resume"]');
  await waitStep('department');
  const stored = await ev(() => JSON.parse(sessionStorage.getItem('vora.journey') || 'null'));
  const keys = Object.keys(stored || {}).sort().join(',');
  rec(9, 'Session: ปิด/เปิดการนำเสนอและสลับภาษาแล้วเส้นทางยังอยู่ · sessionStorage เก็บเฉพาะตัวเลือกและเวลา', /ทำต่อ/.test(resumeTxt) && stored && stored.step === 1 && keys === 'choices,detours,id,interjections,maxStep,startedAt,step,updatedAt' && JSON.stringify(stored.choices) === JSON.stringify({ level: lv2 }), JSON.stringify({ resumeTxt, stored }));

  // 10 Session Expiration: TTL / ผู้เข้าชมออกไป / เริ่มบทสนทนาใหม่
  const exp = await ev(async () => {
    const j = VORA.journey, out = {};
    const ttl = j.ttlMs; j.ttlMs = 1; await new Promise((r) => setTimeout(r, 20));
    out.ttl = j.load() === null && !sessionStorage.getItem('vora.journey'); j.ttlMs = ttl;
    j.start(); j.choose('ปวช.'); VORA.S.lastActivity = Date.now() - 60000; VORA.bus.emit('visitor:left', { session: { durationMs: 1000 } });
    out.left = !j.active && j.lastClear === 'visitor-left';
    j.start(); j.choose('ปวช.'); VORA.S.lastActivity = Date.now(); VORA.bus.emit('visitor:left', { session: { durationMs: 1000 } });
    out.keptWhileActive = j.active;
    document.getElementById('tReset').click();
    out.reset = !j.active && j.lastClear === 'reset';
    return out;
  });
  rec(10, 'หมดอายุ Session: เกิน TTL / ผู้เข้าชมออกไปและไม่มีการแตะจอ / เริ่มบทสนทนาใหม่ → ล้าง · ยังมีคนใช้งานอยู่ → ไม่ล้าง', exp.ttl && exp.left && exp.keptWhileActive && exp.reset, JSON.stringify(exp));

  // 11 ไม่มีข้อมูล → แจ้งตรง ๆ + ช่องทางติดต่อ (จำลองสาขาที่ไม่มีข้อมูลอาชีพ และคำถามที่ฐานความรู้ไม่มี)
  await page.route('**/api/programs/*', async (route) => { const r = await route.fetch(); const j = await r.json(); j.careers_th = ''; j.careers_en = ''; route.fulfill({ response: r, json: j }); });
  await page.route('**/api/chat', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.text === 'สมัครเรียนยังไง') return route.fulfill({ json: { text: 'ขออภัยค่ะ หนูยังไม่มีข้อมูลเรื่องนี้ ติดต่องานประชาสัมพันธ์', answered: false, lang: 'th', intent: 'unknown' } });
    return route.continue();
  });
  await wake();
  await page.click('.orb[data-section="admission"]').catch(async () => { await page.click('.present-close').catch(() => {}); await wake(); await page.click('.orb[data-section="admission"]'); });
  await page.click('#present [data-journey="start"]');
  await waitStep('level');
  await page.click(`#present .jopt[data-value="${lv}"]`); await waitStep('department');
  await page.click(`#present .jopt[data-value="${dep}"]`); await waitStep('program');
  await page.click(`#present .jopt[data-value="${progs[0].id}"]`); await waitStep('career');
  await page.waitForSelector('#present [data-slot="career"] h3', { timeout: 10000 }).catch(() => {});
  const nd1 = await ev(() => ({ msg: document.querySelector('#present .jnodata')?.textContent, contact: !!document.querySelector('#present [data-jask]') }));
  await quiet();
  await page.click('#present [data-jnav="next"]'); await waitStep('apply');
  await page.waitForFunction(() => document.querySelector('#present [data-slot="apply-ai"] h4'), null, { timeout: 15000 }).catch(() => {});
  const nd2 = await ev(() => ({ cls: document.querySelector('#present [data-slot="apply-ai"]').className, text: document.querySelector('#present [data-slot="apply-ai"]').textContent }));
  await page.screenshot({ path: 'shots/p3_no_data.png' });
  await page.unroute('**/api/programs/*'); await page.unroute('**/api/chat');
  rec(11, 'ไม่มีข้อมูล: แจ้ง "ไม่มีข้อมูลยืนยัน" ไม่แต่งคำตอบ และเสนอช่องทางติดต่อเจ้าหน้าที่', /ยังไม่มีข้อมูลยืนยัน/.test(nd1.msg || '') && nd1.contact && /nodata/.test(nd2.cls) && /ไม่มีข้อมูลยืนยัน/.test(nd2.text) && /ติดต่อ/.test(nd2.text), JSON.stringify({ nd1, nd2 }));

  // 12 อวตารอธิบายแต่ละขั้น + คีย์บอร์ด
  const said = await ev(() => window.__speech.filter((x) => x.ev === 'start').map((x) => x.text));
  const explained = ['สนใจเรียนระดับไหน', 'เลือกแผนก', 'สาขาเหล่านี้', 'จบแล้วทำงานอะไร', 'คิวอาร์โค้ด'].map((k) => said.some((s) => s.includes(k)));
  await page.click('#present [data-jgo="0"]'); await waitStep('level');
  await page.focus(`#present .jopt[data-value="${lv}"]`);
  await page.keyboard.press('Enter');
  await waitStep('department');
  const kb = await stepId();
  rec(12, 'อวตารอธิบายทุกขั้น (เสียงจริงผ่านระบบเสียงเดิม) และเลือกด้วยคีย์บอร์ดได้', explained.every(Boolean) && kb === 'department', JSON.stringify({ explained, kb }));

  // 14 (พบจากการใช้งานจริง 1 พ.ย.) คุยเรื่องช่างยนต์ไว้ก่อน แล้วเดินเส้นทางไปสาขาอื่น → ถาม "สาขานี้…" ต้องตอบตามสาขาบนจอ
  await page.unroute('**/api/chat').catch(() => {});
  await quiet();
  await page.click('.present-close').catch(() => {});
  await wake();
  await page.fill('#askInput', 'ช่างยนต์เรียนอะไร'); await page.press('#askInput', 'Enter');
  await page.waitForFunction(() => /ช่างยนต์/.test(document.querySelector('#messages .msg.bot:last-child')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  await quiet();
  const target = db.programs.find((x) => x.level !== db.programs[0].level) || db.programs[db.programs.length - 1];
  await page.click('.orb[data-section="admission"]');
  await page.waitForSelector('#present [data-journey]', { timeout: 10000 });
  // มีเส้นทางค้างจากข้อก่อน → ปุ่ม "เริ่มใหม่" · ไม่มี → "เริ่มเส้นทาง"
  await page.click((await page.$('#present [data-journey="restart"]')) ? '#present [data-journey="restart"]' : '#present [data-journey="start"]'); await waitStep('level');
  await page.click(`#present .jopt[data-value="${target.level}"]`); await waitStep('department');
  await page.click(`#present .jopt[data-value="${target.department}"]`); await waitStep('program');
  await page.click(`#present .jopt[data-value="${target.id}"]`); await waitStep('career');
  await quiet();
  const askHere = async (q) => {
    const n = await ev(() => document.querySelectorAll('#messages .msg.bot').length);
    await page.fill('#askInput', q); await page.press('#askInput', 'Enter');
    await page.waitForFunction((k) => document.querySelectorAll('#messages .msg.bot').length > k, n, { timeout: 15000 }).catch(() => {});
    await quiet();
    return ev(() => ({ bot: document.querySelector('#messages .msg.bot:last-child')?.textContent || '', caption: document.getElementById('caption').textContent }));
  };
  const a1 = await askHere('สาขานี้เรียนอะไร');
  const a2 = await askHere('จบแล้วทำงานอะไร');
  // แผนผังความรู้: โฟกัสที่สาขาเป้าหมาย แล้วถาม "สาขานี้…"
  await ev((id) => { VORA.constellation.focus = `program:${id}`; VORA.bus.emit('experience:open', { section: 'constellation', source: 'test' }); }, target.id);
  await page.waitForFunction((id) => document.querySelector('#present .cnode.center')?.dataset.id === `program:${id}`, target.id, { timeout: 8000 }).catch(() => {});
  const a3 = await askHere('สาขานี้เรียนอะไร');
  await page.screenshot({ path: 'shots/p3_context_program.png' });
  const okAns = (a) => a.bot.includes(target.name_th) && !a.bot.includes('ช่างยนต์');
  rec(14, 'คำถาม "สาขานี้…" ตอบตามสาขาที่แสดงบนจอ (เส้นทาง + แผนผังความรู้) ไม่ใช่สาขาที่คุยไว้ก่อนหน้า', okAns(a1) && okAns(a2) && okAns(a3) && a1.caption.includes(target.name_th),
    JSON.stringify({ target: target.name_th, a1: a1.bot.slice(0, 50), a2: a2.bot.slice(0, 50), a3: a3.bot.slice(0, 50) }));

  // 13 ระบบเดิมไม่กระทบ
  const sys = await ev(() => ({ gum: window.__gum, cam: VORA.S.cam, ws: VORA.S.wsOnline }));
  rec(13, 'กล้อง/WebSocket ไม่ได้รับผลกระทบ (เปิดกล้องครั้งเดียว ยังเชื่อมต่อ)', sys.gum === 1 && sys.cam === 'on' && sys.ws, JSON.stringify(sys));
  rec('E', 'ไม่มี JavaScript error', page.errors.length === 0, page.errors.join(' | '));

  await browser.close();
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync('phase3-test-results.json', JSON.stringify({ date: new Date().toISOString(), pass, total: results.length, results }, null, 2));
})();
