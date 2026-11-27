// Knowledge Constellation View — กราฟความรู้แบบโต้ตอบ (VORA NEXT Phase 4)
// ข้อมูลจาก GET /api/constellation (สร้างจากความสัมพันธ์ในฐานข้อมูลจริงเท่านั้น — backend/app/constellation.py)
// แสดงทีละชั้น: Node ที่โฟกัสอยู่ตรงกลาง + ลูกโดยตรงรอบ ๆ (สูงสุด PAGE ต่อหน้า) → ไม่ Render Node จำนวนมากพร้อมกัน
// Node เป็น <button> จริง: แตะ/คลิก/คีย์บอร์ด (ลูกศร วนลูก, Backspace ขึ้นหนึ่งชั้น, Home กลับหัวข้อหลัก)
// พื้นที่แคบ (< 640 px) → แสดงเป็นรายการแทนวงกลม

import { api, esc } from "/shared/api.js";

const PAGE_MAX = 12;   // สูงสุดต่อหน้า — จำนวนจริงคำนวณจากพื้นที่ (ไม่ให้ Node ทับกัน) ขั้นต่ำ 6 ไม่พอ = แสดงเป็นรายการ
const PAGE_MIN = 6;
const TXT = {
  th: {
    title: "แผนผังความรู้", lead: "แตะหัวข้อเพื่อเจาะลึก ข้อมูลทั้งหมดมาจากฐานข้อมูลของวิทยาลัย", root: "หัวข้อหลัก", up: "ขึ้นหนึ่งชั้น",
    more: (n) => `อีก ${n} หัวข้อ`, prev: "ก่อนหน้า", noChildren: "ไม่มีหัวข้อย่อย", ref: "อ้างอิงข้อมูล", listen: "ฟัง VORA อธิบาย", ask: "ถาม VORA", again: "🔊 ฟังอีกครั้ง",
    gap: { careers: "ข้อมูลอาชีพ", description: "คำอธิบายหลักสูตร", answer: "คำตอบ", level: "ระดับการศึกษา", department: "แผนกวิชา" },
    insufficient: (list) => `ข้อมูลยังไม่เพียงพอ: ยังไม่มี${list}ในระบบ`, empty: "ยังไม่มีข้อมูลในฐานความรู้", count: (n) => `${n} รายการ`,
    cat: { college: "วิทยาลัย", level: "ระดับการศึกษา", department: "แผนกวิชา", program: "สาขาวิชา", career: "อาชีพ", topic: "หมวดความรู้", knowledge: "คำถาม-คำตอบ" },
  },
  en: {
    title: "Knowledge map", lead: "Tap a topic to explore. Everything comes from the college database.", root: "Main topics", up: "Up one level",
    more: (n) => `${n} more`, prev: "Previous", noChildren: "No subtopics", ref: "Data reference", listen: "Hear VORA explain", ask: "Ask VORA", again: "🔊 Listen again",
    gap: { careers: "career information", description: "program description", answer: "an answer", level: "an education level", department: "a department" },
    insufficient: (list) => `Not enough data: no ${list} in the system yet`, empty: "The knowledge base is empty", count: (n) => `${n} items`,
    cat: { college: "College", level: "Level", department: "Department", program: "Program", career: "Careers", topic: "Topic", knowledge: "Q&A" },
  },
};

export class ConstellationView {
  /** actions: { narrate(type,id), ask(q), point() } */
  constructor(actions) {
    this.actions = actions;
    this.lang = "th";
    this.graph = null;
    this.focus = "college";
    this.page = 0;
    this.pageSize = PAGE_MAX;
    this.lastRender = null;   // สถิติการวาดล่าสุด (ตรวจประสิทธิภาพในชุดทดสอบ)
  }

  get t() { return TXT[this.lang]; }
  setLang(lang) { const l = lang === "en" ? "en" : "th"; if (l !== this.lang) { this.lang = l; this.graph = null; } }
  reset() { this.focus = "college"; this.page = 0; this.pageSize = PAGE_MAX; }

  async load() {
    if (!this.graph) {
      const g = await api(`/api/constellation?lang=${this.lang}`);
      const byId = new Map(g.nodes.map((n) => [n.id, n]));
      const kids = new Map(), parent = new Map();
      for (const e of g.edges) {
        if (!byId.has(e.source) || !byId.has(e.target)) continue;   // ไม่แสดงเส้นที่ชี้ไปยัง Node ที่ไม่มีจริง
        if (!kids.has(e.source)) kids.set(e.source, []);
        kids.get(e.source).push(e.target);
        parent.set(e.target, e.source);
      }
      const gaps = new Map((g.insufficient || []).map((x) => [x.node, x.missing]));
      this.graph = { ...g, byId, kids, parent, gaps };
      if (!byId.has(this.focus)) this.focus = g.root;
    }
    return this.graph;
  }

  path(id) {
    const out = [];
    for (let n = id; n; n = this.graph.parent.get(n)) out.unshift(n);
    return out;
  }

  async render(body, header, alive) {
    const t = this.t;
    header(t.title, t.lead);
    const g = await this.load();
    if (!alive()) return;
    const t0 = performance.now();
    if (!g.nodes.length) { body.innerHTML = `<div class="present-state empty">${esc(t.empty)}</div>`; return; }
    const f = g.byId.get(this.focus) || g.byId.get(g.root);
    const all = g.kids.get(f.id) || [];
    const size = this.pageSize;
    const pages = Math.max(1, Math.ceil(all.length / size));
    this.page = Math.min(this.page, pages - 1);
    const kids = all.slice(this.page * size, this.page * size + size).map((id) => g.byId.get(id));
    const crumbs = this.path(f.id).map((id, i, a) => `<button type="button" class="ccrumb" data-go="${esc(id)}" ${i === a.length - 1 ? 'aria-current="true"' : ""}>${esc(i === 0 ? t.root : g.byId.get(id).title)}</button>`).join('<span aria-hidden="true">›</span>');
    const gap = g.gaps.get(f.id);
    const action = f.category === "program" ? `<button type="button" class="primary" data-act="listen">${esc(t.listen)}</button>`
      : f.category === "knowledge" ? `${f.description && this.actions.say ? `<button type="button" class="primary" data-act="say">${esc(t.again)}</button> ` : ""}<button type="button" class="${this.actions.say ? "ghost" : "primary"}" data-act="ask">${esc(t.ask)}</button>` : "";

    body.innerHTML = `<nav class="ccrumbs" aria-label="${esc(t.title)}">${crumbs}</nav>
      <div class="cwrap">
        <div class="csky" role="group" aria-label="${esc(f.title)}">
          <svg class="clines" aria-hidden="true"></svg>
          <button type="button" class="cnode center c-${esc(f.category)}" data-id="${esc(f.id)}" aria-describedby="cdetail"><b>${esc(f.title)}</b><small>${esc(t.cat[f.category] || f.category)}</small></button>
          ${kids.map((k, i) => `<button type="button" class="cnode c-${esc(k.category)}" style="--i:${i}" data-id="${esc(k.id)}"><b>${esc(k.title)}</b><small>${esc(this.sub(k))}</small></button>`).join("")}
        </div>
        ${pages > 1 ? `<div class="cpager">${this.page > 0 ? `<button type="button" class="ghost" data-page="-1">${esc(t.prev)}</button>` : ""}${this.page < pages - 1 ? `<button type="button" class="ghost" data-page="1">${esc(t.more(all.length - (this.page + 1) * size))}</button>` : ""}</div>` : ""}
        <aside class="cdetail" id="cdetail">
          <span class="pc-tag">${esc(t.cat[f.category] || f.category)}</span>
          <h3>${esc(f.title)}</h3>
          ${f.description ? `<p>${esc(f.description)}</p>` : ""}
          ${!kids.length ? `<p class="jnote">${esc(t.noChildren)}</p>` : ""}
          ${gap ? `<p class="cgap" role="status">${esc(t.insufficient(gap.map((m) => t.gap[m] || m).join(", ")))}</p>` : ""}
          ${action}
          <p class="cref">${esc(t.ref)}: <code>${esc(f.knowledge_reference)}</code></p>
          ${f.id !== g.root ? `<button type="button" class="ghost" data-up="1">${esc(t.up)}</button>` : ""}
        </aside>
      </div>`;
    // พื้นที่วางวงกลมได้น้อยกว่าที่แสดง → ลดจำนวนต่อหน้าแล้ววาดใหม่ (ครั้งเดียว) แทนการให้ Node ทับกัน
    const fit = this.layout(body, kids.length);
    if (fit < kids.length && this.mode === "radial") { this.pageSize = fit; this.page = Math.floor((this.page * size) / fit); return this.render(body, header, alive); }
    this.bind(body, header, alive, f);
    if (this.lastFocus !== f.id) { body.scrollTop = 0; this.lastFocus = f.id; }   // เปลี่ยนชั้น → กลับไปบนสุด (เห็น Breadcrumb)
    if (this.refocus) { this.refocus = false; body.querySelector(".cnode.center").focus({ preventScroll: true }); }
    this.lastRender = { focus: f.id, rendered: body.querySelectorAll(".cnode").length, total: g.nodes.length, ms: +(performance.now() - t0).toFixed(1), layout: this.mode };
  }

  sub(n) {
    const t = this.t;
    const c = (this.graph.kids.get(n.id) || []).length;
    return c ? `${t.cat[n.category] || n.category} · ${t.count(c)}` : t.cat[n.category] || n.category;
  }

  /** วางลูกเป็นวงรอบ Node กลาง แล้ววาดเส้น SVG — คืนจำนวน Node ที่วางได้โดยไม่ทับกัน · พื้นที่แคบ (< 640 px) เปลี่ยนเป็นรายการ */
  layout(body, n) {
    const sky = body.querySelector(".csky");
    const w = sky.clientWidth, h = sky.clientHeight;
    this.mode = w < 640 ? "list" : "radial";
    sky.classList.toggle("clist", this.mode === "list");
    const svg = sky.querySelector(".clines");
    if (this.mode === "list" || !n) { svg.innerHTML = ""; return n; }
    const nodes = [...sky.querySelectorAll(".cnode:not(.center)")];
    const center = sky.querySelector(".cnode.center");
    const bw = nodes[0].offsetWidth, bh = nodes[0].offsetHeight, pad = 8;
    const cx = w / 2, cy = h / 2;
    const rx = Math.max(140, w / 2 - bw / 2 - pad), ry = Math.max(100, h / 2 - bh / 2 - pad);
    const cw = center.offsetWidth, ch = center.offsetHeight;
    const pos = (k, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / k; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; };
    // หาจำนวนสูงสุดที่ไม่ทับกัน (ทั้งกันเองและกับ Node กลาง)
    const fits = (k) => {
      const p = Array.from({ length: k }, (_, i) => pos(k, i));
      for (let i = 0; i < k; i++) {
        if (Math.abs(p[i][0] - cx) < (bw + cw) / 2 + 4 && Math.abs(p[i][1] - cy) < (bh + ch) / 2 + 4) return false;
        for (let j = i + 1; j < k; j++) if (Math.abs(p[i][0] - p[j][0]) < bw + 6 && Math.abs(p[i][1] - p[j][1]) < bh + 6) return false;
      }
      return true;
    };
    let k = n;
    while (k > PAGE_MIN && !fits(k)) k--;
    if (!fits(k)) { this.mode = "list"; sky.classList.add("clist"); svg.innerHTML = ""; return n; }
    if (k < n) return k;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const lines = [];
    nodes.forEach((b, i) => {
      const [x, y] = pos(n, i);
      b.style.left = `${x.toFixed(1)}px`;
      b.style.top = `${y.toFixed(1)}px`;
      lines.push(`<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" style="--i:${i}"/>`);
    });
    svg.innerHTML = lines.join("");
    return n;
  }

  bind(body, header, alive, f) {
    const again = () => this.render(body, header, alive);
    // ผู้ใช้คีย์บอร์ด: หลังเปลี่ยนชั้นให้โฟกัสกลับมาที่ Node กลาง (ไม่หลุดออกจากกราฟ)
    const go = (id) => { if (id && this.graph.byId.has(id)) { if (f.category === "knowledge" && this.actions.stop) this.actions.stop(); this.refocus = body.contains(document.activeElement); this.focus = id; this.page = 0; this.pageSize = PAGE_MAX; this.actions.point && this.actions.point(); again(); } };
    body.querySelectorAll(".cnode:not(.center)").forEach((b) => (b.onclick = () => go(b.dataset.id)));
    body.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
    body.querySelectorAll("[data-page]").forEach((b) => (b.onclick = () => { this.page += +b.dataset.page; again(); }));
    const up = body.querySelector("[data-up]");
    if (up) up.onclick = () => go(this.graph.parent.get(f.id));
    body.querySelectorAll("[data-act]").forEach((act) => (act.onclick = () => {
      if (act.dataset.act === "listen") this.actions.narrate("program", +f.id.split(":")[1]);
      else if (act.dataset.act === "say") this.actions.say(f.description, f);
      else this.actions.ask(f.title);
    }));
    // 27 พ.ย. 2569: ถึงกล่องคำถาม (ใบสุดท้าย) → VORA อ่านคำตอบจากฐานความรู้ของข้อนั้นออกเสียงทันที (ครั้งเดียวต่อการเข้ามา)
    if (f.category === "knowledge" && f.description && this.actions.say && this.lastFocus !== f.id) {
      const box = body.querySelector(".cdetail");
      if (box && box.scrollIntoView) setTimeout(() => box.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
      this.actions.say(f.description, f);
    }
    const sky = body.querySelector(".csky");
    sky.onkeydown = (e) => {
      const nodes = [...sky.querySelectorAll(".cnode")];
      const i = nodes.indexOf(document.activeElement);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); nodes[(i + 1) % nodes.length].focus(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); nodes[(i - 1 + nodes.length) % nodes.length].focus(); }
      else if (e.key === "Backspace") { e.preventDefault(); go(this.graph.parent.get(f.id)); }
      else if (e.key === "Home") { e.preventDefault(); go(this.graph.root); }
    };
  }
}
