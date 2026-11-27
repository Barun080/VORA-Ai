// ตัววาดอวตาร VORA ตัวจริง (ผมบลอนด์ จาก Vora.psd / VoraE1.psd) — ใช้ VoraLiveRig เดิมของทีม (assets/avatar/vora-rig/vora-rig.js)
// เป็น Renderer ตัวที่ 3 ตาม Avatar Adapter Interface (docs/AVATAR_INTEGRATION.md) — ระบบหลักไม่ต้องรู้จักไฟล์นี้
//
// สิ่งที่ไฟล์นี้ทำ: แปลง "pose" จาก AvatarController (สถานะ/ปาก/ทิศที่มอง/ท่าทาง) เป็นคำสั่งของ VoraLiveRig เท่านั้น
// สิ่งที่ไม่ทำ:  ไม่เปิดกล้อง (ไม่ใช้ VoraCameraFaceTracker ของไฟล์ทดลอง) — ทิศที่มองมาจาก FACE_POSITION ของกล้องเดิมผ่าน AvatarController
//               ไม่เล่นเสียง ไม่พูดข้อความของตัวเอง (บทพูดตอนลูบหัวของไฟล์ทดลองไม่ถูกใช้) — เสียงพูดยังมาจาก voice.js เดิม
// ไม่ได้แก้ vora-rig.js — คัดลอกมาจาก Vora_Character_Rig_Bundle ทั้งไฟล์ (19 พ.ย. 2569: รุ่นที่มีระบบเปลี่ยนชุด/ทรงผม/เครื่องประดับ/ท่าแขน)
// 19 พ.ย. 2569: เพิ่มระบบแต่งตัว (WardrobeMenu.js) + เสียงตอบเมื่อแตะตัว/ลูบหัว (เล่นเฉพาะตอนว่าง) — ค่าทั้งหมดอยู่ที่ kiosk-config.js → avatar.wardrobe / avatar.idlePose

import { NS } from "./AvatarRenderer.js";
import { KIOSK_CONFIG } from "../kiosk-config.js";
import { WardrobeMenu, loadLook, saveLook } from "./WardrobeMenu.js";
import { VoraBehavior } from "./VoraBehavior.js";   // 19 พ.ย. 2569: ท่าทางตามสถานะ + ปากขยับตามเสียงจริง

const BASE = "/assets/avatar/vora-rig/";
// ?v= กันเบราว์เซอร์ของตู้ใช้ vora-rig.js รุ่นเก่าที่ค้างในแคช (รุ่นเก่าไม่มีระบบแต่งตัว) — เปลี่ยนเลขทุกครั้งที่อัปเดต vora-rig.js
const RIG_VERSION = "20261119-slots";
const SCRIPT = `${BASE}vora-rig.js?v=${RIG_VERSION}`;

// ท่าที่ตัวละครนี้ทำได้จริง (ใช้ตอบ playAnimation/capabilities ตามจริง — ท่าที่ไม่มีภาพ/โครงรองรับ เช่น โบกมือ หมุนตัว จะรายงานว่าไม่รองรับ)
const ANIMATIONS = ["idle", "think", "explain", "present", "point_screen", "happy", "listen", "nod"];

let scriptPromise = null;
function loadScript() {
  if (window.VoraLiveRig) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.onload = () => (window.VoraLiveRig ? ok() : bad(new Error("vora-rig.js โหลดแล้วแต่ไม่พบ VoraLiveRig")));
      s.onerror = () => { scriptPromise = null; bad(new Error(`โหลด ${SCRIPT} ไม่ได้`)); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/** vora-rig.js อ้างไฟล์ภาพแบบ "assets/vora/x.png" (อิงหน้าเว็บ) — ชี้ไปที่โฟลเดอร์ของอวตารแทน ไม่ต้องแก้ไฟล์ต้นฉบับ */
function rebaseManifest() {
  // eslint-disable-next-line no-undef
  const m = typeof VORA_RIG_MANIFEST !== "undefined" ? VORA_RIG_MANIFEST : null;
  if (!m || m.__rebased) return;
  for (const part of Object.values(m.parts || {})) {
    if (typeof part.file === "string" && part.file.startsWith("assets/")) part.file = BASE + part.file.slice("assets/".length);
  }
  m.__rebased = true;
}

const clamp = (v) => Math.max(-1, Math.min(1, v || 0));

const AV = (KIOSK_CONFIG && KIOSK_CONFIG.avatar) || {};
const WARDROBE = { enabled: true, defaultOutfit: "Vora_Student_uni", defaultBackHair: "classic", defaultAccessories: [], remember: true, touchSounds: true, ...(AV.wardrobe || {}) };

/** ความถี่ท่ากอดอก/แตะคางแบบสุ่ม — ตั้งก่อนสร้าง VoraLiveRig (rig อ่านค่าตอนเริ่มต้น) */
function applyIdlePoseTiming() {
  const t = window.VORA_SLOT_CONFIG && window.VORA_SLOT_CONFIG.arms && window.VORA_SLOT_CONFIG.arms.timing;
  const c = AV.idlePose;
  if (!t || !c) return;
  if (c.everyMinMs) t.idleRandomMinIntervalMs = c.everyMinMs;
  if (c.everyMaxMs) t.idleRandomMaxIntervalMs = c.everyMaxMs;
  if (c.holdMinMs) t.idleThinkHoldMinMs = c.holdMinMs;
  if (c.holdMaxMs) t.idleThinkHoldMaxMs = c.holdMaxMs;
}

/**
 * ความมีชีวิตชีวา (19 พ.ย. 2569): คูณขนาดการขยับ "ตอนวาด" เท่านั้น แล้วคืนค่าเดิมหลังวาด
 * ฟิสิกส์/การหน่วงของ rig ยังคำนวณจากค่าจริง จึงไม่สะสมเพี้ยนข้ามเฟรม · ไม่ต้องแก้ vora-rig.js
 * ค่า = เพดานหลังคูณ (null = ไม่จำกัด) — หัวเอียงไม่เกิน ±7°
 */
const MOTION_FIELDS = {
  chestLiftY: null, shoulderRollDeg: null, bodySwayX: null, bodyTiltDeg: 1.2,
  headLiftY: null, headSwayX: null, headTiltDeg: 7,
  hairFrontAngle: 0.07, hairTailAngle: 0.09, hairBackAngle: null,
  skirtAngle: null, sleeveAngle: null, backSleeveAngle: null, collarAngle: null,
};
const RIG_DEFAULTS = { blinkMinIntervalMs: 3000, blinkMaxIntervalMs: 6000 };
/** ค่าชดเชยจาก VoraBehavior ที่บวกตรง (ไม่คูณระดับซ้ำ) — เพดานกันลูกตาหลุดขอบตา/คิ้วลอย */
const EXTRA_CAPS = { browLiftY: 5, gazeX: 6.0, gazeY: 2.4 };
const clampV = (v, c) => Math.max(-c, Math.min(c, v));

/** เสียงตอบเมื่อแตะตัว/ลูบหัว (ไฟล์จาก bundle) — เลือกตามข้อความที่ rig สุ่มได้ */
const TOUCH_SOUNDS = {
  click: (d) => `${BASE}voices/${/ช่วย/.test(d || "") ? "vora_click_1" : "vora_click_2"}.mp3`,
  headpat: (d) => `${BASE}voices/${/สนุก/.test(d || "") ? "vora_headpat_1" : "vora_headpat_2"}.mp3`,
};

/** Safari / iPad / iPhone (ทุกเบราว์เซอร์บน iOS ใช้ WebKit) — ไม่รวม Chrome/Edge บนคอม */
export function useOverlay(ua = (typeof navigator !== "undefined" && navigator.userAgent) || "", search = (typeof location !== "undefined" && location.search) || "") {
  const f = new URLSearchParams(search).get("rigoverlay");
  if (f === "1" || f === "0") return f === "1";
  return /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);
}

export class VoraRigRenderer {
  /** โหลดสคริปต์ + ภาพทุกชิ้นให้เสร็จก่อนแสดง · ไม่สำเร็จ = โยน Error ให้ผู้เรียกใช้อวตารเดิมต่อ */
  static async load(container, { timeoutMs = 15000 } = {}) {
    await loadScript();
    rebaseManifest();
    applyIdlePoseTiming();
    const r = new VoraRigRenderer(container);
    await r.ready(timeoutMs);
    return r;
  }

  constructor(container) {
    this.container = container;
    this.animations = ANIMATIONS;
    // ห่อ canvas ด้วย <svg> (viewBox ตามผืนภาพ 710×1650) — ขนาด/ตำแหน่งบนเวที, Avatar Focus Mode และเมนูรอบตัว วัดจาก svg เหมือนตัววาดอื่น
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 710 1650");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "อวตาร VORA");
    svg.setAttribute("class", "avatar-svg avatar-rig");
    const fo = document.createElementNS(NS, "foreignObject");
    fo.setAttribute("x", "0"); fo.setAttribute("y", "0"); fo.setAttribute("width", "710"); fo.setAttribute("height", "1650");
    const canvas = document.createElement("canvas");
    canvas.className = "rig-canvas";
    canvas.style.cssText = "display:block;width:100%;height:100%;";
    // 27 พ.ย. 2569: Safari/iPad (WebKit) วาด <canvas> ใน <foreignObject> โดยไม่ย่อตาม viewBox → ตัวละครใหญ่เต็มจอเห็นแต่หน้า
    // → บน WebKit วาง canvas ทับตำแหน่ง svg แทน (svg ยังใช้วัดขนาด/เมนูรอบตัวเหมือนเดิม) · ทดสอบบนเครื่องอื่น: ?rigoverlay=1 / ปิด: ?rigoverlay=0
    this.overlay = useOverlay();
    if (this.overlay) canvas.style.cssText = "display:block;position:absolute;left:0;top:0;width:0;height:0;";
    else fo.appendChild(canvas);
    svg.appendChild(fo);
    this.svg = svg;
    this.canvas = canvas;
    this.cur = { pose: "", speaking: false, gesture: null, look: false };
    this._ready = new Promise((ok) => (this._resolve = ok));
    // ผู้ใช้ตั้งค่า "ลดการเคลื่อนไหว" ในระบบ → ลดการขยับแขน/ขาของตัวละครลงครึ่งหนึ่ง (หายใจ/กะพริบตายังมี เพื่อให้รู้ว่าระบบทำงาน)
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.calm = calm;
    this.motion = 1;
    const look = loadLook(WARDROBE);
    this.wardrobeCfg = WARDROBE;
    this.rig = new window.VoraLiveRig(canvas, {
      enableCursorGaze: false,      // ตู้ Kiosk: ทิศที่มองมาจากกล้องเดิมเท่านั้น ไม่ตามเมาส์
      armMotionScale: calm ? 0.5 : 1.0,
      legMotionScale: calm ? 0.5 : 1.25,
      initialOutfit: look.outfit,
      initialBackHair: look.backHair,
      initialAccessories: look.accessories,
      onReady: () => this._resolve(true),
      // เสียงตอบ: แตะตัว (สะดุ้ง/เขิน) และลูบหัวนานเกิน 3 วิ — rig ไม่เล่นเสียงเอง เราเล่นเฉพาะตอนว่าง
      onInteraction: (e) => this._touchSound("click", e && e.dialogue),
      onHeadPatLong: (e) => this._touchSound("headpat", e && e.dialogue),
    });
    // ลูบหัวนานในท่ายืนปกติ: bundle ปิด "บทพูด" ไว้ — เปิดเฉพาะเพื่อให้ได้สัญญาณเล่นเสียง (Kiosk ไม่แสดงกล่องข้อความของ rig)
    if (WARDROBE.touchSounds && window.HEAD_PAT_CONFIG) {
      for (const p of Object.values(window.HEAD_PAT_CONFIG.poses || {})) if (p.dialogue) p.dialogue.enabled = true;
    }
    // ความมีชีวิตชีวา: ห่อ render() ของ rig (loop ของ rig เรียก this.render() ทุกเฟรม)
    // + ท่าทางตามสถานะ / ปากตามเสียงจริง (VoraBehavior) — ทุกค่าที่เปลี่ยนจะคืนค่าเดิมหลังวาด (rig คำนวณเฟรมถัดไปจากค่าจริง)
    this.beh = new VoraBehavior(canvas);
    const drawRig = this.rig.render.bind(this.rig);
    this.rig.render = () => {
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - (this._lastT || now)) / 1000));
      this._lastT = now;
      const k = this.motion;
      const st = this.rig.state, saved = {};
      const set = (f, v) => { if (!(f in saved)) saved[f] = st[f]; st[f] = v; };
      let off = null;
      try { off = this.beh.frame(now, dt, k); } catch (e) { console.warn("vora behavior:", e); }
      for (const [f, cap] of Object.entries(MOTION_FIELDS)) {
        const v = st[f];
        if (typeof v !== "number") continue;
        const nv = v * k + ((off && off[f]) || 0);
        if (nv !== v) set(f, cap == null ? nv : clampV(nv, cap));
      }
      if (off) {
        for (const [f, cap] of Object.entries(EXTRA_CAPS)) {
          if (!off[f] || typeof st[f] !== "number") continue;
          set(f, clampV(st[f] + off[f], cap));
        }
        // ปากตามเสียงจริง: แทนจังหวะเวลาของ rig ด้วยระดับเสียงจาก voice.js (ลูบหัวอยู่ = ปาก mouth_3 ของ rig มาก่อน)
        const b = this.beh;
        if (b.talking || b.lip > 0.01) {
          const open = b.lip, m3 = st.patMouth3Opacity || 0;
          const m2 = Math.max(0, 1 - m3) * Math.max(0, Math.min(1, (open - 0.04) * 3.4));
          set("speakMouth2Opacity", m2);
          set("smileMouthOpacity", Math.max(0, 1 - m3 - m2));
          set("speakMouth2ScaleY", 0.36 + 0.68 * open);
          set("speakMouth2ScaleX", 0.94 + 0.08 * open);
          set("mouthOpen", Math.round(open * 100));
        }
      }
      if (this.overlay) this._syncOverlay();
      try { return drawRig(); } finally { Object.assign(st, saved); }
    };
    this.setMotionLevel(150);   // ค่าเริ่มต้นจนกว่าจะได้ค่าจากหลังบ้าน (avatar_motion)
    // แตะตัว (นอกศีรษะ) = ท่าสะดุ้ง/เขิน · แตะ/ลูบศีรษะ rig จัดการเอง (ไม่นับเป็นการแตะตัว)
    canvas.addEventListener("click", () => {
      if (this.rig.consumeHeadPatClickSuppression && this.rig.consumeHeadPatClickSuppression()) return;
      try { this.rig.triggerInteraction(); } catch (e) { console.warn("vora-rig interaction:", e); }
    });
    // vora-rig.js เปิดแผง Debug ของตัวเองเมื่อ URL มี ?debug=1 — แต่ ?debug=1 ของ Kiosk ใช้กับชุดทดสอบ/เจ้าหน้าที่
    // จึงปิดแผงนั้น (และกรอบ Hitbox บนศีรษะ) เว้นแต่ขอเฉพาะด้วย ?rigdebug=1
    if (this.rig._debugPanelEl && !new URLSearchParams(location.search).has("rigdebug")) {
      this.rig._debugPanelEl.remove();
      this.rig._debugPanelEl = null;
      this.rig.state.showDebugHitbox = false;
    }
    this.wardrobe = null;
  }

  /** ความมีชีวิตชีวา 0–200 % (100 = ค่าเดิมของตัวละคร) · ผู้ใช้ตั้ง "ลดการเคลื่อนไหว" ในระบบ = ลดลงครึ่งหนึ่ง */
  setMotionLevel(pct) {
    let p = Number(pct);
    if (!Number.isFinite(p)) p = 150;
    p = Math.max(0, Math.min(200, p));
    const k = (p / 100) * (this.calm ? 0.5 : 1);
    this.motionLevel = p;
    this.motion = k;
    const o = this.rig.options;
    o.armMotionScale = Math.min(2.5, k);
    // มีชีวิตชีวามากขึ้น = กระพริบตาถี่ขึ้นเล็กน้อย (200 % ≈ ทุก 2.4–4.8 วิ) · ต่ำกว่า 100 % ใช้ค่าเดิม
    const f = k > 1 ? 1 / (1 + 0.25 * (k - 1)) : 1;
    o.blinkMinIntervalMs = RIG_DEFAULTS.blinkMinIntervalMs * f;
    o.blinkMaxIntervalMs = RIG_DEFAULTS.blinkMaxIntervalMs * f;
  }

  // ---------------------------------------------------------------- ระบบแต่งตัว (ชุด/ทรงผม/เครื่องประดับ)
  hasWardrobe() {
    const r = this.rig;
    return ["getOutfit", "getBackHair", "getAccessories", "setOutfit", "setBackHair", "setAccessory"].every((f) => typeof r[f] === "function");
  }

  getLook() {
    const r = this.rig;
    return {
      outfit: r.getOutfit(),
      backHair: r.getBackHair(),
      accessories: Object.entries(r.getAccessories() || {}).filter(([, on]) => on).map(([id]) => id),
    };
  }
  setOutfit(id) { this.rig.setOutfit(id); this._lookChanged(); }
  setBackHair(id) { this.rig.setBackHair(id); this._lookChanged(); }
  setAccessory(id, on) { this.rig.setAccessory(id, on); this._lookChanged(); }
  _lookChanged() { if (this.wardrobeCfg.remember) saveLook(this.getLook()); }

  /** สร้างปุ่ม 👗 หลังอวตารขึ้นจอแล้ว (AvatarController เรียกผ่าน attach หลัง replaceChildren) */
  attachWardrobe() {
    if (this.wardrobe || !this.wardrobeCfg.enabled) return;
    // vora-rig.js รุ่นเก่า (ไม่มีระบบเปลี่ยนชุด) = ไม่แสดงปุ่ม แทนที่จะให้กดแล้วพัง
    if (!this.hasWardrobe()) { console.warn("vora-rig.js รุ่นนี้ไม่มีระบบแต่งตัว — ไม่แสดงปุ่ม 👗 (ล้างแคช/กด Ctrl+F5)"); return; }
    const stage = this.container && this.container.parentElement;
    if (!stage) return;
    this.wardrobe = new WardrobeMenu(this, stage);
  }

  _touchSound(kind, dialogue) {
    if (!this.wardrobeCfg.touchSounds) return;
    // เล่นเฉพาะตอนว่าง — ฟัง/คิด/พูด/ทักทายอยู่ = ทำท่าเขินอย่างเดียว ไม่มีเสียง (ไม่ชนกับเสียงพูดหลักจาก voice.js)
    if (this.svg.dataset.state !== "idle") return;
    if (this._sfx && !this._sfx.paused && !this._sfx.ended) return;
    try {
      const a = new Audio(TOUCH_SOUNDS[kind](dialogue));
      a.volume = 0.9;
      this._sfx = a;
      a.play().catch(() => { /* เบราว์เซอร์ยังไม่อนุญาตเล่นเสียง — ข้าม */ });
    } catch { /* ignore */ }
  }

  ready(timeoutMs) {
    return Promise.race([
      this._ready,
      new Promise((_, bad) => setTimeout(() => bad(new Error("โหลดภาพอวตาร VORA ไม่ครบภายในเวลา")), timeoutMs)),
    ]);
  }

  // ---------------------------------------------------------------- สัญญาเดียวกับ RigRenderer (AvatarController เรียก)
  setState(state, def) {
    this.svg.dataset.state = state;
    if (def && def.color) this.svg.style.setProperty("--state-color", def.color);
    // กำลังคิด = ค้างท่ากอดอก/มือแตะคางจนคิดเสร็จ (setThinkingState ล็อกไม่ให้สุ่มกลับ)
    // คิดสั้นกว่า 0.35 วิ (คำตอบเร็ว) ไม่เปลี่ยนท่า — กันตัวละครสลับท่าไปมาจนดูกระตุก
    // ว่าง = สุ่มท่ากอดอกตามเวลาใน kiosk-config (avatar.idlePose) · ฟัง/พูด/อื่น ๆ = ยืนปกติ ไม่สุ่ม
    const rig = this.rig;
    const thinking = state === "thinking";
    clearTimeout(this.poseTimer);
    try {
      if (rig.poseCtrl) {
        const wasRandom = rig.poseCtrl.autoRandomPose;
        rig.poseCtrl.autoRandomPose = state === "idle";
        // กลับมาว่าง: เริ่มนับรอบสุ่มใหม่ ไม่ให้เปลี่ยนท่าทันทีหลังพูดจบ
        if (state === "idle" && !wasRandom) {
          const t = window.VORA_SLOT_CONFIG.arms.timing;
          rig.poseCtrl.nextRandomPoseAt = performance.now() + t.idleRandomMinIntervalMs + Math.random() * (t.idleRandomMaxIntervalMs - t.idleRandomMinIntervalMs);
        }
      }
      if (thinking) {
        this.poseTimer = setTimeout(() => {
          if (this.cur.pose === "POSE_THINKING") return;
          this.cur.pose = "POSE_THINKING";
          rig.setThinkingState(true);
        }, 350);
      } else {
        if (this.cur.pose === "POSE_THINKING") rig.setThinkingState(false);
        else if (state !== "idle" && (rig.getPose() === "POSE_THINKING" || rig.poseCtrl.targetPose === "POSE_THINKING")) {
          // ยกเลิกท่าที่สุ่มค้างอยู่ (หรือกำลังเปลี่ยนเข้า) เมื่อเริ่มฟัง/พูด — ไม่งั้นค้างท่ามือแตะคางเพราะหยุดสุ่มแล้ว
          rig.poseCtrl.randomThinkingReturnAt = 0;
          rig.setPose("POSE_NORMAL", { forceImmediate: rig.poseCtrl.transitioning });
        }
        this.cur.pose = "POSE_NORMAL";
      }
    } catch (e) { console.warn("vora-rig pose:", e); }
    if (this.wardrobe) this.wardrobe.onState(state);
    try { this.beh.setState(state, rig); } catch (e) { console.warn("vora behavior:", e); }
  }

  supportsAnimation(name) { return ANIMATIONS.includes(name); }

  /** pose จาก AvatarController.pose(now) — ตัวเลขล้วน */
  render(p) {
    const rig = this.rig;
    // ปาก: พูดอยู่ = ใช้แอนิเมชันปากของตัวละคร (mouth_2/mouth_3)
    const speaking = p.mouth === "talk";
    if (speaking !== this.cur.speaking) { this.cur.speaking = speaking; rig.setSpeaking(speaking); }
    this.beh.setSpeech(speaking, p.mouthOpen);   // ระดับเสียงจริง (มีตัววิเคราะห์เสียง) หรือจังหวะประมาณจาก AvatarController
    // ทิศที่มอง: AvatarController รวมตำแหน่งใบหน้าจากกล้องเดิมไว้ใน eyeDx (look.x × 6) และ eyeDy (look.y × 3)
    const nx = clamp(p.eyeDx / 6), ny = clamp(p.eyeDy / 3);
    const look = Math.abs(nx) > 0.04 || Math.abs(ny) > 0.04;
    if (look || this.cur.look) {
      rig.setCameraFaceTarget({ cameraActive: look, detected: look, normX: nx, normY: ny, area: 0.05, count: 1 });
      this.cur.look = look;
    }
    this.beh.setCameraLook(look);   // มีคนอยู่หน้ากล้อง = ไม่มองไปรอบ ๆ ตอนว่าง
    // ท่าทาง: แปลงท่ามาตรฐานเป็นท่าที่ตัวละครทำได้ (ครั้งเดียวต่อการเริ่มท่า)
    const g = p.gesture || null;
    if (g !== this.cur.gesture) {
      this.cur.gesture = g;
      if (g === "explain" || g === "present" || g === "point_screen") rig.triggerArmGesture("adjust");
      else if (g === "think") rig.triggerArmGesture("ponder");
      else if (g === "happy" || g === "nod" || g === "listen") rig.triggerArmGesture("sway");
    }
  }

  /** โหมด WebKit: ให้ canvas อยู่ข้าง svg ในกล่องเดียวกัน ทับพอดีกรอบภาพของ svg (viewBox 710×1650 แบบ meet = กลางกรอบ) */
  _syncOverlay() {
    const svg = this.svg, c = this.canvas, box = svg.parentNode;
    if (!box) { if (c.parentNode) c.remove(); return; }
    if (c.parentNode !== box || c.previousSibling !== svg) svg.after(c);
    const a = svg.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (!a.width || !a.height || !box.offsetWidth) { c.style.display = "none"; return; }
    // กล่องอาจถูกย่อ/ขยายด้วย transform ของเวที (โหมดพักจอ = Avatar Focus) — canvas อยู่ในกล่องเดียวกันจึงถูกขยายตามอยู่แล้ว
    // → แปลงค่าจากจอกลับเป็นพิกัดก่อนขยาย (เดิมขยายซ้ำสองชั้น ตัวละครใหญ่เกินจอตอนพักจอ)
    const k = b.width / box.offsetWidth || 1;
    const aw = a.width / k, ah = a.height / k;
    const sc = Math.min(aw / 710, ah / 1650), w = 710 * sc, h = 1650 * sc;
    const key = `${(a.left - b.left) / k + (aw - w) / 2}|${(a.top - b.top) / k + (ah - h) / 2}|${w}|${h}`;
    if (key !== this._ovKey) {
      this._ovKey = key;
      const [x, y] = key.split("|");
      Object.assign(c.style, { display: "block", left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    }
    const cs = getComputedStyle(svg);
    if (c.style.opacity !== cs.opacity) c.style.opacity = cs.opacity;
    if (c.style.filter !== cs.filter) c.style.filter = cs.filter;
  }

  destroy() {
    clearTimeout(this.poseTimer);
    if (this.canvas && this.overlay) this.canvas.remove();
    if (this.wardrobe) { this.wardrobe.destroy(); this.wardrobe = null; }
    try { this.rig.stop(); } catch { /* ignore */ }
    this.svg.remove();
  }
}
