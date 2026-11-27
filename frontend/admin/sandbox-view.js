// 24 พ.ย. 2569: กล่องตรวจข้อมูล (Sandbox) — สร้าง HTML ของการ์ดแต่ละรายการ (ฟังก์ชันล้วน ทดสอบด้วย node ได้)
// ข้อความทุกช่องผ่าน esc() · ลิงก์เปิดแท็บใหม่แบบ noopener
export const EVIDENCE_TH = {
  A: ["ต้นฉบับตรง", "ok", "เปิดต้นฉบับแล้วข้อมูลตรง แต่ต้องยืนยันว่ายังเป็นปัจจุบัน"],
  B: ["ข้อมูลเก่า/กรอบส่วนกลาง", "draft", "เอกสารทางการแต่เป็นข้อมูลย้อนหลังหรือกรอบกลาง ไม่ใช่ของวิทยาลัยปีนี้"],
  C: ["ยังไม่เปิดต้นฉบับ", "pending", "มาจากข่าวหรือสรุปของ Perplexity — เปิดลิงก์ต้นฉบับตรวจก่อน"],
  U: ["แหล่งขัดกัน", "rejected", "สองแหล่งให้ข้อมูลไม่ตรงกัน — เลือกตัวเลือกที่ถูกต้อง"],
};
export const SB_STATUS = { pending: "รอตรวจ", approved: "อนุมัติแล้ว", rejected: "ปฏิเสธ" };
export function sandboxCard(c, { canApprove = false, esc, badge, fmt }) {
  const ev = EVIDENCE_TH[c.evidence] || EVIDENCE_TH.U;
  const srcs = (c.sources || []).map((s) => `<li><a href="${/^https?:\/\//i.test(s.url || "") ? esc(s.url) : "#"}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join("");
  const choices = (c.choices || []).map((o, i) => `<label class="sb-choice"><input type="radio" name="ch${c.id}" value="${i}" ${i === 0 ? "checked" : ""}>
      <b>${esc(o.label)}</b><span>${esc(o.answer_th)}</span></label>`).join("");
  const alts = (c.alt_questions || "").split("\n").filter(Boolean);
  return `<article class="panel sb-card" data-id="${c.id}">
    <div class="row"><h3 class="grow">${esc(c.question)}</h3>${badge(ev[1], ev[0])} ${c.data_year ? badge("draft", `ข้อมูลปี ${c.data_year}`) : ""} ${badge(c.status, SB_STATUS[c.status] || c.status)}</div>
    ${alts.length ? `<p class="muted">ถามแบบอื่น: ${alts.map(esc).join(" · ")}</p>` : ""}
    <p class="sb-why"><b>ทำไมต้องตรวจ:</b> ${esc(c.reason)} <span class="muted">(${esc(ev[2])})</span></p>
    ${choices ? `<div class="sb-choices"><b>เลือกคำตอบที่ถูกต้อง</b>${choices}</div>` : `<p class="sb-answer"><b>คำตอบที่เสนอ:</b> ${esc(c.answer_th)}</p>`}
    <details><summary>แหล่งอ้างอิง (${(c.sources || []).length})</summary><ul>${srcs}</ul></details>
    ${c.status === "pending" && canApprove ? `<div class="row actions-row"><button class="btn primary sm" data-sb-ok="${c.id}">อนุมัตินำเข้า</button>
      <button class="btn sm" data-sb-edit="${c.id}">แก้ไขแล้วอนุมัติ</button><button class="btn sm" data-sb-no="${c.id}">ปฏิเสธ</button></div>` : ""}
    ${c.status !== "pending" ? `<p class="muted">ตรวจโดย ${esc(c.reviewed_by || "-")} · ${fmt(c.reviewed_at)}${c.review_note ? ` · ${esc(c.review_note)}` : ""}${c.knowledge_id ? ` · ความรู้ #${c.knowledge_id}` : ""}</p>
      ${canApprove ? `<div class="row"><button class="btn sm" data-sb-reopen="${c.id}">ย้อนกลับมารอตรวจ</button></div>` : ""}` : ""}
  </article>`;
}
