// VORA — โหมดการทำงานของหน้าจอตามสถานะอินเทอร์เน็ต (งาน F "สาธิตไม่สะดุด" · 21 พ.ย. 2569)
// ai = ปกติ · kb = โหมดฐานความรู้ (เซิร์ฟเวอร์ตรวจพบว่าเน็ตล่ม หรือเจ้าหน้าที่เปิด "จำลองเน็ตล่ม")
// ไฟล์นี้ไม่มีโค้ดเบราว์เซอร์ (ทดสอบด้วย node ได้) — app.js เป็นผู้เรียกใช้

/** โหมดจากผล /api/health (เซิร์ฟเวอร์รุ่นเก่าไม่มีฟิลด์ net = ai) */
export function netModeOf(health) {
  const n = health && health.net;
  return n && n.mode === "kb" ? "kb" : "ai";
}

/** เปลี่ยนโหมดหรือไม่: null = ไม่เปลี่ยน · "offline" / "online" = เพิ่งเปลี่ยน (เริ่มต้นเป็น ai ไม่นับเป็นการเปลี่ยน) */
export function netTransition(prev, next) {
  if ((prev || "ai") === next) return null;
  return next === "kb" ? "offline" : "online";
}

/** ปุ่มคำถามที่จะแสดง: โหมด kb = คำถามยอดฮิตที่ตอบได้จากฐานความรู้ (สูงสุด 6) · ปกติ = คำถามแนะนำจาก AI (สูงสุด 3 เหมือนเดิม) */
export function chipList(mode, suggestions, quick, { ai = 3, kb = 6 } = {}) {
  if (mode === "kb" && Array.isArray(quick) && quick.length) return quick.slice(0, kb);
  return (Array.isArray(suggestions) ? suggestions : []).slice(0, ai);
}
