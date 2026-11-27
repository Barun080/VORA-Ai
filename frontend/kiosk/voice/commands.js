// VORA — คำสั่งเสียง (Phase 4 · 12 พ.ย. 2569)
// รอบนี้มีคำสั่งเดียว: "หยุดพูด" → STOP_SPEAKING · คำอื่นทั้งหมด = null (ส่งไปถาม AI ตามปกติ)
// ต้องเป็นคำสั่งทั้งประโยค (ลงท้ายด้วยคำสุภาพได้) — "ทำไมหยุดพูด" / "หยุดพูดเรื่องอะไร" ไม่ใช่คำสั่ง
// ไม่มี wake word · ไม่เปิดไมค์เอง: ใช้กับข้อความที่ Listener เดิมฟังได้หลังผู้ใช้กดไมค์เท่านั้น

const STOP = /^หยุดพูด(?:ก่อน)?(?:นะ)?(?:คะ|ค่ะ|ครับ|จ้ะ|จ้า|จ๊ะ)?$/;

export function parseVoiceCommand(text) {
  const t = String(text || "").replace(/[\s.,!?~…"'“”]+/g, "");
  if (STOP.test(t)) return "STOP_SPEAKING";
  return null;
}

// VORA Guide (17 พ.ย. 2569) — คำสั่งเสียงของ Guide แยกจาก parseVoiceCommand (ฟังก์ชันเดิมไม่เปลี่ยน)
// ทั้งประโยค + คำลงท้ายสุภาพแบบเดียวกับ "หยุดพูด" · app.js ใช้ NEXT/BACK/CLOSE เฉพาะตอน Guide เปิดอยู่ — นอกนั้นส่งเข้าระบบเดิมตามปกติ
const POLITE = "(?:นะ)?(?:คะ|ค่ะ|ครับ|จ้ะ|จ้า|จ๊ะ)?";
const ASK = "(?:ให้)?(?:หน่อย|ด้วย)?";       // 25 พ.ย. 2569: "แนะนำการใช้งานหน่อย" "สอนวิธีใช้ให้หน่อย"
const GUIDE = [
  // 25 พ.ย. 2569: เพิ่มคำที่คนพูด/พิมพ์จริง เช่น "แนะนำการใช้งานหน่อย" "ช่วยสอนวิธีใช้ให้หน่อย" "ใช้งานยังไง" (ยังต้องเป็นทั้งประโยค)
  ["GUIDE_START", new RegExp(`^(?:ช่วย|ขอ)?(?:เริ่ม)?(?:แนะนำ|สอน|บอก)?(?:การใช้งาน|วิธีใช้งาน|วิธีการใช้งาน|วิธีใช้|การใช้)${ASK}${POLITE}$`
    + `|^(?:ใช้งาน|ใช้)(?:ยังไง|อย่างไร|ไง)${POLITE}$`)],
  ["GUIDE_NEXT", new RegExp(`^ถัดไป${POLITE}$`)],
  ["GUIDE_BACK", new RegExp(`^ย้อนกลับ${POLITE}$`)],
  ["GUIDE_CLOSE", new RegExp(`^(?:หยุดแนะนำ|ปิด)${POLITE}$`)],
];

export function parseGuideCommand(text) {
  const t = String(text || "").replace(/[\s.,!?~…"'“”]+/g, "");
  for (const [cmd, re] of GUIDE) if (re.test(t)) return cmd;
  return null;
}
