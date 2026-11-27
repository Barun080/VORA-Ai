// งาน F "สาธิตไม่สะดุด" (21 พ.ย. 2569) — โหมดฐานความรู้ฝั่งหน้าจอ + การวางแผนเตรียมเสียงในหลังบ้าน
import test from "node:test";
import assert from "node:assert/strict";
import { netModeOf, netTransition, chipList } from "../../kiosk/interaction/net-mode.js";
import { speechText, speechChunks } from "../../kiosk/voice/speech-text.js";
import { buildPlan, guidePhrases, summarize, KIND_TH } from "../../admin/prewarm.js";
import { GUIDE_STEPS } from "../../kiosk/guide/guide-steps.js";

test("netModeOf: server without net field = ai (old server keeps old behaviour)", () => {
  assert.equal(netModeOf(null), "ai");
  assert.equal(netModeOf({}), "ai");
  assert.equal(netModeOf({ net: { mode: "ai" } }), "ai");
  assert.equal(netModeOf({ net: { mode: "kb" } }), "kb");
});

test("netTransition: only real changes are reported", () => {
  assert.equal(netTransition(undefined, "ai"), null);
  assert.equal(netTransition("ai", "ai"), null);
  assert.equal(netTransition("ai", "kb"), "offline");
  assert.equal(netTransition("kb", "kb"), null);
  assert.equal(netTransition("kb", "ai"), "online");
});

test("chipList: kb mode shows quick questions (max 6), ai mode keeps 3 AI suggestions", () => {
  const sug = ["a", "b", "c", "d"];
  const quick = ["q1", "q2", "q3", "q4", "q5", "q6", "q7"];
  assert.deepEqual(chipList("ai", sug, quick), ["a", "b", "c"]);
  assert.deepEqual(chipList("kb", sug, quick), quick.slice(0, 6));
  assert.deepEqual(chipList("kb", sug, []), ["a", "b", "c"]);       // ยังโหลดคำถามยอดฮิตไม่ได้ → ใช้ของเดิม
  assert.deepEqual(chipList("ai", null, null), []);
});

test("speechText is the same function the kiosk speaks with (moved, not copied)", async () => {
  const v = await import("../../kiosk/voice/speech-text.js");
  assert.equal(v.speechText, speechText);
  const txt = "สวัสดีค่ะ! ยินดีต้อนรับสู่ **VORA** ค่ะ 😊 มีอะไรให้ช่วยไหมคะ?";
  assert.equal(speechText(txt), speechChunks(txt).join(" "));
  assert.ok(!/[!?*😊]/u.test(speechText(txt)));
});

test("buildPlan: converts to spoken text, de-duplicates per language, orders by importance", () => {
  const plan = buildPlan([
    { kind: "faq", label: "ทุน", lang: "th", text: "มีทุนค่ะ!" },
    { kind: "system", label: "ทักทาย", lang: "th", text: "สวัสดีค่ะ" },
    { kind: "quick", label: "ทุน", lang: "th", text: "มีทุนค่ะ" },           // พูดเหมือนข้อแรก → ข้อเดียว
    { kind: "faq", label: "fund", lang: "en", text: "มีทุนค่ะ" },            // คนละภาษา = คนละไฟล์เสียง
    { kind: "faq", label: "ว่าง", lang: "th", text: "   " },
  ], speechText);
  assert.equal(plan.length, 3);
  assert.equal(plan[0].kind, "system");
  assert.ok(plan.every((p) => p.text === speechText(p.text) && p.pinned === false));
  const s = summarize(plan.map((p, i) => ({ ...p, pinned: i === 0 })));
  assert.equal(s.total, 3);
  assert.equal(s.ready, 1);
});

test("guide phrases come from the approved guide text (th + en) and every kind has a Thai label", () => {
  const g = guidePhrases(GUIDE_STEPS);
  assert.equal(g.length, GUIDE_STEPS.length * 2);
  assert.ok(g.every((x) => x.kind === "guide" && x.text));
  for (const k of ["system", "quick", "program", "faq", "greeting", "announce", "guide"]) assert.ok(KIND_TH[k]);
});
