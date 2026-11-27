// VORA NEXT — Phase 5 Gate 5D (Time Portal) — ส่วนหน้าจอ
// ส่วนข้อมูล (กลุ่มเวลา, วันสำคัญ, ช่วงเผยแพร่) ทดสอบใน backend/tests/test_timeline.py · หลังบ้าน/API ใน test_news_location.py
// รัน (ฐานข้อมูลทดสอบเท่านั้น — สคริปต์นี้สร้างข่าวทดสอบผ่าน API หลังบ้าน): node phase5-scenarios.js
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.VORA_URL || 'http://localhost:8000';
const results = [];
const rec = (id, name, pass, note = '') => { results.push({ id, name, pass: !!pass, note }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} ${note}`); };
const init = () => {
  window.__speech = [];
  const synth = { _cur: null, _timer: null, speaking: false, onvoiceschanged: null, getVoices: () => [],
    speak(u) { this._cur = u; this.speaking = true; window.__speech.push({ text: u.text, ev: 'start' });
      this._timer = setTimeout(() => { this.speaking = false; this._cur = null; window.__speech.push({ text: u.text, ev: 'end' }); u.onend && u.onend(); }, Math.min(1500, 200 + u.text.length * 6)); },
    cancel() { if (this._cur) { clearTimeout(this._timer); const u = this._cur; this._cur = null; this.speaking = false; u.onerror && u.onerror({ error: 'interrupted' }); } } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
};
const j = async (url, opt = {}) => { const r = await fetch(BASE + url, { ...opt, headers: { 'content-type': 'application/json', ...(opt.headers || {}) } }); return { status: r.status, body: await r.json() }; };

async function open(browser, w, h, path = '/?debug=1') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.VORA && VORA.orch && VORA.S.cfg && VORA.S.cam === 'on', null, { timeout: 30000 });
  return { ctx, page };
}
const wake = async (p) => { await p.mouse.move(5, 200); await p.mouse.move(25, 230); await p.waitForFunction(() => VORA.ui.mode === 'active'); await p.waitForTimeout(800); };
const openPortal = async (p) => {
  await p.click('.orb[data-section="news"]');
  await p.waitForSelector('#present [data-open-timeline]', { timeout: 10000 });
  await p.click('#present [data-open-timeline]');
  await p.waitForSelector('#present .tp-item, #present .present-state.empty', { timeout: 10000 });
  await p.waitForTimeout(700);
};
const listed = (p) => p.evaluate(() => [...document.querySelectorAll('#present .tp-g')].map((g) => ({ g: g.dataset.group, ids: [...g.querySelectorAll('[data-tp]')].map((b) => +b.dataset.tp) })));
const itemText = (p, id, grp) => p.evaluate(([x, g]) => { const b = document.querySelector(`#present .tp-g[data-group="${g}"] [data-tp="${x}"]`); return b ? b.innerText : null; }, [id, grp]);

(async () => {
  const tok = (await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'vora1234' }) })).body.token;
  const H = { Authorization: `Bearer ${tok}` };
  const tl0 = (await j('/api/timeline')).body;
  const today = tl0.today;
  const day = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const mk = async (b) => (await j('/api/admin/news', { method: 'POST', headers: H, body: JSON.stringify({ status: 'published', ...b }) })).body.id;
  const ids = {
    campus: await mk({ kind: 'activity', title_th: 'P5 ทดสอบ: แนะแนวในหอประชุม', body_th: 'กิจกรรมแนะแนว', event_date: `${day(2)}T13:30:00`, location_type: 'campus', location: 'หอประชุมวิทยาลัย' }),
    external: await mk({ kind: 'activity', title_th: 'P5 ทดสอบ: นิทรรศการภายนอก', event_date: `${day(3)}T09:00:00`, location_type: 'external', location: 'ศูนย์การค้าตัวอย่าง', location_map_url: 'https://maps.google.com/?q=example' }),
    online: await mk({ kind: 'admission', title_th: 'P5 ทดสอบ: ประชุมผู้ปกครองออนไลน์', event_date: `${day(5)}T19:00:00`, location_type: 'online', location: 'Facebook Live เพจวิทยาลัย' }),
    prio5: await mk({ kind: 'news', title_th: 'P5 ทดสอบ: ข่าวสำคัญที่ไม่ใช่รับสมัคร', priority: 5, event_date: `${day(4)}T00:00:00` }),
    draft: await mk({ kind: 'admission', title_th: 'P5 ทดสอบ: ฉบับร่าง', status: 'draft', event_date: `${day(2)}T10:00:00` }),
  };
  const old = (tl0.upcoming[0] || tl0.today_items[0] || tl0.past[0]);   // ข่าวเดิมจากฐานข้อมูล (00:00 · ไม่มีสถานที่)
  const tl = (await j('/api/timeline')).body;

  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const { ctx, page } = await open(browser, 1600, 900);
  await wake(page);
  await openPortal(page);
  await page.screenshot({ path: 'shots/p5_portal.png' });
  const L = await listed(page);
  const api = [['important', tl.important], ['today', tl.today_items], ['upcoming', tl.upcoming], ['past', tl.past], ['undated', tl.undated]]
    .filter(([, a]) => a.length).map(([g, a]) => ({ g, ids: a.map((x) => x.id) }));
  rec(1, 'เปิดปฏิทินกิจกรรมจากหมวดข่าว: กลุ่มและลำดับรายการตรงกับ /api/timeline ทุกกลุ่ม', JSON.stringify(L) === JSON.stringify(api), JSON.stringify(L.map((x) => `${x.g}:${x.ids.length}`)));

  const all = L.flatMap((x) => x.ids);
  rec(2, 'ข่าวฉบับร่างไม่แสดง · ข่าว priority 5 ที่ไม่ใช่รับสมัครไม่อยู่ในวันสำคัญ · รับสมัครออนไลน์ภายใน 60 วันอยู่ในวันสำคัญ',
    !all.includes(ids.draft) && !L.find((x) => x.g === 'important')?.ids.includes(ids.prio5) && L.find((x) => x.g === 'important')?.ids.includes(ids.online),
    JSON.stringify(L.find((x) => x.g === 'important')));

  const tOld = old ? await itemText(page, old.id, 'upcoming') || await itemText(page, old.id, 'today') || await itemText(page, old.id, 'past') : null;
  const tCampus = await itemText(page, ids.campus, 'upcoming');
  const tOnline = await itemText(page, ids.online, 'upcoming');
  rec(3, 'ข่าวเดิม (เวลา 00:00 ไม่มีสถานที่) แสดง "ไม่ระบุเวลา" และ "ไม่ระบุสถานที่" · ข่าวที่มีข้อมูลแสดงเวลาและสถานที่จริง · ออนไลน์แสดงช่องทาง',
    !!tOld && tOld.includes('ไม่ระบุเวลา') && tOld.includes('ไม่ระบุสถานที่') && tCampus.includes('13:30') && tCampus.includes('หอประชุมวิทยาลัย') && tCampus.includes('ภายในวิทยาลัย')
      && tOnline.includes('ออนไลน์') && tOnline.includes('Facebook Live') && tOnline.includes('19:00'),
    JSON.stringify({ tOld, tCampus, tOnline }).replace(/\\n/g, ' | '));

  // 4 รายละเอียด + เสียงบรรยาย (สถานที่ภายนอก มี QR แผนที่)
  await page.evaluate(() => { window.__speech = []; });
  await page.click(`#present .tp-g[data-group="upcoming"] [data-tp="${ids.external}"]`);
  await page.waitForSelector('#present .tp-detail');
  await page.waitForTimeout(1200);
  const d1 = await page.evaluate(() => ({ text: document.querySelector('#present .tp-detail').innerText, qrs: document.querySelectorAll('#present .tp-qr svg').length, map: !!document.querySelector('#present .tp-qr.map svg'),
    speech: window.__speech.filter((s) => s.ev === 'start').map((s) => s.text).join(' '), title: document.querySelector('.present-title').textContent }));
  await page.screenshot({ path: 'shots/p5_detail_external.png' });
  rec(4, 'รายละเอียดสถานที่ภายนอก: วันที่ เวลา 09:00 สถานที่ · QR รายละเอียด + QR แผนที่ · VORA พูดเวลาและสถานที่',
    d1.text.includes('09:00') && d1.text.includes('ศูนย์การค้าตัวอย่าง') && d1.qrs === 2 && d1.map && d1.speech.includes('ศูนย์การค้าตัวอย่าง') && d1.speech.includes('09:00'),
    JSON.stringify({ qrs: d1.qrs, speech: d1.speech.slice(0, 140) }));

  // 5 ออนไลน์: ไม่มี QR แผนที่ เสียงบอกว่าออนไลน์ · ข่าวเดิม: เสียงไม่พูดเวลาหรือสถานที่
  await page.click('#present .tp-back');
  await page.evaluate(() => { window.__speech = []; });
  await page.click(`#present .tp-g[data-group="important"] [data-tp="${ids.online}"]`);
  await page.waitForSelector('#present .tp-detail'); await page.waitForTimeout(1200);
  const d2 = await page.evaluate(() => ({ qrs: document.querySelectorAll('#present .tp-qr svg').length, map: !!document.querySelector('#present .tp-qr.map'), speech: window.__speech.filter((s) => s.ev === 'start').map((s) => s.text).join(' ') }));
  let d3 = { speech: '' };
  if (old) {
    await page.click('#present .tp-back');
    await page.evaluate(() => { window.__speech = []; });
    await page.click(`#present [data-tp="${old.id}"]`);
    await page.waitForSelector('#present .tp-detail'); await page.waitForTimeout(1200);
    d3 = await page.evaluate(() => ({ text: document.querySelector('#present .tp-detail').innerText, map: !!document.querySelector('#present .tp-qr.map'), speech: window.__speech.filter((s) => s.ev === 'start').map((s) => s.text).join(' ') }));
    await page.screenshot({ path: 'shots/p5_detail_old.png' });
  }
  rec(5, 'ออนไลน์: ไม่มี QR แผนที่ เสียงบอก "ออนไลน์" · ข่าวเดิม: ไม่มี QR แผนที่ เสียงไม่พูดเวลา/สถานที่ที่ไม่มีในระบบ',
    d2.qrs === 1 && !d2.map && d2.speech.includes('ออนไลน์') && !!old && !d3.map && !d3.speech.replace(old.title, '').includes('เวลา') && !d3.speech.replace(old.title, '').includes(' ที่ ') && d3.text.includes('ไม่ระบุสถานที่'),
    JSON.stringify({ online: d2.speech.slice(0, 100), old: d3.speech.slice(0, 120) }));

  // 6 ไม่บังอวตาร
  const geo = await page.evaluate(() => { const r = (e) => e.getBoundingClientRect(); const a = r(document.querySelector('#avatar svg')), b = r(document.getElementById('present'));
    const face = { l: a.left, r: a.right, t: a.top, b: a.top + a.height * 0.3 };
    return { hit: face.l < b.right && face.r > b.left && face.t < b.bottom && face.b > b.top, aw: a.width }; });
  rec(6, 'พื้นที่ปฏิทินไม่บังใบหน้าอวตาร (1600×900)', !geo.hit && geo.aw > 50, JSON.stringify(geo));

  // 7 Esc หยุดเสียงและปิด · ไม่มี error
  await page.evaluate(() => { window.__speech = []; });
  await page.click('#present .tp-listen');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const esc = await page.evaluate(() => ({ hidden: document.getElementById('present').hidden, speaking: speechSynthesis.speaking, mode: VORA.orch.mode }));
  rec(7, 'Esc: ปิดปฏิทิน หยุดเสียง และไม่มีข้อผิดพลาดของหน้าเว็บ', esc.hidden && !esc.speaking && page.errors.length === 0, JSON.stringify({ ...esc, errors: page.errors }));

  // 8 ภาษาอังกฤษ
  await page.click('.lang button[data-lang="en"]'); await page.waitForTimeout(500);
  await wake(page);
  await openPortal(page);
  const en = await page.evaluate(() => ({ title: document.querySelector('.present-title').textContent, text: document.querySelector('#present .present-body').innerText }));
  rec(8, 'ภาษาอังกฤษ: หัวข้อ/ป้ายเป็นอังกฤษ และ "Location not specified" สำหรับข่าวที่ไม่มีสถานที่', en.title === 'Event calendar' && en.text.includes('Location not specified') && en.text.includes('Key dates'), en.title);
  await page.click('.lang button[data-lang="th"]');
  await ctx.close();

  // 9 จอแนวตั้งและจอเล็ก: ไม่มีเลื่อนแนวนอน · ไม่บังใบหน้าอวตาร
  const sizes = [[1080, 1920], [1280, 800]];
  const lay = [];
  for (const [w, h] of sizes) {
    const o = await open(browser, w, h);
    await wake(o.page);
    const ref = await o.page.evaluate(() => { VORA.orch.present('news', 'test'); return new Promise((r) => setTimeout(() => { const p = document.getElementById('present').getBoundingClientRect(); r([p.left, p.top, p.right, p.bottom].map(Math.round)); }, 900)); });
    await o.page.click('#present [data-open-timeline]');
    await o.page.waitForSelector('#present .tp-item', { timeout: 10000 }); await o.page.waitForTimeout(700);
    await o.page.screenshot({ path: `shots/p5_portal_${w}x${h}.png` });
    lay.push(await o.page.evaluate(([w, h, ref]) => { const b = document.querySelector('#present .present-body'); const a = document.querySelector('#avatar svg').getBoundingClientRect(); const p = document.getElementById('present').getBoundingClientRect();
      const face = { l: a.left, r: a.right, t: a.top, b: a.top + a.height * 0.3 };
      return { size: `${w}x${h}`, hscroll: b.scrollWidth > b.clientWidth + 2 || document.documentElement.scrollWidth > innerWidth + 2, faceHit: a.width > 0 && face.l < p.right && face.r > p.left && face.t < p.bottom && face.b > p.top, items: document.querySelectorAll('#present .tp-item').length,
        sameAsNews: JSON.stringify([p.left, p.top, p.right, p.bottom].map(Math.round)) === JSON.stringify(ref) }; }, [w, h, ref]));
    await o.ctx.close();
  }
  // จอแนวนอน: ต้องไม่บังใบหน้าอวตาร · จอแนวตั้ง: พื้นที่นำเสนอของ Phase 1 เต็มจอทุกหมวด (ข้อจำกัดเดิม รายงานแยก) — ปฏิทินต้องใช้พื้นที่เท่ากับหมวดข่าวเดิม ไม่ทำให้แย่ลง
  rec(9, 'จอ 1280×800: ไม่เลื่อนแนวนอน ไม่บังใบหน้าอวตาร · จอ 1080×1920: ไม่เลื่อนแนวนอน และใช้พื้นที่เท่ากับหมวดข่าวเดิม',
    lay.every((x) => !x.hscroll && x.items > 0 && x.sameAsNews) && !lay.find((x) => x.size === '1280x800').faceHit, JSON.stringify(lay));

  // 10 มือถือ ?news=
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mp = await mctx.newPage(); mp.errors = []; mp.on('pageerror', (e) => mp.errors.push(e.message));
  await mp.goto(`${BASE}/m/?news=${ids.external}`, { waitUntil: 'networkidle' }); await mp.waitForSelector('.detail .event');
  const m1 = await mp.evaluate(() => ({ text: document.querySelector('.detail').innerText, map: document.querySelector('.detail .event a')?.href }));
  await mp.screenshot({ path: 'shots/p5_mobile_external.png' });
  let m2 = { text: '' };
  if (old) { await mp.goto(`${BASE}/m/?news=${old.id}`, { waitUntil: 'networkidle' }); await mp.waitForSelector('.detail .event'); m2 = await mp.evaluate(() => ({ text: document.querySelector('.detail').innerText, map: !!document.querySelector('.detail .event a') })); }
  rec(10, 'มือถือ ?news=: แสดงวันที่ เวลา สถานที่ และลิงก์แผนที่จริง · ข่าวเดิมแสดงไม่ระบุเวลา/ไม่ระบุสถานที่',
    m1.text.includes('09:00') && m1.text.includes('ศูนย์การค้าตัวอย่าง') && m1.map === 'https://maps.google.com/?q=example' && m2.text.includes('ไม่ระบุเวลา') && m2.text.includes('ไม่ระบุสถานที่') && !m2.map && mp.errors.length === 0,
    JSON.stringify({ map: m1.map }));
  await mctx.close();

  // 11 หลังบ้าน: ฟอร์มประเภทสถานที่ (ออนไลน์ปิดช่องแผนที่ · ภายในต้องกรอกชื่อ) และบันทึกผ่านฟอร์มจริง
  const actx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const ap = await actx.newPage(); ap.errors = []; ap.on('pageerror', (e) => ap.errors.push(e.message));
  await ap.addInitScript((t) => { try { localStorage.setItem('vora.token', t); } catch {} }, tok);
  await ap.goto(`${BASE}/admin/#news`, { waitUntil: 'networkidle' });
  await ap.waitForSelector('#addNews', { timeout: 15000 });
  const col = await ap.evaluate(() => document.querySelector('table')?.innerText.includes('ไม่ระบุสถานที่'));
  await ap.click('#addNews'); await ap.waitForSelector('#modalForm [name="location_type"]');
  await ap.selectOption('#modalForm [name="location_type"]', 'online');
  const onl = await ap.evaluate(() => ({ map: document.querySelector('#modalForm [name="location_map_url"]').disabled, nameReq: document.querySelector('#modalForm [name="location"]').required }));
  await ap.selectOption('#modalForm [name="location_type"]', 'campus');
  await ap.fill('#modalForm [name="title_th"]', 'P5 ทดสอบ: บันทึกจากฟอร์มหลังบ้าน');
  await ap.fill('#modalForm [name="event_date"]', `${day(6)}T10:15`);
  await ap.click('#modalForm button[value="ok"]'); await ap.waitForTimeout(400);
  const blocked = await ap.evaluate(() => document.getElementById('modal').open);   // ยังไม่กรอกชื่อสถานที่ → ฟอร์มไม่ส่ง
  await ap.fill('#modalForm [name="location"]', 'อาคาร 2 ห้อง 201');
  await ap.fill('#modalForm [name="location_map_url"]', 'https://maps.google.com/?q=b2');
  await ap.screenshot({ path: 'shots/p5_admin_form.png' });
  await ap.click('#modalForm button[value="ok"]'); await ap.waitForTimeout(1500);
  const saved = (await j('/api/admin/news', { headers: H })).body.find((n) => n.title_th === 'P5 ทดสอบ: บันทึกจากฟอร์มหลังบ้าน');
  await ap.screenshot({ path: 'shots/p5_admin_list.png' });
  rec(11, 'หลังบ้าน: ออนไลน์ปิดช่องแผนที่ ภายในวิทยาลัยต้องกรอกชื่อ บันทึกจากฟอร์มได้ค่าครบ และตารางแสดงคอลัมน์สถานที่',
    col && onl.map && !onl.nameReq && blocked && saved && saved.location === 'อาคาร 2 ห้อง 201' && saved.location_type === 'campus' && saved.location_map_url === 'https://maps.google.com/?q=b2' && saved.event_date.startsWith(`${day(6)}T10:15`) && ap.errors.length === 0,
    JSON.stringify({ col, onl, blocked, saved: saved && [saved.location, saved.location_type, saved.event_date], errors: ap.errors }));
  await actx.close();

  await browser.close();
  fs.writeFileSync('phase5-test-results.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${pass}/${results.length} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
