// ป็อปอัพข้อมูลวิทยาลัย (12 พ.ย. 2569) — ใช้กรอบกระจกเดียวกับผลค้นเว็บ (.webpop / .wp-card)
//  SitePopup        : ผู้ใช้ถามถึงเว็บไซต์วิทยาลัย → แสดงหน้าเว็บจริงในกรอบ + คิวอาร์โค้ดเปิดบนมือถือ
//                     (เว็บที่ห้ามแสดงในกรอบ ตรวจจาก /api/site/check → แสดงคิวอาร์โค้ดขนาดใหญ่แทน)
//  ApplyOnlinePopup : ขั้นตอนสมัครเรียนออนไลน์ที่เจ้าหน้าที่กรอกในหลังบ้าน → ทีละขั้น ฟังทีละขั้นได้ + คิวอาร์โค้ดไปเว็บสมัคร
import { api, esc } from "/shared/api.js";

const T = {
  th: { site: "เว็บไซต์วิทยาลัย", scan: "สแกนเพื่อเปิดเว็บไซต์บนมือถือ", close: "ปิด", loading: "กำลังเปิดหน้าเว็บ…",
    blocked: "เว็บไซต์นี้ไม่อนุญาตให้แสดงบนหน้าจออื่น สแกนคิวอาร์โค้ดเพื่อเปิดบนมือถือได้เลยค่ะ",
    apply: "ขั้นตอนสมัครเรียนออนไลน์", step: (i, n) => `ขั้นที่ ${i} จาก ${n}`, prev: "ก่อนหน้า", next: "ถัดไป", listen: "🔊 ฟังขั้นนี้",
    scanApply: "สแกนเพื่อเปิดเว็บสมัครเรียน", contact: "สอบถามการสมัคร", stepSay: (i, s) => `ขั้นที่ ${i} ${s}`,
    relKicker: (q) => `เว็บไซต์ที่เกี่ยวกับ ${q}`, related: "เว็บไซต์ที่เกี่ยวข้อง (แตะเพื่อดู)", relNote: "สรุปโดย AI จากผลค้นบนอินเทอร์เน็ต อาจคลาดเคลื่อนได้",
    about: "รู้จักวิทยาลัย", aboutNote: "สแกนคิวอาร์โค้ดเพื่อติดต่อหรือติดตามวิทยาลัยบนมือถือ" },
  en: { site: "College website", scan: "Scan to open the website on your phone", close: "Close", loading: "Opening the website…",
    blocked: "This website can't be shown inside another screen. Scan the QR code to open it on your phone.",
    apply: "Apply online", step: (i, n) => `Step ${i} of ${n}`, prev: "Back", next: "Next", listen: "🔊 Read this step",
    scanApply: "Scan to open the application website", contact: "Admission enquiries", stepSay: (i, s) => `Step ${i}. ${s}`,
    relKicker: (q) => `Websites about ${q}`, related: "Related websites (tap to view)", relNote: "Summarised by AI from internet search results and may contain mistakes",
    about: "About the college", aboutNote: "Scan a QR code to contact or follow the college on your phone" },
};
export const INFO_POPUP_MS = 5 * 60 * 1000;

class BasePopup {
  constructor(mount, actions) { this.mount = mount; this.actions = actions; this.el = null; this.timer = null; }
  get open() { return !!this.el; }
  frame(lang, kicker, title, body, foot = "") {
    this.close();
    const t = T[lang === "en" ? "en" : "th"];
    const el = document.createElement("section");
    el.className = "webpop infopop";
    el.setAttribute("role", "dialog");
    el.innerHTML = `<div class="wp-card"><header class="wp-head"><div><span class="wp-kicker">${kicker}</span><h2>${esc(title)}</h2></div>
      <div class="wp-tools"><button type="button" class="wp-x" aria-label="${esc(t.close)}">×</button></div></header>${body}${foot}</div>`;
    this.mount.appendChild(el);
    this.el = el;
    el.querySelector(".wp-x").onclick = () => this.close();
    this.timer = setTimeout(() => this.close(), INFO_POPUP_MS);
    return { el, t };
  }
  close() { clearTimeout(this.timer); if (this.el) this.el.remove(); this.el = null; }
}

export class SitePopup extends BasePopup {
  /** actions: { qr(url) → svg }
   *  site: { url, title, embeddable?, kind?, summary?, points?, related?: [{url,title,embeddable}], topic? }
   *  12 พ.ย. 2569 (รอบ 3): kind=related → สรุปเนื้อหา + เว็บที่เกี่ยวข้อง (แตะเพื่อสลับเว็บที่แสดงบนจอ) */
  async show(site, lang = "th") {
    if (!site || !site.url) return;
    const t0 = T[lang === "en" ? "en" : "th"];
    const rel = site.kind === "related";
    const list = rel ? [{ url: site.url, title: site.title, embeddable: site.embeddable }, ...(site.related || [])] : [];
    const short = (u) => (u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    const info = rel && (site.summary || (site.points || []).length) ? `<div class="ip-sum">${site.summary ? `<p>${esc(site.summary)}</p>` : ""}
        ${(site.points || []).length ? `<ul>${site.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}<p class="ip-note">${esc(t0.relNote)}</p></div>` : "";
    const links = list.length > 1 ? `<div class="ip-rel"><h3>${esc(t0.related)}</h3>${list.map((x, i) => `<button type="button" class="ip-link${i ? "" : " on"}" data-i="${i}">
        <b>${esc(x.title || short(x.url))}</b><span>${esc(short(x.url))}</span></button>`).join("")}</div>` : "";
    const { el, t } = this.frame(lang, `🌐 ${esc(rel ? t0.relKicker(site.topic || "") : t0.site)}`, rel ? (site.topic || site.title) : (site.title || site.url),
      `<div class="wp-body ip-site${rel ? " rel" : ""}"><div class="ip-main">${info}<div class="ip-frame"><p class="ip-wait">${esc(t0.loading)}</p></div></div>
        <aside class="ip-side"><div class="ip-qr"><div class="qr"></div><p class="ip-scan"></p><p class="qr-url"></p></div>${links}</aside></div>`);
    el.querySelector(".ip-scan").textContent = t.scan;
    const open = async (x) => {
      el.querySelector(".ip-qr .qr").innerHTML = this.actions.qr(x.url) || "";
      el.querySelector(".ip-qr .qr-url").textContent = short(x.url);
      el.querySelectorAll(".ip-link").forEach((b) => b.classList.toggle("on", list[+b.dataset.i] === x));
      // เซิร์ฟเวอร์ตรวจไว้แล้ว (embeddable) · ไม่มีผลตรวจ = เว็บวิทยาลัย → ถาม /api/site/check
      let check = { embeddable: true, url: x.url };
      if (typeof x.embeddable === "boolean") check = { embeddable: x.embeddable, url: x.url };
      else { try { check = await api("/api/site/check", { timeout: 8000 }); } catch { /* ตรวจไม่ได้ → ลองแสดง */ } }
      if (this.el !== el) return;
      const box = el.querySelector(".ip-frame");
      if (check && check.embeddable === false) {
        box.classList.add("blocked");
        box.innerHTML = `<p class="ip-blocked">${esc(t.blocked)}</p>`;
        el.querySelector(".ip-site").classList.add("qr-only");
        return;
      }
      box.classList.remove("blocked");
      el.querySelector(".ip-site").classList.remove("qr-only");
      // sandbox: ให้เว็บทำงานได้ แต่เปิดหน้าต่างใหม่/เปลี่ยนหน้าหลักของตู้ไม่ได้
      box.innerHTML = `<iframe src="${esc((check && check.url) || x.url)}" title="${esc(x.title || x.url)}" referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms" loading="eager"></iframe>`;
    };
    el.querySelectorAll(".ip-link").forEach((b) => (b.onclick = () => open(list[+b.dataset.i])));
    await open(list[0] || { url: site.url, title: site.title, embeddable: site.embeddable });
  }
}

export class ApplyOnlinePopup extends BasePopup {
  /** actions: { qr(url) → svg, say(text) → Promise } */
  show(a, lang = "th") {
    if (!a || !(a.steps || []).length) return;
    const tt = T[lang === "en" ? "en" : "th"];
    const n = a.steps.length;
    const steps = a.steps.map((s, i) => `<li class="ip-step" data-i="${i}"><span class="ip-num">${i + 1}</span><span>${esc(s)}</span></li>`).join("");
    const qr = a.url ? `<aside class="ip-qr"><div class="qr">${this.actions.qr(a.url) || ""}</div><p class="ip-scan">${esc(tt.scanApply)}</p>
      <p class="qr-url">${esc(a.url.replace(/^https?:\/\//, ""))}</p></aside>` : "";
    const contact = a.contact ? `<p class="ip-contact"><b>${esc(tt.contact)}:</b> ${esc(a.contact)}</p>` : "";
    const { el, t } = this.frame(lang, `📝 ${esc(tt.apply)}`, tt.apply,
      `<div class="wp-body ip-apply${a.url ? "" : " noqr"}"><div><ol class="ip-steps">${steps}</ol>${contact}</div>${qr}</div>`,
      `<footer class="wp-foot ip-nav"><span class="ip-pos" aria-live="polite"></span><button type="button" class="ghost ip-prev">‹ ${esc(tt.prev)}</button>
        <button type="button" class="ghost ip-say">${esc(tt.listen)}</button><button type="button" class="primary ip-next">${esc(tt.next)} ›</button></footer>`);
    let cur = 0;
    const set = (i) => {
      cur = Math.max(0, Math.min(n - 1, i));
      el.querySelectorAll(".ip-step").forEach((li) => { li.classList.toggle("on", +li.dataset.i === cur); li.classList.toggle("done", +li.dataset.i < cur); });
      el.querySelector(".ip-pos").textContent = t.step(cur + 1, n);
      el.querySelector(".ip-prev").disabled = cur === 0;
      el.querySelector(".ip-next").disabled = cur === n - 1;
      const on = el.querySelector(".ip-step.on");
      if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    const sayStep = () => this.actions.say && this.actions.say(t.stepSay(cur + 1, a.steps[cur]));
    el.querySelector(".ip-prev").onclick = () => { set(cur - 1); sayStep(); };
    el.querySelector(".ip-next").onclick = () => { set(cur + 1); sayStep(); };
    el.querySelector(".ip-say").onclick = sayStep;
    el.querySelectorAll(".ip-step").forEach((li) => (li.onclick = () => { set(+li.dataset.i); sayStep(); }));
    set(0);
  }
}


// ---------------------------------------------------------------- 12 พ.ย. 2569: แนะนำวิทยาลัย — ช่องทางติดต่อ + ภาพประกอบ (แสดงหลังพูดจบ)
const ICON = { website: "🌐", facebook: "📘", line: "💬", map: "📍", phone: "📞" };

export class AboutPopup extends BasePopup {
  /** actions: { qr(url) → svg } · card: { title, contacts: [{kind,label,url?,text?}], images: [] } */
  show(card, lang = "th") {
    if (!card || !(card.contacts || []).length) return;
    const tt = T[lang === "en" ? "en" : "th"];
    const imgs = (card.images || []).filter(Boolean);
    const short = (u) => (u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    const items = card.contacts.map((c, i) => `<article class="ab-c ab-${esc(c.kind)}" style="--i:${i}">
        <div class="ab-ic" aria-hidden="true">${ICON[c.kind] || "ℹ️"}</div>
        <div class="ab-tx"><h3>${esc(c.label)}</h3>${c.text ? `<p>${esc(c.text)}</p>` : ""}${c.url ? `<p class="ab-url">${esc(short(c.url))}</p>` : ""}</div>
        ${c.url ? `<div class="qr ab-qr">${this.actions.qr(c.url) || ""}</div>` : ""}</article>`).join("");
    const media = imgs.length ? `<figure class="ab-media"><div class="ab-slides">${imgs.map((u, i) => `<img src="${esc(u)}" alt="" class="${i ? "" : "on"}" loading="lazy">`).join("")}</div>
        ${imgs.length > 1 ? `<div class="ab-dots">${imgs.map((_, i) => `<span class="${i ? "" : "on"}"></span>`).join("")}</div>` : ""}</figure>`
      : `<figure class="ab-media ab-logo"><img src="/assets/icon.svg" alt=""></figure>`;
    const { el } = this.frame(lang, `🏫 ${esc(tt.about)}`, card.title || tt.about,
      `<div class="wp-body ab-body">${media}<div class="ab-list">${items}</div></div>`,
      `<footer class="wp-foot"><p class="wp-note">${esc(tt.aboutNote)}</p></footer>`);
    el.querySelectorAll("img").forEach((img) => (img.onerror = () => img.remove()));
    if (imgs.length > 1) {
      let k = 0;
      const tick = setInterval(() => {
        if (this.el !== el) return clearInterval(tick);
        const sl = el.querySelectorAll(".ab-slides img"), dots = el.querySelectorAll(".ab-dots span");
        if (!sl.length) return clearInterval(tick);
        k = (k + 1) % sl.length;
        sl.forEach((x, i) => x.classList.toggle("on", i === k));
        dots.forEach((x, i) => x.classList.toggle("on", i === k));
      }, 4000);
    }
  }
}
