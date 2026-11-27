// VORA Guide (17 พ.ย. 2569) — ทดสอบในเบราว์เซอร์จริง (Playwright) + Regression ของหน้า Main
// รัน (Windows): เปิด start.bat แล้ว  node docs\vora-guide\guide-scenarios.js
//   ตัวเลือก: VORA_URL (ค่าเริ่มต้น http://localhost:8000) · VORA_SUITE=guide|regression|all (ค่าเริ่มต้น all)
//             VORA_CHROME=<path ของ chrome.exe ถ้า Playwright ไม่มี Chromium> · VORA_PW=<path ของโมดูล playwright> · VORA_SHOTS=<โฟลเดอร์ภาพ>
// ความปลอดภัย: /api/robot/stop ถูกดักและตอบ {ok:true} ในเบราว์เซอร์ (นับจำนวนครั้ง) — ไม่ส่งไปหุ่นยนต์จริง
// คำสั่งเสียง: จำลองผลจากระบบรับเสียงเดิมด้วย VORA.listener.cb.onFinal(ข้อความ) (หน้า ?debug=1) — เส้นทางเดียวกับที่ Listener เรียกจริง
const { chromium } = require(process.env.VORA_PW || 'playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.VORA_URL || 'http://localhost:8000';
const SUITE = process.env.VORA_SUITE || 'all';
const SHOTS = process.env.VORA_SHOTS || path.join(__dirname, 'shots');
const TAG = process.env.VORA_TAG || '';
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const rec = (id, name, pass, note = '') => { results.push({ id, name, pass: pass === 'skip' ? 'SKIP' : pass ? 'PASS' : 'FAIL', note }); console.log(`${pass === 'skip' ? 'SKIP' : pass ? 'PASS' : 'FAIL'} ${id} ${name} ${note}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STEP_IDS = ['avatar', 'mic', 'chat', 'nav', 'qr', 'camera', 'status', 'lang', 'settings', 'fullscreen'];

async function open(browser, { width = 1366, height = 768, reducedMotion = 'no-preference', theme = 'dark' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript((t) => { try { localStorage.setItem('vora.theme', t); localStorage.setItem('vora.lang', 'th'); } catch {} }, theme);
  const page = await ctx.newPage();
  const log = { errors: [], robotStop: 0, chat: [], greet: 0 };
  page.on('pageerror', (e) => log.errors.push(e.message));
  await page.route('**/api/robot/stop', (r) => { log.robotStop++; r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/chat')) { try { log.chat.push(JSON.parse(r.postData() || '{}').text); } catch { log.chat.push('?'); } }
    if (u.includes('/api/greet')) log.greet++;
  });
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.VORA && window.VORA.S && window.VORA.S.cfg, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return { ctx, page, log };
}

// สถานะของ Guide จาก DOM
const gs = (page) => page.evaluate(() => {
  const p = document.querySelector('.vg-panel');
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  return {
    open: !!(p && p.open), step: p && p.dataset.step, count: p && p.querySelector('.vg-count').textContent, title: p && p.querySelector('.vg-title').textContent,
    body: p && p.querySelector('.vg-body').textContent, hint: p && p.querySelector('.vg-hint').textContent, layerHidden: !document.querySelector('.vg-layer') || document.querySelector('.vg-layer').hidden,
    rings: [...document.querySelectorAll('.vg-ring')].filter((r) => !r.hidden).map(rect), panel: rect(p),
    btnDisabled: document.getElementById('vgBtn') && document.getElementById('vgBtn').disabled, caption: document.getElementById('caption').textContent,
    active: document.activeElement && (document.activeElement.id || document.activeElement.className), vw: innerWidth, vh: innerHeight,
  };
});
// คลิกด้วยเมาส์จริงที่กลาง element (ผ่าน overlay ของ Guide แบบเดียวกับผู้ใช้)
async function tap(page, sel) {
  const box = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
  if (!box) throw new Error('not found: ' + sel);
  await page.mouse.click(box.x, box.y);
}
const voice = (page, text) => page.evaluate((t) => window.VORA.listener.cb.onFinal(t), text);
const settle = (page, ms = 700) => page.waitForTimeout(ms);
// รอจน VORA พูดขั้นนั้นจบ (ใช้สถานะเดิมของหน้า: data-state)
const waitIdle = (page, ms = 15000) => page.waitForFunction(() => document.getElementById('app').dataset.state === 'idle', null, { timeout: ms }).catch(() => {});

/** กรอบของ target ของขั้นปัจจุบัน (ตามนิยามใน guide-steps.js) */
const targetRects = (page, step) => page.evaluate(async (id) => {
  const { GUIDE_STEPS } = await import('/guide/guide-steps.js');
  const s = GUIDE_STEPS.find((x) => x.id === id);
  // ส่วนที่มองเห็นได้จริง (ตัดด้วยแถบเลื่อนที่ครอบอยู่)
  const vis = (el) => { if (!el) return null; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return null; const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'contents') continue; const ar = a.getBoundingClientRect();
      if (s.overflowX !== 'visible') { left = Math.max(left, ar.left); right = Math.min(right, ar.right); } if (s.overflowY !== 'visible') { top = Math.max(top, ar.top); bottom = Math.min(bottom, ar.bottom); } }
    return right - left >= 1 && bottom - top >= 1 ? { left, top, right, bottom } : null; };
  const pick = (sel) => { const els = sel.split('||').map((x) => document.querySelector(x.trim())).filter(Boolean); return els.find(vis) || els[0]; };
  return s.targets.map((g) => {
    const rs = g.map(pick).map(vis).filter(Boolean);
    if (!rs.length) return null;
    return { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
  });
}, step);

/** ตรวจตำแหน่งของขั้นปัจจุบัน: Spotlight ครอบ target · target อยู่ในจอ · แผงอยู่ในจอ · แผงไม่ทับ Spotlight */
async function checkLayout(page, label, retry = true) {
  const s = await gs(page);
  const t = await targetRects(page, s.step);
  const notes = [];
  let ok = s.open && !s.layerHidden;
  t.forEach((r, k) => {
    const ring = s.rings[k];
    if (!r) { ok = false; notes.push(`target${k}=missing`); return; }
    const inView = r.top >= -1 && r.bottom <= s.vh + 1 && r.left >= -1 && r.right <= s.vw + 1;
    if (!inView) { ok = false; notes.push(`target${k} off-screen`); }
    if (!ring) { ok = false; notes.push(`ring${k}=none`); return; }
    const covers = ring.left <= r.left + 1 && ring.top <= r.top + 1 && ring.right >= r.right - 1 && ring.bottom >= r.bottom - 1;
    if (!covers && inView) { ok = false; notes.push(`ring${k} !covers`); }
  });
  const p = s.panel;
  if (!(p.left >= 0 && p.top >= 0 && p.right <= s.vw + 1 && p.bottom <= s.vh + 1)) { ok = false; notes.push('panel off-screen'); }
  const ov = s.rings.some((r) => p.left < r.right && p.right > r.left && p.top < r.bottom && p.bottom > r.top);
  if (ov) { ok = false; notes.push('panel overlaps spotlight'); }
  if (!ok && retry) { await settle(page, 800); return checkLayout(page, label, false); }   // ระหว่าง transition 300ms / smooth scroll
  return { ok, note: `${label}:${s.step}${notes.length ? ' [' + notes.join(', ') + ']' : ''}` };
}

async function walkAllSteps(page, prefix, viewportName) {
  const out = [];
  for (let i = 0; i < 10; i++) {
    await settle(page, 900);
    const s = await gs(page);
    const lay = await checkLayout(page, viewportName);
    out.push({ i, step: s.step, count: s.count, ...lay });
    if (i === 0 || i === 5 || i === 9) await page.screenshot({ path: path.join(SHOTS, `${TAG}${prefix}-${viewportName}-${String(i + 1).padStart(2, '0')}-${s.step}.png`) });
    if (i < 9) await page.click('.vg-next');
  }
  return out;
}

// ================================================================== VORA Guide
async function guideSuite(browser) {
  // ---------- G1–G6 จอ 1366×768 ธีมมืด
  let { ctx, page, log } = await open(browser);
  try {
    const b = await page.evaluate(() => { const lang = document.querySelector('.hdr .lang'), btn = document.getElementById('vgBtn'), tools = document.getElementById('toolsBtn');
      return { exists: !!btn, order: !!(lang && btn && tools && (lang.compareDocumentPosition(btn) & 4) && (btn.compareDocumentPosition(tools) & 4)), title: btn && btn.title, aria: btn && btn.getAttribute('aria-label'), text: btn && btn.textContent.trim(), disabled: btn && btn.disabled }; });
    rec('G1', 'ปุ่ม ✦ อยู่ระหว่างปุ่มภาษากับตั้งค่า · tooltip/aria-label = VORA Guide', b.exists && b.order && b.title === 'VORA Guide' && b.aria === 'VORA Guide' && b.text === '✦' && !b.disabled, JSON.stringify(b));

    const before = log.robotStop;
    await page.click('#vgBtn'); await settle(page);
    let s = await gs(page);
    rec('G2', 'คลิก ✦ → เปิด Guide ขั้น 1 · ตัวนับ · VORA พูดข้อความของขั้น (ผ่าน respond เดิม)', s.open && s.step === 'avatar' && s.count === 'ขั้นที่ 1 จาก 10' && s.caption.startsWith('สวัสดีค่ะ หนูคือ VORA') && !s.layerHidden && s.active.includes('vg-next'),
      JSON.stringify({ step: s.step, count: s.count, caption: s.caption.slice(0, 30), focus: s.active }));
    rec('G2b', 'เปิด Guide ไม่ส่งคำถามเข้า AI และไม่เรียก /api/robot/stop', log.chat.length === 0 && log.robotStop === before, JSON.stringify({ chat: log.chat, stop: log.robotStop }));

    const steps = await walkAllSteps(page, 'G3', '1366x768');
    rec('G3', 'Next ครบ 10 ขั้นตามลำดับที่อนุมัติ · Spotlight ครอบ target · แผงไม่ทับ (1366×768)', steps.map((x) => x.step).join() === STEP_IDS.join() && steps.every((x) => x.ok), steps.filter((x) => !x.ok).map((x) => x.note).join(' | ') || 'all ok');
    const cam = steps.find((x) => x.step === 'camera');
    const camRings = await (async () => { return null; })();
    s = await gs(page);
    rec('G4', 'ขั้นสุดท้าย: ปุ่ม "เสร็จสิ้น"', (await page.textContent('.vg-next')) === 'เสร็จสิ้น', await page.textContent('.vg-next'));
    await page.click('.vg-back'); await settle(page);
    s = await gs(page);
    rec('G5', 'ย้อนกลับ → ขั้น 9', s.step === 'settings' && s.count === 'ขั้นที่ 9 จาก 10', s.count);
    await page.click('.vg-next'); await settle(page); await page.click('.vg-next'); await settle(page);
    s = await gs(page);
    rec('G6', 'เสร็จสิ้น → ปิด Guide · overlay หาย · focus กลับ ✦ · ไม่เรียก /api/robot/stop', !s.open && s.layerHidden && s.active === 'vgBtn' && log.robotStop === before, JSON.stringify({ open: s.open, focus: s.active, stop: log.robotStop }));
  } catch (e) { rec('G1-6', 'exception', false, e.message); }

  // ---------- G7 กล้อง 2 จุด
  try {
    await page.click('#vgBtn'); await settle(page);
    for (let i = 0; i < 5; i++) { await page.click('.vg-next'); await settle(page, 400); }
    await settle(page, 600);
    const s = await gs(page);
    const lay = await checkLayout(page, 'cam');
    rec('G7', 'ขั้นกล้อง: Spotlight 2 จุด (#camBtn + #camPill) ในขั้นเดียว', s.step === 'camera' && s.rings.length === 2 && lay.ok, lay.note + ` rings=${s.rings.length}`);
    // G8 ปุ่มจริงที่ถูก highlight ทำงาน + Guide อยู่ขั้นเดิม
    const prevShow = await page.evaluate(() => document.getElementById('camPreview').classList.contains('show'));
    await page.click('#camBtn'); await settle(page, 400);
    const nowShow = await page.evaluate(() => document.getElementById('camPreview').classList.contains('show'));
    const s2 = await gs(page);
    rec('G8', 'คลิก target (#camBtn) → ปุ่มทำงานเดิม (สลับภาพกล้อง) · Guide อยู่ขั้นเดิม', nowShow !== prevShow && s2.open && s2.step === 'camera', JSON.stringify({ prevShow, nowShow, step: s2.step }));
    await page.click('#camBtn'); await settle(page, 300);
    // G9 คลิกนอก target ถูกกันไว้
    await tap(page, '#qrBtn'); await settle(page, 400);
    const qrOpen = await page.evaluate(() => document.getElementById('qrSheet').open);
    await tap(page, '#toolsBtn'); await settle(page, 300);
    const toolsOpen = await page.evaluate(() => document.getElementById('toolsSheet').open);
    await tap(page, '#askInput'); await page.keyboard.type('x');
    const typed = await page.inputValue('#askInput');
    const s3 = await gs(page);
    rec('G9', 'คลิกพื้นที่ที่ไม่ได้ highlight (QR / ตั้งค่า / ช่องพิมพ์) ถูก overlay กันไว้ · Guide อยู่ขั้นเดิม', !qrOpen && !toolsOpen && s3.open && s3.step === 'camera' && typed === '', JSON.stringify({ qrOpen, toolsOpen, typed }));
    await page.evaluate(() => { document.getElementById('askInput').value = ''; });
    // G10 ปุ่มหยุดใน dock ยังทำงาน (stopAll เดิม) และ Guide อยู่ขั้นเดิม
    const st = log.robotStop;
    await page.click('#stopBtn'); await settle(page, 500);
    const s4 = await gs(page);
    rec('G10', 'ปุ่มหยุดใน dock ระหว่าง Guide → stopAll() เดิม (เรียก /api/robot/stop 1 ครั้ง) · Guide อยู่ขั้นเดิม', log.robotStop === st + 1 && s4.open && s4.step === 'camera', JSON.stringify({ stop: log.robotStop - st, step: s4.step }));
    // G11 "หยุดพูด" ระหว่าง Guide
    await page.click('.vg-back'); await settle(page, 300);   // พูดขั้น qr ใหม่
    await voice(page, 'หยุดพูด'); await settle(page, 400);
    const s5 = await gs(page);
    rec('G11', 'พูด "หยุดพูด" ระหว่าง Guide → stopSpeaking() เดิม · Guide อยู่ขั้นเดิม · ไม่ถาม AI', s5.open && s5.step === 'qr' && s5.caption === 'หยุดแล้วค่ะ' && !log.chat.includes('หยุดพูด'), JSON.stringify({ step: s5.step, caption: s5.caption }));
    // G12 QR target → เปิด dialog QR (modal) · คลิกปิดได้ · Guide อยู่ขั้นเดิม
    await page.click('#qrBtn'); await settle(page, 400);
    const q1 = await page.evaluate(() => document.getElementById('qrSheet').open);
    await page.click('#qrClose'); await settle(page, 300);
    const q2 = await page.evaluate(() => document.getElementById('qrSheet').open);
    const s6 = await gs(page);
    rec('G12', 'ขั้น QR: คลิก target เปิด QR (dialog เดิม) แล้วปิดได้ · Guide อยู่ขั้นเดิม', q1 && !q2 && s6.open && s6.step === 'qr', JSON.stringify({ q1, q2, step: s6.step }));
  } catch (e) { rec('G7-12', 'exception', false, e.message); }

  // ---------- Esc
  try {
    // ไปขั้นตั้งค่า (9)
    let s = await gs(page);
    while (s.step !== 'settings') { await page.click('.vg-next'); await settle(page, 350); s = await gs(page); }
    await settle(page, 400);
    const st = log.robotStop;
    await page.click('#toolsBtn'); await settle(page, 400);
    const d1 = await page.evaluate(() => document.getElementById('toolsSheet').open);
    await page.keyboard.press('Escape'); await settle(page, 400);
    const d2 = await page.evaluate(() => document.getElementById('toolsSheet').open);
    s = await gs(page);
    rec('G13', 'Esc ขณะมี dialog (ตั้งค่า) → ปิดเฉพาะ dialog · Guide อยู่ขั้นเดิม · ไม่เรียก stopAll', d1 && !d2 && s.open && s.step === 'settings' && log.robotStop === st, JSON.stringify({ d1, d2, step: s.step, stop: log.robotStop - st }));
    // ธีมสว่างจาก dialog ตั้งค่า (target ขั้นนี้) → Guide ปรับสีตามธีม
    const darkRing = await page.evaluate(() => getComputedStyle(document.querySelector('.vg-ring')).borderTopColor);
    await page.screenshot({ path: path.join(SHOTS, `${TAG}G14-dark-settings.png`) });
    await page.click('#toolsBtn'); await settle(page, 300);
    await page.click('.theme-opt[data-theme="light"]'); await settle(page, 300);
    await page.click('#toolsClose'); await settle(page, 600);
    const lightRing = await page.evaluate(() => getComputedStyle(document.querySelector('.vg-ring')).borderTopColor);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-vora-theme'));
    s = await gs(page);
    await page.screenshot({ path: path.join(SHOTS, `${TAG}G14-light-settings.png`) });
    rec('G14', 'ธีมมืด/สว่าง: เปลี่ยนธีมระหว่าง Guide → สี Spotlight ตาม --accent ของธีม · Guide อยู่ขั้นเดิม', theme === 'light' && darkRing === 'rgb(255, 43, 58)' && lightRing === 'rgb(224, 31, 48)' && s.open && s.step === 'settings', JSON.stringify({ darkRing, lightRing, theme }));
    // กลับธีมมืด
    await page.click('#toolsBtn'); await settle(page, 300); await page.click('.theme-opt[data-theme="dark"]'); await page.click('#toolsClose'); await settle(page, 300);
    // Esc ไม่มี dialog → ปิด Guide · ไม่ stopAll
    await page.keyboard.press('Escape'); await settle(page, 400);
    s = await gs(page);
    rec('G15', 'Esc ขณะ Guide เปิด (ไม่มี dialog) → ปิด Guide · ไม่เรียก /api/robot/stop', !s.open && s.layerHidden && log.robotStop === st, JSON.stringify({ open: s.open, stop: log.robotStop - st }));
    await page.keyboard.press('Escape'); await settle(page, 400);
    rec('G16', 'Esc หลังปิด Guide → ทำงานแบบเดิม (stopAll → /api/robot/stop)', log.robotStop === st + 1, `stop=${log.robotStop - st}`);
  } catch (e) { rec('G13-16', 'exception', false, e.message); }

  // ---------- ภาษา
  try {
    await page.click('#vgBtn'); await settle(page);
    for (let i = 0; i < 7; i++) { await page.click('.vg-next'); await settle(page, 300); }
    await settle(page, 300);
    let s = await gs(page);
    const speaking = await page.evaluate(() => document.getElementById('app').dataset.state);
    await page.click('.hdr .lang button[data-lang="en"]'); await settle(page, 700);
    s = await gs(page);
    rec('G17', 'เปลี่ยนเป็น English ขณะพูด → ข้อความเปลี่ยนทันที · พูดขั้นเดิมใหม่เป็นภาษาอังกฤษ · ซ่อนคำใบ้เสียง', s.step === 'lang' && s.title === 'Language' && s.count === 'Step 8 of 10' && s.hint === '' && (await page.textContent('.vg-next')) === 'Next' && s.caption.startsWith('Switch between Thai and English'),
      JSON.stringify({ wasState: speaking, title: s.title, caption: s.caption.slice(0, 40) }));
    await page.screenshot({ path: path.join(SHOTS, `${TAG}G17-en.png`) });
    await page.click('.hdr .lang button[data-lang="th"]'); await settle(page, 500);
    s = await gs(page);
    rec('G18', 'กลับภาษาไทย → ข้อความไทย', s.title === 'เปลี่ยนภาษา' && s.count === 'ขั้นที่ 8 จาก 10', s.title);
    await page.click('.vg-close'); await settle(page, 300);
  } catch (e) { rec('G17-18', 'exception', false, e.message); }

  // ---------- เสียง
  try {
    let s;
    await voice(page, 'แนะนำการใช้งานค่ะ'); await settle(page);
    s = await gs(page);
    rec('G19', 'เสียง "แนะนำการใช้งานค่ะ" → เปิด Guide (ไม่ส่งเข้า AI)', s.open && s.step === 'avatar' && !log.chat.some((x) => x.includes('แนะนำการใช้งาน')), s.step);
    await voice(page, 'ถัดไป'); await settle(page, 400);
    const a = (await gs(page)).step;
    await voice(page, 'ถัดไปครับ'); await settle(page, 400);
    const b2 = (await gs(page)).step;
    await voice(page, 'ย้อนกลับ'); await settle(page, 400);
    const c = (await gs(page)).step;
    await voice(page, 'สอนการใช้งาน'); await settle(page, 400);
    const d = (await gs(page)).step;
    rec('G20', 'เสียง ถัดไป / ถัดไปครับ / ย้อนกลับ ทำงาน · สั่งเริ่มซ้ำขณะเปิด = ไม่ทำอะไร', a === 'mic' && b2 === 'chat' && c === 'mic' && d === 'mic' && !log.chat.some((x) => ['ถัดไป', 'ถัดไปครับ', 'ย้อนกลับ', 'สอนการใช้งาน'].includes(x)), [a, b2, c, d].join('>'));
    await voice(page, 'หยุดแนะนำ'); await settle(page, 400);
    s = await gs(page);
    const st = log.robotStop;
    rec('G21', 'เสียง "หยุดแนะนำ" → ปิด Guide', !s.open, '');
    await voice(page, 'เริ่มแนะนำการใช้งาน'); await settle(page, 400);
    await voice(page, 'ปิด'); await settle(page, 400);
    s = await gs(page);
    rec('G22', 'เสียง "ปิด" ขณะ Guide เปิด → ปิด Guide · ไม่ส่งเข้า AI · ไม่ stopAll', !s.open && !log.chat.includes('ปิด') && log.robotStop === st, '');
    const n0 = log.chat.length;
    await voice(page, 'ถัดไป'); await waitIdle(page); await settle(page, 600);
    await voice(page, 'ปิด'); await waitIdle(page); await settle(page, 600);
    await voice(page, 'ย้อนกลับ'); await waitIdle(page); await settle(page, 600);
    rec('G23', 'Guide ไม่ได้เปิด: "ถัดไป / ปิด / ย้อนกลับ" ส่งเข้า AI ตามเดิม', JSON.stringify(log.chat.slice(n0)) === JSON.stringify(['ถัดไป', 'ปิด', 'ย้อนกลับ']), JSON.stringify(log.chat.slice(n0)));
    // คำถามใหม่ระหว่าง Guide (เสียง) → จบ Guide แล้วถาม AI ตามปกติ
    await page.click('#vgBtn'); await settle(page, 500);
    const n1 = log.chat.length;
    await voice(page, 'ค่าเทอมเท่าไหร่'); await settle(page, 300);
    s = await gs(page);
    rec('G24', 'พูดคำถามใหม่ระหว่าง Guide → จบ Guide ก่อน แล้วส่งเข้า AI ตามปกติ', !s.open && log.chat.slice(n1).includes('ค่าเทอมเท่าไหร่'), JSON.stringify(log.chat.slice(n1)));
    await waitIdle(page); await settle(page, 500);
    // คำถามใหม่ (พิมพ์) ที่ขั้นช่องพิมพ์
    await page.click('#vgBtn'); await settle(page, 400);
    await page.click('.vg-next'); await settle(page, 300); await page.click('.vg-next'); await settle(page, 500);
    const n2 = log.chat.length;
    await page.click('#askInput'); await page.fill('#askInput', 'มีสาขาอะไรบ้าง'); await page.press('#askInput', 'Enter'); await settle(page, 600);
    s = await gs(page);
    rec('G25', 'ขั้นช่องพิมพ์: พิมพ์คำถามแล้วส่ง → จบ Guide แล้วถาม AI ตามปกติ', !s.open && log.chat.slice(n2).includes('มีสาขาอะไรบ้าง'), JSON.stringify(log.chat.slice(n2)));
    await waitIdle(page); await settle(page, 500);
  } catch (e) { rec('G19-25', 'exception', false, e.message); }

  // ---------- Presentation
  try {
    await page.click('#vgBtn'); await settle(page, 400);
    for (let i = 0; i < 3; i++) { await page.click('.vg-next'); await settle(page, 300); }
    await settle(page, 500);
    let s = await gs(page);
    await tap(page, '#railMenu button'); await settle(page, 1200);
    const presenting = await page.evaluate(() => !document.getElementById('present').hidden);
    s = await gs(page);
    rec('G26', 'ขั้นเมนูหลัก: เลือกหมวด → เปิด Presentation → Guide จบทันที · ✦ disabled (จาง)', presenting && !s.open && s.btnDisabled === true, JSON.stringify({ presenting, open: s.open, disabled: s.btnDisabled }));
    const op = await page.evaluate(() => getComputedStyle(document.getElementById('vgBtn')).opacity);
    await tap(page, '#vgBtn'); await settle(page, 400);
    const n = log.chat.length;
    await voice(page, 'แนะนำการใช้งาน'); await settle(page, 600);
    s = await gs(page);
    rec('G27', 'ระหว่าง Presentation: คลิก ✦ ไม่เปิด · คำสั่งเสียงเริ่มไม่เปิด Guide (ส่งเข้า AI ตามเดิม) · ไม่ปิด Presentation เอง', !s.open && (await page.evaluate(() => !document.getElementById('present').hidden)) && log.chat.slice(n).includes('แนะนำการใช้งาน'), JSON.stringify({ opacity: op, chat: log.chat.slice(n) }));
    await waitIdle(page); await settle(page, 400);
    await page.click('.present-close'); await settle(page, 1000);
    s = await gs(page);
    rec('G28', 'ปิด Presentation → ✦ ใช้งานได้อีกครั้ง', s.btnDisabled === false, '');
  } catch (e) { rec('G26-28', 'exception', false, e.message); }

  // ---------- Keyboard / focus
  try {
    await page.click('#vgBtn'); await settle(page, 500);
    const seen = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); seen.push(await page.evaluate(() => { const a = document.activeElement; return a.closest('.vg-panel') ? 'panel:' + a.className : a.closest('#avatar') ? 'target' : (a.id || a.tagName); })); }
    rec('G29', 'Tab วนเฉพาะแผง Guide + target (focus ไม่หลุดไปส่วนอื่น)', seen.every((x) => x.startsWith('panel:') || x === 'target'), seen.join(','));
    for (let i = 0; i < 7; i++) { await page.click('.vg-next'); await settle(page, 300); }
    const seen2 = [];
    for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); seen2.push(await page.evaluate(() => { const a = document.activeElement; return a.closest('.vg-panel') ? 'panel' : a.closest('.lang') ? 'lang:' + a.dataset.lang : (a.id || a.tagName); })); }
    rec('G30', 'ขั้นภาษา: Tab เข้าถึงปุ่มภาษา (target) ได้', seen2.some((x) => x.startsWith('lang:')) && seen2.every((x) => x === 'panel' || x.startsWith('lang:')), seen2.join(','));
    // Space ที่ปุ่มของ Guide = กดปุ่ม ไม่ใช่คีย์ลัดเริ่มฟัง
    await page.focus('.vg-next'); await page.keyboard.press('Space'); await settle(page, 400);
    const s = await gs(page);
    rec('G31', 'Space บนปุ่ม Guide = กดปุ่ม (ไม่เริ่มฟัง)', s.step === 'settings' && (await page.evaluate(() => document.getElementById('app').dataset.state)) !== 'listening', s.step);
    await page.click('.vg-close');
  } catch (e) { rec('G29-31', 'exception', false, e.message); }

  // ---------- พัก Greeting / ข่าว ระหว่าง Guide
  try {
    const cfg = await page.evaluate(() => window.VORA.S.cfg.auto_greeting);
    await page.click('#vgBtn'); await settle(page, 300);
    await waitIdle(page); await settle(page, 1000);
    const g0 = log.greet;
    let tracker = true;
    try { await page.evaluate(() => window.VORA.simulateVisitor(3500)); } catch (e) { tracker = false; }
    await settle(page, 2500);
    let s = await gs(page);
    rec('G32', 'ผู้เข้าชมใหม่ระหว่าง Guide → ไม่ทักทาย (กติกาเดิม skip) · Guide อยู่ขั้นเดิม', !cfg || !tracker ? 'skip' : log.greet === g0 && s.open && s.step === 'avatar', JSON.stringify({ auto_greeting: cfg, tracker, greet: log.greet - g0 }));
    await page.evaluate(() => window.VORA.enqueue({ kind: 'text', text_th: 'ข่าวทดสอบ VG ปกติ', priority: 1 }));
    await settle(page, 3000);
    s = await gs(page);
    rec('G33', 'ประกาศข่าวปกติ (priority 1) ระหว่าง Guide → ถูกพักไว้', s.open && !s.caption.includes('ข่าวทดสอบ VG ปกติ'), s.caption.slice(0, 30));
    await page.evaluate(() => window.VORA.enqueue({ kind: 'text', text_th: 'ข่าวด่วนทดสอบ VG', priority: 5 }));
    await settle(page, 2500);
    s = await gs(page);
    rec('G34', 'ประกาศด่วนเจ้าหน้าที่ (priority ≥4) ระหว่าง Guide → พูดแทรกได้ (อนุมัติข้อ 10ก) · Guide ยังเปิด', s.open && s.caption.includes('ข่าวด่วนทดสอบ VG'), s.caption.slice(0, 30));
    await waitIdle(page);
    await page.click('.vg-close'); await settle(page, 300);
    await page.evaluate(() => { window.VORA.S.queue.length = 0; });
  } catch (e) { rec('G32-34', 'exception', false, e.message); }

  // ---------- Timeout 60 วิ + ไม่เข้าโหมดหน้าจอว่างระหว่าง Guide
  try {
    const st = log.robotStop;
    await page.click('#vgBtn');
    const t0 = Date.now();
    await waitIdle(page, 20000);
    const spokeMs = Date.now() - t0;
    await page.waitForTimeout(30000);
    const mid = await page.evaluate(() => ({ idle: document.getElementById('app').classList.contains('is-idle'), open: document.querySelector('.vg-panel').open }));
    await page.waitForTimeout(25000);
    const before60 = await page.evaluate(() => document.querySelector('.vg-panel').open);
    await page.waitForTimeout(8000);
    const s = await gs(page);
    rec('G35', 'ไม่มี interaction 60 วิ (นับหลังพูดจบ) → Guide จบเอง · ไม่เรียก /api/robot/stop · ระหว่างนั้นไม่เข้าโหมดหน้าจอว่าง', mid.open && !mid.idle && before60 && !s.open && s.layerHidden && log.robotStop === st,
      JSON.stringify({ spokeMs, mid, before60, after: s.open }));
  } catch (e) { rec('G35', 'exception', false, e.message); }
  rec('G36', 'ไม่มี JavaScript error ตลอดการทดสอบ (1366×768)', log.errors.length === 0, log.errors.slice(0, 3).join(' | '));
  await ctx.close();

  // ---------- จอขนาดต่าง ๆ + จอแคบ ≤1100px (scroll ไปที่ target อัตโนมัติ)
  for (const [w, h, name] of [[1920, 1080, '1920x1080'], [1024, 768, '1024x768'], [768, 1024, '768x1024'], [390, 844, '390x844']]) {
    ({ ctx, page, log } = await open(browser, { width: w, height: h }));
    try {
      await page.click('#vgBtn');
      const steps = await walkAllSteps(page, 'G37', name);
      const bad = steps.filter((x) => !x.ok);
      rec(`G37-${name}`, `ทุกขั้นที่ ${name}: target อยู่ในจอ (scroll อัตโนมัติ) · Spotlight ครอบ · แผงอยู่ในจอและไม่ทับ`, bad.length === 0, bad.map((x) => x.note).join(' | ') || 'all ok');
      await page.click('.vg-next'); await settle(page, 300);
      rec(`G38-${name}`, `ไม่มี JS error (${name})`, log.errors.length === 0, log.errors.slice(0, 2).join(' | '));
    } catch (e) { rec(`G37-${name}`, 'exception', false, e.message); }
    await ctx.close();
  }

  // ---------- reduced motion + ธีมสว่างตั้งแต่เริ่ม
  ({ ctx, page, log } = await open(browser, { reducedMotion: 'reduce', theme: 'light' }));
  try {
    await page.click('#vgBtn'); await settle(page, 500);
    const t = await page.evaluate(() => ({ ring: getComputedStyle(document.querySelector('.vg-ring')).transitionDuration, panel: getComputedStyle(document.querySelector('.vg-panel')).transitionDuration, theme: document.documentElement.getAttribute('data-vora-theme'), panelBg: getComputedStyle(document.querySelector('.vg-panel')).backgroundColor }));
    await page.screenshot({ path: path.join(SHOTS, `${TAG}G39-light-reduced.png`) });
    rec('G39', 'prefers-reduced-motion: ไม่มี transition ของ Spotlight/แผง · ธีมสว่าง: แผงพื้นขาว', t.ring.split(',').every((x) => parseFloat(x) === 0) && t.panel.split(',').every((x) => parseFloat(x) === 0) && t.theme === 'light' && t.panelBg.startsWith('rgba(255, 255, 255'), JSON.stringify(t));
    const scrollBehavior = 'n/a';
    await page.click('.vg-close');
  } catch (e) { rec('G39', 'exception', false, e.message); }
  await ctx.close();

  // ---------- Fullscreen (ขั้น 10)
  ({ ctx, page, log } = await open(browser));
  try {
    await page.click('#vgBtn'); await settle(page, 300);
    for (let i = 0; i < 9; i++) { await page.click('.vg-next'); await settle(page, 250); }
    await settle(page, 500);
    await page.click('#fsBtn'); await settle(page, 1200);
    const fs1 = await page.evaluate(() => !!document.fullscreenElement);
    let lay = await checkLayout(page, 'fullscreen-on');
    const s = await gs(page);
    await page.screenshot({ path: path.join(SHOTS, `${TAG}G40-fullscreen.png`) });
    await page.click('#fsBtn'); await settle(page, 1000);
    const fs2 = await page.evaluate(() => !!document.fullscreenElement);
    rec('G40', 'ขั้นเต็มจอ: คลิก target เข้า/ออกเต็มจอได้ · Guide อยู่ขั้นเดิม · Spotlight ถูกตำแหน่ง', s.open && s.step === 'fullscreen' && lay.ok, JSON.stringify({ fullscreenOn: fs1, off: !fs2, layout: lay.note }));
  } catch (e) { rec('G40', 'exception', false, e.message); }
  await ctx.close();
}

// ================================================================== Regression ของหน้า Main (ระบบเดิม)
async function regressionSuite(browser) {
  const { ctx, page, log } = await open(browser);
  const hasGuide = await page.evaluate(() => !!document.getElementById('vgBtn'));
  const R = (id, name, pass, note) => rec(`R${id}`, name, pass, note);
  try {
    R(1, 'โหลดหน้า Main ได้ ไม่มี JS error', log.errors.length === 0, log.errors.slice(0, 2).join(' | '));
    const ids = ['sysPill', 'camPill', 'toolsBtn', 'fsBtn', 'homeBtn', 'railMenu', 'qrBtn', 'stage', 'avatar', 'micBtn', 'askForm', 'stopBtn', 'camBtn', 'gestureBtn', 'textMenuBtn'];
    const present = await page.evaluate((ids) => ids.filter((i) => document.getElementById(i)), ids);
    R(2, 'element หลักของหน้าครบ', present.length === ids.length, `${present.length}/${ids.length}`);
    const railCount = await page.evaluate(() => document.querySelectorAll('#railMenu button').length);
    R(3, 'เมนูหลัก (rail) มีปุ่มหมวดครบ 6', railCount === 6, `${railCount}`);
    await page.click('.hdr .lang button[data-lang="en"]'); await settle(page, 400);
    const ph = await page.getAttribute('#askInput', 'placeholder');
    await page.click('.hdr .lang button[data-lang="th"]'); await settle(page, 400);
    const ph2 = await page.getAttribute('#askInput', 'placeholder');
    R(4, 'เปลี่ยนภาษา TH ↔ EN', ph !== ph2 && ph2.startsWith('พิมพ์คำถาม'), `${ph} | ${ph2}`);
    await page.click('#toolsBtn'); await settle(page, 300);
    const t1 = await page.evaluate(() => document.getElementById('toolsSheet').open);
    await page.click('.theme-opt[data-theme="light"]'); await settle(page, 200);
    const th = await page.evaluate(() => document.documentElement.getAttribute('data-vora-theme'));
    await page.click('.theme-opt[data-theme="dark"]');
    await page.click('#toolsClose'); await settle(page, 300);
    R(5, 'ตั้งค่า: เปิด/ปิด dialog · สลับธีมสว่าง/มืด', t1 && th === 'light' && !(await page.evaluate(() => document.getElementById('toolsSheet').open)), th);
    await page.click('#qrBtn'); await settle(page, 300);
    const q = await page.evaluate(() => document.getElementById('qrSheet').open && !!document.querySelector('#qrBox svg, #qrBox *'));
    await page.click('#qrClose');
    R(6, 'QR: เปิด/ปิด', q, '');
    await page.click('#camBtn'); await settle(page, 300);
    const cp = await page.evaluate(() => document.getElementById('camPreview').classList.contains('show'));
    await page.click('#camBtn');
    R(7, 'ปุ่มกล้องสลับภาพกล้อง', cp, '');
    await page.click('#gestureBtn'); await settle(page, 200);
    const gp = await page.evaluate(() => !document.getElementById('gesturePop').hidden);
    await page.click('#gestureBtn');
    R(8, 'ปุ่มท่าทาง', gp, '');
    await page.click('#textMenuBtn'); await settle(page, 300);
    const tm = await page.evaluate(() => document.getElementById('textMenu').open);
    await page.click('#textMenuClose');
    R(9, 'เมนูตัวอักษรใหญ่', tm, '');
    const n = log.chat.length;
    await page.fill('#askInput', 'สมัครเรียนยังไง'); await page.press('#askInput', 'Enter');
    await waitIdle(page); await settle(page, 500);
    const msgs = await page.evaluate(() => document.querySelectorAll('#messages .msg').length);
    R(10, 'พิมพ์คำถาม → /api/chat และแสดงคำตอบ', log.chat.slice(n).includes('สมัครเรียนยังไง') && msgs >= 2, `msgs=${msgs}`);
    let st = log.robotStop;
    await page.keyboard.press('Escape'); await settle(page, 300);
    R(11, 'Esc → stopAll (/api/robot/stop)', log.robotStop === st + 1, `${log.robotStop - st}`);
    st = log.robotStop;
    await page.click('#stopBtn'); await settle(page, 300);
    R(12, 'ปุ่มหยุด → stopAll (/api/robot/stop)', log.robotStop === st + 1, `${log.robotStop - st}`);
    st = log.robotStop;
    await page.click('#toolsBtn'); await settle(page, 300); await page.keyboard.press('Escape'); await settle(page, 300);
    R(13, 'Esc ใน dialog ตั้งค่า (นอก Guide) → ปิด dialog + stopAll เหมือนเดิม', !(await page.evaluate(() => document.getElementById('toolsSheet').open)) && log.robotStop === st + 1, `${log.robotStop - st}`);
    await voice(page, 'หยุดพูด'); await settle(page, 300);
    R(14, 'คำสั่งเสียง "หยุดพูด" → หยุดพูดแล้วค่ะ (ไม่ถาม AI)', (await page.textContent('#caption')) === 'หยุดแล้วค่ะ' && !log.chat.includes('หยุดพูด'), '');
    const n2 = log.chat.length;
    await voice(page, 'ถัดไป'); await waitIdle(page); await settle(page, 400);
    await voice(page, 'ปิด'); await waitIdle(page); await settle(page, 400);
    await voice(page, 'มีข่าวอะไรบ้าง'); await waitIdle(page); await settle(page, 400);
    R(15, 'ข้อความเสียงทั่วไป / "ถัดไป" / "ปิด" (ไม่มี Guide) → ส่งเข้า AI', JSON.stringify(log.chat.slice(n2)) === JSON.stringify(['ถัดไป', 'ปิด', 'มีข่าวอะไรบ้าง']), JSON.stringify(log.chat.slice(n2)));
    const n3 = log.chat.length;
    await voice(page, 'แนะนำการใช้งาน'); await settle(page, 600);
    const guideOpen = await page.evaluate(() => !!(document.querySelector('.vg-panel') && document.querySelector('.vg-panel').open));
    R(16, hasGuide ? 'เสียง "แนะนำการใช้งาน" → เปิด VORA Guide (พฤติกรรมใหม่ที่อนุมัติ)' : 'เสียง "แนะนำการใช้งาน" → ส่งเข้า AI (ระบบเดิม)',
      hasGuide ? guideOpen && !log.chat.slice(n3).length : log.chat.slice(n3).includes('แนะนำการใช้งาน'), JSON.stringify(log.chat.slice(n3)));
    if (guideOpen) { await page.click('.vg-close'); await settle(page, 300); }
    await waitIdle(page);
    await page.click('#railMenu button'); await settle(page, 1200);
    const pr = await page.evaluate(() => !document.getElementById('present').hidden);
    await page.click('.present-close'); await settle(page, 900);
    const pr2 = await page.evaluate(() => !document.getElementById('present').hidden);
    R(17, 'เมนูหลัก → เปิด Presentation · ปิดได้', pr && !pr2, '');
    await page.click('#homeBtn'); await settle(page, 300);
    const rect = await page.evaluate(() => Object.fromEntries(['stage', 'avatar', 'micBtn', 'askForm', 'homeBtn', 'qrBtn', 'stopBtn', 'sysPill', 'camPill'].map((i) => { const r = document.getElementById(i).getBoundingClientRect(); return [i, [r.x, r.y, r.width, r.height].map(Math.round)]; })));
    fs.writeFileSync(path.join(SHOTS, `${TAG}layout.json`), JSON.stringify(rect));
    await page.screenshot({ path: path.join(SHOTS, `${TAG}R-main.png`) });
    R(18, 'บันทึกตำแหน่ง element หลัก (เทียบกับระบบเดิม)', true, JSON.stringify(rect));
    // โหมดหน้าจอว่างยังทำงานเหมือนเดิม
    const idleMs = await page.evaluate(() => window.VORA.config.ui.idleAfterMs);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(idleMs + 4000);
    R(19, `โหมดหน้าจอว่างหลังไม่มีการใช้งาน ${idleMs / 1000} วิ (เหมือนเดิม)`, await page.evaluate(() => document.getElementById('app').classList.contains('is-idle')), '');
    R(20, 'ไม่มี JS error ระหว่าง regression', log.errors.length === 0, log.errors.slice(0, 2).join(' | '));
  } catch (e) { rec('R*', 'exception', false, e.message); }
  await ctx.close();
}

(async () => {
  const launch = { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] };
  if (process.env.VORA_CHROME) launch.executablePath = process.env.VORA_CHROME;
  const browser = await chromium.launch(launch);
  if (SUITE === 'all' || SUITE === 'guide') await guideSuite(browser);
  if (SUITE === 'all' || SUITE === 'regression') await regressionSuite(browser);
  await browser.close();
  const pass = results.filter((r) => r.pass === 'PASS').length, fail = results.filter((r) => r.pass === 'FAIL').length, skip = results.filter((r) => r.pass === 'SKIP').length;
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped (${BASE})`);
  fs.writeFileSync(path.join(SHOTS, `${TAG}results.json`), JSON.stringify({ base: BASE, suite: SUITE, at: new Date().toISOString(), pass, fail, skip, results }, null, 2));
  process.exit(fail ? 1 : 0);
})();
