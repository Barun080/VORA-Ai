// ภาพประกอบแผนก (11 พ.ย. 2569) — ไอคอนเส้นเรียบง่าย ใช้เมื่อเจ้าหน้าที่ยังไม่ได้อัปโหลดภาพจริงของสาขา
// เป็นภาพสัญลักษณ์ ไม่ใช่ภาพถ่ายของวิทยาลัย · เลือกจากรหัสสาขา (VTCN-AUTO …) หรือคำในชื่อสาขา
const P = {
  car: '<path d="M5 17h14M6 17v2M18 17v2"/><path d="M4 13l2-5a2 2 0 0 1 2-1h8a2 2 0 0 1 2 1l2 5v4H4z"/><circle cx="8" cy="14.5" r="1"/><circle cx="16" cy="14.5" r="1"/>',
  ev: '<path d="M4 13l2-5a2 2 0 0 1 2-1h8a2 2 0 0 1 2 1l2 5v4H4z"/><path d="M12.5 8.5 10.5 12h3l-2 3.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  weld: '<path d="M12 3c2 3 4 4.5 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-2-1-4 0-7z"/><path d="M5 21h14"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  build: '<path d="M3 21h18M5 21V9l7-5 7 5v12"/><path d="M9 21v-6h6v6"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  robot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/><circle cx="12" cy="3.5" r="1"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2z"/>',
  factory: '<path d="M3 21V11l5 3V11l5 3V7l8 4v10z"/><path d="M7 18h2M12 18h2M17 18h2"/>',
  megaphone: '<path d="M3 11v3l11 5V6L3 11z"/><path d="M14 9a4 4 0 0 1 0 6M6 14l1 5h3l-1-4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 13h8"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h6"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  cart: '<path d="M3 4h2l2.5 11h10L20 7H6.2"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  chef: '<path d="M7 14a4 4 0 1 1 1.5-7.7A4 4 0 0 1 16 6a4 4 0 1 1 1 8v5H7z"/><path d="M7 17h10"/>',
  school: '<path d="M12 4 2 9l10 5 10-5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>',
};
const BY_CODE = { AUTO: "car", EV: "ev", MACHINE: "gear", WELD: "weld", POWER: "bolt", ELEC: "chip", CONST: "build", COMPUTER: "monitor",
  MECHA: "robot", BASIC: "wrench", INDUS: "factory", MARKETING: "megaphone", OFFICE: "folder", ACCOUNT: "calc", IT: "web", DIGIBIZ: "cart", FOOD: "chef" };
const BY_WORD = [["ยานยนต์ไฟฟ้า", "ev"], ["ยนต์", "car"], ["กลโรงงาน", "gear"], ["เชื่อม", "weld"], ["ไฟฟ้า", "bolt"], ["อิเล็กทรอนิกส์", "chip"],
  ["ก่อสร้าง", "build"], ["คอมพิวเตอร์", "monitor"], ["หุ่นยนต์", "robot"], ["เมคคา", "robot"], ["อุตสาหกรรม", "factory"], ["การตลาด", "megaphone"],
  ["สำนักงาน", "folder"], ["บัญชี", "calc"], ["สารสนเทศ", "web"], ["ดิจิทัล", "cart"], ["อาหาร", "chef"], ["พื้นฐาน", "wrench"]];

export function programIcon(p, size = 96) {
  const code = String((p && p.code) || "").replace(/^VTCN-/, "");
  let key = BY_CODE[code];
  if (!key) { const n = (p && p.name_th) || ""; const hit = BY_WORD.find(([w]) => n.includes(w)); key = hit ? hit[1] : "school"; }
  return `<svg class="prog-ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[key]}</svg>`;
}
