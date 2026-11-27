// ปุ่ม 👗 ลอยข้างตัว VORA + แผงให้ผู้เข้าชมเลือก ชุด / ทรงผม / เครื่องประดับ (19 พ.ย. 2569)
// ใช้กับ VoraRigRenderer เท่านั้น — เรียกคำสั่งของ rig ผ่าน renderer.setOutfit / setBackHair / setAccessory
// ค่าเริ่มต้นและการจำลุคอยู่ที่ kiosk-config.js → avatar.wardrobe · สไตล์อยู่ท้าย kiosk-reference.css (.wardrobe)
// ซ่อนเองในโหมดหน้าจอว่าง (.app.is-idle) และโหมดนำเสนอ (.app.is-presenting)
// 19 พ.ย. 2569 (แก้รอบ 2): ปุ่มลอยอยู่ข้างตัวละคร ไม่ทับตัว · แผงเป็น <dialog> แบบไม่บล็อกหน้าจอ
//   ระหว่างแผงเปิด idle-ui.js นับว่า "มีงานค้าง" (dialog[open]) → หน้าจอไม่เข้าโหมดว่างจนแผงปิดตัวเอง
//   ปิดแผงเฉพาะเมื่อผู้ใช้กดปิด/แตะที่อื่น/กด Esc หรือเข้าโหมดว่างจริง — ไม่ปิดเพราะคลาสอื่นของหน้าเปลี่ยน

const KEY = "vora.wardrobe.v1";

const OUTFITS = [
  { id: "Vora_Student_uni", th: "ชุดนักศึกษา", en: "Student" },
  { id: "Vora_Highcer_uni", th: "ชุด ปวส./พิธีการ", en: "Diploma / Formal" },
];
const HAIRS = [
  { id: "classic", th: "ผมยาว", en: "Long" },
  { id: "short", th: "ผมสั้น", en: "Short" },
];
const ACCESSORIES = [
  { id: "eyeglasses", th: "แว่นตา", en: "Glasses", ico: "👓" },
  { id: "headphone", th: "หูฟัง", en: "Headphones", ico: "🎧" },
];
const TEXT = {
  th: { open: "แต่งตัว VORA", title: "แต่งตัว VORA", close: "ปิด", outfit: "ชุด", hair: "ทรงผม", acc: "เครื่องประดับ (แตะเพื่อเปิด/ปิด)" },
  en: { open: "Dress up VORA", title: "Dress up VORA", close: "Close", outfit: "Outfit", hair: "Hairstyle", acc: "Accessories (tap to toggle)" },
};

/** ลุคเริ่มต้น: ลุคที่จำไว้ (ถ้าเปิด remember และค่าถูกต้อง) ไม่งั้นใช้ค่าจาก config */
export function loadLook(cfg) {
  const def = { outfit: cfg.defaultOutfit, backHair: cfg.defaultBackHair, accessories: [...(cfg.defaultAccessories || [])] };
  if (!cfg.remember) return def;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!s || typeof s !== "object") return def;
    return {
      outfit: OUTFITS.some((o) => o.id === s.outfit) ? s.outfit : def.outfit,
      backHair: HAIRS.some((h) => h.id === s.backHair) ? s.backHair : def.backHair,
      accessories: Array.isArray(s.accessories) ? s.accessories.filter((a) => ACCESSORIES.some((x) => x.id === a)) : def.accessories,
    };
  } catch { return def; }
}

export function saveLook(look) {
  try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* เบราว์เซอร์ไม่ให้เก็บ — ข้าม */ }
}

const h = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") e.textContent = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids) e.appendChild(c);
  return e;
};

export class WardrobeMenu {
  constructor(renderer, stage) {
    this.r = renderer;
    this.stage = stage;
    this.app = stage.closest(".app") || document.getElementById("app");
    this.wrap = h("div", { class: "wardrobe" });
    this.btn = h("button", { type: "button", class: "wardrobe-btn", "aria-expanded": "false", "aria-controls": "wardrobePanel" }, [h("span", { class: "wardrobe-ico", "aria-hidden": "true", text: "👗" })]);
    this.panel = h("dialog", { class: "wardrobe-panel", id: "wardrobePanel" });
    this.wrap.append(this.btn, this.panel);
    stage.appendChild(this.wrap);

    this.btn.addEventListener("click", () => this.toggle());
    this._outside = (e) => { if (this.isOpen() && !this.wrap.contains(e.target)) this.close(); };
    this._key = (e) => { if (e.key === "Escape" && this.isOpen()) { this.close(); this.btn.focus(); } };
    document.addEventListener("pointerdown", this._outside, true);
    document.addEventListener("keydown", this._key);

    // ตำแหน่งตามตัวอวตาร (ขนาดจอ/โหมดว่าง/นำเสนอ เปลี่ยนขนาดอวตาร)
    this._place = () => { cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(() => this.place()); };
    this.ro = new ResizeObserver(this._place);
    this.ro.observe(stage);
    this.ro.observe(renderer.svg);
    window.addEventListener("resize", this._place);
    if (this.app) {
      this.mo = new MutationObserver(() => {
        if (this.app.classList.contains("is-idle")) this.close();
        // อวตารเลื่อน/ย่อขยายด้วย transition — วัดซ้ำระหว่างนั้น
        const until = performance.now() + 900;
        const step = () => { this.place(); if (performance.now() < until) this._raf = requestAnimationFrame(step); };
        cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(step);
      });
      this.mo.observe(this.app, { attributes: true, attributeFilter: ["class"] });
    }
    this._langMo = new MutationObserver(() => { this.render(); });
    this._langMo.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

    this.render();
    this.place();
  }

  lang() { return document.documentElement.lang === "en" ? "en" : "th"; }
  isOpen() { return this.panel.open; }
  toggle() { this.isOpen() ? this.close() : this.open(); }
  open() {
    this.render();
    try { this.panel.show(); } catch { this.panel.setAttribute("open", ""); }
    this.btn.setAttribute("aria-expanded", "true");
    this.place();
    const first = this.panel.querySelector(".wardrobe-opt[aria-pressed='true']") || this.panel.querySelector("button");
    first && first.focus({ preventScroll: true });
  }
  close() {
    if (!this.isOpen()) return;
    try { this.panel.close(); } catch { this.panel.removeAttribute("open"); }
    this.btn.setAttribute("aria-expanded", "false");
  }

  /** สถานะ AI เปลี่ยน — ตอนนี้ไม่บล็อกการแต่งตัว (เปลี่ยนชุดระหว่างพูดได้) เก็บไว้ให้ปรับภายหลัง */
  onState(state) { this.wrap.dataset.state = state; }

  render() {
    const L = this.lang(), T = TEXT[L];
    const look = this.r.getLook();
    this.btn.setAttribute("aria-label", T.open);
    this.btn.title = T.open;
    this.panel.setAttribute("aria-label", T.title);
    const close = h("button", { type: "button", class: "wardrobe-x", "aria-label": T.close, text: "×" });
    close.addEventListener("click", () => { this.close(); this.btn.focus(); });
    const group = (legend, items, isOn, onPick) => {
      const opts = h("div", { class: "wardrobe-opts" });
      for (const it of items) {
        const b = h("button", { type: "button", class: "wardrobe-opt", "aria-pressed": String(isOn(it.id)), text: (it.ico ? it.ico + " " : "") + it[L] });
        b.addEventListener("click", () => { onPick(it.id); this.render(); this.panel.querySelectorAll(".wardrobe-opt").forEach((x) => x.textContent === b.textContent && x.focus({ preventScroll: true })); });
        opts.appendChild(b);
      }
      return h("fieldset", { class: "wardrobe-group" }, [h("legend", { text: legend }), opts]);
    };
    this.panel.replaceChildren(
      h("div", { class: "wardrobe-head" }, [h("h2", { text: T.title }), close]),
      group(T.outfit, OUTFITS, (id) => look.outfit === id, (id) => this.r.setOutfit(id)),
      group(T.hair, HAIRS, (id) => look.backHair === id, (id) => this.r.setBackHair(id)),
      group(T.acc, ACCESSORIES, (id) => look.accessories.includes(id), (id) => this.r.setAccessory(id, !this.r.getLook().accessories.includes(id))),
    );
  }

  /** วางปุ่มลอยถัดจากตัวละครทางขวา ระดับไหล่ (ผืนภาพ 710×1650: ผม/แขนด้านขวาสุดอยู่ราว x 560) — เว้นระยะไม่ให้ทับตัว */
  place() {
    const s = this.stage.getBoundingClientRect(), a = this.r.svg.getBoundingClientRect();
    if (!a.width || !s.width) return;
    const bw = this.btn.offsetWidth || 64;
    const right = a.left - s.left + a.width * (560 / 710);   // ขอบขวาของตัวละคร (รวมผมยาว)
    const x = Math.min(s.width - bw / 2 - 12, Math.max(bw / 2 + 12, right + bw / 2 + Math.max(28, a.width * 0.06)));
    const y = Math.min(s.height - bw, Math.max(bw, a.top - s.top + a.height * 0.30));
    this.wrap.style.left = `${x}px`;
    this.wrap.style.top = `${y}px`;
    // แผงเปิดไปทางขวา ถ้าไม่พอให้เปิดไปทางซ้าย
    const pw = this.panel.offsetWidth || 340;
    this.wrap.classList.toggle("flip", x + 50 + pw > s.width);
  }

  destroy() {
    document.removeEventListener("pointerdown", this._outside, true);
    document.removeEventListener("keydown", this._key);
    window.removeEventListener("resize", this._place);
    this.ro && this.ro.disconnect();
    this.mo && this.mo.disconnect();
    this._langMo && this._langMo.disconnect();
    cancelAnimationFrame(this._raf);
    this.wrap.remove();
  }
}
