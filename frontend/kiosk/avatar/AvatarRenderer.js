// ตัววาดอวตาร — แบ่งเป็นเลเยอร์ตามชื่อมาตรฐาน (LAYER_SLOTS) และจุดหมุนชุดเดียวกัน
//   RigRenderer         : โครงกระดูก/จุดหมุนกลาง ใช้ร่วมกันทุกแบบ (รับ pose จาก AvatarController แล้วจัดตำแหน่งเลเยอร์)
//   PlaceholderRenderer : อวตารจำลอง วาดด้วย SVG (ใช้ระหว่างรออวตารตัวจริง)
// อวตารจริงจาก PSD ใช้ LayeredImageRenderer (ไฟล์ LayeredImageRenderer.js) ซึ่งสืบทอด RigRenderer เหมือนกัน

import { DEFAULT_PIVOTS } from "./avatar-states.js";

export const NS = "http://www.w3.org/2000/svg";
export function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/** โครงหลัก: สร้างกลุ่มเลเยอร์ตามลำดับชั้น แล้วจัดท่าทางทุกเฟรม */
export class RigRenderer {
  constructor(container, { pivots = DEFAULT_PIVOTS, viewBox = [0, 0, 400, 820], label = "อวตาร VORA" } = {}) {
    this.container = container;
    this.pv = { ...DEFAULT_PIVOTS, ...pivots };
    const svg = el("svg", { viewBox: viewBox.join(" "), role: "img", "aria-label": label, class: "avatar-svg" });
    this.svg = svg;
    this.defs = el("defs", {}, svg);
    // ลำดับชั้นของเลเยอร์ (หลัง → หน้า) ชื่อตรงกับ LAYER_SLOTS
    const L = (name, parent) => el("g", { "data-layer": name }, parent);
    this.L = {};
    this.L.shadow = L("shadow", svg);
    this.L.root = el("g", { "data-layer": "root" }, svg);
    this.L.hair_back = L("hair_back", this.L.root);
    this.L.legs = L("legs", this.L.root);
    this.L.shoes = L("shoes", this.L.root);
    this.L.body = L("body", this.L.root);
    this.L.neck = L("neck", this.L.root);
    this.L.armL = el("g", { "data-layer": "arm_l" }, this.L.root);
    this.L.arm_l_upper = L("arm_l_upper", this.L.armL);
    this.L.armLfore = el("g", { "data-layer": "arm_l_fore_pivot" }, this.L.armL);
    this.L.arm_l_fore = L("arm_l_fore", this.L.armLfore);
    this.L.armR = el("g", { "data-layer": "arm_r" }, this.L.root);
    this.L.arm_r_upper = L("arm_r_upper", this.L.armR);
    this.L.armRfore = el("g", { "data-layer": "arm_r_fore_pivot" }, this.L.armR);
    this.L.arm_r_fore = L("arm_r_fore", this.L.armRfore);
    this.L.headPivot = el("g", { "data-layer": "head_pivot" }, this.L.root);
    this.L.head = L("head", this.L.headPivot);
    this.L.eyes = L("eyes", this.L.headPivot);
    this.L.mouth = L("mouth", this.L.headPivot);
    this.L.hair_front = L("hair_front", this.L.headPivot);
    this.L.accessories = L("accessories", this.L.headPivot);
    container.replaceChildren(svg);
  }

  setState(state, def) { this.svg.dataset.state = state; this.svg.style.setProperty("--state-color", def.color); }

  /** Avatar Adapter: ตัววาดรองรับท่านี้จริงหรือไม่ (animations = null คือรองรับท่ามาตรฐานของโครงกระดูกทั้งหมด) */
  supportsAnimation(name) { return !this.animations || this.animations.includes(name); }

  render(p) {
    const pv = this.pv;
    const setArm = (g, fore, [sx, sy], [ex, ey], side, [up, f]) => {
      g.setAttribute("transform", `rotate(${(side * up).toFixed(1)} ${sx} ${sy})`);
      fore.setAttribute("transform", `rotate(${(side * f).toFixed(1)} ${ex} ${ey})`);
    };
    setArm(this.L.armL, this.L.armLfore, pv.armL, pv.elbowL, 1, p.armL);
    setArm(this.L.armR, this.L.armRfore, pv.armR, pv.elbowR, -1, p.armR);
    const head = `translate(0 ${p.headDy.toFixed(1)}) rotate(${p.headRot.toFixed(1)} ${pv.head[0]} ${pv.head[1]})`;
    this.L.headPivot.setAttribute("transform", head);
    // ผมด้านหลังขยับตามศีรษะเพียงครึ่งเดียว ดูเป็นธรรมชาติกว่า
    this.L.hair_back.setAttribute("transform", `translate(0 ${(p.headDy * 0.6).toFixed(1)}) rotate(${(p.headRot * 0.5).toFixed(1)} ${pv.head[0]} ${pv.head[1]})`);
    const [fx, fy] = pv.feet;
    this.L.root.setAttribute("transform",
      `translate(${p.bodyDx.toFixed(1)} ${p.bodyDy.toFixed(1)}) rotate(${p.bodyRot.toFixed(1)} ${fx} ${fy}) translate(${fx} 0) scale(${p.spin.toFixed(3)} 1) translate(${-fx} 0)`);
    this.drawFace(p);
  }

  drawFace() { /* ให้คลาสลูกวาดตา/ปาก */ }
  destroy() { this.container.replaceChildren(); }
}

/** อวตารจำลอง: ผู้ช่วยประชาสัมพันธ์ในชุดแจ็กเก็ตดำ-เหลือง (ออกแบบขึ้นใหม่ ใช้ชั่วคราวจนกว่าอวตารจริงพร้อม) */
export class PlaceholderRenderer extends RigRenderer {
  constructor(container) {
    super(container, { label: "อวตารจำลองของ VORA" });
    const C = { skin: "#F6D3BC", skinShade: "#E9B99F", hair: "#211D27", hairHi: "#3B3446", jacket: "#15171C", jacketHi: "#2A2D35",
      y: "#FFD400", yHi: "#FFEA70", shirt: "#F3F3F5", iris: "#5A3B2A", lip: "#D46A6E" };
    this.C = C;
    const d = this.defs;
    const g1 = el("linearGradient", { id: "pj", x1: 0, y1: 0, x2: 1, y2: 0 }, d);
    el("stop", { offset: 0, "stop-color": "#0E0F13" }, g1); el("stop", { offset: .5, "stop-color": C.jacketHi }, g1); el("stop", { offset: 1, "stop-color": "#0E0F13" }, g1);
    const g2 = el("radialGradient", { id: "pshadow", cx: .5, cy: .5, r: .5 }, d);
    el("stop", { offset: 0, "stop-color": "#000", "stop-opacity": .55 }, g2); el("stop", { offset: 1, "stop-color": "#000", "stop-opacity": 0 }, g2);

    // เงาที่พื้น
    el("ellipse", { cx: 200, cy: 790, rx: 92, ry: 14, fill: "url(#pshadow)" }, this.L.shadow);

    // ผมด้านหลัง (ยาวประบ่า)
    el("path", { d: "M136 196 Q132 116 200 112 Q268 116 264 196 L272 300 Q262 322 236 314 L200 300 L164 314 Q138 322 128 300 Z", fill: C.hair }, this.L.hair_back);

    // ขา + ถุงเท้ายาว
    for (const x of [181, 219]) {
      el("rect", { x: x - 13, y: 520, width: 26, height: 230, rx: 12, fill: C.skin }, this.L.legs);
      el("rect", { x: x - 14, y: 660, width: 28, height: 92, rx: 10, fill: C.jacket }, this.L.legs);
      el("rect", { x: x - 14, y: 664, width: 28, height: 6, fill: C.y }, this.L.legs);
    }
    // รองเท้าผ้าใบ
    for (const [x, dir] of [[178, -1], [222, 1]]) {
      el("path", { d: `M${x - 18} 752 h36 q${dir > 0 ? 12 : 0} 0 ${dir > 0 ? 14 : 0} 14 v12 h-${dir > 0 ? 50 : 36} q-${dir > 0 ? 0 : 14} 0 -${dir > 0 ? 0 : 14} -12 z`, fill: "#F4F4F6" }, this.L.shoes);
      el("rect", { x: x - 20 + (dir > 0 ? 0 : -12), y: 772, width: dir > 0 ? 54 : 52, height: 8, rx: 4, fill: C.jacket }, this.L.shoes);
      el("path", { d: `M${x - 10} 758 l10 6 l10 -6`, stroke: C.y, "stroke-width": 3, fill: "none", "stroke-linecap": "round" }, this.L.shoes);
    }

    // กระโปรงจีบ + ขอบเหลือง
    const b = this.L.body;
    el("path", { d: "M142 438 L258 438 L284 546 Q200 562 116 546 Z", fill: C.jacket }, b);
    for (const x of [158, 182, 206, 230]) el("path", { d: `M${x + 6} 446 L${x - 2 + (x - 200) * 0.25} 552`, stroke: C.jacketHi, "stroke-width": 2 }, b);
    el("path", { d: "M117 541 Q200 557 283 541 L284 548 Q200 564 116 548 Z", fill: C.y }, b);
    // เสื้อเชิ้ตด้านใน
    el("path", { d: "M176 290 L224 290 L230 440 L170 440 Z", fill: C.shirt }, b);
    el("path", { d: "M192 292 L200 318 L208 292", fill: "none", stroke: "#C9CBD1", "stroke-width": 2 }, b);
    // แจ็กเก็ต 2 ฝั่ง
    el("path", { d: "M148 294 Q160 284 184 288 L196 440 L136 440 Q134 360 148 294 Z", fill: "url(#pj)" }, b);
    el("path", { d: "M252 294 Q240 284 216 288 L204 440 L264 440 Q266 360 252 294 Z", fill: "url(#pj)" }, b);
    el("path", { d: "M184 288 L196 440", stroke: C.y, "stroke-width": 4 }, b);
    el("path", { d: "M216 288 L204 440", stroke: C.y, "stroke-width": 4 }, b);
    // ปกเสื้อตั้งสีเหลือง
    el("path", { d: "M170 284 L188 286 L194 318 L172 302 Z", fill: C.y }, b);
    el("path", { d: "M230 284 L212 286 L206 318 L228 302 Z", fill: C.y }, b);
    // เข็มขัด
    el("rect", { x: 140, y: 428, width: 120, height: 14, rx: 4, fill: "#0B0C0F" }, b);
    el("rect", { x: 192, y: 427, width: 16, height: 16, rx: 3, fill: "none", stroke: C.y, "stroke-width": 3 }, b);
    // ตราสัญลักษณ์ V ที่หน้าอก
    el("path", { d: "M156 330 L164 346 L172 330", stroke: C.y, "stroke-width": 4, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, b);

    // คอ
    el("rect", { x: 188, y: 252, width: 24, height: 42, rx: 10, fill: C.skinShade }, this.L.neck);

    // แขน (ต้นแขน + ปลายแขน + มือ)
    const arm = (upper, fore, [sx, sy]) => {
      el("circle", { cx: sx, cy: sy, r: 17, fill: C.jacket }, upper);
      el("rect", { x: sx - 15, y: sy - 4, width: 30, height: 98, rx: 14, fill: C.jacket }, upper);
      el("rect", { x: sx - 15, y: sy + 30, width: 30, height: 5, fill: C.y, opacity: .9 }, upper);
      el("rect", { x: sx - 13, y: sy + 84, width: 26, height: 72, rx: 12, fill: C.jacket }, fore);
      el("rect", { x: sx - 14, y: sy + 140, width: 28, height: 10, rx: 4, fill: C.y }, fore);
      el("circle", { cx: sx, cy: sy + 166, r: 13, fill: C.skin }, fore);
      el("rect", { x: sx - 12, y: sy + 146, width: 24, height: 8, fill: "#0B0C0F", rx: 3 }, fore);   // สายรัดข้อมือ
    };
    arm(this.L.arm_l_upper, this.L.arm_l_fore, this.pv.armL);
    arm(this.L.arm_r_upper, this.L.arm_r_fore, this.pv.armR);

    // ศีรษะ
    const h = this.L.head;
    el("ellipse", { cx: 150, cy: 210, rx: 9, ry: 13, fill: C.skinShade }, h);
    el("ellipse", { cx: 250, cy: 210, rx: 9, ry: 13, fill: C.skinShade }, h);
    el("path", { d: "M150 190 Q150 130 200 130 Q250 130 250 190 Q250 246 214 262 Q200 268 186 262 Q150 246 150 190 Z", fill: C.skin }, h);
    this.cheeks = el("g", { opacity: .35 }, h);
    el("ellipse", { cx: 170, cy: 232, rx: 10, ry: 5, fill: "#FF8E9A" }, this.cheeks);
    el("ellipse", { cx: 230, cy: 232, rx: 10, ry: 5, fill: "#FF8E9A" }, this.cheeks);

    // ตา (หลายรูปแบบ สลับตามสถานะ)
    this.eye = [181, 219].map((cx) => {
      const g = el("g", {}, this.L.eyes);
      const open = el("g", {}, g);
      el("ellipse", { cx, cy: 208, rx: 11, ry: 13, fill: "#fff" }, open);
      const iris = el("g", {}, open);
      el("circle", { cx, cy: 209, r: 8.5, fill: C.iris }, iris);
      el("circle", { cx, cy: 209, r: 8.5, fill: "none", stroke: C.y, "stroke-width": 1.6, opacity: .8 }, iris);
      el("circle", { cx, cy: 209, r: 4, fill: "#120D0A" }, iris);
      el("circle", { cx: cx + 3, cy: 205, r: 2.6, fill: "#fff" }, iris);
      el("path", { d: `M${cx - 13} 201 Q${cx} 190 ${cx + 13} 200`, stroke: C.hair, "stroke-width": 3.5, fill: "none", "stroke-linecap": "round" }, open);
      const happy = el("path", { d: `M${cx - 11} 212 Q${cx} 198 ${cx + 11} 212`, stroke: C.hair, "stroke-width": 4, fill: "none", "stroke-linecap": "round" }, g);
      const brow = el("path", { d: `M${cx - 11} 186 Q${cx} 181 ${cx + 11} 186`, stroke: C.hair, "stroke-width": 3, fill: "none", "stroke-linecap": "round" }, g);
      return { g, open, iris, happy, brow, cx };
    });

    // ปาก
    const m = this.L.mouth;
    this.mouthSmile = el("path", { d: "M188 240 Q200 250 212 240", stroke: C.lip, "stroke-width": 3.5, fill: "none", "stroke-linecap": "round" }, m);
    this.mouthNeutral = el("path", { d: "M191 243 Q200 245 209 243", stroke: C.lip, "stroke-width": 3.5, fill: "none", "stroke-linecap": "round" }, m);
    this.mouthSad = el("path", { d: "M190 246 Q200 239 210 246", stroke: C.lip, "stroke-width": 3.5, fill: "none", "stroke-linecap": "round" }, m);
    this.mouthTalk = el("g", {}, m);
    this.talkOuter = el("ellipse", { cx: 200, cy: 243, rx: 9, ry: 5, fill: "#7A2430" }, this.mouthTalk);
    this.talkTongue = el("ellipse", { cx: 200, cy: 246, rx: 5, ry: 2.5, fill: "#E58A8F" }, this.mouthTalk);

    // ผมด้านหน้า (หน้าม้า) + กิ๊บติดผมสีเหลือง
    const hf = this.L.hair_front;
    el("path", { d: "M146 196 Q140 122 200 120 Q262 122 254 196 Q246 166 228 156 Q222 176 204 160 Q190 178 176 158 Q158 170 146 196 Z", fill: C.hair }, hf);
    el("path", { d: "M170 136 Q196 126 226 134", stroke: C.hairHi, "stroke-width": 4, fill: "none", "stroke-linecap": "round", opacity: .8 }, hf);
    el("rect", { x: 226, y: 150, width: 20, height: 6, rx: 3, fill: C.y, transform: "rotate(-24 236 153)" }, hf);
    el("rect", { x: 229, y: 160, width: 20, height: 6, rx: 3, fill: C.y, transform: "rotate(-24 239 163)" }, hf);

    // อุปกรณ์เสริม: เฮดเซ็ตพร้อมไมค์ (สื่อว่าเป็นผู้ช่วยตอบคำถาม)
    const a = this.L.accessories;
    el("path", { d: "M144 200 Q140 108 200 104 Q260 108 256 200", stroke: "#0B0C0F", "stroke-width": 6, fill: "none" }, a);
    for (const x of [146, 254]) {
      el("circle", { cx: x, cy: 208, r: 14, fill: "#0B0C0F" }, a);
      el("circle", { cx: x, cy: 208, r: 9, fill: "none", stroke: C.y, "stroke-width": 3 }, a);
    }
    el("path", { d: "M252 220 Q246 252 216 250", stroke: "#0B0C0F", "stroke-width": 4, fill: "none", "stroke-linecap": "round" }, a);
    this.micTip = el("circle", { cx: 214, cy: 250, r: 4.5, fill: C.y }, a);

    // สัญลักษณ์กำลังคิด (จุดสามจุดเหนือศีรษะ)
    this.thinkDots = el("g", { opacity: 0 }, a);
    [176, 200, 224].forEach((x) => el("circle", { cx: x, cy: 88, r: 6, fill: C.y }, this.thinkDots));
  }

  setState(state, def) {
    super.setState(state, def);
    this.micTip.setAttribute("fill", def.color);
  }

  drawFace(p) {
    const showOpen = p.eyes === "open" || p.eyes === "up" || p.eyes === "sad";
    for (const e of this.eye) {
      e.open.setAttribute("opacity", showOpen ? 1 : 0);
      e.happy.setAttribute("opacity", p.eyes === "happy" ? 1 : 0);
      const sy = showOpen ? p.blink : 1;
      e.open.setAttribute("transform", `translate(${e.cx} 208) scale(1 ${sy.toFixed(2)}) translate(${-e.cx} -208)`);
      e.iris.setAttribute("transform", `translate(${Math.max(-4, Math.min(4, p.eyeDx)).toFixed(1)} ${Math.max(-4, Math.min(3, p.eyeDy)).toFixed(1)})`);
      const sad = p.eyes === "sad";
      const left = e.cx < 200;
      e.brow.setAttribute("transform", sad ? `rotate(${left ? -12 : 12} ${e.cx} 186)` : p.eyes === "up" ? "translate(0 -3)" : "");
    }
    const talk = p.mouth === "talk";
    this.mouthTalk.setAttribute("opacity", talk ? 1 : 0);
    this.mouthSmile.setAttribute("opacity", p.mouth === "smile" ? 1 : 0);
    this.mouthNeutral.setAttribute("opacity", p.mouth === "neutral" ? 1 : 0);
    this.mouthSad.setAttribute("opacity", p.mouth === "sad" ? 1 : 0);
    if (talk) {
      this.talkOuter.setAttribute("ry", (2 + p.mouthOpen * 9).toFixed(1));
      this.talkOuter.setAttribute("rx", (10 - p.mouthOpen * 2).toFixed(1));
      this.talkTongue.setAttribute("opacity", p.mouthOpen > 0.35 ? 1 : 0);
    }
    this.cheeks.setAttribute("opacity", p.eyes === "happy" || p.mouth === "smile" ? 0.5 : 0.25);
    this.thinkDots.setAttribute("opacity", p.thinking ? 1 : 0);
    if (p.thinking) [...this.thinkDots.children].forEach((d, i) => d.setAttribute("cy", (88 - 6 * Math.max(0, Math.sin(p.t * 6 - i * 0.7))).toFixed(1)));
  }
}
