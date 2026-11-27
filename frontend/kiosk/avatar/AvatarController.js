// ตัวควบคุมอวตาร: รับ "สถานะ อารมณ์ ท่าทาง ระดับเสียง ทิศที่มอง" แล้วคำนวณท่าทาง (pose) เป็นตัวเลขล้วน
// แล้วส่งให้ Renderer วาด — เปลี่ยนจากอวตารจำลองเป็นอวตารจริงได้ด้วยการเปลี่ยน Renderer อย่างเดียว
// API ด้านนอกเข้ากันได้กับ avatar.js เดิม: setState, setEmotion, gesture, setMouth, lookAt
// connect(bus, dom): รับ Event จากระบบอื่น (ฟัง/คิด/พูด/ทักทาย/ท่าทาง/ทิศที่มอง) + จัดการกล่องคำพูด
//                    และขยายอวตารเมื่อหน้าจอเข้าโหมดว่าง (Avatar Focus Mode) — ไม่มีตรรกะ AI หรือกล้องในไฟล์นี้

import { EV } from "../core/event-bus.js";
import { AVATAR_STATES, EXPRESSIONS, GESTURE_DURATION, STANDARD_STATES } from "./avatar-states.js";

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const bell = (p) => Math.sin(Math.min(1, Math.max(0, p)) * Math.PI);
const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export class AvatarController {
  constructor(renderer, { onStateChange } = {}) {
    this.renderer = renderer;
    this.onStateChange = onStateChange;
    this.state = "idle";
    this.emotion = "neutral";
    this.mouthLevel = 0;
    this.look = { x: 0, y: 0 };
    this.lookTarget = { x: 0, y: 0 };
    this.gestureName = null;
    this.gestureStart = 0;
    this.blinkAt = performance.now() + 2500;
    this.lastFrame = 0;
    this.talking = false;      // Phase 2: กำลังพูดอยู่ (ให้ปากขยับได้แม้อยู่ในสถานะนำเสนอ/ชี้)
    this.hint = null;          // Phase 2: สถานะนำเสนอชั่วคราว { state, until }
    this.scene = null;         // Phase 2: สถานะนำเสนอค้าง (ตลอดโหมดนำเสนอ)
    this.visible = true;
    this.disposed = false;
    this.loop = this.loop.bind(this);
    this.renderer.setState && this.renderer.setState("idle", AVATAR_STATES.idle);
    requestAnimationFrame(this.loop);
  }

  /** เปลี่ยนตัววาด (เช่น จากอวตารจำลองเป็นอวตารจริง) โดยไม่ต้องรีโหลดหน้า */
  setRenderer(renderer) {
    this.renderer.destroy && this.renderer.destroy();
    this.renderer = renderer;
    renderer.setState && renderer.setState(this.state, AVATAR_STATES[this.state]);
    if (this.motionLevel != null && renderer.setMotionLevel) renderer.setMotionLevel(this.motionLevel);
  }

  /** 19 พ.ย. 2569: ความมีชีวิตชีวาของอวตาร 0–200 % (หลังบ้าน → ตั้งค่า) · จำไว้ให้ตัววาดที่โหลดเสร็จทีหลังด้วย */
  setMotionLevel(pct) {
    this.motionLevel = pct;
    this.renderer && this.renderer.setMotionLevel && this.renderer.setMotionLevel(pct);
  }

  setState(state) {
    if (!AVATAR_STATES[state]) state = "idle";
    const changed = state !== this.state;
    this.state = state;
    const def = AVATAR_STATES[state];
    if (changed && def.enter) this.gesture(def.enter);
    if (state === "happy" || state === "greeting") this.setEmotion("happy");
    if (state === "error") this.setEmotion("sorry");
    this.renderer.setState && this.renderer.setState(state, def);
    if (changed && this.onStateChange) this.onStateChange(state, def);
  }

  setEmotion(emotion) {
    this.emotion = emotion || "neutral";
    clearTimeout(this.emoTimer);
    if (this.emotion !== "neutral") this.emoTimer = setTimeout(() => (this.emotion = "neutral"), 6000);
  }

  gesture(name) {
    if (!name || !(name in GESTURE_DURATION)) return;
    this.gestureName = name;
    this.gestureStart = performance.now();
  }

  setMouth(level) { this.mouthLevel = Math.max(0, Math.min(1, level)); }

  /** x,y ในช่วง -1..1 (จากตำแหน่งใบหน้าที่กล้องเห็น) */
  lookAt(x, y = 0) { this.lookTarget = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) }; }

  /** คำนวณท่าทาง ณ เวลา now — ผลลัพธ์เป็นตัวเลขล้วน ใช้ได้กับทุก Renderer */
  pose(now) {
    const calm = reduceMotion();
    const t = now / 1000;
    const def = AVATAR_STATES[this.state] || AVATAR_STATES.idle;
    let armL = [6, 4], armR = [6, 4], headRot = 0, headDy = 0, bodyRot = 0, bodyDx = 0;
    let bodyDy = calm ? 0 : Math.sin(t * 1.8) * 2.4;
    let eyeDx = 0, eyeDy = 0, spin = 1;

    if (this.state === "listening") headRot = 5;
    if (this.state === "thinking") { eyeDy = -4; eyeDx = 3; }
    if ((this.state === "speaking" || this.state === "announcing") && !this.gestureName && !calm) {
      // พูดอธิบาย: มือขยับเบา ๆ ไม่แข็งทื่อ
      armR = [14 + 6 * Math.sin(t * 2.4), 18 + 10 * Math.sin(t * 3.1)];
      headRot = 2 * Math.sin(t * 1.3);
    }

    if (this.gestureName) {
      const dur = GESTURE_DURATION[this.gestureName];
      const p = (now - this.gestureStart) / dur;
      if (p >= 1) this.gestureName = null;
      else {
        const s = bell(p), e = ease(Math.min(1, p * 3));
        const w = calm ? 0 : 1;   // ลดการเคลื่อนไหวซ้ำ ๆ เมื่อผู้ใช้ตั้งค่าลดการเคลื่อนไหว
        switch (this.gestureName) {
          case "wave": armR = [150 * s, 20 + 28 * Math.sin(t * 11) * s * w]; headRot = -6 * s; break;
          case "bow": headDy = 10 * s; armL = [20 * s + 6, 30 * s]; armR = [20 * s + 6, 30 * s]; bodyDy += 6 * s; break;
          case "nod": headDy = 6 * Math.sin(t * 14) * s * w; break;
          case "shake": headRot = 9 * Math.sin(t * 14) * s * w; break;
          case "present": armL = [50 * s + 6, 40 * s]; armR = [62 * s + 6, 30 * s]; break;
          case "point_screen": armR = [95 * s, -10 * s]; eyeDx = 6 * s; headRot = 6 * s; break;
          case "point_direction": armL = [100 * s, -5 * s]; eyeDx = -6 * s; headRot = -6 * s; break;
          case "explain": armR = [40 * s + 6, 50 * s + 10 * Math.sin(t * 8) * s * w]; armL = [25 * s + 6, 30 * s]; break;
          case "think": armR = [28 * e, 125 * e]; eyeDx = 5 * e; eyeDy = -6 * e; headRot = 8 * e; break;
          case "happy": armL = [130 * s + 15 * Math.sin(t * 12) * s * w, 30 * s]; armR = [130 * s + 15 * Math.sin(t * 12 + 1) * s * w, 30 * s];
            bodyDy -= 8 * Math.abs(Math.sin(t * 8)) * s * w; break;
          case "shrug": armL = [45 * s, 70 * s]; armR = [45 * s, 70 * s]; headRot = 10 * s; break;
          case "listen": headRot = 8 * s; break;
          case "dance": armL = [90 + 40 * Math.sin(t * 9) * w, 40]; armR = [90 + 40 * Math.sin(t * 9 + Math.PI) * w, 40];
            bodyRot = 6 * Math.sin(t * 6) * s * w; bodyDx = 14 * Math.sin(t * 6) * s * w; break;
          case "spin": armL = [70 * s, 10]; armR = [70 * s, 10]; spin = calm ? 1 : Math.cos(p * Math.PI * 2); break;
        }
      }
    }

    // มองตามผู้เข้าชมอย่างนุ่มนวล
    this.look.x += (this.lookTarget.x - this.look.x) * 0.08;
    this.look.y += (this.lookTarget.y - this.look.y) * 0.08;
    eyeDx += this.look.x * 6;
    eyeDy += this.look.y * 3;
    headRot += this.look.x * 4;

    // กะพริบตา
    let blink = 1;
    if (now > this.blinkAt) {
      const bp = (now - this.blinkAt) / 150;
      blink = bp < 1 ? Math.abs(1 - 2 * bp) * 0.9 + 0.1 : 1;
      if (bp >= 1) this.blinkAt = now + 2200 + Math.random() * 3500;
    }

    // ปาก: ขยับตามระดับเสียงจริง ถ้าไม่มีข้อมูลระดับเสียง (เสียงเบราว์เซอร์) ใช้จังหวะจำลอง
    let mouthOpen = 0;
    // 11 พ.ย. 2569: เมื่อมีสัญญาณเสียงจริง (AVATAR_AUDIO) ปากจะขยับเฉพาะตอนเสียงออกลำโพง — ไม่ขยับระหว่างรอดาวน์โหลดเสียง
    const silentWait = this.audioGate && !this.audioOn;
    if ((def.mouth === "talk" || this.talking) && !silentWait) {
      mouthOpen = this.mouthLevel || (calm ? 0.35 : 0.25 + 0.45 * Math.abs(Math.sin(t * 15)) * Math.abs(Math.sin(t * 4.7)));
    }
    let eyes = def.eyes;
    let mouth = (def.mouth === "talk" || this.talking) && !silentWait ? "talk" : def.mouth === "talk" ? "smile" : def.mouth;
    if (this.emotion === "happy" && eyes === "open") eyes = "happy";
    if (this.emotion === "happy" && mouth !== "talk") mouth = "smile";
    if (this.emotion === "sorry") { eyes = eyes === "happy" ? "open" : eyes === "open" ? "sad" : eyes; if (mouth !== "talk") mouth = "sad"; }

    return {
      state: this.state, color: def.color, ringSpeed: def.ring,
      armL, armR, headRot, headDy, bodyRot, bodyDx, bodyDy, eyeDx, eyeDy, blink, spin,
      eyes, mouth, mouthOpen, thinking: this.state === "thinking", t,
      gesture: this.gestureName,   // ท่าที่กำลังเล่น (ตัววาดที่มีแอนิเมชันของตัวเอง เช่น VoraRigRenderer ใช้เริ่มท่าของตัวละคร)
    };
  }

  // ================================================================ เชื่อมกับระบบอื่นผ่าน Event
  /**
   * dom: { app, stage, box, bubble, caption, stateText }
   * opts: { focusScale (1.4), focusFit (สัดส่วนความสูงจอสูงสุดที่อวตารใช้ได้), lang }
   */
  connect(bus, dom, { focusScale = 1.4, focusFit = 0.97, lang = "th" } = {}) {
    this.bus = bus;
    this.dom = dom;
    this.focusCfg = { scale: focusScale, fit: focusFit };
    this.lang = lang;
    this.mode = "idle";          // โหมดที่ระบบสั่ง: idle | listening | thinking | speaking
    this.speakKind = "conversation";
    this.alert = false;
    this.happyUntil = 0;
    this.focus = false;
    const on = (t, fn) => this.offs.push(bus.on(t, fn));
    this.offs = this.offs || [];
    on(EV.AVATAR_LISTENING, () => { this.mode = "listening"; this.refresh(); });
    on(EV.AVATAR_THINKING, () => { this.mode = "thinking"; this.refresh(); });
    on(EV.AVATAR_SPEAKING, (d) => { this.mode = "speaking"; this.speakKind = d.kind || "conversation"; this.refresh(); });
    on(EV.GREETING_STARTED, () => { this.mode = "speaking"; this.speakKind = "greeting"; this.refresh(); });
    on(EV.GREETING_FINISHED, () => { if (this.speakKind === "greeting") { this.mode = "idle"; this.refresh(); } });
    on(EV.AVATAR_IDLE, () => { this.mode = "idle"; this.refresh(); });
    on(EV.AVATAR_ALERT, (d) => { this.alert = !!d.error; this.refresh(); });
    on(EV.AVATAR_HINT, (d) => this.setHint(d.state, d.ms));
    on(EV.AVATAR_GESTURE, (d) => this.gesture(d.name));
    on(EV.AVATAR_EMOTION, (d) => {
      this.setEmotion(d.emotion);
      if (d.flashMs) { this.happyUntil = Date.now() + d.flashMs; this.refresh(); setTimeout(() => this.refresh(), d.flashMs + 50); }
    });
    on(EV.AVATAR_MOUTH, (level) => this.setMouth(level));
    on(EV.AVATAR_AUDIO, (d) => { this.audioGate = true; this.audioOn = !!(d && d.on); });
    on(EV.AVATAR_CAPTION, (d) => this.setBubble(d.text, d.partial));
    on(EV.FACE_POSITION, (d) => this.lookAt(d.x, d.y));
    on(EV.VISITOR_LEFT, () => this.lookAt(0, 0));
    on(EV.UI_IDLE, () => this.setFocus(true));
    on(EV.UI_ACTIVE, () => this.setFocus(false));
    on(EV.UI_LANG, (d) => { this.lang = d.lang; this.refresh(); });
    // คำนวณขนาด Focus ใหม่เมื่อขนาดจอเปลี่ยน (ResizeObserver ตัวเดียว)
    this.ro = new ResizeObserver(() => this.layoutFocus());
    this.ro.observe(dom.app);
    if (dom.stage) this.ro.observe(dom.stage);   // Phase 1: เวทีเปลี่ยนขนาดเมื่อเข้า/ออกโหมดนำเสนอ (จอไม่เปลี่ยนขนาด)
    this.layoutFocus();
    this.refresh();
  }

  disconnect() {
    (this.offs || []).forEach((off) => off());
    this.offs = [];
    this.ro && this.ro.disconnect();
  }

  /** เลือกสถานะที่แสดงจากโหมดที่ระบบสั่ง + การแจ้งเตือน + อารมณ์ชั่วคราว */
  refresh() {
    // ลำดับความสำคัญ: หยุดฉุกเฉิน/ขัดข้อง (ขณะว่าง) > ฟัง/คิด > ทักทาย/ประกาศ > สถานะนำเสนอ (hint) > พูด/ดีใจ/ว่าง
    // สถานะนำเสนอ (presenting, pointing, thanking, waving) ไม่ทับการฟัง/คิด และไม่ทับการแจ้งเตือน
    const hint = this.activeHint();
    let s = this.mode;
    if (s === "speaking") {
      s = this.speakKind === "greeting" ? "greeting" : this.speakKind === "announcing" ? "announcing" : hint || "speaking";
    } else if (s === "idle") {
      s = this.happyUntil > Date.now() ? "happy" : this.alert ? "error" : hint || "idle";   // ลำดับ happy > error คงตามเดิม
    }
    this.talking = this.mode === "speaking";
    this.setState(s);
    if (!this.dom) return;
    this.dom.app.dataset.avatar = s;
    if (this.dom.stateText) this.dom.stateText.textContent = (AVATAR_STATES[s] || AVATAR_STATES.idle)[this.lang] || "";
  }

  /** กล่องคำพูด (Speech Bubble) */
  setBubble(text, partial = false) {
    if (!this.dom) return;
    this.dom.caption.textContent = text || "";
    this.dom.bubble.hidden = !text;
    this.dom.bubble.classList.toggle("partial", !!partial);
  }

  get bubbleText() { return this.dom ? this.dom.caption.textContent : ""; }

  // ---------------------------------------------------------------- Avatar Focus Mode
  // โหมดว่าง: ขยายทั้งเวที (อวตาร วงแหวน พื้น) ด้วย transform เท่านั้น ไม่เปลี่ยน layout และไม่แตะ SVG/viewBox
  // ขนาด = min(focusScale, พื้นที่จอจริง) เพื่อไม่ให้ศีรษะหรือเท้าหลุดขอบจอ และย้ายจุดกึ่งกลางอวตารไปกลางจอ
  setFocus(on) {
    this.focus = !!on;
    this.applyFocus();
  }

  /** วัดตำแหน่งจาก layout (offsetLeft/Top ไม่ถูกผลของ transform) แล้วเก็บค่าไว้ใช้ตอนเปลี่ยนโหมด */
  layoutFocus() {
    const d = this.dom;
    if (!d) return;
    const svg = d.box.querySelector("svg");
    const vw = d.app.clientWidth, vh = d.app.clientHeight;
    const boxH = d.box.clientHeight;
    const svgH = svg ? svg.clientHeight || boxH : boxH;
    const svgW = svg ? svg.clientWidth || boxH * 0.49 : boxH * 0.49;
    // จุดกึ่งกลางอวตารในพิกัดของเวที (อวตารชิดล่าง กึ่งกลางแนวนอนใน .avatar)
    const ox = d.box.offsetLeft + d.box.clientWidth / 2;
    const oy = d.box.offsetTop + boxH - svgH / 2;
    const cx = d.stage.offsetLeft + ox, cy = d.stage.offsetTop + oy;
    const s = Math.max(1, Math.min(this.focusCfg.scale, (vh * this.focusCfg.fit) / svgH, (vw * 0.9) / svgW));
    this.focusGeom = { ox, oy, dx: vw / 2 - cx, dy: vh / 2 - cy, s, svgH, svgW, vw, vh };
    d.stage.style.transformOrigin = `${ox.toFixed(1)}px ${oy.toFixed(1)}px`;
    this.applyFocus();
  }

  applyFocus() {
    const d = this.dom, g = this.focusGeom;
    if (!d || !g) return;
    d.stage.style.transform = this.focus ? `translate(${g.dx.toFixed(1)}px, ${g.dy.toFixed(1)}px) scale(${g.s.toFixed(3)})` : "";
    d.app.style.setProperty("--focus-scale", this.focus ? g.s.toFixed(3) : "1");
  }

  loop(now) {
    if (this.disposed) return;            // dispose(): หยุดวงรอบวาดถาวร
    // จำกัด ~40 fps เพื่อเหลือแรงประมวลผลให้กล้องและ AI · ซ่อนอยู่ (setVisibility(false)) = ไม่วาด
    if (this.visible && now - this.lastFrame >= 24) {
      this.lastFrame = now;
      try { this.renderer.render(this.pose(now)); } catch (e) { console.warn("avatar render:", e); }
    }
    requestAnimationFrame(this.loop);
  }

  // ================================================================ Avatar Adapter Interface (VORA NEXT Phase 2)
  // ระบบหลัก (app.js, Experience, Scene) เรียกอวตารผ่านชุดคำสั่งนี้เท่านั้น — ไม่รู้จักไฟล์ภาพ ชื่อเลเยอร์ หรือ PSD
  // รายละเอียด: docs/AVATAR_INTEGRATION.md · ตรวจครบด้วย assertAvatarAdapter() ใน AvatarAdapter.js

  /** โหลด/เปลี่ยนตัวละคร: { renderer: "placeholder" | "layered" | "rig", manifest } → { kind, ok, fallback, error? }
   *  โหลดไม่สำเร็จ = ใช้ตัวที่แสดงอยู่ต่อ (หน้าจอไม่ว่าง) และรายงาน fallback: true */
  async loadCharacter(cfg = {}) {
    const kind = cfg.renderer || "placeholder";
    if (kind === "placeholder") {
      if (this.kind !== "placeholder" && this.container) {
        const { PlaceholderRenderer } = await import("./AvatarRenderer.js");
        this.container.replaceChildren();
        this.setRenderer(new PlaceholderRenderer(this.container));
      }
      this.kind = "placeholder";
      return { kind: "placeholder", ok: true, fallback: false };
    }
    if (kind === "layered" && cfg.manifest) {
      try {
        const { LayeredImageRenderer } = await import("./LayeredImageRenderer.js");
        const r = await LayeredImageRenderer.load(document.createElement("div"), cfg.manifest);
        r.container = this.container;
        this.setRenderer(r);
        if (this.container) this.container.replaceChildren(r.svg);
        this.kind = "layered";
        if (this.dom) this.layoutFocus();
        return { kind: "layered", ok: true, fallback: false };
      } catch (e) {
        console.warn("ใช้อวตารเดิมต่อ เพราะโหลดอวตารใหม่ไม่ได้:", e.message);
        return { kind: this.kind || "placeholder", ok: false, fallback: true, error: e.message };
      }
    }
    if (kind === "rig") {
      // อวตาร VORA ตัวจริง (VoraLiveRig) — โหลดไม่ได้ = ใช้ตัวที่แสดงอยู่ต่อ เหมือน layered
      try {
        const { VoraRigRenderer } = await import("./VoraRigRenderer.js");
        const r = await VoraRigRenderer.load(this.container);
        this.setRenderer(r);
        if (this.container) this.container.replaceChildren(r.svg);
        this.kind = "rig";
        if (r.attachWardrobe) r.attachWardrobe();   // 19 พ.ย. 2569: ปุ่ม 👗 แต่งตัว VORA (ต้องสร้างหลังอวตารอยู่บนเวทีแล้ว)
        if (this.dom) this.layoutFocus();
        return { kind: "rig", ok: true, fallback: false };
      } catch (e) {
        console.warn("ใช้อวตารเดิมต่อ เพราะโหลดอวตาร VORA ไม่ได้:", e.message);
        return { kind: this.kind || "placeholder", ok: false, fallback: true, error: e.message };
      }
    }
    return { kind: this.kind || "placeholder", ok: false, fallback: true, error: `ไม่รู้จักตัววาด "${kind}"` };
  }

  /** setState(state) มีอยู่แล้วด้านบน (ใช้ได้ทั้งระบบเดิมและ Adapter) */

  /** สีหน้า: neutral | happy | sorry → { expression, supported } */
  setExpression(name) {
    const supported = EXPRESSIONS.includes(name);
    this.setEmotion(supported ? name : "neutral");
    return { expression: supported ? name : "neutral", supported };
  }

  /** เล่นท่าทาง → { name, supported, durationMs } — ท่าที่ Renderer ไม่รองรับจะ "ไม่แสดงว่าเล่นสำเร็จ" (supported: false) */
  playAnimation(name) {
    const known = name in GESTURE_DURATION;
    const rendererOk = !this.renderer.supportsAnimation || this.renderer.supportsAnimation(name);
    if (!known || !rendererOk) return { name, supported: false, durationMs: 0 };
    this.gesture(name);
    return { name, supported: true, durationMs: GESTURE_DURATION[name] };
  }

  /** ทิศที่มอง x, y ในช่วง -1..1 (ซ้าย/ขวา, บน/ล่าง จากมุมมองผู้ชม) */
  setGaze(x, y = 0) { this.lookAt(x, y); return { x: this.lookTarget.x, y: this.lookTarget.y }; }

  /** ข้อมูลการพูด: { text?, partial?, level? (0..1 ระดับเสียงสำหรับขยับปาก/Lip Sync) } */
  setSpeech({ text, partial = false, level } = {}) {
    if (typeof text === "string" && this.dom) this.setBubble(text, partial);
    if (typeof level === "number") this.setMouth(level);
  }

  /** ซ่อน/แสดงอวตาร (ซ่อนแล้วหยุดวาด ประหยัดเครื่อง — สถานะยังทำงานตามปกติ) */
  setVisibility(visible) {
    this.visible = !!visible;
    const box = (this.dom && this.dom.box) || this.container;
    if (box) box.style.visibility = this.visible ? "" : "hidden";
    return this.visible;
  }

  /** เลิกใช้อวตาร: ยกเลิก Event, ResizeObserver, วงรอบวาด และตัววาด */
  dispose() {
    this.disposed = true;
    clearTimeout(this.emoTimer);
    clearTimeout(this.hintTimer);
    this.disconnect();
    this.renderer && this.renderer.destroy && this.renderer.destroy();
  }

  /** ความสามารถจริงของตัวละครที่โหลดอยู่ — ระบบใช้ตัดสินว่าจะใช้ท่าใด (ไม่เดาว่ามี) */
  capabilities() {
    const anims = Object.keys(GESTURE_DURATION).filter((n) => !this.renderer.supportsAnimation || this.renderer.supportsAnimation(n));
    return {
      kind: this.kind || "placeholder",
      states: STANDARD_STATES.filter((s) => AVATAR_STATES[s]),
      extraStates: Object.keys(AVATAR_STATES).filter((s) => !STANDARD_STATES.includes(s)),
      animations: anims,
      expressions: [...EXPRESSIONS],
      lipSync: "level",     // รับระดับเสียง 0..1 ผ่าน setSpeech({ level }) / Event AVATAR_MOUTH (เสียงเบราว์เซอร์ไม่มีระดับจริง จึงจำลองจังหวะปาก)
    };
  }

  // ---------------------------------------------------------------- สถานะเสริมของการนำเสนอ
  // 2 ชั้น: scene = ค้างตลอดการนำเสนอ (เช่น presenting) · hint = ชั่วคราวทับ scene (เช่น pointing 2.5 วิ แล้วกลับเป็น presenting)
  // ทั้งสองไม่ทับการฟัง/คิด/ทักทาย/ประกาศ/ขัดข้อง
  /** ms > 0 = ชั่วคราว · ไม่ระบุ = ค้างจนกว่าจะเรียก setHint(null) · setHint(null) ล้างทั้งสองชั้น */
  setHint(state, ms = 0) {
    if (!state || !AVATAR_STATES[state]) {
      clearTimeout(this.hintTimer);
      this.hint = null; this.scene = null;
      this.refresh();
      return;
    }
    if (ms > 0) {
      clearTimeout(this.hintTimer);
      this.hint = { state, until: Date.now() + ms };
      this.hintTimer = setTimeout(() => { this.hint = null; this.refresh(); }, ms + 20);
    } else {
      this.scene = state;
    }
    this.refresh();
  }

  activeHint() {
    const h = this.hint;
    if (h && h.until < Date.now()) this.hint = null;
    return (this.hint && this.hint.state) || this.scene || null;
  }
}
