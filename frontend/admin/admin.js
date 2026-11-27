// VORA หลังบ้าน — จัดการเนื้อหา ฐานความรู้ ฝึกโมเดล AI ตารางประชาสัมพันธ์ หุ่นยนต์ และรายงาน
import { api, esc, LiveSocket } from "/shared/api.js";
import { createEmbedder, embedVector } from "/shared/vision.js";
import { speechText } from "/voice/speech-text.js";          // งาน F: ฟังก์ชันเดียวกับหน้าจอหุ่น (ข้อความ = คีย์ไฟล์เสียง)
import { GUIDE_STEPS } from "/guide/guide-steps.js";
import { KIND_TH as PRE_KIND_TH, buildPlan, guidePhrases, summarize } from "./prewarm.js";
import { describeTrace, SOURCE_TH as BRAIN_SRC } from "./brain-view.js";   // งาน A: สมองโปร่งใส
import { EVIDENCE_TH, SB_STATUS, sandboxCard } from "./sandbox-view.js";   // 24 พ.ย. 2569: กล่องตรวจข้อมูล
import { VARIANTS_PER_IMAGE, embedImages, newsToItem, trainable } from "./vision-import.js";   // 24 พ.ย. 2569: นำเข้าทีละมาก

const $ = (id) => document.getElementById(id);
const S = { token: null, user: null, view: "dashboard", socket: null, charts: [], feed: [], robot: null, onRobot: null, cleanup: [] };
try { S.token = localStorage.getItem("vora.token"); } catch { /* ignore */ }

const ROLE_TH = { admin: "ผู้ดูแลระบบ", editor: "เจ้าหน้าที่", viewer: "ผู้ดูข้อมูล" };
const STATUS_TH = { draft: "ฉบับร่าง", pending: "รออนุมัติ", published: "เผยแพร่แล้ว", archived: "เก็บถาวร", approved: "อนุมัติแล้ว", rejected: "ไม่อนุมัติ", new: "ใหม่", resolved: "แก้ไขแล้ว", ignored: "ข้าม", reviewed: "ตรวจแล้ว" };
const KIND_TH = { news: "ข่าว", activity: "กิจกรรม", admission: "รับสมัคร" };
const INTENT_TH = { greeting: "ทักทาย", thanks_bye: "ขอบคุณ/ลา", about_robot: "เกี่ยวกับหุ่นยนต์", programs_list: "สาขาที่เปิดสอน", program_detail: "รายละเอียดสาขา", career: "อาชีพ/เรียนต่อ", admission: "การสมัครเรียน", tuition: "ค่าเล่าเรียน", scholarship: "ทุนการศึกษา", news: "ข่าว", activity: "กิจกรรม", location: "สถานที่", contact: "ติดต่อ", robot_action: "สั่งท่าทางหุ่นยนต์", out_of_scope: "นอกขอบเขต", unknown: "ไม่ทราบ", vision: "จำภาพ", auto_greeting: "ทักทายอัตโนมัติ" };
const CATS = { general: "ทั่วไป", program: "หลักสูตร", admission: "การสมัคร", tuition: "ค่าใช้จ่าย", scholarship: "ทุน", career: "อาชีพ/เรียนต่อ", news: "ข่าว", activity: "กิจกรรม", location: "สถานที่", contact: "ติดต่อ", robot: "หุ่นยนต์" };
const ACTION_TH = { announce_news: "ประกาศข่าว/กิจกรรมที่เลือก", announce_program: "แนะนำสาขาที่เลือก", top_news: "ประกาศข่าวสำคัญล่าสุด", announce_text: "ประกาศข้อความ", play_media: "เปิดวิดีโอ/รูปภาพ", patrol: "เดินประชาสัมพันธ์" };
const GESTURE_TH = { wave: "โบกมือ", bow: "ไหว้", nod: "พยักหน้า", shake: "ส่ายหน้า", present: "ผายมือ", point_screen: "ชี้จอ", point_direction: "ชี้ทาง", explain: "อธิบาย", think: "ครุ่นคิด", happy: "ดีใจ", shrug: "ยักไหล่", listen: "ฟัง", dance: "เต้น", spin: "หมุนตัว", idle: "ยืนพัก" };

const NAV = [
  ["ภาพรวม", [["dashboard", "แดชบอร์ด"], ["reports", "รายงานและประเมินผล"]]],
  ["เนื้อหาประชาสัมพันธ์", [["news", "ข่าวและกิจกรรม"], ["programs", "หลักสูตร/สาขา"], ["admission", "การรับสมัคร"], ["schedules", "ประชาสัมพันธ์อัตโนมัติ"]]],
  ["ปัญญาประดิษฐ์", [["brain", "สมองโปร่งใส (ดู AI คิดสด)"], ["aimodel", "เลือกโมเดล AI"], ["knowledge", "ฐานความรู้ AI"], ["sandbox", "กล่องตรวจข้อมูล (Sandbox)", "sandbox"], ["unanswered", "คำถามที่ตอบไม่ได้", "unanswered"], ["training", "ฝึกโมเดลเข้าใจคำถาม"], ["vision", "สอนกล้องจำป้าย"], ["evaluation", "ชุดทดสอบระบบ"]]],
  ["หุ่นยนต์", [["robot", "ควบคุมและสถานะ"], ["screens", "จอในวง LAN", "screens"]]],
  ["ผู้ใช้งาน", [["feedback", "ผลตอบรับ", "feedback"]]],
  ["ระบบ", [["offline", "สาธิตไม่สะดุด (ทนเน็ตล่ม)"], ["settings", "ตั้งค่า"], ["users", "ผู้ใช้และสิทธิ์"], ["logs", "ประวัติและเหตุการณ์"]]],
];
const TITLES = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([k, v]) => [k, v])));

// =========================================================================== เครื่องมือทั่วไป
const call = (path, opts = {}) => api(path, { ...opts, token: S.token }).catch((e) => {
  if (e.status === 401) { logout(); }
  throw e;
});
function toast(msg, err = false) {
  const t = $("toast");
  t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(toast.tm); toast.tm = setTimeout(() => (t.hidden = true), err ? 5000 : 2600);
}
const can = (role) => ({ viewer: 1, editor: 2, admin: 3 }[S.user?.role] || 0) >= ({ viewer: 1, editor: 2, admin: 3 }[role]);
const fmt = (d) => (d ? new Date(d).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "-");
const pct = (v) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);
const badge = (s, label) => `<span class="badge ${esc(String(s))}">${esc(label ?? STATUS_TH[s] ?? s)}</span>`;
async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); return null; }
}

function table(cols, rows, empty = "ยังไม่มีข้อมูล") {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr>${cols.map((c) => `<td>${c[1](r, i)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/** หน้าต่างฟอร์มอเนกประสงค์ คืนค่าข้อมูลเมื่อกดบันทึก หรือ null เมื่อยกเลิก */
function modalForm(title, fields, values = {}, { submit = "บันทึก", setup = null } = {}) {
  return new Promise((resolve) => {
    const dlg = $("modal"), form = $("modalForm");
    const toLocal = (v) => (v ? String(v).slice(0, 16) : "");
    form.innerHTML = `<h2>${esc(title)}</h2><div class="fields">${fields.map((f) => {
      const v = values[f.key] ?? f.default ?? "";
      const cls = `f ${f.wide || f.type === "textarea" ? "wide" : ""} ${f.type === "checkbox" ? "check" : ""}`;
      const hint = f.hint ? `<small>${esc(f.hint)}</small>` : "";
      if (f.type === "textarea") return `<label class="${cls}">${esc(f.label)}${hint}<textarea name="${f.key}" rows="${f.rows || 4}">${esc(v)}</textarea></label>`;
      if (f.type === "select") return `<label class="${cls}">${esc(f.label)}${hint}<select name="${f.key}">${Object.entries(f.options).map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
      if (f.type === "checkbox") return `<label class="${cls}"><input type="checkbox" name="${f.key}" ${v ? "checked" : ""}> ${esc(f.label)}</label>`;
      if (f.type === "gallery") return `<label class="${cls} wide">${esc(f.label)}${hint}<textarea name="${f.key}" rows="3" placeholder="/uploads/...">${esc(v)}</textarea><input type="file" multiple data-gallery="${f.key}" accept="image/*"></label>`;
      if (f.type === "media") return `<label class="${cls} wide">${esc(f.label)}${hint}<span class="media-pick"><input type="text" name="${f.key}" value="${esc(v)}" placeholder="/uploads/... หรือ URL"><input type="file" data-for="${f.key}" accept="${f.accept || "image/*,video/*"}"></span></label>`;
      // 19 พ.ย. 2569: แถบเลื่อน (type: "range") แสดงค่าปัจจุบันข้างแถบ เช่น ความมีชีวิตชีวาของอวตาร
      if (f.type === "range") return `<label class="${cls} wide">${esc(f.label)}${hint}<span class="range-pick" style="display:flex;align-items:center;gap:12px"><input type="range" name="${f.key}" value="${esc(v)}" min="${f.min ?? 0}" max="${f.max ?? 100}" step="${f.step ?? 1}" style="flex:1" oninput="this.nextElementSibling.textContent=this.value+'${esc(f.unit || "")}'"><output style="min-width:4.5em;text-align:right;font-weight:600">${esc(v)}${esc(f.unit || "")}</output></span></label>`;
      const type = f.type === "datetime" ? "datetime-local" : f.type || "text";
      const val = f.type === "datetime" ? toLocal(v) : v;
      return `<label class="${cls}">${esc(f.label)}${hint}<input type="${type}" name="${f.key}" value="${esc(val)}" ${f.required ? "required" : ""} ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""}></label>`;
    }).join("")}</div><div class="actions"><button class="btn" value="cancel" formnovalidate>ยกเลิก</button><button class="btn primary" value="ok">${esc(submit)}</button></div>`;
    form.querySelectorAll("input[type=file][data-for]").forEach((inp) => (inp.onchange = async () => {
      const fd = new FormData(); fd.append("file", inp.files[0]);
      const r = await run(() => call("/api/admin/upload", { method: "POST", form: fd, timeout: 120000 }), "อัปโหลดแล้ว");
      if (r) form.querySelector(`[name="${inp.dataset.for}"]`).value = r.url;
    }));
    form.querySelectorAll("input[data-gallery]").forEach((inp) => (inp.onchange = async () => {   // 11 พ.ย. 2569: อัปโหลดหลายภาพ ต่อท้ายรายการ
      const box = form.querySelector(`[name="${inp.dataset.gallery}"]`);
      for (const file of inp.files) {
        const fd = new FormData(); fd.append("file", file);
        const r = await run(() => call("/api/admin/upload", { method: "POST", form: fd, timeout: 120000 }));
        if (r) box.value = (box.value.trim() ? box.value.trim() + "\n" : "") + r.url;
      }
      toast("อัปโหลดภาพแล้ว");
      inp.value = "";
    }));
    if (setup) setup(form);
    dlg.onclose = () => {
      if (dlg.returnValue !== "ok") return resolve(null);
      const out = {};
      for (const f of fields) {
        const el = form.querySelector(`[name="${f.key}"]`);
        if (!el) continue;
        if (f.type === "checkbox") out[f.key] = el.checked;
        else if (f.type === "number" || f.type === "range") out[f.key] = el.value === "" ? null : Number(el.value);
        else if (f.type === "datetime") out[f.key] = el.value || null;
        else if (f.type === "select" && f.numeric) out[f.key] = el.value === "" ? null : Number(el.value);
        else out[f.key] = el.value;
      }
      resolve(out);
    };
    dlg.returnValue = "";
    dlg.showModal();
  });
}
const confirmBox = async (msg) => !!(await modalForm(msg, [], {}, { submit: "ยืนยัน" }));

function chart(canvas, config) {
  const c = new Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { family: "Anuphan" } } } }, ...(config.options || {}) } });
  S.charts.push(c);
  return c;
}
Chart.defaults.font.family = "Anuphan, Leelawadee UI, sans-serif";
Chart.defaults.color = "#5b6f86";
const C = { blue: "#1d5aa6", glow: "#3cc8f5", hazard: "#ffc93c", ok: "#1f9d63", danger: "#d64545", violet: "#8a63d2", ink: "#0f2740" };

// =========================================================================== เข้าสู่ระบบ/เมนู
async function boot() {
  if (!S.token) return showLogin();
  try { S.user = await call("/api/auth/me"); } catch { return showLogin(); }
  $("login").hidden = true; $("shell").hidden = false;
  $("whoami").innerHTML = `<b>${esc(S.user.display_name || S.user.username)}</b><br><small>${ROLE_TH[S.user.role]}</small>`;
  buildNav();
  S.socket = new LiveSocket("admin", { token: S.token, onMessage: onLive, onStatus: (on) => $("liveDot").classList.toggle("on", on) });
  window.addEventListener("hashchange", route);
  route();
  refreshCounts(); setInterval(refreshCounts, 30000);
}
function showLogin() { $("shell").hidden = true; $("login").hidden = false; $("lUser").focus(); }
function logout() {
  try { localStorage.removeItem("vora.token"); } catch { /* ignore */ }
  S.token = null; if (S.socket) S.socket.close(); location.hash = ""; location.reload();
}
$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  $("lErr").textContent = "";
  try {
    const r = await api("/api/auth/login", { method: "POST", body: { username: $("lUser").value, password: $("lPass").value } });
    S.token = r.token;
    try { localStorage.setItem("vora.token", r.token); } catch { /* ignore */ }
    boot();
  } catch (err) { $("lErr").textContent = err.message; }
};
$("logout").onclick = logout;
$("menuBtn").onclick = () => document.querySelector(".side").classList.toggle("open");
$("stopRobot").onclick = () => run(() => call("/api/robot/stop", { method: "POST" }), "สั่งหยุดหุ่นยนต์แล้ว");

function buildNav() {
  $("nav").innerHTML = NAV.map(([g, items]) => `<div class="nav-group">${g}</div>` + items.map(([k, label, cnt]) =>
    `<a href="#${k}" data-v="${k}">${label}${cnt ? `<span class="count" data-count="${cnt}" hidden></span>` : ""}</a>`).join("")).join("");
}
async function refreshCounts() {
  try {
    const [un, fb] = await Promise.all([call("/api/admin/unanswered?status=new"), call("/api/admin/feedback")]);
    const set = (k, n) => { const el = document.querySelector(`[data-count="${k}"]`); if (el) { el.textContent = n; el.hidden = !n; } };
    set("unanswered", un.length);
    set("feedback", fb.filter((f) => f.status === "new" && (f.kind === "wrong_answer" || f.rating < 0)).length);
    const sb = await call("/api/admin/sandbox/status").catch(() => null);           // 24 พ.ย. 2569: กล่องตรวจข้อมูล
    set("sandbox", sb && sb.enabled ? sb.pending : 0);
    const sc = await call("/api/admin/screens").catch(() => null);                // 25 พ.ย. 2569: จอในวง LAN รออนุมัติ
    set("screens", sc ? sc.screens.filter((x) => x.status === "pending").length : 0);
  } catch { /* ignore */ }
}

async function route() {
  const v = (location.hash || "#dashboard").slice(1);
  S.view = VIEWS[v] ? v : "dashboard";
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.v === S.view));
  document.querySelector(".side").classList.remove("open");
  $("viewTitle").textContent = TITLES[S.view];
  S.charts.forEach((c) => c.destroy()); S.charts = [];
  S.cleanup.forEach((f) => f()); S.cleanup = [];
  S.onRobot = null;
  S.onTrace = null;
  const el = $("view");
  el.innerHTML = '<div class="empty">กำลังโหลด…</div>';
  try { await VIEWS[S.view](el); } catch (e) { el.innerHTML = `<div class="panel"><p class="error">${esc(e.message)}</p></div>`; }
}

function onLive(topic, data) {
  if (topic === "chat.message") {
    S.feed.unshift({ ...data, at: new Date() }); S.feed.length = Math.min(S.feed.length, 40);
    const f = document.getElementById("liveFeed"); if (f) f.innerHTML = feedHtml();
  } else if (topic === "robot.status") {
    S.robot = data; S.onRobot && S.onRobot(data);
  } else if (topic === "robot.event" && S.onRobot) {
    S.onRobotEvent && S.onRobotEvent(data);
  } else if (topic === "ai.trace") {
    S.onTrace && S.onTrace(data);
  } else if (topic === "feedback") refreshCounts();
}
function feedHtml() {
  if (!S.feed.length) return '<div class="empty">ยังไม่มีการสนทนาตั้งแต่เปิดหน้านี้ ลองถามที่หน้าจอหุ่นยนต์ แล้วจะเห็นที่นี่ทันที</div>';
  return S.feed.map((m) => `<div class="feed-item"><div class="q">${esc(m.q)}</div>${m.a ? `<div class="a">${esc(m.a)}</div>` : ""}
    <div class="m"><span>${m.at.toLocaleTimeString("th-TH")}</span><span>${esc(INTENT_TH[m.intent] || m.intent)}</span><span>${m.mode === "voice" ? "เสียง" : m.mode === "vision" ? "กล้อง" : m.mode === "gesture" ? "ท่ามือ" : m.mode === "auto" ? "อัตโนมัติ" : "พิมพ์"}</span>
    <span>${esc(m.channel)}</span>${m.latency_ms != null ? `<span>${m.latency_ms} ms</span>` : ""}${m.answered === false ? badge("pending", "ตอบไม่ได้") : ""}</div></div>`).join("");
}

// =========================================================================== มุมมองต่างๆ
const VIEWS = {};

VIEWS.dashboard = async (el) => {
  const [sys, rep] = await Promise.all([call("/api/admin/system"), call("/api/reports/overview?days=7")]);
  const T = rep.totals;
  const ai = sys.ai, rb = sys.robot;
  el.innerHTML = `
    <div class="kpis">
      <div class="kpi accent"><div class="l">ผู้ใช้งาน 7 วัน</div><div class="v">${T.sessions}</div><div class="s">ทักทายอัตโนมัติ ${T.auto_greetings} ครั้ง</div></div>
      <div class="kpi"><div class="l">คำถามทั้งหมด</div><div class="v">${T.questions}</div><div class="s">เสียง ${T.voice_questions} · กล้อง ${T.vision_interactions} · ท่ามือ ${T.gesture_interactions}</div></div>
      <div class="kpi"><div class="l">ตอบได้จากฐานความรู้</div><div class="v">${pct(T.answer_rate)}</div><div class="s">ตอบไม่ได้ ${T.unanswered} ครั้ง</div></div>
      <div class="kpi"><div class="l">ความพึงพอใจ</div><div class="v">${T.avg_rating ?? "-"}<small style="font-size:1rem">/5</small></div><div class="s">ถูกใจ ${pct(T.satisfaction_thumb)} จาก ${T.thumbs_up + T.thumbs_down} ครั้ง</div></div>
      <div class="kpi"><div class="l">เวลาตอบเฉลี่ย</div><div class="v">${T.avg_latency_ms}<small style="font-size:1rem"> ms</small></div><div class="s">P95 ${T.p95_latency_ms} ms</div></div>
      <div class="kpi"><div class="l">ประกาศอัตโนมัติ</div><div class="v">${T.announcements}</div><div class="s">ชั่วโมงนี้ ${sys.scheduler.announcements_last_hour}/${sys.scheduler.max_per_hour}</div></div>
    </div>
    <div class="grid2">
      <section class="panel"><h2>การสนทนาสด</h2><p class="desc">ทุกคำถามที่หุ่นยนต์ได้รับจะขึ้นที่นี่ทันที พร้อมเจตนาที่ AI เข้าใจและเวลาตอบ</p><div class="feed" id="liveFeed">${feedHtml()}</div></section>
      <section class="panel"><h2>สถานะระบบ</h2><p class="desc">ตรวจความพร้อมก่อนสาธิต ทุกส่วนควรเป็นสีเขียว</p>
        <dl class="stat-list">
          <dt>หน้าจอหุ่นยนต์</dt><dd>${sys.clients.kiosk ? badge("ok", `เปิดอยู่ ${sys.clients.kiosk} จอ`) : badge("error", "ไม่ได้เปิด")} <span class="muted">${esc(sys.kiosk_state.state || "")}</span></dd>
          <dt>หุ่นยนต์</dt><dd>${rb.connected ? badge("ok", "เชื่อมต่อแล้ว") : badge("error", "ไม่ได้เชื่อมต่อ")} <span class="muted">${esc(rb.driver_label)}${rb.battery != null ? ` · แบต ${Math.round(rb.battery)}%` : ""}</span></dd>
          <dt>โมเดลเข้าใจคำถาม</dt><dd>v${ai.intent_model.version} <span class="muted">${ai.intent_model.n_samples} ตัวอย่าง · CV ${pct(ai.intent_model.accuracy)}</span></dd>
          <dt>ฐานความรู้</dt><dd>${ai.retriever.documents} รายการ <span class="muted">ดัชนี v${ai.retriever.version}</span></dd>
          <dt>โมเดลจำป้าย</dt><dd>${ai.vision_model.version ? `v${ai.vision_model.version} <span class="muted">${ai.vision_model.n_samples} ภาพ · ${pct(ai.vision_model.accuracy)}</span>` : '<span class="muted">ยังไม่ได้ฝึก</span>'}</dd>
          <dt>ภาษาธรรมชาติ (LLM)</dt><dd>${ai.llm.enabled ? badge(ai.llm.circuit_open ? "warn" : "ok", ai.llm.circuit_open ? "พักชั่วคราว" : "พร้อม") : badge("draft", "ออฟไลน์")} <span class="muted">${esc(ai.llm.provider)} ${esc(ai.llm.model)}</span></dd>
          <dt>เสียงพูด</dt><dd><span class="muted">รับเสียง: ${esc(sys.speech.stt)} · พูด: ${esc(sys.speech.tts)}</span></dd>
          <dt>ประชาสัมพันธ์อัตโนมัติ</dt><dd>${sys.scheduler.enabled ? badge("ok", "เปิด") : badge("draft", "ปิด")}</dd>
          ${sys.database ? `<dt>ฐานข้อมูล</dt><dd>${sys.database.ok ? badge("ok", "พร้อม") : badge("error", "ขัดข้อง")} <span class="muted">${esc(sys.database.engine === "postgresql" ? "PostgreSQL " + (sys.database.version || "") : (sys.database.version || "SQLite"))}${sys.database.size_mb != null ? " · " + sys.database.size_mb + " MB" : ""}</span></dd>` : ""}
          <dt>ข้อผิดพลาด 24 ชม.</dt><dd>${sys.errors_24h ? badge("error", sys.errors_24h) : badge("ok", "0")}</dd>
          <dt>ระยะเวลาทำงาน</dt><dd>${Math.floor(sys.uptime_s / 3600)} ชม. ${Math.floor((sys.uptime_s % 3600) / 60)} นาที</dd>
        </dl>
      </section>
    </div>
    <div class="grid2">
      <section class="panel"><h2>การใช้งานรายวัน</h2><div class="chart-box"><canvas id="cDaily"></canvas></div></section>
      <section class="panel"><h2>หัวข้อที่ผู้ใช้สนใจ</h2><div class="chart-box"><canvas id="cIntent"></canvas></div></section>
    </div>`;
  const daily = rep.daily.slice(-14);
  chart($("cDaily"), { type: "bar", data: { labels: daily.map((d) => d.date.slice(5)), datasets: [
    { label: "ตอบได้", data: daily.map((d) => d.answered), backgroundColor: C.blue, stack: "a" },
    { label: "ตอบไม่ได้", data: daily.map((d) => d.unanswered), backgroundColor: C.hazard, stack: "a" },
  ] }, options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } } });
  const its = rep.intents.filter((i) => !["greeting", "thanks_bye", "auto_greeting"].includes(i.intent) && !i.intent.startsWith("gesture")).slice(0, 8);
  chart($("cIntent"), { type: "bar", data: { labels: its.map((i) => i.label), datasets: [{ label: "จำนวนครั้ง", data: its.map((i) => i.count), backgroundColor: C.glow }] },
    options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } });
};

// --------------------------------------------------------------------------- ข่าว
const LOCATION_TYPE_TH = { "": "ไม่ระบุสถานที่", campus: "ภายในวิทยาลัย", external: "ภายนอกวิทยาลัย", online: "ออนไลน์" };
// ฟอร์มข่าว: ภายใน/ภายนอกต้องมีชื่อสถานที่ · ออนไลน์ไม่ใช้ลิงก์แผนที่ (ตรวจซ้ำที่ API เสมอ)
function setupLocationFields(form) {
  const t = form.querySelector('[name="location_type"]'), name = form.querySelector('[name="location"]'), map = form.querySelector('[name="location_map_url"]');
  if (!t || !name || !map) return;
  map.type = "url"; map.pattern = "https://.*"; map.placeholder = "https://maps.app.goo.gl/...";
  const sync = () => {
    const v = t.value;
    name.required = v === "campus" || v === "external";
    name.disabled = v === "";
    map.disabled = v === "" || v === "online";
    if (map.disabled) map.value = "";
    if (v === "") name.value = "";
    name.placeholder = v === "online" ? "ไม่บังคับ เช่น Facebook Live เพจวิทยาลัย" : v ? "จำเป็น" : "เลือกประเภทสถานที่ก่อน";
  };
  t.onchange = sync; sync();
}
const fmtLocation = (n) => n.location_type ? `${esc(LOCATION_TYPE_TH[n.location_type] || n.location_type)}${n.location ? ` · ${esc(n.location)}` : ""}` : "ไม่ระบุสถานที่";
const NEWS_FIELDS = [
  { key: "title_th", label: "หัวข้อ (ไทย)", required: true, wide: true },
  { key: "title_en", label: "หัวข้อ (อังกฤษ)", wide: true },
  { key: "body_th", label: "รายละเอียด (ไทย)", type: "textarea", hint: "เขียนให้อ่านออกเสียงได้ลื่น ประโยคสั้น" },
  { key: "body_en", label: "รายละเอียด (อังกฤษ)", type: "textarea" },
  { key: "kind", label: "ประเภท", type: "select", options: KIND_TH },
  { key: "priority", label: "ความสำคัญ (1-5)", type: "number", min: 1, max: 5, default: 3 },
  { key: "publish_at", label: "เริ่มเผยแพร่", type: "datetime" },
  { key: "expire_at", label: "หมดอายุ", type: "datetime" },
  { key: "event_date", label: "วันจัดกิจกรรม", type: "datetime", hint: "ถ้าไม่ทราบเวลา ให้ตั้งเวลา 00:00 ระบบจะแสดงเฉพาะวันที่" },
  { key: "location_type", label: "ประเภทสถานที่", type: "select", options: LOCATION_TYPE_TH },
  { key: "location", label: "ชื่อสถานที่", wide: true, hint: "เช่น หอประชุมวิทยาลัย อาคาร 2 · กิจกรรมออนไลน์ใส่ช่องทางได้ เช่น Facebook Live (ไม่บังคับ)" },
  { key: "location_map_url", label: "ลิงก์แผนที่ (ไม่บังคับ)", wide: true, hint: "ลิงก์ Google Maps ที่ขึ้นต้นด้วย https:// — หน้าจอหุ่นยนต์จะทำเป็น QR นำทาง · ไม่ใช้กับกิจกรรมออนไลน์" },
  { key: "status", label: "สถานะ", type: "select", options: { draft: "ฉบับร่าง", pending: "ส่งรออนุมัติ", published: "เผยแพร่ (เฉพาะผู้ดูแล)", archived: "เก็บถาวร" } },
  { key: "image_url", label: "ภาพประกอบ (ภาพหลัก)", type: "media", accept: "image/*" },
  { key: "gallery", label: "ภาพเพิ่มเติม (หลายภาพ)", type: "gallery", hint: "เลือกได้ทีละหลายไฟล์ หรือวางลิงก์บรรทัดละ 1 ภาพ · สูงสุด 20 ภาพ · แสดงเป็นสไลด์ต่อจากภาพหลักบนหน้าจอหุ่นยนต์" },
  { key: "video_url", label: "วิดีโอ", type: "media", accept: "video/*" },
];
VIEWS.news = async (el) => {
  const filter = VIEWS.news.filter || "";
  const rows = await call(`/api/admin/news${filter ? `?status=${filter}` : ""}`);
  el.innerHTML = `<section class="panel"><div class="row"><div class="tabs grow">${["", "pending", "published", "draft", "archived"].map((s) => `<button data-s="${s}" class="${s === filter ? "on" : ""}">${s ? STATUS_TH[s] : "ทั้งหมด"}</button>`).join("")}</div>
    ${can("editor") ? '<button class="btn primary" id="addNews">เพิ่มข่าว/กิจกรรม</button>' : ""}</div>
    <p class="desc" style="margin-top:12px">ข่าวจะถูกใช้ทั้งประกาศอัตโนมัติและตอบคำถาม เฉพาะข่าวที่ "เผยแพร่แล้ว" และอยู่ในช่วงเวลาเผยแพร่เท่านั้น เจ้าหน้าที่ส่งรออนุมัติ ผู้ดูแลเป็นผู้อนุมัติ</p>
    ${table([["หัวข้อ", (n) => `<b>${esc(n.title_th)}</b><div class="muted">${esc(n.title_en)}</div>`], ["ประเภท", (n) => KIND_TH[n.kind] || n.kind], ["ความสำคัญ", (n) => "★".repeat(n.priority)],
      ["สถานะ", (n) => badge(n.status)], ["วันจัด / สถานที่", (n) => `<span class="muted">${n.event_date ? fmt(n.event_date) : "ไม่ระบุวันที่"}<br>${fmtLocation(n)}</span>`], ["ช่วงเผยแพร่", (n) => `<span class="muted">${fmt(n.publish_at)}<br>ถึง ${fmt(n.expire_at)}</span>`], ["เปิดดู", (n) => n.view_count],
      ["", (n) => `<div class="row">${can("editor") ? `<button class="btn sm" data-edit="${n.id}">แก้ไข</button>` : ""}${can("admin") && n.status === "pending" ? `<button class="btn sm primary" data-pub="${n.id}">อนุมัติ</button>` : ""}${can("admin") ? `<button class="btn sm" data-del="${n.id}">ลบ</button>` : ""}</div>`]], rows)}</section>`;
  el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { VIEWS.news.filter = b.dataset.s; route(); }));
  const save = async (n) => {
    const v = await modalForm(n ? "แก้ไขข่าว" : "เพิ่มข่าว/กิจกรรม", NEWS_FIELDS, n || { status: can("admin") ? "published" : "pending", kind: "news", priority: 3 }, { setup: setupLocationFields });
    if (!v) return;
    if (await run(() => call(n ? `/api/admin/news/${n.id}` : "/api/admin/news", { method: n ? "PUT" : "POST", body: v }), "บันทึกแล้ว")) route();
  };
  $("addNews") && ($("addNews").onclick = () => save(null));
  el.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => save(rows.find((r) => r.id === +b.dataset.edit))));
  el.querySelectorAll("[data-pub]").forEach((b) => (b.onclick = async () => {
    const n = rows.find((r) => r.id === +b.dataset.pub);
    if (await run(() => call(`/api/admin/news/${n.id}`, { method: "PUT", body: { ...n, status: "published" } }), "อนุมัติเผยแพร่แล้ว")) route();
  }));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (await confirmBox("ลบข่าวนี้ถาวร?") && await run(() => call(`/api/admin/news/${b.dataset.del}`, { method: "DELETE" }), "ลบแล้ว")) route();
  }));
};

// --------------------------------------------------------------------------- หลักสูตร
const PROGRAM_FIELDS = [
  { key: "code", label: "รหัสสาขา", required: true }, { key: "level", label: "ระดับ", type: "select", options: { "": "ไม่ระบุ", "ปวช.": "ปวช.", "ปวส.": "ปวส.", "ป.ตรี": "ปริญญาตรี" } },
  { key: "name_th", label: "ชื่อสาขา (ไทย)", required: true }, { key: "name_en", label: "ชื่อสาขา (อังกฤษ)" },
  { key: "department", label: "แผนก/ประเภทวิชา" }, { key: "status", label: "สถานะ", type: "select", options: { draft: "ฉบับร่าง", pending: "รออนุมัติ", published: "เผยแพร่", archived: "เก็บถาวร" } },
  { key: "description_th", label: "เรียนอะไร (ไทย)", type: "textarea" }, { key: "description_en", label: "เรียนอะไร (อังกฤษ)", type: "textarea" },
  { key: "careers_th", label: "อาชีพ/เรียนต่อ (ไทย)", type: "textarea", rows: 2 }, { key: "careers_en", label: "อาชีพ/เรียนต่อ (อังกฤษ)", type: "textarea", rows: 2 },
  { key: "keywords", label: "คำค้นเพิ่มเติม", wide: true, hint: "คั่นด้วยจุลภาค เช่น คอม,เขียนโค้ด,เกม ช่วยให้ AI จับคู่คำถามกับสาขาได้แม่นขึ้น" },
  { key: "suits_th", label: "เหมาะกับใคร (ไทย)", type: "textarea", rows: 2, hint: "แสดงในพรีเซนเทชันสาขาบนหน้าจอหุ่นยนต์" }, { key: "suits_en", label: "เหมาะกับใคร (อังกฤษ)", type: "textarea", rows: 2 },
  { key: "image_url", label: "ภาพหลักของสาขา", type: "media", accept: "image/*" }, { key: "video_url", label: "วิดีโอแนะนำสาขา", type: "media", accept: "video/*" },
  { key: "gallery", label: "ภาพบรรยากาศ (หลายภาพ)", type: "gallery", hint: "เลือกได้ทีละหลายไฟล์ · หรือวางลิงก์บรรทัดละ 1 ภาพ · แสดงเป็นสไลด์ภาพในพรีเซนเทชันสาขา" },
];
VIEWS.programs = async (el) => {
  const rows = await call("/api/admin/programs");
  el.innerHTML = `<section class="panel"><div class="row"><p class="desc grow" style="margin:0">ข้อมูลสาขาใช้ตอบคำถาม แสดงการ์ดบนหน้าจอ และผูกกับป้ายที่กล้องจำได้</p>${can("editor") ? '<button class="btn primary" id="addP">เพิ่มสาขา</button>' : ""}</div><br>
    ${table([["สาขา", (p) => `<b>${esc(p.name_th)}</b><div class="muted">${esc(p.name_en)}</div>`], ["ระดับ", (p) => esc(p.level || "ไม่ระบุ")], ["แผนก", (p) => esc(p.department)],
      ["คำค้น", (p) => `<span class="muted clip">${esc(p.keywords)}</span>`], ["สถานะ", (p) => badge(p.status)], ["เปิดดู", (p) => p.view_count],
      ["", (p) => `<div class="row">${can("editor") ? `<button class="btn sm" data-edit="${p.id}">แก้ไข</button>` : ""}${can("admin") ? `<button class="btn sm" data-del="${p.id}">ลบ</button>` : ""}</div>`]], rows)}</section>`;
  const save = async (p) => {
    const v = await modalForm(p ? "แก้ไขสาขา" : "เพิ่มสาขา", PROGRAM_FIELDS, p || { status: can("admin") ? "published" : "pending", level: "ปวช." });
    if (v && await run(() => call(p ? `/api/admin/programs/${p.id}` : "/api/admin/programs", { method: p ? "PUT" : "POST", body: v }), "บันทึกแล้ว")) route();
  };
  $("addP") && ($("addP").onclick = () => save(null));
  el.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => save(rows.find((r) => r.id === +b.dataset.edit))));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (await confirmBox("ลบสาขานี้?") && await run(() => call(`/api/admin/programs/${b.dataset.del}`, { method: "DELETE" }), "ลบแล้ว")) route();
  }));
};

// --------------------------------------------------------------------------- ฐานความรู้
const KB_FIELDS = [
  { key: "question", label: "คำถามหลัก", required: true, wide: true },
  { key: "alt_questions", label: "คำถามรูปแบบอื่น", type: "textarea", rows: 3, hint: "บรรทัดละ 1 คำถาม ยิ่งหลากหลาย AI ยิ่งค้นเจอแม่น (ใส่ภาษาอังกฤษได้)" },
  { key: "answer_th", label: "คำตอบ (ไทย)", type: "textarea", hint: "ตอบสั้น 1-3 ประโยค เหมาะกับการพูด" },
  { key: "answer_en", label: "คำตอบ (อังกฤษ)", type: "textarea" },
  { key: "category", label: "หมวด", type: "select", options: CATS },
  { key: "status", label: "สถานะ", type: "select", options: { draft: "ฉบับร่าง", pending: "ส่งรออนุมัติ", approved: "อนุมัติใช้งาน (ผู้ดูแล)", rejected: "ไม่อนุมัติ" } },
  { key: "image_url", label: "ภาพประกอบคำตอบ", type: "media", accept: "image/*" },
];
VIEWS.knowledge = async (el) => {
  const filter = VIEWS.knowledge.filter || "";
  const [rows, stats] = await Promise.all([call(`/api/admin/knowledge${filter ? `?status=${filter}` : ""}`), call("/api/admin/knowledge/stats")]);
  el.innerHTML = `
    <div class="kpis">
      <div class="kpi accent"><div class="l">เอกสารในดัชนีค้นคืน</div><div class="v">${stats.index.documents}</div><div class="s">FAQ ${stats.index.by_type.faq || 0} · สาขา ${stats.index.by_type.program || 0} · ข่าว ${stats.index.by_type.news || 0}</div></div>
      <div class="kpi"><div class="l">อนุมัติใช้งาน</div><div class="v">${stats.by_status.approved || 0}</div></div>
      <div class="kpi"><div class="l">รออนุมัติ</div><div class="v">${stats.by_status.pending || 0}</div></div>
      <div class="kpi"><div class="l">คำถามที่ยังตอบไม่ได้</div><div class="v">${stats.unanswered_open}</div><div class="s"><a href="#unanswered">ไปเพิ่มความรู้</a></div></div>
    </div>
    <section class="panel"><h2>ทดลองถาม AI</h2><p class="desc">พิมพ์คำถามเพื่อดูว่า AI เข้าใจเจตนาอะไร ค้นเจอความรู้ข้อไหน คะแนนเท่าไร และจะตอบว่าอะไร (ไม่นับในสถิติ)</p>
      <form class="row" id="testForm"><input class="grow" id="testQ" placeholder="เช่น เรียนไฟฟ้าจบไปทำงานอะไร"><button class="btn primary">ทดลองถาม</button></form><div id="testOut"></div></section>
    <section class="panel"><div class="row"><div class="tabs grow">${["", "pending", "approved", "draft", "rejected"].map((s) => `<button data-s="${s}" class="${s === filter ? "on" : ""}">${s ? STATUS_TH[s] : "ทั้งหมด"}</button>`).join("")}</div>
      ${can("editor") ? `<label class="btn">นำเข้า CSV<input type="file" id="csv" accept=".csv" hidden></label><button class="btn" id="rebuild">สร้างดัชนีใหม่</button><button class="btn primary" id="addKb">เพิ่มความรู้</button>` : ""}</div>
      <p class="desc" style="margin-top:12px">การอัปเดตฐานความรู้ (เพิ่ม/แก้/ลบ แล้วสร้างดัชนีค้นคืนใหม่) แยกจากการฝึกโมเดลเข้าใจคำถาม ความรู้จะถูกใช้ตอบเมื่อ "อนุมัติแล้ว" เท่านั้น ไฟล์ CSV ใช้คอลัมน์ category, question, alt_questions (คั่นด้วย |), answer_th, answer_en</p>
      ${table([["คำถาม", (k) => `<b>${esc(k.question)}</b><div class="muted clip">${esc(k.answer_th)}</div>`], ["หมวด", (k) => CATS[k.category] || k.category],
        ["สถานะ", (k) => badge(k.status)], ["ใช้ตอบ", (k) => k.hit_count], ["ฉบับที่", (k) => k.version], ["ที่มา", (k) => `<span class="muted">${esc(k.source)}<br>${esc(k.created_by)}</span>`],
        ["", (k) => `<div class="row">${can("editor") ? `<button class="btn sm" data-edit="${k.id}">แก้ไข</button>` : ""}${can("admin") && k.status !== "approved" ? `<button class="btn sm primary" data-ok="${k.id}">อนุมัติ</button>` : ""}${can("admin") ? `<button class="btn sm" data-del="${k.id}">ลบ</button>` : ""}</div>`]], rows)}</section>`;
  el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { VIEWS.knowledge.filter = b.dataset.s; route(); }));
  $("testForm").onsubmit = async (e) => {
    e.preventDefault();
    const r = await run(() => call("/api/admin/knowledge/test", { method: "POST", body: { text: $("testQ").value } }));
    if (!r) return;
    $("testOut").innerHTML = `<div class="debug" style="margin-top:12px"><p class="bigq">${esc(r.text)}</p>
      <p>เจตนา: <b>${esc(INTENT_TH[r.intent] || r.intent)}</b> (${pct(r.confidence)}) · ภาษา ${r.lang} · ${r.answered ? badge("ok", "ตอบได้") : badge("pending", "ไม่มีข้อมูล")} · ที่มา ${esc(r.provider)} · ${r.latency_ms} ms</p>
      <p>เจตนาใกล้เคียง: ${r.intent_top.map(([i, p]) => `${esc(INTENT_TH[i] || i)} ${pct(p)}`).join(" · ")}</p>
      ${table([["ผลค้นคืน", (h) => `${esc(h.title)} <span class="muted">${h.type}</span>`], ["คะแนนรวม", (h) => h.score.toFixed(3)], ["คล้ายคำถาม", (h) => h.detail.q], ["คล้ายเนื้อหา", (h) => h.detail.c], ["โบนัส", (h) => `หมวด ${h.detail.cat} · คำสำคัญ ${h.detail.kw}`]], r.retrieval_debug)}
      <p class="muted">เกณฑ์ขั้นต่ำ ${r.threshold} — ถ้าคะแนนสูงสุดต่ำกว่านี้ ระบบจะตอบว่าไม่มีข้อมูลแทนการเดา</p></div>`;
  };
  const save = async (k) => {
    const v = await modalForm(k ? "แก้ไขความรู้" : "เพิ่มความรู้", KB_FIELDS, k || { status: can("admin") ? "approved" : "pending", category: "general" });
    if (v && await run(() => call(k ? `/api/admin/knowledge/${k.id}` : "/api/admin/knowledge", { method: k ? "PUT" : "POST", body: v }), "บันทึกแล้ว")) route();
  };
  $("addKb") && ($("addKb").onclick = () => save(null));
  $("rebuild") && ($("rebuild").onclick = async () => { const r = await run(() => call("/api/admin/knowledge/rebuild", { method: "POST" })); if (r) toast(`สร้างดัชนีใหม่แล้ว ${r.documents} เอกสาร คำศัพท์ ${r.vocabulary}`); });
  $("csv") && ($("csv").onchange = async (e) => {
    const fd = new FormData(); fd.append("file", e.target.files[0]);
    const r = await run(() => call("/api/admin/knowledge/import", { method: "POST", form: fd }));
    if (r) { toast(`นำเข้า ${r.added} รายการ (รออนุมัติ) ข้าม ${r.skipped}`); route(); }
  });
  el.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => save(rows.find((r) => r.id === +b.dataset.edit))));
  el.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = async () => { if (await run(() => call(`/api/admin/knowledge/${b.dataset.ok}/approve`, { method: "POST" }), "อนุมัติแล้ว")) route(); }));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (await confirmBox("ลบความรู้นี้?") && await run(() => call(`/api/admin/knowledge/${b.dataset.del}`, { method: "DELETE" }), "ลบแล้ว")) route(); }));
};

// --------------------------------------------------------------------------- 24 พ.ย. 2569: กล่องตรวจข้อมูล (Sandbox)
// ข้อมูลไม่แน่นอน/เก่า/แหล่งขัดกัน รอเจ้าหน้าที่ตรวจ — ยังไม่ถูกใช้ตอบจนกว่าจะกด "อนุมัตินำเข้า" (ปิดได้: VORA_SANDBOX=0)
VIEWS.sandbox = async (el) => {
  const filter = VIEWS.sandbox.filter ?? "pending";
  const st = await call("/api/admin/sandbox/status");
  if (!st.enabled) { el.innerHTML = `<div class="panel"><p class="desc">กล่องตรวจข้อมูลปิดอยู่ (ตั้ง VORA_SANDBOX=1 ในไฟล์ .env แล้วรีสตาร์ต)</p></div>`; return; }
  const r = await call(`/api/admin/sandbox${filter ? `?status=${filter}` : "?status="}`);
  const ev = VIEWS.sandbox.ev || "";
  const items = r.items.filter((c) => !ev || c.evidence === ev);
  const n = (s) => r.counts[s] || 0;
  el.innerHTML = `
    <div class="kpis">
      <div class="kpi accent"><div class="l">รอตรวจ</div><div class="v">${n("pending")}</div><div class="s">ยังไม่ถูกใช้ตอบ</div></div>
      <div class="kpi"><div class="l">อนุมัตินำเข้าแล้ว</div><div class="v">${n("approved")}</div><div class="s">อยู่ในฐานความรู้ AI แล้ว</div></div>
      <div class="kpi"><div class="l">ปฏิเสธ</div><div class="v">${n("rejected")}</div></div>
    </div>
    <section class="panel"><p class="desc">ข้อมูลที่ยังไม่แน่นอน ข้อมูลเก่า หรือแหล่งที่ขัดกัน จะรออยู่ที่นี่และ<b>ยังไม่ถูกใช้ตอบ</b> เปิดลิงก์แหล่งอ้างอิงตรวจ แล้วกด
      <b>อนุมัตินำเข้า</b> (เลือกตัวเลือกหรือแก้ข้อความก่อนได้) ระบบจะเพิ่มเข้าฐานความรู้ AI และใช้ตอบได้ทันที · กดย้อนกลับได้ภายหลัง</p>
      <div class="row"><div class="tabs grow">${["pending", "approved", "rejected", ""].map((s) => `<button data-s="${s}" class="${s === filter ? "on" : ""}">${s ? SB_STATUS[s] : "ทั้งหมด"}</button>`).join("")}</div>
        <div class="tabs">${["", "A", "B", "C", "U"].map((e) => `<button data-ev="${e}" class="${e === ev ? "on" : ""}">${e ? EVIDENCE_TH[e][0] : "ทุกระดับ"}</button>`).join("")}</div></div></section>
    ${items.length ? items.map((c) => sandboxCard(c, { canApprove: can("admin"), esc, badge, fmt })).join("") : `<div class="empty">ไม่มีรายการ</div>`}`;
  el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { VIEWS.sandbox.filter = b.dataset.s; route(); }));
  el.querySelectorAll("[data-ev]").forEach((b) => (b.onclick = () => { VIEWS.sandbox.ev = b.dataset.ev; route(); }));
  const find = (id) => r.items.find((c) => c.id === +id);
  const chosen = (id) => { const x = el.querySelector(`input[name="ch${id}"]:checked`); return x ? +x.value : null; };
  const done = () => { route(); refreshCounts(); };
  el.querySelectorAll("[data-sb-ok]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.sbOk, ch = chosen(id);
    if (await run(() => call(`/api/admin/sandbox/${id}/approve`, { method: "POST", body: ch == null ? {} : { choice: ch } }), "อนุมัตินำเข้าแล้ว — ใช้ตอบได้ทันที")) done();
  }));
  el.querySelectorAll("[data-sb-edit]").forEach((b) => (b.onclick = async () => {
    const c = find(b.dataset.sbEdit), ch = chosen(c.id);
    const ans = ch != null && c.choices[ch] ? c.choices[ch].answer_th : c.answer_th;
    const v = await modalForm("แก้ไขแล้วอนุมัตินำเข้า", [
      { key: "question", label: "คำถามหลัก", required: true, wide: true },
      { key: "alt_questions", label: "คำถามรูปแบบอื่น (บรรทัดละ 1)", type: "textarea", rows: 3 },
      { key: "category", label: "หมวด", type: "select", options: CATS },
      { key: "answer_th", label: "คำตอบ (ไทย)", type: "textarea", rows: 5, hint: "ข้อมูลเก่า: ถ้ายืนยันแล้วว่ายังถูกต้อง ลบวลีระบุปีออกได้" },
      { key: "answer_en", label: "คำตอบ (อังกฤษ)", type: "textarea", rows: 3 },
      { key: "note", label: "บันทึกการตรวจ", wide: true, hint: "เช่น ยืนยันกับงานทะเบียน 24 พ.ย. 2569" },
    ], { ...c, answer_th: ans, note: "" }, { submit: "อนุมัตินำเข้า" });
    if (v && await run(() => call(`/api/admin/sandbox/${c.id}/approve`, { method: "POST", body: v }), "อนุมัตินำเข้าแล้ว")) done();
  }));
  el.querySelectorAll("[data-sb-no]").forEach((b) => (b.onclick = async () => {
    const v = await modalForm("ปฏิเสธรายการนี้", [{ key: "note", label: "เหตุผล (ไม่บังคับ)", wide: true }], {}, { submit: "ปฏิเสธ" });
    if (v && await run(() => call(`/api/admin/sandbox/${b.dataset.sbNo}/reject`, { method: "POST", body: v }), "ปฏิเสธแล้ว")) done();
  }));
  el.querySelectorAll("[data-sb-reopen]").forEach((b) => (b.onclick = async () => {
    if (await confirmBox("ย้อนกลับมารอตรวจ? (ความรู้ที่นำเข้าจากรายการนี้จะเปลี่ยนเป็นฉบับร่าง ไม่ใช้ตอบ)")
      && await run(() => call(`/api/admin/sandbox/${b.dataset.sbReopen}/reopen`, { method: "POST" }), "ย้อนกลับแล้ว")) done();
  }));
};

// --------------------------------------------------------------------------- 12 พ.ย. 2569: การรับสมัคร (รวมข้อมูลการสมัครไว้ที่เดียว)
const SAMPLE_TAG = "sample-admission-20261112";
const ADM_CATS = ["admission", "tuition", "scholarship"];
const ADM_SETTINGS = [
  { key: "apply_online_url", label: "ลิงก์สมัครเรียนออนไลน์", hint: "หน้าเว็บกรอกใบสมัครออนไลน์ (ทำเป็นคิวอาร์โค้ดในหน้าพาสมัคร)" },
  { key: "apply_steps_th", label: "ขั้นตอนสมัครออนไลน์ (ไทย)", type: "textarea", rows: 7, hint: "บรรทัดละ 1 ขั้น · หุ่นยนต์อ่านทุกขั้นเมื่อถาม \"สมัครเรียนยังไง\" · ว่าง = ไม่แสดงหน้าพาสมัคร" },
  { key: "apply_steps_en", label: "ขั้นตอนสมัครออนไลน์ (อังกฤษ)", type: "textarea", rows: 7, hint: "ว่าง = ใช้ฉบับภาษาไทย" },
  { key: "apply_contact_th", label: "ติดต่อสอบถามการสมัคร (ไทย)", type: "textarea", rows: 2, hint: "สถานที่ วันเวลา เบอร์โทร" },
  { key: "apply_contact_en", label: "ติดต่อสอบถามการสมัคร (อังกฤษ)", type: "textarea", rows: 2 },
  { key: "admission_form_url", label: "ไฟล์ใบสมัครจริง (PDF หรือภาพ)", type: "media", accept: "application/pdf,image/*", hint: "มีไฟล์แล้ว คิวอาร์โค้ดขั้นสุดท้ายของเส้นทางการสมัครจะเปิดไฟล์นี้แทนใบสมัครแบบกรอกด้วยมือ" },
  { key: "admission_form_name", label: "ชื่อไฟล์ใบสมัคร", hint: "เช่น ใบสมัครเข้าศึกษา ปีการศึกษา 2570" },
];

VIEWS.admission = async (el) => {
  const [s, news, kb] = await Promise.all([call("/api/admin/settings"), call("/api/admin/news"), call("/api/admin/knowledge")]);
  const adNews = news.filter((n) => n.kind === "admission");
  const adKb = kb.filter((k) => ADM_CATS.includes(k.category));
  const sample = (x) => x.created_by === SAMPLE_TAG && (x.version || 1) <= 1 && !(x.title_th && !x.title_th.includes("(ตัวอย่าง)"));
  const sTag = '<span class="badge pending">ตัวอย่าง</span>';
  const nSample = adNews.filter(sample).length + adKb.filter(sample).length + (s.admission_sample ? 1 : 0);
  const steps = (s.apply_steps_th || "").split("\n").filter((x) => x.trim());
  el.innerHTML = `
    ${nSample ? `<section class="panel"><p class="desc" style="margin:0">⚠️ มีข้อมูลตัวอย่าง ${nSample} รายการ (ป้าย ${sTag}) ที่หุ่นยนต์ใช้ตอบอยู่ตอนนี้ — กด "แก้ไข" แล้วบันทึกเป็นข้อมูลจริง ป้ายจะหายไปเอง</p></section>` : ""}
    <section class="panel"><div class="row"><h2 class="grow" style="margin:0">ขั้นตอนสมัครออนไลน์และช่องทางติดต่อ ${s.admission_sample ? sTag : ""}</h2>${can("admin") ? '<button class="btn primary" id="editApply">แก้ไข</button>' : ""}</div>
      <p class="desc">ใช้ตอบเมื่อถาม "สมัครเรียนยังไง / สมัครออนไลน์ยังไง" (หน้าจอแสดงทีละขั้นพร้อมคิวอาร์โค้ด) และในขั้นสุดท้ายของเส้นทางการสมัครเรียน</p>
      ${steps.length ? `<ol>${steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : '<p class="muted">ยังไม่ได้กรอกขั้นตอน — หุ่นยนต์จะตอบเรื่องการสมัครจากฐานความรู้แทน</p>'}
      <dl class="stat-list"><dt>ลิงก์สมัครออนไลน์</dt><dd>${esc(s.apply_online_url || "-")}</dd><dt>ติดต่อสอบถาม</dt><dd>${esc(s.apply_contact_th || "-")}</dd>
        <dt>ไฟล์ใบสมัครจริง</dt><dd>${s.admission_form_url ? `<a href="${esc(s.admission_form_url)}" target="_blank" rel="noopener">${esc(s.admission_form_name || s.admission_form_url)}</a>` : "ยังไม่มี (ใช้ใบสมัครแบบกรอกด้วยมือของ VORA)"}</dd></dl></section>
    <section class="panel"><div class="row"><h2 class="grow" style="margin:0">ประกาศรับสมัคร</h2>${can("editor") ? '<button class="btn primary" id="addAdNews">เพิ่มประกาศรับสมัคร</button>' : ""}</div>
      <p class="desc">แสดงในหน้า "การรับสมัคร" ของหุ่นยนต์ และประกาศอัตโนมัติ (เฉพาะที่เผยแพร่แล้วและอยู่ในช่วงเวลา)</p>
      ${table([["หัวข้อ", (n) => `<b>${esc(n.title_th)}</b> ${sample(n) ? sTag : ""}<div class="muted clip">${esc(n.body_th)}</div>`], ["สถานะ", (n) => badge(n.status)],
        ["ช่วงเผยแพร่", (n) => `<span class="muted">${fmt(n.publish_at)}<br>ถึง ${fmt(n.expire_at)}</span>`],
        ["", (n) => (can("editor") ? `<button class="btn sm" data-enews="${n.id}">แก้ไข</button>` : "")]], adNews, "ยังไม่มีประกาศรับสมัคร")}</section>
    <section class="panel"><div class="row"><h2 class="grow" style="margin:0">คำถามที่พบบ่อยเรื่องการสมัคร ค่าใช้จ่าย และทุน</h2>${can("editor") ? '<button class="btn primary" id="addAdKb">เพิ่มคำถาม</button>' : ""}</div>
      <p class="desc">หุ่นยนต์ใช้ตอบเฉพาะรายการที่ "อนุมัติแล้ว" · แก้ไขแล้วระบบสร้างดัชนีค้นคืนใหม่ให้อัตโนมัติ</p>
      ${table([["คำถาม", (k) => `<b>${esc(k.question)}</b> ${sample(k) ? sTag : ""}<div class="muted clip">${esc(k.answer_th)}</div>`], ["หมวด", (k) => CATS[k.category] || k.category],
        ["สถานะ", (k) => badge(k.status)], ["ใช้ตอบ", (k) => k.hit_count],
        ["", (k) => (can("editor") ? `<button class="btn sm" data-ekb="${k.id}">แก้ไข</button>` : "")]], adKb, "ยังไม่มีคำถามเรื่องการสมัคร")}</section>`;
  $("editApply") && ($("editApply").onclick = async () => {
    const v = await modalForm("ขั้นตอนสมัครออนไลน์และช่องทางติดต่อ", ADM_SETTINGS, s);
    if (v && await run(() => call("/api/admin/settings", { method: "PUT", body: { ...v, admission_sample: false } }), "บันทึกแล้ว")) route();
  });
  const saveNews = async (n) => {
    const v = await modalForm(n ? "แก้ไขประกาศรับสมัคร" : "เพิ่มประกาศรับสมัคร", NEWS_FIELDS, n || { status: can("admin") ? "published" : "pending", kind: "admission", priority: 4 }, { setup: setupLocationFields });
    if (v && await run(() => call(n ? `/api/admin/news/${n.id}` : "/api/admin/news", { method: n ? "PUT" : "POST", body: v }), "บันทึกแล้ว")) route();
  };
  const saveKb = async (k) => {
    const v = await modalForm(k ? "แก้ไขคำถาม" : "เพิ่มคำถามเรื่องการสมัคร", KB_FIELDS, k || { status: can("admin") ? "approved" : "pending", category: "admission" });
    if (v && await run(() => call(k ? `/api/admin/knowledge/${k.id}` : "/api/admin/knowledge", { method: k ? "PUT" : "POST", body: v }), "บันทึกแล้ว")) route();
  };
  $("addAdNews") && ($("addAdNews").onclick = () => saveNews(null));
  $("addAdKb") && ($("addAdKb").onclick = () => saveKb(null));
  el.querySelectorAll("[data-enews]").forEach((b) => (b.onclick = () => saveNews(adNews.find((r) => r.id === +b.dataset.enews))));
  el.querySelectorAll("[data-ekb]").forEach((b) => (b.onclick = () => saveKb(adKb.find((r) => r.id === +b.dataset.ekb))));
};

// --------------------------------------------------------------------------- คำถามที่ตอบไม่ได้
VIEWS.unanswered = async (el) => {
  const st = VIEWS.unanswered.filter || "new";
  const [rows, kb] = await Promise.all([call(`/api/admin/unanswered?status=${st}`), call("/api/admin/knowledge?status=approved")]);
  el.innerHTML = `<section class="panel"><div class="row"><div class="tabs grow">${[["new", "รอดำเนินการ"], ["resolved", "แก้ไขแล้ว"], ["ignored", "ข้าม"], ["all", "ทั้งหมด"]].map(([s, l]) => `<button data-s="${s}" class="${s === st ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <p class="desc" style="margin-top:12px">เมื่อระบบไม่มีข้อมูลพอ หุ่นยนต์จะบอกผู้ใช้ตรงๆ แทนการแต่งคำตอบ แล้วเก็บคำถามไว้ที่นี่ เรียงตามจำนวนครั้งที่ถูกถาม เลือกได้ว่าจะเพิ่มเป็นความรู้ใหม่ เพิ่มเป็นคำถามรูปแบบอื่นของความรู้เดิม หรือเพิ่มเป็นตัวอย่างฝึกโมเดล</p>
    ${table([["คำถาม", (u) => `<b>${esc(u.text)}</b>`], ["ถูกถาม", (u) => `${u.count} ครั้ง`], ["คะแนนค้นคืนสูงสุด", (u) => u.best_score], ["ล่าสุด", (u) => `<span class="muted">${fmt(u.last_at)}</span>`], ["สถานะ", (u) => badge(u.status)],
      ["", (u) => u.status === "new" && can("editor") ? `<div class="row"><button class="btn sm primary" data-kb="${u.id}">เพิ่มเป็นความรู้</button><button class="btn sm" data-alt="${u.id}">ผูกกับความรู้เดิม</button><button class="btn sm" data-int="${u.id}">เพิ่มเป็นตัวอย่างฝึก</button><button class="btn sm" data-ign="${u.id}">ข้าม</button></div>` : ""]], rows, "ไม่มีคำถามค้าง ระบบตอบได้ครบ")}</section>`;
  el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { VIEWS.unanswered.filter = b.dataset.s; route(); }));
  const resolve = async (id, body, msg) => { if (await run(() => call(`/api/admin/unanswered/${id}/resolve`, { method: "POST", body }), msg)) { route(); refreshCounts(); } };
  el.querySelectorAll("[data-kb]").forEach((b) => (b.onclick = async () => {
    const u = rows.find((r) => r.id === +b.dataset.kb);
    const v = await modalForm(`เพิ่มความรู้: ${u.text}`, KB_FIELDS.filter((f) => ["answer_th", "answer_en", "category"].includes(f.key)), { category: "general" });
    if (v) resolve(u.id, { action: "knowledge", ...v }, can("admin") ? "เพิ่มความรู้และใช้งานทันที" : "ส่งรออนุมัติแล้ว");
  }));
  el.querySelectorAll("[data-alt]").forEach((b) => (b.onclick = async () => {
    const v = await modalForm("ผูกเป็นคำถามรูปแบบอื่นของความรู้", [{ key: "knowledge_id", label: "เลือกความรู้ที่ตอบคำถามนี้ได้", type: "select", numeric: true, wide: true, options: Object.fromEntries(kb.map((k) => [k.id, k.question])) }]);
    if (v) resolve(+b.dataset.alt, { action: "knowledge", knowledge_id: v.knowledge_id }, "ผูกแล้ว ระบบจะจับคู่คำถามนี้ได้ทันที");
  }));
  el.querySelectorAll("[data-int]").forEach((b) => (b.onclick = async () => {
    const v = await modalForm("เพิ่มเป็นตัวอย่างฝึกโมเดลเข้าใจคำถาม", [{ key: "intent", label: "เจตนาของคำถามนี้", type: "select", wide: true, options: INTENT_TH }]);
    if (v) resolve(+b.dataset.int, { action: "intent", intent: v.intent }, "เพิ่มตัวอย่างแล้ว อย่าลืมกดฝึกโมเดลใหม่");
  }));
  el.querySelectorAll("[data-ign]").forEach((b) => (b.onclick = () => resolve(+b.dataset.ign, { action: "ignore" }, "ข้ามแล้ว")));
};

// --------------------------------------------------------------------------- ฝึกโมเดลเจตนา
VIEWS.training = async (el) => {
  const [data, versions] = await Promise.all([call("/api/admin/intents"), call("/api/admin/models?kind=intent")]);
  const active = versions.find((v) => v.active);
  const m = active ? active.metrics : {};
  el.innerHTML = `
    <section class="panel"><h2>โมเดลเข้าใจเจตนาคำถาม (Intent Classifier)</h2>
      <p class="desc">โมเดลนี้ฝึกจากประโยคตัวอย่างของวิทยาลัยเอง ใช้ TF-IDF ระดับตัวอักษร (เหมาะกับภาษาไทยที่ไม่เว้นวรรค) ร่วมกับ Logistic Regression และวัดผลด้วย Stratified K-Fold Cross Validation ทุกครั้งที่ฝึกจะได้เวอร์ชันใหม่ที่ย้อนกลับได้</p>
      <div class="kpis"><div class="kpi accent"><div class="l">เวอร์ชันที่ใช้งาน</div><div class="v">v${active ? active.version : "-"}</div><div class="s">${active ? fmt(active.created_at) : ""}</div></div>
        <div class="kpi"><div class="l">ความแม่นยำ (CV)</div><div class="v">${pct(m.accuracy)}</div><div class="s">${m.previous_accuracy != null ? `ก่อนหน้า ${pct(m.previous_accuracy)}` : ""}</div></div>
        <div class="kpi"><div class="l">F1 (macro)</div><div class="v">${pct(m.f1_macro)}</div></div>
        <div class="kpi"><div class="l">ตัวอย่างฝึก</div><div class="v">${data.total}</div><div class="s">${Object.keys(data.intents).length} เจตนา</div></div></div>
      <div class="row" style="margin-top:14px">${can("editor") ? '<button class="btn warn" id="retrain">ฝึกโมเดลใหม่ (Retrain)</button>' : ""}<span class="muted" id="trainMsg"></span></div></section>
    <div class="grid2">
      <section class="panel"><h2>พัฒนาการของโมเดล</h2><p class="desc">เปรียบเทียบจำนวนตัวอย่างกับความแม่นยำในแต่ละเวอร์ชัน (หลักฐานการเรียนรู้ซ้ำ)</p><div class="chart-box"><canvas id="cVer"></canvas></div></section>
      <section class="panel"><h2>ประวัติเวอร์ชัน</h2>${table([["เวอร์ชัน", (v) => `v${v.version} ${v.active ? badge("ok", "ใช้งาน") : ""}`], ["ตัวอย่าง", (v) => v.n_samples], ["แม่นยำ", (v) => pct(v.metrics.accuracy)], ["F1", (v) => pct(v.metrics.f1_macro)], ["เวลาฝึก", (v) => `${v.metrics.train_seconds}s`], ["โดย", (v) => `<span class="muted">${esc(v.created_by)}<br>${fmt(v.created_at)}</span>`],
        ["", (v) => !v.active && can("admin") ? `<button class="btn sm" data-act="${v.id}">ใช้เวอร์ชันนี้</button>` : ""]], versions)}</section>
    </div>
    <section class="panel"><h2>ประโยคที่โมเดลยังทายผิด (จากการทดสอบไขว้)</h2><p class="desc">ใช้เป็นแนวทางเพิ่มตัวอย่างให้เจตนาที่สับสนกัน</p>
      ${table([["ประโยค", (e) => esc(e.text)], ["เจตนาจริง", (e) => esc(INTENT_TH[e.expected] || e.expected)], ["โมเดลทาย", (e) => esc(INTENT_TH[e.predicted] || e.predicted)]], m.errors || [], "ไม่มีข้อผิดพลาด")}</section>
    <section class="panel"><h2>ตัวอย่างประโยคแยกตามเจตนา</h2>
      ${can("editor") ? `<form class="row" id="exForm"><input class="grow" id="exText" placeholder="พิมพ์ประโยคตัวอย่าง เช่น อยากเรียนซ่อมมือถือต้องเข้าสาขาไหน"><select id="exIntent">${Object.keys(data.intents).map((k) => `<option value="${k}">${esc(INTENT_TH[k] || k)}</option>`).join("")}</select><button class="btn primary">เพิ่มตัวอย่าง</button></form><br>` : ""}
      <div class="grid2">${Object.entries(data.intents).map(([k, list]) => `<div class="intent-block"><h3><span>${esc(INTENT_TH[k] || k)}</span><span class="muted">${list.length} ประโยค · F1 ${m.per_class && m.per_class[k] ? pct(m.per_class[k]["f1-score"]) : "-"}</span></h3>${list.map((e) => `<span class="ex">${esc(e.text)}${can("editor") ? `<button data-del="${e.id}" aria-label="ลบ">×</button>` : ""}</span>`).join("")}</div>`).join("")}</div></section>`;
  const vs = [...versions].reverse();
  chart($("cVer"), { type: "line", data: { labels: vs.map((v) => `v${v.version}`), datasets: [
    { label: "ความแม่นยำ (%)", data: vs.map((v) => (v.metrics.accuracy || 0) * 100), borderColor: C.blue, backgroundColor: C.blue, yAxisID: "y" },
    { label: "จำนวนตัวอย่าง", data: vs.map((v) => v.n_samples), borderColor: C.hazard, backgroundColor: C.hazard, yAxisID: "y1" },
  ] }, options: { scales: { y: { min: 0, max: 100, position: "left" }, y1: { position: "right", beginAtZero: true, grid: { drawOnChartArea: false } } } } });
  $("retrain") && ($("retrain").onclick = async () => {
    $("retrain").disabled = true; $("trainMsg").textContent = "กำลังฝึกและทดสอบไขว้…";
    const r = await run(() => call("/api/admin/intents/retrain", { method: "POST", body: { notes: "ฝึกจากหลังบ้าน" }, timeout: 120000 }));
    if (r) { toast(`ฝึกเสร็จ v${r.version} ความแม่นยำ ${pct(r.metrics.accuracy)} (เดิม ${pct(r.metrics.previous_accuracy)})`); route(); } else $("retrain").disabled = false;
  });
  $("exForm") && ($("exForm").onsubmit = async (e) => {
    e.preventDefault();
    if (await run(() => call("/api/admin/intents/examples", { method: "POST", body: { text: $("exText").value, intent: $("exIntent").value } }), "เพิ่มแล้ว กดฝึกโมเดลใหม่เพื่อใช้งาน")) route();
  });
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (await run(() => call(`/api/admin/intents/examples/${b.dataset.del}`, { method: "DELETE" }))) b.parentElement.remove(); }));
  el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => { if (await run(() => call(`/api/admin/models/${b.dataset.act}/activate`, { method: "POST" }), "สลับเวอร์ชันแล้ว")) route(); }));
};

// --------------------------------------------------------------------------- สอนกล้องจำป้าย
VIEWS.vision = async (el) => {
  // 24 พ.ย. 2569 (ออกแบบใหม่): ทำตาม 4 ขั้น — ① เพิ่มสิ่งที่จะสอน ② เก็บภาพ ③ ใส่รายละเอียด ④ ฝึกโมเดลแล้วทดสอบ
  // แต่ละรายการเป็นการ์ดบอกว่ายังขาดอะไร และมีปุ่มไปขั้นถัดไป · แท็บ: สิ่งที่รู้จัก / เก็บภาพ / ฝึกโมเดล / ภาพที่ยังไม่รู้จัก
  const MIN_IMG = 10;
  const [classes, versions, programs, news, kinds] = await Promise.all([call("/api/admin/vision/classes"), call("/api/admin/models?kind=vision"),
    call("/api/admin/programs"), call("/api/admin/news"), call("/api/admin/vision/kinds").catch(() => ({ enabled: false, kinds: [] }))]);
  const [items, unknown, covers, imp] = await Promise.all([
    kinds.enabled ? call("/api/admin/vision/items").catch(() => []) : [],
    kinds.unknown_enabled ? call("/api/admin/vision/unknown").catch(() => []) : [],
    Promise.all(classes.map((c) => (c.samples ? call(`/api/admin/vision/samples?label=${encodeURIComponent(c.label)}&limit=1`).catch(() => []) : []))),
    call("/api/admin/vision/import/status").catch(() => ({ enabled: false, pending: [] })),
  ]);
  const pend = new Set(imp.pending || []);
  const isPending = (c) => pend.has(c.id);
  const KIND = Object.fromEntries((kinds.kinds || []).map((k) => [k.kind, k]));
  const TITLE_KEY = { sign: "name", poster: "title", event: "title", object: "name", product: "name" };
  const itemOf = (c) => items.find((i) => i.vision_class_id === c.id);
  const coverOf = (c, i) => { const it = itemOf(c); return (it && (it.images || [])[0]) || ((covers[i] || [])[0] || {}).thumbnail || ""; };
  const isBg = (c) => c.action === "none";
  const active = versions.find((v) => v.active);
  const trainSet = classes.filter((c) => c.samples >= 3 && !isPending(c));   // ตรงกับ retrain_vision: ≥ 3 ภาพ และไม่ใช่รายการรอตรวจ
  const totalImgs = trainSet.reduce((s, c) => s + c.samples, 0);
  const stale = !active || active.n_samples !== totalImgs || active.n_classes !== trainSet.length;
  const content = classes.filter((c) => !isBg(c));
  const enough = content.filter((c) => c.samples >= MIN_IMG).length;
  const withDetail = content.filter((c) => itemOf(c)).length;
  const hasBg = classes.some(isBg);
  const seeText = (c) => {
    const it = itemOf(c);
    if (isBg(c)) return "ไม่ตอบ (เป็นพื้นหลัง)";
    if (it && kinds.enabled) return `แสดงป๊อปอัป${KIND[it.kind] ? ` ${KIND[it.kind].icon} ${KIND[it.kind].label}` : ""}`;
    if (c.action === "program") return `แนะนำสาขา ${(programs.find((p) => p.id === c.target_id) || {}).name_th || "-"}`;
    if (c.action === "news") return `เปิดข่าว ${(news.find((n) => n.id === c.target_id) || {}).title_th || "-"}`;
    return c.response_th ? `พูด: "${c.response_th.slice(0, 40)}${c.response_th.length > 40 ? "…" : ""}"` : "พูดชื่อ";
  };
  const nextOf = (c) => {
    if (isPending(c)) return ["pending", "รอตรวจ — ตรวจรายละเอียดแล้วกดยืนยัน"];
    if (!c.active) return ["off", "ปิดใช้งานอยู่"];
    if (c.samples < MIN_IMG) return ["img", `เก็บภาพเพิ่มอีก ${MIN_IMG - c.samples} ภาพ`];
    if (!isBg(c) && kinds.enabled && !itemOf(c)) return ["detail", "ใส่รายละเอียดเพื่อแสดงป๊อปอัป"];
    if (stale) return ["train", "พร้อม — รอฝึกโมเดล"];
    return ["ok", "ใช้งานได้"];
  };
  const tab = VIEWS.vision.tab || "items";
  const steps = [
    ["1", "เพิ่มสิ่งที่จะสอน", content.length ? `${content.length} รายการ${hasBg ? " + พื้นหลัง" : ""}${pend.size ? ` · รอตรวจ ${pend.size}` : ""}` : "ยังไม่มี", content.length && !pend.size ? "ok" : "todo", "items"],
    ["2", `เก็บภาพ (≥ ${MIN_IMG} ภาพ/รายการ)`, `ครบ ${enough}/${content.length}`, content.length && enough === content.length ? "ok" : "todo", "capture"],
    ["3", "ใส่รายละเอียด (ป๊อปอัป)", kinds.enabled ? `กรอกแล้ว ${withDetail}/${content.length}` : "ปิดอยู่", !kinds.enabled || (content.length && withDetail === content.length) ? "ok" : "todo", "items"],
    ["4", "ฝึกโมเดล แล้วทดสอบ", active ? (stale ? `v${active.version} · มีภาพใหม่ยังไม่ได้ฝึก` : `v${active.version} · ล่าสุดแล้ว`) : "ยังไม่เคยฝึก", active && !stale ? "ok" : "todo", "train"],
  ];
  const firstTodo = steps.findIndex((s) => s[3] !== "ok");
  el.innerHTML = `
    <section class="panel vz-head">
      <h2>สอนหุ่นยนต์ให้รู้จักป้าย โปสเตอร์ กิจกรรม วัตถุ และผลงาน</h2>
      <p class="desc">ทำตาม 4 ขั้นด้านล่าง · ภาพจริงไม่ออกนอกเครื่อง (เก็บเป็นตัวเลขคุณลักษณะภาพ) · ทำเสร็จแล้วรีเฟรชหน้าจอหุ่นยนต์ แล้วชูของให้กล้องดู</p>
      <ol class="vz-steps">${steps.map((s, i) => `<li class="${s[3]}${i === firstTodo ? " now" : ""}" data-go="${s[4]}"><span class="n">${s[3] === "ok" ? "✓" : s[0]}</span>
        <div><b>${esc(s[1])}</b><small>${esc(s[2])}</small></div></li>`).join("")}</ol>
      ${!hasBg ? `<p class="vz-tip">💡 แนะนำเพิ่ม <b>"พื้นหลัง"</b> (ภาพห้อง/คน/โต๊ะ ที่ไม่มีป้าย) เพื่อลดการจำผิด
        ${can("editor") ? `<button class="btn sm" id="vzAddBg">เพิ่มพื้นหลัง</button>` : ""}</p>` : ""}
    </section>
    <div class="tabs vz-tabs">${[["items", `สิ่งที่หุ่นยนต์รู้จัก (${content.length})`], ["capture", "📷 เก็บภาพตัวอย่าง"], ["train", `🧠 ฝึกโมเดล${stale ? " •" : ""}`],
      ...(kinds.unknown_enabled ? [["unknown", `ภาพที่ยังไม่รู้จัก (${unknown.length})`]] : [])].map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="vzBody"></div>`;
  const body = $("vzBody");
  const go = (t, sel) => { VIEWS.vision.tab = t; if (sel) VIEWS.vision.sel = sel; route(); };
  el.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  el.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));

  // ---------------------------------------------------------------- ตั้งค่า / เพิ่ม
  const newLabel = () => `item_${Date.now().toString(36)}`;
  const addItem = async (bg = false) => {
    const v = bg ? { display_name: "พื้นหลัง (ไม่มีป้าย)" } : await modalForm("① เพิ่มสิ่งที่จะสอน", [
      { key: "display_name", label: "ชื่อที่เรียก (เห็นเฉพาะในหลังบ้าน)", required: true, hint: "เช่น ป้ายแผนกไอที · โปสเตอร์ Open House · น้ำพริกอ่อง" },
    ], {}, { submit: "เพิ่ม แล้วไปเก็บภาพ" });
    if (!v) return;
    const r = await run(() => call("/api/admin/vision/classes", { method: "POST", body: { label: bg ? "background" : newLabel(), display_name: v.display_name,
      action: bg ? "none" : "text", active: true } }), bg ? "เพิ่มพื้นหลังแล้ว" : "เพิ่มแล้ว — ต่อไปเก็บภาพ");
    if (r) { const all = await call("/api/admin/vision/classes"); go("capture", (all.find((c) => c.id === r.id) || {}).label); }
  };
  const settings = async (c) => {
    const it = itemOf(c);
    const v = await modalForm(`ตั้งค่า: ${c.display_name || c.label}`, [
      { key: "display_name", label: "ชื่อที่เรียก", required: true },
      { key: "active", label: "เปิดใช้งาน (หุ่นยนต์ตอบเมื่อเห็น)", type: "checkbox" },
      { key: "action", label: it && kinds.enabled ? "เมื่อเห็น (ตอนนี้มีรายละเอียดแล้ว → แสดงป๊อปอัปแทนตัวเลือกนี้)" : "เมื่อเห็นให้หุ่นยนต์",
        type: "select", options: { text: "พูดข้อความที่กำหนด", program: "แนะนำสาขา", news: "เปิดข่าว", none: "ไม่ตอบ (เป็นพื้นหลัง)" } },
      { key: "target_id", label: "สาขาหรือข่าวที่ผูก (ใช้กับ แนะนำสาขา / เปิดข่าว)", type: "select", numeric: true,
        options: { "": "-", ...Object.fromEntries(programs.map((p) => [p.id, `สาขา: ${p.name_th}`])), ...Object.fromEntries(news.map((n) => [n.id, `ข่าว: ${n.title_th}`])) } },
      { key: "response_th", label: "ข้อความที่พูด (ไทย)", type: "textarea", rows: 2 }, { key: "response_en", label: "ข้อความที่พูด (อังกฤษ)", type: "textarea", rows: 2 },
      ...(can("admin") ? [{ key: "remove", label: "ลบรายการนี้และภาพตัวอย่างทั้งหมด", type: "checkbox" }] : []),
    ], c, { submit: "บันทึก" });
    if (!v) return;
    if (v.remove) {
      if (await confirmBox(`ลบ "${c.display_name || c.label}" และภาพตัวอย่าง ${c.samples} ภาพ?`) &&
        await run(() => call(`/api/admin/vision/classes/${c.id}`, { method: "DELETE" }), "ลบแล้ว — อย่าลืมฝึกโมเดลใหม่")) route();
      return;
    }
    delete v.remove;
    if (await run(() => call(`/api/admin/vision/classes/${c.id}`, { method: "PUT", body: { ...v, label: c.label } }), "บันทึกแล้ว")) route();
  };
  const editDetail = async (c) => {
    const it = itemOf(c);
    const kindOpts = Object.fromEntries((kinds.kinds || []).map((k) => [k.kind, `${k.icon} ${k.label}`]));
    const step1 = await modalForm(`③ รายละเอียดของ "${c.display_name || c.label}" — เลือกประเภท`, [
      { key: "kind", label: "สิ่งนี้คืออะไร", type: "select", options: kindOpts, hint: "แต่ละประเภทมีช่องรายละเอียดต่างกัน" },
      ...(it ? [{ key: "remove", label: "ลบรายละเอียดทั้งหมด (กลับไปตอบแบบเดิม)", type: "checkbox" }] : []),
    ], { kind: it ? it.kind : "sign" }, { submit: "ถัดไป" });
    if (!step1) return;
    if (step1.remove) {
      if (await confirmBox("ลบรายละเอียดของรายการนี้?") && await run(() => call(`/api/admin/vision/items/${c.id}`, { method: "DELETE" }), "ลบแล้ว")) route();
      return;
    }
    const k = KIND[step1.kind], same = it && it.kind === step1.kind, linkNews = ["poster", "event"].includes(step1.kind);
    const fields = [
      ...(linkNews ? [{ key: "news_id", label: "ผูกกับข่าว/กิจกรรมที่มีอยู่ (ไม่บังคับ)", type: "select", numeric: true, wide: true,
        options: { "": "- ไม่ผูก -", ...Object.fromEntries(news.map((n) => [n.id, n.title_th])) }, hint: "ผูกแล้ว ช่องที่เว้นว่างจะใช้ หัวข้อ รายละเอียด วันที่ สถานที่ และรูปจากข่าวนั้น" }] : []),
      ...k.fields.map((f) => ({ key: `d_${f.key}`, label: f.label, type: f.type, wide: f.type === "textarea", rows: 3 })),
      { key: "images", label: "รูปสำหรับป๊อปอัป (หลายรูป แสดงเป็นสไลด์)", type: "gallery", hint: "ไม่มีรูป = ใช้รูปจากข่าวที่ผูก หรือภาพตัวอย่างตอนสอนกล้อง" },
    ];
    const init = { news_id: same ? it.news_id : null, images: same ? (it.images || []).join("\n") : "" };
    k.fields.forEach((f) => (init[`d_${f.key}`] = same ? (it.details || {})[f.key] || "" : ""));
    const v = await modalForm(`${k.icon} ${k.label}: ${c.display_name || c.label}`, fields, init, { submit: "บันทึก" });
    if (!v) return;
    const details = Object.fromEntries(k.fields.map((f) => [f.key, v[`d_${f.key}`] || ""]));
    const r = await run(() => call(`/api/admin/vision/items/${c.id}`, { method: "PUT", body: { kind: step1.kind, details,
      images: String(v.images || "").split("\n").map((x) => x.trim()).filter(Boolean), news_id: linkNews ? v.news_id || null : null } }), "บันทึกรายละเอียดแล้ว");
    if (!r) return;
    const pv = await call(`/api/admin/vision/preview/${c.id}`).catch(() => null);
    if (pv) await modalForm(`ตัวอย่าง: หุ่นยนต์จะพูดว่า "${pv.speech}"`, [], {}, { submit: "ตกลง" });
    route();
  };
  $("vzAddBg") && ($("vzAddBg").onclick = () => addItem(true));
  // ---------------------------------------------------------------- นำเข้าทีละมาก (24 พ.ย. 2569) → เข้าเป็น "รอตรวจ"
  let embedderP = null;
  const progress = (txt, frac) => {
    let box = $("vzProg");
    if (!box) { box = document.createElement("div"); box.id = "vzProg"; box.className = "vz-prog"; document.body.appendChild(box); }
    if (txt == null) { box.remove(); return; }
    box.innerHTML = `<b>${esc(txt)}</b><div class="vz-meter big"><i style="width:${Math.round((frac || 0) * 100)}%"></i></div><small>กรุณาอย่าปิดหน้านี้</small>`;
  };
  const runImport = async (list, source) => {
    const MAX_TRAIN_IMG = 4;                                   // รูปที่ใช้สอนต่อรายการ (× ~10 ภาพย่อย)
    const total = list.reduce((s, it) => s + Math.min(MAX_TRAIN_IMG, it.images.filter(trainable).length), 0) * VARIANTS_PER_IMAGE || 1;
    let done = 0, failed = [];
    try {
      if (list.some((it) => it.images.some(trainable))) {
        progress("กำลังโหลดโมเดลกล้อง…", 0);
        embedderP = embedderP || createEmbedder();
        const emb = await embedderP;
        for (const it of list) {
          progress(`กำลังสร้างภาพตัวอย่าง: ${it.display_name}`, done / total);
          const r = await embedImages(emb, embedVector, it.images.filter(trainable).slice(0, MAX_TRAIN_IMG),
            { onStep: () => { done++; if (done % 5 === 0) progress(`กำลังสร้างภาพตัวอย่าง: ${it.display_name}`, done / total); } });
          it.embeddings = r.embeddings; it.thumbnails = r.thumbnails; failed = failed.concat(r.failed);
        }
      }
      let created = 0;
      for (let i = 0; i < list.length; i += 5) {
        progress(`กำลังบันทึก ${Math.min(i + 5, list.length)}/${list.length} รายการ`, 1);
        const r = await call("/api/admin/vision/import/batch", { method: "POST", body: { source, items: list.slice(i, i + 5) }, timeout: 120000 });
        created += r.created.length;
      }
      progress(null);
      toast(`นำเข้า ${created} รายการแล้ว (รอตรวจ)${failed.length ? ` · โหลดรูปไม่ได้ ${failed.length} รูป` : ""}`);
    } catch (e) { progress(null); toast("นำเข้าไม่สำเร็จ: " + e.message, true); }
    VIEWS.vision.tab = "items"; route();
  };
  const importNews = async () => {
    const list = await call("/api/admin/vision/import/news");
    if (!list.length) return toast("ยังไม่มีข่าว/กิจกรรมในระบบ", true);
    const kindOpts = (kinds.kinds || []).filter((k) => ["poster", "event"].includes(k.kind));
    const pick = new Map();
    const v = await modalForm("📰 นำเข้าจากข่าว/กิจกรรม", [], {}, { submit: "นำเข้าที่เลือก (รอตรวจ)", setup: (form) => {
      form.querySelector(".fields").innerHTML = `<div class="f wide"><p class="desc" style="margin:0">ติ๊กข่าวที่มีโปสเตอร์/ภาพกิจกรรมให้กล้องจำ · หัวข้อ วันที่ สถานที่ และรูปดึงจากข่าวอัตโนมัติ
          · รูปแต่ละรูปสร้างภาพตัวอย่าง ~${VARIANTS_PER_IMAGE} แบบ</p>
        <input type="search" id="vzNq" placeholder="ค้นหาข่าว…" style="margin-top:8px"></div>
        <div class="f wide vz-pick" id="vzNlist">${list.map((n) => `<label class="vz-row ${n.imported ? "dim" : ""}" data-q="${esc(n.title_th.toLowerCase())}">
          <input type="checkbox" data-n="${n.id}">
          ${n.images[0] ? `<img src="${esc(n.images[0])}" alt="">` : `<span class="noimg">ไม่มีรูป</span>`}
          <span class="t"><b>${esc(n.title_th)}</b><small>${n.images.length} รูป${n.images.some(trainable) ? "" : " · ใช้สอนกล้องไม่ได้ (ไม่มีรูปในเครื่อง)"}${n.imported ? " · นำเข้าแล้ว" : ""}${n.status !== "published" ? ` · ${esc(n.status)}` : ""}</small></span>
          <select data-k="${n.id}">${kindOpts.map((k) => `<option value="${k.kind}" ${k.kind === n.suggest_kind ? "selected" : ""}>${k.icon} ${esc(k.label)}</option>`).join("")}</select></label>`).join("")}</div>`;
      form.querySelector("#vzNq").oninput = (e) => form.querySelectorAll(".vz-row").forEach((r) => (r.hidden = !r.dataset.q.includes(e.target.value.trim().toLowerCase())));
      const sync = () => { pick.clear(); form.querySelectorAll("[data-n]:checked").forEach((c) => pick.set(+c.dataset.n, form.querySelector(`[data-k="${c.dataset.n}"]`).value)); };
      form.querySelector("#vzNlist").onchange = sync;
    } });
    if (!v || !pick.size) return;
    await runImport([...pick].map(([id, kind]) => newsToItem(list.find((n) => n.id === id), kind)), "news");
  };
  const importExcel = async () => {
    let rows = [];
    const v = await modalForm("📄 นำเข้าจาก Excel", [], {}, { submit: "นำเข้าที่เลือก (รอตรวจ)", setup: (form) => {
      form.querySelector(".fields").innerHTML = `<div class="f wide"><ol class="vz-howto" style="margin:0">
          <li>ดาวน์โหลดแม่แบบ กรอกในแผ่นงานตามประเภท (แถวละ 1 รายการ)</li><li>ช่อง "รูป" ใส่ชื่อไฟล์รูป แล้วบีบอัด Excel + รูปทั้งหมดเป็น <b>.zip</b> (ไม่มีรูป อัปโหลด .xlsx อย่างเดียวได้)</li>
          <li>ตรวจตัวอย่างด้านล่าง แถวสีแดงนำเข้าไม่ได้</li></ol>
        <div class="row" style="margin-top:8px"><button type="button" class="btn" id="vzTpl">⬇️ ดาวน์โหลดแม่แบบ</button>
          <input type="file" id="vzFile" accept=".xlsx,.csv,.zip"></div></div><div class="f wide" id="vzPrev"></div>`;
      form.querySelector("#vzTpl").onclick = async () => {
        const res = await call("/api/admin/vision/import/template", { raw: true });
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a"); a.href = url; a.download = "vora-vision-import-template.xlsx"; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
      form.querySelector("#vzFile").onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const prev = form.querySelector("#vzPrev"); prev.innerHTML = `<p class="muted">กำลังอ่านไฟล์…</p>`;
        const fd = new FormData(); fd.append("file", f);
        const r = await run(() => call("/api/admin/vision/import/parse", { method: "POST", form: fd, timeout: 180000 }));
        if (!r) { prev.innerHTML = ""; return; }
        rows = r.rows;
        prev.innerHTML = rows.length ? `<p class="muted" style="margin:0 0 6px">พบ ${rows.length} แถว · รูปใน zip ${r.images_found} รูป</p>
          <div class="vz-pick">${rows.map((x, i) => { const k = KIND[x.kind] || {}; return `<label class="vz-row ${x.errors.length ? "bad" : ""}">
            <input type="checkbox" data-r="${i}" ${x.errors.length ? "disabled" : "checked"}>
            ${x.images[0] ? `<img src="${esc(x.images[0])}" alt="">` : `<span class="noimg">ไม่มีรูป</span>`}
            <span class="t"><b>${esc(k.icon || "")} ${esc(x.display_name || "(ไม่มีชื่อ)")}</b><small>${esc(x.sheet)} แถว ${x.row} · ${esc(k.label || x.kind)} · ${x.images.length} รูป${x.news_id ? ` · ผูกข่าว #${x.news_id}` : ""}</small>
            ${x.errors.map((m) => `<small class="err">✕ ${esc(m)}</small>`).join("")}${x.warnings.map((m) => `<small class="warn">! ${esc(m)}</small>`).join("")}</span></label>`; }).join("")}</div>`
          : `<p class="muted">ไม่พบแถวข้อมูล (แถว "ตัวอย่าง:" ถูกข้าม)</p>`;
      };
    } });
    if (!v) return;
    const chosen = [...document.querySelectorAll("#modalForm [data-r]:checked")].map((c) => rows[+c.dataset.r]);
    if (!chosen.length) return;
    await runImport(chosen.map((x) => ({ display_name: x.display_name, kind: x.kind, details: x.details, images: x.images, news_id: x.news_id,
      ref: `${x.sheet}:${x.row}` })), "excel");
  };
  const decide = async (ids, ok) => {
    if (!ids.length) return;
    if (!ok && !(await confirmBox(`ไม่ใช้ ${ids.length} รายการ? (ลบรายการ ภาพตัวอย่าง และรายละเอียดที่นำเข้า)`))) return;
    const r = await run(() => call(`/api/admin/vision/import/${ok ? "approve" : "reject"}`, { method: "POST", body: { ids } }));
    if (r) { toast(ok ? `ยืนยัน ${r.approved.length} รายการ — อย่าลืมฝึกโมเดล` : `ลบ ${r.rejected.length} รายการแล้ว`); route(); }
  };

  // ---------------------------------------------------------------- แท็บ: สิ่งที่หุ่นยนต์รู้จัก (การ์ด)
  if (tab === "items") {
    const card = (c) => {
      const i = classes.indexOf(c), it = itemOf(c), [st, hint] = nextOf(c), cover = coverOf(c, i);
      const k = it ? KIND[it.kind] : null;
      const pctImg = Math.min(100, Math.round((c.samples / MIN_IMG) * 100));
      const btn = { img: ["capture", "📷 เก็บภาพ", "primary"], detail: ["detail", "📝 ใส่รายละเอียด", "primary"], train: ["train", "🧠 ไปฝึกโมเดล", "primary"] }[st];
      const pd = isPending(c);
      return `<article class="vz-card ${st}${isBg(c) ? " bg" : ""}">${pd && can("editor") ? `<label class="vz-sel" title="เลือก"><input type="checkbox" data-pick="${c.id}"></label>` : ""}
        <div class="vz-cover">${cover ? `<img src="${esc(cover)}" alt="">` : `<span>${isBg(c) ? "🌫️" : k ? k.icon : "🖼️"}</span>`}
          ${k ? `<em>${k.icon} ${esc(k.label)}</em>` : isBg(c) ? "<em>พื้นหลัง</em>" : ""}${pd ? `<strong class="vz-pend">รอตรวจ</strong>` : ""}</div>
        <div class="vz-main"><h3>${esc((it && (it.details || {})[TITLE_KEY[it.kind]]) || c.display_name || c.label)}</h3>
          ${it && (it.details || {})[TITLE_KEY[it.kind]] && c.display_name ? `<small class="muted">${esc(c.display_name)}</small>` : ""}
          <div class="vz-meter" title="ภาพตัวอย่าง"><i style="width:${pctImg}%" class="${c.samples >= MIN_IMG ? "ok" : ""}"></i></div>
          <small>ภาพตัวอย่าง <b>${c.samples}</b>/${MIN_IMG}+ · เมื่อเห็น: ${esc(seeText(c))}</small>
          <p class="vz-next ${st}">${st === "ok" ? "✓ " : st === "off" ? "⏸ " : "→ "}${esc(hint)}</p>
          ${pd && can("editor") ? `<div class="row vz-btns"><button class="btn sm primary" data-ok="${c.id}">✓ ยืนยัน</button><button class="btn sm" data-no="${c.id}">✕ ไม่ใช้</button></div>` : ""}
          ${can("editor") ? `<div class="row vz-btns">${btn ? `<button class="btn sm ${btn[2]}" data-act="${btn[0]}" data-id="${c.id}">${btn[1]}</button>` : ""}
            ${st !== "img" ? `<button class="btn sm" data-act="capture" data-id="${c.id}">📷 ภาพ</button>` : ""}
            ${!isBg(c) && kinds.enabled && st !== "detail" ? `<button class="btn sm" data-act="detail" data-id="${c.id}">📝 รายละเอียด</button>` : ""}
            <button class="btn sm" data-act="settings" data-id="${c.id}">⚙️ ตั้งค่า</button></div>` : ""}</div></article>`;
    };
    const order = [...classes].sort((a, b) => isPending(b) - isPending(a));
    body.innerHTML = `${can("editor") && imp.enabled ? `<div class="row vz-tools"><button class="btn" id="vzImpNews">📰 นำเข้าจากข่าว/กิจกรรม</button>
        <button class="btn" id="vzImpXls">📄 นำเข้าจาก Excel</button><small class="muted">นำเข้าทีละหลายรายการ → เข้าเป็น "รอตรวจ" ก่อน แล้วค่อยฝึกโมเดล</small></div>` : ""}
      ${pend.size ? `<div class="vz-pendbar"><b>⏳ รอตรวจ ${pend.size} รายการ</b><span>ตรวจชื่อ รายละเอียด และรูป แล้วกดยืนยัน (หุ่นยนต์ยังไม่ใช้จนกว่าจะยืนยัน)</span>
        ${can("editor") ? `<label><input type="checkbox" id="vzAll"> เลือกทั้งหมด</label><button class="btn sm primary" id="vzOkSel">✓ ยืนยันที่เลือก</button><button class="btn sm" id="vzNoSel">✕ ไม่ใช้ที่เลือก</button>` : ""}</div>` : ""}
      <div class="vz-grid">${order.map(card).join("")}
      ${can("editor") ? `<button class="vz-card vz-add" id="vzAdd"><span>＋</span><b>เพิ่มสิ่งที่จะสอน</b><small>ป้าย โปสเตอร์ กิจกรรม วัตถุ หรือผลงาน</small></button>` : ""}</div>`;
    $("vzAdd") && ($("vzAdd").onclick = () => addItem(false));
    $("vzImpNews") && ($("vzImpNews").onclick = importNews);
    $("vzImpXls") && ($("vzImpXls").onclick = importExcel);
    const picked = () => [...body.querySelectorAll("[data-pick]:checked")].map((x) => +x.dataset.pick);
    $("vzAll") && ($("vzAll").onchange = (e) => body.querySelectorAll("[data-pick]").forEach((x) => (x.checked = e.target.checked)));
    $("vzOkSel") && ($("vzOkSel").onclick = () => decide(picked(), true));
    $("vzNoSel") && ($("vzNoSel").onclick = () => decide(picked(), false));
    body.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = () => decide([+b.dataset.ok], true)));
    body.querySelectorAll("[data-no]").forEach((b) => (b.onclick = () => decide([+b.dataset.no], false)));
    body.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => {
      const c = classes.find((x) => x.id === +b.dataset.id);
      if (b.dataset.act === "capture") go("capture", c.label);
      else if (b.dataset.act === "detail") editDetail(c);
      else if (b.dataset.act === "train") go("train");
      else settings(c);
    }));
    return;
  }

  // ---------------------------------------------------------------- แท็บ: เก็บภาพตัวอย่าง
  if (tab === "capture") {
    if (!classes.length) { body.innerHTML = `<div class="panel empty">ยังไม่มีรายการ — กลับไปขั้นที่ ① เพิ่มสิ่งที่จะสอนก่อน</div>`; return; }
    const sel = classes.find((c) => c.label === VIEWS.vision.sel) || classes.find((c) => c.samples < MIN_IMG && c.active) || classes[0];
    body.innerHTML = `<section class="panel"><div class="vz-cap">
      <div><video id="capVideo" muted playsinline></video>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="camOn">เปิดกล้อง</button><span class="muted" id="camMsg">กล้องยังปิดอยู่</span></div></div>
      <div class="vz-capside">
        <label class="f">กำลังเก็บภาพของ<select id="capLabel">${classes.map((c) => `<option value="${esc(c.label)}" ${c === sel ? "selected" : ""}>${esc(c.display_name || c.label)} (${c.samples} ภาพ)</option>`).join("")}</select></label>
        <div class="vz-meter big"><i id="capBar"></i></div><p id="capCount" class="muted"></p>
        <ol class="vz-howto"><li>เปิดกล้อง แล้วถือสิ่งนั้นให้เต็มกรอบ ห่าง 30–80 ซม.</li><li>กด <b>เก็บต่อเนื่อง 15 ภาพ</b> แล้วค่อย ๆ หมุน/เอียง/ขยับเข้า–ออก</li>
          <li>ทำซ้ำในแสงต่างกัน จนได้ <b>${MIN_IMG}+ ภาพ</b> (ยิ่งหลากหลายยิ่งแม่น)</li><li>ครบทุกรายการแล้วไปแท็บ <b>ฝึกโมเดล</b></li></ol>
        <div class="row"><button class="btn primary" id="capBurst" disabled>เก็บต่อเนื่อง 15 ภาพ</button><button class="btn" id="capOne" disabled>เก็บ 1 ภาพ</button>
          <button class="btn" id="toTrain">ไปฝึกโมเดล →</button></div>
        <p class="muted" id="capInfo"></p></div></div>
      <h3 style="margin-top:16px">ภาพที่เก็บแล้ว <small class="muted">(กด × เพื่อลบภาพที่ไม่ชัด/ผิดรายการ)</small></h3><div class="thumbs" id="thumbs"></div></section>`;
    let embedder = null, stream = null;
    const video = $("capVideo");
    S.cleanup.push(() => stream && stream.getTracks().forEach((t) => t.stop()));
    const count = (n) => { $("capBar").style.width = `${Math.min(100, (n / MIN_IMG) * 100)}%`; $("capBar").className = n >= MIN_IMG ? "ok" : "";
      $("capCount").textContent = n >= MIN_IMG ? `✓ ${n} ภาพ — พอใช้แล้ว (เพิ่มได้เพื่อความแม่นยำ)` : `${n}/${MIN_IMG} ภาพ — ต้องเก็บเพิ่มอีก ${MIN_IMG - n} ภาพ`; };
    const loadThumbs = async () => {
      const label = $("capLabel").value;
      VIEWS.vision.sel = label;
      const rows = await call(`/api/admin/vision/samples?label=${encodeURIComponent(label)}`);
      count(rows.length);
      $("thumbs").innerHTML = rows.length ? rows.map((r) => `<figure>${r.thumbnail ? `<img src="${r.thumbnail}" alt="">` : ""}${can("editor") ? `<button data-sdel="${r.id}" aria-label="ลบ">×</button>` : ""}</figure>`).join("")
        : `<p class="muted">ยังไม่มีภาพ</p>`;
      $("thumbs").querySelectorAll("[data-sdel]").forEach((b) => (b.onclick = async () => { await run(() => call(`/api/admin/vision/samples/${b.dataset.sdel}`, { method: "DELETE" })); loadThumbs(); }));
    };
    $("capLabel").onchange = loadThumbs; loadThumbs();
    $("toTrain").onclick = () => go("train");
    $("camOn").onclick = async () => {
      $("camMsg").textContent = "กำลังเปิดกล้องและโหลดโมเดล…";
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        video.srcObject = stream; await video.play();
        embedder = await createEmbedder();
        $("camMsg").textContent = "✓ พร้อมเก็บภาพ";
        $("camOn").hidden = true;
        $("capOne").disabled = $("capBurst").disabled = !can("editor");
      } catch (e) { $("camMsg").textContent = "เปิดกล้องหรือโหลดโมเดลไม่สำเร็จ: " + e.message; }
    };
    const grab = () => {
      const vec = embedVector(embedder, video, performance.now());
      const c = document.createElement("canvas"); c.width = 96; c.height = 72;
      c.getContext("2d").drawImage(video, 0, 0, 96, 72);
      return { vec, thumb: c.toDataURL("image/jpeg", 0.6) };
    };
    const send = async (list) => {
      const r = await run(() => call("/api/admin/vision/samples", { method: "POST", body: { label: $("capLabel").value, embeddings: list.map((i) => i.vec), thumbnails: list.map((i) => i.thumb) } }));
      if (r) { $("capInfo").textContent = `บันทึก ${r.added} ภาพแล้ว`; loadThumbs(); }
    };
    $("capOne").onclick = () => send([grab()]);
    $("capBurst").onclick = async () => {
      const list = [];
      $("capBurst").disabled = true;
      for (let i = 0; i < 15; i++) { list.push(grab()); $("capInfo").textContent = `กำลังเก็บ ${i + 1}/15 — ค่อย ๆ หมุนและขยับ`; await new Promise((r) => setTimeout(r, 220)); }
      await send(list);
      $("capBurst").disabled = false;
    };
    return;
  }

  // ---------------------------------------------------------------- แท็บ: ฝึกโมเดล
  if (tab === "train") {
    const checks = [
      [trainSet.length >= 2, `มีอย่างน้อย 2 รายการที่มีภาพ ≥ 3 ภาพ (ตอนนี้ ${trainSet.length})`],
      [content.every((c) => c.samples >= MIN_IMG), `ทุกรายการมีภาพ ≥ ${MIN_IMG} ภาพ (ครบ ${enough}/${content.length})`],
      [hasBg, "มีรายการ \"พื้นหลัง\" ช่วยลดการจำผิด (แนะนำ)"],
      [!pend.size, pend.size ? `มี ${pend.size} รายการรอตรวจ — จะไม่ถูกนำไปฝึกจนกว่าจะยืนยัน` : "ไม่มีรายการรอตรวจ"],
      [!stale, stale ? `มีภาพ/รายการเปลี่ยนตั้งแต่ฝึกครั้งล่าสุด (ภาพทั้งหมด ${totalImgs} · โมเดลใช้ ${active ? active.n_samples : 0})` : "โมเดลล่าสุดแล้ว"],
    ];
    body.innerHTML = `<div class="grid2"><section class="panel"><h2>④ ฝึกโมเดลจำภาพ</h2>
        <ul class="vz-checks">${checks.map(([ok, t], i) => `<li class="${ok ? "ok" : i === 0 ? "bad" : "warn"}">${ok ? "✓" : i === 0 ? "✕" : "!"} ${esc(t)}</li>`).join("")}</ul>
        <div class="row" style="margin:14px 0">${can("editor") ? `<button class="btn warn" id="vTrain" ${trainSet.length < 2 ? "disabled" : ""}>ฝึกโมเดลจำภาพใหม่</button>` : ""}</div>
        <p class="desc">ฝึกเสร็จแล้ว <b>รีเฟรชหน้าจอหุ่นยนต์</b> แล้วชูของให้กล้องดู (หรือถามว่า "นี่คืออะไร") · ถ้าจำผิด กลับไปเก็บภาพเพิ่มในมุม/แสงที่ผิด แล้วฝึกใหม่</p></section>
      <section class="panel"><h2>โมเดลที่ใช้อยู่</h2>
        <div class="kpis"><div class="kpi accent"><div class="l">เวอร์ชัน</div><div class="v">${active ? `v${active.version}` : "-"}</div></div>
          <div class="kpi"><div class="l">ความแม่นยำ (ทดสอบไขว้)</div><div class="v">${active ? pct(active.metrics.accuracy) : "-"}</div></div></div>
        ${table([["เวอร์ชัน", (v) => `v${v.version} ${v.active ? badge("ok", "ใช้งาน") : ""}`], ["ภาพ", (v) => v.n_samples], ["รายการ", (v) => v.n_classes], ["แม่นยำ", (v) => pct(v.metrics.accuracy)], ["เมื่อ", (v) => fmt(v.created_at)]], versions)}</section></div>`;
    $("vTrain") && ($("vTrain").onclick = async () => {
      $("vTrain").disabled = true; $("vTrain").textContent = "กำลังฝึก…";
      const r = await run(() => call("/api/admin/vision/retrain", { method: "POST", body: {}, timeout: 120000 }));
      if (r) toast(`ฝึกเสร็จ v${r.version} ความแม่นยำ ${pct(r.metrics.accuracy)} — รีเฟรชหน้าจอหุ่นยนต์`);
      route();
    });
    return;
  }

  // ---------------------------------------------------------------- แท็บ: ภาพที่ยังไม่รู้จัก
  body.innerHTML = `<section class="panel"><h2>ภาพที่ผู้ใช้ถามแต่หุ่นยนต์ยังไม่รู้จัก (${unknown.length})</h2>
    <p class="desc">ผู้ใช้ชูของแล้วถามว่า "นี่คืออะไร" แต่กล้องยังไม่รู้จัก ระบบเก็บภาพย่อไว้ในเครื่องนี้เท่านั้น · เลือกรายการแล้วกด <b>เพิ่มเป็นตัวอย่าง</b>
      (ถ้ายังไม่มีรายการ ให้เพิ่มที่แท็บแรกก่อน) จากนั้นไป <b>ฝึกโมเดล</b> · ภาพอาจมีคนอยู่ ลบได้ทันทีเมื่อไม่ใช้</p>
    ${unknown.length ? `<div class="unk-grid">${unknown.map((u) => `<figure class="unk">${u.thumbnail ? `<img src="${esc(u.thumbnail)}" alt="">` : `<div class="empty">ไม่มีภาพ</div>`}
      <figcaption><b>"${esc(u.question || "-")}"</b><span class="muted">${fmt(u.created_at)}${u.best_label ? ` · ใกล้เคียง ${esc((classes.find((c) => c.label === u.best_label) || {}).display_name || u.best_label)} ${pct(u.best_prob)}` : ""}</span>
      ${can("editor") ? `<div class="row"><select data-ul="${u.id}">${classes.map((c) => `<option value="${esc(c.label)}" ${c.label === u.best_label ? "selected" : ""}>${esc(c.display_name || c.label)}</option>`).join("")}</select>
        <button class="btn sm primary" data-uteach="${u.id}" ${u.has_vector ? "" : "disabled title='ภาพนี้ไม่มีเวกเตอร์'"}>เพิ่มเป็นตัวอย่าง</button>
        <button class="btn sm" data-uign="${u.id}">ไม่ใช้</button><button class="btn sm" data-udel="${u.id}">ลบ</button></div>` : ""}</figcaption></figure>`).join("")}</div>`
      : `<div class="empty">ยังไม่มี</div>`}</section>`;
  body.querySelectorAll("[data-uteach]").forEach((b) => (b.onclick = async () => {
    const label = body.querySelector(`[data-ul="${b.dataset.uteach}"]`).value;
    const r = await run(() => call(`/api/admin/vision/unknown/${b.dataset.uteach}/teach`, { method: "POST", body: { label } }));
    if (r) { toast(r.hint); route(); }
  }));
  body.querySelectorAll("[data-uign]").forEach((b) => (b.onclick = async () => { if (await run(() => call(`/api/admin/vision/unknown/${b.dataset.uign}/ignore`, { method: "POST" }), "ซ่อนแล้ว")) route(); }));
  body.querySelectorAll("[data-udel]").forEach((b) => (b.onclick = async () => { if (await run(() => call(`/api/admin/vision/unknown/${b.dataset.udel}`, { method: "DELETE" }), "ลบแล้ว")) route(); }));
};

VIEWS.screens = async (el) => {
  // 25 พ.ย. 2569: จอในวง LAN — เครื่องอื่นเปิดหน้าจอหุ่นยนต์/หลังบ้านผ่านวงแลน · ผู้ดูแลอนุมัติจอก่อนได้สิทธิ์จอแสดงผล
  const d = await call("/api/admin/screens");
  const mq = await call("/api/admin/mobile-qr").catch(() => null);   // 25 พ.ย. 2569: ที่อยู่คิวอาร์มือถือ
  const hs = d.https || {};
  const base = hs.active ? `https://${d.lan_ip}:${hs.port}` : `http://${d.lan_ip}:${d.http_port}`;
  const ST = { pending: ["warn", "รออนุมัติ"], approved: ["ok", "อนุมัติแล้ว"], revoked: ["muted", "ปิดสิทธิ์"] };
  const pending = d.screens.filter((s) => s.status === "pending");
  const ago = (t) => { if (!t) return "-"; const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 1 ? "เมื่อสักครู่" : m < 60 ? `${m} นาทีที่แล้ว` : fmt(t); };
  el.innerHTML = `
    <section class="panel">
      <h2>เปิดใช้จากเครื่องอื่นในวง LAN</h2>
      ${d.enabled ? "" : `<p class="vz-tip">สวิตช์ <code>VORA_LAN_SCREENS=0</code> — จอในวง LAN ใช้งานได้แบบมือถือเท่านั้น</p>`}
      <div class="lan-urls">
        <div><small>หน้าจอหุ่นยนต์ (เครื่องอื่น)</small><b>${esc(base)}/</b><button class="btn sm" data-copy="${esc(base)}/">คัดลอก</button></div>
        <div><small>หลังบ้าน (เครื่องอื่น)</small><b>${esc(base)}/admin/</b><button class="btn sm" data-copy="${esc(base)}/admin/">คัดลอก</button></div>
      </div>
      <ul class="vz-checks">
        <li class="${hs.active ? "ok" : "warn"}">${hs.active ? "✓ https เปิดอยู่ — ไมค์และกล้องบนเครื่องอื่นใช้ได้" : hs.cert ? "! มีใบรับรองแล้ว แต่ยังไม่ได้เปิด https — ปิดแล้วเปิด start.bat ใหม่" : "! ยังไม่มี https — ไมค์/กล้องบนเครื่องอื่นใช้ไม่ได้ · รัน lan_setup.bat (คลิกขวา › Run as administrator) แล้วเปิด start.bat ใหม่"}</li>
        <li>• ครั้งแรกบนแต่ละเครื่อง เบราว์เซอร์จะเตือนเรื่องใบรับรอง ให้กด "ขั้นสูง" › "ดำเนินการต่อ" ครั้งเดียว</li>
        <li>• หลังบ้านจากเครื่องอื่นต้องล็อกอินและแยกสิทธิ์ผู้ใช้เหมือนเดิม · ควรเปลี่ยนรหัสผ่านผู้ดูแลเริ่มต้น</li>
        <li>• ถ้า IP เครื่องหลักเปลี่ยนบ่อย ให้ล็อก IP ที่เราเตอร์ (แล้วรัน lan_setup.bat ใหม่เพื่ออัปเดตใบรับรอง)</li>
      </ul>
    </section>
    ${mq ? `<section class="panel">
      <h2>คิวอาร์สำหรับมือถือ</h2>
      <p class="desc">หน้าจอหุ่นยนต์ขอที่อยู่นี้ใหม่ทุกครั้งที่เปิดคิวอาร์ (และทุก 60 วินาที) — เปลี่ยนเครือข่ายแล้วไม่ต้องรีเฟรช · ระบบข้าม IP ของ VPN ให้เอง</p>
      <div class="lan-urls"><div><small>ตอนนี้คิวอาร์ชี้ไปที่ · ${esc({ env: "ล็อกไว้ใน .env (VORA_PUBLIC_URL)", admin: "ผู้ดูแลล็อกไว้", auto: "เลือกอัตโนมัติ" }[mq.current.source] || "")}</small>
        <b>${esc(mq.current.url)}</b>${mq.current.ok ? badge("ok", "ใช้ได้") : badge("warn", "มือถือเข้าไม่ได้")}</div></div>
      ${mq.current.warning ? `<p class="vz-tip">⚠️ ${esc(mq.current.warning)}</p>` : ""}
      ${can("admin") && !mq.env ? `<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <label>ที่อยู่สำหรับคิวอาร์ <select id="mqSel">
          <option value="">อัตโนมัติ (แนะนำ)</option>
          ${mq.candidates.flatMap((c) => c.urls.map((u) => `<option value="${esc(u)}" ${u === mq.pinned ? "selected" : ""}>${esc(u)} · ${esc({ lan: "วง LAN", vpn: "VPN (มือถือทั่วไปเข้าไม่ได้)", loopback: "เครื่องนี้เท่านั้น", linklocal: "ไม่มีเครือข่าย", other: "อื่น ๆ" }[c.kind] || c.kind)}${c.route ? " · เส้นทางหลัก" : ""}</option>`)).join("")}
          <option value="__custom" ${mq.pinned && !mq.candidates.some((c) => c.urls.includes(mq.pinned)) ? "selected" : ""}>กำหนดเอง…</option>
        </select></label>
        <input id="mqCustom" placeholder="https://192.168.1.20:8443" value="${esc(mq.pinned)}" style="min-width:240px" ${mq.pinned && !mq.candidates.some((c) => c.urls.includes(mq.pinned)) ? "" : "hidden"}>
        <button class="btn primary sm" id="mqSave">บันทึก</button></div>
        <p class="desc">ล็อกไว้เมื่อเครื่องหลักมีหลายวงเครือข่าย · ถ้า IP เปลี่ยนบ่อย แนะนำล็อก IP ที่เราเตอร์ (DHCP reservation) แล้วเลือก "อัตโนมัติ"
          ${hs.active ? "" : "· https ยังไม่เปิด — มือถือจะใช้ไมค์ไม่ได้ (รัน lan_setup.bat แล้วเปิด start.bat ใหม่)"}</p>` : ""}
    </section>` : ""}
    <section class="panel">
      <h2>จอที่ขอเข้าใช้ ${pending.length ? badge("warn", `${pending.length} รออนุมัติ`) : ""}</h2>
      <p class="desc">เปิดหน้าจอหุ่นยนต์จากเครื่องอื่น แล้วจอจะขึ้นรหัส 4 ตัวที่มุมล่างซ้าย — ตรวจว่ารหัสตรงกันแล้วกดอนุมัติ<br>
        จอที่อนุมัติแล้ว: ถาม-ตอบไม่จำกัด รับประกาศ/คำสั่งพูดแบบสด ทักทายและกล้องจำป้ายได้ <b>แต่ไม่สั่งท่า/การเคลื่อนไหวของหุ่นยนต์จริง</b></p>
      ${table([["รหัส", (s) => `<b class="mono">${esc(s.code)}</b>`], ["ชื่อจอ", (s) => esc(s.name)], ["สถานะ", (s) => badge(...(ST[s.status] || ["muted", s.status]))],
        ["IP ล่าสุด", (s) => esc(s.last_ip || "-")], ["ออนไลน์ล่าสุด", (s) => ago(s.last_seen)],
        ["", (s) => can("admin") ? `<div class="row">${s.status !== "approved" ? `<button class="btn sm primary" data-st="approved" data-id="${s.id}">อนุมัติ</button>` : `<button class="btn sm" data-st="revoked" data-id="${s.id}">ปิดสิทธิ์</button>`}
          <button class="btn sm" data-ren="${s.id}">ตั้งชื่อ</button><button class="btn sm" data-del="${s.id}">ลบ</button></div>` : ""]],
        d.screens, "ยังไม่มีจอจากเครื่องอื่น — เปิดที่อยู่ด้านบนบนเครื่องอื่นแล้วกลับมาที่หน้านี้")}
    </section>`;
  if ($("mqSel")) {
    $("mqSel").onchange = () => { $("mqCustom").hidden = $("mqSel").value !== "__custom"; };
    $("mqSave").onclick = async () => {
      const base = $("mqSel").value === "__custom" ? $("mqCustom").value.trim() : $("mqSel").value;
      if (await run(() => call("/api/admin/mobile-qr", { method: "PUT", body: { base } }), "บันทึกแล้ว — หน้าจอหุ่นยนต์ใช้ที่อยู่ใหม่ในครั้งถัดไปที่เปิดคิวอาร์")) route();
    };
  }
  el.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("คัดลอกแล้ว"); } catch { toast(b.dataset.copy); }
  }));
  el.querySelectorAll("[data-st]").forEach((b) => (b.onclick = async () => {
    if (await run(() => call(`/api/admin/screens/${b.dataset.id}`, { method: "PUT", body: { status: b.dataset.st } }), b.dataset.st === "approved" ? "อนุมัติแล้ว — จอนั้นได้สิทธิ์ภายใน ~15 วินาที" : "ปิดสิทธิ์แล้ว")) route();
  }));
  el.querySelectorAll("[data-ren]").forEach((b) => (b.onclick = async () => {
    const s = d.screens.find((x) => x.id === +b.dataset.ren);
    const v = await modalForm(`ตั้งชื่อจอ ${s.code}`, [{ key: "name", label: "ชื่อจอ", required: true, hint: "เช่น จอโถงอาคาร 1 · โน้ตบุ๊กห้องประชาสัมพันธ์" }], s);
    if (v && await run(() => call(`/api/admin/screens/${s.id}`, { method: "PUT", body: { name: v.name } }), "บันทึกแล้ว")) route();
  }));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (await confirmBox("ลบจอนี้? (ถ้าเปิดใหม่จะขออนุมัติใหม่)") && await run(() => call(`/api/admin/screens/${b.dataset.del}`, { method: "DELETE" }), "ลบแล้ว")) route();
  }));
};

VIEWS.schedules = async (el) => {
  const [data, news, routes, progs, sets] = await Promise.all([call("/api/admin/schedules"), call("/api/admin/news?status=published"), call("/api/robot/routes"),
    call("/api/programs").catch(() => []), call("/api/admin/settings").catch(() => ({}))]);
  const st = data.status;
  const NEWS_KIND = { news: "ข่าว", activity: "กิจกรรม", admission: "รับสมัคร" };
  const targetName = (s) => s.action === "announce_news" ? ((news.find((n) => n.id === s.target_id) || {}).title_th || "(ข่าวถูกลบ/ยังไม่เผยแพร่)")
    : s.action === "announce_program" ? ((progs.find((p) => p.id === s.target_id) || {}).name_th || "(ไม่พบสาขา)")
    : s.action === "patrol" ? ((routes.find((r) => r.id === s.target_id) || {}).name || "") : "";
  el.innerHTML = `
    <section class="panel"><h2>ประกาศทันที</h2><p class="desc">พิมพ์ข้อความให้หุ่นยนต์พูดและแสดงบนจอเดี๋ยวนี้ ถ้ามีผู้ใช้กำลังคุยอยู่ จะประกาศต่อเมื่อคุยจบ</p>
      <form class="row" id="annForm"><input class="grow" id="annText" placeholder="เช่น ขอเชิญนักเรียนที่สมัครรอบโควตา มารายงานตัวที่อาคาร 1"><button class="btn primary" ${can("editor") ? "" : "disabled"}>ประกาศ</button></form></section>
    <section class="panel"><div class="row"><h2 class="grow">ตารางประชาสัมพันธ์</h2>
      ${can("admin") ? `<button class="btn" id="toggleSch">${st.enabled ? "ปิดระบบอัตโนมัติ" : "เปิดระบบอัตโนมัติ"}</button>` : ""}${can("editor") ? '<button class="btn primary" id="addSch">เพิ่มตาราง</button>' : ""}</div>
      <p class="desc" style="margin-top:10px">วอร่าพูดประกาศ<b>เฉพาะรายการในตารางนี้</b> · ถ้ามีคนกำลังคุย จะขึ้นเป็นกล่องข้อความเงียบ ๆ ก่อน แล้วประกาศเต็ม (เสียง + ภาพ/วิดีโอกลางจอ) เมื่อคุยจบ (คนเดินออกหรือเงียบ 45 วินาที) · ความสำคัญ 5 ดาว = ด่วน แทรกได้ · ไม่ประกาศเนื้อหาเดิมซ้ำภายใน 10 นาที จำกัด ${st.max_per_hour} ครั้งต่อชั่วโมง และงดเสียงในช่วงเวลาที่ตั้งไว้ (ยกเว้นความสำคัญระดับ 5) ประกาศแล้วชั่วโมงนี้ ${st.announcements_last_hour} ครั้ง</p>
      ${table([["ชื่อ", (s) => `<b>${esc(s.name)}</b>`], ["งาน", (s) => `${esc(ACTION_TH[s.action] || s.action)}${targetName(s) ? `<div class="muted">${esc(targetName(s))}</div>` : ""}`], ["เวลา", (s) => `${s.times ? esc(s.times) : ""}${s.interval_min ? ` ทุก ${s.interval_min} นาที` : ""}<div class="muted">${"จอพฤศส".split("").filter((_, i) => s.days.includes(String(i))).join(" ") || "-"}</div>`],
        ["ความสำคัญ", (s) => "★".repeat(s.priority)], ["สถานะ", (s) => s.active ? badge("ok", "เปิด") : badge("draft", "ปิด")], ["ทำล่าสุด", (s) => `<span class="muted">${fmt(s.last_run_at)}<br>${s.run_count} ครั้ง</span>`],
        ["", (s) => can("editor") ? `<div class="row"><button class="btn sm primary" data-run="${s.id}">ทำทันที</button><button class="btn sm" data-edit="${s.id}">แก้ไข</button><button class="btn sm" data-del="${s.id}">ลบ</button></div>` : ""]], data.items)}</section>
    <section class="panel"><div class="row"><h2 class="grow">ช่วงหน้าจอว่าง (ไม่มีคน)</h2></div>
      <p class="desc">วอร่าไม่พูดเองแล้ว เลือกได้ว่าระหว่างรอประกาศตามตาราง หน้าจอจะ</p>
      <div class="row" id="idleMode">${[["off", "ไม่แสดงอะไรหมุน (ค่าเริ่มต้น)"], ["rotate", "หมุนแสดงภาพข่าวและสาขา (ไม่พูด)"]].map(([v, l]) =>
        `<label class="row" style="gap:6px"><input type="radio" name="idleMode" value="${v}" ${(sets.idle_mode || "off") === v ? "checked" : ""} ${can("admin") ? "" : "disabled"}> ${l}</label>`).join("")}</div>
      ${sets.quiet_hours ? `<p class="desc">ช่วงงดประกาศเสียง: ${esc(sets.quiet_hours)} (แก้ได้ที่ ตั้งค่า)</p>` : ""}</section>
    <section class="panel"><h2>บันทึกการทำงานล่าสุด</h2>${table([["เวลา", (h) => esc(h.at.replace("T", " "))], ["ตาราง", (h) => esc(h.name)], ["ผล", (h) => badge(h.result === "announced" || h.result === "patrol_started" ? "ok" : "warn", { announced: "ประกาศแล้ว", patrol_started: "เริ่มเดิน", quiet_hours: "ช่วงงดเสียง", rate_limited: "เกินโควตา", skipped_busy: "ผู้ใช้คุยนาน ข้าม", no_kiosk: "ไม่ได้เปิดจอ", no_content: "ไม่มีเนื้อหา" }[h.result] || h.result)], ["เนื้อหา", (h) => esc(h.title)]], st.history, "ยังไม่มีการทำงาน")}</section>`;
  const targets = {
    announce_news: Object.fromEntries(news.map((n) => [n.id, `[${NEWS_KIND[n.kind] || "ข่าว"}] ${n.title_th}`])),
    announce_program: Object.fromEntries(progs.map((p) => [p.id, `สาขา${p.name_th}`])),
    patrol: Object.fromEntries(routes.map((r) => [r.id, `เส้นทาง: ${r.name}`])),
  };
  const fields = [
    { key: "name", label: "ชื่อตาราง", required: true, wide: true },
    { key: "action", label: "ประเภทงาน", type: "select", options: ACTION_TH },
    { key: "target_id", label: "เลือกข่าว / สาขา / เส้นทาง", type: "select", numeric: true, options: { "": "-", ...targets.announce_news, ...targets.announce_program, ...targets.patrol } },
    { key: "priority", label: "ความสำคัญ (1-5)", type: "number", min: 1, max: 5, default: 3 },
    { key: "times", label: "เวลา", hint: "เช่น 08:15,12:10" }, { key: "interval_min", label: "หรือทำซ้ำทุกกี่นาที", type: "number", min: 0, default: 0 },
    { key: "days", label: "วัน", hint: "0=จันทร์ ... 6=อาทิตย์ เช่น 01234 = จันทร์-ศุกร์", default: "0123456" },
    { key: "active", label: "เปิดใช้งาน", type: "checkbox", default: true },
    { key: "start_date", label: "เริ่มวันที่", type: "datetime" }, { key: "end_date", label: "สิ้นสุดวันที่", type: "datetime" },
    { key: "text_th", label: "ข้อความประกาศ (ไทย)", type: "textarea", rows: 3, hint: "ข่าว/สาขา: เว้นว่าง = ใช้ข้อความจากข้อมูลต้นทาง" }, { key: "text_en", label: "ข้อความประกาศ (อังกฤษ)", type: "textarea", rows: 2 },
    { key: "media_url", label: "วิดีโอหรือรูปภาพ", type: "media", hint: "ข่าว/สาขา: เว้นว่าง = ใช้ภาพ/วิดีโอของข่าวหรือสาขานั้น" },
  ];
  // ฟอร์มเปิดแล้ว: กรองรายการเป้าหมายตามประเภท + แนะนำสาขา = เติมข้อความจากข้อมูลสาขา (แก้ต่อได้)
  const wireForm = (initial) => {
    const dlg = [...document.querySelectorAll("dialog[open], .modal")].pop() || document;
    const fld = (k) => dlg.querySelector(`[name="${k}"]`) || dlg.querySelector(`#f_${k}`) || dlg.querySelector(`[data-key="${k}"] select, [data-key="${k}"] textarea, [data-key="${k}"] input`);
    const act = fld("action"), tgt = fld("target_id"), th = fld("text_th"), en = fld("text_en");
    if (!act || !tgt) return;
    const wrap = (el) => el.closest("label, .field, .f") || el.parentElement;
    const fill = () => {
      const opts = targets[act.value];
      const keep = tgt.value;
      tgt.innerHTML = `<option value="">${opts ? "— เลือก —" : "-"}</option>` + Object.entries(opts || {}).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
      if (opts && opts[keep] !== undefined) tgt.value = keep;
      wrap(tgt).style.display = opts ? "" : "none";
    };
    act.addEventListener("change", fill);
    tgt.addEventListener("change", async () => {
      if (act.value !== "announce_program" || !tgt.value || !th) return;
      if (th.value.trim() && !(await confirmBox("แทนที่ข้อความประกาศด้วยข้อความที่สร้างจากข้อมูลสาขา?"))) return;
      try { const r = await call(`/api/admin/schedules/program-text/${tgt.value}`); th.value = r.text_th; if (en) en.value = r.text_en; } catch (e) { toast(e.message, true); }
    });
    fill();
    if (initial && initial.target_id != null) tgt.value = String(initial.target_id);
  };
  const save = async (s) => {
    const init = s || { action: "announce_news", priority: 3, days: "0123456", active: true };
    setTimeout(() => wireForm(init), 0);
    const v = await modalForm(s ? "แก้ไขตาราง" : "เพิ่มตารางประชาสัมพันธ์", fields, init);
    if (v && await run(() => call(s ? `/api/admin/schedules/${s.id}` : "/api/admin/schedules", { method: s ? "PUT" : "POST", body: v }), "บันทึกแล้ว")) route();
  };
  $("addSch") && ($("addSch").onclick = () => save(null));
  el.querySelectorAll('[name="idleMode"]').forEach((r) => (r.onchange = async () => {
    if (await run(() => call("/api/admin/settings", { method: "PUT", body: { idle_mode: r.value } }), "บันทึกแล้ว (หน้าจอหุ่นยนต์ใช้ค่าใหม่ภายใน 1 นาที)")) route();
  }));
  $("toggleSch") && ($("toggleSch").onclick = async () => { if (await run(() => call(`/api/admin/scheduler/toggle?enabled=${!st.enabled}`, { method: "POST" }))) route(); });
  $("annForm").onsubmit = async (e) => {
    e.preventDefault();
    const r = await run(() => call("/api/admin/announce", { method: "POST", body: { text_th: $("annText").value } }));
    if (r) { toast(r.kiosks ? `ส่งประกาศไปยัง ${r.kiosks} จอแล้ว` : "ส่งแล้ว แต่ยังไม่มีหน้าจอหุ่นยนต์เปิดอยู่", !r.kiosks); $("annText").value = ""; }
  };
  el.querySelectorAll("[data-run]").forEach((b) => (b.onclick = async () => { const r = await run(() => call(`/api/admin/schedules/${b.dataset.run}/run`, { method: "POST" })); if (r) { toast(r.ok ? "ทำงานแล้ว" : `ไม่ได้ทำ: ${r.history[0] ? r.history[0].result : ""}`, !r.ok); route(); } }));
  el.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => save(data.items.find((s) => s.id === +b.dataset.edit))));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (await confirmBox("ลบตารางนี้?") && await run(() => call(`/api/admin/schedules/${b.dataset.del}`, { method: "DELETE" }), "ลบแล้ว")) route(); }));
};

// --------------------------------------------------------------------------- หุ่นยนต์
VIEWS.robot = async (el) => {
  const [st, caps, routes] = await Promise.all([call("/api/robot/status"), call("/api/robot/capabilities"), call("/api/robot/routes")]);
  S.robot = st;
  const ed = can("editor");
  el.innerHTML = `
    <div class="robot-grid">
      <section class="panel"><div class="row"><h2 class="grow">ตำแหน่งและเซนเซอร์</h2><span class="muted" id="drvLabel"></span></div>
        <p class="desc">${st.driver === "simulator" ? "โหมดหุ่นยนต์จำลอง: ใช้ทดสอบซอฟต์แวร์ก่อนต่อหุ่นจริง พูดโปรโตคอลเดียวกับบอร์ดจริงทุกประการ" : "เชื่อมต่อหุ่นยนต์จริง"} เส้นสีเหลืองคือระยะเซนเซอร์ด้านหน้า</p>
        <canvas class="map" id="map" width="800" height="500"></canvas>
        ${st.driver === "simulator" && ed ? `<div class="row" style="margin-top:10px"><button class="btn" id="simObs">วางสิ่งกีดขวางด้านหน้า</button><button class="btn" id="simClear">เอาสิ่งกีดขวางออก</button><button class="btn" id="simReset">กลับจุดเริ่มต้น</button><button class="btn danger" id="simEstop">กดปุ่มหยุดฉุกเฉินบนหุ่น</button></div>` : ""}</section>
      <section class="panel"><h2>สถานะ</h2><dl class="stat-list" id="rStats"></dl>
        <h2 style="margin-top:18px">บังคับการเคลื่อนที่</h2><p class="desc">ความเร็ว <input type="range" id="spd" min="0.1" max="${caps.limits.max_speed}" step="0.05" value="0.3"> <span id="spdV">0.3</span> · ระยะ <select id="dist"><option>30</option><option selected>60</option><option>100</option><option>150</option></select> ซม.</p>
        <div class="pad"><span></span><button class="btn" data-mv="forward" ${ed ? "" : "disabled"} aria-label="เดินหน้า">▲</button><span></span>
          <button class="btn" data-tn="left" ${ed ? "" : "disabled"} aria-label="เลี้ยวซ้าย">◀</button><button class="btn stop" id="padStop" aria-label="หยุด">■</button><button class="btn" data-tn="right" ${ed ? "" : "disabled"} aria-label="เลี้ยวขวา">▶</button>
          <span></span><button class="btn" data-mv="backward" ${ed ? "" : "disabled"} aria-label="ถอยหลัง">▼</button><span></span></div>
        <h2 style="margin-top:18px">ท่าทาง</h2><div class="gest">${Object.entries(caps.gestures).map(([k, d]) => `<button class="btn sm" data-g="${k}" title="${esc(d)}" ${ed ? "" : "disabled"}>${esc(GESTURE_TH[k] || k)}</button>`).join("")}</div>
      </section>
    </div>
    <div class="grid2">
      <section class="panel"><h2>เส้นทางเดินประชาสัมพันธ์</h2><p class="desc">ลำดับคำสั่งเคลื่อนที่สลับกับจุดประกาศ ระหว่างเดินจะสั่งงานอื่นไม่ได้จนกว่าจะกดหยุด หากเจอสิ่งกีดขวางหุ่นจะหลบเอง ถ้าทางตันจะข้ามขั้นนั้น</p>
        ${table([["ชื่อ", (r) => `<b>${esc(r.name)}</b>`], ["ขั้นตอน", (r) => `${r.steps.length} ขั้น`], ["", (r) => ed ? `<div class="row"><button class="btn sm primary" data-run="${r.id}">เริ่มเดิน</button><button class="btn sm" data-edit="${r.id}">แก้ไข</button></div>` : ""]], routes)}
        ${ed ? '<button class="btn" id="addRoute" style="margin-top:10px">เพิ่มเส้นทาง</button>' : ""}</section>
      <section class="panel"><h2>เหตุการณ์จากหุ่นยนต์</h2><div class="events" id="rEvents"></div></section>
    </div>
    <section class="panel"><h2>การตั้งค่าการเชื่อมต่อ</h2><p class="desc">สัญญาการเชื่อมต่อ VORA Robot Protocol v${caps.protocol}: JSON บรรทัดละ 1 ข้อความผ่าน Serial หรือ WebSocket ซอฟต์แวร์ส่ง heartbeat ทุก 300 ms บอร์ดต้องหยุดเองถ้าไม่ได้รับเกิน ${caps.limits.watchdog_ms} ms ระยะต่อคำสั่งไม่เกิน ${caps.limits.max_distance_cm} ซม. (รายละเอียดใน docs/robot-protocol.md)</p>
      <div class="row">${can("admin") ? `<select id="drv"><option value="simulator">หุ่นยนต์จำลอง</option><option value="serial">Serial (USB)</option><option value="websocket">WebSocket (Wi-Fi)</option></select><button class="btn" id="drvSet">สลับการเชื่อมต่อ</button>
        <button class="btn" id="motion"></button><button class="btn warn" id="reset">ปลดสถานะหยุดฉุกเฉิน</button>` : '<span class="muted">เฉพาะผู้ดูแลระบบ</span>'}</div></section>`;

  const canvas = $("map"), ctx = canvas.getContext("2d");
  const trail = [];
  const draw = (s) => {
    const w = s.world || { room: { w: 800, h: 500 }, obstacles: [], robot_radius: 25 };
    const sx = canvas.width / w.room.w, sy = canvas.height / w.room.h;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#e3eaf3"; ctx.lineWidth = 1;
    for (let x = 0; x <= w.room.w; x += 50) { ctx.beginPath(); ctx.moveTo(x * sx, 0); ctx.lineTo(x * sx, canvas.height); ctx.stroke(); }
    for (let y = 0; y <= w.room.h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y * sy); ctx.lineTo(canvas.width, y * sy); ctx.stroke(); }
    for (const o of w.obstacles) { ctx.fillStyle = o.temp ? "#d64545" : "#9fb3c8"; ctx.fillRect(o.x * sx, o.y * sy, o.w * sx, o.h * sy); }
    if (!s.pose) { ctx.fillStyle = "#5b6f86"; ctx.font = "18px Anuphan"; ctx.fillText("ไม่มีข้อมูลตำแหน่งจากหุ่นยนต์ (หุ่นจริงอาจไม่ส่งตำแหน่ง)", 20, 40); return; }
    const p = s.pose;
    trail.push([p.x, p.y]); if (trail.length > 400) trail.shift();
    ctx.strokeStyle = "rgba(29,90,166,.35)"; ctx.lineWidth = 3; ctx.beginPath();
    trail.forEach(([x, y], i) => (i ? ctx.lineTo(x * sx, y * sy) : ctx.moveTo(x * sx, y * sy))); ctx.stroke();
    const rad = (p.th * Math.PI) / 180, r = w.robot_radius;
    const d = Math.min(300, s.obstacle_cm ?? 300);
    ctx.strokeStyle = d < 45 ? "#d64545" : "#ffc93c"; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.beginPath();
    ctx.moveTo((p.x + Math.cos(rad) * r) * sx, (p.y + Math.sin(rad) * r) * sy); ctx.lineTo((p.x + Math.cos(rad) * (r + d)) * sx, (p.y + Math.sin(rad) * (r + d)) * sy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = s.estop ? "#d64545" : "#1d5aa6"; ctx.beginPath(); ctx.arc(p.x * sx, p.y * sy, r * sx, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(p.x * sx, p.y * sy); ctx.lineTo((p.x + Math.cos(rad) * r) * sx, (p.y + Math.sin(rad) * r) * sy); ctx.stroke();
  };
  const stats = (s) => {
    $("drvLabel").textContent = s.driver_label || "";
    const j = s.joints || {};
    $("rStats").innerHTML = `
      <dt>การเชื่อมต่อ</dt><dd>${s.connected ? badge("ok", "เชื่อมต่อ") : badge("error", "ขาดการเชื่อมต่อ")} ${s.ready ? badge("ok", "พร้อมใช้งาน") : badge("warn", "ไม่พร้อม")}</dd>
      <dt>สถานะ</dt><dd>${esc(s.state || "-")} ${s.estop ? badge("error", "หยุดฉุกเฉิน") : ""} ${s.patrol ? badge("warn", `กำลังเดิน: ${s.patrol}`) : ""}</dd>
      <dt>แบตเตอรี่</dt><dd>${s.battery != null ? `${Math.round(s.battery)}%` : "-"}</dd>
      <dt>ระยะสิ่งกีดขวาง</dt><dd>${s.obstacle_cm != null ? `${Math.round(s.obstacle_cm)} ซม.` : "-"}</dd>
      <dt>หลบสิ่งกีดขวางแล้ว</dt><dd>${s.avoid_count ?? "-"} ครั้ง · เดินรวม ${s.odometer_cm != null ? (s.odometer_cm / 100).toFixed(1) : "-"} ม.</dd>
      <dt>ข้อต่อ</dt><dd class="muted">แขนซ้าย ${j.arm_l ?? "-"}° · แขนขวา ${j.arm_r ?? "-"}° · หัว ${j.head_pan ?? "-"}°/${j.head_tilt ?? "-"}°</dd>
      <dt>การเคลื่อนที่</dt><dd>${s.motion_enabled ? badge("ok", "อนุญาต") : badge("draft", "ปิดไว้")}</dd>
      <dt>คำสั่ง</dt><dd class="muted">ส่ง ${s.stats.sent} · สำเร็จ ${s.stats.done} · ผิดพลาด ${s.stats.errors} · ack ${s.stats.ack_ms_avg} ms · เชื่อมต่อใหม่ ${s.stats.reconnects}</dd>
      <dt>เฟิร์มแวร์</dt><dd class="muted">${esc(s.firmware || "-")}</dd>`;
    if ($("motion")) $("motion").textContent = s.motion_enabled ? "ปิดการเคลื่อนที่" : "เปิดการเคลื่อนที่";
  };
  const events = (list) => {
    $("rEvents").innerHTML = list.map((e) => `<div><span class="muted">${new Date(e.at * 1000).toLocaleTimeString("th-TH")}</span> ${e.name === "log" ? esc(e.message) : `<b>${esc(e.name)}</b>`}</div>`).join("") || '<div class="muted">ยังไม่มีเหตุการณ์</div>';
  };
  let evList = st.events || [];
  draw(st); stats(st); events(evList);
  S.onRobot = (s) => { S.robot = s; draw(s); stats(s); };
  S.onRobotEvent = (e) => { evList = [e, ...evList].slice(0, 60); events(evList); };
  const cmd = (command) => run(() => call("/api/robot/command", { method: "POST", body: { command }, timeout: 60000 }));
  $("spd").oninput = () => ($("spdV").textContent = $("spd").value);
  el.querySelectorAll("[data-mv]").forEach((b) => (b.onclick = () => cmd({ cmd: "move", dir: b.dataset.mv, distance_cm: +$("dist").value, speed: +$("spd").value })));
  el.querySelectorAll("[data-tn]").forEach((b) => (b.onclick = () => cmd({ cmd: "turn", dir: b.dataset.tn, angle: 90, speed: +$("spd").value })));
  el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => cmd({ cmd: "gesture", name: b.dataset.g })));
  $("padStop").onclick = () => run(() => call("/api/robot/stop", { method: "POST" }), "หยุดแล้ว");
  const sim = (p, msg) => run(() => call(`/api/robot/sim/${p}`, { method: "POST" }), msg);
  $("simObs") && ($("simObs").onclick = () => sim("obstacle?distance=90", "วางสิ่งกีดขวางแล้ว ลองสั่งเดินหน้า"));
  $("simClear") && ($("simClear").onclick = () => sim("clear", "เอาออกแล้ว"));
  $("simReset") && ($("simReset").onclick = () => { trail.length = 0; sim("reset", "กลับจุดเริ่มต้นแล้ว"); });
  $("simEstop") && ($("simEstop").onclick = () => sim("estop", "จำลองการกดปุ่มหยุดฉุกเฉินแล้ว"));
  if ($("drv")) {
    $("drv").value = st.driver;
    $("drvSet").onclick = async () => { if (await run(() => call("/api/robot/driver", { method: "POST", body: { driver: $("drv").value } }), "สลับแล้ว กำลังเชื่อมต่อ…")) setTimeout(route, 1500); };
    $("motion").onclick = () => run(() => call("/api/robot/motion", { method: "POST", body: { enabled: !S.robot.motion_enabled } }), "บันทึกแล้ว");
    $("reset").onclick = () => run(() => call("/api/robot/estop-reset", { method: "POST" }), "ปลดสถานะแล้ว");
  }
  el.querySelectorAll("[data-run]").forEach((b) => (b.onclick = () => run(() => call(`/api/robot/routes/${b.dataset.run}/run`, { method: "POST" }), "เริ่มเดินประชาสัมพันธ์")));
  const editRoute = async (r) => {
    const v = await modalForm(r ? "แก้ไขเส้นทาง" : "เพิ่มเส้นทาง", [
      { key: "name", label: "ชื่อเส้นทาง", required: true, wide: true },
      { key: "steps", label: "ขั้นตอน (JSON)", type: "textarea", rows: 14, hint: 'ตัวอย่าง: [{"cmd":"move","dir":"forward","distance_cm":100,"speed":0.3},{"cmd":"turn","dir":"left","angle":90},{"cmd":"gesture","name":"wave"},{"cmd":"say","text_th":"สวัสดีค่ะ"},{"cmd":"wait","seconds":3}]' },
    ], r ? { name: r.name, steps: JSON.stringify(r.steps, null, 1) } : { steps: "[]" });
    if (!v) return;
    let steps;
    try { steps = JSON.parse(v.steps); if (!Array.isArray(steps)) throw new Error(); } catch { return toast("รูปแบบ JSON ไม่ถูกต้อง", true); }
    if (await run(() => call(r ? `/api/robot/routes/${r.id}` : "/api/robot/routes", { method: r ? "PUT" : "POST", body: { name: v.name, steps, active: true } }), "บันทึกแล้ว")) route();
  };
  $("addRoute") && ($("addRoute").onclick = () => editRoute(null));
  el.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => editRoute(routes.find((r) => r.id === +b.dataset.edit))));
};

// --------------------------------------------------------------------------- ผลตอบรับ
VIEWS.feedback = async (el) => {
  const rows = await call("/api/admin/feedback");
  const label = (f) => f.kind === "wrong_answer" ? badge("error", "แจ้งคำตอบผิด") : f.kind === "thumb" ? (f.rating > 0 ? badge("ok", "ถูกใจ") : badge("warn", "ไม่ถูกใจ")) : badge("new", `${f.rating}/5`);
  el.innerHTML = `<section class="panel"><p class="desc">ความคิดเห็นจากปุ่มถูกใจ/ไม่ถูกใจ ท่าชูนิ้วโป้งหน้ากล้อง แบบประเมินบนหน้าจอและมือถือ คำตอบที่ถูกแจ้งว่าผิดควรตรวจแล้วแก้ในฐานความรู้</p>
    ${table([["ประเภท", label], ["คำถาม/คำตอบ", (f) => f.question || f.answer ? `<div><b>${esc(f.question || "")}</b></div><div class="muted clip">${esc(f.answer || "")}</div>` : '<span class="muted">ประเมินทั้งการสนทนา</span>'],
      ["ความคิดเห็น", (f) => esc(f.comment)], ["ช่องทาง", (f) => esc(f.channel)], ["เวลา", (f) => `<span class="muted">${fmt(f.created_at)}</span>`], ["สถานะ", (f) => badge(f.status)],
      ["", (f) => f.status === "new" && can("editor") ? `<button class="btn sm" data-rv="${f.id}">ตรวจแล้ว</button>` : ""]], rows)}</section>`;
  el.querySelectorAll("[data-rv]").forEach((b) => (b.onclick = async () => { if (await run(() => call(`/api/admin/feedback/${b.dataset.rv}/reviewed`, { method: "POST" }))) { route(); refreshCounts(); } }));
};

// --------------------------------------------------------------------------- ชุดทดสอบ
VIEWS.evaluation = async (el) => {
  const [cases, runs] = await Promise.all([call("/api/admin/eval/cases"), call("/api/admin/eval/runs")]);
  el.innerHTML = `
    <section class="panel"><h2>ทดสอบระบบถาม-ตอบอัตโนมัติ</h2><p class="desc">รันคำถามทดสอบทั้งหมดผ่านระบบจริง ตรวจว่าเข้าใจเจตนาถูก ตอบได้หรือบอกว่าไม่มีข้อมูลได้ถูกต้อง และคำตอบมีคำสำคัญที่คาดไว้ ใช้เก็บหลักฐานผลการทดสอบก่อนและหลังปรับปรุงระบบ คำถามทดสอบควรใช้ถ้อยคำต่างจากตัวอย่างที่ใช้ฝึก</p>
      <form class="row" id="runForm"><input class="grow" id="runLabel" placeholder="ชื่อรอบทดสอบ เช่น หลังเพิ่มความรู้เรื่องทุน"><button class="btn warn" ${can("editor") ? "" : "disabled"}>รันชุดทดสอบ</button></form></section>
    <div class="grid2">
      <section class="panel"><h2>ผลการทดสอบแต่ละรอบ</h2><div class="chart-box"><canvas id="cRuns"></canvas></div></section>
      <section class="panel"><h2>ประวัติการทดสอบ</h2>${table([["รอบ", (r) => `<b>${esc(r.label)}</b><div class="muted">${fmt(r.created_at)}</div>`], ["ผ่าน", (r) => `${r.passed}/${r.total}`], ["ตอบถูก", (r) => pct(r.answer_accuracy)], ["เจตนาถูก", (r) => pct(r.intent_accuracy)], ["เวลาเฉลี่ย", (r) => `${r.avg_latency_ms} ms`], ["โมเดล", (r) => `v${r.intent_model_version}`], ["", (r) => `<button class="btn sm" data-d="${r.id}">ดูรายละเอียด</button>`]], runs)}</section>
    </div>
    <section class="panel" id="runDetail" hidden></section>
    <section class="panel"><div class="row"><h2 class="grow">กรณีทดสอบ (${cases.length})</h2>${can("editor") ? '<button class="btn primary" id="addCase">เพิ่มกรณีทดสอบ</button>' : ""}</div><br>
      ${table([["คำถาม", (c) => esc(c.question)], ["เจตนาที่คาด", (c) => esc(INTENT_TH[c.expected_intent] || c.expected_intent || "-")], ["คำที่ต้องมี", (c) => `<span class="muted">${esc(c.expected_keywords)}</span>`], ["ต้องตอบได้", (c) => c.expect_answered ? "ใช่" : "ต้องบอกว่าไม่มีข้อมูล"], ["", (c) => can("editor") ? `<button class="btn sm" data-del="${c.id}">ลบ</button>` : ""]], cases)}</section>`;
  const rs = [...runs].reverse();
  chart($("cRuns"), { type: "line", data: { labels: rs.map((r) => `#${r.id}`), datasets: [
    { label: "ตอบถูก (%)", data: rs.map((r) => r.answer_accuracy * 100), borderColor: C.blue, backgroundColor: C.blue },
    { label: "เข้าใจเจตนาถูก (%)", data: rs.map((r) => r.intent_accuracy * 100), borderColor: C.hazard, backgroundColor: C.hazard },
  ] }, options: { scales: { y: { min: 0, max: 100 } } } });
  $("runForm").onsubmit = async (e) => {
    e.preventDefault();
    const r = await run(() => call("/api/admin/eval/run", { method: "POST", body: { label: $("runLabel").value }, timeout: 180000 }));
    if (r) { toast(`ผ่าน ${r.passed}/${r.total}`); route(); }
  };
  el.querySelectorAll("[data-d]").forEach((b) => (b.onclick = async () => {
    const r = await call(`/api/admin/eval/runs/${b.dataset.d}`);
    const box = $("runDetail"); box.hidden = false;
    box.innerHTML = `<h2>รายละเอียด: ${esc(r.label)}</h2>${table([["ผล", (d) => d.pass ? badge("ok", "ผ่าน") : badge("error", "ไม่ผ่าน")], ["คำถาม", (d) => `<b>${esc(d.question)}</b>`], ["เจตนา", (d) => `${esc(INTENT_TH[d.predicted_intent] || d.predicted_intent)} ${d.intent_ok === false ? badge("warn", `คาด ${INTENT_TH[d.expected_intent] || d.expected_intent}`) : ""}`], ["คำตอบ", (d) => `<span class="muted clip">${esc(d.answer)}</span>`], ["เวลา", (d) => `${d.latency_ms} ms`]], r.details)}`;
    box.scrollIntoView({ behavior: "smooth" });
  }));
  $("addCase") && ($("addCase").onclick = async () => {
    const v = await modalForm("เพิ่มกรณีทดสอบ", [
      { key: "question", label: "คำถาม", required: true, wide: true }, { key: "expected_intent", label: "เจตนาที่คาด", type: "select", options: { "": "-", ...INTENT_TH } },
      { key: "lang", label: "ภาษา", type: "select", options: { th: "ไทย", en: "อังกฤษ" } }, { key: "expected_keywords", label: "คำที่ต้องมีในคำตอบ", hint: "คั่นด้วย | ต้องพบอย่างน้อย 1 คำ", wide: true },
      { key: "expect_answered", label: "ระบบต้องตอบได้ (ไม่ติ๊ก = ต้องบอกว่าไม่มีข้อมูล)", type: "checkbox", default: true, wide: true }]);
    if (v && await run(() => call("/api/admin/eval/cases", { method: "POST", body: v }), "เพิ่มแล้ว")) route();
  });
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (await run(() => call(`/api/admin/eval/cases/${b.dataset.del}`, { method: "DELETE" }))) route(); }));
};

// --------------------------------------------------------------------------- รายงาน
VIEWS.reports = async (el) => {
  const days = VIEWS.reports.days || 30;
  const r = await call(`/api/reports/overview?days=${days}`);
  const T = r.totals;
  el.innerHTML = `
    <section class="panel noprint"><div class="row"><div class="tabs grow">${[7, 30, 90, 365].map((d) => `<button data-d="${d}" class="${d === days ? "on" : ""}">${d} วัน</button>`).join("")}</div>
      <button class="btn" onclick="window.print()">พิมพ์/บันทึก PDF</button><button class="btn primary" id="csvBtn">ดาวน์โหลด CSV</button></div>
      <p class="desc" style="margin-top:10px">ข้อมูลนี้ใช้ประเมินประโยชน์ของระบบ ไม่ควรสรุปว่าภาพลักษณ์อาชีวศึกษาดีขึ้นโดยตรงหากไม่มีการวัดผลที่รองรับ ข้อมูลจากการทดลองในหลังบ้านและชุดทดสอบไม่ถูกนับรวม</p></section>
    <div class="kpis">
      <div class="kpi accent"><div class="l">ผู้ใช้งาน (เซสชัน)</div><div class="v">${T.sessions}</div></div><div class="kpi"><div class="l">คำถาม</div><div class="v">${T.questions}</div></div>
      <div class="kpi"><div class="l">ตอบได้</div><div class="v">${pct(T.answer_rate)}</div><div class="s">${T.answered} / ${T.answered + T.unanswered}</div></div>
      <div class="kpi"><div class="l">คะแนนเฉลี่ย</div><div class="v">${T.avg_rating ?? "-"}</div><div class="s">${T.ratings} คนประเมิน</div></div>
      <div class="kpi"><div class="l">ถูกใจคำตอบ</div><div class="v">${pct(T.satisfaction_thumb)}</div><div class="s">แจ้งคำตอบผิด ${T.wrong_answer_reports}</div></div>
      <div class="kpi"><div class="l">ทักทายอัตโนมัติ</div><div class="v">${T.auto_greetings}</div></div><div class="kpi"><div class="l">ประกาศอัตโนมัติ</div><div class="v">${T.announcements}</div></div>
      <div class="kpi"><div class="l">ข้อผิดพลาดระบบ</div><div class="v">${T.errors}</div></div></div>
    <div class="grid2">
      <section class="panel"><h2>แนวโน้มรายวัน</h2><div class="chart-box"><canvas id="rDaily"></canvas></div></section>
      <section class="panel"><h2>ช่วงเวลาที่มีผู้ใช้</h2><div class="chart-box"><canvas id="rHour"></canvas></div></section>
      <section class="panel"><h2>หัวข้อที่สนใจ</h2><div class="chart-box"><canvas id="rIntent"></canvas></div></section>
      <section class="panel"><h2>ช่องทางการโต้ตอบ</h2><div class="chart-box"><canvas id="rMode"></canvas></div></section>
      <section class="panel"><h2>คะแนนความพึงพอใจ</h2><div class="chart-box"><canvas id="rRate"></canvas></div></section>
      <section class="panel"><h2>ความเสถียรของระบบ</h2>${table([["ส่วน", (x) => esc(x[0])], ["ข้อผิดพลาด", (x) => x[1]], ["คำเตือน", (x) => x[2]]], ["ai", "robot", "speech", "scheduler", "system"].map((k) => [k, r.errors_by_source[k] || 0, r.warnings_by_source[k] || 0]))}
        <h2 style="margin-top:14px">เหตุการณ์หุ่นยนต์</h2>${table([["เหตุการณ์", (x) => esc(x[0])], ["จำนวน", (x) => x[1]]], Object.entries(r.robot_events), "ไม่มีเหตุการณ์")}</section>
    </div>
    <div class="grid3">
      <section class="panel"><h2>คำถามยอดนิยม</h2>${table([["คำถาม", (x) => esc(x.text)], ["ครั้ง", (x) => x.count]], r.top_questions)}</section>
      <section class="panel"><h2>สาขาที่ถูกเปิดดู</h2>${table([["สาขา", (x) => esc(x.name)], ["ครั้ง", (x) => x.views]], r.top_programs)}</section>
      <section class="panel"><h2>ข่าวที่ถูกเปิดดู</h2>${table([["ข่าว", (x) => esc(x.title)], ["ครั้ง", (x) => x.views]], r.top_news)}</section>
    </div>`;
  el.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => { VIEWS.reports.days = +b.dataset.d; route(); }));
  $("csvBtn").onclick = async () => {
    const res = await call(`/api/reports/export.csv?days=${days}`, { raw: true });
    const blob = await res.blob(); const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `vora-report-${days}d.csv`; a.click();
  };
  const daily = r.daily.slice(-Math.min(days, 60));
  chart($("rDaily"), { type: "line", data: { labels: daily.map((d) => d.date.slice(5)), datasets: [
    { label: "ผู้ใช้", data: daily.map((d) => d.sessions), borderColor: C.blue, backgroundColor: C.blue },
    { label: "คำถาม", data: daily.map((d) => d.questions), borderColor: C.glow, backgroundColor: C.glow },
    { label: "ตอบไม่ได้", data: daily.map((d) => d.unanswered), borderColor: C.hazard, backgroundColor: C.hazard }] }, options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  chart($("rHour"), { type: "bar", data: { labels: r.hourly.map((_, i) => `${i}:00`), datasets: [{ label: "คำถาม", data: r.hourly, backgroundColor: C.blue }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  const its = r.intents.filter((i) => !i.intent.startsWith("gesture")).slice(0, 10);
  chart($("rIntent"), { type: "bar", data: { labels: its.map((i) => i.label), datasets: [{ label: "ครั้ง", data: its.map((i) => i.count), backgroundColor: C.glow }] }, options: { indexAxis: "y", plugins: { legend: { display: false } } } });
  const MODE = { voice: "เสียง", text: "พิมพ์", vision: "ชูป้ายหน้ากล้อง", gesture: "ท่ามือ" };
  const modes = Object.entries(r.input_modes);
  chart($("rMode"), { type: "bar", data: { labels: modes.map(([k]) => MODE[k] || k), datasets: [{ label: "ครั้ง", data: modes.map(([, v]) => v), backgroundColor: [C.blue, C.glow, C.hazard, C.violet, C.ok] }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  chart($("rRate"), { type: "bar", data: { labels: ["1", "2", "3", "4", "5"], datasets: [{ label: "จำนวนผู้ประเมิน", data: [1, 2, 3, 4, 5].map((i) => r.rating_distribution[i] || 0), backgroundColor: C.hazard }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
};

// --------------------------------------------------------------------------- งาน F: สาธิตไม่สะดุด (ทนเน็ตล่ม) · 21 พ.ย. 2569
// เตรียมเสียงคำตอบที่ตายตัวเก็บไว้ในเครื่อง (ไม่ต้องอัดเสียงเอง) + จำลองเน็ตล่มเพื่อซ้อม · รายละเอียด: docs/feature-F-offline-resilience.md
const PRE = { plan: [], running: false, stop: false };
// =========================================================================== งาน A "สมองโปร่งใส" (21 พ.ย. 2569)
// แสดงขั้นตอนการตัดสินใจของคำถามล่าสุดแบบสด: เข้าใจคำถาม → ค้นฐานความรู้ → AI เรียบเรียง → Answer Guard 9 ข้อ → ป้ายแหล่งที่มา
VIEWS.brain = async (el) => {
  const data = await call("/api/admin/brain/recent?n=20");
  let items = data.items || [], sel = 0;
  el.innerHTML = `
    <section class="panel brain" id="brainPanel">
      <div class="brain-head">
        <div><h2>สมองโปร่งใส</h2>
          <p class="desc">ทุกคำถามที่หน้าจอหุ่นยนต์ จะแสดงที่นี่ทันทีว่า VORA คิดอย่างไร: เข้าใจว่าถามเรื่องอะไร ค้นข้อมูลจริงจากไหน
            ให้ AI เรียบเรียงหรือไม่ และ <b>Answer Guard 9 ข้อ</b> ตรวจว่า AI ไม่แต่งตัวเลข วันที่ ชื่อ หรือข้อมูลติดต่อขึ้นเอง ก่อนคำตอบจะถึงผู้ใช้
            · ไม่มีคำสั่งระบบหรือรหัสลับแสดงที่นี่ · เบอร์โทร/อีเมลในคำถามถูกปิดไว้</p></div>
        <div class="brain-tools"><span class="live-tag" id="brainLive">● สด</span>
          <button class="btn" id="brainFull">เต็มจอ</button></div>
      </div>
      ${data.enabled ? "" : '<p class="error">ปิดการแสดงอยู่ (VORA_BRAIN_TRACE=0) — เปิดใน .env แล้วรีสตาร์ต</p>'}
      <div id="brainMain"></div>
      <h3 class="brain-sub">คำถามล่าสุด</h3>
      <div id="brainHist" class="brain-hist"></div>
    </section>`;
  const stageHtml = (st, i) => `
    <div class="bstage ${st.state}" style="--d:${i * 0.35}s">
      <div class="bnum">${i + 1}</div>
      <div class="btitle">${esc(st.title)}</div>
      <div class="bhead">${esc(st.headline)}</div>
      ${st.board ? `<div class="gboard">${st.board.map((g) => `<span class="g ${g.state}" title="${esc(g.label)}">${g.id}<small>${esc(g.label)}</small></span>`).join("")}</div>` : ""}
      ${st.lines.length ? `<ul>${st.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
    </div>`;
  const render = (animate) => {
    const t = items[sel];
    const main = $("brainMain");
    if (!main) return;
    if (!t) { main.innerHTML = '<div class="empty">ยังไม่มีคำถาม ลองถาม VORA ที่หน้าจอหุ่นยนต์ แล้วดูขั้นตอนการคิดที่นี่</div>'; }
    else {
      const stages = describeTrace(t, INTENT_TH);
      const r = t.result || {};
      main.innerHTML = `
        <div class="bq"><span class="muted">${esc(new Date(t.at).toLocaleTimeString("th-TH"))} · ${t.input_mode === "voice" ? "เสียง" : "พิมพ์"} · ${esc(t.lang || "th")}</span>
          <div class="bqtext">“${esc(t.question)}”</div></div>
        <div class="bflow ${animate ? "anim" : ""}">${stages.map(stageHtml).join('<div class="barrow">→</div>')}</div>
        <div class="banswer ${r.answered ? "" : "no"}" style="--d:${animate ? stages.length * 0.35 : 0}s">
          <div class="muted">คำตอบที่ VORA พูด · ${badge(r.answered ? "ok" : "warn", BRAIN_SRC[r.answer_source] || r.answer_source || "-")}</div>
          <div>${esc(t.answer || "")}</div></div>`;
    }
    $("brainHist").innerHTML = items.length ? items.map((x, i) => `<button class="bh ${i === sel ? "on" : ""}" data-i="${i}">
        <span>${esc(new Date(x.at).toLocaleTimeString("th-TH"))}</span><b>${esc(x.question)}</b>
        ${badge(x.result && x.result.answered ? "ok" : "warn", (x.llm && x.llm.guard && x.llm.guard.ran && !x.llm.guard.ok) ? "Guard ตีกลับ" : (BRAIN_SRC[x.result && x.result.answer_source] || "-"))}</button>`).join("")
      : '<div class="muted">-</div>';
  };
  $("brainHist").addEventListener("click", (e) => {
    const b = e.target.closest(".bh"); if (!b) return;
    sel = Number(b.dataset.i); render(false);
  });
  $("brainFull").onclick = () => {
    const p = $("brainPanel");
    if (document.fullscreenElement) document.exitFullscreen(); else p.requestFullscreen && p.requestFullscreen().catch(() => {});
  };
  S.onTrace = (t) => {
    items.unshift(t); items = items.slice(0, 20); sel = 0; render(true);
    const lv = $("brainLive"); if (lv) { lv.classList.remove("pulse"); void lv.offsetWidth; lv.classList.add("pulse"); }
  };
  render(false);
};

// =========================================================================== 22 พ.ย. 2569: สวิตช์เลือกโมเดล AI
// คีย์อยู่ในไฟล์ .env เท่านั้น (VORA_KEY_<ชื่อ>) — หน้านี้ไม่รับและไม่แสดงคีย์ · เปลี่ยนแล้วมีผลทันที ไม่ต้องรีสตาร์ต
VIEWS.aimodel = async (el) => {
  let D = await call("/api/admin/ai/models");
  let pick = { primary: D.mode === "env" ? "env" : D.primary, fallback: D.fallback || "none", models: { ...(D.models || {}) } };
  const admin = can("admin");
  const optById = (id) => D.options.find((o) => o.id === id);
  const status = (o) => {
    if (o.id === "none") return badge("ok", "ใช้ได้เสมอ");
    if (o.local) return D.ollama && D.ollama.running ? badge("ok", `Ollama เปิดอยู่ · ${D.ollama.models.length} โมเดล`) : badge("warn", "ยังไม่ได้เปิด Ollama ในเครื่อง");
    return o.key_set ? badge("ok", "มีคีย์แล้ว") : badge("draft", `ยังไม่มีคีย์ (${o.key_env})`);
  };
  const activeHtml = () => {
    const a = D.active || [];
    const envTxt = D.env.provider && D.env.provider !== "none" ? `${esc(D.env.provider)} · ${esc(D.env.model || "ค่าเริ่มต้น")}${D.env.fallback && D.env.fallback !== "none" ? ` (สำรอง ${esc(D.env.fallback)})` : ""}` : "ไม่ใช้ AI ภายนอก";
    return `<dl class="stat-list">
      <dt>โหมด</dt><dd>${D.mode === "env" ? `ตามไฟล์ .env <span class="muted">(${envTxt})</span>` : badge("ok", "เลือกจากหลังบ้าน")}</dd>
      <dt>ตัวหลัก</dt><dd>${a[0] ? `<b>${esc(optById(a[0].provider)?.label || a[0].provider)}</b> <span class="muted">${esc(a[0].model)}</span>${a[0].circuit_open ? " " + badge("error", "พักชั่วคราว (ล้มติดกัน)") : ""}` : "<b>ไม่ใช้ AI ภายนอก</b> <span class=\"muted\">ตอบจากคลังความรู้ตรง ๆ</span>"}</dd>
      <dt>ตัวสำรอง</dt><dd>${a[1] ? `${esc(optById(a[1].provider)?.label || a[1].provider)} <span class="muted">${esc(a[1].model)}</span>` : '<span class="muted">ไม่มี</span>'}</dd>
      <dt>ค้นเว็บ ("หาข้อมูล…")</dt><dd>${D.web_search ? badge("ok", "ใช้ได้") : '<span class="muted">ใช้ไม่ได้ (ต้องมี Gemini เป็นตัวหลักหรือตัวสำรอง)</span>'}</dd>
      <dt>ทดสอบ</dt><dd><button class="btn" id="amTest" ${D.ai_on && admin ? "" : "disabled"}>ทดสอบการเชื่อมต่อ</button> <span class="muted" id="amTestMsg"></span></dd>
    </dl>`;
  };
  const cardHtml = (o) => {
    const on = pick.primary === o.id;
    const dis = !o.ready && o.id !== "none";
    const modelVal = pick.models[o.id] || "";
    const dl = o.local && D.ollama?.models?.length ? `<datalist id="dl-${o.id}">${D.ollama.models.map((m) => `<option value="${esc(m)}">`).join("")}</datalist>` : "";
    return `<label class="amcard ${on ? "on" : ""} ${dis ? "dis" : ""}">
      <input type="radio" name="amPrimary" value="${o.id}" ${on ? "checked" : ""} ${dis || !admin ? "disabled" : ""}>
      <div class="amhead"><b>${esc(o.label)}</b> ${status(o)}</div>
      <div class="muted amnote">${esc(o.note)}</div>
      ${o.id !== "none" ? `<div class="ammodel">โมเดล <input class="input" data-model="${o.id}" list="dl-${o.id}" value="${esc(modelVal)}" placeholder="${esc(o.default_model || "")}" ${admin ? "" : "disabled"}>${dl}</div>` : ""}
    </label>`;
  };
  const render = () => {
    const fbOpts = D.options.filter((o) => o.id !== "none" && o.ready && o.id !== pick.primary);
    el.innerHTML = `
      <section class="panel"><h2>ตอนนี้ VORA ใช้</h2>
        <p class="desc">โมเดล AI ทำหน้าที่ <b>เรียบเรียงคำตอบ</b> จากคลังความรู้ให้ฟังเป็นธรรมชาติ ทุกตัวผ่าน Answer Guard 9 ข้อเหมือนกัน
          · ถ้าตัวหลักล่ม ระบบลองตัวสำรอง แล้วตอบจากคลังความรู้ตรง ๆ เสมอ · เปลี่ยนแล้วมีผลทันที ไม่ต้องรีสตาร์ต</p>
        <div id="amActive">${activeHtml()}</div>
      </section>
      <section class="panel"><h2>เลือกโมเดล</h2>
        <p class="desc">คีย์ของแต่ละเจ้าใส่ในไฟล์ <code>.env</code> บนเครื่องเซิร์ฟเวอร์ เช่น <code>VORA_KEY_TYPHOON=...</code> แล้วกด "โหลดคีย์จาก .env ใหม่"
          — หน้านี้ไม่รับและไม่แสดงคีย์เพื่อความปลอดภัย${admin ? "" : " · <b>ต้องเป็นผู้ดูแลระบบ (admin) จึงจะเปลี่ยนได้</b>"}</p>
        <div class="amgrid">
          <label class="amcard ${pick.primary === "env" ? "on" : ""}"><input type="radio" name="amPrimary" value="env" ${pick.primary === "env" ? "checked" : ""} ${admin ? "" : "disabled"}>
            <div class="amhead"><b>ตามไฟล์ .env (ค่าเดิม)</b></div><div class="muted amnote">ใช้ค่า VORA_LLM_* เหมือนก่อนมีหน้านี้</div></label>
          ${D.options.map(cardHtml).join("")}
        </div>
        <div class="amfoot">
          <label>ตัวสำรอง <select class="input" id="amFallback" ${admin && !["env", "none"].includes(pick.primary) ? "" : "disabled"}>
            <option value="none">ไม่มี</option>${fbOpts.map((o) => `<option value="${o.id}" ${pick.fallback === o.id ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>
          ${admin ? '<button class="btn primary" id="amSave">บันทึกและใช้ทันที</button><button class="btn" id="amReload">โหลดคีย์จาก .env ใหม่</button>' : ""}
        </div>
      </section>
      <section class="panel"><h2>ขอคีย์ / ติดตั้งแบบไม่เสียเงิน</h2>
        <ol class="amhow">
          <li><b>Typhoon (แนะนำ ฟรี เก่งไทย):</b> สมัครที่ <code>playground.opentyphoon.ai</code> → สร้าง API key → ใส่ <code>VORA_KEY_TYPHOON=คีย์</code> ใน .env → กดโหลดคีย์ → เลือก Typhoon → บันทึก → ทดสอบ</li>
          <li><b>Gemini แบบฟรี:</b> Google AI Studio (<code>aistudio.google.com</code>) สร้างคีย์ได้โดยไม่ต้องผูกบัตร แต่จำกัดจำนวนครั้ง · ใส่ <code>VORA_KEY_GEMINI=คีย์</code></li>
          <li><b>Ollama (ไม่ใช้เน็ต):</b> ติดตั้งจาก <code>ollama.com</code> → เปิดโปรแกรม → พิมพ์ <code>ollama pull qwen2.5:7b</code> ในหน้าต่างคำสั่ง → กลับมาหน้านี้แล้วรีเฟรช · ต้องใช้เครื่องแรงพอ</li>
          <li><b>ไม่ใช้ AI ภายนอก:</b> เลือกได้ทันที ตอบจากคลังความรู้ตรง ๆ ถูกต้องตามที่เจ้าหน้าที่เขียน</li>
        </ol>
        <p class="muted">หลังเปลี่ยนโมเดล ลองถามที่หน้าจอหุ่นแล้วดูเมนู "สมองโปร่งใส" ว่าขั้น AI เรียบเรียงใช้ผู้ให้บริการตัวใหม่</p>
      </section>`;
    el.querySelectorAll('input[name="amPrimary"]').forEach((r) => r.addEventListener("change", () => {
      readModels(); pick.primary = r.value; if (pick.fallback === pick.primary) pick.fallback = "none"; render();
    }));
    const fb = $("amFallback"); if (fb) fb.onchange = () => { pick.fallback = fb.value; };
    const save = $("amSave");
    if (save) save.onclick = () => run(async () => {
      readModels();
      const body = pick.primary === "env" ? { mode: "env" } : { mode: "custom", primary: pick.primary, fallback: pick.fallback, models: pick.models };
      D = await call("/api/admin/ai/models", { method: "POST", body });
      render();
    }, "เปลี่ยนโมเดลแล้ว มีผลทันที");
    const rl = $("amReload");
    if (rl) rl.onclick = () => run(async () => { D = await call("/api/admin/ai/models/reload", { method: "POST" }); render(); }, "โหลดคีย์จาก .env แล้ว");
    const t = $("amTest");
    if (t) t.onclick = () => run(async () => {
      $("amTestMsg").textContent = "กำลังทดสอบ…";
      const r = await call("/api/admin/ai/test", { method: "POST" });
      $("amTestMsg").innerHTML = r.ok ? `${badge("ok", "ใช้ได้")} ${esc(r.provider)} · ${r.latency_ms} ms` : `${badge("error", "ไม่สำเร็จ")} ${esc(r.error || "")}`;
    });
  };
  const readModels = () => el.querySelectorAll("input[data-model]").forEach((i) => {
    const v = i.value.trim(); if (v) pick.models[i.dataset.model] = v; else delete pick.models[i.dataset.model];
  });
  render();
};

VIEWS.offline = async (el) => {
  el.innerHTML = `
    <section class="panel"><h2>สถานะ</h2>
      <p class="desc">เมื่ออินเทอร์เน็ตล่ม VORA เปลี่ยนเป็น <b>โหมดฐานความรู้</b> เอง: ตอบจากข้อมูลที่อนุมัติแล้วทันทีโดยไม่รอ AI ภายนอก
        พูดด้วยไฟล์เสียงที่เตรียมไว้ และหน้าจอแสดงปุ่มคำถามยอดฮิตให้แตะ (การรับเสียงพูดของผู้ใช้ต้องใช้อินเทอร์เน็ต จึงใช้ไม่ได้ช่วงนั้น)
        · อินเทอร์เน็ตกลับมา = กลับเป็นโหมด AI เองโดยไม่ต้องรีสตาร์ต</p>
      <dl class="stat-list" id="offStat"><dt>กำลังโหลด…</dt><dd></dd></dl>
      <div class="row" style="margin-top:12px;gap:8px;display:flex;flex-wrap:wrap">
        ${can("admin") ? '<button class="btn warn" id="offForce"></button>' : ""}
        <button class="btn" id="offRefresh">รีเฟรช</button>
      </div>
    </section>
    <section class="panel"><h2>เตรียมเสียงล่วงหน้า</h2>
      <p class="desc">ระบบสร้างไฟล์เสียงของคำตอบที่ตายตัว (ฐานความรู้ สาขา คำทักทาย ประกาศ แนะนำการใช้งาน) ด้วยเสียงเดิมของ VORA
        แล้วเก็บไว้ในเครื่อง — <b>ไม่ต้องอัดเสียงเอง</b> · ต้องทำตอนที่ยังมีอินเทอร์เน็ต · แก้คำตอบแล้วให้กดตรวจอีกครั้ง ข้อที่ข้อความเปลี่ยนจะขึ้นว่ายังไม่มีเสียง
        · คำตอบที่ AI เรียบเรียงใหม่ทุกครั้งเตรียมล่วงหน้าไม่ได้ ตอนเน็ตล่มระบบจึงตอบจากฐานความรู้ตรง ๆ ซึ่งตรงกับเสียงที่เตรียมไว้</p>
      <div class="row" style="gap:8px;display:flex;flex-wrap:wrap;align-items:center">
        <button class="btn" id="preScan">ตรวจรายการข้อความ</button>
        ${can("editor") ? '<button class="btn primary" id="preRun" disabled>เตรียมเสียงที่ยังไม่มี</button><button class="btn" id="preStop" hidden>หยุด</button>' : ""}
        <span class="muted" id="preMsg"></span>
      </div>
      <div id="preBar" style="height:10px;border-radius:6px;background:var(--line);margin:12px 0;overflow:hidden" hidden><div style="height:100%;width:0;background:var(--blueprint);transition:width .2s"></div></div>
      <div id="preSum"></div>
      <details style="margin-top:10px"><summary>รายการทั้งหมด</summary><div id="preList"></div></details>
    </section>`;
  const loadStatus = async () => {
    const st = await call("/api/admin/offline/status");
    $("offStat").innerHTML = `
      <dt>โหมดตอนนี้</dt><dd>${st.mode === "kb" ? badge("warn", st.forced ? "โหมดฐานความรู้ (จำลองเน็ตล่ม)" : "โหมดฐานความรู้ (ไม่มีอินเทอร์เน็ต)") : badge("ok", "โหมด AI (ออนไลน์)")}</dd>
      <dt>ตัวตรวจอินเทอร์เน็ต</dt><dd>${st.monitor ? `เปิด <span class="muted">ตรวจล่าสุด ${fmt(st.checked_at)}${st.net_ok ? "" : " · ไม่พบอินเทอร์เน็ต"}</span>` : '<span class="muted">ปิด (VORA_NET_CHECK_S=0)</span>'}</dd>
      <dt>เสียงพูดฝั่งเซิร์ฟเวอร์</dt><dd>${st.tts_available ? esc(st.tts_provider || "-") : badge("draft", "ไม่ได้เปิด")}</dd>
      <dt>ไฟล์เสียงที่เตรียมไว้</dt><dd>${st.pinned.files} ไฟล์ <span class="muted">${(st.pinned.bytes / 1048576).toFixed(1)} MB</span></dd>`;
    const f = $("offForce");
    if (f) {
      f.textContent = st.forced ? "ปิดการจำลองเน็ตล่ม" : "จำลองเน็ตล่ม (ซ้อมสาธิต)";
      f.onclick = () => run(async () => { await call("/api/admin/offline/force", { method: "POST", body: { on: !st.forced } }); await loadStatus(); },
        st.forced ? "กลับเป็นโหมดปกติแล้ว" : "เปิดจำลองเน็ตล่มแล้ว — หน้าจอหุ่นจะเปลี่ยนภายใน 15 วินาที");
    }
    return st;
  };
  const render = () => {
    const sm = summarize(PRE.plan);
    $("preSum").innerHTML = PRE.plan.length ? table([["ประเภท", (r) => r[0]], ["ข้อความ", (r) => r[1]], ["มีเสียงแล้ว", (r) => r[2]]],
      Object.entries(sm.by).map(([k, v]) => [esc(PRE_KIND_TH[k] || k), v.total, `${v.ready} ${v.ready === v.total ? badge("ok", "ครบ") : ""}`]).concat([["<b>รวม</b>", `<b>${sm.total}</b>`, `<b>${sm.ready}</b>`]])) : "";
    $("preList").innerHTML = table([["", (r) => r[0]], ["ประเภท", (r) => r[1]], ["ภาษา", (r) => r[2]], ["ข้อความที่พูด", (r) => r[3]], ["", (r) => r[4]]], PRE.plan.map((p, i) => [
      p.pinned ? "✅" : p.error ? "⚠️" : "–", esc(PRE_KIND_TH[p.kind] || p.kind), p.lang, `${esc(p.text.slice(0, 160))}${p.error ? `<div class="error">${esc(p.error)}</div>` : ""}`,
      p.pinned ? `<button class="btn sm" data-play="${i}">ฟัง</button>` : ""]));
    $("preList").querySelectorAll("[data-play]").forEach((b) => (b.onclick = () => {
      const p = PRE.plan[+b.dataset.play];
      new Audio(`/api/tts?lang=${p.lang}&text=${encodeURIComponent(p.text)}`).play().catch(() => toast("เล่นเสียงไม่ได้", true));
    }));
    const missing = PRE.plan.filter((p) => !p.pinned).length;
    const btn = $("preRun");
    if (btn) { btn.disabled = PRE.running || !missing; btn.textContent = missing ? `เตรียมเสียงที่ยังไม่มี (${missing} ข้อ)` : "เสียงครบแล้ว"; }
  };
  const scan = async () => {
    $("preMsg").textContent = "กำลังรวบรวมข้อความ…";
    const data = await call("/api/admin/offline/phrases", { timeout: 90000 });
    PRE.plan = buildPlan([...data.items, ...guidePhrases(GUIDE_STEPS)], speechText);
    for (let i = 0; i < PRE.plan.length; i += 500) {
      const part = PRE.plan.slice(i, i + 500);
      const chk = await call("/api/admin/offline/check", { method: "POST", body: { items: part.map((p) => ({ text: p.text, lang: p.lang })) } });
      if (!chk.tts_available) { $("preMsg").textContent = "ยังไม่ได้เปิดเสียงพูดฝั่งเซิร์ฟเวอร์ (VORA_TTS_PROVIDER) จึงเตรียมเสียงไม่ได้"; break; }
      chk.pinned.forEach((v, k) => (part[k].pinned = v));
    }
    const sm = summarize(PRE.plan);
    $("preMsg").textContent = `${sm.total} ข้อความ · มีเสียงแล้ว ${sm.ready}`;
    render();
  };
  const runPrewarm = async () => {
    const todo = PRE.plan.filter((p) => !p.pinned);
    if (!todo.length) return;
    PRE.running = true; PRE.stop = false;
    $("preStop").hidden = false; $("preBar").hidden = false; render();
    let done = 0, fail = 0;
    try {
      for (const p of todo) {
        if (PRE.stop) break;
        try {
          const r = await call("/api/admin/offline/pin", { method: "POST", timeout: 40000, body: { text: p.text, lang: p.lang, kind: p.kind, label: p.label } });
          p.pinned = !!r.ok; p.error = r.ok ? "" : (r.error || "ไม่สำเร็จ");
          if (!r.ok) fail++;
        } catch (e) {
          p.error = e.message; fail++;
          if (e.status === 409) { toast(e.message, true); break; }
        }
        done++;
        $("preBar").firstElementChild.style.width = `${Math.round((done / todo.length) * 100)}%`;
        $("preMsg").textContent = `กำลังเตรียมเสียง ${done}/${todo.length}${fail ? ` · ไม่สำเร็จ ${fail}` : ""}`;
        if (done % 10 === 0) render();
      }
    } finally {
      PRE.running = false; $("preStop").hidden = true; render(); loadStatus().catch(() => {});
      $("preMsg").textContent = `เสร็จ ${done - fail}/${todo.length} ข้อ${fail ? ` · ไม่สำเร็จ ${fail} ข้อ (ลองกดอีกครั้ง)` : ""}`;
    }
  };
  $("offRefresh").onclick = () => run(loadStatus);
  $("preScan").onclick = () => run(scan);
  if ($("preRun")) $("preRun").onclick = runPrewarm;
  if ($("preStop")) $("preStop").onclick = () => { PRE.stop = true; };
  await loadStatus();
  if (PRE.plan.length) render();
};

// --------------------------------------------------------------------------- ตั้งค่า
VIEWS.settings = async (el) => {
  const s = await call("/api/admin/settings");
  const fields = [
    { key: "school_name_th", label: "ชื่อสถานศึกษา (ไทย)" }, { key: "school_name_en", label: "ชื่อสถานศึกษา (อังกฤษ)" },
    { key: "robot_name", label: "ชื่อหุ่นยนต์" }, { key: "answer_style", label: "ความยาวคำตอบ", type: "select", options: { short: "สั้น (เหมาะกับการพูด)", normal: "ปกติ" } },
    { key: "greeting_th", label: "คำทักทาย (ไทย)", type: "textarea", rows: 2 }, { key: "greeting_en", label: "คำทักทาย (อังกฤษ)", type: "textarea", rows: 2 },
    { key: "contact_th", label: "ช่องทางติดต่อ (ไทย)", type: "textarea", rows: 2, hint: "หุ่นยนต์จะบอกเมื่อตอบคำถามไม่ได้" }, { key: "contact_en", label: "ช่องทางติดต่อ (อังกฤษ)", type: "textarea", rows: 2 },
    { key: "quiet_hours", label: "ช่วงงดประกาศเสียง", hint: "เช่น 12:00-13:00,16:30-07:30" }, { key: "voice_rate", label: "ความเร็วเสียงพูด", type: "number", min: 0.6, max: 1.6 },
    { key: "auto_greeting", label: "ทักทายอัตโนมัติเมื่อกล้องเห็นคน", type: "checkbox" }, { key: "attract_mode", label: "พูดประชาสัมพันธ์เมื่อหน้าจอว่าง (โหมดเดิม เมื่อปิด VORA_PR_SCHEDULE_ONLY)", type: "checkbox" },
    { key: "avatar_motion", label: "ความมีชีวิตชีวาของอวตาร", type: "range", min: 0, max: 200, step: 5, unit: "%", hint: "100% = ท่าทางเดิมของตัวละคร · 150% = พอดี (ค่าแนะนำ) · 200% = สดใสที่สุด · 0% = เกือบนิ่ง (ยังกระพริบตา) · มีผลหลังรีเฟรชหน้าจอหุ่นยนต์" },
    { key: "admission_form_url", label: "เอกสารรับสมัคร (PDF หรือภาพ)", type: "media", accept: "application/pdf,image/*", hint: "แสดงในขั้นสุดท้ายของเส้นทางการสมัครเรียน ผู้เข้าชมกดพิมพ์ หรือสแกนคิวอาร์โค้ดดาวน์โหลดบนมือถือได้" },
    { key: "admission_form_name", label: "ชื่อเอกสารรับสมัคร", hint: "เช่น ใบสมัครเข้าศึกษา ปีการศึกษา 2570" },
    // 12 พ.ย. 2569: เว็บไซต์วิทยาลัย + ขั้นตอนสมัครออนไลน์ (หุ่นยนต์ไม่เดาขั้นตอนเอง ใช้เฉพาะที่กรอกตรงนี้)
    { key: "website_url", label: "เว็บไซต์วิทยาลัย", hint: "เช่น https://www.technicnan.ac.th · เมื่อผู้ใช้ถามถึงเว็บไซต์ หน้าจอจะเปิดหน้าเว็บพร้อมคิวอาร์โค้ด · ว่าง = ใช้โดเมนที่พบในคลังความรู้" },
    { key: "apply_online_url", label: "ลิงก์สมัครเรียนออนไลน์", hint: "หน้าเว็บสำหรับกรอกใบสมัครออนไลน์ (ใช้ทำคิวอาร์โค้ดในหน้าพาสมัคร)" },
    { key: "apply_steps_th", label: "ขั้นตอนสมัครออนไลน์ (ไทย)", type: "textarea", rows: 6, hint: "บรรทัดละ 1 ขั้น เช่น \"เข้าเว็บรับสมัครแล้วกดสมัครเรียน\" · ว่าง = ไม่แสดงหน้าพาสมัครออนไลน์" },
    { key: "apply_steps_en", label: "ขั้นตอนสมัครออนไลน์ (อังกฤษ)", type: "textarea", rows: 6, hint: "บรรทัดละ 1 ขั้น · ว่าง = ใช้ฉบับภาษาไทย" },
    { key: "apply_contact_th", label: "ติดต่อสอบถามการสมัคร (ไทย)", type: "textarea", rows: 2, hint: "เช่น งานทะเบียน อาคาร 1 เปิด จ.-ศ. 08:30-16:30 โทร ..." },
    { key: "apply_contact_en", label: "ติดต่อสอบถามการสมัคร (อังกฤษ)", type: "textarea", rows: 2 },
    // 12 พ.ย. 2569: แนะนำวิทยาลัย (ถาม "แนะนำวิทยาลัย/วิทยาลัยเป็นยังไง" → พูดบรรยาย แล้วแสดงช่องทางติดต่อพร้อมคิวอาร์โค้ด)
    { key: "about_th", label: "คำบรรยายแนะนำวิทยาลัย (ไทย)", type: "textarea", rows: 4, hint: "3-5 ประโยค อ่านออกเสียงได้ลื่น · ว่าง = ตอบจากคลังความรู้" },
    { key: "about_en", label: "คำบรรยายแนะนำวิทยาลัย (อังกฤษ)", type: "textarea", rows: 4 },
    { key: "facebook_url", label: "เฟซบุ๊กวิทยาลัย", hint: "ลิงก์เพจ เช่น https://www.facebook.com/... · ว่าง = หาจากคลังความรู้" },
    { key: "line_url", label: "LINE (ลิงก์หรือ LINE ID)", hint: "เช่น https://lin.ee/... หรือ @technicnan" },
    { key: "phone", label: "เบอร์โทรศัพท์วิทยาลัย" },
    { key: "address_th", label: "ที่อยู่ (ไทย)", type: "textarea", rows: 2 }, { key: "address_en", label: "ที่อยู่ (อังกฤษ)", type: "textarea", rows: 2 },
    { key: "map_url", label: "ลิงก์แผนที่ (Google Maps)", hint: "แสดงเป็นคิวอาร์โค้ดนำทาง" },
    { key: "about_images", label: "ภาพประกอบแนะนำวิทยาลัย", type: "gallery", hint: "อัปโหลดได้หลายภาพ · ว่าง = ใช้ภาพของสาขาวิชา" },
  ];
  el.innerHTML = `<section class="panel"><h2>การตั้งค่าที่ปรับได้ทันที</h2><p class="desc">การเปลี่ยนแปลงมีผลกับหน้าจอหุ่นยนต์หลังรีเฟรชหน้าจอ ส่วนการตั้งค่าเชิงเทคนิค (บริการ AI เสียง และพอร์ตหุ่นยนต์) แก้ในไฟล์ .env ตามคู่มือการติดตั้ง</p>
    <dl class="stat-list">${fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.type === "checkbox" ? (s[f.key] ? "เปิด" : "ปิด") : s[f.key])}</dd>`).join("")}</dl>
    <div class="row" style="margin-top:14px">${can("admin") ? '<button class="btn primary" id="editS">แก้ไขการตั้งค่า</button>' : ""}<button class="btn" id="pw">เปลี่ยนรหัสผ่านของฉัน</button></div></section>`;
  $("editS") && ($("editS").onclick = async () => { const v = await modalForm("แก้ไขการตั้งค่า", fields, s); if (v && await run(() => call("/api/admin/settings", { method: "PUT", body: v }), "บันทึกแล้ว")) route(); });
  $("pw").onclick = async () => {
    const v = await modalForm("เปลี่ยนรหัสผ่าน", [{ key: "old_password", label: "รหัสผ่านเดิม", type: "password", required: true }, { key: "new_password", label: "รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)", type: "password", required: true }]);
    if (v) run(() => call("/api/auth/change-password", { method: "POST", body: v }), "เปลี่ยนรหัสผ่านแล้ว");
  };
};

VIEWS.users = async (el) => {
  if (!can("admin")) { el.innerHTML = '<section class="panel"><p class="desc">เฉพาะผู้ดูแลระบบ</p></section>'; return; }
  const rows = await call("/api/admin/users");
  el.innerHTML = `<section class="panel"><div class="row"><p class="desc grow" style="margin:0">ผู้ดูแลระบบ: อนุมัติเนื้อหา จัดการผู้ใช้และหุ่นยนต์ · เจ้าหน้าที่: เพิ่ม/แก้ไขเนื้อหาและส่งรออนุมัติ ฝึกโมเดล · ผู้ดูข้อมูล: ดูรายงานได้อย่างเดียว</p><button class="btn primary" id="addU">เพิ่มผู้ใช้</button></div><br>
    ${table([["ชื่อผู้ใช้", (u) => `<b>${esc(u.username)}</b><div class="muted">${esc(u.display_name)}</div>`], ["สิทธิ์", (u) => ROLE_TH[u.role]], ["สถานะ", (u) => u.active ? badge("ok", "ใช้งาน") : badge("draft", "ปิด")], ["เข้าระบบล่าสุด", (u) => `<span class="muted">${fmt(u.last_login_at)}</span>`], ["", (u) => `<button class="btn sm" data-e="${u.id}">แก้ไข</button>`]], rows)}</section>`;
  const f = (isNew) => [...(isNew ? [{ key: "username", label: "ชื่อผู้ใช้", required: true }] : []), { key: "display_name", label: "ชื่อที่แสดง" }, { key: "role", label: "สิทธิ์", type: "select", options: ROLE_TH }, { key: "password", label: isNew ? "รหัสผ่าน" : "ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)", type: "password" }, { key: "active", label: "เปิดใช้งาน", type: "checkbox", default: true }];
  $("addU").onclick = async () => { const v = await modalForm("เพิ่มผู้ใช้", f(true), { role: "editor", active: true }); if (v && await run(() => call("/api/admin/users", { method: "POST", body: v }), "เพิ่มแล้ว")) route(); };
  el.querySelectorAll("[data-e]").forEach((b) => (b.onclick = async () => {
    const u = rows.find((x) => x.id === +b.dataset.e);
    const v = await modalForm(`แก้ไข ${u.username}`, f(false), u);
    if (v && await run(() => call(`/api/admin/users/${u.id}`, { method: "PUT", body: { ...v, username: u.username, password: v.password || null } }), "บันทึกแล้ว")) route();
  }));
};

VIEWS.logs = async (el) => {
  const tab = VIEWS.logs.tab || "events";
  const rows = tab === "audit" ? await call("/api/admin/audit").catch(() => []) : await call(`/api/admin/events${tab === "errors" ? "?level=error" : ""}`);
  el.innerHTML = `<section class="panel"><div class="tabs">${[["events", "เหตุการณ์ระบบ"], ["errors", "เฉพาะข้อผิดพลาด"], ["audit", "ประวัติการเปลี่ยนแปลงข้อมูล"]].map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div><br>
    ${tab === "audit" ? table([["เวลา", (a) => `<span class="muted">${fmt(a.created_at)}</span>`], ["ผู้ใช้", (a) => esc(a.username)], ["การกระทำ", (a) => esc(a.action)], ["ข้อมูล", (a) => `${esc(a.entity)} ${esc(a.entity_id)}`], ["รายละเอียด", (a) => `<span class="muted clip">${esc(JSON.stringify(a.detail))}</span>`]], rows, "ไม่มีสิทธิ์ดูหรือยังไม่มีข้อมูล")
      : table([["เวลา", (e) => `<span class="muted">${fmt(e.created_at)}</span>`], ["ระดับ", (e) => badge(e.level === "info" ? "draft" : e.level === "warn" ? "warn" : "error", e.level)], ["ส่วน", (e) => esc(e.source)], ["ข้อความ", (e) => esc(e.message)]], rows)}</section>`;
  el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { VIEWS.logs.tab = b.dataset.t; route(); }));
};

boot();
