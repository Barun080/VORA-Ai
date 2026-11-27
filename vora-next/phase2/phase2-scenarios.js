// VORA NEXT — Phase 2 Gate Tests (Living Character & Vision Awareness)
// รันกับเซิร์ฟเวอร์ VORA จริง (start.bat): npm i playwright && mkdir shots && node phase2-scenarios.js
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
      this._timer = setTimeout(() => { this.speaking = false; this._cur = null; window.__speech.push({ text: u.text, ev: 'end' }); u.onend && u.onend(); }, Math.min(2500, 300 + u.text.length * 8)); },
    cancel() { if (this._cur) { clearTimeout(this._timer); const u = this._cur; this._cur = null; this.speaking = false; window.__speech.push({ text: u.text, ev: 'cancel' }); u.onerror && u.onerror({ error: 'interrupted' }); } } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
};

async function open(browser, w, h, extra = {}, query = '?debug=1', waitCam = true) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['camera', 'microphone'], ...extra });
  await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
  page.bodies = []; page.on('request', (r) => { if (r.url().includes('/api/') && r.method() === 'POST') page.bodies.push(r.url().replace(/^.*\/api/, '/api') + ' ' + (r.postData() || '')); });
  await page.goto(BASE + '/' + query, { waitUntil: 'networkidle' });
  await page.waitForFunction((wc) => window.VORA && VORA.orch && VORA.S.cfg && (!wc || VORA.S.cam === 'on'), waitCam, { timeout: 30000 });
  return { ctx, page };
}
const ev = (p, fn, a) => p.evaluate(fn, a);
const settle = (p) => p.waitForFunction(() => [...document.querySelectorAll('.hdr,.left,.right,.dock,.orb,#stage')].every((e) => e.getAnimations().filter((a) => a.constructor.name === 'CSSTransition').length === 0), null, { timeout: 15000, polling: 100 }).then(() => p.waitForTimeout(120));
const wake = async (p) => { await p.mouse.move(5, 200); await p.mouse.move(25, 230); await p.waitForFunction(() => VORA.ui.mode === 'active'); await settle(p); };
const idleNow = async (p) => { await ev(p, () => { VORA.orch.close('test'); VORA.ui.goIdle(); }); await settle(p); };
const greets = (p) => p.bodies.filter((b) => b.startsWith('/api/greet')).length;
// ป้อนกล่องใบหน้าจำลองจนกว่าระบบจะยืนยันผู้เข้าชม (เครื่องไม่มี GPU: MediaPipe บล็อก main thread ได้ถึง 1–5 วิ
// การป้อนแบบกำหนดเวลาตายตัวจึงอาจได้แค่ 1–2 เฟรม) แล้วยืนต่ออีก holdMs
const present = (p, holdMs = 0, boxes) => p.evaluate(async ({ holdMs, boxes }) => {
  const b = boxes || [{ x: 0.4, y: 0.3, w: 0.2, h: 0.26 }]; const s = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now();
  while (!VORA.tracker.session && performance.now() - t0 < 15000) { VORA.tracker.update(b, performance.now()); await s(150); }
  const ok = !!VORA.tracker.session; const end = performance.now() + holdMs;
  while (performance.now() < end) { VORA.tracker.update(b, performance.now()); await s(150); }
  return ok;
}, { holdMs, boxes });
const absent = (p) => p.evaluate(async () => {
  const s = (ms) => new Promise((r) => setTimeout(r, ms)); const t0 = performance.now();
  while (VORA.tracker.session && performance.now() - t0 < 20000) { VORA.tracker.update([], performance.now()); await s(200); }
  return !VORA.tracker.session;
});
const quiet = (p) => p.waitForFunction(() => VORA.S.state === 'idle' && !VORA.im.current, null, { timeout: 20000 }).catch(() => {});

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const { ctx, page } = await open(browser, 1600, 900);
  const av = (fn, a) => ev(page, fn, a);

  // ------------------------------------------------ 1 Avatar Adapter Interface
  const ad = await av(async () => {
    const { missingAdapterMethods, AVATAR_ADAPTER_METHODS } = await import('/avatar/AvatarAdapter.js');
    const a = VORA.avatar;
    return { missing: missingAdapterMethods(a), n: AVATAR_ADAPTER_METHODS.length, cap: a.capabilities() };
  });
  rec(1, 'Avatar Adapter: AvatarController มีคำสั่งครบตามสัญญา (loadCharacter, setState, setExpression, playAnimation, setGaze, setSpeech, setVisibility, dispose, capabilities)', ad.missing.length === 0 && ad.n === 9,
    `missing=${JSON.stringify(ad.missing)} kind=${ad.cap.kind}`);
  const want = ['idle', 'greeting', 'listening', 'thinking', 'speaking', 'presenting', 'pointing', 'waving', 'thanking', 'happy'];
  rec('1b', 'capabilities(): สถานะมาตรฐาน 10 แบบ + ท่าทาง + สีหน้า + Lip Sync', want.every((s) => ad.cap.states.includes(s)) && ad.cap.animations.includes('wave') && ad.cap.expressions.length === 3 && ad.cap.lipSync === 'level', JSON.stringify(ad.cap));

  // 2 สถานะทั้ง 10 แบบแสดงได้จริง (Renderer รับสถานะ + ท่าเข้า)
  // อ่านผลทันทีหลัง setState (ระบบหลักที่เชื่อม Event อยู่จะกำหนดสถานะใหม่ตามเหตุการณ์ถัดไป ตามที่ออกแบบ)
  const st = await av((list) => Object.fromEntries(list.map((s) => { VORA.avatar.gestureName = null; VORA.avatar.setState(s); return [s, { state: VORA.avatar.state, gesture: VORA.avatar.gestureName }]; })), want);
  await av(() => VORA.avatar.setState('thanking'));
  await page.screenshot({ path: 'shots/p2_state_thanking.png' });
  const enter = { presenting: 'present', pointing: 'point_screen', waving: 'wave', thanking: 'bow', greeting: 'wave' };
  rec(2, 'setState: ทั้ง 10 สถานะเปลี่ยนได้ และสถานะใหม่เล่นท่าเข้าที่ถูกต้อง', want.every((s) => st[s].state === s) && Object.entries(enter).every(([s, g]) => st[s].gesture === g), JSON.stringify(st));
  await av(() => VORA.avatar.refresh());

  // 3 playAnimation / setExpression: ท่าที่ไม่มีจริงต้องรายงาน supported:false
  const pa = await av(() => ({ ok: VORA.avatar.playAnimation('wave'), bad: VORA.avatar.playAnimation('backflip'), ex: VORA.avatar.setExpression('happy'), exBad: VORA.avatar.setExpression('angry') }));
  rec(3, 'playAnimation/setExpression: ท่าที่มี → supported:true, ท่าที่ไม่มี → supported:false (ไม่แสดงว่าเล่นสำเร็จ)', pa.ok.supported && pa.ok.durationMs > 0 && !pa.bad.supported && pa.ex.supported && !pa.exBad.supported && pa.exBad.expression === 'neutral', JSON.stringify(pa));

  // 4 setGaze / setSpeech / setVisibility
  const gz = await av(async () => {
    const a = VORA.avatar; const s = (ms) => new Promise((r) => setTimeout(r, ms));
    const tgt = a.setGaze(0.8, -0.2); const l0 = a.look.x; await s(1500); const look = { target: tgt.x, x: a.look.x, moved: a.look.x - l0 };
    a.setSpeech({ text: 'ทดสอบกล่องคำพูด', level: 0.7 }); const bubble = document.getElementById('caption').textContent; const mouth = a.mouthLevel;
    a.setSpeech({ text: '', level: 0 });
    let calls = 0; const orig = a.renderer.render.bind(a.renderer); a.renderer.render = (p) => { calls++; return orig(p); };
    a.setVisibility(false); await s(400); const hiddenCalls = calls; const vis = getComputedStyle(document.getElementById('avatar')).visibility;
    a.setVisibility(true); await s(400); const shownCalls = calls - hiddenCalls;
    a.renderer.render = orig; a.setGaze(0, 0);
    return { look, bubble, mouth, hiddenCalls, vis, shownCalls };
  });
  rec(4, 'setGaze มองตามทิศ, setSpeech แสดงคำพูด+ระดับปาก, setVisibility ซ่อนแล้วหยุดวาด/แสดงแล้ววาดต่อ', gz.look.target === 0.8 && gz.look.moved > 0.1 && gz.bubble === 'ทดสอบกล่องคำพูด' && gz.mouth === 0.7 && gz.hiddenCalls === 0 && gz.vis === 'hidden' && gz.shownCalls > 0, JSON.stringify(gz));

  // 5 ลำดับความสำคัญ: สถานะนำเสนอไม่ทับ ฟัง/คิด และไม่ทับการแจ้งเตือนขัดข้อง
  const pr = await av(async () => {
    const b = VORA.bus, a = VORA.avatar, out = {}; const s = (ms) => new Promise((r) => setTimeout(r, ms));
    b.emit('avatar:hint', { state: 'presenting' }); out.idle = a.state;
    b.emit('avatar:thinking'); out.thinking = a.state;
    b.emit('avatar:listening'); out.listening = a.state;
    b.emit('avatar:speaking', { kind: 'conversation' }); out.speaking = a.state; out.talking = a.talking;
    b.emit('avatar:hint', { state: 'pointing', ms: 500 }); out.pointing = a.state;
    await s(700); out.afterPointing = a.state;
    b.emit('avatar:idle'); b.emit('avatar:alert', { error: true }); out.alert = a.state;
    b.emit('avatar:alert', { error: false }); out.afterAlert = a.state;
    b.emit('avatar:hint', { state: null }); out.cleared = a.state;
    return out;
  });
  rec(5, 'ลำดับสถานะ: presenting < คิด/ฟัง, พูดในท่านำเสนอ (ปากขยับ), pointing ชั่วคราวแล้วกลับ presenting, ขัดข้องทับได้, ล้างแล้วกลับ idle',
    pr.idle === 'presenting' && pr.thinking === 'thinking' && pr.listening === 'listening' && pr.speaking === 'presenting' && pr.talking && pr.pointing === 'pointing' && pr.afterPointing === 'presenting' && pr.alert === 'error' && pr.afterAlert === 'presenting' && pr.cleared === 'idle', JSON.stringify(pr));

  // 6 เชื่อมกับระบบ: โหมดนำเสนอ → presenting, รายละเอียด → pointing, ประเมิน → thanking
  await wake(page);
  await page.click('.orb[data-section="departments"]');
  await page.waitForSelector('#present .pcard[data-id]');
  await quiet(page);
  const inPres = await av(() => document.getElementById('app').dataset.avatar);
  await page.click('#present .pcard[data-id]');
  await page.waitForFunction(() => document.getElementById('app').dataset.avatar === 'pointing' || VORA.avatar.activeHint() === 'pointing', null, { timeout: 4000 }).catch(() => {});
  const ptr = await av(() => VORA.avatar.activeHint());
  await page.screenshot({ path: 'shots/p2_presenting.png' });
  await page.click('.present-close');
  await quiet(page);
  const afterClose = await av(() => ({ hint: VORA.avatar.activeHint(), avatar: document.getElementById('app').dataset.avatar }));
  await wake(page);
  await av(() => document.querySelector('.nav[data-nav="rate"]').click());
  await page.click('#stars button:nth-child(5)');
  await page.click('#rateSend');
  const thank = await page.waitForFunction(() => VORA.avatar.activeHint() === 'thanking', null, { timeout: 4000 }).then(() => true).catch(() => false);
  rec(6, 'ใช้งานจริง: เปิดนำเสนอ → presenting, เปิดรายละเอียด → pointing, ปิด → ล้างสถานะ, ส่งแบบประเมิน → thanking', inPres === 'presenting' && ptr === 'pointing' && afterClose.hint === null && thank, JSON.stringify({ inPres, ptr, afterClose, thank }));
  await page.waitForTimeout(2800);

  // ------------------------------------------------ 7–11 Vision Awareness
  await quiet(page);
  await idleNow(page);
  // เริ่มบทสนทนาใหม่ (phase = attract) — ระบบเดิมไม่ทักทายแทรกระหว่างที่ยังมีบทสนทนาค้างอยู่
  await av(() => { document.getElementById('tReset').click(); VORA.S.cfg.greeting_cooldown_s = 2; VORA.S.lastGreetAt = 0; VORA.tracker.end(); VORA.bus.log.length = 0; });
  const g0 = greets(page);
  await present(page, 0);
  const det = await av(() => ({ session: VORA.tracker.snapshot().session, log: VORA.bus.log.map((x) => x.type).filter((t) => t.startsWith('visitor')) }));
  rec(7, 'Person Detection: ตรวจพบผู้เข้าชม → Visitor Session ชั่วคราว + VISITOR_DETECTED', !!det.session && /^V\d+$/.test(det.session.id) && det.log.includes('visitor:detected'), JSON.stringify(det));
  // ยืนอยู่ต่อ 9 วิ (นานกว่าคูลดาวน์ 2 วิ หลายเท่า) → ทักครั้งเดียว
  await present(page, 9000);
  await quiet(page);
  const g1 = greets(page) - g0;
  rec(8, 'Greeting ไม่ซ้ำ: คนเดิมยืนอยู่นานกว่าคูลดาวน์ 4 เท่า → ทักทายครั้งเดียว', g1 === 1, `greets=${g1}`);

  // 9 Smart Greeting: แนะนำหมวดจากข้อมูลจริง + ข้อความแนะนำในโหมดว่าง + อวตารหันไปทางผู้เข้าชม
  const sg = await av(() => ({ suggested: [...document.querySelectorAll('.orb.suggested')].map((b) => b.dataset.section), hint: document.querySelector('#idleHint span:last-child').textContent, mode: VORA.ui.mode }));
  const hasAdmission = await av(async () => (await (await fetch('/api/news?limit=20')).json()).some((n) => n.kind === 'admission'));
  const expectSug = hasAdmission ? ['departments', 'admission'] : ['departments', 'news'];
  // อ่านทิศเป้าหมายทันทีหลังส่ง Event (กล้องเสมือนของ Chrome อาจตรวจเจอใบหน้าหลอกแล้วตั้งทิศใหม่ภายหลัง)
  const gazeX = await av(() => { VORA.bus.emit('camera:face', { x: -0.7, y: 0 }); return VORA.avatar.lookTarget.x; });
  await page.screenshot({ path: 'shots/p2_smart_greeting_idle.png' });
  rec(9, 'Smart Greeting: หลังทักทายแนะนำหมวดตามข้อมูลจริง (ไฮไลต์เมนู + ข้อความในโหมดว่าง) และอวตารหันไปทางผู้เข้าชม',
    JSON.stringify(sg.suggested.sort()) === JSON.stringify(expectSug.sort()) && /แนะนำ/.test(sg.hint) && sg.mode === 'idle' && gazeX < -0.4, JSON.stringify({ ...sg, hasAdmission, gazeX: +gazeX.toFixed(2) }));
  await wake(page);
  await page.screenshot({ path: 'shots/p2_smart_greeting_active.png' });

  // 10 คนออก → Session จบ อวตารมองตรง · กลับมาภายในคูลดาวน์ไม่ทักซ้ำ · พ้นคูลดาวน์ = คนใหม่ ทักใหม่
  // วัดทิศที่มอง "ทันทีที่ผู้เข้าชมออก" (กล้องเสมือนของ Chrome อาจตรวจเจอใบหน้าหลอกภายหลังแล้วตั้งทิศใหม่)
  await av(() => { const off = VORA.bus.on('visitor:left', () => { setTimeout(() => { window.__lookAtLeave = VORA.avatar.lookTarget.x; off(); }, 0); }); });
  await absent(page);
  const left = await av(() => ({ session: VORA.tracker.snapshot().session, tracks: VORA.tracker.snapshot().tracks.length, lookT: window.__lookAtLeave }));
  // คูลดาวน์ 10 วิ (มากกว่าความหน่วงของเครื่องทดสอบ) — กลับมาทันที = คนเดิม, รอเกิน 10 วิ = คนใหม่
  await av(() => { document.getElementById('tReset').click(); VORA.S.cfg.greeting_cooldown_s = 10; });
  const g2 = greets(page);
  await present(page, 500);
  await quiet(page);
  const returned = greets(page) - g2;
  await absent(page);
  await page.waitForTimeout(11000);
  await av(() => document.getElementById('tReset').click());
  await present(page, 500);
  await quiet(page);
  const fresh = greets(page) - g2;
  rec(10, 'Presence Session: ออก → ปิด Session ล้าง Tracking ID มองตรง · กลับในคูลดาวน์ไม่ทัก · พ้นคูลดาวน์ทักใหม่', left.session === null && left.tracks === 0 && left.lookT === 0 && returned === 0 && fresh === 1, JSON.stringify({ left, returned, fresh }));
  await absent(page);

  // 11 Multi-Person: ทักครั้งเดียวด้วยข้อความกลาง
  await page.waitForTimeout(2600);
  await page.waitForTimeout(11000);
  await av(() => { document.getElementById('tReset').click(); VORA.S.cfg.greeting_cooldown_s = 2; });
  const g3 = greets(page);
  await present(page, 1500, [{ x: .08, y: .3, w: .17, h: .23 }, { x: .4, y: .3, w: .18, h: .24 }, { x: .7, y: .32, w: .17, h: .23 }]);
  await page.waitForFunction(() => /ทุกคน/.test(document.getElementById('caption').textContent), null, { timeout: 8000 }).catch(() => {});
  const mp = await av(() => ({ max: VORA.tracker.session && VORA.tracker.session.maxPeople, caption: document.getElementById('caption').textContent.slice(0, 30) }));
  await quiet(page);
  const mpGreets = greets(page) - g3;
  const greetBody = page.bodies.filter((b) => b.startsWith('/api/greet')).pop() || '';
  rec(11, 'หลายคน: ตรวจนับได้ 3 คน ทักครั้งเดียวด้วยข้อความกลาง ("ทุกคน") ไม่ระบุตัวบุคคล', mp.max === 3 && mpGreets === 1 && /ทุกคน/.test(mp.caption) && /"people":3/.test(greetBody), JSON.stringify({ ...mp, greets: mpGreets, body: greetBody.slice(0, 120) }));
  await absent(page);

  // 12 ไม่มีการระบุตัวบุคคล: ไม่มีภาพ/Embedding ใบหน้าใน Request, Storage หรือ Session
  const priv = await av(() => {
    const store = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    const snap = JSON.stringify(VORA.tracker.snapshot());
    return { store: store.length, storeHasImage: /data:image|embedding|landmark|descriptor/i.test(store), snapKeys: snap };
  });
  const leak = page.bodies.filter((b) => /data:image|base64|embedding|landmark|descriptor|face_?id/i.test(b));
  rec(12, 'ไม่มีการระบุตัวบุคคล: ไม่มีภาพ/Embedding/Landmark ใบหน้าใน Request ที่ส่งออก, Storage หรือ Visitor Session', leak.length === 0 && !priv.storeHasImage && !/x"|cx|embedding/.test(priv.snapKeys), JSON.stringify({ requests: page.bodies.length, leak: leak.length, ...priv }));

  // ------------------------------------------------ 13–16 Camera Lifecycle + Privacy Pause
  await quiet(page);
  await wake(page);
  const c0 = await av(() => ({ gum: window.__gum, vt: document.getElementById('camVideo').currentTime }));
  for (let i = 0; i < 3; i++) { await idleNow(page); await wake(page); await av(() => VORA.bus.emit('experience:open', { section: 'news' })); await page.waitForTimeout(150); await av(() => VORA.orch.close('t')); }
  const c1 = await av(() => { const v = document.getElementById('camVideo'); const tr = v.srcObject && v.srcObject.getVideoTracks()[0]; return { gum: window.__gum, vt: v.currentTime, track: tr && tr.readyState, running: VORA.cam.camera.running }; });
  rec(13, 'Camera Stream ต่อเนื่องและไม่เปิดซ้ำ ระหว่างสลับโหมด', c1.gum === c0.gum && c1.track === 'live' && c1.vt > c0.vt && c1.running, JSON.stringify({ c0, c1 }));

  await av(() => { VORA.config.camera.privacyPauseMs = 4000; });
  await page.click('#camPill');
  await page.waitForFunction(() => VORA.S.cam === 'paused', null, { timeout: 5000 }).catch(() => {});
  const pz = await av(() => { const v = document.getElementById('camVideo'); const tr = v.srcObject && v.srcObject.getVideoTracks && v.srcObject.getVideoTracks()[0];
    return { cam: VORA.S.cam, track: tr ? tr.readyState : 'none', running: VORA.cam.camera.running, session: VORA.tracker.snapshot().session, pill: document.getElementById('camSub').textContent, pressed: document.getElementById('camPill').getAttribute('aria-pressed'), row: document.querySelector('#statusList [data-k="cam"] .val').textContent }; });
  await page.screenshot({ path: 'shots/p2_privacy_paused_active.png' });
  await idleNow(page);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('camBadge')).opacity === '1', null, { timeout: 8000 }).catch(() => {});
  const badge = await av(() => { const b = document.getElementById('camBadge'); return { shown: !b.hidden && getComputedStyle(b).opacity === '1', text: b.textContent.trim() }; });
  await page.screenshot({ path: 'shots/p2_privacy_paused_idle.png' });
  rec(14, 'Privacy Pause (หัวจอ): กล้องหยุดจริง (track ไม่ live, MediaPipe หยุด) ล้าง Session แสดงสถานะ + นับถอยหลังทั้งหัวจอ แผงสถานะ และป้ายในโหมดว่าง',
    pz.cam === 'paused' && pz.track !== 'live' && !pz.running && pz.session === null && /กลับมาใน/.test(pz.pill) && pz.pressed === 'true' && /พัก/.test(pz.row) && badge.shown && /พักกล้อง/.test(badge.text), JSON.stringify({ ...pz, badge }));
  const back = await page.waitForFunction(() => VORA.S.cam === 'on', null, { timeout: 15000 }).then(() => true).catch(() => false);
  const c2 = await av(() => ({ gum: window.__gum, running: VORA.cam.camera.running }));
  rec(15, 'Privacy Pause: ครบเวลาแล้วกล้องกลับมาเอง เปิดใหม่ 1 ครั้ง (ไม่ซ้อน)', back && c2.gum === c1.gum + 1 && c2.running, JSON.stringify({ back, gumBefore: c1.gum, ...c2 }));
  // พัก/เปิดด้วยป้ายในโหมดว่าง (แตะอีกครั้งเพื่อเปิดทันที) + ระหว่างพักไม่มีการตรวจจับ
  await idleNow(page);
  const badgeReady = await page.waitForFunction(() => VORA.ui.mode === 'idle' && getComputedStyle(document.getElementById('camBadge')).opacity === '1', null, { timeout: 8000 }).then(() => true).catch(() => false);
  if (!badgeReady) console.log('DEBUG badge', await av(() => JSON.stringify({ mode: VORA.ui.mode, cam: VORA.S.cam, hidden: document.getElementById('camBadge').hidden, op: getComputedStyle(document.getElementById('camBadge')).opacity, busy: VORA.ui.busy() })));
  await page.click('#camBadge', { timeout: 8000 }).catch(() => {});
  const pausedByBadge = await page.waitForFunction(() => VORA.S.cam === 'paused', null, { timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(500);   // เฟรมสุดท้ายที่ประมวลผลค้างอยู่ก่อนหยุด
  const faces0 = await av(() => VORA.cam.stats.faceFrames);
  await page.waitForTimeout(2000);
  const faces1 = await av(() => VORA.cam.stats.faceFrames);
  await wake(page);
  await page.click('#camPill');
  const resumed = await page.waitForFunction(() => VORA.S.cam === 'on', null, { timeout: 15000 }).then(() => true).catch(() => false);
  rec(16, 'Privacy Pause (ป้ายโหมดว่าง): พักได้ ระหว่างพักไม่ประมวลผลภาพ และแตะอีกครั้งเปิดกล้องทันที', pausedByBadge && faces1 === faces0 && resumed, JSON.stringify({ badgeReady, pausedByBadge, faces0, faces1, resumed }));
  rec('E', 'ไม่มี JavaScript error ตลอดการทดสอบหลัก', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();

  // ------------------------------------------------ 17 Permission Denied: ระบบอื่นยังใช้ได้ ป้ายพักกล้องไม่แสดง
  {
    // เบราว์เซอร์แยกที่ไม่มี --use-fake-ui-for-media-stream (ธงนั้นอนุญาตกล้องให้อัตโนมัติ)
    const plain = await chromium.launch({ args: ['--use-fake-device-for-media-stream'] });
    const c = await plain.newContext({ viewport: { width: 1366, height: 768 }, permissions: [] });
    await c.addInitScript(init);
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
    await p.waitForFunction(() => window.VORA && VORA.S.cfg && ['denied', 'not-found', 'error'].includes(VORA.S.cam), null, { timeout: 30000 }).catch(() => {});
    const d = await p.evaluate(() => ({ cam: VORA.S.cam, badge: document.getElementById('camBadge').hidden }));
    await p.mouse.move(10, 300); await p.mouse.move(30, 320); await p.waitForFunction(() => VORA.ui.mode === 'active');
    await p.click('#camPill');
    const tools = await p.evaluate(() => document.getElementById('toolsSheet').open);
    await p.evaluate(() => document.getElementById('toolsSheet').close());
    await p.fill('#askInput', 'มีสาขาอะไรบ้าง'); await p.press('#askInput', 'Enter');
    const chat = await p.waitForFunction(() => document.querySelectorAll('#messages .msg.bot').length >= 1 && /ค่า|สาขา|ปวช|บาท|เทอม/.test(document.querySelector('#messages .msg.bot:last-child')?.textContent || ''), null, { timeout: 15000 }).then(() => true).catch(() => false);
    await plain.close();
    rec(17, 'ไม่ได้รับสิทธิ์กล้อง: แสดงสถานะ ไม่มีปุ่มพักกล้อง แตะป้ายกล้องเปิดแผงช่วยเหลือ และถาม-ตอบยังใช้ได้', d.cam === 'denied' && d.badge && tools && chat && errs.length === 0, JSON.stringify({ ...d, tools, chat, errs }));
  }

  // ------------------------------------------------ 18 เปลี่ยนตัวละคร (เส้นทาง PSD) โดยไม่แก้ระบบหลัก
  {
    const { ctx: c, page: p } = await open(browser, 1366, 768);
    const r = await p.evaluate(async () => {
      const a = VORA.avatar; const out = {};
      out.bad = await a.loadCharacter({ renderer: 'layered', manifest: '/assets/avatar/does-not-exist.json' });
      out.afterBad = a.kind;
      out.good = await a.loadCharacter({ renderer: 'layered', manifest: '/assets/avatar/example-layers/manifest.json' });
      out.images = document.querySelectorAll('#avatar svg image').length;
      a.setState('presenting'); out.state = a.state; out.anim = a.playAnimation('wave').supported;
      out.cap = a.capabilities().kind;
      return out;
    });
    await p.waitForTimeout(400);
    await p.screenshot({ path: 'shots/p2_layered_avatar.png' });
    await p.fill('#askInput', 'ค่าเทอมเท่าไหร่'); await p.press('#askInput', 'Enter');
    const chat = await p.waitForFunction(() => document.querySelectorAll('#messages .msg.bot').length >= 1 && /ค่า|สาขา|ปวช|บาท|เทอม/.test(document.querySelector('#messages .msg.bot:last-child')?.textContent || ''), null, { timeout: 15000 }).then(() => true).catch(() => false);
    await wake(p);
    const g = await p.evaluate(() => ({ layout: VORA.menu.layoutMode, svgH: document.querySelector('#avatar svg').getBoundingClientRect().height }));
    const back = await p.evaluate(async () => { const r = await VORA.avatar.loadCharacter({ renderer: 'placeholder' }); return { ...r, images: document.querySelectorAll('#avatar svg image').length }; });
    rec(18, 'loadCharacter: โหลดไม่ได้ → ใช้ตัวเดิมต่อ (fallback) · โหลดชุดเลเยอร์ PSD ได้ · AI/เมนูทำงานเหมือนเดิม · กลับเป็นตัวจำลองได้',
      r.bad.fallback && r.afterBad === 'placeholder' && r.good.ok && r.good.kind === 'layered' && r.images > 10 && r.state === 'presenting' && r.anim && r.cap === 'layered' && chat && g.layout === 'orbital' && back.ok && back.images === 0 && p.errors.length === 0,
      JSON.stringify({ ...r, chat, ...g, back, errs: p.errors }));
    await c.close();
  }

  // ------------------------------------------------ 19 dispose(): คืนทรัพยากร
  {
    const { ctx: c, page: p } = await open(browser, 1366, 768);
    const r = await p.evaluate(async () => {
      const a = VORA.avatar; const b = VORA.bus; const before = b.listenerCount();
      let calls = 0; const orig = a.renderer.render.bind(a.renderer); a.renderer.render = (x) => { calls++; return orig(x); };
      a.dispose(); const after = b.listenerCount(); await new Promise((r) => setTimeout(r, 400));
      return { before, after, calls };
    });
    rec(19, 'dispose(): ยกเลิก Event ของอวตารทั้งหมด และหยุดวงรอบวาด', r.after < r.before && r.calls === 0, JSON.stringify(r));
    await c.close();
  }

  await browser.close();
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync('phase2-test-results.json', JSON.stringify({ date: new Date().toISOString(), pass, total: results.length, results }, null, 2));
})();
