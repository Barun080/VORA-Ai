// 24 พ.ย. 2569: นำเข้ารายการให้กล้องจำทีละมาก (ข่าว/กิจกรรม หรือ Excel)
// แตกรูป 1 รูปเป็นภาพย่อยหลายแบบ (ครอป เอียง ปรับแสง กลับด้าน) แล้วแปลงเป็นเวกเตอร์ในเบราว์เซอร์ — รูปไม่ออกนอกเครื่อง

export const VARIANTS_PER_IMAGE = 10;

/** สุ่มแบบกำหนดผลได้ (ทดสอบซ้ำได้) */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** แผนการแตกภาพ: แบบแรกเป็นภาพเต็ม ที่เหลือ ครอป 70–95% เลื่อนตำแหน่ง เอียง ±10° ปรับแสง 0.75–1.25 คอนทราสต์ 0.85–1.2 */
export function augmentPlan(n = VARIANTS_PER_IMAGE, seed = 7) {
  const r = rng(seed);
  const out = [{ scale: 1, dx: 0, dy: 0, rot: 0, bright: 1, contrast: 1, flip: false }];
  for (let i = 1; i < n; i++) {
    const scale = 0.7 + r() * 0.25;
    out.push({ scale, dx: (r() - 0.5) * (1 - scale), dy: (r() - 0.5) * (1 - scale), rot: (r() - 0.5) * 20,
      bright: 0.75 + r() * 0.5, contrast: 0.85 + r() * 0.35, flip: false });
  }
  return out;
}

/** ข่าว → รายการนำเข้า (ช่องที่เว้นว่างจะดึงจากข่าวที่ผูกโดยอัตโนมัติ จึงไม่คัดลอกเนื้อหามาเก็บซ้ำ) */
export function newsToItem(n, kind) {
  const k = kind || n.suggest_kind || "poster";
  return { display_name: String(n.title_th || "").slice(0, 120), kind: k, details: {}, images: (n.images || []).slice(0, 8),
    news_id: n.id, ref: `news:${n.id}` };
}

/** รูปที่ใช้สอนกล้องได้ = อยู่ในเครื่องเดียวกัน (/uploads/...) — ลิงก์ภายนอกอ่านพิกเซลไม่ได้ */
export const trainable = (url) => typeof url === "string" && url.startsWith("/uploads/");

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`โหลดรูปไม่ได้: ${url}`));
    img.src = url;
  });
}

/** วาดภาพย่อยตามแผน ลงผืนผ้าใบขนาด size × size */
export function drawVariant(img, p, size = 320) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, size, size);
  ctx.filter = `brightness(${p.bright}) contrast(${p.contrast})`;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const sw = w * p.scale, sh = h * p.scale;
  const sx = Math.max(0, Math.min(w - sw, (w - sw) / 2 + p.dx * w)), sy = Math.max(0, Math.min(h - sh, (h - sh) / 2 + p.dy * h));
  const fit = Math.min(size / sw, size / sh);
  ctx.translate(size / 2, size / 2); ctx.rotate((p.rot * Math.PI) / 180); if (p.flip) ctx.scale(-1, 1);
  ctx.drawImage(img, sx, sy, sw, sh, (-sw * fit) / 2, (-sh * fit) / 2, sw * fit, sh * fit);
  return c;
}

function thumbOf(canvas) {
  const t = document.createElement("canvas"); t.width = 96; t.height = 72;
  t.getContext("2d").drawImage(canvas, 0, 0, 96, 72);
  return t.toDataURL("image/jpeg", 0.6);
}

let TS = 0;   // ตัวฝังภาพทำงานโหมดวิดีโอ ต้องส่งเวลาที่เพิ่มขึ้นเสมอ
/** รูปหลายรูป → { embeddings, thumbnails, failed } */
export async function embedImages(embedder, embedVector, urls, { perImage = VARIANTS_PER_IMAGE, onStep } = {}) {
  const embeddings = [], thumbnails = [], failed = [];
  const plan = augmentPlan(perImage);
  for (const url of urls.filter(trainable)) {
    let img;
    try { img = await loadImage(url); } catch { failed.push(url); continue; }
    for (const p of plan) {
      const cv = drawVariant(img, p);
      TS = Math.max(TS + 1, Math.floor(performance.now()));
      const v = embedVector(embedder, cv, TS);
      if (v) { embeddings.push(v); thumbnails.push(thumbOf(cv)); }
      if (onStep) onStep();
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return { embeddings, thumbnails, failed };
}
