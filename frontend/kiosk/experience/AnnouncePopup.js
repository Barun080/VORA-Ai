// 27 พ.ย. 2569: ป๊อปอัปประกาศประชาสัมพันธ์กลางจอ (ข่าว / กิจกรรม / แนะนำสาขา / ข้อความ / วิดีโอ)
//  - เปิดพร้อมเสียงประกาศของวอร่า · ปิดเองเมื่อพูดจบ (ไม่มีวิดีโอ) · แตะที่ใดก็ได้ = ปิด
//  - มีวิดีโอ: ระหว่างวอร่าพูด วิดีโอเล่นแบบปิดเสียง → พูดจบแล้วเปิดเสียงวิดีโอเล่นต่อจนจบคลิป แล้วปิด
//  - ฟังก์ชัน announceHtml เป็นฟังก์ชันล้วน (ไม่แตะ DOM) ทดสอบด้วย node ได้
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SAFE = /^(\/uploads\/|\/assets\/|https?:\/\/|data:image\/)/i;

const KIND = {
  th: { news: "ข่าวประชาสัมพันธ์", activity: "กิจกรรม", admission: "รับสมัคร", program: "แนะนำสาขา", text: "ประกาศ", media: "ประกาศ" },
  en: { news: "News", activity: "Event", admission: "Admission", program: "Program", text: "Announcement", media: "Announcement" },
};
const ICON = { news: "📰", activity: "🎉", admission: "📝", program: "🎓", text: "📢", media: "🎬" };

export function kindOf(p) { return p.kind === "news" ? (p.news_kind || "news") : (p.kind || "text"); }

/** HTML ภายในป๊อปอัป */
export function announceHtml(p, lang = "th") {
  const L = lang === "en" ? "en" : "th";
  const k = kindOf(p);
  const title = (L === "en" && p.title_en ? p.title_en : p.title_th) || "";
  const body = (L === "en" && p.text_en ? p.text_en : p.text_th) || "";
  const video = SAFE.test(p.video || "") ? p.video : "";
  const image = SAFE.test(p.image || "") ? p.image : "";
  const media = video ? `<video class="ap-video" src="${esc(video)}" ${image ? `poster="${esc(image)}"` : ""} autoplay muted playsinline></video>`
    : image ? `<img class="ap-img" src="${esc(image)}" alt="">` : `<div class="ap-noimg"><span>${ICON[k] || "📢"}</span></div>`;
  return `<div class="ap-backdrop"></div>
    <article class="ap-card${video || image ? "" : " ap-textonly"}" role="dialog" aria-live="polite" aria-label="${esc(title)}">
      <div class="ap-media">${media}<span class="ap-sound" hidden>🔊</span></div>
      <div class="ap-info">
        <span class="ap-kind">${ICON[k] || "📢"} ${esc(KIND[L][k] || KIND[L].text)}</span>
        <h2 class="ap-title">${esc(title)}</h2>
        <p class="ap-body">${esc(body)}</p>
        <small class="ap-hint">${L === "en" ? "Tap anywhere to close" : "แตะที่ใดก็ได้เพื่อปิด"}</small>
      </div>
    </article>`;
}

export class AnnouncePopup {
  constructor(mount, { onClose = () => {} } = {}) { this.mount = mount; this.onClose = onClose; this.el = null; this._end = null; }
  get open() { return !!this.el; }

  show(p, lang = "th") {
    this.close("replace");
    const el = document.createElement("div");
    el.className = "apop";
    el.innerHTML = announceHtml(p, lang);
    el.addEventListener("pointerdown", (e) => { e.stopPropagation(); this.close("tap"); });
    this.mount.appendChild(el);
    this.el = el;
    requestAnimationFrame(() => el.classList.add("in"));
    const v = el.querySelector("video");
    if (v) v.play().catch(() => {});
    return el;
  }

  get video() { return this.el ? this.el.querySelector("video") : null; }

  /** หลังวอร่าพูดจบ: เปิดเสียงวิดีโอเล่นต่อจนจบคลิป (ไม่มีวิดีโอ = คืนทันที) · คืน Promise ที่จบเมื่อคลิปจบ/ถูกปิด */
  playVideoSound(maxMs = 10 * 60 * 1000) {
    const v = this.video;
    if (!v) return Promise.resolve(false);
    return new Promise((resolve) => {
      let done = false;
      const fin = (r) => { if (done) return; done = true; clearTimeout(timer); v.removeEventListener("ended", onEnd); this._end = null; resolve(r); };
      const onEnd = () => fin(true);
      const timer = setTimeout(() => fin(false), maxMs);
      this._end = fin;
      v.addEventListener("ended", onEnd);
      v.loop = false;
      v.muted = false;
      const s = this.el && this.el.querySelector(".ap-sound");
      if (s) s.hidden = false;
      const p = v.paused ? v.play() : Promise.resolve();
      Promise.resolve(p).catch(() => { v.muted = true; v.play().catch(() => {}); });   // เบราว์เซอร์ไม่ให้เปิดเสียง → เล่นต่อแบบเงียบ
      if (v.ended) fin(true);
    });
  }

  close(reason = "done") {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    const v = el.querySelector("video");
    if (v) { try { v.pause(); } catch { /* ignore */ } }
    if (this._end) this._end(false);
    el.classList.remove("in");
    el.classList.add("out");
    setTimeout(() => el.remove(), 320);
    this.onClose(reason);
  }
}

/** ช่วงงดเสียง "12:00-13:00,16:30-07:30" (ใช้กับหน้าจอ) */
export function inQuietHours(spec, now = new Date()) {
  const cur = now.getHours() * 60 + now.getMinutes();
  for (const part of String(spec || "").split(",")) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(part);
    if (!m) continue;
    const s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4];
    if (s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e)) return true;
  }
  return false;
}

/** ประกาศระดับปกติต้องรอคุยจบไหม (ด่วน = ความสำคัญ 5 ไม่รอ) */
export function shouldWait({ priority = 0, phase = "attract", visitor = false, quietMs = Infinity, resumeAt = 0, now = Date.now(), endMs = 45000 } = {}) {
  if (priority >= 5) return false;
  if ((phase === "convo" || visitor) && quietMs < endMs) return true;
  return now < resumeAt;
}

/** การ์ดหมุนเวียนช่วงหน้าจอว่าง (ไม่พูด) */
export function promoCardHtml(p, lang = "th") {
  if (!p || p.kind === "none") return "";
  const L = lang === "en" ? "en" : "th";
  const k = kindOf(p);
  const title = (L === "en" && p.title_en ? p.title_en : p.title_th) || "";
  const image = SAFE.test(p.image || "") ? p.image : "";
  return `<div class="pc-pic"${image ? ` style="background-image:url('${esc(String(image).replace(/'/g, "%27"))}')"` : ""}>${image ? "" : `<span>${ICON[k] || "📢"}</span>`}</div>
    <div class="pc-t"><span class="pc-kind">${esc(KIND[L][k] || "")}</span><b>${esc(title)}</b></div>`;
}
