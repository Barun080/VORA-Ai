// Presentation View — พื้นที่แสดงข้อมูลแบบขยาย (VORA NEXT Phase 1)
// แสดง Floating Cards จากข้อมูลจริงใน API เดิมเท่านั้น (/api/programs, /api/news, /api/kiosk/config)
// ไม่มีข้อมูล hard-code ของวิทยาลัย: ถ้าไม่มีข้อมูลจะแสดงว่า "ยังไม่มีข้อมูล" แทนการแต่งขึ้น
// คำตอบเชิงเนื้อหา (เช่น การสมัครเรียน) ส่งเป็นคำถามไปที่ AI เดิม (/api/chat) ซึ่งตอบจาก Approved Knowledge Base
// การบรรยายด้วยเสียงใช้ openCard()/ask() เดิมของ app.js (ผ่านลำดับความสำคัญเสียงเดิม)

import { api, esc } from "/shared/api.js";
import { placeText } from "./TimePortalView.js";
import { programIcon } from "./program-icons.js";

const TXT = {
  th: {
    college: "วิทยาลัย", departments: "สาขาวิชา", news: "ข่าวสารและกิจกรรม", admission: "การรับสมัคร",
    collegeLead: "แตะคำถามเพื่อให้ VORA ตอบจากข้อมูลของวิทยาลัย",
    departmentsLead: "แตะสาขาเพื่อดูรายละเอียดและอาชีพหลังเรียนจบ",
    newsLead: "ข่าวและกิจกรรมที่เผยแพร่อยู่ตอนนี้",
    admissionLead: "ข่าวรับสมัครที่เผยแพร่ และคำถามที่พบบ่อย (VORA ตอบจากฐานความรู้ที่อนุมัติแล้ว)",
    admissionQs: ["สมัครเรียนยังไง", "ต้องใช้เอกสารอะไรบ้าง", "ค่าเทอมเท่าไหร่", "มีทุนการศึกษาไหม"],
    admissionNews: "ประกาศรับสมัคร", faq: "คำถามที่พบบ่อย",
    back: "กลับ", close: "ปิด", loading: "กำลังโหลดข้อมูล…", empty: "ยังไม่มีข้อมูลในระบบ", noAdmissionNews: "ยังไม่มีประกาศรับสมัครที่เผยแพร่",
    loadErr: "โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง", retry: "ลองใหม่", careers: "อาชีพหลังเรียนจบ", listen: "ฟัง VORA อธิบาย",
    programsCount: (n) => `เปิดสอน ${n} สาขา`, newsCount: (n) => `ข่าว/กิจกรรม ${n} รายการ`, noDate: "",
    level: "ระดับ",
    // 11 พ.ย. 2569: พรีเซนเทชันสาขา
    sOverview: "รู้จักสาขา", sSuits: "เหมาะกับใคร", sLearn: "เรียนอะไรบ้าง", sCareers: "จบแล้วทำงานอะไร", sGallery: "ภาพบรรยากาศ", sMore: "อยากรู้เพิ่ม",
    guidance: "ข้อมูลแนะแนวจากเอกสารของวิทยาลัย ไม่ใช่รายละเอียดหลักสูตรทางการ · ตรวจสอบรายวิชาจริงกับแผนกวิชา",
    prev: "ก่อนหน้า", next: "ถัดไป", play: "เล่นอัตโนมัติ", pause: "หยุดเล่นอัตโนมัติ", slideOf: (i, n) => `สไลด์ ${i} จาก ${n}`,
    moreQs: (n) => [`สาขา${n}จบแล้วทำงานอะไร`, "สมัครเรียนยังไง", "มีทุนการศึกษาไหม", "ก่อนสมัครควรตรวจสอบอะไรบ้าง"],
    sayOverview: (p) => `มาทำความรู้จักแผนก${p.name_th}กันค่ะ${p.department ? ` อยู่ใน${p.department}` : ""}`,
    saySuits: (p) => `แผนกนี้${p.suits_th}ค่ะ`, sayLearn: (p) => `เรียนและฝึกเรื่อง${p.description_th}ค่ะ`,
    sayCareers: (p) => `จบแล้วมีอาชีพตัวอย่าง เช่น ${p.careers_th} ค่ะ`, sayGallery: () => "นี่คือภาพบรรยากาศของแผนกค่ะ",
    sayMore: () => "อยากรู้อะไรเพิ่ม แตะคำถามหรือถามหนูได้เลยค่ะ", groupOther: "สาขาอื่น ๆ",
  },
  en: {
    college: "College", departments: "Departments", news: "News & events", admission: "Admission",
    collegeLead: "Tap a question and VORA will answer from the college's data.",
    departmentsLead: "Tap a program for details and careers.",
    newsLead: "Currently published news and events.",
    admissionLead: "Published admission news and common questions (answered from the approved knowledge base).",
    admissionQs: ["How do I apply?", "What documents do I need?", "How much is tuition?", "Are there scholarships?"],
    admissionNews: "Admission announcements", faq: "Common questions",
    back: "Back", close: "Close", loading: "Loading…", empty: "No data in the system yet", noAdmissionNews: "No published admission announcements yet",
    loadErr: "Could not load data. Please try again.", retry: "Retry", careers: "Careers", listen: "Hear VORA explain",
    programsCount: (n) => `${n} programs`, newsCount: (n) => `${n} news & events`, noDate: "",
    level: "Level",
    sOverview: "Meet the program", sSuits: "Who it suits", sLearn: "What you learn", sCareers: "Careers", sGallery: "Gallery", sMore: "Want to know more?",
    guidance: "Guidance information from the college's documents, not the official curriculum · check actual subjects with the department",
    prev: "Previous", next: "Next", play: "Auto-play", pause: "Pause auto-play", slideOf: (i, n) => `Slide ${i} of ${n}`,
    moreQs: (n) => [`What jobs can I get after ${n}?`, "How do I apply?", "Are there scholarships?", "What should I check before applying?"],
    sayOverview: (p) => `Let's get to know ${p.name_en || p.name_th}.`,
    saySuits: (p) => `This program suits ${(p.suits_en || "").replace(/^People/, "people").replace(/\.$/, "")}.`,
    sayLearn: (p) => `You learn ${(p.description_en || "").replace(/^./, (c) => c.toLowerCase())}`,
    sayCareers: (p) => `Example careers: ${p.careers_en}`, sayGallery: () => "Here are some photos of the department.",
    sayMore: () => "Want to know more? Tap a question or just ask me.", groupOther: "Other programs",
  },
};

/** วันที่จากฐานข้อมูลเป็นเวลาท้องถิ่น (Asia/Bangkok) แบบไม่มี timezone — แสดงเฉพาะวันที่ ไม่แปลงเขตเวลา */
export function formatDate(value, lang) {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return "";
  const y = +m[1] >= 2400 ? +m[1] - 543 : +m[1];          // 27 พ.ย. 2569: บันทึกเป็นปี พ.ศ. → แปลงก่อน (เดิมแสดงปี 3112)
  if (y < 1900) return "";
  const d = new Date(Date.UTC(y, +m[2] - 1, +m[3]));
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

/** เวลาจาก event_date (เวลาท้องถิ่น) · 00:00 = ไม่ระบุเวลา -> "" (Phase 5 D2) */
export function eventTime(value, lang) {
  const m = /T(\d{2}):(\d{2})/.exec(String(value || ""));
  if (!m || (m[1] === "00" && m[2] === "00")) return "";
  return lang === "en" ? `${m[1]}:${m[2]}` : `${m[1]}:${m[2]} น.`;
}

/** 27 พ.ย. 2569: ข่าวที่ยังไม่มีรูป → ภาพปกตามประเภท (ไม่ใช่รูปจริง · เจ้าหน้าที่อัปโหลดรูปข่าวในหลังบ้านแล้วจะแสดงรูปจริงแทน) */
export function newsCover(kind) {
  const k = ["news", "activity", "admission"].includes(kind) ? kind : "news";
  return { k, e: { news: "📰", activity: "🎉", admission: "📝" }[k] };
}

export class PresentationView {
  /**
   * root: <section id="present"> · actions: { ask(text), narrate(type, id), cfg(), t(key) } · onClose()
   */
  constructor(root, { actions, onClose, lang = "th", journey = null, constellation = null, timeline = null } = {}) {
    this.root = root;
    this.timeline = timeline;           // Phase 5: TimePortalView (ปฏิทินกิจกรรม)
    this.constellation = constellation;   // Phase 4: ConstellationView (แผนผังความรู้)
    this.journey = journey;     // Phase 3: JourneyView (เส้นทางการสมัคร)
    this.actions = actions;
    this.onClose = onClose || (() => {});
    this.lang = lang;
    this.section = null;
    this.detail = null;
    this.seq = 0;           // กันผลจากคำขอเก่าแสดงทับหมวดใหม่
    this.title = root.querySelector(".present-title");
    this.lead = root.querySelector(".present-lead");
    this.body = root.querySelector(".present-body");
    this.backBtn = root.querySelector(".present-back");
    this.closeBtn = root.querySelector(".present-close");
    this.resumeBtn = root.querySelector(".present-resume");
    if (this.resumeBtn) this.resumeBtn.addEventListener("click", () => this.actions.openSection("journey"));
    this.backBtn.addEventListener("click", () => this.back());
    this.closeBtn.addEventListener("click", () => this.onClose("button"));
    root.addEventListener("keydown", (e) => {
      // ไม่หยุด propagation: Esc ยังส่งต่อไปปุ่มหยุดเดิมของ app.js (หยุดเสียง + /api/robot/stop) เสมอ
      if (e.key === "Escape") { if (this.detail) this.back(); else this.onClose("escape"); }
    });
    this.setLang(lang);
  }

  has(section) {
    return ["college", "departments", "news", "admission"].includes(section) || (section === "journey" && !!this.journey)
      || (section === "constellation" && !!this.constellation) || (section === "timeline" && !!this.timeline);
  }
  get t() { return TXT[this.lang]; }

  setLang(lang) {
    this.lang = lang === "en" ? "en" : "th";
    this.backBtn.querySelector("span").textContent = this.t.back;
    this.closeBtn.querySelector("span").textContent = this.t.close;
    if (this.journey) this.journey.setLang(this.lang);
    if (this.constellation) this.constellation.setLang(this.lang);
    if (this.timeline) this.timeline.setLang(this.lang);
    if (this.section) this.render();
  }

  open(section) {
    // เปลี่ยนไปดูหัวข้ออื่นระหว่างเส้นทาง = เส้นทางยังอยู่ กลับมาทำต่อได้ (Phase 3)
    if (this.journey && section !== "journey" && this.section === "journey" && this.journey.engine.active) this.journey.engine.detour();
    this.section = section;
    this.detail = null;
    this.root.hidden = false;
    this.root.dataset.section = section;
    this.render();
    // ย้ายโฟกัสเข้าพื้นที่นำเสนอ (ผู้ใช้คีย์บอร์ด/โปรแกรมอ่านหน้าจอ) — ทันที (Orchestrator แสดงพื้นที่นี้ก่อนเรียก open แล้ว)
    // และซ้ำอีกครั้งในเฟรมถัดไปเผื่อเบราว์เซอร์ยังไม่ได้จัดวาง (เครื่องช้า requestAnimationFrame อาจหน่วงเกิน 1 วิ)
    this.title.focus({ preventScroll: true });
    requestAnimationFrame(() => { if (!this.root.hidden && !this.root.contains(document.activeElement)) this.title.focus({ preventScroll: true }); });
  }

  close() {
    this.seq++;
    this.show = null;
    this.section = null;
    this.detail = null;
    this.root.hidden = true;
    this.body.innerHTML = "";
  }

  back() {
    if (!this.detail) return;
    this.detail = null;
    this.show = null;
    this.render();
  }

  setHeader(title, lead) {
    this.title.textContent = title;
    this.lead.textContent = lead || "";
    this.backBtn.hidden = !this.detail;
  }

  state(kind, msg) {
    this.body.innerHTML = `<div class="present-state ${kind}" role="status">${esc(msg)}${kind === "error" ? ` <button type="button" class="ghost present-retry">${esc(this.t.retry)}</button>` : ""}</div>`;
    const r = this.body.querySelector(".present-retry");
    if (r) r.onclick = () => this.render();
  }

  async render() {
    const seq = ++this.seq;
    const t = this.t, sec = this.section;
    if (!sec) return;
    this.updateResume();
    if (sec === "constellation") {
      this.setHeader("", "");
      try { await this.constellation.render(this.body, (title, lead) => this.setHeader(title, lead), () => seq === this.seq); }
      catch { if (seq === this.seq) this.state("error", t.loadErr); }
      return;
    }
    if (sec === "timeline") {
      this.setHeader("", "");
      try { await this.timeline.render(this.body, (title, lead) => this.setHeader(title, lead), () => seq === this.seq); }
      catch { if (seq === this.seq) this.state("error", t.loadErr); }
      return;
    }
    if (sec === "journey") {
      this.setHeader("", "");
      try { await this.journey.render(this.body, (title, lead) => this.setHeader(title, lead), () => seq === this.seq); }
      catch { if (seq === this.seq) this.state("error", t.loadErr); }
      return;
    }
    if (this.detail) return this.renderDetail(seq);
    this.setHeader(t[sec], t[`${sec}Lead`]);
    if (sec === "college") return this.renderCollege(seq);
    this.state("loading", t.loading);
    try {
      if (sec === "departments") {
        const items = await api(`/api/programs?lang=${this.lang}`);
        if (seq !== this.seq) return;
        if (items.length) this.renderPrograms(items);
        else await this.renderKnowledgeDepartments(seq);
      } else {
        const items = await api(`/api/news?limit=20&lang=${this.lang}`);
        if (seq !== this.seq) return;
        if (sec === "news") this.renderNews(items, items);
        else this.renderAdmission(items.filter((n) => n.kind === "admission"));
      }
    } catch {
      if (seq === this.seq) this.state("error", t.loadErr);
    }
  }

  async renderCollege(seq) {
    const t = this.t;
    const cfg = this.actions.cfg() || {};
    const name = this.lang === "en" ? cfg.school_name_en : cfg.school_name_th;
    if (name) this.title.textContent = name;
    const qs = this.actions.t("aboutQs") || [];
    this.body.innerHTML = `${this.mapEntry()}<div class="pcards qa-grid">${qs.map((q, i) => `<button type="button" class="pcard qa" style="--i:${i}" data-q="${esc(q)}"><span class="pc-t">${esc(q)}</span></button>`).join("")}</div>
      <p class="present-facts" aria-live="polite"></p>`;
    this.body.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => this.actions.ask(b.dataset.q)));
    this.bindMapEntry();
    // ตัวเลขจริงจากฐานข้อมูล (ไม่แสดงถ้าโหลดไม่ได้)
    try {
      const [programs, news] = await Promise.all([api(`/api/programs?lang=${this.lang}`), api(`/api/news?limit=50&lang=${this.lang}`)]);
      if (seq !== this.seq) return;
      const facts = this.body.querySelector(".present-facts");
      if (facts) facts.textContent = `${t.programsCount(programs.length)} · ${t.newsCount(news.length)}`;
    } catch { /* ไม่แสดงตัวเลข */ }
  }

  card({ type, id, title, sub, tag, image, icon, cover }, i) {
    return `<button type="button" class="pcard${icon && !image ? " has-ico" : ""}" style="--i:${i}" data-type="${type}" data-id="${id}">
      ${image ? `<span class="pc-img" style="--img:url('${esc(image)}')"><img src="${esc(image)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('pc-broken');this.remove()"></span>`
        : icon ? `<span class="pc-ico">${icon}</span>`
        : cover ? `<span class="pc-img pc-cover pc-k-${esc(cover.k)}" aria-hidden="true"><i>${cover.e}</i></span>` : ""}
      <span class="pc-body">${tag ? `<span class="pc-tag">${esc(tag)}</span>` : ""}<span class="pc-t">${esc(title)}</span>${sub ? `<span class="pc-s">${esc(sub)}</span>` : ""}</span>
    </button>`;
  }

  bindCards() {
    this.body.querySelectorAll(".pcard[data-id]").forEach((b) => (b.onclick = () => {
      this.detail = { type: b.dataset.type, id: +b.dataset.id };
      this.render();
    }));
  }

  /** 10 พ.ย. 2569: ยังไม่มีสาขาในตาราง programs (เช่น นำเข้าข้อมูลวิทยาลัยจริงเป็นฐานความรู้ และซ่อนสาขาสาธิตแล้ว)
   *  → แสดงแผนกจากฐานความรู้ที่อนุมัติแล้ว (หมวด program คำถาม "แผนก…เรียนอะไร") แตะแล้วถาม AI เดิม (ตอบจากฐานความรู้ + เสียง)
   *  ไม่สร้างข้อมูลใหม่ ไม่เดา — ไม่มีรายการเลยจึงแสดง "ยังไม่มีข้อมูล" */
  async renderKnowledgeDepartments(seq) {
    const g = await api(`/api/constellation?lang=th`);
    if (seq !== this.seq) return;
    const inTopic = new Set((g.edges || []).filter((e) => e.source === "topic:program").map((e) => e.target));
    const depts = [];
    for (const n of g.nodes || []) {
      if (!inTopic.has(n.id)) continue;
      const m = /^แผนก\s*(.+?)\s*เรียน(?:อะไร|เกี่ยวกับอะไร)/.exec(n.title || "");
      if (m && !depts.some((d) => d.name === m[1])) depts.push({ name: m[1], q: n.title });
    }
    if (!depts.length) return this.state("empty", this.t.empty);
    this.lead.textContent = this.lang === "en" ? "From the college knowledge base · tap a department and VORA will explain" : "จากฐานความรู้ของวิทยาลัย · แตะแผนกแล้ว VORA จะอธิบายให้ฟัง";
    this.body.innerHTML = `${this.mapEntry()}<div class="pcards qa-grid">${depts.map((d, i) =>
      `<button type="button" class="pcard qa" style="--i:${i}" data-q="${esc(d.q)}"><span class="pc-t">${esc("แผนก" + d.name)}</span></button>`).join("")}</div>`;
    this.body.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => this.actions.ask(b.dataset.q)));
    this.bindMapEntry();
  }

  renderPrograms(items) {
    if (!items.length) return this.state("empty", this.t.empty);
    // 11 พ.ย. 2569: สาขาที่ไม่ระบุระดับ (ข้อมูลจริงของวิทยาลัย) จัดกลุ่มตามกลุ่มแผนกแทน ไม่แสดงหัวข้อ "ระดับ" ว่าง
    const byLevel = items.some((p) => p.level);
    const key = (p) => (byLevel ? p.level || "" : p.department || "");
    const label = (k) => (byLevel ? (k ? `${this.t.level} ${k}` : this.t.groupOther) : k || this.t.groupOther);
    const groups = [...new Set(items.map(key))];
    let i = 0;
    this.body.innerHTML = this.mapEntry() + groups.map((g) => `<h3 class="pgroup">${esc(label(g))}</h3><div class="pcards">${items.filter((p) => key(p) === g)
      .map((p) => this.card({ type: "program", id: p.id, title: this.lang === "en" ? p.name_en || p.name_th : p.name_th,
        sub: this.lang === "en" ? (byLevel ? p.department : p.name_th) : (byLevel ? p.department : p.name_en), image: p.image, icon: programIcon(p, 40) }, i++)).join("")}</div>`).join("");
    this.bindCards();
    this.bindMapEntry();
  }

  newsCards(items) {
    const kinds = this.actions.t("kinds") || {};
    return items.map((n, i) => this.card({ type: "news", id: n.id, title: this.lang === "en" && n.title_en ? n.title_en : n.title_th || n.title,
      sub: formatDate(n.event_date, this.lang), tag: kinds[n.kind] || n.kind, image: n.image, cover: newsCover(n.kind) }, i)).join("");
  }

  /** 27 พ.ย. 2569: ข่าวเด่น = ข่าวสำคัญสุดที่มีรูป (ภาพใหญ่) · ที่เหลือ: มีรูปก่อน แล้วเรียงวันที่ใหม่ → เก่า */
  arrangeNews(items) {
    const ts = (n) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(n.event_date || n.publish_at || "")); if (!m) return 0;
      return Date.UTC(+m[1] >= 2400 ? +m[1] - 543 : +m[1], +m[2] - 1, +m[3]); };
    const withImg = items.filter((n) => n.image).sort((a, b) => (b.priority || 0) - (a.priority || 0) || ts(b) - ts(a));
    const hero = withImg[0] || null;
    const rest = items.filter((n) => n !== hero).sort((a, b) => !!b.image - !!a.image || ts(b) - ts(a) || (b.priority || 0) - (a.priority || 0));   // มีรูปก่อน แล้วใหม่ → เก่า
    return { hero, rest };
  }

  heroCard(n) {
    const kinds = this.actions.t("kinds") || {};
    const title = this.lang === "en" && n.title_en ? n.title_en : n.title_th || n.title;
    const body = String((this.lang === "en" && n.body_en ? n.body_en : n.body_th) || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
    return `<button type="button" class="pcard news-hero" data-type="news" data-id="${n.id}">
      <span class="nh-img" style="--img:url('${esc(n.image)}')"><img src="${esc(n.image)}" alt="" onerror="this.closest('.news-hero').classList.add('nh-noimg');this.remove()"></span>
      <span class="nh-body"><span class="pc-tag">${esc(kinds[n.kind] || n.kind)}</span><span class="nh-badge">${this.lang === "en" ? "Featured" : "ข่าวเด่น"}</span>
        <span class="nh-t">${esc(title)}</span><span class="pc-s">${esc(formatDate(n.event_date || n.publish_at, this.lang))}</span>
        <span class="nh-p">${esc(body.slice(0, 160))}${body.length > 160 ? "…" : ""}</span></span>
    </button>`;
  }

  renderNews(items) {
    if (!items.length && !this.timeline) return this.state("empty", this.t.empty);
    if (!items.length) { this.body.innerHTML = `${this.timelineEntry()}<div class="present-state empty" role="status">${esc(this.t.empty)}</div>`; return this.bindTimelineEntry(); }
    const { hero, rest } = this.arrangeNews(items);
    this.body.innerHTML = `${this.timelineEntry()}${hero ? this.heroCard(hero) : ""}<div class="pcards news-grid">${this.newsCards(rest)}</div>`;
    this.bindCards();
    this.bindTimelineEntry();
  }

  /** Phase 5: ปุ่มเปิดปฏิทินกิจกรรม (Time Portal) ในหมวดข่าวสารและกิจกรรม */
  timelineEntry() {
    if (!this.timeline) return "";
    const label = this.lang === "en" ? "Open the event calendar" : "ดูปฏิทินกิจกรรม";
    return `<div class="jentry"><button type="button" class="ghost tp-open" data-open-timeline="1">📅 ${esc(label)}</button></div>`;
  }

  bindTimelineEntry() {
    const b = this.body.querySelector("[data-open-timeline]");
    if (b) b.onclick = () => { this.timeline.reset(); this.actions.openSection("timeline"); };
  }

  renderAdmission(items) {
    const t = this.t;
    const news = items.length ? `<div class="pcards">${this.newsCards(items)}</div>` : `<div class="present-state empty" role="status">${esc(t.noAdmissionNews)}</div>`;
    this.body.innerHTML = `${this.journey ? this.journey.entryHtml() : ""}<h3 class="pgroup">${esc(t.admissionNews)}</h3>${news}
      <h3 class="pgroup">${esc(t.faq)}</h3><div class="pcards qa-grid">${t.admissionQs.map((q, i) => `<button type="button" class="pcard qa" style="--i:${i}" data-q="${esc(q)}"><span class="pc-t">${esc(q)}</span></button>`).join("")}</div>`;
    this.bindCards();
    this.body.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => this.actions.ask(b.dataset.q)));
    this.body.querySelectorAll("[data-journey]").forEach((b) => (b.onclick = () => {
      if (b.dataset.journey !== "resume") { this.journey.engine.start(); this.journey.spokenStep = -1; }
      this.actions.openSection("journey");
    }));
  }

  // ================================================================ พรีเซนเทชันสาขา (11 พ.ย. 2569)
  /** สไลด์: รู้จักสาขา → เหมาะกับใคร → เรียนอะไรบ้าง → จบแล้วทำงานอะไร → ภาพบรรยากาศ (ถ้ามี) → อยากรู้เพิ่ม
   *  VORA บรรยายทีละสไลด์และเลื่อนเองเมื่อพูดจบ (เล่นอัตโนมัติ) · แตะเลื่อนเอง = หยุดเล่นอัตโนมัติ · ข้อความจาก /api/programs เท่านั้น */
  renderProgramShow(p, seq) {
    const t = this.t, en = this.lang === "en";
    const pick = (th, eng) => (en ? eng || th : th) || "";
    const name = pick(p.name_th, p.name_en);
    const words = (s) => String(s || "").split(/\s+/).map((w) => w.replace(/^และ/, "").trim()).filter(Boolean);
    const list = (s) => (en ? String(s || "").replace(/\.$/, "").split(/,\s*(?:and\s+)?|\s+and\s+/) : words(s)).map((x) => x.trim()).filter(Boolean);
    const chips = (arr, cls = "") => `<ul class="pchips ${cls}">${arr.map((x, i) => `<li style="--i:${i}">${esc(x)}</li>`).join("")}</ul>`;
    const visual = p.image ? `<img src="${esc(p.image)}" alt="">` : programIcon(p, 140);
    const photos = [p.image, ...(p.gallery || [])].filter(Boolean);
    const slides = [
      { id: "overview", say: t.sayOverview(p), html: `<div class="ps-hero"><div class="ps-visual${p.image ? " photo" : ""}">${visual}</div>
          <div class="ps-txt"><span class="ps-kicker">${esc(t.sOverview)}</span><h3 class="ps-name">${esc(name)}</h3>
          <p class="ps-alt">${esc(en ? p.name_th : p.name_en || "")}</p>${p.department ? `<span class="ps-tag">${esc(p.department)}</span>` : ""}${p.level ? `<span class="ps-tag">${esc(p.level)}</span>` : ""}</div></div>` },
    ];
    const suits = pick(p.suits_th, p.suits_en);
    if (suits) slides.push({ id: "suits", say: t.saySuits(p), html: `<div class="ps-block"><span class="ps-kicker">${esc(t.sSuits)}</span><p class="ps-big">${esc(suits)}</p></div>` });
    const learn = pick(p.description_th, p.description_en);
    if (learn) slides.push({ id: "learn", say: t.sayLearn(p), html: `<div class="ps-block"><span class="ps-kicker">${esc(t.sLearn)}</span>${chips(list(learn))}</div>` });
    const careers = pick(p.careers_th, p.careers_en);
    if (careers) slides.push({ id: "careers", say: t.sayCareers(p), html: `<div class="ps-block"><span class="ps-kicker">${esc(t.sCareers)}</span>${chips(list(careers), "career")}</div>` });
    if (photos.length > (p.image ? 1 : 0) || p.video) slides.push({ id: "gallery", say: t.sayGallery(), html: `<div class="ps-block"><span class="ps-kicker">${esc(t.sGallery)}</span>
        <div class="ps-gallery">${p.video ? `<video src="${esc(p.video)}" controls muted playsinline></video>` : ""}${photos.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join("")}</div></div>` });
    slides.push({ id: "more", say: t.sayMore(), html: `<div class="ps-block"><span class="ps-kicker">${esc(t.sMore)}</span>
        <div class="pcards qa-grid">${t.moreQs(name).map((q, i) => `<button type="button" class="pcard qa" style="--i:${i}" data-q="${esc(q)}"><span class="pc-t">${esc(q)}</span></button>`).join("")}</div></div>` });

    this.title.textContent = name;
    this.lead.textContent = [p.department, p.level].filter(Boolean).join(" · ");
    this.body.innerHTML = `<article class="pshow" aria-roledescription="carousel">
        <div class="ps-stage">${slides.map((s, i) => `<section class="ps-slide" data-i="${i}" ${i ? "hidden" : ""} aria-roledescription="slide" aria-label="${esc(t.slideOf(i + 1, slides.length))}">${s.html}</section>`).join("")}</div>
        <nav class="ps-nav">
          <button type="button" class="ghost ps-prev" aria-label="${esc(t.prev)}">‹</button>
          <div class="ps-dots">${slides.map((s, i) => `<button type="button" class="ps-dot" data-go="${i}" aria-label="${esc(t.slideOf(i + 1, slides.length))}"></button>`).join("")}</div>
          <button type="button" class="ghost ps-next" aria-label="${esc(t.next)}">›</button>
          <button type="button" class="ghost ps-play" aria-pressed="true"></button>
        </nav>
        <p class="ps-note">${esc(t.guidance)}</p>
      </article>`;
    const show = { i: -1, auto: true, gen: 0 };
    this.show = show;
    const root = this.body.querySelector(".pshow");
    const playBtn = root.querySelector(".ps-play");
    const setPlay = (on) => { show.auto = on; playBtn.setAttribute("aria-pressed", String(on)); playBtn.textContent = on ? "❚❚" : "▶"; playBtn.setAttribute("aria-label", on ? t.pause : t.play); };
    const go = async (i, { speak = true } = {}) => {
      if (seq !== this.seq || this.show !== show) return;
      i = Math.max(0, Math.min(slides.length - 1, i));
      show.i = i;
      const gen = ++show.gen;
      root.querySelectorAll(".ps-slide").forEach((el) => { el.hidden = +el.dataset.i !== i; });
      root.querySelectorAll(".ps-dot").forEach((el) => el.setAttribute("aria-current", String(+el.dataset.go === i)));
      root.querySelector(".ps-prev").disabled = i === 0;
      root.querySelector(".ps-next").disabled = i === slides.length - 1;
      if (!speak || !this.actions.say) return;
      const done = await this.actions.say(slides[i].say);
      if (!done || gen !== show.gen || seq !== this.seq || this.show !== show || !show.auto) return;
      if (i < slides.length - 1) setTimeout(() => { if (gen === show.gen && show.auto && seq === this.seq) go(i + 1); }, 900);
      else setPlay(false);
    };
    const manual = (i) => { setPlay(false); go(i); };
    root.querySelector(".ps-prev").onclick = () => manual(show.i - 1);
    root.querySelector(".ps-next").onclick = () => manual(show.i + 1);
    root.querySelectorAll(".ps-dot").forEach((b) => (b.onclick = () => manual(+b.dataset.go)));
    playBtn.onclick = () => { const on = !show.auto; setPlay(on); if (on) go(show.i >= slides.length - 1 ? 0 : show.i); };
    root.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { setPlay(false); this.actions.ask(b.dataset.q); }));
    // ปัดซ้าย-ขวาบนจอสัมผัส
    let x0 = null;
    root.querySelector(".ps-stage").addEventListener("pointerdown", (e) => { x0 = e.clientX; });
    root.querySelector(".ps-stage").addEventListener("pointerup", (e) => { if (x0 !== null && Math.abs(e.clientX - x0) > 60) manual(show.i + (e.clientX < x0 ? 1 : -1)); x0 = null; });
    root.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") manual(show.i + 1); if (e.key === "ArrowLeft") manual(show.i - 1); });
    // เตรียมเสียงทุกสไลด์ล่วงหน้า (เดิมดาวน์โหลดเสียงตอนจะพูด → เงียบ/ดีเลย์ระหว่างสไลด์)
    if (this.actions.prefetch) this.actions.prefetch(slides.slice(1).map((x) => x.say));   // สไลด์แรกพูดทันที (สตรีม) ไม่ต้องเตรียม
    setPlay(true);
    go(0);
  }

  /** สาขาที่หน้าจอกำลังแสดงอยู่ (ใช้เป็นบริบทของคำถาม "สาขานี้…") หรือ null
   *  เส้นทาง: เลือกสาขาแล้วและอยู่ขั้นสาขาเป็นต้นไป · รายละเอียดสาขา · แผนผัง: โฟกัสที่สาขา/อาชีพของสาขา */
  currentProgramId() {
    if (this.root.hidden || !this.section) return null;
    if (this.section === "journey" && this.journey) {
      const e = this.journey.engine;
      const idx = e.steps.findIndex((x) => x.choice === "programId");
      return e.active && e.choices.programId !== undefined && e.state.step >= idx ? e.choices.programId : null;
    }
    if (this.section === "constellation" && this.constellation) {
      const m = /^(?:program|career):(\d+)$/.exec(this.constellation.focus || "");
      return m ? +m[1] : null;
    }
    if (this.detail && this.detail.type === "program") return this.detail.id;
    return null;
  }

  /** Phase 4: ปุ่มเปิดแผนผังความรู้ (ในหมวดวิทยาลัยและสาขาวิชา) */
  mapEntry() {
    if (!this.constellation) return "";
    const label = this.lang === "en" ? "Explore the knowledge map" : "ดูแผนผังความรู้";
    return `<div class="jentry"><button type="button" class="ghost cmap-open" data-open-map="1">✦ ${esc(label)}</button></div>`;
  }

  bindMapEntry() {
    const b = this.body.querySelector("[data-open-map]");
    if (b) b.onclick = () => { this.constellation.reset(); this.actions.openSection("constellation"); };
  }

  /** ป้าย "ทำต่อ" บนหัวพื้นที่นำเสนอ เมื่อมีเส้นทางค้างอยู่และกำลังดูหัวข้ออื่น */
  updateResume() {
    if (!this.resumeBtn) return;
    const e = this.journey && this.journey.engine;
    const show = !!e && e.active && !e.expired() && this.section !== "journey";
    this.resumeBtn.hidden = !show;
    if (show) this.resumeBtn.querySelector("span").textContent = this.journey.t.resume(e.progress().index + 1, this.journey.t.steps[e.step.id]);
  }

  async renderDetail(seq) {
    const t = this.t, d = this.detail;
    this.setHeader(t[this.section], "");
    this.state("loading", t.loading);
    try {
      const it = await api(d.type === "program" ? `/api/programs/${d.id}` : `/api/news/${d.id}`);
      if (seq !== this.seq) return;
      const en = this.lang === "en";
      if (d.type === "program") return this.renderProgramShow(it, seq);
      let title, sub, text, extra = "";
      if (d.type === "program") {
        title = en ? it.name_en || it.name_th : it.name_th;
        sub = [it.level, it.department].filter(Boolean).join(" · ");
        text = en ? it.description_en || it.description_th : it.description_th;
        const careers = en ? it.careers_en || it.careers_th : it.careers_th;
        if (careers) extra = `<h4>${esc(t.careers)}</h4><p>${esc(careers)}</p>`;
      } else {
        title = en && it.title_en ? it.title_en : it.title_th;
        sub = [(this.actions.t("kinds") || {})[it.kind] || it.kind, formatDate(it.event_date, this.lang), eventTime(it.event_date, this.lang)].filter(Boolean).join(" · ");
        text = en && it.body_en ? it.body_en : it.body_th;
        // 27 พ.ย. 2569: บรรทัด "เอกสารแนบ: https://…" / "ที่มา: https://…" → คิวอาร์ให้สแกนเปิดบนมือถือ (ไม่แสดงลิงก์ยาวกลางข้อความ)
        const links = [];
        text = String(text || "").split("\n").filter((line) => {
          const m = /^\s*([^:：]{0,30})[:：]\s*(https?:\/\/\S+)\s*$/.exec(line) || /^\s*()(https?:\/\/\S+)\s*$/.exec(line);
          if (m && links.length < 3) { links.push({ label: m[1].trim() || (en ? "Link" : "ลิงก์"), url: m[2] }); return false; }
          return true;
        }).join("\n").trim();
        if (links.length && this.actions.qr) extra += `<div class="pd-links">${links.map((l) => `<div class="pd-link"><span class="qr">${this.actions.qr(l.url)}</span>
          <span><b>${esc(l.label)}</b><small>${esc(en ? "Scan to open on your phone" : "สแกนเพื่อเปิดบนมือถือ")}</small></span></div>`).join("")}</div>`;
        // Phase 5: สถานที่ตามที่เจ้าหน้าที่บันทึก (ไม่มี = "ไม่ระบุสถานที่") — แสดงเฉพาะข่าวที่มีวันจัดกิจกรรมหรือมีสถานที่
        if (it.event_date || it.location_type) extra = `<p class="pd-place">📍 ${esc(placeText(it, this.lang).text)}</p>` + extra;
      }
      this.title.textContent = title;
      this.lead.textContent = sub;
      // 12 พ.ย. 2569: ภาพหลัก + ภาพเพิ่มเติม (gallery) → สไลด์ภาพ เลื่อนเองทุก 5 วิ แตะลูกศร/จุดเพื่อเลือกภาพ
      const imgs = [it.image, ...(it.gallery || [])].filter((x, i, a) => x && a.indexOf(x) === i);
      const media = !imgs.length ? "" : imgs.length === 1 ? `<div class="pd-img"><img src="${esc(imgs[0])}" alt=""></div>`
        : `<div class="pd-img pd-slides" data-n="${imgs.length}">${imgs.map((u, i) => `<img src="${esc(u)}" alt="" class="${i ? "" : "on"}" loading="${i ? "lazy" : "eager"}">`).join("")}
          <button type="button" class="pd-nav prev" aria-label="‹">‹</button><button type="button" class="pd-nav next" aria-label="›">›</button>
          <div class="pd-dots">${imgs.map((_, i) => `<button type="button" class="${i ? "" : "on"}" data-k="${i}" aria-label="${i + 1}"></button>`).join("")}</div></div>`;
      this.body.innerHTML = `<article class="pdetail">
        ${media}
        <div class="pd-text"><p>${esc(text || t.empty)}</p>${extra}
          <button type="button" class="primary pd-listen"><span>${esc(t.listen)}</span></button></div>
      </article>`;
      this.body.querySelector(".pd-listen").onclick = () => this.actions.narrate(d.type, d.id);
      const sl = this.body.querySelector(".pd-slides");
      if (sl) {
        let k = 0, timer = null;
        const go = (i) => {
          const pics = sl.querySelectorAll("img"), dots = sl.querySelectorAll(".pd-dots button");
          k = (i + pics.length) % pics.length;
          pics.forEach((x, j) => x.classList.toggle("on", j === k));
          dots.forEach((x, j) => x.classList.toggle("on", j === k));
        };
        const auto = () => { clearInterval(timer); timer = setInterval(() => { if (!sl.isConnected || seq !== this.seq) return clearInterval(timer); go(k + 1); }, 5000); };
        sl.querySelector(".prev").onclick = () => { go(k - 1); auto(); };
        sl.querySelector(".next").onclick = () => { go(k + 1); auto(); };
        sl.querySelectorAll(".pd-dots button").forEach((b) => (b.onclick = () => { go(+b.dataset.k); auto(); }));
        sl.querySelectorAll("img").forEach((img) => (img.onerror = () => { img.remove(); }));
        auto();
      }
      // ให้ VORA บรรยายทันทีที่เปิดรายละเอียด (ใช้ openCard เดิม: เสียง + ท่าทาง + ลำดับความสำคัญ)
      this.actions.narrate(d.type, d.id);
    } catch {
      if (seq === this.seq) this.state("error", t.loadErr);
    }
  }
}
