// VORA NEXT Phase 6 · Gate 6B — Unified Design Foundation (เบราว์เซอร์)
// รัน: เปิด start.bat แล้ว node gate6b-scenarios.js (ต้องมี playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.VORA_URL || 'http://localhost:8000';
const results = [];
const rec = (id, name, pass, note = '') => { results.push({ id, name, pass: !!pass, note }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} ${note}`); };

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const tok = (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'vora1234' }) })).json()).token;

  // 1–5 token โหลดได้จริงทุกหน้า และยังไม่มีหน้าใดใช้ class/ธีมใหม่ (หน้าตาเดิม)
  const pages = [['kiosk', '/?debug=1'], ['mobile', '/m/'], ['admin', '/admin/#news'], ['pastel', '/pastel/'], ['classic', '/classic/']];
  let i = 1;
  for (const [name, url] of pages) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['camera', 'microphone'] });
    if (name === 'admin') await ctx.addInitScript((t) => { try { localStorage.setItem('vora.token', t); } catch {} }, tok);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + url, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    const r = await p.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { brand: cs.getPropertyValue('--vora-brand').trim(), font: cs.getPropertyValue('--vora-font-body').trim(), radius: cs.getPropertyValue('--vora-radius-lg').trim(),
        sheets: [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].filter((x) => x.href).map((x) => x.href); } catch { return []; } }),
        voraClass: document.querySelectorAll('[class*="vora-"]').length, themed: document.querySelectorAll('[data-vora-theme]').length };
    });
    rec(i++, `${name}: โหลด tokens.css + components.css ผ่าน base.css · ยังไม่มี element ใช้ class/ธีม vora (หน้าตาเดิม)`,
      r.brand === '#FFD400' && r.font.startsWith('"Anuphan"') && r.radius === '20px' && r.sheets.some((h) => h.endsWith('/shared/tokens.css')) && r.sheets.some((h) => h.endsWith('/shared/components.css')) && r.voraClass === 0 && r.themed === 0 && errs.length === 0,
      JSON.stringify({ brand: r.brand, voraClass: r.voraClass, themed: r.themed, errs }));
    await ctx.close();
  }

  // 6–10 หน้าอ้างอิง Design System: ธีม light/dark, คอมโพเนนต์, ไอคอน, ฟอนต์ในเครื่อง
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = []; const ext = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('request', (r) => { const h = new URL(r.url()).hostname; if (!['localhost', '127.0.0.1'].includes(h)) ext.push(r.url()); });
  await p.goto(BASE + '/shared/design-system.html', { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready);
  const ds = await p.evaluate(() => {
    const L = document.querySelector('[data-panel="light"]'), D = document.querySelector('[data-panel="dark"]');
    const bg = (el) => getComputedStyle(el).backgroundColor, col = (el) => getComputedStyle(el).color;
    const btnL = L.querySelector('.vora-btn--primary'), btnD = D.querySelector('.vora-btn--primary'), cardD = D.querySelector('.vora-card');
    return { lightBg: bg(L), darkBg: bg(D), lightText: col(L), darkText: col(D), btnL: bg(btnL), btnD: bg(btnD), btnTxt: col(btnL), cardD: bg(cardD),
      lightTok: L.querySelector('[data-token="--vora-bg"]').textContent, darkTok: D.querySelector('[data-token="--vora-bg"]').textContent,
      icons: document.querySelectorAll('svg.vora-icon').length, perPanel: L.querySelectorAll('[data-icons] svg.vora-icon').length, names: window.VORA_DS.ICON_NAMES.length,
      leftover: document.querySelectorAll('[data-vora-icon]').length, anuphan: document.fonts.check('16px Anuphan') && [...document.fonts].some((f) => f.family === 'Anuphan' && f.status === 'loaded'),
      font: getComputedStyle(L).fontFamily };
  });
  await p.screenshot({ path: 'shots/g6b_design_system.png', fullPage: false });
  rec(6, 'ธีม light/dark: พื้น/ตัวอักษรตาม token (light #F7F7F5 / dark #08090C)',
    ds.lightBg === 'rgb(247, 247, 245)' && ds.darkBg === 'rgb(8, 9, 12)' && ds.lightText === 'rgb(20, 22, 27)' && ds.darkText === 'rgb(255, 255, 255)' && ds.lightTok === '#F7F7F5' && ds.darkTok === '#08090C', JSON.stringify(ds).slice(0, 220));
  rec(7, 'คอมโพเนนต์ใช้ token: ปุ่มหลักเหลืองแบรนด์ ตัวอักษรดำ · การ์ดธีมมืดใช้ surface-1', ds.btnL === 'rgb(255, 212, 0)' && ds.btnD === 'rgb(255, 212, 0)' && ds.btnTxt === 'rgb(11, 11, 13)' && ds.cardD === 'rgb(20, 22, 27)');
  rec(8, `ไอคอน SVG ครบทุกตัว (${ds.names} แบบ × 2 ธีม) และแทนที่ data-vora-icon หมด`, ds.perPanel === ds.names && ds.leftover === 0 && ds.icons >= ds.names * 2, `svg=${ds.icons}`);
  rec(9, 'ฟอนต์หลัก Anuphan โหลดจากเครื่อง · ไม่มีคำขอไปโดเมนภายนอก · ไม่มี error', ds.anuphan && ds.font.startsWith('Anuphan') && ext.length === 0 && errs.length === 0, JSON.stringify({ ext, errs }));
  const before = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.click('#themeToggle'); await p.waitForTimeout(200);
  const after = await p.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, t: document.body.dataset.voraTheme, tok: getComputedStyle(document.body).getPropertyValue('--vora-text').trim() }));
  await p.screenshot({ path: 'shots/g6b_design_system_dark.png', fullPage: false });
  await p.click('#themeToggle'); await p.waitForTimeout(200);
  const back = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  rec(10, 'สลับธีมทั้งหน้า: light → dark → light (ค่าสีเปลี่ยนตาม token และกลับคืน)', before === 'rgb(247, 247, 245)' && after.bg === 'rgb(8, 9, 12)' && after.t === 'dark' && after.tok === '#FFFFFF' && back === before, JSON.stringify({ before, after, back }));

  // 11 contrast จริงในเบราว์เซอร์ (ตัวอักษรรอง/ลิงก์ บนพื้นของแต่ละธีม)
  const cr = await p.evaluate(() => {
    const rgb = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = c.map(f); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    return ['light', 'dark'].map((t) => { const P = document.querySelector(`[data-panel="${t}"]`); const bg = getComputedStyle(P).backgroundColor;
      return { t, muted: ratio(getComputedStyle(P.querySelector('.vora-field__hint')).color, bg), link: ratio(getComputedStyle(P.querySelector('.vora-link')).color, getComputedStyle(P.querySelector('.vora-card')).backgroundColor) }; });
  });
  rec(11, 'contrast ที่แสดงจริง ≥ 4.5:1 (ข้อความรอง, ลิงก์) ทั้งสองธีม', cr.every((x) => x.muted >= 4.5 && x.link >= 4.5), JSON.stringify(cr.map((x) => ({ t: x.t, muted: x.muted.toFixed(2), link: x.link.toFixed(2) }))));
  await ctx.close();
  await browser.close();
  fs.writeFileSync('gate6b-test-results.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
