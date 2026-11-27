// VORA Guide — Interactive Guided Tour ของหน้า Main (17 พ.ย. 2569)
// โมดูลแยก: state / DOM / CSS (prefix vg-) / event handler ของ Guide เท่านั้น — ไม่แก้ระบบเดิม
//   - ไม่มี TTS/STT ของตัวเอง: พูดผ่าน respond() เดิม (deps.speak) · ไม่เปิดไมค์ · ไม่เลื่อนขั้นเอง
//   - ไม่มีธีมของตัวเอง: สีจาก CSS var ของธีมเดิม (--accent, --panel-strong, --glow-c …)
//   - ไม่ใช้ localStorage · ไม่เรียก /api/robot/stop
//   - Event เดิมที่รับ: UI_LANG, EXPERIENCE_MODE · Event เดิมที่ส่ง: UI_ACTIVITY, AVATAR_HINT (pointing)
// กติกา (อนุมัติ 17 พ.ย. 2569): Esc = ปิด Guide (ถ้ามี dialog แบบ modal เปิดอยู่ = ปิด dialog นั้นอย่างเดียว ไม่ stopAll)
//   overlay กันการคลิกนอก target · คลิก target ได้และ Guide อยู่ที่ขั้นเดิม · ไม่มี interaction 60 วิ = จบเอง

import { GUIDE_ALWAYS_ALLOW, GUIDE_STEPS, GUIDE_UI, GUIDE_TIMEOUT_MS } from "./guide-steps.js";

const PAD = 8;          // ระยะเผื่อรอบ target
const MARGIN = 14;      // ระยะห่างขอบจอ
const GAP = 18;         // ระยะระหว่าง Spotlight กับแผงคำอธิบาย
const BLOCK = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"];
const STAMP = ["pointerdown", "keydown", "wheel", "touchstart"];
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SVGNS = "http://www.w3.org/2000/svg";

const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

/** กรอบส่วนที่มองเห็นได้จริงของ element (ตัดด้วยกรอบของแถบเลื่อนที่ครอบอยู่ เช่น เมนูหลักบนจอแคบ) หรือ null */
export function visibleRect(el) {
  if (!el || !el.isConnected) return null;
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return null;
  const r = el.getBoundingClientRect();
  let { left, top, right, bottom } = r;
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.display === "contents") continue;
    if (s.overflowX !== "visible" || s.overflowY !== "visible") {
      const ar = a.getBoundingClientRect();
      if (s.overflowX !== "visible") { left = Math.max(left, ar.left); right = Math.min(right, ar.right); }
      if (s.overflowY !== "visible") { top = Math.max(top, ar.top); bottom = Math.min(bottom, ar.bottom); }
    }
  }
  if (right - left < 1 || bottom - top < 1) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** กรอบรวมของหลายกรอบ */
export function unionRect(rects) {
  const list = rects.filter(Boolean);
  if (!list.length) return null;
  const left = Math.min(...list.map((r) => r.left)), top = Math.min(...list.map((r) => r.top));
  const right = Math.max(...list.map((r) => r.right)), bottom = Math.max(...list.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** วางแผงคำอธิบายรอบ Spotlight แรก: ล่าง → บน → ขวา → ซ้าย · ถ้าไม่มีที่ว่างพอ ใช้ขอบล่าง/บนของจอ (overlap = true) */
export function placePanel(hole, holes, pw, ph, vw, vh) {
  const fits = (p) => p.left >= MARGIN && p.top >= MARGIN && p.left + pw <= vw - MARGIN && p.top + ph <= vh - MARGIN;
  const box = (left, top) => ({ left, top, right: left + pw, bottom: top + ph });
  const clampX = (x) => Math.min(Math.max(x, MARGIN), Math.max(MARGIN, vw - MARGIN - pw));
  const clampY = (y) => Math.min(Math.max(y, MARGIN), Math.max(MARGIN, vh - MARGIN - ph));
  if (hole) {
    const cx = hole.left + hole.width / 2 - pw / 2, cy = hole.top + hole.height / 2 - ph / 2;
    const cands = [
      [clampX(cx), hole.bottom + GAP, "below"], [clampX(cx), hole.top - GAP - ph, "above"],
      [hole.right + GAP, clampY(cy), "right"], [hole.left - GAP - pw, clampY(cy), "left"],
    ];
    for (const [l, t, side] of cands) {
      const b = box(l, t);
      if (fits(b) && !holes.some((h) => overlaps(b, h))) return { left: l, top: t, side, overlap: false };
    }
  }
  const atTop = hole && hole.top + hole.height / 2 > vh / 2;
  const l = clampX(vw / 2 - pw / 2), t = atTop ? MARGIN : clampY(vh - MARGIN - ph);
  return { left: l, top: t, side: atTop ? "top" : "bottom", overlap: !!hole && holes.some((h) => overlaps(box(l, t), h)) };
}

/** จุดบนขอบกรอบ r ตามแนวจากจุดศูนย์กลางของ r ไปยังจุด (tx, ty) */
function edgePoint(r, tx, ty) {
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(dx ? (r.width / 2) / Math.abs(dx) : Infinity, dy ? (r.height / 2) / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}

export class VoraGuide {
  /**
   * deps: bus, EV, button, getLang(), speak(text, lang) → Promise, stopSpeech(), clearCaption(text),
   *       isPresenting(), onStart(), keepAlive()
   */
  constructor(deps) {
    this.d = deps;
    this.steps = deps.steps || GUIDE_STEPS;
    this.timeoutMs = deps.timeoutMs ?? GUIDE_TIMEOUT_MS;
    this.now = deps.now || (() => Date.now());
    this.active = false;
    this.index = 0;
    this.speaking = false;
    this.seq = 0;
    this.lastInteraction = 0;
    this.lastEnd = null;
    this.layoutInfo = null;
    this.built = false;
    this.onBlockEv = (e) => this.onBlock(e);
    this.onStampEv = () => { this.lastInteraction = this.now(); };
    this.onKeyEv = (e) => this.onKey(e);
    this.onViewEv = () => this.requestLayout();
    const { bus, EV } = deps;
    bus.on(EV.EXPERIENCE_MODE, ({ mode } = {}) => {
      if (mode === "presentation" && this.active) this.end("presentation");
      this.syncButton(mode === "presentation");
    });
    bus.on(EV.UI_LANG, () => this.onLang());
    this.syncButton();
  }

  get available() { return !this.d.isPresenting(); }
  get step() { return this.steps[this.index]; }
  get lang() { return this.d.getLang() === "en" ? "en" : "th"; }

  /** ปุ่ม ✦: แสดงตลอด · ปิดใช้งาน (จาง) ระหว่างโหมดนำเสนอ */
  syncButton(presenting = this.d.isPresenting()) {
    const b = this.d.button;
    if (!b) return;
    b.disabled = !!presenting;
    b.setAttribute("aria-disabled", String(!!presenting));
  }

  // ------------------------------------------------------------------ วงจรชีวิต
  start(source = "button") {
    if (this.active || !this.available) return false;
    this.active = true;
    this.source = source;
    this.lastEnd = null;
    this.lastInteraction = this.now();
    this.prevFocus = document.activeElement;
    this.d.onStart && this.d.onStart();
    this.d.bus.emit(this.d.EV.UI_ACTIVITY, { source: "guide" });   // ถ้าอยู่โหมดหน้าจอว่าง → กลับโหมดใช้งาน (กลไกเดิม)
    this.build();
    this.attach();
    this.layer.hidden = false;
    if (!this.panel.open) this.panel.show();                        // non-modal: ไม่บล็อก dialog เดิม (ตั้งค่า/QR) ที่เปิดจาก target
    this.go(0);
    this.btnNext.focus({ preventScroll: true });
    this.timer = setInterval(() => this.tick(), 1000);
    this.watch = setInterval(() => this.layoutIfMoved(), 250);
    return true;
  }

  end(reason = "close") {
    if (!this.active) return false;
    this.active = false;
    this.lastEnd = reason;
    clearInterval(this.timer);
    clearInterval(this.watch);
    cancelAnimationFrame(this.raf);
    const wasSpeaking = this.speaking;
    this.seq++;
    this.speaking = false;
    if (wasSpeaking) this.d.stopSpeech();
    if (this.d.clearCaption) for (const l of ["th", "en"]) this.d.clearCaption(this.step[l].body);
    this.detach();
    if (this.panel.open) this.panel.close();
    this.layer.hidden = true;
    this.layoutInfo = null;
    if (reason !== "presentation" && reason !== "question") {
      const b = this.d.button;
      const back = b && !b.disabled && visibleRect(b) ? b : (this.prevFocus && this.prevFocus.isConnected ? this.prevFocus : null);
      if (back && back.focus) back.focus({ preventScroll: true });
    }
    return true;
  }

  go(i, { speak = true } = {}) {
    this.index = Math.max(0, Math.min(this.steps.length - 1, i));
    this.scrolledFor = -1;
    this.render();
    this.layout();
    this.d.bus.emit(this.d.EV.AVATAR_HINT, { state: "pointing", ms: 2500 });
    if (speak) this.say();
  }

  next() {
    if (!this.active) return;
    this.lastInteraction = this.now();
    if (this.index >= this.steps.length - 1) { this.end("finish"); return; }
    this.go(this.index + 1);
  }

  back() {
    if (!this.active) return;
    this.lastInteraction = this.now();
    if (this.index > 0) this.go(this.index - 1);
  }

  /** คำสั่งจากภายนอก (เสียง) → true ถ้าเป็นคำสั่งของ Guide */
  command(cmd) {
    if (!this.active) return false;
    this.lastInteraction = this.now();
    if (cmd === "GUIDE_NEXT") { this.next(); return true; }
    if (cmd === "GUIDE_BACK") { this.back(); return true; }
    if (cmd === "GUIDE_CLOSE") { this.end("voice"); return true; }
    if (cmd === "GUIDE_START") return true;   // เปิดอยู่แล้ว → ไม่ทำอะไร (อนุมัติ 17 พ.ย. 2569)
    return false;
  }

  say() {
    const my = ++this.seq;
    const lang = this.lang;
    const text = this.step[lang].body;
    this.speaking = true;
    let p;
    try { p = Promise.resolve(this.d.speak(text, lang)); } catch { p = Promise.resolve(); }
    p.catch(() => {}).finally(() => { if (my === this.seq) this.speaking = false; });
  }

  tick() {
    if (!this.active) return;
    this.d.keepAlive && this.d.keepAlive();
    // ไม่นับเวลาระหว่างที่ VORA กำลังพูดขั้นนั้นอยู่ (นับ 60 วิ ต่อจากที่พูดจบ หรือ interaction ล่าสุด)
    if (this.speaking) { this.lastInteraction = Math.max(this.lastInteraction, this.now()); return; }
    if (this.now() - this.lastInteraction >= this.timeoutMs) this.end("timeout");
  }

  onLang() {
    if (!this.active) return;
    this.render();
    this.requestLayout();
    if (this.speaking) this.say();   // หยุดเสียงเดิม (respond ใหม่แทรกของเดิม) แล้วพูดขั้นเดิมด้วยภาษาใหม่
  }

  // ------------------------------------------------------------------ DOM
  build() {
    if (this.built) return;
    this.built = true;
    const layer = document.createElement("div");
    layer.className = "vg-layer";
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "vg-dim");
    svg.innerHTML = `<defs><mask id="vg-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
      <rect x="0" y="0" width="100%" height="100%" fill="white"/><rect class="vg-hole" rx="18" fill="black"/><rect class="vg-hole" rx="18" fill="black"/></mask></defs>
      <rect class="vg-shade" x="0" y="0" width="100%" height="100%" mask="url(#vg-mask)"/><line class="vg-line"/>`;
    layer.append(svg);
    this.holes = [...svg.querySelectorAll(".vg-hole")];
    this.line = svg.querySelector(".vg-line");
    this.rings = [0, 1].map(() => { const r = document.createElement("div"); r.className = "vg-ring"; r.hidden = true; layer.append(r); return r; });

    const panel = document.createElement("dialog");
    panel.className = "vg-panel";
    panel.setAttribute("aria-labelledby", "vg-title");
    panel.setAttribute("aria-describedby", "vg-body");
    panel.innerHTML = `<div class="vg-head"><span class="vg-badge"><span aria-hidden="true">✦</span> <span class="vg-name"></span></span><span class="vg-count" aria-live="polite"></span></div>
      <h2 class="vg-title" id="vg-title"></h2>
      <p class="vg-body" id="vg-body" aria-live="polite"></p>
      <p class="vg-hint"></p>
      <div class="vg-actions"><button type="button" class="vg-btn vg-close"></button><button type="button" class="vg-btn vg-back"></button><button type="button" class="vg-btn vg-primary vg-next"></button></div>`;
    this.btnClose = panel.querySelector(".vg-close");
    this.btnBack = panel.querySelector(".vg-back");
    this.btnNext = panel.querySelector(".vg-next");
    this.btnClose.onclick = () => this.end("close");
    this.btnBack.onclick = () => this.back();
    this.btnNext.onclick = () => this.next();
    document.body.append(layer, panel);
    this.layer = layer;
    this.panel = panel;
  }

  render() {
    const ui = GUIDE_UI[this.lang], s = this.step[this.lang], n = this.steps.length, last = this.index === n - 1;
    const p = this.panel;
    p.lang = this.lang;
    p.dataset.step = this.step.id;
    p.querySelector(".vg-name").textContent = ui.name;
    p.querySelector(".vg-count").textContent = ui.counter(this.index + 1, n);
    p.querySelector(".vg-title").textContent = s.title;
    p.querySelector(".vg-body").textContent = s.body;
    p.querySelector(".vg-hint").textContent = ui.voiceHint;
    this.btnClose.textContent = ui.close;
    this.btnBack.textContent = ui.back;
    this.btnBack.disabled = this.index === 0;
    this.btnNext.textContent = last ? ui.finish : ui.next;
  }

  /** element ของ target ในขั้นปัจจุบัน (ทุกกลุ่ม) */
  targetEls() {
    const pick = (sel) => {
      const alts = sel.split("||").map((x) => x.trim());
      const els = alts.map((x) => document.querySelector(x)).filter(Boolean);
      return els.find((el) => visibleRect(el)) || els[0] || null;
    };
    return this.step.targets.map((g) => g.map(pick).filter(Boolean));
  }

  requestLayout() {
    if (!this.active) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.layout());
  }

  layoutIfMoved() {
    if (!this.active) return;
    const sig = JSON.stringify([innerWidth, innerHeight, this.targetEls().map((g) => unionRect(g.map(visibleRect)))]);
    if (sig !== this.sig) this.layout();
  }

  layout() {
    if (!this.active) return;
    const groups = this.targetEls();
    this.sig = JSON.stringify([innerWidth, innerHeight, groups.map((g) => unionRect(g.map(visibleRect)))]);
    // จอแคบ (หน้าเลื่อนได้): เลื่อนไปที่ target ของขั้นนี้ครั้งเดียวต่อขั้น — ตำแหน่งจริงคำนวณใหม่จาก scroll event / ตัวตรวจทุก 250ms
    if (this.scrolledFor !== this.index) {
      this.scrolledFor = this.index;
      if (this.scrollToTargets(groups)) return;
    }
    const vw = innerWidth, vh = innerHeight;
    const holes = groups.map((g) => unionRect(g.map(visibleRect))).filter(Boolean).map((r) => {
      const left = Math.max(2, r.left - PAD), top = Math.max(2, r.top - PAD);
      const right = Math.min(vw - 2, r.right + PAD), bottom = Math.min(vh - 2, r.bottom + PAD);
      return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    }).filter((h) => h.width > 0 && h.height > 0);
    this.holes.forEach((h, k) => {
      const r = holes[k];
      h.style.x = `${r ? r.left : vw / 2}px`; h.style.y = `${r ? r.top : vh / 2}px`;
      h.style.width = `${r ? r.width : 0}px`; h.style.height = `${r ? r.height : 0}px`;
    });
    this.rings.forEach((ring, k) => {
      const r = holes[k];
      ring.hidden = !r;
      if (r) Object.assign(ring.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    });
    const pw = this.panel.offsetWidth, ph = this.panel.offsetHeight;
    const pos = placePanel(holes[0] || null, holes, pw, ph, vw, vh);
    this.panel.style.left = `${Math.round(pos.left)}px`;
    this.panel.style.top = `${Math.round(pos.top)}px`;
    const pr = { left: pos.left, top: pos.top, width: pw, height: ph };
    if (holes[0] && !pos.overlap) {
      const h = holes[0];
      const a = edgePoint(pr, h.left + h.width / 2, h.top + h.height / 2);
      const b = edgePoint(h, pr.left + pw / 2, pr.top + ph / 2);
      this.line.setAttribute("x1", a.x); this.line.setAttribute("y1", a.y);
      this.line.setAttribute("x2", b.x); this.line.setAttribute("y2", b.y);
      this.line.style.opacity = "";
    } else this.line.style.opacity = "0";
    const missing = this.step.targets.length - holes.length;
    if (missing > 0) console.warn(`[VORA Guide] ขั้น ${this.step.id}: ไม่พบ target ที่มองเห็นได้ ${missing} จุด`);
    this.layoutInfo = { step: this.step.id, holes, panel: { left: pos.left, top: pos.top, width: pw, height: ph }, side: pos.side, overlap: pos.overlap, missing };
  }

  /**
   * เลื่อนหน้าให้ target (และแผงคำอธิบาย) อยู่ในจอ — ใช้เมื่อจำเป็นเท่านั้น (เช่น จอแคบ ≤1100px ที่หน้าเลื่อนได้)
   * 1) แถบที่เลื่อนแนวนอนได้ (เช่น เมนูหลักบนจอแคบ): เลื่อนให้ target อยู่ในแถบ
   * 2) แนวตั้ง: วางกลุ่ม target ไว้บนสุดถ้ามีที่ว่างให้แผงด้านล่าง · ถ้า target หลายจุดสูงเกินจอ ใช้จุดแรก
   * reduced motion = ไม่มี animation · คืน true ถ้ามีการเลื่อน
   */
  scrollToTargets(groups) {
    const behavior = reducedMotion() ? "auto" : "smooth";
    const vw = innerWidth, vh = innerHeight;
    let moved = false;
    for (const g of groups) {
      const el = g[0];   // จุดแรกของกลุ่ม: ถ้าถูกแถบเลื่อนแนวนอนบังอยู่ (หรืออยู่นอกจอ) → เลื่อนแถบให้เห็น
      if (!el || !el.scrollIntoView) continue;
      const raw = el.getBoundingClientRect(), r = visibleRect(el);
      if (raw.width >= 1 && (!r || r.width < Math.min(raw.width, vw) - 1 || r.left < 0 || r.right > vw)) { el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" }); moved = true; }
    }
    const rects = groups.map((g) => unionRect(g.map(visibleRect))).filter(Boolean);
    if (!rects.length) return moved;
    const pad = (r) => ({ left: r.left - PAD, top: r.top - PAD, right: r.right + PAD, bottom: r.bottom + PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD });
    const pw = this.panel.offsetWidth, ph = this.panel.offsetHeight;
    const allIn = rects.every((r) => r.top >= PAD && r.bottom <= vh - PAD);
    if (allIn && !placePanel(pad(rects[0]), rects.map(pad), pw, ph, vw, vh).overlap) return moved;
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight <= vh + 1) return moved;          // หน้าเลื่อนไม่ได้ (จอใหญ่) → ไม่เลื่อน
    const all = unionRect(rects);
    const anchor = all.height + 2 * (MARGIN + PAD) <= vh ? all : rects[0];
    const top = anchor.height + 2 * (MARGIN + PAD) + GAP + ph <= vh ? MARGIN + PAD : Math.max(MARGIN + PAD, (vh - anchor.height) / 2);
    const dy = anchor.top - top;
    if (Math.abs(dy) < 2) return moved;
    window.scrollBy({ top: dy, left: 0, behavior });
    return true;
  }

  // ------------------------------------------------------------------ การโต้ตอบ
  attach() {
    for (const t of BLOCK) window.addEventListener(t, this.onBlockEv, true);
    for (const t of STAMP) window.addEventListener(t, this.onStampEv, { capture: true, passive: true });
    window.addEventListener("keydown", this.onKeyEv, true);
    window.addEventListener("resize", this.onViewEv);
    window.addEventListener("scroll", this.onViewEv, true);
    document.addEventListener("fullscreenchange", this.onViewEv);
  }

  detach() {
    for (const t of BLOCK) window.removeEventListener(t, this.onBlockEv, true);
    for (const t of STAMP) window.removeEventListener(t, this.onStampEv, { capture: true });
    window.removeEventListener("keydown", this.onKeyEv, true);
    window.removeEventListener("resize", this.onViewEv);
    window.removeEventListener("scroll", this.onViewEv, true);
    document.removeEventListener("fullscreenchange", this.onViewEv);
  }

  /** dialog แบบ modal ของระบบเดิมที่เปิดอยู่ (เช่น ตั้งค่า / QR / ให้คะแนน) */
  modalOpen() {
    try { return [...document.querySelectorAll("dialog[open]")].some((d) => d !== this.panel && d.matches(":modal")); } catch { return false; }
  }

  /** คลิกได้เฉพาะ: แผง Guide · target ของขั้นนี้ · dialog แบบ modal ที่เปิดจาก target · ปุ่มหยุด (GUIDE_ALWAYS_ALLOW) */
  allowed(node) {
    const el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el) return false;
    if (this.panel.contains(el)) return true;
    const dlg = el.closest("dialog");
    if (dlg && dlg !== this.panel && dlg.open) { try { if (dlg.matches(":modal")) return true; } catch { /* ignore */ } }
    if (GUIDE_ALWAYS_ALLOW.some((sel) => el.closest(sel))) return true;
    return this.targetEls().some((g) => g.some((t) => t.contains(el)));
  }

  onBlock(e) {
    if (!this.active) return;
    if (this.allowed(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  onKey(e) {
    if (!this.active) return;
    if (e.key === "Escape") {
      // มี dialog เดิมเปิดอยู่ → ให้เบราว์เซอร์ปิด dialog นั้นตามปกติ แต่ไม่ส่งต่อให้ stopAll() · ไม่มี → ปิด Guide
      e.stopPropagation();
      if (this.modalOpen()) return;
      e.preventDefault();
      this.end("escape");
      return;
    }
    if (e.key === "Tab" && !this.modalOpen()) this.trapTab(e);
  }

  /** Tab วนอยู่ใน target ของขั้นนี้ + ปุ่มของ Guide (เฉพาะตอน Guide เปิด) */
  trapTab(e) {
    const list = [...this.targetEls().flat().flatMap((t) => (t.matches(FOCUSABLE) ? [t] : [...t.querySelectorAll(FOCUSABLE)])),
      ...this.panel.querySelectorAll(FOCUSABLE)].filter((el) => visibleRect(el));
    if (!list.length) return;
    e.preventDefault();
    const i = list.indexOf(document.activeElement);
    const n = i < 0 ? (e.shiftKey ? list.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + list.length) % list.length;
    list[n].focus();
  }
}
