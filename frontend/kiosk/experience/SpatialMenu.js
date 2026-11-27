// Spatial UI — Orbital Menu รอบอวตาร (VORA NEXT Phase 1)
// - 6 หมวด: วิทยาลัย / สาขาวิชา / ข่าวสาร / รับสมัคร / ผู้ช่วย AI / ความคิดเห็น
// - วางเป็นวงโค้ง 2 ฝั่งของอวตาร "ต่ำกว่าระดับใบหน้า" และไม่ทับตัวอวตาร — คำนวณจากขนาดอวตารจริงทุกครั้งที่เวทีเปลี่ยนขนาด
// - พื้นที่ข้างอวตารไม่พอ (จอเล็ก/แนวตั้ง/มือถือ) → เปลี่ยนเป็น Compact Menu แถวเดียวด้านล่างเวทีอัตโนมัติ
// - ปุ่มจริง (<button>) มีไอคอน + ข้อความ · แตะ/คลิก/Hover/คีย์บอร์ด (ลูกศร, Home/End, Enter/Space)
// - ใช้ CSS Transform + SVG + JS เท่านั้น ไม่มี WebGL ไม่สร้าง/ลบ DOM ของอวตาร
// - เมนูตัวอักษรใหญ่สำหรับผู้สูงอายุ: textMenu() เปิด <dialog> รายการข้อความขนาดใหญ่ (หมวดเดียวกัน)
// - (8 พ.ย. 2569) layout: "rail" + mount = วางปุ่มชุดเดิมเป็นแถบเครื่องมือแนวตั้งขอบซ้าย (Edge Toolbar ตามภาพ Reference)
//   ไม่คำนวณตำแหน่งรอบอวตาร ไม่มีปุ่มบังตัวอวตาร — ปุ่ม/หมวด/การเลือก/คีย์บอร์ด ทำงานเหมือนเดิมทุกอย่าง

const ICONS = {
  college: '<path d="M12 3 2 8v2h20V8Z" fill="currentColor"/><path d="M4 11v7h3v-7Zm6.5 0v7h3v-7ZM17 11v7h3v-7ZM2 19h20v2H2Z" fill="currentColor"/>',
  departments: '<path d="M12 4 1 9l11 5 9-4.1V16h2V9Z" fill="currentColor"/><path d="M5 12.5V17c0 1.7 3.1 3 7 3s7-1.3 7-3v-4.5l-7 3.2Z" fill="currentColor"/>',
  news: '<rect x="3" y="4" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M7 9h10M7 13h10M7 17h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  admission: '<path d="M6 2h9l5 5v15H6Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M14 2v6h6M9 13l2.2 2.2L16 10.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  assistant: '<path d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.5 3.4 6L4.5 21l4.4-2.3c1 .2 2 .3 3.1.3 5.5 0 10-3.6 10-8s-4.5-8-10-8Z" fill="currentColor"/><circle cx="8" cy="11" r="1.4" fill="#14161B"/><circle cx="12" cy="11" r="1.4" fill="#14161B"/><circle cx="16" cy="11" r="1.4" fill="#14161B"/>',
  feedback: '<path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9Z" fill="currentColor"/>',
};

/** หมวดของเมนู — action: present = เปิดโหมดนำเสนอ, ask = ผู้ช่วย AI (ฟัง/พิมพ์), rate = แบบประเมิน */
export const SECTIONS = [
  { id: "college", action: "present", th: "วิทยาลัย", en: "College", hintTh: "ข้อมูลวิทยาลัย", hintEn: "About us" },
  { id: "departments", action: "present", th: "สาขาวิชา", en: "Departments", hintTh: "หลักสูตรที่เปิดสอน", hintEn: "Programs" },
  { id: "news", action: "present", th: "ข่าวสาร", en: "News", hintTh: "ข่าวและกิจกรรม", hintEn: "News & events" },
  { id: "admission", action: "present", th: "รับสมัคร", en: "Admission", hintTh: "การสมัครเรียน", hintEn: "How to apply" },
  { id: "assistant", action: "ask", th: "ผู้ช่วย AI", en: "AI Assistant", hintTh: "ถาม VORA", hintEn: "Ask VORA" },
  { id: "feedback", action: "rate", th: "ความคิดเห็น", en: "Feedback", hintTh: "ประเมินความพึงพอใจ", hintEn: "Rate VORA" },
];

export class SpatialMenu {
  /**
   * stage: #stage · avatarBox: #avatar · onSelect(section) — ผู้เรียกตัดสินว่าจะทำอะไรต่อ
   * options: { gap, faceRatio, rows, minSide, compactBelow }
   */
  constructor(stage, avatarBox, { onSelect, lang = "th", gap = 16, faceRatio = 0.3, rows = [0.5, 0.665, 0.83], arc = 18, layout = "orbital", mount = null } = {}) {
    this.stage = stage;
    this.avatarBox = avatarBox;
    this.onSelect = onSelect || (() => {});
    this.lang = lang;
    this.cfg = { gap, faceRatio, rows, arc };
    this.rail = layout === "rail" && !!mount;
    this.layoutMode = this.rail ? "rail" : "orbital";
    this.geom = null;
    this.offs = [];
    this.root = document.createElement("nav");
    this.root.className = "orbit";
    this.root.id = "orbit";
    this.root.setAttribute("aria-label", "เมนูรอบตัว VORA");
    this.buttons = SECTIONS.map((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "orb";
      b.dataset.section = s.id;
      b.style.setProperty("--i", String(i));
      b.innerHTML = `<span class="orb-in"><span class="orb-ico"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">${ICONS[s.id]}</svg></span><span class="orb-t"></span><small class="orb-s"></small></span>`;
      b.addEventListener("click", () => this.pick(s, b));
      this.root.appendChild(b);
      return b;
    });
    if (this.rail) { this.root.classList.add("rail"); this.root.dataset.layout = "rail"; mount.appendChild(this.root); }
    else stage.appendChild(this.root);
    this.root.addEventListener("keydown", (e) => this.onKey(e));
    this.setLang(lang);
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(stage);
    this.layout();
  }

  setLang(lang) {
    this.lang = lang === "en" ? "en" : "th";
    SECTIONS.forEach((s, i) => {
      const b = this.buttons[i];
      b.querySelector(".orb-t").textContent = s[this.lang];
      b.querySelector(".orb-s").textContent = this.lang === "en" ? s.hintEn : s.hintTh;
      b.setAttribute("aria-label", `${s[this.lang]} — ${this.lang === "en" ? s.hintEn : s.hintTh}`);
    });
    this.root.setAttribute("aria-label", this.lang === "en" ? "Menu around VORA" : "เมนูรอบตัว VORA");
  }

  /** เล่น Animation ตอนเลือก แล้วส่งต่อ (ป้องกันกดซ้ำรัว ๆ ระหว่าง Animation) */
  pick(section, btn) {
    if (btn.classList.contains("picked")) return;
    btn.classList.add("picked");
    this.buttons.forEach((b) => b.classList.remove("suggested"));
    this.buttons.forEach((b) => b.setAttribute("aria-current", String(b === btn)));
    setTimeout(() => btn.classList.remove("picked"), 420);
    this.onSelect(section);
  }

  /** Phase 2: ไฮไลต์หมวดที่แนะนำหลังทักทาย (หายเองเมื่อครบเวลา หรือเมื่อผู้ใช้เลือกหมวดใด ๆ) */
  highlight(ids = [], ms = 12000) {
    clearTimeout(this.hlTimer);
    this.buttons.forEach((b) => b.classList.toggle("suggested", ids.includes(b.dataset.section)));
    this.hlTimer = setTimeout(() => this.buttons.forEach((b) => b.classList.remove("suggested")), ms);
  }

  /** ตั้งปุ่มที่กำลังแสดงอยู่ (เช่น หมวดที่เปิดในโหมดนำเสนอ) */
  setCurrent(id) { this.buttons.forEach((b) => b.setAttribute("aria-current", String(b.dataset.section === id))); }

  onKey(e) {
    const i = this.buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const n = this.buttons.length;
    let j = -1;
    // ลำดับตามวง: ซ้าย (บน→ล่าง) แล้วขวา (บน→ล่าง) · ลูกศรซ้าย/ขวา ข้ามฝั่ง
    if (e.key === "ArrowDown") j = (i + 1) % n;
    else if (e.key === "ArrowUp") j = (i - 1 + n) % n;
    else if (e.key === "ArrowRight") j = this.layoutMode === "rail" ? -1 : this.layoutMode === "compact" ? (i + 1) % n : (i < 3 ? i + 3 : i);
    else if (e.key === "ArrowLeft") j = this.layoutMode === "rail" ? -1 : this.layoutMode === "compact" ? (i - 1 + n) % n : (i >= 3 ? i - 3 : i);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = n - 1;
    if (j >= 0) { e.preventDefault(); this.buttons[j].focus(); }
  }

  /** ตำแหน่งและขนาดอวตารในพิกัดของเวที — ใช้ offset (ไม่ถูกผลของ transform ตอน Idle) */
  avatarRect() {
    const box = this.avatarBox;
    const svg = box.querySelector("svg, canvas, img");
    const bh = box.clientHeight;
    const h = svg ? (svg.clientHeight || bh) : bh;
    const w = svg ? (svg.clientWidth || h * 0.49) : h * 0.49;
    const left = box.offsetLeft + (box.clientWidth - w) / 2;
    const top = box.offsetTop + bh - h;
    return { left, top, w, h, right: left + w, bottom: top + h, faceBottom: top + h * this.cfg.faceRatio };
  }

  layout() {
    if (this.rail) return;   // แถบเครื่องมือขอบซ้าย: ตำแหน่งตาม CSS (ไม่วางรอบอวตาร)
    const sw = this.stage.clientWidth, sh = this.stage.clientHeight;
    if (!sw || !sh) return;
    const a = this.avatarRect();
    // ขนาดปุ่มจริงจาก CSS (วัดในโหมดวงโคจร)
    this.root.classList.remove("compact");
    const bw = this.buttons[0].offsetWidth || 120, bh = this.buttons[0].offsetHeight || 96;
    const g = this.cfg.gap, edge = 8;
    const spaceL = a.left - g - edge, spaceR = sw - a.right - g - edge;
    // 3 แถวต่อฝั่ง: ระยะห่างอย่างน้อย = ความสูงปุ่มจริง + 10px (ไม่ทับกัน) · วางชิดล่างของเวที/เท้าอวตาร
    // เพื่อเว้นพื้นที่ด้านบนให้ใบหน้าและกล่องคำพูด (มุมซ้ายบน) — ถ้าแถวบนสุดเลยขึ้นไปถึงระดับใบหน้า = ที่ไม่พอ → Compact
    const n = this.cfg.rows.length;
    const step = Math.max(bh + 10, a.h * (this.cfg.rows[1] - this.cfg.rows[0]));
    const last = Math.min(sh - edge - bh / 2, a.bottom - bh / 2);
    const rowsY = Array.from({ length: n }, (_, k) => last - (n - 1 - k) * step);
    const fitsV = rowsY[0] - bh / 2 >= a.faceBottom + 4 && rowsY[n - 1] + bh / 2 <= sh - edge + 0.5;
    const orbital = spaceL >= bw && spaceR >= bw && fitsV;
    this.layoutMode = orbital ? "orbital" : "compact";
    this.root.classList.toggle("compact", !orbital);
    this.root.dataset.layout = this.layoutMode;
    const cx = a.left + a.w / 2, cy = a.top + a.h * 0.6;
    const pos = [];
    this.buttons.forEach((b, i) => {
      if (!orbital) { b.style.left = ""; b.style.top = ""; b.style.removeProperty("--fx"); b.style.removeProperty("--fy"); return; }
      const side = i < 3 ? -1 : 1, row = i % 3;
      // วงโค้ง: แถวกลางออกห่างจากตัวอวตารมากกว่าแถวบน/ล่างเล็กน้อย (ถ้ามีที่)
      const room = (side < 0 ? spaceL : spaceR) - bw;
      const out = row === 1 ? Math.min(this.cfg.arc, Math.max(0, room)) : 0;
      const x = side < 0 ? a.left - g - out - bw : a.right + g + out;
      const y = rowsY[row] - bh / 2;
      b.style.left = `${x.toFixed(1)}px`;
      b.style.top = `${y.toFixed(1)}px`;
      // จุดเริ่ม Animation: ออกมาจากกึ่งกลางตัวอวตาร
      b.style.setProperty("--fx", `${(cx - (x + bw / 2)).toFixed(0)}px`);
      b.style.setProperty("--fy", `${(cy - (y + bh / 2)).toFixed(0)}px`);
      pos.push({ x, y, w: bw, h: bh });
    });
    this.geom = { mode: this.layoutMode, stage: { w: sw, h: sh }, avatar: a, items: pos };
  }

  destroy() {
    this.ro && this.ro.disconnect();
    this.root.remove();
  }
}
