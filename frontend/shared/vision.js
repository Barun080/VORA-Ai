// VORA Vision — ระบบมองเห็นที่ประมวลผลในเครื่อง (ไม่ส่งภาพออกจากเครื่อง ไม่บันทึกภาพผู้ใช้)
// - FaceDetector: ตรวจว่ามีคนมายืนหน้าหุ่นยนต์ (ทักทายเชิงรุก) และให้อวตาร์มองตาม
// - GestureRecognizer: ท่ามือ 7 แบบ (ชูนิ้วโป้ง/คว่ำนิ้ว/แบมือ/ชี้ขึ้น/ชูสองนิ้ว/กำมือ/I love you)
// - ImageEmbedder + ตัวจำแนกที่ฝึกเองในหลังบ้าน: จำป้ายสาขา/การ์ด/ผลิตภัณฑ์ของวิทยาลัย

import { GestureStabilizer } from "./gesture-stabilizer.js";

const LOCAL_MODELS = "/assets/models/";
const REMOTE = {
  face: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
  gesture: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
  embedder: "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite",
};
const FILE = { face: "blaze_face_short_range.tflite", gesture: "gesture_recognizer.task", embedder: "mobilenet_v3_small.tflite" };

async function modelPath(key) {
  // ใช้ไฟล์โมเดลในเครื่องก่อน (ดาวน์โหลดด้วย scripts/download_models.py) เพื่อให้ทำงานออฟไลน์ได้
  try {
    const r = await fetch(LOCAL_MODELS + FILE[key], { method: "HEAD" });
    if (r.ok) return LOCAL_MODELS + FILE[key];
  } catch { /* ignore */ }
  return REMOTE[key];
}

let visionLib = null;
async function lib() {
  if (!visionLib) visionLib = await import("/assets/vendor/mediapipe/vision_bundle.mjs");
  return visionLib;
}

export async function createEmbedder() {
  const { FilesetResolver, ImageEmbedder } = await lib();
  const fileset = await FilesetResolver.forVisionTasks("/assets/vendor/mediapipe/wasm");
  return ImageEmbedder.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: await modelPath("embedder") },
    runningMode: "VIDEO", l2Normalize: true, quantize: false,
  });
}

export function embedVector(embedder, video, ts) {
  const r = embedder.embedForVideo(video, ts);
  const e = r.embeddings && r.embeddings[0];
  return e ? Array.from(e.floatEmbedding) : null;
}

/** ตัวจำแนกป้าย: softmax(W·x + b) + ตรวจความคล้ายกับจุดศูนย์กลางของคลาส (ปฏิเสธสิ่งที่ไม่รู้จัก) */
export function classifySign(model, vec) {
  if (!model || !vec) return null;
  const n = Math.hypot(...vec) || 1;
  const x = vec.map((v) => v / n);
  const logits = model.coef.map((w, i) => w.reduce((s, wi, j) => s + wi * x[j], model.intercept[i]));
  const m = Math.max(...logits);
  const ex = logits.map((l) => Math.exp(l - m));
  const sum = ex.reduce((a, b) => a + b, 0);
  let best = 0;
  for (let i = 1; i < ex.length; i++) if (ex[i] > ex[best]) best = i;
  const label = model.labels[best];
  const prob = ex[best] / sum;
  const c = model.centroids[label];
  const sim = c ? c.reduce((s, ci, j) => s + ci * x[j], 0) : 0;
  const ok = prob >= (model.prob_threshold || 0.6) && sim >= (model.sim_threshold || 0.4);
  return { label, prob, sim, ok };
}

export class VisionSystem {
  /**
   * handlers: onStatus, onLook, onPersonArrive, onPersonLeave, onGesture, onSign,
   *           onFaces(faces, ts)  — (ใหม่) กล่องใบหน้าทุกเฟรมแบบพิกัด 0..1 ให้ตัวติดตามผู้เข้าชมใช้ ไม่มีภาพ/ลักษณะใบหน้า
   *           onTrackEnded()      — (ใหม่) กล้องหลุด/ถูกถอด
   * options (ใหม่ ไม่บังคับ): minFaceWidth (สัดส่วนความกว้างภาพ ใช้แทนระยะ), arriveMs, leaveMs
   */
  constructor(video, handlers = {}, options = {}) {
    this.video = video;
    this.h = handlers;
    this.opt = { minFaceWidth: 0.12, arriveMs: 700, leaveMs: 4000, ...options };
    this.loopGen = 0;
    this.running = false;
    this.signModel = null;
    this.status = "off";
    this.face = { present: false, since: 0, lastSeen: 0, count: 0 };
    this.gestures = new GestureStabilizer(options.gesture || {});   // 11 พ.ย. 2569: ตัวกรองท่ามือแบบโหวต (แทนบัฟเฟอร์ 3 เฟรมติดกัน)
    this.signBuf = [];
    this.signCooldown = {};
    this.paused = false;
  }

  async start() {
    this.setStatus("loading");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false });
    } catch (e) {
      this.setStatus("no-camera");
      throw e;
    }
    this.stream.getVideoTracks().forEach((tr) => tr.addEventListener("ended", () => {
      if (!this.running) return;
      this.running = false;
      this.resetFace();
      this.setStatus("lost");
      this.h.onTrackEnded && this.h.onTrackEnded();
    }, { once: true }));
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    if (this.faceDet || this.gestureRec) {
      // เชื่อมต่อกล้องใหม่: ใช้โมเดลที่โหลดไว้แล้ว ไม่ต้องโหลดซ้ำ
      this.running = true;
      this.setStatus("on");
      this.loop(++this.loopGen);
      return;
    }
    const { FilesetResolver, FaceDetector, GestureRecognizer } = await lib();
    const fileset = await FilesetResolver.forVisionTasks("/assets/vendor/mediapipe/wasm");
    const make = async (Cls, key, extra) => {
      try {
        return await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath: await modelPath(key), delegate: "GPU" }, runningMode: "VIDEO", ...extra });
      } catch {
        return await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath: await modelPath(key), delegate: "CPU" }, runningMode: "VIDEO", ...extra });
      }
    };
    const results = await Promise.allSettled([
      make(FaceDetector, "face", { minDetectionConfidence: 0.6 }),
      make(GestureRecognizer, "gesture", { numHands: 1, minHandDetectionConfidence: 0.6 }),
      createEmbedder(),
    ]);
    [this.faceDet, this.gestureRec, this.embedder] = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    if (!this.faceDet && !this.gestureRec) {
      this.setStatus("model-error");
      throw new Error("โหลดโมเดลภาพไม่สำเร็จ");
    }
    this.running = true;
    this.setStatus("on");
    this.tick = 0;
    this.loop(++this.loopGen);
  }

  setStatus(s) { this.status = s; this.h.onStatus && this.h.onStatus(s); }
  setSignModel(m) { this.signModel = m && m.available ? m : null; }

  /** 24 พ.ย. 2569: ถ่ายภาพนิ่งตอนผู้ใช้ถาม "นี่คืออะไร" → เวกเตอร์ + ผลจำแนก + ภาพย่อ (ประมวลผลในเบราว์เซอร์ ไม่ส่งออกนอกเครื่อง)
   *  คืน null เมื่อกล้องยังไม่พร้อม · ไม่มีโมเดลป้าย = มีภาพย่อแต่ไม่มีผลจำแนก */
  snapshot(maxW = 192) {
    const v = this.video;
    if (!this.running || !v || v.readyState < 2) return null;
    let vec = null, best = null;
    try { if (this.embedder) vec = embedVector(this.embedder, v, performance.now()); } catch { vec = null; }
    if (vec && this.signModel) best = classifySign(this.signModel, vec);
    let thumb = "";
    try {
      const w = Math.min(maxW, v.videoWidth || maxW), h = Math.round(w * ((v.videoHeight || 3) / (v.videoWidth || 4)));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(v, 0, 0, w, h);
      thumb = c.toDataURL("image/jpeg", 0.6);
    } catch { thumb = ""; }
    const info = best && this.signModel && this.signModel.names ? this.signModel.names[best.label] : null;
    const usable = !info || (info.active !== false && info.action !== "none");
    return { vec, thumb, best, ok: !!(best && best.ok && usable) };
  }

  stop() {
    this.running = false;
    this.loopGen++;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try { this.video.srcObject = null; } catch { /* ignore */ }
    if (this.face.present) { this.h.onPersonLeave && this.h.onPersonLeave(); }
    this.resetFace();
    this.setStatus("off");
  }

  resetFace() { this.face = { present: false, since: 0, lastSeen: 0, count: 0 }; }

  loop(gen = this.loopGen) {
    if (!this.running || gen !== this.loopGen) return;   // กันวงรอบซ้อนกันหลายชุดเมื่อเปิดกล้องใหม่
    const v = this.video;
    if (!this.paused && v.readyState >= 2) {
      const ts = performance.now();
      let step = this.tick++ % 3;
      // มีมืออยู่ในภาพ → ตรวจท่ามือถี่ขึ้น (สลับช่องตรวจใบหน้าทุกรอบที่สองมาตรวจท่ามือ) ท่าจึงยืนยันได้เร็วและนิ่งขึ้น
      if (step === 0 && this.gestureRec && this.gestures.handActive(ts) && (this.tick % 2 === 0)) step = 1;
      try {
        if (step === 0 && this.faceDet) this.processFaces(this.faceDet.detectForVideo(v, ts), ts);
        else if (step === 1 && this.gestureRec) this.processGesture(this.gestureRec.recognizeForVideo(v, ts), ts);
        else if (step === 2 && this.embedder && this.signModel) this.processSign(embedVector(this.embedder, v, ts), ts);
      } catch (e) { /* เฟรมเสียเป็นครั้งคราว ข้ามไป */ }
    }
    setTimeout(() => this.loop(gen), 90);
  }

  processFaces(res, ts) {
    const vw = this.video.videoWidth || 640, vh = this.video.videoHeight || 480;
    const dets = (res.detections || []).filter((d) => d.boundingBox && d.boundingBox.width > vw * this.opt.minFaceWidth);
    const now = ts;
    if (this.h.onFaces) {
      this.h.onFaces(dets.map((d) => ({ x: d.boundingBox.originX / vw, y: d.boundingBox.originY / vh,
        w: d.boundingBox.width / vw, h: d.boundingBox.height / vh })), now);
    }
    if (dets.length) {
      const big = dets.reduce((a, b) => (a.boundingBox.width > b.boundingBox.width ? a : b));
      const cx = (big.boundingBox.originX + big.boundingBox.width / 2) / this.video.videoWidth;
      const cy = (big.boundingBox.originY + big.boundingBox.height / 2) / this.video.videoHeight;
      this.h.onLook && this.h.onLook(-(cx - 0.5) * 2, (cy - 0.45) * 2);   // กล้องหน้า: กลับซ้าย-ขวา
      if (!this.face.since) this.face.since = now;
      this.face.lastSeen = now;
      this.face.count = dets.length;
      if (!this.face.present && now - this.face.since > this.opt.arriveMs) {
        this.face.present = true;
        this.h.onPersonArrive && this.h.onPersonArrive(dets.length);
      }
    } else {
      if (this.face.present && now - this.face.lastSeen > this.opt.leaveMs) {
        this.face.present = false;
        this.face.since = 0;
        this.h.onPersonLeave && this.h.onPersonLeave();
        this.h.onLook && this.h.onLook(0, 0);
      }
      if (!this.face.present) this.face.since = 0;
    }
  }

  processGesture(res, ts) {
    const hit = this.gestures.push(res, ts);
    if (hit) this.h.onGesture && this.h.onGesture(hit.name, hit.score);
  }

  processSign(vec, ts) {
    const r = classifySign(this.signModel, vec);
    const info = r && this.signModel.names ? this.signModel.names[r.label] : null;
    const usable = !info || (info.active !== false && info.action !== "none");   // ป้าย "พื้นหลัง" ไม่ต้องตอบ
    const label = r && r.ok && usable ? r.label : null;
    this.signBuf.push(label);
    if (this.signBuf.length > 3) this.signBuf.shift();
    if (label && this.signBuf.every((x) => x === label)) {
      const last = this.signCooldown[label] || 0;
      if (ts - last > 15000) {
        this.signCooldown[label] = ts;
        this.signBuf = [];
        this.h.onSign && this.h.onSign(label, r.prob);
      }
    }
  }
}
