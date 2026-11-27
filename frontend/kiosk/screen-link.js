// 25 พ.ย. 2569: จอในวง LAN — หน้าจอหุ่นยนต์ที่เปิดจากเครื่องอื่น (ไม่ใช่ localhost) ขออนุมัติจากหลังบ้านเอง
// กุญแจสุ่มเก็บใน localStorage ("vora.screenKey") แล้ว shared/api.js แนบไปกับทุกคำขอ/WebSocket ให้อัตโนมัติ
// ยังไม่อนุมัติ = ใช้งานได้แบบมือถือ (ถามได้ จำกัดจำนวน) + ป้ายมุมจอบอกรหัสให้ผู้ดูแลอนุมัติ
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const KEY_NAME = "vora.screenKey";
export const isLocalHost = (h) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(String(h || "").toLowerCase());

export function newKey(rand = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return Array.from(rand(16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function screenKey(store = globalThis.localStorage) {
  try {
    let k = store.getItem(KEY_NAME) || "";
    if (!/^[a-f0-9]{32,64}$/.test(k)) { k = newKey(); store.setItem(KEY_NAME, k); }
    return k;
  } catch { return ""; }
}

/** ข้อความป้ายตามสถานะ (ไม่มีป้าย = null) */
export function badgeText(r, secure) {
  const out = [];
  if (r && r.status === "pending") out.push(`จอนี้รออนุมัติ · รหัส <b>${esc(r.code)}</b> — ผู้ดูแลกดอนุมัติที่หลังบ้าน › จอในวง LAN`);
  if (r && r.status === "revoked") out.push(`จอนี้ถูกปิดสิทธิ์ (รหัส ${esc(r.code)}) — ใช้งานได้แบบมือถือ`);
  if (!secure) out.push("เปิดผ่าน http ไมค์และกล้องใช้ไม่ได้ — เปิดที่อยู่ https:// แทน");
  return out.length ? out.join("<br>") : null;
}

export async function initScreenLink({ onApproved } = {}) {
  if (isLocalHost(location.hostname)) return { status: "robot" };
  const key = screenKey();
  if (!key) return { status: "nokey" };
  const { api } = await import("/shared/api.js");
  let el = null, last = null;
  const show = (r) => {
    const t = badgeText(r, window.isSecureContext);
    if (!t) { if (el) el.remove(); el = null; return; }
    if (!el) {
      el = document.createElement("div");
      el.className = "screen-link-badge";
      el.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9999;max-width:min(520px,90vw);padding:10px 14px;border-radius:12px;"
        + "background:rgba(15,23,42,.88);color:#fde68a;font:14px/1.5 system-ui,sans-serif;box-shadow:0 6px 20px #0006;cursor:pointer";
      el.title = "แตะเพื่อซ่อน";
      el.onclick = () => (el.style.display = "none");
      document.body.appendChild(el);
    }
    el.innerHTML = t;
  };
  const check = async () => {
    try {
      const r = await api("/api/screens/hello", { method: "POST", body: { key, name: "" } });
      if (r.status === "approved" && last && last.status !== "approved" && onApproved) onApproved(r);
      last = r;
      show(r);
      return r;
    } catch { return last || { status: "error" }; }
  };
  const r = await check();
  if (r.status !== "approved" && r.status !== "off") setInterval(check, 20000);
  return r;
}
