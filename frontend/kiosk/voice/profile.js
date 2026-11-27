// VORA — Voice profile ของตัวละคร (Phase 3 · 12 พ.ย. 2569)
// หลักการ: หนึ่ง character = หนึ่ง voice profile · ไม่มีการสุ่มเสียง · ไม่เปลี่ยนเสียงกลางคำตอบ · fallback ตามลำดับที่กำหนดเท่านั้น
// Phase 3 = EQ อย่างเดียว: speed 1.0 · pitch 0 · ไม่ใช้ playbackRate/detune สร้าง pitch effect
// voice_id เป็นชื่อเชิงตรรกะ ตรงกับฝั่งเซิร์ฟเวอร์ (backend/app/voice_profiles.py) — เสียงจริงของผู้ให้บริการกำหนดที่เซิร์ฟเวอร์ (.env เดิม)
// ไฟล์นี้ยังไม่ถูกเรียกใช้จนกว่าจะเชื่อมใน Phase 4

import { lookupKey } from "./speech-text.js";

export const DEFAULT_CHARACTER = "vora";

/** EQ 3 แบนด์ (ค่าเริ่มต้นจาก VOICE_CONFIG.defaults ของระบบที่แนบมา: bass 2.0 · clarity 1.5 · treble 1.0 · volume 0.90) ไม่ใช้ preset offset/detune */
const VORA = Object.freeze({
  character_id: "vora",
  voice_id: "vora_female_th",
  language: "th",
  speaking_style: "polite_pr",
  speed: 1.0,
  pitch: 0,
  volume: 0.9,
  preset: "eq_only",
  eq: Object.freeze({ bassDb: 2.0, clarityDb: 1.5, trebleDb: 1.0, lowpassHz: 11200 }),
});

export const PROFILES = Object.freeze({ vora: VORA });

/** character → profile (คงที่) · ไม่รู้จัก/ว่าง → VORA ทุกครั้ง */
export function profileFor(characterId) {
  const id = String(characterId || "").trim().toLowerCase();
  return PROFILES[id] || PROFILES[DEFAULT_CHARACTER];
}

/** ลำดับ fallback ทั้งระบบ (ตาม Audit) — ฝั่งเซิร์ฟเวอร์ "primary/secondary" มาจาก VORA_TTS_PROVIDER / VORA_TTS_FALLBACK
 *  กฎ: เลือกแหล่งเสียงได้ครั้งเดียวต่อหนึ่งคำตอบ เมื่อเริ่มเล่นเสียงแล้วห้ามเปลี่ยนแหล่ง (ยกเว้นแหล่งนั้นล้มกลางทาง → ข้ามไปลำดับถัดไปเฉพาะส่วนที่เหลือ และต้องบันทึกเหตุผล) */
export const FALLBACK_ORDER = Object.freeze(["precached", "server-cache", "server-primary", "server-secondary", "browser-female", "silent"]);

// ---------------------------------------------------------------- เสียงของเบราว์เซอร์: ผู้หญิงเท่านั้น
// ชื่อเสียงผู้ชายที่พบใน Windows / Edge / Chrome / macOS (+ ชื่อในข้อกำหนด: ภัทระ นิวัฒน์ Male) — ไม่ใช้เป็นเสียง VORA เด็ดขาด
export const MALE_VOICE = /\b(pattara|niwat|david|mark|guy|andrew|brian|christopher|eric|roger|steffan|george|ryan|james|daniel|alex|fred|thomas|richard)\b|\bmale\b|uk english male|ภัทระ|นิวัฒน์|ผู้ชาย/i;
const PRIORITY = {
  th: [/premwadee/i, /เปรมวดี/i, /kanya/i, /narisa/i, /achara/i, /google.*(ไทย|thai)/i],
  en: [/\bava\b/i, /jenny/i, /aria/i, /emma/i, /google us/i, /samantha/i, /zira/i],
};

/** เลือกเสียงผู้หญิงของเบราว์เซอร์แบบคงที่ (ลำดับเดิมทุกครั้ง) · ไม่มีเสียงผู้หญิง → null (ห้ามปล่อยให้เบราว์เซอร์เลือกเสียงเอง) */
export function pickFemaleVoice(voices, lang = "th") {
  const want = lang === "en" ? "en" : "th";
  const list = (voices || []).filter((v) => v && v.lang && v.lang.toLowerCase().startsWith(want) && !MALE_VOICE.test(v.name || ""));
  for (const rx of PRIORITY[want]) {
    const v = list.find((x) => rx.test(x.name || ""));
    if (v) return v;
  }
  return list.find((x) => /(female|ผู้หญิง|หญิง)/i.test(x.name || "")) || null;
}

// ---------------------------------------------------------------- ไฟล์เสียงที่เตรียมไว้ (Phase 2 · frontend/assets/voices/)
// ข้อความ = key ใน VOICE_CONFIG.precachedPhrases ของระบบที่แนบมา · เนื้อหาเสียงยัง UNVERIFIED (docs/voice-integration/phase2/voice-mapping.txt)
// ไฟล์เหล่านี้เป็นเสียง Google Translate → ใช้ได้เฉพาะเมื่อผู้ให้บริการหลักเป็น google (เสียงเดียวกัน) · ไม่มีการเลือกแบบสุ่ม
export const PRECACHED_PROVIDER = "google";
export const PRECACHED = Object.freeze({
  "สวัสดีค่ะ! ยินดีต้อนรับสู่ VORA หุ่นยนต์ประชาสัมพันธ์อัจฉริยะ ของวิทยาลัยเทคนิคน่าน มีอะไรให้ช่วยสอบถามได้เลยค่ะ": "/assets/voices/vora_welcome.mp3",
  "สวัสดีค่ะ! ยินดีต้อนรับนะคะ มีอะไรให้โวร่าช่วย สอบถามได้เลยค่ะ": "/assets/voices/vora_cam_greet_1.mp3",
  "สวัสดีค่ะ! ดีใจที่ได้พบกันนะคะ วันนี้มีเรื่องอะไรอยากให้โวร่าช่วยแนะนำมั้ยคะ": "/assets/voices/vora_cam_greet_2.mp3",
  "สวัสดีค่ะ ฉันคือโวร่า ผู้ช่วยเอไอส่วนตัวของคุณ มีอะไรให้ฉันช่วยดูแลในวันนี้มั้ยคะ?": "/assets/voices/vora_preview_th.mp3",
  "คะ มีอะไรให้โวร่าช่วยมั้ยคะ ถามมาได้เลยค่ะ": "/assets/voices/vora_wake_1.mp3",
  "คะ โวร่าอยู่นี่ค่ะ พร้อมฟังคำถามแล้วค่ะ": "/assets/voices/vora_wake_2.mp3",
  "มีอะไรให้ช่วยมั้ยคะ?": "/assets/voices/vora_click_1.mp3",
  "เอ๊~ มีอะไรรึเปล่าคะ?": "/assets/voices/vora_click_2.mp3",
  "กำลังสนุกอยู่หรือเปล่าคะ?": "/assets/voices/vora_headpat_1.mp3",
  "ต้องการแค่นี้เองหรอคะ?": "/assets/voices/vora_headpat_2.mp3",
});

const _index = new Map(Object.entries(PRECACHED).map(([t, url]) => [lookupKey(t), url]));

/** ข้อความทั้งข้อความ → URL ไฟล์เสียงที่เตรียมไว้ หรือ null
 *  ค้นด้วยข้อความเต็มที่ normalize ทั้งสองฝั่ง (ไม่ตัดประโยคก่อนค้น — สาเหตุที่ระบบเดิมค้นไม่เจอเลย 0/10)
 *  provider ต้องตรงกับ PRECACHED_PROVIDER ไม่เช่นนั้นคืน null (ไม่ผสมเสียงคนละผู้ให้บริการ) */
export function findPrecached(text, { provider = PRECACHED_PROVIDER, lang = "th" } = {}) {
  if (lang !== "th" || provider !== PRECACHED_PROVIDER) return null;
  return _index.get(lookupKey(text)) || null;
}
