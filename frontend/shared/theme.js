// VORA Theme helper (Phase 6 · Gate 6B)
// ธีมกำหนดด้วย attribute data-vora-theme="light" | "dark" ที่ element ราก (เช่น <html> หรือ <body>)
// ค่าของแต่ละธีมอยู่ใน /shared/tokens.css · หน้าเดิมยังไม่ได้ใส่ attribute นี้ (ใช้จริงใน 6F Mobile/Admin = light, 6G Kiosk = dark)

export const THEMES = Object.freeze(["light", "dark"]);

/** ตั้งธีมให้ element (ค่าเริ่มต้น <html>) · ค่าไม่ถูกต้อง → ไม่เปลี่ยนและคืน false */
export function applyTheme(theme, el = document.documentElement) {
  if (!THEMES.includes(theme)) return false;
  el.setAttribute("data-vora-theme", theme);
  return true;
}

/** ธีมที่มีผลกับ element (ดูจาก attribute ที่ใกล้ที่สุด) หรือ null ถ้ายังไม่ได้ตั้ง */
export function currentTheme(el = document.documentElement) {
  const host = el.closest("[data-vora-theme]");
  return host ? host.getAttribute("data-vora-theme") : null;
}

/** อ่านค่า token ที่คำนวณแล้ว เช่น token("--vora-bg") */
export function token(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
