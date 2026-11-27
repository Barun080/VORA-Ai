// VORA — ตัวช่วยเรียก API และ WebSocket แบบเชื่อมต่อใหม่อัตโนมัติ (ใช้ร่วมกันทุกหน้า)

/** 25 พ.ย. 2569: กุญแจจอในวง LAN (สร้างโดย kiosk/screen-link.js) — ไม่มี = ไม่แนบ */
function screenKeyHeader() {
  try { const k = globalThis.localStorage && localStorage.getItem("vora.screenKey"); return k && /^[a-f0-9]{32,64}$/.test(k) ? k : ""; } catch { return ""; }
}

export async function api(path, { method = "GET", body, token, timeout = 15000, raw = false, form } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const sk = screenKeyHeader();                    // 25 พ.ย. 2569: จอในวง LAN (kiosk/screen-link.js)
  if (sk) headers["X-VORA-Screen"] = sk;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  try {
    const res = await fetch(path, { method, headers, body: payload, signal: ctrl.signal });
    if (raw) return res;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const d = data && data.detail;
      const msg = typeof d === "string" ? d : (d && d.message) || `เกิดข้อผิดพลาด (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("เซิร์ฟเวอร์ตอบช้าเกินไป กรุณาลองใหม่");
    if (e instanceof TypeError) throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบเครือข่ายแล้วลองใหม่");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** WebSocket ที่เชื่อมต่อใหม่เองเมื่อหลุด พร้อม ping เพื่อรักษาการเชื่อมต่อ */
export class LiveSocket {
  constructor(role, { token, onMessage, onStatus } = {}) {
    this.role = role; this.token = token; this.onMessage = onMessage; this.onStatus = onStatus;
    this.retry = 1000; this.closed = false; this.connect();
  }
  url() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const t = this.token ? `&token=${encodeURIComponent(this.token)}` : "";
    const sk = this.role === "kiosk" ? screenKeyHeader() : "";
    return `${proto}://${location.host}/ws?role=${this.role}${t}${sk ? `&screen=${sk}` : ""}`;
  }
  connect() {
    if (this.closed) return;
    try { this.ws = new WebSocket(this.url()); } catch { return this.schedule(); }
    this.ws.onopen = () => {
      this.retry = 1000; this.onStatus && this.onStatus(true);
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.send({ type: "ping" }), 25000);
    };
    this.ws.onmessage = (ev) => {
      try { const m = JSON.parse(ev.data); this.onMessage && this.onMessage(m.topic, m.data); } catch { /* ignore */ }
    };
    this.ws.onclose = () => { clearInterval(this.pinger); this.onStatus && this.onStatus(false); this.schedule(); };
    this.ws.onerror = () => { try { this.ws.close(); } catch { /* ignore */ } };
  }
  schedule() {
    if (this.closed) return;
    setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, 15000);
  }
  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
  close() { this.closed = true; try { this.ws.close(); } catch { /* ignore */ } }
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
