// VORA หลังบ้าน — วางแผน "เตรียมเสียงล่วงหน้า" (งาน F "สาธิตไม่สะดุด" · 21 พ.ย. 2569)
// ไม่มีโค้ดเบราว์เซอร์ · ทดสอบด้วย node ได้ (frontend/tests/kiosk/offline-mode.test.mjs)
// ข้อความแต่ละข้อต้องผ่าน speechText() ตัวเดียวกับหน้าจอหุ่น (kiosk/voice/speech-text.js) ก่อนส่งไปเตรียมเสียง
// เพราะเซิร์ฟเวอร์ค้นไฟล์เสียงด้วย "ข้อความที่พูดจริงทั้งข้อความ" — ต่างกันแม้ตัวอักษรเดียว = ค้นไม่เจอ

export const KIND_TH = Object.freeze({
  system: "ข้อความระบบ", quick: "คำถามยอดฮิต", program: "สาขาวิชา", faq: "ฐานความรู้",
  greeting: "คำทักทาย", announce: "ประกาศอัตโนมัติ", guide: "แนะนำการใช้งาน",
});
export const KIND_ORDER = Object.freeze(["system", "quick", "greeting", "guide", "program", "faq", "announce"]);

/** ข้อความ VORA Guide (ข้อความที่แสดง = ข้อความที่พูด) → รายการแบบเดียวกับ /api/admin/offline/phrases */
export function guidePhrases(steps) {
  const out = [];
  for (const s of steps || []) for (const lang of ["th", "en"]) if (s[lang] && s[lang].body) out.push({ kind: "guide", label: s[lang].title || s.id, lang, text: s[lang].body });
  return out;
}

/** รวมรายการ → แปลงเป็นข้อความที่จะพูด → ตัดซ้ำ (ภาษา + ข้อความพูด) → เรียงตามความสำคัญ */
export function buildPlan(items, speechText) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const lang = it.lang === "en" ? "en" : "th";
    const speech = speechText(it.text || "");
    if (!speech) continue;
    const key = `${lang}|${speech}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: it.kind || "system", label: it.label || "", lang, text: speech, pinned: false, error: "" });
  }
  const rank = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? 99 : i; };
  return out.sort((a, b) => rank(a.kind) - rank(b.kind));
}

/** สรุปรายประเภท: { kind: { total, ready } } + รวม */
export function summarize(plan) {
  const by = {};
  let total = 0, ready = 0;
  for (const p of plan || []) {
    const s = (by[p.kind] = by[p.kind] || { total: 0, ready: 0 });
    s.total++; total++;
    if (p.pinned) { s.ready++; ready++; }
  }
  return { by, total, ready };
}
