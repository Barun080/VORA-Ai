// 24 พ.ย. 2569: ป๊อปอัปนำเสนอสิ่งที่กล้องจำได้ (ป้าย / โปสเตอร์ / กิจกรรม / วัตถุ / ผลิตภัณฑ์)
//  - สไลด์รูปหลายรูป (ซูมช้าแบบ Ken Burns) · การ์ดกระจก · เปิดด้วยวงแสง + ประกาย
//  - แสดงรายละเอียดตามประเภท · คิวอาร์โค้ดถ้ามีลิงก์ · ปุ่มคำถามแนะนำ (แตะ = ถามต่อ)
//  - ขณะเปิดอยู่ หน้าจอส่ง vision_item_id ไปกับคำถาม → เซิร์ฟเวอร์ตอบจากข้อมูลของสิ่งนี้ / ถามเรื่องอื่น = ปิดเอง
//  - ปิดเมื่อ: กดปิด / พูด "ปิด" "ขอบคุณ" / ไม่มีคนถามต่อ idleMs (ค่าเริ่มต้น 60 วินาที) / ไม่มีคนหน้าจอ
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));   // ไม่ import เพื่อให้ทดสอบด้วย node ได้

const ICON = { meaning: "💡", department: "🏫", location: "📍", extra: "📝", detail: "📝", start_date: "📅", end_date: "⏳", date: "📅",
  organizer: "🎪", eligibility: "🙋", how_to_join: "✍️", people: "👥", result: "🏅", purpose: "🛠️", caution: "⚠️", maker: "👩‍🍳",
  highlights: "✨", price: "🏷️", award: "🏆" };
const ASK = {
  th: { sign: ["หมายถึงอะไร", "อยู่ที่ไหน", "เป็นของแผนกไหน"], poster: ["จัดที่ไหน", "จัดวันไหน", "ใครเข้าร่วมได้", "สมัครยังไง"],
    event: ["จัดเมื่อไหร่", "จัดที่ไหน", "ใครเกี่ยวข้อง", "ได้รางวัลอะไร"], object: ["ใช้ทำอะไร", "แผนกไหนใช้", "ข้อควรระวัง"],
    product: ["ราคาเท่าไหร่", "ใครทำ", "มีจุดเด่นอะไร"] },
  en: { sign: ["What does it mean?", "Where is it?"], poster: ["Where is it held?", "When is it?", "Who can join?"],
    event: ["When was it?", "Where was it?"], object: ["What is it for?"], product: ["How much is it?", "Who made it?"] },
};
const T = {
  th: { close: "ปิด", hint: "ถามต่อได้เลย หรือแตะคำถามด้านล่าง", scan: "สแกนเพื่อเปิดลิงก์", expired: "หมดอายุแล้ว", last: "คำตอบล่าสุด" },
  en: { close: "Close", hint: "Ask me more, or tap a question below", scan: "Scan to open the link", expired: "Expired", last: "Latest answer" },
};

/** HTML ของป๊อปอัป (ฟังก์ชันล้วน — ทดสอบด้วย node ได้) */
export function visionPopupHtml(item, lang = "th", { qr = () => "" } = {}) {
  const t = T[lang === "en" ? "en" : "th"];
  const imgs = (item.images || []).filter((u) => /^(\/uploads\/|https?:\/\/|data:image\/)/.test(u || ""));
  const slides = imgs.length ? imgs.map((u, i) => `<div class="vp-slide${i ? "" : " on"}" style="--img:url('${esc(u).replace(/'/g, "%27")}')"></div>`).join("")
    : `<div class="vp-slide on vp-noimg"><span>${esc(item.icon || "👁")}</span></div>`;
  const dots = imgs.length > 1 ? `<div class="vp-dots">${imgs.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : "";
  const fields = (item.fields || []).map((f, i) => `<li style="--d:${0.25 + i * 0.07}s" data-k="${esc(f.key)}"><span class="vp-ic">${ICON[f.key] || "•"}</span>
      <div><b>${esc(f.label)}</b><p>${esc(f.value)}</p></div></li>`).join("");
  const link = /^https?:\/\//i.test(item.link || "") ? `<div class="vp-qr"><div class="qr">${qr(item.link) || ""}</div><small>${esc(t.scan)}</small></div>` : "";
  const asks = (ASK[lang === "en" ? "en" : "th"][item.kind] || []).map((q) => `<button type="button" class="vp-ask" data-q="${esc(q)}">${esc(q)}</button>`).join("");
  return `<div class="vp-backdrop"></div><div class="vp-ring"></div>
    <article class="vp-card" role="dialog" aria-label="${esc(item.title)}">
      <div class="vp-media">${slides}${dots}<span class="vp-shine"></span></div>
      <div class="vp-info">
        <header><span class="vp-kind">${esc(item.icon || "")} ${esc(item.kind_label || "")}</span>${item.expired ? `<span class="vp-exp">${esc(t.expired)}</span>` : ""}
          <button type="button" class="vp-x" aria-label="${esc(t.close)}">×</button></header>
        <h2 class="vp-title">${esc(item.title)}</h2>
        <ul class="vp-fields">${fields}</ul>
        ${link}
        <div class="vp-answer" hidden><b>${esc(t.last)}</b><p></p></div>
        <footer><p class="vp-hint">🎤 ${esc(t.hint)}</p><div class="vp-asks">${asks}</div><div class="vp-timer"><i></i></div></footer>
      </div>
      <div class="vp-sparks">${Array.from({ length: 14 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>
    </article>`;
}

export class VisionPopup {
  /** actions: { qr(url) → svg, ask(text), onClose(reason) } · opts: { idleMs } */
  constructor(mount, actions = {}, { idleMs = 60000 } = {}) {
    this.mount = mount; this.actions = actions; this.idleMs = idleMs;
    this.el = null; this.item = null; this.slideTimer = null; this.idleTimer = null;
  }
  get open() { return !!this.el; }
  get itemId() { return this.item ? this.item.id : null; }

  show(item, lang = "th") {
    if (!item) return;
    if (this.el && this.item && this.item.id === item.id) { this.update(item); return; }
    this.close("replace");
    const el = document.createElement("section");
    el.className = "vpop";
    el.innerHTML = visionPopupHtml(item, lang, { qr: this.actions.qr || (() => "") });
    this.mount.appendChild(el);
    this.el = el; this.item = item;
    el.querySelector(".vp-x").onclick = () => this.close("button");
    el.querySelector(".vp-backdrop").onclick = () => this.close("backdrop");
    el.querySelectorAll(".vp-ask").forEach((b) => (b.onclick = () => { this.keepAlive(); this.actions.ask && this.actions.ask(b.dataset.q); }));
    requestAnimationFrame(() => el.classList.add("in"));
    this.startSlides();
    this.keepAlive();
  }

  /** คำตอบถามต่อ → แสดงในกล่อง "คำตอบล่าสุด" และไฮไลต์การ์ด */
  update(item, answerText = "") {
    if (!this.el) return;
    if (answerText) {
      const box = this.el.querySelector(".vp-answer");
      box.hidden = false;
      box.querySelector("p").textContent = answerText;
      box.classList.remove("pop"); void box.offsetWidth; box.classList.add("pop");
    }
    this.keepAlive();
  }

  keepAlive() {
    if (!this.el) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close("idle"), this.idleMs);
    const bar = this.el.querySelector(".vp-timer i");
    if (bar) { bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = `vp-count ${this.idleMs}ms linear forwards`; }
  }

  startSlides() {
    clearInterval(this.slideTimer);
    const slides = this.el.querySelectorAll(".vp-slide"), dots = this.el.querySelectorAll(".vp-dots i");
    if (slides.length < 2) return;
    let i = 0;
    this.slideTimer = setInterval(() => {
      slides[i].classList.remove("on"); dots[i] && dots[i].classList.remove("on");
      i = (i + 1) % slides.length;
      slides[i].classList.add("on"); dots[i] && dots[i].classList.add("on");
    }, 4500);
  }

  close(reason = "close") {
    clearInterval(this.slideTimer); clearTimeout(this.idleTimer);
    if (!this.el) return;
    const el = this.el;
    this.el = null; this.item = null;
    el.classList.remove("in"); el.classList.add("out");
    setTimeout(() => el.remove(), 380);
    if (reason !== "replace" && this.actions.onClose) this.actions.onClose(reason);
  }
}
