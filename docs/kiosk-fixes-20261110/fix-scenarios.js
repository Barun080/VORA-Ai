// ทดสอบการแก้ไข 10 พ.ย. 2569 — Chromium จริง + เซิร์ฟเวอร์ VORA จริง
// ใช้ฐานข้อมูลที่นำเข้าความรู้วิทยาลัยเทคนิคน่านแล้ว (import_vtcn) = ตาราง programs ไม่มีสาขาที่เผยแพร่ เหมือนเครื่องของทีม
// วิธีรัน: เปิดเซิร์ฟเวอร์ที่ :8000 แล้ว `node fix-scenarios.js`
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8000';
const results = [];
const rec = (id, name, pass, note = '') => { results.push({ id, name, pass, note }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} ${note}`); };
const stub = () => {
  const synth = { _cur: null, _t: null, speaking: false, onvoiceschanged: null, getVoices: () => [],
    speak(u) { this._cur = u; this.speaking = true; this._t = setTimeout(() => { this.speaking = false; this._cur = null; u.onend && u.onend(); }, Math.min(3000, 300 + u.text.length * 10)); },
    cancel() { if (this._cur) { clearTimeout(this._t); const u = this._cur; this._cur = null; this.speaking = false; u.onerror && u.onerror({ error: 'interrupted' }); } } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 915 }, permissions: ['camera', 'microphone'] });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('vora.theme', t); } catch {} }, theme);
    const page = await ctx.newPage(); page.errors = []; page.asks = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    page.on('request', (r) => { if (r.url().includes('/api/chat')) page.asks.push(JSON.parse(r.postData() || '{}').text); });
    await page.goto(`${BASE}/?debug=1`);
    await page.waitForFunction(() => window.VORA && VORA.S.cfg, null, { timeout: 30000 });
    await page.mouse.move(900, 500); await page.waitForTimeout(800);
    const ev = (fn, a) => page.evaluate(fn, a);

    if (theme === 'light') {
      // F1 หัวจอไม่มีคำขวัญ
      const hdr = await ev(() => document.querySelector('.hdr').textContent);
      rec('F1', 'หัวจอไม่มีประโยค "ก้าวสู่อนาคตอาชีวศึกษา ด้วยพลัง AI"', !/ก้าวสู่อนาคต/.test(hdr) && !/Stepping into/.test(hdr));

      // F2 สาขาวิชา: ไม่มีสาขาในตาราง programs → แสดงแผนกจากฐานความรู้ · แตะแล้วถาม AI เดิม
      const progs = await ev(() => fetch('/api/programs').then((r) => r.json()));
      await page.click('.orb[data-section="departments"]');
      await page.waitForFunction(() => document.querySelectorAll('#present .pcard').length > 0 || /ยังไม่มีข้อมูล/.test(document.querySelector('#present .present-body').textContent), null, { timeout: 10000 });
      const cards = await ev(() => [...document.querySelectorAll('#present .pcard')].map((e) => e.textContent.trim()));
      await page.click('#present .pcard >> nth=2');
      await page.waitForFunction(() => document.getElementById('app').dataset.state === 'speaking', null, { timeout: 15000 });
      const bubble = await ev(() => document.getElementById('caption').textContent);
      rec('F2', 'สาขาวิชา: ตาราง programs ว่าง → แสดงแผนกจากฐานความรู้ที่อนุมัติ · แตะแล้ว VORA ตอบจากฐานความรู้', progs.length === 0 && cards.length >= 10 && cards.every((c) => c.startsWith('แผนก')) && /ช่างกลโรงงาน/.test(page.asks[page.asks.length - 1] || '') && /ช่างกลโรงงาน/.test(bubble),
        JSON.stringify({ programs: progs.length, cards: cards.length, first: cards.slice(0, 3), asked: page.asks[page.asks.length - 1], bubble: bubble.slice(0, 60) }));
      await page.click('.present-close'); await page.waitForTimeout(600);
    }

    // F3 ผังความรู้: พื้นและตัวอักษรตามธีม (contrast ≥ 4.5:1)
    await page.click('.orb[data-section="college"]');
    await page.waitForSelector('#present [data-open-map]', { timeout: 10000 });
    await page.click('#present [data-open-map]');
    await page.waitForSelector('#present .cnode:not(.center)', { timeout: 10000 });
    await page.waitForTimeout(700);
    const c = await ev(() => {
      const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const n = document.querySelector('#present .cnode:not(.center)');
      const fg = rgb(getComputedStyle(n.querySelector('b')).color), bg = rgb(getComputedStyle(n).backgroundColor);
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return { fg, bg, ratio: +((a + 0.05) / (b + 0.05)).toFixed(1), sky: getComputedStyle(document.querySelector('#present .csky')).backgroundColor };
    });
    rec(`F3-${theme}`, `ผังความรู้อ่านง่าย (${theme}): ตัวอักษรบนกล่องหัวข้อ contrast ≥ 4.5:1`, c.ratio >= 4.5, JSON.stringify(c));
    await page.click('.present-close'); await page.waitForTimeout(600);

    // F4 โหมดหน้าจอว่าง: กล่องคำพูดไม่ล้นขอบจอ · ป้ายกล้องอ่านได้
    await ev(() => document.getElementById('tPanels').click());
    await page.waitForFunction(() => document.getElementById('app').classList.contains('is-idle'), null, { timeout: 5000 });
    await ev(() => VORA.greet(1, { force: true }));
    await page.waitForFunction(() => !document.getElementById('bubble').hidden, null, { timeout: 8000 });
    await page.waitForTimeout(900);
    const b = await ev(() => { const r = document.getElementById('bubble').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), W: innerWidth, H: innerHeight }; });
    const badge = await ev(() => {
      const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
      const el = document.getElementById('camBadge'); if (el.hidden) return { hidden: true };
      const t = el.querySelector('.cb-t'); return { fg: rgb(getComputedStyle(t).color), bg: rgb(getComputedStyle(el).backgroundColor), op: getComputedStyle(el).opacity };
    });
    const badgeOk = badge.hidden || (Math.abs(badge.fg[0] - badge.bg[0]) + Math.abs(badge.fg[1] - badge.bg[1]) + Math.abs(badge.fg[2] - badge.bg[2]) > 300);
    await page.screenshot({ path: path.join(__dirname, `f4_idle_${theme}.jpg`), type: 'jpeg', quality: 80 });
    rec(`F4-${theme}`, `โหมดหน้าจอว่าง (${theme}): กล่องคำพูดอยู่ในจอทั้งกล่อง · ป้ายกล้องสีตัดกับพื้น`, b.l >= 0 && b.t >= 0 && b.r <= b.W && b.b <= b.H && badgeOk, JSON.stringify({ bubble: b, badge }));
    await page.mouse.move(300, 300); await page.mouse.click(960, 600); await page.waitForTimeout(900);

    if (theme === 'dark') {
      // F5 Hysteresis: คนที่ติดตามอยู่ ใบหน้าเล็กลง (ยืนห่างขึ้น) ไม่หลุด Session · ใบหน้าเล็กของคนใหม่ไกล ๆ ไม่นับเป็นผู้เข้าชม
      // ปิดกล้องเสมือนของเครื่องทดสอบก่อน (ภาพทดสอบของ Chrome ทำให้ตัวตรวจจับเจอ "ใบหน้า" ปลอมเป็นครั้งคราว) แล้วป้อนกล่องใบหน้าเองทั้งหมด
      await ev(() => VORA.cam.staffToggle());
      await page.waitForFunction(() => VORA.S.cam === 'staff-off', null, { timeout: 5000 });
      await ev(() => { document.getElementById('tReset').click(); VORA.S.cfg.greeting_cooldown_s = 3; VORA.S.lastGreetAt = 0; });
      await ev(() => VORA.simulateEmpty(7000));
      const sess0 = await ev(() => VORA.S.cfg && VORA.tracker.snapshot().session);
      await ev(() => VORA.simulateVisitor(2000, [{ x: 0.4, y: 0.3, w: 0.16, h: 0.2 }]));
      const s1 = await ev(() => VORA.tracker.snapshot().session);
      await ev(() => VORA.simulateVisitor(8000, [{ x: 0.42, y: 0.3, w: 0.10, h: 0.13 }]));   // ใบหน้าเล็กกว่า minFaceWidth (0.12) แต่เกิน 75%
      const s2 = await ev(() => VORA.tracker.snapshot().session);
      await ev(() => VORA.simulateEmpty(7000));
      await ev(() => VORA.simulateVisitor(3000, [{ x: 0.1, y: 0.3, w: 0.09, h: 0.12 }]));   // คนใหม่ไกล ๆ ใบหน้าเล็ก
      const s3 = await ev(() => VORA.tracker.snapshot().session);
      const visionMin = await ev(() => VORA.camera.vision.opt.minFaceWidth);
      rec('F5', 'Hysteresis: คนเดิมใบหน้าเล็กลงไม่หลุด Session · คนใหม่ใบหน้าเล็กไม่เริ่ม Session · ตัวตรวจจับรับถึง 0.09', !sess0 && s1 && s2 && s2.id === s1.id && !s3 && Math.abs(visionMin - 0.09) < 1e-6,
        JSON.stringify({ s1: s1 && s1.id, s2: s2 && s2.id, farNew: s3, visionMin }));

      // F6 คนใหม่ตามมาหลังคนก่อนออกไป 10 วิ (เกิน returnWindow 8 วิ แต่ยังอยู่ในคูลดาวน์ 25 วิ) → ทักเมื่อพ้นคูลดาวน์ ถ้ายังยืนอยู่
      let greetReqs = 0;
      page.on('request', (r) => { if (r.url().includes('/api/greet')) greetReqs++; });
      const greets = async () => greetReqs;
      await ev(() => { VORA.S.cfg.greeting_cooldown_s = 25; document.getElementById('tReset').click(); });
      await page.waitForTimeout(9000);                                       // คนก่อนออกไปแล้วเกิน returnWindow (8 วิ) = คนใหม่ ไม่ใช่คนเดิมกลับมา
      await ev(() => { VORA.S.lastGreetAt = Date.now() - 12000; });           // ทักคนก่อนไปเมื่อ 12 วิที่แล้ว (เหลือคูลดาวน์ 13 วิ)
      await ev(() => { VORA.S.lastActivity = 0; });
      const pv = ev(() => VORA.simulateVisitor(16000, [{ x: 0.4, y: 0.3, w: 0.18, h: 0.22 }]));
      await page.waitForTimeout(3000);
      const early = await greets();
      await pv;
      const later = await greets();
      rec('F6', 'คนใหม่มาระหว่างคูลดาวน์: ไม่ทิ้ง — ทักเมื่อพ้นคูลดาวน์ (ครั้งเดียว) ถ้ายังยืนอยู่', early === 0 && later === 1, JSON.stringify({ early, later }));
      await ev(() => VORA.simulateEmpty(7000));
    }
    rec(`E-${theme}`, `ไม่มี JavaScript error (${theme})`, page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)));
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'fix-test-results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
