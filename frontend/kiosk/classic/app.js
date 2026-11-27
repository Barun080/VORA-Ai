// VORA Kiosk — ตัวควบคุมลำดับการทำงานบนหน้าจอหุ่นยนต์ (Interaction Orchestrator)
// สถานะ: idle → listening → thinking → speaking → idle  (ไม่ให้ฟังกับพูดชนกัน, ผู้ใช้พูดแทรกได้)
// ช่องทางโต้ตอบ: เสียง, พิมพ์, แตะการ์ด, ใบหน้า (ทักทายเชิงรุก), ท่ามือ, ป้าย/วัตถุหน้ากล้อง, ประกาศอัตโนมัติ

import { api, esc, LiveSocket, sleep } from "/shared/api.js";
import { VisionSystem } from "/shared/vision.js";
import { Avatar } from "./avatar.js";
import { Listener, Speaker } from "./voice.js";

const $ = (id) => document.getElementById(id);
const T = {
  th: {
    idle: "พร้อมคุยแล้ว", listening: "กำลังฟัง…", thinking: "กำลังคิด…", speaking: "กำลังตอบ", sleeping: "พักหน้าจอ",
    tapToTalk: "แตะแล้วพูด", listeningBtn: "กำลังฟัง", ask: "ถาม", placeholder: "หรือพิมพ์คำถามที่นี่ เช่น สมัครเรียนยังไง",
    start: "แตะเพื่อคุยกับวอร่า", hint: "หรือเดินมายืนหน้าหุ่นยนต์ แล้ววอร่าจะทักทายเอง",
    robotSub: "หุ่นยนต์ประชาสัมพันธ์อัจฉริยะ", noMic: "เบราว์เซอร์นี้ใช้ไมโครโฟนไม่ได้ พิมพ์คำถามแทนได้เลย",
    micDenied: "กรุณาอนุญาตการใช้ไมโครโฟน", noSpeech: "ไม่ได้ยินเสียง ลองพูดอีกครั้งนะคะ", netErr: "ระบบรับเสียงต้องใช้อินเทอร์เน็ต ลองพิมพ์คำถามแทนนะคะ",
    rateTitle: "วอร่าช่วยคุณได้แค่ไหน", rateSkip: "ข้าม", rateSend: "ส่งความคิดเห็น", rateThanks: "ขอบคุณสำหรับความคิดเห็นค่ะ",
    likeThanks: "ขอบคุณที่ชอบคำตอบค่ะ", dislike: "รับทราบค่ะ หนูจะส่งให้เจ้าหน้าที่ปรับปรุงนะคะ", report: "แจ้งว่าคำตอบผิด",
    qrTitle: "ดูข้อมูลต่อบนมือถือ", close: "ปิด", photo: "ยิ้มค่ะ หนึ่ง สอง สาม แชะ ขอบคุณที่ถ่ายรูปกับวอร่านะคะ",
    love: "วอร่าก็รักทุกคนเหมือนกันค่ะ", stopped: "หยุดแล้วค่ะ", online: "ระบบพร้อม", offline: "ออฟไลน์ กำลังเชื่อมต่อใหม่",
    robotOn: "หุ่นยนต์ออนไลน์", robotOff: "ยังไม่เชื่อมต่อหุ่นยนต์", estop: "หุ่นยนต์หยุดฉุกเฉิน",
    camText: "กล้องประมวลผลในเครื่อง ไม่บันทึกภาพ", sourceKB: "ตอบจากฐานความรู้วิทยาลัย", sourceNone: "ยังไม่มีข้อมูลในระบบ",
    kinds: { admission: "รับสมัคร", activity: "กิจกรรม", news: "ข่าว", program: "แนะนำสาขา", text: "ประกาศ" },
    help: ["<b>👍</b> ชอบคำตอบ", "<b>✋</b> หยุดพูด", "<b>☝️</b> ข่าวถัดไป", "<b>✌️</b> ถ่ายรูปกับวอร่า"],
    error: "ขออภัยค่ะ เชื่อมต่อระบบไม่ได้ชั่วคราว ลองใหม่อีกครั้งนะคะ",
  },
  en: {
    idle: "Ready to chat", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking", sleeping: "Resting",
    tapToTalk: "Tap to talk", listeningBtn: "Listening", ask: "Ask", placeholder: "Or type a question, e.g. How do I apply?",
    start: "Tap to talk with VORA", hint: "Or stand in front of me and I'll say hello",
    robotSub: "Smart PR robot", noMic: "Voice input isn't available in this browser. Please type instead.",
    micDenied: "Please allow microphone access", noSpeech: "I didn't catch that. Please try again.", netErr: "Voice input needs internet. Please type instead.",
    rateTitle: "How helpful was VORA?", rateSkip: "Skip", rateSend: "Send feedback", rateThanks: "Thank you for your feedback!",
    likeThanks: "Glad you liked it!", dislike: "Noted. I'll pass this to our staff.", report: "Report wrong answer",
    qrTitle: "Continue on your phone", close: "Close", photo: "Smile! One, two, three. Thanks for taking a photo with me!",
    love: "I love you all too!", stopped: "Stopped.", online: "System ready", offline: "Offline, reconnecting",
    robotOn: "Robot online", robotOff: "Robot not connected", estop: "Robot emergency stop",
    camText: "Camera is processed on this device. No images are saved.", sourceKB: "From the college knowledge base", sourceNone: "Not in the knowledge base yet",
    kinds: { admission: "Admission", activity: "Activity", news: "News", program: "Program", text: "Announcement" },
    help: ["<b>👍</b> Like answer", "<b>✋</b> Stop", "<b>☝️</b> Next news", "<b>✌️</b> Photo with VORA"],
    error: "Sorry, I can't reach the system right now. Please try again.",
  },
};

const S = {
  lang: "th", state: "idle", phase: "attract", sessionId: null, cfg: null, lastBotId: null, questions: 0,
  lastActivity: Date.now(), lastGreetAt: 0, rated: false, queue: [], personPresent: false, newsIdx: 0,
  lastAttractSpeak: Date.now(), robot: null, wsOnline: false,
};
const t = (k) => T[S.lang][k];

let avatar, speaker, listener, vision, socket;

// ====================================================================== สถานะและหน้าจอ
function setState(state) {
  S.state = state;
  $("app").dataset.state = state;
  avatar.setState(state);
  $("statusPill").textContent = t(state) || state;
  $("micLabel").textContent = state === "listening" ? t("listeningBtn") : t("tapToTalk");
  socket && socket.send({ type: "state", state: S.phase === "convo" && state === "idle" ? "conversation" : state });
  if (state === "idle") setTimeout(drainQueue, 400);
}

function touch() { S.lastActivity = Date.now(); }

function showConvo() {
  if (S.phase === "convo") return;
  S.phase = "convo";
  $("attract").hidden = true;
  $("convo").hidden = false;
}

function resetSession() {
  S.phase = "attract";
  S.sessionId = null; S.questions = 0; S.rated = false; S.lastBotId = null;
  $("messages").replaceChildren();
  $("media").hidden = true;
  $("convo").hidden = true;
  $("attract").hidden = false;
  $("caption").textContent = "";
  renderChips(null);
  nextPromo();
  setState("idle");
}

function applyLang() {
  document.documentElement.lang = S.lang;
  document.querySelectorAll(".lang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === S.lang)));
  $("askInput").placeholder = t("placeholder");
  $("sendBtn").textContent = t("ask");
  $("startBtn").textContent = t("start");
  $("attractHint").textContent = t("hint");
  $("robotLine").textContent = t("robotSub");
  $("rateTitle").textContent = t("rateTitle");
  $("rateSkip").textContent = t("rateSkip");
  $("rateSend").textContent = t("rateSend");
  $("qrTitle").textContent = t("qrTitle");
  $("qrClose").textContent = t("close");
  $("camText").textContent = t("camText");
  $("gestureHelp").innerHTML = t("help").map((h) => `<span>${h}</span>`).join("");
  if (S.cfg) $("schoolName").textContent = S.lang === "en" ? S.cfg.school_name_en : S.cfg.school_name_th;
  setState(S.state);
  renderChips(null);
  updateHealth();
}

function toast(msg, ms = 3200) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), ms);
}

function setCaption(text, partial = false) {
  const c = $("caption");
  c.textContent = text;
  c.classList.toggle("partial", partial);
}

const DEFAULT_CHIPS = {
  th: ["มีสาขาอะไรบ้าง", "สมัครเรียนยังไง", "มีข่าวอะไรบ้าง", "เธอทำอะไรได้บ้าง"],
  en: ["What programs do you offer?", "How do I apply?", "Latest news", "What can you do?"],
};

function renderChips(list) {
  const items = (list && list.length ? list : DEFAULT_CHIPS[S.lang]).slice(0, 4);
  $("chips").replaceChildren(...items.map((q) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = q;
    b.onclick = () => ask(q, "text");
    return b;
  }));
}

function scrollMessages() { const m = $("messages"); m.scrollTop = m.scrollHeight; }

function addUser(text) {
  const d = document.createElement("div");
  d.className = "msg user";
  d.textContent = text;
  $("messages").appendChild(d);
  scrollMessages();
}

function addTyping() {
  const d = document.createElement("div");
  d.className = "msg bot";
  d.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  $("messages").appendChild(d);
  scrollMessages();
  return d;
}

function addBot(res, extraClass = "") {
  const d = document.createElement("div");
  d.className = `msg bot ${res.answered === false ? "sorry" : ""} ${extraClass}`;
  const p = document.createElement("div");
  p.textContent = res.text;
  d.appendChild(p);
  if (res.message_id) {
    const meta = document.createElement("div");
    meta.className = "meta";
    const src = res.provider === "vision" ? "👁 " : "";
    meta.innerHTML = `<span class="src">${src}${esc(res.answered === false ? t("sourceNone") : t("sourceKB"))}</span>`;
    const up = Object.assign(document.createElement("button"), { className: "thumb", textContent: "👍", ariaLabel: "ชอบคำตอบ" });
    const down = Object.assign(document.createElement("button"), { className: "thumb", textContent: "👎", ariaLabel: t("report") });
    up.setAttribute("aria-pressed", "false"); down.setAttribute("aria-pressed", "false");
    up.onclick = () => { sendThumb(res.message_id, 1); up.setAttribute("aria-pressed", "true"); down.setAttribute("aria-pressed", "false"); };
    down.onclick = () => { sendThumb(res.message_id, -1); down.setAttribute("aria-pressed", "true"); up.setAttribute("aria-pressed", "false"); };
    meta.append(up, down);
    d.appendChild(meta);
    d.dataset.mid = res.message_id;
  }
  $("messages").appendChild(d);
  scrollMessages();
  if (res.message_id) S.lastBotId = res.message_id;
}

function renderMedia(media, text) {
  const box = $("media");
  const parts = [];
  if (media && (media.video || media.image)) {
    const m = media.video
      ? `<video src="${esc(media.video)}" autoplay muted loop playsinline></video>`
      : `<img src="${esc(media.image)}" alt="">`;
    const first = (media.cards || [])[0];
    parts.push(`<div class="hero">${m}<div><strong>${esc(first ? first.title : "")}</strong><p>${esc(first ? first.subtitle : "")}</p></div></div>`);
  }
  if (media && media.cards && media.cards.length > 1) {
    parts.push(`<div class="cards">${media.cards.map((c) => `
      <button class="card" data-type="${c.type}" data-id="${c.id}">
        ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : ""}
        <div class="t">${esc(c.title)}</div><div class="s">${esc(c.subtitle || "")}</div>
      </button>`).join("")}</div>`);
  }
  box.innerHTML = parts.join("");
  box.hidden = !parts.length;
  box.querySelectorAll(".card").forEach((b) => (b.onclick = () => openCard(b.dataset.type, +b.dataset.id)));
}

// ====================================================================== การโต้ตอบหลัก
async function respond(res, { record = true } = {}) {
  if (res.session_id) S.sessionId = res.session_id;
  showConvo();
  if (record) addBot(res);
  renderMedia(res.media, res.text);
  renderChips(res.suggestions);
  avatar.setEmotion(res.emotion === "sorry" ? "sorry" : res.emotion === "happy" ? "happy" : "neutral");
  if (res.gesture) avatar.gesture(res.robot_action || res.gesture);
  setCaption(res.text);
  setState("speaking");
  await speaker.speak(res.text, res.lang || S.lang);
  if (S.state === "speaking") setState("idle");
  touch();
  if (res.intent === "thanks_bye" && S.questions >= 1) setTimeout(() => openRating(), 600);
}

async function ask(text, mode = "text") {
  text = (text || "").trim();
  if (!text) return;
  touch();
  listener.stop(true);
  speaker.stop();
  showConvo();
  addUser(text);
  S.questions++;
  setCaption(text, true);
  setState("thinking");
  const typing = addTyping();
  try {
    const res = await api("/api/chat", { method: "POST", body: { text, session_id: S.sessionId, lang: S.lang, channel: "kiosk", input_mode: mode }, timeout: 25000 });
    typing.remove();
    await respond(res);
  } catch (e) {
    typing.remove();
    await respond({ text: t("error"), answered: false, emotion: "sorry", gesture: "shrug", lang: S.lang }, { record: true });
  }
}

function startListening() {
  touch();
  if (S.state === "listening") { listener.stop(); return; }
  speaker.stop();                       // ผู้ใช้พูดแทรกได้ทันที
  if (!listener.supported) { toast(t("noMic")); $("askInput").focus(); return; }
  if (listener.start(S.lang)) { setState("listening"); setCaption("…", true); }
}

async function greet(people = 1) {
  if (!S.cfg || !S.cfg.auto_greeting || S.phase !== "attract" || S.state !== "idle") return;
  if (Date.now() - S.lastGreetAt < (S.cfg.greeting_cooldown_s || 25) * 1000) return;
  S.lastGreetAt = Date.now();
  try {
    const res = await api("/api/greet", { method: "POST", body: { session_id: S.sessionId, lang: S.lang, trigger: "face", people } });
    await respond({ ...res, answered: true, message_id: null });
  } catch { /* เงียบไว้ ไม่รบกวนผู้ใช้ */ }
}

async function sendThumb(messageId, rating) {
  touch();
  try {
    await api("/api/feedback", { method: "POST", body: { session_id: S.sessionId || "", message_id: messageId, kind: rating < 0 ? "wrong_answer" : "thumb", rating } });
    toast(rating > 0 ? t("likeThanks") : t("dislike"));
    avatar.setEmotion(rating > 0 ? "happy" : "sorry");
    avatar.gesture(rating > 0 ? "happy" : "nod");
  } catch (e) { toast(e.message); }
}

async function openCard(type, id) {
  touch();
  try {
    if (type === "program") {
      const p = await api(`/api/programs/${id}`);
      const name = S.lang === "en" ? p.name_en : p.name_th;
      const text = S.lang === "en" ? `${p.name_en} (${p.level}): ${p.description_en} Careers: ${p.careers_en}`
        : `สาขา${p.name_th} ระดับ ${p.level} ${p.description_th} จบแล้วทำงานเป็น ${p.careers_th}`;
      addUser(name);
      await respond({ text, lang: S.lang, gesture: "present", emotion: "happy", media: { image: p.image, video: p.video, cards: [{ title: name, subtitle: p.level }] },
        suggestions: S.lang === "en" ? ["How do I apply?", "Is there a scholarship?"] : ["สมัครเรียนยังไง", "มีทุนไหม"] });
    } else {
      const n = await api(`/api/news/${id}`);
      const title = S.lang === "en" && n.title_en ? n.title_en : n.title_th;
      const body = S.lang === "en" && n.body_en ? n.body_en : n.body_th;
      addUser(title);
      await respond({ text: `${title} ${body}`, lang: S.lang, gesture: "point_screen", emotion: "happy", media: { image: n.image, video: n.video, cards: [{ title, subtitle: t("kinds")[n.kind] }] } });
    }
  } catch (e) { toast(e.message); }
}

function stopAll() {
  listener.stop(true);
  speaker.stop();
  api("/api/robot/stop", { method: "POST" }).catch(() => {});
  setState("idle");
  setCaption(t("stopped"));
}

// ====================================================================== ประชาสัมพันธ์อัตโนมัติ
function enqueue(item) {
  S.queue.push(item);
  S.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  if (S.queue.length > 5) S.queue.length = 5;
  drainQueue();
}

async function drainQueue() {
  if (S.state !== "idle" || !S.queue.length) return;
  const item = S.queue.shift();
  const text = S.lang === "en" && item.text_en ? item.text_en : item.text_th;
  if (!text) return;
  if (S.phase === "attract") {
    showPromo(item);
  } else {
    addBot({ text }, "announce");
  }
  avatar.gesture(item.kind === "program" ? "present" : "point_screen");
  setCaption(text);
  setState("speaking");
  await speaker.speak(text, S.lang);
  if (S.state === "speaking") setState("idle");
}

function showPromo(p) {
  if (!p || p.kind === "none") return;
  const title = S.lang === "en" && p.title_en ? p.title_en : p.title_th;
  const text = S.lang === "en" && p.text_en ? p.text_en : p.text_th;
  $("promoKind").textContent = t("kinds")[p.news_kind || p.kind] || "";
  $("promoTitle").textContent = title || "";
  $("promoText").textContent = (text || "").replace(/^ประกาศค่ะ\s*/, "").replace(title || "", "").trim();
  const m = $("promoMedia");
  if (p.video) m.innerHTML = `<video src="${esc(p.video)}" autoplay muted loop playsinline></video>`;
  else if (p.image) m.innerHTML = `<img src="${esc(p.image)}" alt="">`;
  else m.innerHTML = "";
  S.currentPromo = p;
}

async function nextPromo(speak = false) {
  try {
    const p = await api("/api/promo/next");
    showPromo(p);
    if (speak && p.kind !== "none") enqueue({ ...p, priority: 1 });
  } catch { /* ignore */ }
}

async function nextNews() {
  try {
    const items = await api(`/api/news?limit=8&lang=${S.lang}`);
    if (!items.length) return;
    const n = items[S.newsIdx++ % items.length];
    await openCard("news", n.id);
  } catch { /* ignore */ }
}

// ====================================================================== กล้องและท่าทาง
async function onGesture(name) {
  touch();
  socket.send({ type: "event", data: { kind: "gesture", name } });
  api("/api/interaction", { method: "POST", body: { kind: "gesture", name, session_id: S.sessionId, lang: S.lang } })
    .then((r) => { if (r && r.session_id) S.sessionId = r.session_id; }).catch(() => {});
  switch (name) {
    case "Thumb_Up": if (S.lastBotId) sendThumb(S.lastBotId, 1); else { avatar.setEmotion("happy"); avatar.gesture("happy"); } break;
    case "Thumb_Down": if (S.lastBotId) sendThumb(S.lastBotId, -1); break;
    case "Open_Palm": if (S.state === "speaking" || S.state === "listening") stopAll(); else if (S.phase === "attract") greet(1); break;
    case "Pointing_Up": nextNews(); break;
    case "Victory": {
      const f = $("flash"); f.hidden = false; f.style.animation = "none"; void f.offsetWidth; f.style.animation = "";
      setTimeout(() => (f.hidden = true), 600);
      avatar.setEmotion("happy"); avatar.gesture("happy");
      showConvo();
      await respond({ text: t("photo"), lang: S.lang, gesture: "happy", emotion: "happy" }, { record: false });
      break;
    }
    case "ILoveYou": avatar.setEmotion("happy"); await respond({ text: t("love"), lang: S.lang, gesture: "happy", emotion: "happy" }, { record: false }); break;
    default: break;
  }
}

async function onSign(label, prob) {
  if (S.state === "speaking" || S.state === "thinking" || S.state === "listening") return;
  touch();
  setState("thinking");
  try {
    const res = await api("/api/vision/recognized", { method: "POST", body: { label, confidence: prob, session_id: S.sessionId, lang: S.lang } });
    showConvo();
    addUser(`📷 ${res.label ? (S.lang === "en" ? "Showed a sign" : "ชูป้ายให้กล้อง") : ""}`);
    S.questions++;
    await respond(res);
  } catch { setState("idle"); }
}

async function startVision() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  vision = new VisionSystem($("camVideo"), {
    onStatus: (s) => { $("camBox").hidden = s !== "on"; $("gestureHelp").hidden = s !== "on"; },
    onLook: (x, y) => avatar.lookAt(x, y),
    onPersonArrive: (n) => { S.personPresent = true; touch(); greet(n); },
    onPersonLeave: () => { S.personPresent = false; },
    onGesture,
    onSign,
  });
  try {
    await vision.start();
    vision.setSignModel(await api("/api/vision/model"));
  } catch (e) {
    console.warn("vision unavailable:", e.message);
  }
}

// ====================================================================== ความพึงพอใจ
let rating = 0;
function openRating() {
  if (S.rated) return;
  S.rated = true;
  rating = 0;
  const stars = $("stars");
  stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) => {
    const b = document.createElement("button");
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    b.setAttribute("aria-label", `${n}`);
    b.textContent = ["😞", "🙁", "😐", "🙂", "😍"][n - 1];
    b.onclick = () => {
      rating = n;
      stars.querySelectorAll("button").forEach((x, i) => x.setAttribute("aria-checked", String(i === n - 1)));
      $("rateSend").disabled = false;
    };
    return b;
  }));
  $("rateComment").value = "";
  $("rateSend").disabled = true;
  $("rateSheet").showModal();
  clearTimeout(openRating.timer);
  openRating.timer = setTimeout(() => $("rateSheet").open && $("rateSheet").close(), 20000);
}

async function sendRating() {
  try {
    await api("/api/feedback", { method: "POST", body: { session_id: S.sessionId || "", kind: "rating", rating, comment: $("rateComment").value } });
    toast(t("rateThanks"));
    avatar.setEmotion("happy"); avatar.gesture("bow");
  } catch (e) { toast(e.message); }
  $("rateSheet").close();
}

// ====================================================================== สุขภาพระบบ
function updateHealth() {
  const dot = $("dotServer");
  const r = S.robot;
  let text = S.wsOnline ? t("online") : t("offline");
  dot.className = "dot " + (S.wsOnline ? "ok" : "bad");
  if (S.wsOnline && r) {
    if (r.estop) { text += " · " + t("estop"); dot.className = "dot bad"; }
    else if (r.connected) text += ` · ${t("robotOn")}${r.battery != null ? ` ${Math.round(r.battery)}%` : ""}`;
    else { text += " · " + t("robotOff"); dot.className = "dot"; }
  }
  $("healthText").textContent = text;
}

function onSocket(topic, data) {
  if (topic === "hello" || topic === "robot.status") { S.robot = data.robot || data; updateHealth(); }
  else if (topic === "announce") enqueue(data);
  else if (topic === "say") enqueue({ kind: "text", text_th: data.text, text_en: data.text, priority: 4 });
  else if (topic === "robot.event" && data.name === "obstacle_detected") avatar.gesture("shake");
  else if (topic === "robot.stopped" && S.state === "speaking" && data.source !== "kiosk") { /* หยุดเฉพาะหุ่น ไม่ตัดเสียง */ }
}

// ====================================================================== เริ่มระบบ
async function init() {
  avatar = new Avatar($("avatar"));
  speaker = new Speaker({ onLevel: (l) => avatar.setMouth(l) });
  listener = new Listener({
    onPartial: (txt) => setCaption(txt || "…", true),
    onFinal: (txt) => ask(txt, "voice"),
    onError: (code) => {
      setState("idle");
      if (code === "not-allowed" || code === "service-not-allowed") toast(t("micDenied"));
      else if (code === "no-speech") setCaption(t("noSpeech"));
      else if (code === "network") toast(t("netErr"));
      else if (code === "not-supported") toast(t("noMic"));
    },
    onEnd: () => { if (S.state === "listening") { setState("idle"); setCaption(t("noSpeech")); } },
  });
  try { S.lang = localStorage.getItem("vora.lang") || "th"; } catch { /* ignore */ }

  for (let i = 0; i < 30; i++) {
    try { S.cfg = await api("/api/kiosk/config"); break; } catch { await sleep(2000); }
  }
  if (S.cfg) {
    speaker.serverTTS = !!S.cfg.server_tts;
    speaker.rate = S.cfg.voice_rate || 1;
    if (!S.cfg.languages.includes(S.lang)) S.lang = "th";
  }
  applyLang();
  resetSession();

  socket = new LiveSocket("kiosk", { onMessage: onSocket, onStatus: (on) => { S.wsOnline = on; updateHealth(); } });

  // ปุ่มและคีย์ลัด
  $("micBtn").onclick = startListening;
  $("startBtn").onclick = () => {
    touch(); showConvo();
    respond({ text: S.lang === "en" ? S.cfg.greeting_en : S.cfg.greeting_th, lang: S.lang, gesture: "wave", emotion: "happy" }, { record: true });
  };
  $("askForm").onsubmit = (e) => { e.preventDefault(); const v = $("askInput").value; $("askInput").value = ""; $("askInput").blur(); ask(v, "text"); };
  $("stopBtn").onclick = stopAll;
  $("qrBtn").onclick = () => {
    const url = (S.cfg && S.cfg.mobile_url) || `${location.origin}/m/`;
    $("qrUrl").textContent = url;
    try {
      const qr = qrcode(0, "M"); qr.addData(url); qr.make();
      $("qrBox").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch { $("qrBox").textContent = url; }
    $("qrSheet").showModal();
  };
  $("qrClose").onclick = () => $("qrSheet").close();
  $("rateSkip").onclick = () => $("rateSheet").close();
  $("rateSend").onclick = sendRating;
  document.querySelectorAll(".lang button").forEach((b) => (b.onclick = () => {
    S.lang = b.dataset.lang;
    try { localStorage.setItem("vora.lang", S.lang); } catch { /* ignore */ }
    applyLang();
    touch();
  }));
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.code === "Space") { e.preventDefault(); startListening(); }
    if (e.key === "Escape") stopAll();
  });
  document.addEventListener("pointerdown", touch);

  // นาฬิกา
  const clock = () => ($("clock").textContent = new Date().toLocaleTimeString(S.lang === "en" ? "en-GB" : "th-TH", { hour: "2-digit", minute: "2-digit" }));
  clock(); setInterval(clock, 10000);

  // วงรอบ: หมุนเวียนสื่อประชาสัมพันธ์ จบเซสชันเมื่อผู้ใช้เดินจากไป และพูดประชาสัมพันธ์เมื่อว่าง
  setInterval(() => {
    const idleFor = (Date.now() - S.lastActivity) / 1000;
    if (S.state !== "idle") return;
    if (S.phase === "attract") {
      nextPromo(false);
      const every = (S.cfg && S.cfg.idle_attract_s) || 90;
      if (S.cfg && S.cfg.attract_mode && (Date.now() - S.lastAttractSpeak) / 1000 > every && idleFor > 20) {
        S.lastAttractSpeak = Date.now();
        enqueue({ ...(S.currentPromo || {}), priority: 1 });
      }
    } else if (idleFor > 45 && !S.personPresent && !$("rateSheet").open) {
      if (S.questions >= 2 && !S.rated) { openRating(); S.lastActivity = Date.now() - 30000; }
      else resetSession();
    } else if (idleFor > 150) {
      resetSession();
    }
  }, 12000);

  startVision();
}

init();
