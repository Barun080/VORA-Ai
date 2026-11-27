// VORA SVG Icon System (Phase 6 · Gate 6B)
// ไอคอนเส้น 24×24 วาดเองทั้งหมด (ไม่มีไลบรารี/ไฟล์ภายนอก ไม่ต้องใช้อินเทอร์เน็ต) · สีตาม currentColor · แทน emoji ที่แสดงต่างกันตามเครื่อง (ปัญหา P6)
// ใช้: import { icon, hydrateIcons } from "/shared/icons.js"
//   icon("pin")                         → สตริง <svg> (ตกแต่ง: aria-hidden)
//   icon("pin", { label: "สถานที่" })   → มี role="img" + <title> (มีความหมาย)
//   <i data-vora-icon="calendar"></i> + hydrateIcons(root) → แทนที่ด้วย <svg>
// สไตล์: .vora-icon ใน /shared/components.css

const P = {
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  online: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h.01M17 21h4v-4"/>',
  phone: '<path d="M5 3h3l2 5-2.5 1.5a11 11 0 0 0 7 7L16 14l5 2v3a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  "mic-off": '<path d="M15 10V6a3 3 0 0 0-5.8-1M9 9v2a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  "wifi-off": '<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.6M19 13a10 10 0 0 0-2.3-1.6M2 9.5a15 15 0 0 1 4.5-2.8M22 9.5A15 15 0 0 0 11 6M12 20h.01"/>',
  robot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/><circle cx="12" cy="3.5" r="1"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  "camera-off": '<path d="M3 3l18 18M9 5h6l2 3h3v10M20 19H4V8h3"/><path d="M9.5 10.5a3.5 3.5 0 0 0 4.9 4.9"/>',
  hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5A5.5 5.5 0 0 1 4 15.5V11a1.5 1.5 0 0 1 3 0v2"/>',
  "text-size": '<path d="M3 19 8 5l5 14M4.7 14.5h6.6M14 19l3.5-9 3.5 9M15.2 16h4.6"/>',
  tools: '<path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.5-1.5a4 4 0 0 1-5-5L13 2z"/><path d="M3 21l6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  school: '<path d="M3 9 12 4l9 5-9 5-9-5z"/><path d="M7 11v5c0 1.5 2.2 3 5 3s5-1.5 5-3v-5M21 9v6"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};

export const ICON_NAMES = Object.freeze(Object.keys(P));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** คืนสตริง <svg> · ไม่รู้จักชื่อ → สตริงว่าง (ไม่โยน error ให้หน้าจอพัง) */
export function icon(name, { label = "", size = "", className = "" } = {}) {
  const body = P[name];
  if (!body) return "";
  const cls = ["vora-icon", size ? `vora-icon--${size}` : "", className].filter(Boolean).join(" ");
  const a11y = label ? `role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>` : `aria-hidden="true" focusable="false">`;
  return `<svg class="${cls}" viewBox="0 0 24 24" data-icon="${name}" ${a11y}${body}</svg>`;
}

/** แทนที่ <i data-vora-icon="ชื่อ" data-label="…"> ภายใน root ด้วย SVG · คืนจำนวนที่แทนได้ */
export function hydrateIcons(root = document) {
  let n = 0;
  root.querySelectorAll("[data-vora-icon]").forEach((el) => {
    const html = icon(el.dataset.voraIcon, { label: el.dataset.label || "", size: el.dataset.size || "" });
    if (!html) return;
    el.insertAdjacentHTML("afterend", html);
    el.remove();
    n++;
  });
  return n;
}
