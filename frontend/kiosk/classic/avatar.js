// อวตาร์ VORA แบบเต็มตัว (SVG) — แสดงสถานะ อารมณ์ ท่าทาง การขยับปากตามเสียง และมองตามผู้ใช้
// ชื่อท่าทางชุดเดียวกับที่ส่งให้หุ่นยนต์จริง (ดู backend/app/robot/protocol.py: GESTURES)

const NS = "http://www.w3.org/2000/svg";
const STATE_COLOR = { idle: "#3cc8f5", listening: "#1f9d63", thinking: "#8a63d2", speaking: "#1d5aa6", sleeping: "#9fb3c8", error: "#d64545" };

const GESTURE_DURATION = {
  wave: 2200, bow: 2000, nod: 1200, shake: 1200, present: 1800, point_screen: 1500, point_direction: 1500,
  explain: 1600, think: 1200, happy: 1800, shrug: 1400, listen: 800, dance: 4000, spin: 3500, idle: 300,
};

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const bell = (p) => Math.sin(Math.min(1, Math.max(0, p)) * Math.PI);

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export class Avatar {
  constructor(container) {
    this.container = container;
    this.state = "idle";
    this.emotion = "neutral";
    this.mouthLevel = 0;
    this.look = { x: 0, y: 0 };
    this.lookTarget = { x: 0, y: 0 };
    this.gestureName = null;
    this.gestureStart = 0;
    this.blinkAt = performance.now() + 2500;
    this.build();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  build() {
    const svg = el("svg", { viewBox: "0 0 400 660", role: "img", "aria-label": "อวตาร์หุ่นยนต์วอร่า" });
    const defs = el("defs", {}, svg);
    const shell = el("linearGradient", { id: "shell", x1: "0", y1: "0", x2: "1", y2: "1" }, defs);
    el("stop", { offset: "0", "stop-color": "#ffffff" }, shell);
    el("stop", { offset: "1", "stop-color": "#dbe6f2" }, shell);
    const visor = el("radialGradient", { id: "visor", cx: "0.5", cy: "0.35", r: "0.75" }, defs);
    el("stop", { offset: "0", "stop-color": "#17406e" }, visor);
    el("stop", { offset: "1", "stop-color": "#081a30" }, visor);
    const stripes = el("pattern", { id: "hazard", width: "22", height: "22", patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("rect", { width: "22", height: "22", fill: "#ffc93c" }, stripes);
    el("rect", { width: "11", height: "22", fill: "#0f2740" }, stripes);
    const glow = el("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
    el("feGaussianBlur", { stdDeviation: "3.5", result: "b" }, glow);
    const merge = el("feMerge", {}, glow);
    el("feMergeNode", { in: "b" }, merge);
    el("feMergeNode", { in: "SourceGraphic" }, merge);

    // พื้นและวงแหวนสถานะ
    this.ring = el("ellipse", { cx: 200, cy: 628, rx: 150, ry: 22, fill: "none", "stroke-width": 5, stroke: STATE_COLOR.idle, opacity: 0.85 }, svg);
    el("ellipse", { cx: 200, cy: 626, rx: 118, ry: 14, fill: "#0f2740", opacity: 0.18 }, svg);

    this.root = el("g", {}, svg);
    // ฐานล้อ
    const base = el("g", {}, this.root);
    el("path", { d: "M128 548 Q200 530 272 548 L292 606 Q200 626 108 606 Z", fill: "#133f78" }, base);
    el("path", { d: "M118 590 Q200 608 282 590", stroke: "#3cc8f5", "stroke-width": 4, fill: "none", opacity: 0.8, filter: "url(#glow)" }, base);
    el("ellipse", { cx: 150, cy: 610, rx: 18, ry: 8, fill: "#0f2740" }, base);
    el("ellipse", { cx: 250, cy: 610, rx: 18, ry: 8, fill: "#0f2740" }, base);

    this.body = el("g", {}, this.root);
    // แขนซ้าย (ฝั่งผู้ชม) อยู่หลังลำตัว
    this.armL = this.buildArm(this.body, 128, 336, 1);
    this.armR = this.buildArm(this.body, 272, 336, -1);
    // ลำตัว
    el("rect", { x: 124, y: 312, width: 152, height: 236, rx: 46, fill: "url(#shell)", stroke: "#b8c9dc", "stroke-width": 2 }, this.body);
    el("rect", { x: 124, y: 420, width: 152, height: 24, fill: "url(#hazard)" }, this.body);
    el("rect", { x: 124, y: 418, width: 152, height: 2, fill: "#0f2740", opacity: 0.4 }, this.body);
    el("rect", { x: 124, y: 444, width: 152, height: 2, fill: "#0f2740", opacity: 0.4 }, this.body);
    const badge = el("g", {}, this.body);
    el("circle", { cx: 200, cy: 370, r: 26, fill: "#1d5aa6" }, badge);
    this.chestLight = el("circle", { cx: 200, cy: 370, r: 20, fill: "none", stroke: "#3cc8f5", "stroke-width": 3, filter: "url(#glow)" }, badge);
    el("path", { d: "M188 360 L200 384 L212 360", stroke: "#fff", "stroke-width": 5, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, badge);
    el("rect", { x: 160, y: 470, width: 80, height: 10, rx: 5, fill: "#c9d6e6" }, this.body);
    el("rect", { x: 172, y: 490, width: 56, height: 10, rx: 5, fill: "#c9d6e6" }, this.body);
    // คอ
    el("rect", { x: 182, y: 290, width: 36, height: 30, rx: 10, fill: "#9fb3c8" }, this.body);

    // ศีรษะ
    this.head = el("g", {}, this.body);
    el("line", { x1: 200, y1: 118, x2: 200, y2: 86, stroke: "#9fb3c8", "stroke-width": 6, "stroke-linecap": "round" }, this.head);
    this.antenna = el("circle", { cx: 200, cy: 80, r: 11, fill: STATE_COLOR.idle, filter: "url(#glow)" }, this.head);
    el("circle", { cx: 98, cy: 206, r: 18, fill: "#1d5aa6" }, this.head);
    el("circle", { cx: 302, cy: 206, r: 18, fill: "#1d5aa6" }, this.head);
    el("rect", { x: 100, y: 116, width: 200, height: 182, rx: 78, fill: "url(#shell)", stroke: "#b8c9dc", "stroke-width": 2 }, this.head);
    el("rect", { x: 122, y: 148, width: 156, height: 118, rx: 52, fill: "url(#visor)" }, this.head);
    el("path", { d: "M140 166 Q170 152 205 156", stroke: "#ffffff", "stroke-width": 5, opacity: 0.22, fill: "none", "stroke-linecap": "round" }, this.head);

    this.face = el("g", { filter: "url(#glow)" }, this.head);
    this.eyeL = this.buildEye(this.face, 168, 202);
    this.eyeR = this.buildEye(this.face, 232, 202);
    this.mouth = el("rect", { x: 182, y: 238, width: 36, height: 6, rx: 3, fill: "#3cc8f5" }, this.face);
    this.dots = el("g", { opacity: 0 }, this.face);
    [184, 200, 216].forEach((x) => el("circle", { cx: x, cy: 241, r: 3.5, fill: "#3cc8f5" }, this.dots));
    this.cheekL = el("ellipse", { cx: 148, cy: 232, rx: 10, ry: 5, fill: "#ff8fb1", opacity: 0 }, this.head);
    this.cheekR = el("ellipse", { cx: 252, cy: 232, rx: 10, ry: 5, fill: "#ff8fb1", opacity: 0 }, this.head);

    this.container.replaceChildren(svg);
    this.svg = svg;
  }

  buildArm(parent, sx, sy, side) {
    const g = el("g", {}, parent);
    el("circle", { cx: sx, cy: sy, r: 20, fill: "#1d5aa6" }, g);
    el("rect", { x: sx - 15, y: sy, width: 30, height: 86, rx: 15, fill: "url(#shell)", stroke: "#b8c9dc", "stroke-width": 2 }, g);
    const fore = el("g", {}, g);
    el("circle", { cx: sx, cy: sy + 86, r: 13, fill: "#9fb3c8" }, fore);
    el("rect", { x: sx - 13, y: sy + 86, width: 26, height: 70, rx: 13, fill: "url(#shell)", stroke: "#b8c9dc", "stroke-width": 2 }, fore);
    el("circle", { cx: sx, cy: sy + 162, r: 17, fill: "#1d5aa6" }, fore);
    return { g, fore, sx, sy, side };
  }

  buildEye(parent, cx, cy) {
    const g = el("g", {}, parent);
    const open = el("ellipse", { cx, cy, rx: 15, ry: 21, fill: "#3cc8f5" }, g);
    const shine = el("circle", { cx: cx + 5, cy: cy - 8, r: 4, fill: "#e8fbff" }, g);
    const happy = el("path", { d: `M${cx - 16} ${cy + 6} Q${cx} ${cy - 20} ${cx + 16} ${cy + 6}`, stroke: "#3cc8f5", "stroke-width": 7, fill: "none", "stroke-linecap": "round", opacity: 0 }, g);
    return { g, open, shine, happy, cx, cy };
  }

  // ------------------------------------------------------------------ API
  setState(state) {
    this.state = state;
    const c = STATE_COLOR[state] || STATE_COLOR.idle;
    this.ring.setAttribute("stroke", c);
    this.antenna.setAttribute("fill", c);
    this.chestLight.setAttribute("stroke", c);
    this.dots.setAttribute("opacity", state === "thinking" ? 1 : 0);
    this.mouth.setAttribute("opacity", state === "thinking" ? 0 : 1);
    if (state === "listening") this.gesture("listen");
    if (state === "thinking") this.gesture("think");
  }

  setEmotion(emotion) {
    this.emotion = emotion || "neutral";
    const happy = this.emotion === "happy";
    for (const e of [this.eyeL, this.eyeR]) {
      e.open.setAttribute("opacity", happy ? 0 : 1);
      e.shine.setAttribute("opacity", happy ? 0 : 1);
      e.happy.setAttribute("opacity", happy ? 1 : 0);
    }
    this.cheekL.setAttribute("opacity", happy ? 0.55 : 0);
    this.cheekR.setAttribute("opacity", happy ? 0.55 : 0);
    clearTimeout(this.emoTimer);
    if (this.emotion !== "neutral") this.emoTimer = setTimeout(() => this.setEmotion("neutral"), 6000);
  }

  gesture(name) {
    if (!name || !(name in GESTURE_DURATION)) return;
    this.gestureName = name;
    this.gestureStart = performance.now();
  }

  setMouth(level) { this.mouthLevel = Math.max(0, Math.min(1, level)); }

  /** x,y ในช่วง -1..1 (จากตำแหน่งใบหน้าที่กล้องเห็น) */
  lookAt(x, y = 0) { this.lookTarget = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) }; }

  // ------------------------------------------------------------------ วงรอบการเคลื่อนไหว
  loop(now) {
    const t = now / 1000;
    let armL = [8, 4], armR = [8, 4], headRot = 0, headDy = 0, bodyRot = 0, bodyDx = 0, bodyDy = Math.sin(t * 2) * 2.2;
    let eyeDx = 0, eyeDy = 0;

    if (this.state === "listening") headRot = 6;
    if (this.state === "sleeping") { headDy = 6; bodyDy *= 0.4; }

    if (this.gestureName) {
      const dur = GESTURE_DURATION[this.gestureName];
      const p = (now - this.gestureStart) / dur;
      if (p >= 1) this.gestureName = null;
      else {
        const s = bell(p), e = ease(Math.min(1, p * 3));
        switch (this.gestureName) {
          case "wave": armR = [150 * s, 20 + 28 * Math.sin(t * 11) * s]; headRot = -6 * s; break;
          case "bow": headDy = 10 * s; bodyRot = 0; armL = [20 * s + 8, 30 * s]; armR = [20 * s + 8, 30 * s]; headRot = 0; bodyDy += 6 * s; break;
          case "nod": headDy = 6 * Math.sin(t * 14) * s; break;
          case "shake": headRot = 9 * Math.sin(t * 14) * s; break;
          case "present": armL = [50 * s + 8, 40 * s]; armR = [62 * s + 8, 30 * s]; break;
          case "point_screen": armR = [95 * s, -10 * s]; eyeDx = 6 * s; headRot = 6 * s; break;
          case "point_direction": armL = [100 * s, -5 * s]; eyeDx = -6 * s; headRot = -6 * s; break;
          case "explain": armR = [40 * s + 8, 50 * s + 10 * Math.sin(t * 8) * s]; armL = [25 * s + 8, 30 * s]; break;
          case "think": armR = [30 * e, 120 * e]; eyeDx = 5 * e; eyeDy = -6 * e; headRot = 8 * e; break;
          case "happy": armL = [130 * s + 15 * Math.sin(t * 12) * s, 30 * s]; armR = [130 * s + 15 * Math.sin(t * 12 + 1) * s, 30 * s]; bodyDy -= 8 * Math.abs(Math.sin(t * 8)) * s; break;
          case "shrug": armL = [45 * s, 70 * s]; armR = [45 * s, 70 * s]; headRot = 10 * s; break;
          case "listen": headRot = 8 * s; break;
          case "dance": armL = [90 + 40 * Math.sin(t * 9), 40]; armR = [90 + 40 * Math.sin(t * 9 + Math.PI), 40]; bodyRot = 6 * Math.sin(t * 6) * s; bodyDx = 14 * Math.sin(t * 6) * s; break;
          case "spin": bodyDx = 0; armL = [70 * s, 10]; armR = [70 * s, 10]; this.spin = p; break;
        }
      }
    }
    // มองตามผู้ใช้อย่างนุ่มนวล
    this.look.x += (this.lookTarget.x - this.look.x) * 0.08;
    this.look.y += (this.lookTarget.y - this.look.y) * 0.08;
    eyeDx += this.look.x * 9;
    eyeDy += this.look.y * 5;
    headRot += this.look.x * 5;

    // กะพริบตา
    let blink = 1;
    if (now > this.blinkAt) {
      const bp = (now - this.blinkAt) / 160;
      blink = bp < 1 ? Math.abs(1 - 2 * bp) * 0.9 + 0.1 : 1;
      if (bp >= 1) this.blinkAt = now + 2200 + Math.random() * 3500;
    }
    for (const e of [this.eyeL, this.eyeR]) {
      e.g.setAttribute("transform", `translate(${eyeDx} ${eyeDy}) translate(${e.cx} ${e.cy}) scale(1 ${this.state === "listening" ? blink * 1.12 : blink}) translate(${-e.cx} ${-e.cy})`);
    }
    // ปาก: ขยับตามระดับเสียง
    if (this.state === "speaking") {
      const lvl = this.mouthLevel || (0.35 + 0.35 * Math.abs(Math.sin(t * 17)) * Math.abs(Math.sin(t * 5.3)));
      const h = 6 + lvl * 20;
      this.mouth.setAttribute("height", h.toFixed(1));
      this.mouth.setAttribute("y", (241 - h / 2).toFixed(1));
      this.mouth.setAttribute("width", (36 - lvl * 8).toFixed(1));
      this.mouth.setAttribute("x", (182 + lvl * 4).toFixed(1));
    } else {
      const sorry = this.emotion === "sorry";
      this.mouth.setAttribute("height", 6); this.mouth.setAttribute("y", sorry ? 242 : 238);
      this.mouth.setAttribute("width", sorry ? 24 : 36); this.mouth.setAttribute("x", sorry ? 188 : 182);
    }
    if (this.state === "thinking") {
      [...this.dots.children].forEach((d, i) => d.setAttribute("cy", (241 - 5 * Math.max(0, Math.sin(t * 7 - i * 0.7))).toFixed(1)));
    }
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t * (this.state === "listening" ? 4 : 1.6)));
    this.antenna.setAttribute("opacity", pulse.toFixed(2));
    this.ring.setAttribute("opacity", (0.35 + 0.5 * pulse).toFixed(2));

    const setArm = (arm, [up, fore]) => {
      arm.g.setAttribute("transform", `rotate(${(arm.side * up).toFixed(1)} ${arm.sx} ${arm.sy})`);
      arm.fore.setAttribute("transform", `rotate(${(arm.side * fore).toFixed(1)} ${arm.sx} ${arm.sy + 86})`);
    };
    setArm(this.armL, armL);
    setArm(this.armR, armR);
    this.head.setAttribute("transform", `translate(0 ${headDy.toFixed(1)}) rotate(${headRot.toFixed(1)} 200 300)`);
    let sx = 1;
    if (this.gestureName === "spin" && this.spin != null) sx = Math.cos(this.spin * Math.PI * 2);
    this.body.setAttribute("transform", `translate(${bodyDx.toFixed(1)} ${bodyDy.toFixed(1)}) rotate(${bodyRot.toFixed(1)} 200 600) translate(200 0) scale(${sx.toFixed(3)} 1) translate(-200 0)`);
    requestAnimationFrame(this.loop);
  }
}
