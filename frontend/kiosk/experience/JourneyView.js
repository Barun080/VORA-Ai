// Journey View — แสดง Conversation Journey ในพื้นที่นำเสนอ (VORA NEXT Phase 3)
// ทุกตัวเลือก/ข้อความเกี่ยวกับวิทยาลัยมาจาก API จริง: /api/programs, /api/programs/{id}, /api/news และ /api/chat (ฐานความรู้ที่อนุมัติ)
// ข้อความในไฟล์นี้เป็นเพียง "คำแนะนำการใช้งาน" ไม่ใช่ข้อมูลของวิทยาลัย
// ไม่มีข้อมูลยืนยัน → แจ้งตรง ๆ และเสนอช่องทางติดต่อเจ้าหน้าที่ (คำตอบของ AI เดิม)

import { api, esc } from "/shared/api.js";

const TXT = {
  th: {
    title: "เส้นทางการสมัครเรียน", start: "เริ่มเส้นทางการสมัครเรียน", resume: (n, t) => `ทำต่อ: ขั้นที่ ${n} ${t}`, restart: "เริ่มใหม่",
    steps: { level: "ระดับการศึกษา", department: "แผนกวิชา", program: "สาขาวิชา", career: "อาชีพ", apply: "การสมัคร", handoff: "เอกสารรับสมัคร" },
    lead: {
      level: "เลือกระดับการศึกษาที่สนใจ", department: (lv) => (lv ? `แผนกวิชาที่เปิดสอนในระดับ ${lv}` : "เลือกกลุ่มแผนกวิชาที่สนใจ"), program: (d) => `สาขาในแผนก${d}`,
      career: "ดูรายละเอียดหลักสูตรและอาชีพหลังเรียนจบ", apply: "ข้อมูลการสมัครจากประกาศและฐานความรู้ของวิทยาลัย", handoff: "พิมพ์หรือดาวน์โหลดเอกสารรับสมัคร และดูข้อมูลสาขาต่อบนมือถือ",
    },
    say: {
      level: "มาเริ่มกันค่ะ สนใจเรียนระดับไหนคะ", department: "เลือกแผนกที่สนใจได้เลยค่ะ", program: "แผนกนี้มีสาขาเหล่านี้ค่ะ",
      career: (p) => `มาดูกันค่ะว่าสาขา${p}เรียนอะไร และจบแล้วทำงานอะไรได้บ้าง`, apply: "ต่อไปเป็นข้อมูลการสมัครค่ะ", handoff: "ขั้นสุดท้ายค่ะ กดพิมพ์เอกสารรับสมัคร หรือสแกนคิวอาร์โค้ดเพื่อดาวน์โหลดบนมือถือได้เลยค่ะ",
    },
    programs: (n) => `${n} สาขา`, back: "ย้อนกลับ", next: "ขั้นถัดไป", suggested: "ขั้นถัดไปที่แนะนำ", step: (i, n) => `ขั้นที่ ${i} จาก ${n}`,
    careers: "อาชีพหลังเรียนจบ", desc: "เรียนอะไร", noCareer: "ยังไม่มีข้อมูลยืนยันเรื่องอาชีพของสาขานี้ในระบบ",
    contactQ: "ติดต่อวิทยาลัยยังไง", askContact: "สอบถามช่องทางติดต่อเจ้าหน้าที่",
    applyQ: "สมัครเรียนยังไง", admissionNews: "ประกาศรับสมัคร", noAdmissionNews: "ยังไม่มีประกาศรับสมัครที่เผยแพร่",
    aiAnswer: "คำตอบจากฐานความรู้", aiNoData: "ไม่มีข้อมูลยืนยัน", loadingAnswer: "VORA กำลังค้นข้อมูล…",
    qrNote: "ลิงก์มีเพียงรหัสสาขา ไม่มีข้อมูลส่วนตัว", done: "จบเส้นทาง", empty: "ยังไม่มีข้อมูลในระบบสำหรับขั้นนี้",
    interject: "ถามเพิ่มได้ตลอด (พิมพ์หรือพูด) — เส้นทางนี้จะรออยู่ที่ขั้นเดิม", chosen: "เลือกแล้ว",
    // 11 พ.ย. 2569
    allLevels: "ดูทุกแผนก", noLevel: "ยังไม่ระบุระดับการศึกษาในระบบ", sayNoLevel: "มาเริ่มกันค่ะ แตะดูทุกแผนกได้เลยค่ะ",
    form: "เอกสารรับสมัคร", formPrint: "พิมพ์เอกสาร", formOpen: "เปิดไฟล์", formScan: "สแกนเพื่อดาวน์โหลดบนมือถือ",
    formNone: "ยังไม่มีไฟล์เอกสารรับสมัครในระบบ", formNoneHint: "เจ้าหน้าที่เพิ่มไฟล์ได้ที่ หลังบ้าน > ตั้งค่า > เอกสารรับสมัคร",
    summary: "พิมพ์ใบสรุปสาขาที่สนใจ", programQr: "ดูข้อมูลสาขานี้บนมือถือ", printedAt: "พิมพ์เมื่อ",
    applyQr: "สแกนเพื่อพิมพ์ใบสมัคร", applyPrint: "พิมพ์ใบสมัครที่นี่", applyOnline: "ขั้นตอนสมัครออนไลน์",
    applyReal: (n) => `ใช้ไฟล์ใบสมัครจริงของวิทยาลัย: ${n}`, applyVora: "ใบสมัครแบบกรอกด้วยมือ (เมื่อเจ้าหน้าที่อัปโหลดไฟล์ใบสมัครจริงในหลังบ้าน คิวอาร์โค้ดนี้จะเปิดไฟล์จริงแทน)",
    summaryTitle: "ใบสรุปสาขาที่สนใจ", summaryNote: "ใบนี้ไม่ใช่ใบสมัคร · นำไปสอบถามงานทะเบียน/ประชาสัมพันธ์ของวิทยาลัย",
  },
  en: {
    title: "Admission journey", start: "Start the admission journey", resume: (n, t) => `Continue: step ${n} ${t}`, restart: "Start over",
    steps: { level: "Level", department: "Department", program: "Program", career: "Careers", apply: "How to apply", handoff: "Application form" },
    lead: {
      level: "Choose an education level", department: (lv) => (lv ? `Departments offering ${lv}` : "Choose a department group"), program: (d) => `Programs in ${d}`,
      career: "What you study and careers after graduating", apply: "Admission info from announcements and the knowledge base", handoff: "Print or download the application form, and continue on your phone",
    },
    say: {
      level: "Let's start. Which level are you interested in?", department: "Pick a department.", program: "Here are the programs in this department.",
      career: (p) => `Let's see what you study in ${p} and the careers it leads to.`, apply: "Next, how to apply.", handoff: "Last step. Print the application form, or scan the QR code to download it on your phone.",
    },
    programs: (n) => `${n} programs`, back: "Back", next: "Next step", suggested: "Suggested next step", step: (i, n) => `Step ${i} of ${n}`,
    careers: "Careers", desc: "What you study", noCareer: "No verified career information for this program yet.",
    contactQ: "How can I contact the college?", askContact: "Ask how to contact staff",
    applyQ: "How do I apply?", admissionNews: "Admission announcements", noAdmissionNews: "No published admission announcements yet",
    aiAnswer: "Answer from the knowledge base", aiNoData: "No verified information", loadingAnswer: "VORA is looking it up…",
    qrNote: "The link only contains the program number — no personal data", done: "Finish", empty: "No data in the system for this step yet",
    interject: "You can ask anything (type or speak) — this journey waits at the same step", chosen: "Selected",
    allLevels: "See all departments", noLevel: "Education levels not specified yet", sayNoLevel: "Let's start. Tap to see all departments.",
    form: "Application form", formPrint: "Print", formOpen: "Open file", formScan: "Scan to download on your phone",
    formNone: "No application form file in the system yet", formNoneHint: "Staff can add it in Admin > Settings > Application form",
    summary: "Print a summary of this program", programQr: "This program on your phone", printedAt: "Printed",
    applyQr: "Scan to print the application form", applyPrint: "Print the form here", applyOnline: "Apply online steps",
    applyReal: (n) => `Uses the college's official form: ${n}`, applyVora: "Fill-by-hand form (once staff upload the official form, this QR opens it instead)",
    summaryTitle: "Program interest summary", summaryNote: "This is not an application form · bring it to the college registration/PR office",
  },
};

export class JourneyView {
  /** engine: JourneyEngine · actions: { query(q) → res, say(text, gesture), narrate(type,id), qr(url) → svg, mobileUrl(), t(key) } */
  constructor(engine, actions) {
    this.engine = engine;
    this.actions = actions;
    this.lang = "th";
    this.programs = null;   // แคชรายการสาขาระหว่างเส้นทาง (ข้อมูลจริงจาก API)
    this.spokenStep = -1;
  }

  get t() { return TXT[this.lang]; }
  setLang(lang) { this.lang = lang === "en" ? "en" : "th"; this.programs = null; }

  /** ปุ่มเริ่ม/ทำต่อ (ใช้ในหน้าการรับสมัคร และป้ายในหมวดอื่น) */
  entryHtml() {
    const t = this.t, e = this.engine;
    if (e.active && !e.expired()) {
      const p = e.progress();
      return `<div class="jentry"><button type="button" class="primary jstart" data-journey="resume">${esc(t.resume(p.index + 1, t.steps[e.step.id]))}</button>
        <button type="button" class="ghost" data-journey="restart">${esc(t.restart)}</button></div>`;
    }
    return `<div class="jentry"><button type="button" class="primary jstart" data-journey="start">${esc(t.start)}</button></div>`;
  }

  async loadPrograms() {
    if (!this.programs) this.programs = await api(`/api/programs?lang=${this.lang}`);
    return this.programs;
  }

  /** วาดขั้นปัจจุบันลงใน body · header(title, lead) ตั้งหัวข้อ · alive() = ยังเป็นการวาดล่าสุดอยู่หรือไม่ */
  async render(body, header, alive) {
    const e = this.engine, t = this.t;
    if (!e.active || e.expired()) e.start();
    const st = e.step, p = e.progress(), c = e.choices;
    const items = await this.loadPrograms();
    if (!alive()) return;
    const prog = c.programId !== undefined ? items.find((x) => x.id === c.programId) : null;
    const lead = typeof t.lead[st.id] === "function" ? t.lead[st.id](st.id === "department" ? c.level : c.department) : t.lead[st.id];
    header(t.title, `${t.step(p.index + 1, p.total)} · ${lead}`);

    let content = "";
    if (st.id === "level") {
      const levels = [...new Set(items.map((x) => x.level).filter(Boolean))];
      // 11 พ.ย. 2569: สาขาจริงของวิทยาลัยยังไม่ระบุระดับ → ตัวเลือกเดียว "ดูทุกแผนก" (เดิมขึ้นว่าไม่มีข้อมูล เส้นทางไปต่อไม่ได้)
      const noLevel = items.filter((x) => !x.level);
      content = this.options([...levels.map((lv) => ({ value: lv, label: lv, sub: t.programs(items.filter((x) => x.level === lv).length), on: c.level === lv })),
        ...(noLevel.length ? [{ value: "", label: levels.length ? t.noLevel : t.allLevels, sub: t.programs(noLevel.length), on: c.level === "" }] : [])]);
    } else if (st.id === "department") {
      const deps = [...new Set(items.filter((x) => x.level === c.level).map((x) => x.department || "—"))];
      content = this.options(deps.map((d) => ({ value: d, label: d, sub: t.programs(items.filter((x) => x.level === c.level && (x.department || "—") === d).length), on: c.department === d })));
    } else if (st.id === "program") {
      const list = items.filter((x) => x.level === c.level && (x.department || "—") === c.department);
      content = this.options(list.map((x) => ({ value: x.id, label: this.lang === "en" ? x.name_en || x.name_th : x.name_th, sub: this.lang === "en" ? x.name_th : x.name_en || x.code, image: x.image, on: c.programId === x.id })));
    } else if (st.id === "career") {
      content = `<div class="jcard" data-slot="career">${esc(t.empty)}</div>`;
    } else if (st.id === "apply") {
      content = `<div data-slot="apply-news"></div><div class="jcard jai" data-slot="apply-ai" role="status">${esc(t.loadingAnswer)}</div>`;
    } else if (st.id === "handoff") {
      // 12 พ.ย. 2569: คิวอาร์โค้ดพาไปหน้าพิมพ์ใบสมัครโดยตรง (ไฟล์จริงถ้าอัปโหลดแล้ว ไม่งั้นใบสมัครแบบกรอกด้วยมือของ VORA)
      const url = this.applyFormUrl(prog), f = this.formInfo();
      const cfg = (this.actions.cfg && this.actions.cfg()) || {};
      const online = (cfg.apply_online || {})[this.lang === "en" ? "en" : "th"];
      content = `<div class="jcard jqr jform"><div class="qr">${this.actions.qr(url) || ""}</div><div><h3>📄 ${esc(t.applyQr)}${prog ? `: ${esc(this.lang === "en" ? prog.name_en || prog.name_th : prog.name_th)}` : ""}</h3>
        <p class="qr-url">${esc(url)}</p><p class="jnote">${esc(f ? t.applyReal(f.name) : t.applyVora)}</p>
        <div class="jform-actions"><button type="button" class="primary" data-jprint="${esc(f ? f.url : `${url}&print=1`)}">🖨 ${esc(t.applyPrint)}</button>
        <button type="button" class="ghost" data-jsummary="1">🖨 ${esc(t.summary)}</button>
        ${online && this.actions.applyOnline ? `<button type="button" class="ghost" data-jonline="1">📝 ${esc(t.applyOnline)}</button>` : ""}</div></div></div>`;
    }

    const sug = e.suggestion();
    body.innerHTML = `${this.timeline()}
      <div class="jstep" data-step="${st.id}">${content}</div>
      <p class="jnote jinterject">${esc(t.interject)}</p>
      <div class="jnav">
        <button type="button" class="ghost" data-jnav="back" ${p.index === 0 ? "disabled" : ""}>${esc(t.back)}</button>
        ${sug ? `<span class="jsug">${esc(t.suggested)}: <b>${esc(t.steps[sug])}</b></span>` : ""}
        ${sug ? `<button type="button" class="primary" data-jnav="next" ${e.canNext() ? "" : "disabled"}>${esc(t.next)}</button>` : `<button type="button" class="primary" data-jnav="done">${esc(t.done)}</button>`}
      </div>`;
    this.bind(body, header, alive);
    this.fill(body, st.id, prog, alive);
    this.explain(st.id, prog);
  }

  options(list) {
    if (!list.length) return `<div class="present-state empty" role="status">${esc(this.t.empty)}</div>`;
    return `<div class="jopts">${list.map((o, i) => `<button type="button" class="jopt${o.on ? " on" : ""}" style="--i:${i}" data-value="${esc(String(o.value))}" aria-pressed="${o.on}">
      ${o.image ? `<img src="${esc(o.image)}" alt="" loading="lazy">` : ""}<b>${esc(o.label)}</b>${o.sub ? `<span>${esc(o.sub)}</span>` : ""}${o.on ? `<i>${esc(this.t.chosen)}</i>` : ""}</button>`).join("")}</div>`;
  }

  timeline() {
    const e = this.engine, p = e.progress();
    return `<ol class="jtl" aria-label="${esc(this.t.title)}">${e.steps.map((s, i) => {
      const cls = i < p.index ? "done" : i === p.index ? "now" : i <= p.maxStep ? "seen" : "";
      return `<li class="${cls}"><button type="button" data-jgo="${i}" ${i <= p.maxStep ? "" : "disabled"} ${i === p.index ? 'aria-current="step"' : ""}><span class="n">${i + 1}</span><span class="l">${esc(this.t.steps[s.id])}</span></button></li>`;
    }).join("")}</ol>`;
  }

  bind(body, header, alive) {
    const e = this.engine;
    const again = () => this.render(body, header, alive);
    body.querySelectorAll(".jopt").forEach((b) => (b.onclick = () => {
      const st = e.step;
      e.choose(st.choice === "programId" ? +b.dataset.value : b.dataset.value);
      again();
    }));
    body.querySelectorAll("[data-jgo]").forEach((b) => (b.onclick = () => { if (e.goTo(+b.dataset.jgo)) again(); }));
    const pb = body.querySelector("[data-jprint]");
    if (pb) pb.onclick = () => this.printFile(pb.dataset.jprint);
    const ob = body.querySelector("[data-jonline]");
    if (ob) ob.onclick = () => this.actions.applyOnline();
    const sb = body.querySelector("[data-jsummary]");
    if (sb) sb.onclick = () => this.printSummary();
    const nav = (k, fn) => { const b = body.querySelector(`[data-jnav="${k}"]`); if (b) b.onclick = fn; };
    nav("back", () => { if (e.back()) again(); });
    nav("next", () => { if (e.next()) again(); });
    nav("done", () => { e.clear("done"); this.actions.close && this.actions.close(); });
  }

  /** เติมข้อมูลที่ต้องโหลดเพิ่ม (รายละเอียดสาขา / ข่าวรับสมัคร / คำตอบ AI) */
  async fill(body, step, prog, alive) {
    const t = this.t, en = this.lang === "en";
    try {
      if (step === "career" && prog) {
        const d = await api(`/api/programs/${prog.id}`);
        if (!alive()) return;
        const careers = en ? d.careers_en || d.careers_th : d.careers_th;
        const desc = en ? d.description_en || d.description_th : d.description_th;
        body.querySelector('[data-slot="career"]').innerHTML = `
          ${d.image ? `<div class="pd-img"><img src="${esc(d.image)}" alt=""></div>` : ""}
          <div><h3>${esc(en ? d.name_en || d.name_th : d.name_th)}</h3>
          ${desc ? `<h4>${esc(t.desc)}</h4><p>${esc(desc)}</p>` : ""}
          <h4>${esc(t.careers)}</h4>${careers ? `<p>${esc(careers)}</p>` : `<p class="jnodata">${esc(t.noCareer)}</p><button type="button" class="ghost" data-jask="${esc(t.contactQ)}">${esc(t.askContact)}</button>`}</div>`;
        body.querySelectorAll("[data-jask]").forEach((b) => (b.onclick = () => this.actions.query(b.dataset.jask)));
      } else if (step === "apply") {
        const news = (await api(`/api/news?limit=20&lang=${this.lang}`)).filter((n) => n.kind === "admission");
        if (!alive()) return;
        body.querySelector('[data-slot="apply-news"]').innerHTML = `<h3 class="pgroup">${esc(t.admissionNews)}</h3>` + (news.length
          ? `<div class="pcards">${news.map((n, i) => `<button type="button" class="pcard" style="--i:${i}" data-news="${n.id}">${n.image ? `<span class="pc-img"><img src="${esc(n.image)}" alt=""></span>` : ""}<span class="pc-body"><span class="pc-t">${esc(en && n.title_en ? n.title_en : n.title_th || n.title)}</span></span></button>`).join("")}</div>`
          : `<div class="present-state empty">${esc(t.noAdmissionNews)}</div>`);
        body.querySelectorAll("[data-news]").forEach((b) => (b.onclick = () => this.actions.narrate("news", +b.dataset.news)));
        // คำตอบเรื่องการสมัครจาก AI เดิม (ฐานความรู้ที่อนุมัติ) — ไม่มีข้อมูล = แจ้งตรง ๆ
        const res = await this.actions.query(t.applyQ);
        if (!alive()) return;
        const slot = body.querySelector('[data-slot="apply-ai"]');
        if (!slot) return;
        if (!res) { slot.textContent = t.empty; return; }
        slot.classList.toggle("nodata", !res.answered);
        slot.innerHTML = `<h4>${esc(res.answered ? t.aiAnswer : t.aiNoData)}</h4><p>${esc(res.text || "")}</p>`;
      }
    } catch {
      const slot = body.querySelector("[data-slot]");
      if (slot && alive()) slot.textContent = this.actions.t("loadErr") || t.empty;
    }
  }

  // ---------------------------------------------------------------- 11 พ.ย. 2569: ขั้นที่ 6 เอกสารรับสมัคร
  formInfo() {
    const cfg = (this.actions.cfg && this.actions.cfg()) || {};
    const f = cfg.admission_form || {};
    if (!f.url) return null;
    const abs = new URL(f.url, cfg.base_url || location.href).href;      // ลิงก์ที่มือถือในเครือข่ายเดียวกันเปิดได้
    return { url: f.url, abs, name: f.name || this.t.form };
  }

  /** หน้าพิมพ์ใบสมัครบนมือถือ (/m/apply.html) พร้อมรหัสสาขา — ไม่มีข้อมูลส่วนตัวในลิงก์ */
  applyFormUrl(prog) {
    const cfg = (this.actions.cfg && this.actions.cfg()) || {};
    const base = cfg.apply_form_url || new URL("/m/apply.html", cfg.base_url || location.href).href;
    const q = new URLSearchParams({ lang: this.lang === "en" ? "en" : "th" });
    if (prog) q.set("program", prog.id);
    return `${base}?${q}`;
  }

  formHtml() {
    const t = this.t, f = this.formInfo();
    if (!f) return `<div class="jcard jform none"><h3>📄 ${esc(t.form)}</h3><p>${esc(t.formNone)}</p><p class="jnote">${esc(t.formNoneHint)}</p></div>`;
    return `<div class="jcard jform"><div class="qr">${this.actions.qr(f.abs) || ""}</div><div><h3>📄 ${esc(f.name)}</h3>
      <p class="jnote">${esc(t.formScan)}</p>
      <div class="jform-actions"><button type="button" class="primary" data-jprint="${esc(f.url)}">🖨 ${esc(t.formPrint)}</button>
      <a class="ghost btnlike" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(t.formOpen)}</a></div></div></div>`;
  }

  /** พิมพ์ไฟล์เอกสารจริง: PDF ผ่าน iframe ที่ซ่อนไว้ · ภาพผ่านหน้าพิมพ์ชั่วคราว */
  printFile(url) {
    if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(url)) {
      const w = window.open("", "_blank");
      if (!w) return window.open(url, "_blank");
      w.document.write(`<title>${esc(this.t.form)}</title><style>@page{margin:10mm}body{margin:0}img{width:100%}</style><img src="${esc(url)}" onload="setTimeout(()=>print(),200)">`);
      w.document.close();
      return;
    }
    const old = document.getElementById("jPrintFrame");
    if (old) old.remove();
    const f = document.createElement("iframe");
    f.id = "jPrintFrame";
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    // หน้าใบสมัครของ VORA (print=1) สั่งพิมพ์เองหลังเตรียมข้อมูลเสร็จ → ไม่สั่งซ้ำจากตรงนี้
    f.onload = () => { if (/[?&]print=1/.test(url)) return; try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url, "_blank"); } };
    f.src = url;
    document.body.appendChild(f);
  }

  /** ใบสรุปสาขาที่สนใจ (ไม่ใช่ใบสมัคร) — ข้อมูลจาก API เท่านั้น ไม่มีข้อมูลส่วนตัว */
  async printSummary() {
    const t = this.t, e = this.engine, en = this.lang === "en";
    const items = await this.loadPrograms();
    const prog = e.choices.programId !== undefined ? items.find((x) => x.id === e.choices.programId) : null;
    let d = null;
    try { d = prog ? await api(`/api/programs/${prog.id}`) : null; } catch { /* ไม่มีรายละเอียด */ }
    const cfg = (this.actions.cfg && this.actions.cfg()) || {};
    const school = en ? cfg.school_name_en || cfg.school_name_th : cfg.school_name_th;
    const name = d ? (en ? d.name_en || d.name_th : d.name_th) : "";
    const row = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>` : "");
    const url = this.handoffUrl(prog);
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(t.summaryTitle)}</title>
      <style>@page{size:A4;margin:16mm}body{font-family:"Sarabun","TH Sarabun New","Leelawadee UI",sans-serif;font-size:16pt;color:#111}
      h1{font-size:22pt;margin:0 0 4pt}h2{font-size:16pt;font-weight:normal;color:#555;margin:0 0 14pt}table{width:100%;border-collapse:collapse}
      th{width:30%;text-align:left;vertical-align:top;padding:6pt;border-bottom:1px solid #ccc}td{padding:6pt;border-bottom:1px solid #ccc}
      .qr{float:right;width:120px}.qr svg{width:120px;height:120px}.note{margin-top:18pt;font-size:12pt;color:#555}</style>
      <div class="qr">${this.actions.qr(url) || ""}</div><h1>${esc(t.summaryTitle)}</h1><h2>${esc(school || "")}</h2>
      <table>${row(t.steps.program, name)}${row(t.steps.department, d && d.department)}${row(t.desc, d && (en ? d.description_en || d.description_th : d.description_th))}
      ${row(t.careers, d && (en ? d.careers_en || d.careers_th : d.careers_th))}${row(t.printedAt, new Date().toLocaleString(en ? "en-GB" : "th-TH"))}</table>
      <p class="note">${esc(t.summaryNote)}</p><script>setTimeout(()=>print(),300)<\/script>`);
    w.document.close();
  }

  /** อวตารอธิบายขั้นใหม่ (ครั้งเดียวต่อการเข้าขั้น) — ขั้นการสมัครให้คำตอบของ AI เป็นผู้พูดแทน */
  explain(step, prog) {
    const idx = this.engine.state.step;
    if (this.spokenStep === idx) return;
    this.spokenStep = idx;
    if (step === "apply") return;
    const noLevel = step === "level" && this.programs && !this.programs.some((x) => x.level);
    const s = noLevel ? this.t.sayNoLevel : this.t.say[step];
    const text = typeof s === "function" ? s(prog ? (this.lang === "en" ? prog.name_en || prog.name_th : prog.name_th) : "") : s;
    this.actions.say(text, step === "handoff" ? "point_screen" : "explain");
  }

  handoffUrl(prog) {
    const base = this.actions.mobileUrl();
    if (!prog) return base;
    const u = new URL(base, location.href);
    u.searchParams.set("program", String(prog.id));
    return u.href;
  }
}
