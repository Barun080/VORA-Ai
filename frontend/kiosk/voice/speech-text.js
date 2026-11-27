// VORA — เตรียมข้อความก่อนส่งให้ TTS (Phase 3 · 12 พ.ย. 2569)
// ลบเฉพาะสิ่งที่ไม่ควรออกเสียง: markdown, อีโมจิ, เครื่องหมาย ? ! ~ … ที่ TTS อาจอ่านเป็นคำ ("ปรัศนี", "อัศเจรีย์")
// ห้ามทำลายสาระ: เวลา 08:00-16:30 · วันที่ 12/11/2569 · เบอร์โทร 054-710-259 · URL · อีเมล · ทศนิยม 3.50 · 1,500 · 80% · ±
// วิธี: เก็บส่วนที่ต้องรักษา (URL/อีเมล/ตัวเลขที่มีเครื่องหมาย) ไว้ก่อน → ทำความสะอาดส่วนที่เหลือ → คืนค่าส่วนที่เก็บไว้ทุกตัวตามเดิม
// ไม่มีสถานะ ไม่เรียกเครือข่าย ไม่ขึ้นกับเบราว์เซอร์ (ทดสอบด้วย node ได้)

const PROTECT = [
  /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,!?;:]/gi,                       // URL (ไม่รวมเครื่องหมายท้ายประโยค)
  /\bwww\.[^\s<>"'()]+[^\s<>"'().,!?;:]/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,                                       // อีเมล
  // ตัวเลขที่มีเครื่องหมายคั่น: เวลา, ช่วงเวลา, วันที่, เบอร์โทร, ทศนิยม, หลักพัน, เปอร์เซ็นต์, ช่วงตัวเลข
  /[+±-]?\d+(?:[.,:/\-–~]\d+)+%?/g,
  /[+±-]?\d+%/g,
];

// 16 พ.ย. 2569: ชื่อ "VORA" ในประโยคภาษาไทย → ส่งให้เสียงพูดเป็น "โวร่า" (เสียงไทยอ่านตัวอังกฤษทีละตัว วี-โอ-อาร์-เอ)
// เฉพาะข้อความที่พูด — ข้อความบนหน้าจอยังเป็น "VORA" · ประโยคอังกฤษล้วนไม่แตะ · URL/อีเมลถูกเก็บไว้ก่อนแล้ว (PROTECT)
// ต้องเป็นคำเดี่ยว: ไม่แตะ VORA_TTS_RATE, VORA2 ฯลฯ
const THAI = /[\u0E00-\u0E7F]/;
const VORA_NAME = /(?<![A-Za-z0-9_])VORA(?![A-Za-z0-9_])/gi;
export const VORA_SPOKEN = "โวร่า";

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

function protect(text) {
  const kept = [];
  let out = text;
  for (const rx of PROTECT) {
    out = out.replace(rx, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
  }
  return { out, kept };
}

function restore(text, kept) {
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[+i]);
}

/** ข้อความสำหรับพูด — สาระเดิมครบ ไม่มี markdown/อีโมจิ/เครื่องหมายที่ไม่ควรออกเสียง */
export function normalizeForSpeech(input) {
  if (input == null) return "";
  let s = String(input).replace(/\r\n?/g, "\n");
  s = s.replace(/```[\s\S]*?```/g, " ");                      // บล็อกโค้ด: ไม่อ่านออกเสียง
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");             // รูปภาพ markdown → คำอธิบาย
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1");          // ลิงก์ markdown → ข้อความลิงก์
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/<[^>\n]{1,80}>/g, " ");                       // แท็ก HTML สั้น ๆ
  const p = protect(s);
  s = p.out;
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");                   // หัวข้อ
  s = s.replace(/^[ \t]*>[ \t]?/gm, "");                        // คำพูดอ้างอิง
  s = s.replace(/^[ \t]*(?:[-*+•▪●◦]|\d+[.)])[ \t]+/gm, "");    // รายการ (bullet / ลำดับเลข)
  s = s.replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(^|[^\w*])[*_](?!\s)([^*_\n]+?)[*_](?=[^\w*]|$)/g, "$1$2");
  s = s.replace(/~~(.+?)~~/g, "$1");
  s = s.replace(EMOJI, " ");
  if (THAI.test(s)) s = s.replace(VORA_NAME, VORA_SPOKEN);      // 16 พ.ย. 2569: ชื่อ VORA → "โวร่า" (เฉพาะเสียงพูด ประโยคไทย)
  s = s.replace(/\.{2,}|…/g, " ");                             // จุดไข่ปลา → เว้นวรรค (หยุดสั้น ๆ)
  s = s.replace(/[?!？！]+/g, " ");                             // ? ! → เว้นวรรค (ไม่ให้อ่าน "ปรัศนี"/"อัศเจรีย์")
  s = s.replace(/~+/g, " ");                                    // ~ ประดับ (ช่วงตัวเลข 8~10 ถูกเก็บไว้แล้ว)
  s = s.replace(/[*#|^]+/g, " ").replace(/(?<!\w)_+|_+(?!\w)/g, " ");   // เครื่องหมาย markdown ที่เหลือ (ขีดล่างในชื่อ เช่น snake_case คงไว้)
  s = s.replace(/["“”«»]/g, " ");                               // อัญประกาศ (เนื้อความในเครื่องหมายยังอยู่)
  s = s.replace(/(^|\s)[-–—]+(?=\s|$)/g, "$1");                  // ขีดลอย ๆ ระหว่างวลี
  s = s.replace(/[ \t]*\n+[ \t]*/g, " ").replace(/[ \t]{2,}/g, " ");
  return restore(s, p.kept).trim();
}

/** คีย์สำหรับค้นไฟล์เสียงที่เตรียมไว้: ใช้กฎเดียวกันทั้งสองฝั่ง (ข้อความที่จะพูด และข้อความใน mapping) จึงค้นเจอแม้ต่างกันแค่ ? ! ~ หรือช่องว่าง */
export function lookupKey(text) {
  return normalizeForSpeech(text).replace(/[\s,.;:]+/g, " ").trim().toLowerCase();
}

// ---------------------------------------------------------------- 21 พ.ย. 2569 (งาน F): ย้ายมาจาก voice.js (โค้ดเดิมทุกบรรทัด)
export function splitSentences(text) {
  const parts = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+|(?<=ค่ะ)\s+|(?<=ครับ)\s+|(?<=นะคะ)\s+/);
  const out = [];
  for (const p of parts) {
    if (!p.trim()) continue;
    if (out.length && (out[out.length - 1].length + p.length) < 140) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  if (!out.length) return [text];
  // 11 พ.ย. 2569 (รอบ 3): ข้อความยาวที่ไม่มีจุดตัด (เช่น สรุปผลค้นเว็บ ~300 ตัวอักษรเป็นก้อนเดียว) → สร้างเสียงนานจนหมดเวลา 8 วิ → เงียบ
  // ตัดทุกก้อนให้ยาวไม่เกิน ~110 ตัวอักษร ที่ช่องว่าง (ภาษาไทยเว้นวรรคระหว่างวลี)
  for (let k = 0; k < out.length; k++) {
    const s = out[k];
    if (s.length <= 130) continue;
    let cut = s.lastIndexOf(" ", 110);                     // ช่องว่างสุดท้ายก่อน 110 ตัวอักษร
    if (cut < 20) cut = s.indexOf(" ", 110);               // ไม่มี → ช่องว่างถัดไป
    if (cut < 0 || cut > 180) cut = 110;                   // ไม่มีช่องว่างเลย: ตัดตามความยาว
    out.splice(k, 1, s.slice(0, cut).trim(), s.slice(cut).trim());
  }
  // 11 พ.ย. 2569: ประโยคแรกสั้นลง (≈ 25–60 ตัวอักษร ตัดที่ช่องว่าง) — สร้างเสียงได้เร็ว เริ่มพูดเร็วขึ้น ไม่ต้องรอทั้งก้อน
  if (out[0].length > 70) {
    const head = out[0];
    let cut = -1;
    for (let i = 25; i <= 60 && i < head.length; i++) if (head[i] === " ") cut = i;
    if (cut > 0) out.splice(0, 1, head.slice(0, cut), head.slice(cut + 1));
  }
  return out;
}

/** ประโยคสำหรับพูด: ตัดประโยคจากข้อความต้นฉบับ (ใช้ . ! ? ค่ะ ครับ เป็นจุดตัด) แล้ว normalize ทีละประโยค · ทิ้งประโยคว่าง
 *  ใช้ฟังก์ชันเดียวกันทั้งตอนพูดและตอนเตรียมเสียงล่วงหน้า → ข้อความ/แคชตรงกัน */
export function speechChunks(text) {
  const raw = String(text || "");
  if (!raw.trim()) return [];
  return splitSentences(raw).map(normalizeForSpeech).filter(Boolean);
}

/** ข้อความทั้งคำตอบสำหรับสตรีม (= ประโยคทั้งหมดต่อกัน) */
export function speechText(text) {
  return speechChunks(text).join(" ");
}
