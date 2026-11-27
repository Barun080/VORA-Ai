// งาน A "สมองโปร่งใส": การแปลง trace → 5 ขั้น
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTrace, guardBoard, guardGroups } from "../../admin/brain-view.js";

const base = {
  question: "มีทุนการศึกษาไหม", net_mode: "ai",
  intent: { raw: "scholarship", used: "scholarship", confidence: 0.82, min: 0.3, top: [["scholarship", 0.82], ["tuition", 0.1]] },
  route: { initial: "institutional", final: "institutional" },
  retrieval: { threshold: 0.2, best: 0.61, hits: [{ title: "ทุนการศึกษา", type: "faq", score: 0.61 }, { title: "ข่าว", type: "news", score: 0.08 }] },
  llm: { step: "compose", result: "composed", cache: false, ms: 900, context_items: 2, provider: "gemini", guard: { ran: true, ok: true, codes: [] } },
  result: { answer_source: "ai_from_knowledge", verification: "ai_guarded", answered: true, latency_ms: 1100 },
};

test("ครบ 5 ขั้นตามลำดับ และผ่านทั้งหมด", () => {
  const s = describeTrace(base, { scholarship: "ทุนการศึกษา" });
  assert.deepEqual(s.map((x) => x.key), ["intent", "retrieval", "llm", "guard", "result"]);
  assert.ok(s.every((x) => x.state === "ok"));
  assert.match(s[0].headline, /ทุนการศึกษา · มั่นใจ 82%/);
  assert.equal(s[3].headline, "ผ่านครบ 9 ข้อ");
  assert.equal(s[4].headline, "AI เรียบเรียงจากฐานความรู้");
});

test("Guard ตีกลับ → ขั้น guard เป็นสีแดง และชี้ข้อที่ไม่ผ่าน", () => {
  const t = { ...base, llm: { ...base.llm, result: "guard_reject", guard: { ran: true, ok: false, codes: ["G5_number", "G6_contact"] } },
    result: { ...base.result, answer_source: "knowledge_base", verification: "knowledge_verified" } };
  const s = describeTrace(t);
  assert.equal(s[2].state, "bad");
  assert.equal(s[3].state, "bad");
  assert.match(s[3].headline, /G5 ตัวเลข, G6 ข้อมูลติดต่อ/);
  const b = guardBoard(t.llm);
  assert.equal(b.length, 9);
  assert.equal(b.find((x) => x.id === "G5").state, "fail");
  assert.equal(b.find((x) => x.id === "G1").state, "pass");
});

test("ไม่ใช้ AI (คำตอบทางการ/เน็ตล่ม) → ขั้น AI และ Guard ข้ามไป", () => {
  const s = describeTrace({ ...base, llm: null, retrieval: null, net_mode: "kb", result: { answer_source: "rules", verification: "official", answered: true } });
  assert.equal(s[1].state, "skip");
  assert.equal(s[2].state, "skip");
  assert.match(s[2].headline, /โหมดฐานความรู้/);
  assert.ok(guardBoard(null).every((x) => x.state === "skip"));
});

test("ความมั่นใจต่ำ / ค้นไม่เจอ → สีเหลือง", () => {
  const t = { ...base, intent: { ...base.intent, used: "unknown", confidence: 0.12 }, retrieval: { threshold: 0.2, best: 0.05, hits: [] }, llm: null,
    result: { answer_source: "none", verification: "none", answered: false } };
  const s = describeTrace(t);
  assert.equal(s[0].state, "warn");
  assert.equal(s[1].state, "warn");
  assert.equal(s[4].state, "warn");
  assert.ok(s[4].lines.some((l) => l.includes("คำถามที่ตอบไม่ได้")));
});

test("guardGroups ตัดรหัสย่อยเป็นกลุ่ม ไม่ซ้ำ และไม่รับรหัสแปลก", () => {
  assert.deepEqual(guardGroups(["G2_unknown_program", "G2_near_name", "X9", "G7_canary"]), ["G2", "G7"]);
  assert.deepEqual(describeTrace(null), []);
});

test("ถามต่อจากคำถามก่อนหน้า → ขั้น 1 บอกว่าเติมคำถามเป็นอะไร", () => {
  const s = describeTrace({ ...base, followup: { from: "อากาศวันนี้เป็นยังไง", text: "อากาศที่จังหวัดแพร่", kind: "weather", slot: "แพร่" } });
  assert.match(s[0].headline, /^ถามต่อ · /);
  assert.ok(s[0].lines[0].includes("อากาศที่จังหวัดแพร่"));
});

test("23 พ.ย.: แสดงประเด็นที่ถามเรื่องสาขา + สาขาจากคำถามก่อนหน้า", () => {
  const s = describeTrace({ intent: { used: "program_detail", confidence: 0.79, min: 0.3, top: [] }, route: { final: "institutional" },
    program: "เทคโนโลยีคอมพิวเตอร์", program_answer: { aspect: "learn", aspect_th: "เรียนอะไร", from_context: true },
    result: { answer_source: "database" } });
  const lines = s[0].lines.join("\n");
  assert.match(lines, /สาขาจากคำถามก่อนหน้า: เทคโนโลยีคอมพิวเตอร์/);
  assert.match(lines, /ประเด็นที่ถาม: เรียนอะไร/);
});

test("25 พ.ย. 2569: ตรงกับ FAQ ที่อนุมัติ → ขั้น AI ข้าม พร้อมบอกว่าอ่านคำตอบเต็ม", () => {
  const t = { ...base, llm: { step: "compose", result: "full_faq", score: 0.9 },
    result: { ...base.result, answer_source: "knowledge_base", verification: "knowledge_verified" } };
  const s = describeTrace(t);
  const llm = s.find((x) => x.key === "llm");
  assert.equal(llm.state, "skip");
  assert.match(llm.headline, /อนุมัติแบบเต็ม/);
  assert.match(llm.lines[0], /90%/);
});
