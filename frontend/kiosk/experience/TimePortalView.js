// Time Portal — ปฏิทินกิจกรรม (VORA NEXT Phase 5)
// ข้อมูลจาก /api/timeline เท่านั้น (ข่าวที่เผยแพร่และอยู่ในช่วงเผยแพร่ · เวลาไทย) — ไม่สร้างกำหนดการหรือสถานที่ขึ้นเอง
// - เวลา 00:00 ในฐานข้อมูล = "ไม่ระบุเวลา" (เซิร์ฟเวอร์ส่ง time = null)
// - ไม่มีสถานที่ = "ไม่ระบุสถานที่" · ออนไลน์ = "ออนไลน์" (+ ช่องทางถ้ามี) · ไม่มี QR แผนที่สำหรับออนไลน์
// - คำบรรยายเสียงพูดถึงเวลา/สถานที่เฉพาะเมื่อมีข้อมูลจริง

import { api, esc } from "/shared/api.js";

const TXT = {
  th: {
    title: "ปฏิทินกิจกรรม", lead: "กิจกรรมและกำหนดการจากข่าวที่วิทยาลัยเผยแพร่ · เวลาประเทศไทย",
    important: "วันสำคัญ (รับสมัคร)", today: "วันนี้", upcoming: "ที่จะมาถึง", past: "ที่ผ่านมา", undated: "ยังไม่ระบุวันที่",
    empty: "ยังไม่มีกิจกรรมที่เผยแพร่ในระบบ", noTime: "ไม่ระบุเวลา", noPlace: "ไม่ระบุสถานที่", noDate: "ไม่ระบุวันที่",
    types: { campus: "ภายในวิทยาลัย", external: "ภายนอกวิทยาลัย", online: "ออนไลน์" },
    inDays: (n) => (n === 0 ? "วันนี้" : n === 1 ? "พรุ่งนี้" : n > 0 ? `อีก ${n} วัน` : `${-n} วันที่แล้ว`),
    back: "กลับไปปฏิทิน", listen: "ฟัง VORA อธิบาย", qrMore: "สแกนดูรายละเอียดบนมือถือ", qrMap: "สแกนเพื่อนำทาง",
    date: "วันที่", time: "เวลา", place: "สถานที่", timeOf: (t) => `${t} น.`,
    say: ({ title, date, time, place, online }) =>
      `${title} ${date ? `วันที่ ${date}` : ""}${time ? ` เวลา ${time} นาฬิกา` : ""}${place ? ` ที่ ${place}` : online ? " จัดแบบออนไลน์" : ""} สแกน QR เพื่อดูรายละเอียดบนมือถือได้ค่ะ`,
  },
  en: {
    title: "Event calendar", lead: "Events and dates from the college's published news · Thailand time",
    important: "Key dates (admission)", today: "Today", upcoming: "Upcoming", past: "Past", undated: "Date not set",
    empty: "No published events yet", noTime: "Time not specified", noPlace: "Location not specified", noDate: "Date not set",
    types: { campus: "On campus", external: "Off campus", online: "Online" },
    inDays: (n) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : n > 0 ? `In ${n} days` : `${-n} days ago`),
    back: "Back to calendar", listen: "Hear VORA explain", qrMore: "Scan for details on your phone", qrMap: "Scan for directions",
    date: "Date", time: "Time", place: "Location", timeOf: (t) => t,
    say: ({ title, date, time, place, online }) =>
      `${title}${date ? `, on ${date}` : ""}${time ? ` at ${time}` : ""}${place ? `, at ${place}` : online ? ", held online" : ""}. Scan the QR code for details on your phone.`,
  },
};

/** "2026-11-06" -> "ศ. 6 พ.ย. 2569" (วันที่จากเซิร์ฟเวอร์เป็นวันตามเวลาไทยแล้ว — ไม่แปลงเขตเวลาซ้ำ) */
export function formatDay(iso, lang, { weekday = true, long = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "th-TH", {
    weekday: weekday ? (long ? "long" : "short") : undefined, day: "numeric", month: long ? "long" : "short", year: "numeric", timeZone: "UTC",
  }).format(d);
}

/** ข้อความสถานที่ตามข้อมูลจริง (ไม่อนุมาน) */
export function placeText(it, lang) {
  const t = TXT[lang] || TXT.th;
  if (!it.location_type) return { text: t.noPlace, known: false };
  const type = t.types[it.location_type] || it.location_type;
  if (it.location_type === "online") return { text: it.location ? `${type} · ${it.location}` : type, known: true, online: true };
  return { text: it.location ? `${it.location} (${type})` : type, known: !!it.location, name: it.location };
}

export class TimePortalView {
  /** actions: { say(text, gesture), qr(url) → svg, mobileUrl(), point() } */
  constructor(actions, lang = "th") {
    this.actions = actions;
    this.lang = lang;
    this.data = null;
    this.detailId = null;
  }

  get t() { return TXT[this.lang] || TXT.th; }
  setLang(lang) { this.lang = lang; this.data = null; }
  reset() { this.detailId = null; }

  async render(body, setHeader, alive) {
    const t = this.t;
    setHeader(t.title, t.lead);
    body.innerHTML = `<div class="present-state loading" role="status">…</div>`;
    const data = await api(`/api/timeline?lang=${this.lang}`);
    if (!alive()) return;
    this.data = data;
    this.body = body;
    this.setHeader = setHeader;
    if (this.detailId != null) {
      const it = this.find(this.detailId);
      if (it) return this.renderDetail(it, false);
      this.detailId = null;                  // ข่าวหมดอายุ/ถูกถอนระหว่างดู
    }
    this.renderList();
  }

  find(id) {
    const d = this.data || {};
    for (const g of ["important", "today_items", "upcoming", "past", "undated"]) {
      const it = (d[g] || []).find((x) => x.id === id);
      if (it) return it;
    }
    return null;
  }

  row(it, i) {
    const t = this.t, pl = placeText(it, this.lang);
    const when = it.date ? `<span class="tp-d"><b>${esc(formatDay(it.date, this.lang))}</b>${it.time ? ` · ${esc(t.timeOf(it.time))}` : ` · <i>${esc(t.noTime)}</i>`}</span>`
      : `<span class="tp-d"><i>${esc(t.noDate)}</i></span>`;
    const rel = it.days_until != null ? `<span class="tp-rel${it.important ? " imp" : ""}">${esc(t.inDays(it.days_until))}</span>` : "";
    return `<li><button type="button" class="tp-item${it.important ? " imp" : ""}" style="--i:${i}" data-tp="${it.id}">
      ${when}${rel}<span class="tp-t">${esc(it.title)}</span>
      <span class="tp-p${pl.known || pl.online ? "" : " none"}" data-type="${esc(it.location_type || "")}">${esc(pl.text)}</span></button></li>`;
  }

  renderList() {
    const t = this.t, d = this.data;
    const groups = [["important", d.important], ["today", d.today_items], ["upcoming", d.upcoming], ["past", d.past], ["undated", d.undated]]
      .filter(([, items]) => items && items.length);
    this.setHeader(t.title, t.lead);
    if (!groups.length) {
      this.body.innerHTML = `<div class="present-state empty" role="status">${esc(t.empty)}</div>`;
      return;
    }
    let i = 0;
    this.body.innerHTML = `<div class="tp">${groups.map(([key, items]) => `<section class="tp-g" data-group="${key}">
      <h3 class="pgroup">${esc(t[key])} <small>${items.length}</small></h3><ol class="tp-list">${items.map((it) => this.row(it, i++)).join("")}</ol></section>`).join("")}</div>`;
    this.body.querySelectorAll("[data-tp]").forEach((b) => (b.onclick = () => {
      const it = this.find(+b.dataset.tp);
      if (it) { this.detailId = it.id; this.renderDetail(it, true); }
    }));
  }

  speech(it) {
    const pl = placeText(it, this.lang);
    return this.t.say({
      title: it.title, date: it.date ? formatDay(it.date, this.lang, { long: true }) : "", time: it.time,
      place: it.location_type && it.location_type !== "online" && it.location ? it.location : "", online: it.location_type === "online" && pl.online,
    });
  }

  renderDetail(it, speak) {
    const t = this.t, pl = placeText(it, this.lang);
    this.setHeader(it.title, it.important ? t.important : t.title);
    const more = `${this.actions.mobileUrl().replace(/\/?$/, "/")}?news=${it.id}`;
    const showMap = !!it.location_map_url && it.location_type !== "online";
    this.body.innerHTML = `<article class="tp-detail">
      <div class="tp-facts">
        <p><span>${esc(t.date)}</span><b>${it.date ? esc(formatDay(it.date, this.lang, { long: true })) : `<i>${esc(t.noDate)}</i>`}</b></p>
        <p><span>${esc(t.time)}</span><b>${it.time ? esc(t.timeOf(it.time)) : `<i>${esc(t.noTime)}</i>`}</b></p>
        <p><span>${esc(t.place)}</span><b class="${pl.known || pl.online ? "" : "none"}">${esc(pl.text)}</b></p>
        ${it.body ? `<p class="tp-body">${esc(it.body)}</p>` : ""}
        <div class="jnav"><button type="button" class="ghost tp-back">← ${esc(t.back)}</button><button type="button" class="primary tp-listen">${esc(t.listen)}</button></div>
      </div>
      <div class="tp-qrs">
        <figure class="tp-qr"><div class="qr">${this.actions.qr(more) || ""}</div><figcaption>${esc(t.qrMore)}</figcaption></figure>
        ${showMap ? `<figure class="tp-qr map"><div class="qr">${this.actions.qr(it.location_map_url) || ""}</div><figcaption>${esc(t.qrMap)}</figcaption></figure>` : ""}
      </div></article>`;
    this.body.querySelector(".tp-back").onclick = () => { this.detailId = null; this.renderList(); };
    this.body.querySelector(".tp-listen").onclick = () => this.actions.say(this.speech(it), "point_screen");
    if (speak) { this.actions.point && this.actions.point(); this.actions.say(this.speech(it), "point_screen"); }
  }
}
