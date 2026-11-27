// ตัววาดอวตารตัวจริงจากไฟล์ PSD ที่แยกเลเยอร์แล้ว Export เป็น PNG/WebP โปร่งใส
// ใช้จุดหมุนและท่าทางชุดเดียวกับอวตารจำลอง จึงสลับได้โดยไม่ต้องแก้ระบบสนทนา กล้อง หรือหน้าจอ
// รูปแบบ manifest.json ดูที่ /assets/avatar/manifest.example.json และ kiosk/avatar/README.md

import { RigRenderer, el } from "./AvatarRenderer.js";

const SLOT_PARENT = {
  shadow: "shadow", hair_back: "hair_back", legs: "legs", shoes: "shoes", body: "body", neck: "neck",
  arm_l_upper: "arm_l_upper", arm_l_fore: "arm_l_fore", arm_r_upper: "arm_r_upper", arm_r_fore: "arm_r_fore",
  head: "head", hair_front: "hair_front", accessories: "accessories",
};

export class LayeredImageRenderer extends RigRenderer {
  /** สร้างจาก URL ของ manifest — โหลดภาพทุกเลเยอร์ให้เสร็จก่อนแสดง ถ้าโหลดไม่ได้จะโยน Error ให้ผู้เรียกกลับไปใช้อวตารจำลอง */
  static async load(container, manifestUrl) {
    const res = await fetch(manifestUrl, { cache: "no-cache" });
    if (!res.ok) throw new Error(`โหลด manifest ไม่ได้ (${res.status})`);
    const m = await res.json();
    const base = new URL(m.base || ".", new URL(manifestUrl, location.href)).href;
    const urls = [];
    for (const l of m.layers || []) urls.push(new URL(l.src, base).href);
    for (const k of ["eyes", "mouth"]) for (const v of Object.values(m[k] || {})) if (typeof v === "string") urls.push(new URL(v, base).href);
    await Promise.all(urls.map((u) => new Promise((ok, bad) => {
      const img = new Image();
      img.onload = ok; img.onerror = () => bad(new Error(`โหลดภาพเลเยอร์ไม่ได้: ${u}`));
      img.src = u;
    })));
    return new LayeredImageRenderer(container, m, base);
  }

  constructor(container, manifest, base) {
    const vb = manifest.viewBox || [0, 0, 400, 820];
    super(container, { pivots: manifest.pivots || {}, viewBox: vb, label: manifest.label || "อวตาร VORA" });
    this.m = manifest;
    // ไม่บังคับ: รายชื่อท่าที่ตัวละครนี้ทำได้จริง (เช่น PSD ไม่มีแขนแยก) — ไม่ระบุ = ใช้ท่ามาตรฐานทั้งหมด
    this.animations = Array.isArray(manifest.animations) ? manifest.animations : null;
    const url = (src) => new URL(src, base).href;
    const full = { x: vb[0], y: vb[1], width: vb[2], height: vb[3] };
    const image = (parent, src, box) => el("image", { href: url(src), ...(box ? { x: box[0], y: box[1], width: box[2], height: box[3] } : full), preserveAspectRatio: "none" }, parent);

    for (const l of manifest.layers || []) {
      const slot = SLOT_PARENT[l.slot || l.id];
      if (!slot) { console.warn("avatar: ไม่รู้จักช่องเลเยอร์", l.slot || l.id); continue; }
      image(this.L[slot], l.src, l.box);
    }
    // ตาและปากแยกเป็นภาพตามสถานะ แสดงทีละภาพ
    this.eyeImgs = {};
    for (const [k, src] of Object.entries(manifest.eyes || {})) if (k !== "box") this.eyeImgs[k] = image(this.L.eyes, src, manifest.eyes.box);
    this.mouthImgs = {};
    for (const [k, src] of Object.entries(manifest.mouth || {})) if (k !== "box") this.mouthImgs[k] = image(this.L.mouth, src, manifest.mouth.box);
    this.eyeCenter = manifest.eyes && manifest.eyes.box ? manifest.eyes.box[1] + manifest.eyes.box[3] / 2 : 208;
  }

  show(map, key, fallback) {
    const k = map[key] ? key : fallback;
    for (const [name, img] of Object.entries(map)) img.setAttribute("opacity", name === k ? 1 : 0);
  }

  drawFace(p) {
    // ตา: open / closed / happy / sad (ภาพที่ไม่มีจะใช้ open แทน) — กะพริบด้วยภาพ closed ถ้ามี ไม่เช่นนั้นย่อแนวตั้ง
    const blinking = p.blink < 0.45 && this.eyeImgs.closed && (p.eyes === "open" || p.eyes === "up" || p.eyes === "sad");
    this.show(this.eyeImgs, blinking ? "closed" : p.eyes === "up" ? "open" : p.eyes, "open");
    if (!this.eyeImgs.closed) {
      this.L.eyes.setAttribute("transform", `translate(0 ${this.eyeCenter}) scale(1 ${p.blink.toFixed(2)}) translate(0 ${-this.eyeCenter})`);
    }
    // ปาก: smile / neutral / sad / talk_half / talk_open (เลือกตามระดับเสียง)
    let key = p.mouth;
    if (p.mouth === "talk") key = p.mouthOpen > 0.55 ? "talk_open" : p.mouthOpen > 0.2 ? "talk_half" : "neutral";
    this.show(this.mouthImgs, key, key.startsWith("talk") ? "talk_open" : "smile");
  }
}
