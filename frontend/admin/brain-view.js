// งาน A "สมองโปร่งใส" (21 พ.ย. 2569) — แปลง trace จากเซิร์ฟเวอร์เป็น 5 ขั้นที่คนทั่วไปอ่านเข้าใจ
// ฟังก์ชันล้วน (ไม่แตะ DOM) เพื่อทดสอบด้วย node ได้ · ใช้ใน admin.js หน้า "สมองโปร่งใส"

export const SOURCE_TH = {
  rules: "กฎตายตัวของระบบ", database: "ฐานข้อมูลทางการของวิทยาลัย", knowledge_base: "ฐานความรู้ที่อนุมัติแล้ว (ตอบตรง)",
  ai_from_knowledge: "AI เรียบเรียงจากฐานความรู้", ai_general: "AI ความรู้ทั่วไป", web: "ค้นจากเว็บ", realtime: "ข้อมูลสด",
  refusal: "ปฏิเสธอย่างสุภาพ", none: "ไม่มีข้อมูล", error: "ระบบขัดข้อง",
};
export const VERIFY_TH = {
  official: "ข้อมูลทางการ", knowledge_verified: "ตรวจแล้วโดยเจ้าหน้าที่", ai_guarded: "AI + ผ่าน Answer Guard",
  unverified: "ยังไม่ได้ตรวจสอบ", live: "ข้อมูลสด", none: "-",
};
export const ROUTE_TH = {
  institutional: "เรื่องของวิทยาลัย", general: "ความรู้ทั่วไป", unsafe: "ไม่เหมาะสม/ไม่ปลอดภัย",
  pending: "รอดูผลค้นฐานความรู้", out_of_scope: "นอกขอบเขต",
};
export const GUARD_TH = {
  G1: "ชื่อสถานศึกษา", G2: "หลักสูตร/สาขา/ระดับ", G3: "สถานที่", G4: "วันที่/เวลา", G5: "ตัวเลข",
  G6: "ข้อมูลติดต่อ", G7: "ไม่รั่วคำสั่งระบบ", G8: "ค่าตรงกับเรื่อง", G9: "บุคลากร",
};
const TYPE_TH = { faq: "คำถามที่พบบ่อย", program: "สาขา", news: "ข่าว", activity: "กิจกรรม", kb: "ความรู้", doc: "เอกสาร" };

const pct = (x) => `${Math.round((Number(x) || 0) * 100)}%`;

/** รหัส guard (เช่น "G5_number") → กลุ่ม G1..G9 */
export function guardGroups(codes) {
  return [...new Set((codes || []).map((c) => String(c).slice(0, 2)).filter((g) => GUARD_TH[g]))];
}

/** สถานะของ Answer Guard 9 ข้อ: [{id, label, state: "pass"|"fail"|"skip"}] */
export function guardBoard(llm) {
  const g = llm && llm.guard;
  const ran = !!(g && g.ran);
  const failed = new Set(guardGroups(g && g.codes));
  return Object.keys(GUARD_TH).map((id) => ({
    id, label: GUARD_TH[id], state: !ran ? "skip" : failed.has(id) ? "fail" : "pass",
  }));
}

/** trace → 5 ขั้น [{key, title, state: ok|warn|bad|skip, headline, lines[]}] */
export function describeTrace(t, intentTh = {}) {
  if (!t) return [];
  const it = t.intent || {}, rt = t.route || {}, rv = t.retrieval, llm = t.llm, res = t.result || {};
  const name = (k) => intentTh[k] || k;
  const stages = [];

  // 1) เข้าใจคำถาม
  const low = (it.confidence || 0) < (it.min || 0);
  stages.push({
    key: "intent", title: "เข้าใจคำถาม", state: low ? "warn" : "ok",
    headline: `${t.followup ? "ถามต่อ · " : ""}${name(it.used || it.raw)} · มั่นใจ ${pct(it.confidence)}`,
    lines: [
      ...(t.followup ? [`ถามต่อจาก "${t.followup.from}" → เข้าใจว่า "${t.followup.text}"`
        + (t.followup.kind === "llm" ? ` (AI ${t.followup.provider || ""} ช่วยเขียนคำถามใหม่)` : " (ใช้กฎ)")] : []),
      ...(it.top || []).map(([k, p]) => `${name(k)} ${pct(p)}`),
      low ? `ความมั่นใจต่ำกว่าเกณฑ์ ${pct(it.min)} จึงไม่เดาเจตนา` : "",
      t.program ? `${t.program_answer && t.program_answer.from_context ? "สาขาจากคำถามก่อนหน้า" : "พบชื่อสาขา"}: ${t.program}` : "",
      t.program_answer ? `ประเด็นที่ถาม: ${t.program_answer.aspect_th || t.program_answer.aspect}` : "",
      `เส้นทาง: ${ROUTE_TH[rt.final] || rt.final || "-"}${rt.initial && rt.final && rt.initial !== rt.final ? ` (เริ่มที่ ${ROUTE_TH[rt.initial] || rt.initial})` : ""}`,
      rt.unsafe_reason ? `เหตุผลที่กันไว้: ${rt.unsafe_reason}` : "",
    ].filter(Boolean),
  });

  // 2) ค้นฐานความรู้
  if (!rv) {
    stages.push({ key: "retrieval", title: "ค้นฐานความรู้", state: "skip", headline: "ไม่ต้องค้น (ตอบด้วยเส้นทางอื่น)", lines: [] });
  } else {
    const pass = (rv.best || 0) >= (rv.threshold || 0) && (rv.hits || []).length > 0;
    stages.push({
      key: "retrieval", title: "ค้นฐานความรู้", state: pass ? "ok" : "warn",
      headline: pass ? `พบ ${rv.hits.length} รายการ · ตรงที่สุด ${pct(rv.best)}` : `ไม่พบข้อมูลที่ตรงพอ (ดีที่สุด ${pct(rv.best)})`,
      lines: [
        `เกณฑ์ขั้นต่ำ ${pct(rv.threshold)}`,
        ...(rv.hits || []).map((h) => `${h.score >= rv.threshold ? "✓" : "·"} ${h.title} — ${TYPE_TH[h.type] || h.type} ${pct(h.score)}`),
      ],
      hits: rv.hits || [],
    });
  }

  // 3) AI เรียบเรียง
  const L = {
    composed: ["ok", "AI เรียบเรียงจากข้อมูลที่ค้นได้"], no_info: ["warn", "AI บอกว่าข้อมูลไม่พอ (ไม่แต่งเอง)"],
    guard_reject: ["bad", "AI ตอบแล้ว แต่ถูก Guard ตีกลับ"], error: ["warn", "AI ภายนอกไม่ตอบ → ใช้ฐานความรู้ตรง ๆ"],
    empty: ["warn", "AI ส่งข้อความว่าง → ใช้ฐานความรู้ตรง ๆ"],
  };
  if (llm && llm.result === "full_faq") {     // 25 พ.ย. 2569: ตรงกับ FAQ ที่อนุมัติ → อ่านคำตอบเต็ม ไม่ส่งให้ AI ย่อ
    stages.push({ key: "llm", title: "AI เรียบเรียง", state: "skip", headline: "ใช้คำตอบที่เจ้าหน้าที่อนุมัติแบบเต็ม (ไม่ย่อ)",
      lines: [`คำถามตรงกับ FAQ ${Math.round((llm.score || 0) * 100)}% · อ่านครบทุกประโยค`] });
  } else if (!llm) {
    const why = t.net_mode === "kb" ? "โหมดฐานความรู้ (ไม่มีอินเทอร์เน็ต)" : "ไม่ต้องใช้ AI ภายนอก";
    stages.push({ key: "llm", title: "AI เรียบเรียง", state: "skip", headline: why, lines: [] });
  } else {
    const [state, head] = L[llm.result] || ["warn", llm.result];
    stages.push({
      key: "llm", title: "AI เรียบเรียง", state, headline: head,
      lines: [
        llm.step === "general" ? "โหมดความรู้ทั่วไป (ห้ามให้ข้อมูลวิทยาลัย)" : `ส่งข้อมูลให้ AI ${llm.context_items ?? "-"} ชิ้น · เฉพาะที่อนุมัติแล้ว`,
        llm.cache ? "ใช้คำตอบที่เคยตรวจแล้ว (แคช)" : llm.ms != null ? `ใช้เวลา ${llm.ms} ms` : "",
        llm.provider ? `ผู้ให้บริการ: ${llm.provider}` : "",
        llm.error ? `ข้อผิดพลาด: ${llm.error}` : "",
      ].filter(Boolean),
    });
  }

  // 4) Answer Guard
  const g = llm && llm.guard;
  if (!g || !g.ran) {
    stages.push({ key: "guard", title: "Answer Guard 9 ข้อ", state: "skip",
      headline: llm ? "ไม่มีข้อความจาก AI ให้ตรวจ" : "คำตอบมาจากข้อมูลทางการ/ฐานความรู้โดยตรง", lines: [], board: guardBoard(null) });
  } else {
    const fails = guardGroups(g.codes);
    stages.push({
      key: "guard", title: "Answer Guard 9 ข้อ", state: g.ok ? "ok" : "bad",
      headline: g.ok ? "ผ่านครบ 9 ข้อ" : `ไม่ผ่าน: ${fails.map((x) => `${x} ${GUARD_TH[x]}`).join(", ")}`,
      lines: g.ok ? [] : ["คำตอบนี้ไม่ถึงผู้ใช้ — ระบบใช้ข้อความจากฐานความรู้แทน", ...(g.codes || []).map((c) => `รหัส ${c}`)],
      board: guardBoard(llm),
    });
  }

  // 5) ป้ายแหล่งที่มา
  stages.push({
    key: "result", title: "ป้ายแหล่งที่มา", state: res.answered ? "ok" : "warn",
    headline: SOURCE_TH[res.answer_source] || res.answer_source || "-",
    lines: [
      `ระดับการตรวจสอบ: ${VERIFY_TH[res.verification] || res.verification || "-"}`,
      res.answered ? "" : "บันทึกเป็นคำถามที่ตอบไม่ได้ ให้เจ้าหน้าที่เติมความรู้",
      res.latency_ms != null ? `เวลาตอบรวม ${res.latency_ms} ms` : "",
    ].filter(Boolean),
  });
  return stages;
}
