// VORA NEXT — Phase 4 Gate Tests (Knowledge Constellation) — ส่วนหน้าจอ
// ส่วนข้อมูล (Node/Edge ต้องมาจากฐานข้อมูลจริง) ทดสอบใน backend/tests/test_constellation.py
// รัน: เปิด start.bat แล้ว npm i playwright && mkdir shots && node phase4-scenarios.js
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
    cancel() { if (this._cur) { clearTimeout(this._timer); const u = this._cur; this._cur = null; this.speaking = false; u.onerror && u.onerror({ error: 'interrupted' }); } } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
};

async function open(browser, w, h, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['camera', 'microphone'], ...extra });
  await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(BASE + '/?debug=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.VORA && VORA.orch && VORA.S.cfg && VORA.S.cam === 'on', null, { timeout: 30000 });
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const { ctx, page } = await open(browser, 1600, 900);
  const ev = (fn, a) => page.evaluate(fn, a);
  const wake = async () => { await page.mouse.move(5, 200); await page.mouse.move(25, 230); await page.waitForFunction(() => VORA.ui.mode === 'active'); await page.waitForTimeout(800); };
  const g = await ev(async () => (await fetch('/api/constellation?lang=th')).json());
  const kidsOf = (id) => g.edges.filter((e) => e.source === id).map((e) => g.nodes.find((n) => n.id === e.target).title);
  const shown = () => ev(() => ({ center: document.querySelector('#present .cnode.center b')?.textContent, kids: [...document.querySelectorAll('#present .cnode:not(.center) b')].map((b) => b.textContent),
    ids: [...document.querySelectorAll('#present .cnode')].map((b) => b.dataset.id), detail: document.querySelector('#cdetail')?.textContent || '', last: VORA.constellation.lastRender }));
  const drill = async (id) => { await page.click(`#present .cnode[data-id="${id}"]`); await page.waitForFunction((x) => document.querySelector('#present .cnode.center')?.dataset.id === x, id, { timeout: 8000 }); };

  // 1 เปิดจากหมวดสาขาวิชา → Node กลาง = วิทยาลัย, ลูก = ระดับ + หมวดความรู้ตามกราฟจริง
  await wake();
  await page.click('.orb[data-section="departments"]');
  await page.waitForSelector('#present [data-open-map]', { timeout: 10000 });
  await page.click('#present [data-open-map]');
  await page.waitForSelector('#present .cnode.center', { timeout: 10000 });
  await page.waitForTimeout(600);
  let s = await shown();
  const school = await ev(() => VORA.S.cfg.school_name_th);
  await page.screenshot({ path: 'shots/p4_root.png' });
  // แสดงทีละหน้า (จำนวนต่อหน้าคำนวณจากพื้นที่) — หน้าแรกต้องเป็นลำดับต้นของลูกจริง และถ้ามีมากกว่านั้นต้องมีปุ่ม "อีก n หัวข้อ"
  const allRoot = kidsOf('college');
  const more = await ev(() => document.querySelector('#present [data-page="1"]')?.textContent || '');
  const pageOk = JSON.stringify(s.kids) === JSON.stringify(allRoot.slice(0, s.kids.length)) && (s.kids.length === allRoot.length || more.includes(String(allRoot.length - s.kids.length)));
  rec(1, 'เปิดแผนผังความรู้: Node กลางคือชื่อวิทยาลัยจากระบบ หัวข้อรอบ ๆ ตรงกับความสัมพันธ์จากฐานข้อมูล และวางเป็นวงกลมบนจอ 1600×900', s.center === school && pageOk && s.last.layout === 'radial', JSON.stringify({ center: s.center, shown: s.kids.length, total: allRoot.length, layout: s.last.layout }));

  // 2 เจาะลึก ระดับ → แผนก → สาขา → อาชีพ (ข้อความตรงกับ /api/programs/{id})
  const lvId = g.edges.find((e) => e.source === 'college' && e.target.startsWith('level:')).target;
  await drill(lvId);
  const s2 = await shown();
  const depId = g.edges.find((e) => e.source === lvId).target;
  await drill(depId);
  const s3 = await shown();
  const progId = g.edges.find((e) => e.source === depId).target;
  await drill(progId);
  const s4 = await shown();
  const pid = +progId.split(':')[1];
  const p = await ev(async (x) => (await fetch(`/api/programs/${x}`)).json(), pid);
  await page.screenshot({ path: 'shots/p4_program.png' });
  await drill(`career:${pid}`);
  const s5 = await shown();
  await page.screenshot({ path: 'shots/p4_career.png' });
  rec(2, 'คลิกเจาะลึก ระดับ → แผนก → สาขา → อาชีพ: ทุกชั้นตรงกับกราฟ และรายละเอียด/อาชีพตรงกับข้อมูลสาขาจริง',
    JSON.stringify(s2.kids) === JSON.stringify(kidsOf(lvId)) && JSON.stringify(s3.kids) === JSON.stringify(kidsOf(depId)) && s4.center === p.name_th && s4.detail.includes(p.description_th) && s5.detail.includes(p.careers_th) && /programs:\d+\.careers_th/.test(s5.detail),
    JSON.stringify({ lv: s2.kids, dep: s3.kids, prog: s4.center, careerOk: s5.detail.includes(p.careers_th) }));

  // 3 Breadcrumb / ขึ้นหนึ่งชั้น / กลับหัวข้อหลัก
  await page.click('#present [data-up]');
  await page.waitForFunction((x) => document.querySelector('#present .cnode.center')?.dataset.id === x, progId);
  const crumbs = await ev(() => [...document.querySelectorAll('#present .ccrumb')].map((b) => b.textContent));
  await page.click('#present .ccrumb[data-go="college"]');
  await page.waitForFunction(() => document.querySelector('#present .cnode.center')?.dataset.id === 'college');
  rec(3, 'ย้อนกลับ: ปุ่มขึ้นหนึ่งชั้น และ Breadcrumb กลับหัวข้อหลักได้', crumbs.length === 4 && crumbs[0] === 'หัวข้อหลัก', JSON.stringify(crumbs));

  // 4 หมวดความรู้ → คำถาม-คำตอบ (อนุมัติแล้ว) + ถาม VORA ได้คำตอบจาก AI จริง
  const topId = g.edges.find((e) => e.source === 'college' && e.target.startsWith('topic:')).target;
  await drill(topId);
  const s6 = await shown();
  const kId = g.edges.find((e) => e.source === topId).target;
  const kNode = g.nodes.find((n) => n.id === kId);
  await drill(kId);
  const s7 = await shown();
  const bots0 = await ev(() => document.querySelectorAll('#messages .msg.bot').length);
  await page.click('#present [data-act="ask"]');
  await page.waitForFunction((n) => document.querySelectorAll('#messages .msg.bot').length > n, bots0, { timeout: 15000 }).catch(() => {});
  const asked = await ev(() => document.querySelector('#messages .msg.user:last-of-type')?.textContent || [...document.querySelectorAll('#messages .msg.user')].pop()?.textContent);
  rec(4, 'หมวดความรู้ → คำถาม-คำตอบที่อนุมัติ แสดงคำตอบจากฐานข้อมูล และปุ่ม "ถาม VORA" ส่งคำถามให้ AI จริง', JSON.stringify(s6.kids) === JSON.stringify(kidsOf(topId)) && s7.detail.includes(kNode.description) && (asked || '').includes(kNode.title.slice(0, 10)), JSON.stringify({ topic: s6.center, n: s6.kids.length, asked }));

  // 5 ไม่สร้างข้อมูลเท็จ: ทุก Node ที่แสดงมีอยู่ในกราฟ และทุกเส้นกลาง→ลูกมีอยู่จริง
  const visited = ['college', lvId, depId, progId, topId];
  let ok5 = true; const bad = [];
  for (const id of visited) {
    await ev((x) => { VORA.constellation.focus = x; VORA.constellation.page = 0; }, id);
    await page.click('.lang button[data-lang="th"]');   // วาดใหม่ผ่านเส้นทางปกติ
    await ev(() => VORA.bus.emit('experience:open', { section: 'constellation', source: 'test' }));
    await page.waitForFunction((x) => document.querySelector('#present .cnode.center')?.dataset.id === x, id, { timeout: 8000 });
    const ids = (await shown()).ids;
    for (const c of ids.slice(1)) if (!g.edges.some((e) => e.source === id && e.target === c)) { ok5 = false; bad.push(`${id}->${c}`); }
    for (const c of ids) if (!g.nodes.some((n) => n.id === c)) { ok5 = false; bad.push(c); }
  }
  rec(5, 'ไม่สร้างข้อมูลเท็จ: Node และเส้นเชื่อมทุกเส้นที่แสดง มีอยู่ในกราฟจากฐานข้อมูล', ok5, bad.join(', ') || `ตรวจ ${visited.length} ชั้น`);

  // 6 ข้อมูลไม่เพียงพอ → แจ้งบนจอ (จำลองผลจาก API: สาขาที่ไม่มีข้อมูลอาชีพ) · กราฟว่าง → แจ้งว่าไม่มีข้อมูล
  await page.route('**/api/constellation*', async (route) => {
    const r = await route.fetch(); const j = await r.json();
    j.nodes = j.nodes.filter((n) => n.id !== `career:${pid}`); j.edges = j.edges.filter((e) => e.target !== `career:${pid}`);
    j.insufficient = [{ node: progId, missing: ['careers'] }];
    route.fulfill({ response: r, json: j });
  });
  await ev((x) => { VORA.constellation.graph = null; VORA.constellation.focus = x; }, progId);
  await ev(() => VORA.bus.emit('experience:open', { section: 'constellation', source: 'test' }));
  await page.waitForSelector('#present .cgap', { timeout: 8000 }).catch(() => {});
  const gap = await ev(() => ({ gap: document.querySelector('#present .cgap')?.textContent, kids: document.querySelectorAll('#present .cnode:not(.center)').length }));
  await page.screenshot({ path: 'shots/p4_insufficient.png' });
  await page.unroute('**/api/constellation*');
  await page.route('**/api/constellation*', (route) => route.fulfill({ json: { root: 'college', nodes: [], edges: [], insufficient: [], relations: [], counts: {} } }));
  await ev(() => { VORA.constellation.graph = null; VORA.constellation.reset(); });
  await ev(() => VORA.bus.emit('experience:open', { section: 'constellation', source: 'test' }));
  await page.waitForSelector('#present .present-state.empty', { timeout: 8000 }).catch(() => {});
  const empty = await ev(() => document.querySelector('#present .present-state.empty')?.textContent);
  await page.unroute('**/api/constellation*');
  rec(6, 'ข้อมูลไม่เพียงพอ: แสดง "ข้อมูลยังไม่เพียงพอ…" ไม่สร้าง Node อาชีพแทน · ไม่มีข้อมูลเลย → แจ้งว่าไม่มีข้อมูล', /ข้อมูลยังไม่เพียงพอ/.test(gap.gap || '') && /อาชีพ/.test(gap.gap || '') && gap.kids === 0 && /ยังไม่มีข้อมูล/.test(empty || ''), JSON.stringify({ gap, empty }));

  // 7 Performance: กราฟจริง + กราฟจำลองขนาดใหญ่ (300 หัวข้อลูก) → วาดทีละหน้า ไม่เกิน 10 + 1 Node
  await ev(() => { VORA.constellation.graph = null; VORA.constellation.reset(); });
  await ev(() => VORA.bus.emit('experience:open', { section: 'constellation', source: 'test' }));
  await page.waitForFunction(() => document.querySelector('#present .cnode.center')?.dataset.id === 'college');
  const perfReal = await ev(() => VORA.constellation.lastRender);
  await page.route('**/api/constellation*', (route) => {
    const nodes = [{ id: 'college', title: 'ทดสอบ', category: 'college', description: '', knowledge_reference: 'test' }];
    const edges = [];
    for (let i = 0; i < 300; i++) { nodes.push({ id: `topic:t${i}`, title: `หัวข้อ ${i}`, category: 'topic', description: '', knowledge_reference: 'test' }); edges.push({ source: 'college', target: `topic:t${i}`, relation_type: 'has_topic' }); }
    route.fulfill({ json: { root: 'college', nodes, edges, insufficient: [], relations: ['has_topic'], counts: {} } });
  });
  await ev(() => { VORA.constellation.graph = null; VORA.constellation.reset(); });
  await ev(() => VORA.bus.emit('experience:open', { section: 'constellation', source: 'test' }));
  await page.waitForFunction(() => VORA.constellation.lastRender && VORA.constellation.lastRender.total === 301, null, { timeout: 8000 }).catch(() => {});
  const perfBig = await ev(() => ({ ...VORA.constellation.lastRender, dom: document.querySelectorAll('#present .cnode').length, more: document.querySelector('#present [data-page="1"]')?.textContent }));
  await page.click('#present [data-page="1"]');
  const page2 = await ev(() => [...document.querySelectorAll('#present .cnode:not(.center) b')].map((b) => b.textContent)[0]);
  await page.unroute('**/api/constellation*');
  await ev(() => { VORA.constellation.graph = null; VORA.constellation.reset(); });
    const per = perfBig.dom - 1;
  rec(7, 'Performance: วาดชั้นละไม่เกิน 13 Node (Node กลาง + สูงสุด 12 ต่อหน้า แบ่งหน้า) แม้กราฟมี 301 Node · ใช้เวลาวาด < 100 ms', perfReal.rendered <= 13 && per >= 6 && per <= 12 && perfBig.ms < 100 && perfReal.ms < 100 && (perfBig.more || '').includes(String(300 - per)) && page2 === `หัวข้อ ${per}`, JSON.stringify({ perfReal, perfBig, per, page2 }));

  // 8 อ่านง่าย: Node ไม่ทับกัน อยู่ในพื้นที่ ตัวอักษร ≥ 15px (1600×900, ชั้นที่มีลูกมากที่สุด)
  const busiest = [...new Set(g.edges.map((e) => e.source))].sort((a, b) => kidsOf(b).length - kidsOf(a).length)[0];
  await ev((x) => { VORA.constellation.focus = x; }, busiest);
  await ev(() => VORA.bus.emit('experience:open', { section: 'constellation', source: 'test' }));
  await page.waitForFunction((x) => document.querySelector('#present .cnode.center')?.dataset.id === x, busiest);
  await page.waitForTimeout(900);
  const rd = await ev(() => {
    const sky = document.querySelector('#present .csky').getBoundingClientRect();
    const rs = [...document.querySelectorAll('#present .cnode')].map((b) => b.getBoundingClientRect());
    const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    return { n: rs.length, inside: rs.every((r) => r.left >= sky.left - 1 && r.right <= sky.right + 1 && r.top >= sky.top - 1 && r.bottom <= sky.bottom + 1),
      overlap: rs.some((a, i) => rs.some((b, j) => i < j && hit(a, b))), font: Math.min(...[...document.querySelectorAll('#present .cnode b')].map((b) => parseFloat(getComputedStyle(b).fontSize))) };
  });
  await page.screenshot({ path: 'shots/p4_busiest.png' });
  rec(8, 'UI อ่านง่าย: ชั้นที่มีหัวข้อมากที่สุด Node ไม่ทับกัน อยู่ในพื้นที่ และตัวอักษร ≥ 15px', rd.inside && !rd.overlap && rd.font >= 15, JSON.stringify({ busiest, ...rd }));

  // 9 คีย์บอร์ด: ลูกศรวน, Enter เจาะลึก (โฟกัสกลับที่ Node กลาง), Backspace ขึ้นชั้น, Home กลับหัวข้อหลัก
  await ev(() => { VORA.constellation.reset(); });
  await ev(() => VORA.bus.emit('experience:open', { section: 'constellation', source: 'test' }));
  await page.waitForFunction(() => document.querySelector('#present .cnode.center')?.dataset.id === 'college');
  await page.focus('#present .cnode.center');
  await page.keyboard.press('ArrowRight');
  const f1 = await ev(() => document.activeElement.dataset.id);
  await page.keyboard.press('Enter');
  await page.waitForFunction((x) => document.querySelector('#present .cnode.center')?.dataset.id === x, f1, { timeout: 8000 }).catch(() => {});
  const f2 = await ev(() => ({ center: document.querySelector('#present .cnode.center')?.dataset.id, focused: document.activeElement.classList.contains('center') }));
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.querySelector('#present .cnode.center')?.dataset.id === 'college', null, { timeout: 8000 }).catch(() => {});
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('#present .cnode.center')?.dataset.id === 'college', null, { timeout: 8000 }).catch(() => {});
  const f3 = await ev(() => document.querySelector('#present .cnode.center')?.dataset.id);
  rec(9, 'คีย์บอร์ด: ลูกศรเลื่อน, Enter เจาะลึก (โฟกัสอยู่ที่ Node กลาง), Backspace ขึ้นชั้น, Home กลับหัวข้อหลัก', f1 === lvId && f2.center === f1 && f2.focused && f3 === 'college', JSON.stringify({ f1, f2, f3 }));

  // 10 ฟังสาขาจากแผนผัง: อวตารบรรยายด้วยข้อมูลสาขาจริง
  await ev((x) => { VORA.constellation.focus = x; }, progId);
  await ev(() => VORA.bus.emit('experience:open', { section: 'constellation', source: 'test' }));
  await page.waitForSelector('#present [data-act="listen"]');
  const sp0 = await ev(() => window.__speech.length);
  await page.click('#present [data-act="listen"]');
  await page.waitForFunction((n) => window.__speech.slice(n).some((x) => x.ev === 'start'), sp0, { timeout: 10000 }).catch(() => {});
  const said = await ev((n) => window.__speech.slice(n).filter((x) => x.ev === 'start').map((x) => x.text).join(' '), sp0);
  rec(10, 'ปุ่ม "ฟัง VORA อธิบาย": อวตารบรรยายสาขาด้วยข้อมูลจริง (ใช้ openCard เดิม)', said.includes(p.name_th), said.slice(0, 80));

  // 11 ภาษาอังกฤษ
  await page.click('.lang button[data-lang="en"]');
  await ev(() => { VORA.constellation.reset(); });
  await ev(() => VORA.bus.emit('experience:open', { section: 'constellation', source: 'test' }));
  await page.waitForFunction(() => /Knowledge map/.test(document.querySelector('.present-title').textContent), null, { timeout: 8000 }).catch(() => {});
  await page.waitForSelector('#present .cnode.center');
  const en = await ev(() => ({ title: document.querySelector('.present-title').textContent, center: document.querySelector('#present .cnode.center b').textContent }));
  await page.click('.lang button[data-lang="th"]');
  rec(11, 'ภาษาอังกฤษ: หัวข้อและชื่อวิทยาลัยเป็นภาษาอังกฤษจากฐานข้อมูล', en.title === 'Knowledge map' && en.center === (await ev(() => VORA.S.cfg.school_name_en)), JSON.stringify(en));
  const sys = await ev(() => ({ gum: window.__gum, cam: VORA.S.cam, ws: VORA.S.wsOnline }));
  rec(12, 'กล้อง/WebSocket ไม่ได้รับผลกระทบ', sys.gum === 1 && sys.cam === 'on' && sys.ws, JSON.stringify(sys));
  rec('E', 'ไม่มี JavaScript error', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();

  // 13 จอเล็ก (มือถือ) → แสดงเป็นรายการ ใช้งานด้วยการแตะได้
  {
    const { ctx: c, page: m } = await open(browser, 390, 844, { hasTouch: true, isMobile: true });
    await m.evaluate(() => VORA.bus.emit('experience:open', { section: 'constellation', source: 'test' }));
    await m.waitForSelector('#present .cnode.center', { timeout: 10000 });
    await m.waitForTimeout(500);
    const l = await m.evaluate(() => ({ mode: VORA.constellation.lastRender.layout, n: document.querySelectorAll('#present .cnode').length, w: Math.min(...[...document.querySelectorAll('#present .cnode')].map((b) => b.getBoundingClientRect().width)) }));
    await m.tap('#present .cnode:not(.center)');
    await m.waitForTimeout(600);
    const after = await m.evaluate(() => document.querySelector('#present .cnode.center')?.dataset.id);
    await m.screenshot({ path: 'shots/p4_mobile.png' });
    rec(13, 'จอเล็ก 390×844: แสดงแบบรายการ ปุ่มกว้างพอแตะ และแตะเจาะลึกได้', l.mode === 'list' && l.w >= 200 && after && after !== 'college' && m.errors.length === 0, JSON.stringify({ ...l, after }));
    await c.close();
  }

  await browser.close();
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync('phase4-test-results.json', JSON.stringify({ date: new Date().toISOString(), pass, total: results.length, results }, null, 2));
})();
