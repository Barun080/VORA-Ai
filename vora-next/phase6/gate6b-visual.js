// VORA NEXT Phase 6 · Gate 6B — หลักฐาน "หน้าตาไม่เปลี่ยน"
// เก็บ computed style ของทุก element + ค่าตัวแปร CSS เดิม + ภาพหน้าจอ (หยุดนาฬิกา, ปิดแอนิเมชัน, ปิดบังวิดีโอกล้อง/นาฬิกา)
// ใช้: node gate6b-visual.js snap <โฟลเดอร์>   |   node gate6b-visual.js diff <ก่อน> <หลัง>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.VORA_URL || 'http://localhost:8000';
const PROPS = ['color', 'background-color', 'background-image', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-transform', 'text-decoration-line', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-top-width',
  'border-top-style', 'border-radius', 'box-shadow', 'outline-color', 'padding', 'margin', 'display', 'position', 'gap', 'opacity', 'visibility', 'fill', 'stroke'];
const OLD_VARS = ['--bg', '--surface', '--surface-2', '--yellow', '--yellow-2', '--white', '--text-2', '--success', '--warning', '--danger', '--line', '--line-soft',
  '--glow', '--state', '--r', '--font', '--font-th', '--ink', '--blueprint', '--blueprint-deep', '--hazard', '--paper', '--muted', '--ok', '--warn', '--listen', '--think',
  '--speak', '--radius-lg', '--radius-md', '--radius-sm', '--font-display', '--font-body', '--orb', '--accent', '--edge', '--ready', '--float', '--r-card'];
const DESK = [[1366, 768], [1600, 900], [1920, 1080]];
const PAGES = [
  ...DESK.map(([w, h]) => ({ id: `kiosk-idle-${w}`, url: '/?debug=1', w, h, kiosk: true })),
  ...DESK.map(([w, h]) => ({ id: `kiosk-active-${w}`, url: '/?debug=1', w, h, kiosk: true, act: 'wake' })),
  ...DESK.map(([w, h]) => ({ id: `kiosk-present-news-${w}`, url: '/?debug=1', w, h, kiosk: true, act: 'news' })),
  { id: 'mobile-chat-390', url: '/m/', w: 390, h: 844, mobile: true },
  { id: 'mobile-news-390', url: '/m/?news=1', w: 390, h: 844, mobile: true },
  { id: 'mobile-chat-1366', url: '/m/', w: 1366, h: 768 },
  ...DESK.map(([w, h]) => ({ id: `admin-login-${w}`, url: '/admin/', w, h })),
  ...DESK.map(([w, h]) => ({ id: `admin-news-${w}`, url: '/admin/#news', w, h, admin: true })),
  ...DESK.map(([w, h]) => ({ id: `pastel-${w}`, url: '/pastel/', w, h, legacy: true })),
  ...DESK.map(([w, h]) => ({ id: `classic-${w}`, url: '/classic/', w, h, legacy: true })),
];

async function collect(page) {
  return page.evaluate(([PROPS, OLD_VARS]) => {
    const key = (el) => { const p = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0; p.unshift(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}:${i}`); } return p.join('>'); };
    const out = {};
    for (const el of document.querySelectorAll('*')) {
      if (['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'TITLE'].includes(el.tagName)) continue;
      const cs = getComputedStyle(el); out[key(el)] = PROPS.map((p) => cs.getPropertyValue(p)).join('|');
    }
    const vars = {}; const rs = getComputedStyle(document.documentElement); const bs = getComputedStyle(document.body);
    for (const v of OLD_VARS) vars[v] = `${rs.getPropertyValue(v).trim()}|${bs.getPropertyValue(v).trim()}`;
    const vora = [...new Set([...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].flatMap((r) => r.style ? [...r.style].filter((n) => n.startsWith('--vora-')) : []); } catch { return []; } }))].length;
    return { styles: out, vars, voraDeclared: vora, voraBrand: rs.getPropertyValue('--vora-brand').trim(), fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).sort() };
  }, [PROPS, OLD_VARS]);
}

async function snap(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  let token = null;
  { const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'vora1234' }) }); token = (await r.json()).token; }
  const ext = [];
  for (const pg of PAGES.filter((p) => !process.env.ONLY || p.id === process.env.ONLY)) {
    const ctx = await browser.newContext({ viewport: { width: pg.w, height: pg.h }, permissions: ['camera', 'microphone'], reducedMotion: 'reduce', isMobile: !!pg.mobile, hasTouch: !!pg.mobile });
    await ctx.clock.install({ time: new Date('2026-11-01T10:00:00+07:00') });
    await ctx.addInitScript(() => { Object.defineProperty(window, 'speechSynthesis', { value: { speak() {}, cancel() {}, getVoices: () => [], speaking: false, onvoiceschanged: null }, configurable: true }); });
    if (pg.admin) await ctx.addInitScript((t) => { try { localStorage.setItem('vora.token', t); } catch {} }, token);
    const page = await ctx.newPage();
    page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) ext.push(`${pg.id} ${r.resourceType()} ${u.hostname}`); });
    await page.goto(BASE + pg.url, { waitUntil: 'networkidle' });
    if (pg.kiosk) await page.waitForFunction(() => window.VORA && VORA.S && VORA.S.cfg, null, { timeout: 30000 });
    if (pg.act === 'wake' || pg.act === 'news') { await page.mouse.move(5, 200); await page.mouse.move(25, 230); await page.waitForFunction(() => VORA.ui.mode === 'active'); }
    if (pg.act === 'news') { await page.evaluate(() => VORA.orch.present('news', 'test')); await page.waitForSelector('#present .pcard'); }
    if (pg.admin) await page.waitForSelector('#addNews', { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.clock.runFor(1500);
    await page.waitForTimeout(400);
    const data = await collect(page);
    const masks = [page.locator('video, canvas, #clockTime, #clockDate, [id*="clock"]')];
    await page.screenshot({ path: path.join(dir, `${pg.id}.png`), animations: 'disabled', mask: masks, caret: 'hide' });
    fs.writeFileSync(path.join(dir, `${pg.id}.json`), JSON.stringify(data));
    await ctx.close();
  }
  fs.writeFileSync(path.join(dir, '_external_requests.json'), JSON.stringify([...new Set(ext)], null, 1));
  await browser.close();
  console.log('snap', dir, PAGES.length, 'pages');
}

if (process.argv[2] === 'snap') snap(process.argv[3]).catch((e) => { console.error(e); process.exit(1); });

// ---------- diff: เทียบ computed style + ตัวแปร CSS เดิม (ภาพเทียบด้วย gate6b-pixels.py)
function diff(a, b) {
  const out = []; let fail = 0;
  for (const f of fs.readdirSync(a).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    const A = JSON.parse(fs.readFileSync(path.join(a, f))), B = JSON.parse(fs.readFileSync(path.join(b, f)));
    const ka = Object.keys(A.styles), kb = new Set(Object.keys(B.styles));
    const common = ka.filter((k) => kb.has(k));
    const changed = common.filter((k) => A.styles[k] !== B.styles[k]);
    const onlyA = ka.length - common.length, onlyB = kb.size - common.length;
    const varsChanged = Object.keys(A.vars).filter((v) => A.vars[v] !== B.vars[v]);
    const fonts = JSON.stringify(A.fonts) === JSON.stringify(B.fonts);
    const bad = changed.length || varsChanged.length || onlyA || onlyB || !fonts;
    if (bad) fail++;
    out.push({ page: f.replace('.json', ''), elements: common.length, styleChanged: changed.length, domOnlyBefore: onlyA, domOnlyAfter: onlyB, varsChanged, fontsSame: fonts,
      voraBefore: A.voraDeclared, voraAfter: B.voraDeclared, brandAfter: B.voraBrand, sample: changed.slice(0, 3).map((k) => ({ k: k.slice(-80), a: A.styles[k].slice(0, 160), b: B.styles[k].slice(0, 160) })) });
  }
  return { fail, out };
}
if (process.argv[2] === 'diff') { const r = diff(process.argv[3], process.argv[4]); console.log(JSON.stringify(r, null, 1)); process.exit(0); }
