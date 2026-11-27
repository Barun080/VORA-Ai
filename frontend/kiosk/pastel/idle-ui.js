// โหมดหน้าจอว่าง: เมื่อไม่มีการขยับเมาส์ แตะ เลื่อน หรือกดคีย์ จะเหลือเพียงอวตาร์
// เมื่อมีการใช้งาน แถบเครื่องมือและปุ่มจะโผล่ขึ้นมา แล้วซ่อนเองหลังว่างตามเวลาใน data-idle-hide (วินาที)
// จะไม่ซ่อนระหว่างที่กำลังฟัง/คิด/ตอบในบทสนทนา มีหน้าต่างเปิดอยู่ หรือกำลังพิมพ์
// การโต้ตอบผ่านกล้อง (ท่ามือ ชูป้าย ทักทายผู้มาใหม่) ทำให้เครื่องมือโผล่ชั่วคราวด้วย (app.js ส่งเหตุการณ์ vora:activity)

const app = document.getElementById("app");
const hideMs = () => Math.max(2, Number(app.dataset.idleHide) || 8) * 1000;
let timer;

function busy() {
  const s = app.dataset.state;
  if (s === "listening" || s === "thinking") return true;
  if (s === "speaking" && app.dataset.phase === "convo") return true;
  if (document.querySelector("dialog[open]")) return true;
  const a = document.activeElement;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}

function arm() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (busy()) { arm(); return; }
    app.classList.remove("is-active");
    app.classList.add("is-idle");
    if (document.activeElement && app.contains(document.activeElement)) document.activeElement.blur();
  }, hideMs());
}

export function wake() {
  if (!app.classList.contains("is-active")) {
    app.classList.add("is-active");
    app.classList.remove("is-idle");
  }
  arm();
}

let lastMove = 0;
addEventListener("pointermove", (e) => {
  // กันการสั่นเล็กน้อยของจอสัมผัส/เมาส์
  const now = performance.now();
  if (now - lastMove < 120) return;
  lastMove = now;
  if (Math.abs(e.movementX) + Math.abs(e.movementY) > 1 || e.pointerType !== "mouse") wake();
}, { passive: true });
for (const ev of ["pointerdown", "wheel", "keydown", "touchstart"]) addEventListener(ev, wake, { passive: true, capture: true });
addEventListener("vora:activity", wake);

// เมื่อเริ่มสนทนา (เช่น วอร่าทักทายเมื่อเห็นคน) ให้เครื่องมือโผล่อัตโนมัติ
new MutationObserver(() => { if (busy()) wake(); })
  .observe(app, { attributes: true, attributeFilter: ["data-state", "data-phase"] });

arm();
