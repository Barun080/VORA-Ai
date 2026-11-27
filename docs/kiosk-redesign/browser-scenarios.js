// ทดสอบหน้า Kiosk ใหม่ใน Chromium จริง (headless) กับเซิร์ฟเวอร์ VORA จริง (SQLite + หุ่นจำลอง)
// เสียงพูด: แทน speechSynthesis ด้วยตัวจำลองที่ใช้เวลาตามความยาวข้อความ (เครื่องทดสอบไม่มีลำโพง/เสียงไทย)
const { chromium } = require('playwright');
const BASE = 'http://localhost:8000';
const results = [];
const rec = (id, name, pass, note = '') => { results.push({ id, name, pass, note }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} ${note}`); };

const speechStub = () => {
  window.__speech = [];
  const synth = {
    _cur: null, _timer: null, speaking: false, onvoiceschanged: null,
    getVoices: () => [],
    speak(u) { this._cur = u; this.speaking = true; window.__speech.push({ t: Date.now(), text: u.text, ev: 'start' });
      this._timer = setTimeout(() => { this.speaking = false; this._cur = null; window.__speech.push({ t: Date.now(), text: u.text, ev: 'end' }); u.onend && u.onend(); }, Math.min(6000, 600 + u.text.length * 25)); },
    cancel() { if (this._cur) { clearTimeout(this._timer); window.__speech.push({ t: Date.now(), text: this._cur.text, ev: 'cancel' }); const u = this._cur; this._cur = null; this.speaking = false; u.onerror && u.onerror({ error: 'interrupted' }); } },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  // นับจำนวนการเปิดกล้อง (ตรวจว่ากล้องไม่ถูกเปิดซ้อน)
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) { const orig = md.getUserMedia.bind(md); window.__gum = 0; md.getUserMedia = (c) => { window.__gum++; return orig(c); }; }
};

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: opts.permissions ?? ['camera', 'microphone'], reducedMotion: opts.reducedMotion });
  await ctx.addInitScript(speechStub);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.reqs = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) page.reqs.push(r.method() + ' ' + new URL(r.url()).pathname); });
  await page.goto(BASE + '/' + (opts.query ?? '?debug=1'), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#messages .welcome .txt')?.textContent.length > 5, null, { timeout: 20000 });
  // ชุดนี้ทดสอบระบบเดิมผ่านปุ่มบนจอ จึงปิดการเข้าโหมดว่างอัตโนมัติไว้ (โหมดว่างทดสอบแยกใน idle-scenarios.js)
  await page.evaluate(() => { VORA.ui.idleAfterMs = 1e9; VORA.ui.arm(); });
  return { ctx, page };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const idle = (page, ms = 15000) => page.waitForFunction(() => document.getElementById('app').dataset.state === 'idle' && !window.VORA.im.current, null, { timeout: ms });

(async () => {
  const fake = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  let browser = await chromium.launch({ args: fake });
  let { ctx, page } = await newPage(browser);

  // 1 เปิด Kiosk แล้วกล้องเริ่มทำงานเอง
  await page.waitForFunction(() => window.VORA && window.VORA.S.cam === 'on', null, { timeout: 20000 }).catch(() => {});
  let s = await ev(page, () => ({ cam: VORA.S.cam, gum: window.__gum, video: !!document.getElementById('camVideo').srcObject }));
  rec(1, 'เปิด Kiosk แล้วกล้องเริ่มทำงานเอง (ไม่ต้องกดปุ่ม)', s.cam === 'on' && s.video, JSON.stringify(s));

  // ป้องกันกล้องซ้อน
  s = await ev(page, async () => { const c = VORA.camera; await Promise.all([c.start(), c.start(), c.start()]); return { gum: window.__gum, same: window.__voraCamera === c }; });
  rec('1b', 'เรียกเปิดกล้องซ้ำ 3 ครั้ง ไม่เปิดซ้อน', s.gum === 1 && s.same, JSON.stringify(s));

  // 13 สนทนาด้วยข้อความ (API เดิม)
  await page.fill('#askInput', 'มีสาขาอะไรบ้าง');
  await page.press('#askInput', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#messages .msg.bot[data-mid]').length >= 1, null, { timeout: 15000 });
  const spokeState = await page.waitForFunction(() => document.getElementById('app').dataset.state === 'speaking', null, { timeout: 5000 }).then(() => true).catch(() => false);
  await idle(page);
  s = await ev(page, () => ({ bot: document.querySelector('#messages .msg.bot[data-mid]').textContent.slice(0, 60), cards: document.querySelectorAll('#media .cards .card').length, spoken: window.__speech.filter((x) => x.ev === 'end').length }));
  rec(13, 'สนทนาด้วยข้อความผ่าน /api/chat เดิม และพูดตอบ', page.reqs.includes('POST /api/chat') && spokeState && s.cards > 0 && s.spoken > 0, JSON.stringify(s));
  await page.screenshot({ path: 'shots/t13_chat.png' });

  // ปุ่มหยุดพูด หยุดเสียงจริง + เรียก /api/robot/stop
  await page.fill('#askInput', 'ค่าเทอมเท่าไหร่');
  await page.press('#askInput', 'Enter');
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'speaking', null, { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.click('#stopBtn');
  await page.waitForTimeout(400);
  s = await ev(page, () => ({ state: document.getElementById('app').dataset.state, cancel: window.__speech.some((x) => x.ev === 'cancel'), speaking: speechSynthesis.speaking }));
  rec('13b', 'ปุ่มหยุด: ตัดเสียงที่กำลังพูดจริง และส่งคำสั่งหยุดหุ่น', s.state === 'idle' && s.cancel && !s.speaking && page.reqs.includes('POST /api/robot/stop'), JSON.stringify(s));

  // เมนูและลิ้นชักข้อมูลจริง
  await ev(page, () => document.getElementById('tReset').click());
  await idle(page);
  await page.click('.nav[data-nav="programs"]');
  await page.waitForFunction(() => document.querySelectorAll('#drawerBody .dlist button').length > 0, null, { timeout: 8000 });
  const nProg = await ev(page, () => document.querySelectorAll('#drawerBody .dlist button').length);
  await page.screenshot({ path: 'shots/t_menu_programs.png' });
  await page.click('#drawerBody .dlist button >> nth=0');
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'speaking', null, { timeout: 8000 });
  await idle(page);
  const progReq = page.reqs.some((r) => /GET \/api\/programs\/\d+/.test(r));
  await page.click('.nav[data-nav="news"]');
  await page.waitForFunction(() => document.querySelectorAll('#drawerBody .dlist button').length > 0, null, { timeout: 8000 });
  const nNews = await ev(page, () => document.querySelectorAll('#drawerBody .dlist button').length);
  await page.click('.nav[data-nav="about"]');
  const nAbout = await ev(page, () => document.querySelectorAll('#drawerBody .dlist .qa').length);
  await page.click('#drawerBody .qa >> nth=0');
  await page.waitForFunction(() => document.querySelectorAll('#messages .msg.bot[data-mid]').length >= 1, null, { timeout: 10000 });
  await idle(page);
  rec('M', 'เมนูซ้าย: สาขา/ข่าว/ข้อมูลวิทยาลัย เปิดข้อมูลจริงและถาม AI ได้', nProg === 7 && nNews > 0 && nAbout > 0 && progReq, `programs=${nProg} news=${nNews} about=${nAbout}`);

  // 4,5,6,7 ผู้เข้าชม: เข้ามา → ทักทาย / ยังอยู่ → ไม่ทักซ้ำ / ออก → ปิด session / คนใหม่ → session ใหม่
  await ev(page, () => { document.getElementById('tReset').click(); VORA.S.cfg.greeting_cooldown_s = 4; VORA.S.lastGreetAt = 0; });
  await idle(page);
  const greetCount = () => page.reqs.filter((r) => r === 'POST /api/greet').length;
  const g0 = greetCount();
  const vp = ev(page, () => VORA.simulateVisitor(4500));
  const greetingSeen = await page.waitForFunction(() => document.getElementById('app').dataset.avatar === 'greeting', null, { timeout: 5000 }).then(() => true).catch(() => false);
  await page.screenshot({ path: 'shots/t4_greeting.png' });
  await vp;
  s = await ev(page, () => ({ session: VORA.tracker.snapshot().session, bubble: document.getElementById('caption').textContent.slice(0, 50) }));
  rec(4, 'มีคนเดินเข้ามา → อวตารทักทาย + ข้อความบนจอ', greetCount() - g0 === 1 && greetingSeen && !!s.session, JSON.stringify(s));
  await ev(page, () => VORA.simulateVisitor(6000));   // ยืนอยู่ต่ออีก 6 วินาที (นานกว่าคูลดาวน์ 4 วิ)
  rec(5, 'คนเดิมยังอยู่ในพื้นที่ → ไม่ทักซ้ำ (แม้พ้นคูลดาวน์)', greetCount() - g0 === 1, `greets=${greetCount() - g0}`);
  const sid1 = await ev(page, () => VORA.tracker.snapshot().session.id);
  await idle(page, 20000);
  await ev(page, () => VORA.simulateEmpty(7000));
  s = await ev(page, () => ({ session: VORA.tracker.snapshot().session, tracks: VORA.tracker.snapshot().tracks.length }));
  rec(6, 'คนออกจากพื้นที่ → ปิด Session และล้าง Tracking ID', s.session === null && s.tracks === 0, JSON.stringify(s));
  await ev(page, () => { document.getElementById('tReset').click(); });
  await idle(page);
  // รอให้พ้นช่วง "คนเดิมกลับมา" (= คูลดาวน์ 4 วิ นับจากคนก่อนออก) ก่อน มิฉะนั้นระบบถือว่าเป็นคนเดิม (VISITOR_RETURNED) ซึ่งถูกต้องตามสเปก
  await page.waitForTimeout(4500);
  await ev(page, () => VORA.simulateVisitor(2500));
  await page.waitForTimeout(500);
  s = await ev(page, () => ({ session: VORA.tracker.snapshot().session }));
  rec(7, 'คนใหม่เดินเข้ามา → Session ใหม่ + ทักทายใหม่', s.session && s.session.id !== sid1 && greetCount() - g0 === 2, `${sid1} -> ${s.session && s.session.id}, greets=${greetCount() - g0}`);
  await idle(page, 20000);
  await ev(page, () => VORA.simulateEmpty(7000));

  // 3b คูลดาวน์: ออกแล้วเข้าใหม่ทันที ภายในคูลดาวน์ → ไม่ทัก
  await ev(page, () => { document.getElementById('tReset').click(); VORA.S.cfg.greeting_cooldown_s = 60; });
  await idle(page);
  const g1 = greetCount();
  await ev(page, () => VORA.simulateVisitor(2000));
  await page.waitForTimeout(600);
  rec('7b', 'Cooldown: เข้าออกถี่ภายในเวลาคูลดาวน์ → ไม่ทักรัว', greetCount() === g1, `greets=${greetCount() - g1}`);
  await ev(page, () => VORA.simulateEmpty(7000));

  // 8 หลายคนเข้ามาพร้อมกัน
  await ev(page, () => { document.getElementById('tReset').click(); VORA.S.cfg.greeting_cooldown_s = 1; VORA.S.lastGreetAt = 0; });
  await idle(page);
  await ev(page, () => VORA.simulateVisitor(2200, [{ x: .1, y: .3, w: .18, h: .24 }, { x: .6, y: .32, w: .2, h: .26 }]));
  await page.waitForFunction(() => /ทุกคน/.test(document.getElementById('caption').textContent), null, { timeout: 6000 }).catch(() => {});
  // people = จำนวนคนในเฟรมล่าสุด (กล้องเสมือนส่งเฟรมว่างแทรกได้) จึงตรวจ maxPeople = จำนวนสูงสุดที่เห็นใน Session นี้
  s = await ev(page, () => ({ people: VORA.tracker.snapshot().session?.maxPeople, caption: document.getElementById('caption').textContent.slice(0, 40) }));
  rec(8, 'หลายคนเข้ามาพร้อมกัน → ทักครั้งเดียวแบบกลุ่ม', s.people === 2 && /ทุกคน/.test(s.caption), JSON.stringify(s));
  await idle(page, 20000);
  await ev(page, () => VORA.simulateEmpty(7000));

  // 9 มีคนเข้ามาขณะกำลังประกาศข่าว → พักประกาศ ทักทาย แล้วประกาศต่อภายหลัง
  //   voice.js แบ่งประโยคหลัง "ค่ะ" จึงพูดเป็นหลายช่วง: นับว่าถูกตัดถ้าช่วงใดก็ได้ของประกาศถูก cancel
  await ev(page, () => { document.getElementById('tReset').click(); VORA.S.lastGreetAt = 0; VORA.S.resumeAt = 0; });
  await idle(page);
  // ข้อความยาวพอให้ตัวจำลองเสียงพูดนานสุด 6 วิ — เครื่องทดสอบที่ไม่มี GPU ตรวจจับคนช้า ถ้าประกาศสั้นจะจบก่อนคนถูกตรวจพบ
  const ann = 'ประกาศค่ะ ทดสอบประกาศข่าวยาว วิทยาลัยเปิดรับสมัครนักเรียนใหม่ ระดับ ปวช. และ ปวส. ตั้งแต่วันนี้ถึงสิ้นเดือน ' + 'ผู้สนใจสามารถสอบถามรายละเอียดเพิ่มเติมได้ที่งานประชาสัมพันธ์ '.repeat(4);
  await ev(page, (text) => VORA.enqueue({ kind: 'text', text_th: text, text_en: text, priority: 2 }), ann);
  await page.waitForFunction(() => document.getElementById('app').dataset.avatar === 'announcing', null, { timeout: 5000 });
  await page.screenshot({ path: 'shots/t9_announcing.png' });
  await page.waitForTimeout(500);
  const vp9 = ev(page, () => VORA.simulateVisitor(3000));
  await page.waitForFunction(() => document.getElementById('app').dataset.avatar === 'greeting', null, { timeout: 5000 }).catch(() => {});
  s = await ev(page, (text) => ({ cancelled: window.__speech.some((x) => x.ev === 'cancel' && text.replace(/\s+/g, ' ').includes(x.text.trim())), queued: VORA.S.queue.some((q) => q.text_th === text && q.resumed), avatar: document.getElementById('app').dataset.avatar }), ann);
  await vp9;
  await idle(page, 20000);
  const resumedWhilePresent = await ev(page, () => window.__speech.filter((x) => x.ev === 'start' && x.text.includes('ทดสอบประกาศข่าวยาว')).length);
  await ev(page, () => { VORA.simulateEmpty(7000); });
  await ev(page, () => { document.getElementById('tReset').click(); });
  await page.waitForFunction(() => window.__speech.filter((x) => x.ev === 'start' && x.text.includes('ทดสอบประกาศข่าวยาว')).length >= 2, null, { timeout: 30000 }).catch(() => {});
  const starts = await ev(page, () => window.__speech.filter((x) => x.ev === 'start' && x.text.includes('ทดสอบประกาศข่าวยาว')).length);
  rec(9, 'คนเข้ามาขณะประกาศข่าว → หยุดประกาศ ทักทาย แล้วประกาศต่อเมื่อคนออกไป', s.cancelled && s.queued && s.avatar === 'greeting' && resumedWhilePresent === 1 && starts >= 2, JSON.stringify({ ...s, resumedWhilePresent, starts }));
  await idle(page, 20000);

  // 10 มีคนเข้ามาขณะ AI กำลังตอบผู้ใช้ → ไม่ตัดคำตอบ
  await ev(page, () => { VORA.S.lastGreetAt = 0; });
  await page.fill('#askInput', 'สมัครเรียนยังไง');
  await page.press('#askInput', 'Enter');
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'speaking', null, { timeout: 10000 });
  const g2 = greetCount();
  await ev(page, () => VORA.simulateVisitor(2500));
  s = await ev(page, () => ({ cancel: window.__speech.slice(-6).some((x) => x.ev === 'cancel'), kind: VORA.im.kind }));
  await idle(page, 20000);
  rec(10, 'คนเข้ามาขณะ AI กำลังตอบ → ไม่ตัดคำตอบ ไม่ทักแทรก', !s.cancel && greetCount() === g2, JSON.stringify(s));
  await ev(page, () => VORA.simulateEmpty(7000));

  // 11 Gesture → ระบบ Interaction เดิม (ป้อนชื่อท่ามือเข้าตัวจัดการท่ามือของจริง)
  const before = page.reqs.filter((r) => r === 'POST /api/interaction').length;
  await ev(page, () => VORA.onGesture('Pointing_Up'));
  await page.waitForTimeout(1500);
  s = { interaction: page.reqs.filter((r) => r === 'POST /api/interaction').length - before, newsOpened: page.reqs.some((r) => /GET \/api\/news\/\d+/.test(r)) };
  await idle(page, 20000);
  rec(11, 'Gesture ☝️ ส่งเข้า /api/interaction และเปิดข่าวถัดไป (ชื่อท่าป้อนจำลอง)', s.interaction === 1 && s.newsOpened, JSON.stringify(s));

  // 14 QR Code
  await page.click('#qrBtn');
  s = await ev(page, () => ({ open: document.getElementById('qrSheet').open, svg: !!document.querySelector('#qrBox svg'), url: document.getElementById('qrUrl').textContent, mini: !!document.querySelector('#qrMini svg') }));
  const mob = await page.request.get(BASE + '/m/');
  await page.click('#qrClose');
  rec(14, 'QR Code แสดงได้ และหน้า /m/ เปิดได้', s.open && s.svg && s.mini && mob.status() === 200, JSON.stringify(s));

  // ประเมินความพึงพอใจ
  await page.click('.nav[data-nav="rate"]');
  await page.click('#stars button >> nth=4');
  await page.click('#rateSend');
  await page.waitForTimeout(600);
  rec('R', 'เมนูประเมินความพึงพอใจ ส่งคะแนนผ่าน /api/feedback', page.reqs.includes('POST /api/feedback'));

  // ภาษาอังกฤษ
  await page.click('.lang button[data-lang="en"]');
  await page.fill('#askInput', 'What programs do you offer?');
  await page.press('#askInput', 'Enter');
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'speaking', null, { timeout: 10000 });
  await idle(page, 20000);
  s = await ev(page, () => ({ title: document.querySelector('.nav[data-nav="programs"] span').textContent, sys: document.getElementById('sysText').textContent, lastBot: [...document.querySelectorAll('#messages .msg.bot')].pop().textContent.slice(0, 50) }));
  await page.screenshot({ path: 'shots/t_english.png' });
  rec('L', 'สลับภาษาอังกฤษ: หน้าจอ + คำตอบ AI เป็นอังกฤษ', s.title === 'Programs' && /program|Program|offer/i.test(s.lastBot), JSON.stringify(s));
  await page.click('.lang button[data-lang="th"]');

  // 15 Emergency stop (หุ่นจำลองกดปุ่มฉุกเฉิน) → แสดงสถานะจริงจาก WebSocket
  const tok = (await (await page.request.post(BASE + '/api/auth/login', { data: { username: 'admin', password: 'vora1234' } })).json()).token;
  await page.request.post(BASE + '/api/robot/sim/estop', { headers: { Authorization: 'Bearer ' + tok } });
  await page.waitForFunction(() => document.querySelector('#statusList [data-k="robot"]').classList.contains('bad'), null, { timeout: 8000 }).catch(() => {});
  s = await ev(page, () => ({ robot: document.querySelector('#statusList [data-k="robot"] .val').textContent, sys: document.getElementById('sysText').textContent, avatar: document.getElementById('app').dataset.avatar }));
  await page.screenshot({ path: 'shots/t15_estop.png' });
  await page.request.post(BASE + '/api/robot/estop-reset', { headers: { Authorization: 'Bearer ' + tok } });
  await page.waitForFunction(() => document.querySelector('#statusList [data-k="robot"]').classList.contains('ok'), null, { timeout: 8000 }).catch(() => {});
  const after = await ev(page, () => document.querySelector('#statusList [data-k="robot"] .val').textContent);
  rec(15, 'Emergency Stop: สถานะหุ่น/หัวจอ/อวตารเปลี่ยนตามจริง และกลับปกติหลังรีเซ็ต', /ฉุกเฉิน/.test(s.robot) && /ฉุกเฉิน/.test(s.sys) && s.avatar === 'error' && /พร้อม/.test(after), JSON.stringify({ ...s, after }));

  // 3 กล้องถูกถอด (จำลองเหตุการณ์ ended ของ track จริง) → เชื่อมต่อใหม่เอง
  await ev(page, () => { const tr = VORA.camera.vision.stream.getVideoTracks()[0]; tr.stop(); tr.dispatchEvent(new Event('ended')); });
  await page.waitForTimeout(300);
  const lost = await ev(page, () => ({ cam: VORA.S.cam, row: document.querySelector('#statusList [data-k="cam"] .val').textContent }));
  await page.screenshot({ path: 'shots/t3_camera_lost.png' });
  await page.waitForFunction(() => VORA.S.cam === 'on', null, { timeout: 12000 }).catch(() => {});
  s = await ev(page, () => ({ cam: VORA.S.cam, gum: window.__gum }));
  rec(3, 'กล้องหลุด → แสดงสถานะ แล้วเชื่อมต่อใหม่อัตโนมัติ (ไม่โหลดโมเดลซ้ำ)', lost.cam === 'lost' && s.cam === 'on' && s.gum === 2, JSON.stringify({ lost, ...s }));

  // ปิดกล้องโดยเจ้าหน้าที่ → หยุด track จริง และยังปิดอยู่หลังรีโหลด
  await page.click('#toolsBtn');
  await page.screenshot({ path: 'shots/t_tools.png' });
  await page.click('#tCamToggle');
  s = await ev(page, () => ({ cam: VORA.S.cam, stream: !!VORA.camera.vision.stream, live: !!document.getElementById('camVideo').srcObject }));
  await page.click('#toolsClose');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const afterReload = await ev(page, () => ({ cam: VORA.S.cam, gum: window.__gum }));
  await page.click('#toolsBtn'); await page.click('#tCamToggle');
  await page.waitForFunction(() => VORA.S.cam === 'on', null, { timeout: 15000 }).catch(() => {});
  const reOn = await ev(page, () => VORA.S.cam);
  await page.click('#toolsClose');
  rec('S', 'เจ้าหน้าที่ปิดกล้อง: หยุด track จริง จำค่าหลังรีโหลด และเปิดกลับได้', s.cam === 'staff-off' && !s.stream && !s.live && afterReload.cam === 'staff-off' && afterReload.gum === 0 && reOn === 'on', JSON.stringify({ s, afterReload, reOn }));

  // ซ่อน/แสดงแผง: ปุ่มในเครื่องมือ → โหมดว่าง, แตะจอ → กลับมา
  await page.click('#toolsBtn'); await page.click('#tPanels');
  await page.waitForFunction(() => VORA.ui.mode === 'idle', null, { timeout: 5000 }).catch(() => {});
  const pm1 = await ev(page, () => VORA.ui.mode);
  await page.mouse.click(683, 400);
  await page.waitForTimeout(300);
  const pm2 = await ev(page, () => VORA.ui.mode);
  rec('P', 'ซ่อนแผง (เข้าโหมดว่าง) และแตะจอเพื่อแสดงกลับได้', pm1 === 'idle' && pm2 === 'active', `${pm1} → ${pm2}`);

  // อวตารทุกสถานะ
  for (const st of ['idle', 'listening', 'thinking', 'speaking', 'greeting', 'announcing', 'happy', 'error']) {
    await ev(page, (x) => { VORA.avatar.setState(x); document.getElementById('app').dataset.avatar = x; }, st);
    await page.waitForTimeout(700);
    await page.locator('.stage').screenshot({ path: `shots/avatar_${st}.png` });
  }
  rec('A', 'อวตารจำลองแสดงได้ครบ 8 สถานะ', page.errors.length === 0, page.errors.join('; '));
  rec('E', 'ไม่มี JavaScript error ตลอดการทดสอบหน้า Kiosk หลัก', page.errors.length === 0, page.errors.join('; '));
  await ctx.close();
  await browser.close();

  // 2 ไม่ได้รับสิทธิ์กล้อง → แสดงคำแนะนำ และส่วนอื่นยังใช้งานได้
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream'] });
  ({ ctx, page } = await newPage(browser, { permissions: ['microphone'] }));
  await page.waitForTimeout(3000);
  s = await ev(page, () => ({ cam: VORA.S.cam, toast: document.getElementById('toast').textContent.slice(0, 40), row: document.querySelector('#statusList [data-k="cam"] .val').textContent }));
  await page.screenshot({ path: 'shots/t2_denied.png' });
  await page.fill('#askInput', 'มีทุนไหม'); await page.press('#askInput', 'Enter');
  const chatOk = await page.waitForFunction(() => document.querySelectorAll('#messages .msg.bot[data-mid]').length >= 1, null, { timeout: 10000 }).then(() => true).catch(() => false);
  rec(2, 'ไม่ได้รับสิทธิ์กล้อง → แจ้งคำแนะนำ ระบบอื่นยังใช้ได้', s.cam === 'denied' && /อนุญาต/.test(s.toast) && chatOk, JSON.stringify(s));
  await ctx.close(); await browser.close();

  // 3c ไม่มีกล้องในเครื่อง → แสดงไม่พบกล้อง และตั้งเวลาลองใหม่
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream'] });
  ({ ctx, page } = await newPage(browser));
  await page.waitForFunction(() => /ลองใหม่/.test(document.querySelector('#statusList [data-k="cam"] .val').textContent), null, { timeout: 8000 }).catch(() => {});
  s = await ev(page, () => ({ cam: VORA.S.cam, row: document.querySelector('#statusList [data-k="cam"] .val').textContent }));
  rec('3c', 'ไม่พบกล้อง → แสดงสถานะ และนับถอยหลังลองใหม่', ['not-found', 'error', 'in-use'].includes(s.cam) && /ลองใหม่/.test(s.row), JSON.stringify(s));
  await ctx.close(); await browser.close();

  require('fs').writeFileSync('shots/results.json', JSON.stringify(results, null, 2));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
})().catch((e) => { console.error('SCRIPT ERROR', e); require('fs').writeFileSync('shots/results.json', JSON.stringify(results, null, 2)); process.exit(1); });
