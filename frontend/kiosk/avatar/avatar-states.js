// สถานะของอวตาร VORA — ใช้ร่วมกันทั้งอวตารจำลอง (SVG) และอวตารจริงจาก PSD (ภาพเลเยอร์ PNG/WebP)
// ไฟล์นี้ไม่มีตรรกะ AI ใด ๆ: ระบบสนทนา/กล้อง/ประกาศ แค่บอกว่า "ตอนนี้อยู่สถานะไหน" แล้วอวตารแสดงผลเอง

export const AVATAR_STATES = {
  idle:       { color: "#FFD400", ring: 1.0, eyes: "open",  mouth: "smile",   enter: null,           th: "พร้อมใช้งาน",   en: "Ready" },
  listening:  { color: "#22C55E", ring: 2.2, eyes: "open",  mouth: "neutral", enter: "listen",       th: "กำลังฟัง…",     en: "Listening…" },
  thinking:   { color: "#FFEA70", ring: 3.0, eyes: "up",    mouth: "neutral", enter: "think",        th: "กำลังคิด…",     en: "Thinking…" },
  speaking:   { color: "#FFD400", ring: 1.6, eyes: "open",  mouth: "talk",    enter: null,           th: "กำลังตอบ",      en: "Speaking" },
  greeting:   { color: "#FFD400", ring: 1.8, eyes: "happy", mouth: "talk",    enter: "wave",         th: "กำลังทักทาย",   en: "Greeting" },
  announcing: { color: "#F59E0B", ring: 1.4, eyes: "open",  mouth: "talk",    enter: "point_screen", th: "กำลังประกาศ",   en: "Announcing" },
  happy:      { color: "#FFEA70", ring: 1.8, eyes: "happy", mouth: "smile",   enter: "happy",        th: "ยินดีค่ะ",       en: "Happy" },
  error:      { color: "#EF4444", ring: 0.6, eyes: "sad",   mouth: "sad",     enter: "shrug",        th: "ระบบขัดข้อง",   en: "Error" },
  // VORA NEXT Phase 2 — สถานะสำหรับการนำเสนอ (ใช้ท่าทางชุดเดิมของ Robot Protocol ไม่เพิ่มคำสั่งหุ่นยนต์)
  presenting: { color: "#FFD400", ring: 1.4, eyes: "open",  mouth: "smile",   enter: "present",      th: "กำลังนำเสนอ",   en: "Presenting" },
  pointing:   { color: "#FFD400", ring: 1.4, eyes: "open",  mouth: "smile",   enter: "point_screen", th: "ดูข้อมูลตรงนี้",  en: "Look here" },
  waving:     { color: "#FFEA70", ring: 1.8, eyes: "happy", mouth: "smile",   enter: "wave",         th: "โบกมือ",         en: "Waving" },
  thanking:   { color: "#FFEA70", ring: 1.6, eyes: "happy", mouth: "smile",   enter: "bow",          th: "ขอบคุณค่ะ",      en: "Thank you" },
};

/** สถานะมาตรฐานที่ทุก Renderer ต้องรองรับ (ตาม Avatar Adapter Interface — docs/AVATAR_INTEGRATION.md) */
export const STANDARD_STATES = ["idle", "greeting", "listening", "thinking", "speaking", "presenting", "pointing", "waving", "thanking", "happy"];

/** อารมณ์/สีหน้า ที่ระบบใช้ — Renderer ที่ไม่มีภาพของอารมณ์ใดจะใช้ภาพใกล้เคียงแทน */
export const EXPRESSIONS = ["neutral", "happy", "sorry"];

export const STATE_NAMES = Object.keys(AVATAR_STATES);

// ชื่อท่าทางชุดเดียวกับที่ส่งให้หุ่นยนต์จริง (backend/app/robot/protocol.py: GESTURES)
// ค่า = ระยะเวลาแสดงบนจอ (มิลลิวินาที) — การเคลื่อนไหวบนจอเป็นการจำลองเท่านั้น แยกจากมอเตอร์ของหุ่นจริง
export const GESTURE_DURATION = {
  wave: 2200, bow: 2000, nod: 1200, shake: 1200, present: 1800, point_screen: 1500, point_direction: 1500,
  explain: 1600, think: 1200, happy: 1800, shrug: 1400, listen: 800, dance: 4000, spin: 3500, idle: 300,
};

// ชื่อเลเยอร์มาตรฐาน — ตั้งชื่อเลเยอร์ใน PSD ให้ตรงกับรายการนี้ (ดู avatar/README.md)
export const LAYER_SLOTS = [
  "shadow", "hair_back", "legs", "shoes", "body", "arm_l_upper", "arm_l_fore", "arm_r_upper", "arm_r_fore",
  "neck", "head", "eyes", "mouth", "hair_front", "accessories",
];

// จุดหมุน (pivot) ในพิกัดผืนภาพ 400×820 — อวตารจริงต้องวาดบนผืนขนาดเดียวกัน หรือระบุ pivots ใน manifest
export const DEFAULT_PIVOTS = {
  head: [200, 268], armL: [150, 302], elbowL: [150, 392], armR: [250, 302], elbowR: [250, 392], feet: [200, 790],
};
