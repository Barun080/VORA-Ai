// หน้าต่างผลการค้นข้อมูลจากอินเทอร์เน็ต (11 พ.ย. 2569)
// ป็อปอัพกลางจอ พื้นหลังโปร่งใสแบบกระจก (ใช้สีของธีมปัจจุบัน ทั้งมืดและสว่าง) · แสดง: หัวข้อ รูปประกอบ สรุป ประเด็นสำคัญ แหล่งที่มา
// ถามกลับว่า "ข้อมูลถูกต้องไหม" → บันทึกผลตอบรับ · อยู่ได้ 5 นาทีแล้วปิดเอง (ตอบได้ภายในเวลานี้)
import { esc } from "/shared/api.js";

const TXT = {
  th: { kicker: "ข้อมูลจากอินเทอร์เน็ต", points: "ประเด็นสำคัญ", sources: "แหล่งที่มา", ask: "ข้อมูลที่หามานี้ถูกต้องไหม?",
    yes: "ถูกต้อง", no: "ไม่ถูกต้อง", thanks: "ขอบคุณสำหรับความคิดเห็นค่ะ", close: "ปิด", left: (m, s) => `ปิดอัตโนมัติใน ${m}:${s}`,
    note: "สรุปโดย AI จากแหล่งข้อมูลบนอินเทอร์เน็ต อาจคลาดเคลื่อนได้ · ไม่ใช่ข้อมูลทางการของวิทยาลัย", imgCredit: "ภาพ: Wikipedia / Wikimedia" },
  en: { kicker: "From the internet", points: "Key points", sources: "Sources", ask: "Is this information correct?",
    yes: "Correct", no: "Not correct", thanks: "Thanks for your feedback!", close: "Close", left: (m, s) => `Closes in ${m}:${s}`,
    note: "Summarised by AI from internet sources and may contain mistakes · not official college information", imgCredit: "Images: Wikipedia / Wikimedia" },
};
export const WEB_POPUP_MS = 5 * 60 * 1000;

export class WebPopup {
  /** actions: { feedback(rating, data) → Promise, onAnswered(rating) } */
  constructor(mount, actions) {
    this.mount = mount;
    this.actions = actions;
    this.el = null;
    this.data = null;
    this.timer = null;
    this.tick = null;
    this.answered = null;
  }

  get open() { return !!this.el; }

  show(data, messageId, lang = "th") {
    this.close();
    const t = TXT[lang === "en" ? "en" : "th"];
    this.t = t;
    this.data = data;
    this.messageId = messageId;
    this.answered = null;
    this.until = Date.now() + WEB_POPUP_MS;
    const imgs = (data.images || []).filter((x) => x && x.url);
    const hero = imgs[0];
    const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
    const el = document.createElement("section");
    el.className = "webpop";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-labelledby", "webpopTitle");
    el.innerHTML = `<div class="wp-card">
      <header class="wp-head"><div><span class="wp-kicker">🌐 ${esc(t.kicker)}</span><h2 id="webpopTitle">${esc(data.title || data.query || "")}</h2></div>
        <div class="wp-tools"><span class="wp-left" aria-live="off"></span><button type="button" class="wp-x" aria-label="${esc(t.close)}">×</button></div></header>
      <div class="wp-body${hero ? "" : " noimg"}">
        ${hero ? `<figure class="wp-media"><img class="wp-hero" src="${esc(hero.url)}" alt="${esc(hero.title || "")}">
          ${imgs.length > 1 ? `<div class="wp-thumbs">${imgs.map((x, i) => `<button type="button" class="wp-th${i ? "" : " on"}" data-i="${i}"><img src="${esc(x.url)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
          <figcaption>${esc(t.imgCredit)}</figcaption></figure>` : ""}
        <div class="wp-text"><p class="wp-sum">${esc(data.summary || "")}</p>
          ${(data.points || []).length ? `<h3>${esc(t.points)}</h3><ul class="wp-points">${data.points.map((p, i) => `<li style="--i:${i}">${esc(p)}</li>`).join("")}</ul>` : ""}
          ${(data.sources || []).length ? `<h3>${esc(t.sources)}</h3><ul class="wp-src">${data.sources.map((s) => `<li>${esc(s.title || domain(s.url))}</li>`).join("")}</ul>` : ""}
        </div></div>
      <footer class="wp-foot"><span class="wp-ask">${esc(t.ask)}</span>
        <button type="button" class="primary wp-yes">✓ ${esc(t.yes)}</button><button type="button" class="ghost wp-no">✗ ${esc(t.no)}</button>
        <p class="wp-note">${esc(t.note)}</p></footer></div>`;
    this.mount.appendChild(el);
    this.el = el;
    el.querySelector(".wp-x").onclick = () => this.close();
    el.querySelector(".wp-yes").onclick = () => this.answer(1);
    el.querySelector(".wp-no").onclick = () => this.answer(-1);
    el.querySelectorAll(".wp-th").forEach((b) => (b.onclick = () => {
      const x = imgs[+b.dataset.i];
      el.querySelector(".wp-hero").src = x.url;
      el.querySelectorAll(".wp-th").forEach((o) => o.classList.toggle("on", o === b));
    }));
    el.querySelectorAll("img").forEach((img) => (img.onerror = () => { const f = img.closest(".wp-th") || (img.classList.contains("wp-hero") ? img.closest("figure") : null); if (f) f.remove(); }));
    const left = el.querySelector(".wp-left");
    const upd = () => {
      const ms = Math.max(0, this.until - Date.now());
      left.textContent = t.left(Math.floor(ms / 60000), String(Math.floor((ms % 60000) / 1000)).padStart(2, "0"));
    };
    upd();
    this.tick = setInterval(upd, 1000);
    this.timer = setTimeout(() => this.close(), WEB_POPUP_MS);
  }

  /** ผู้ใช้ตอบว่าข้อมูลถูกต้องหรือไม่ (ปุ่ม หรือท่าชูนิ้ว) — ภายใน 5 นาที */
  async answer(rating) {
    if (!this.el || this.answered !== null || Date.now() > this.until) return false;
    this.answered = rating;
    const foot = this.el.querySelector(".wp-foot");
    foot.querySelectorAll("button").forEach((b) => (b.disabled = true));
    foot.querySelector(rating > 0 ? ".wp-yes" : ".wp-no").classList.add("chosen");
    foot.querySelector(".wp-ask").textContent = this.t.thanks;
    try { await this.actions.feedback(rating, { messageId: this.messageId, query: this.data && this.data.query }); } catch { /* บันทึกไม่ได้ ไม่กระทบการใช้งาน */ }
    this.actions.onAnswered && this.actions.onAnswered(rating);
    return true;
  }

  close() {
    clearTimeout(this.timer);
    clearInterval(this.tick);
    if (this.el) this.el.remove();
    this.el = null;
  }
}
