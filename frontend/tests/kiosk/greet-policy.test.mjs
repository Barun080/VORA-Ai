// VORA — นโยบายการทักทายผู้เข้าชม (16 พ.ย. 2569) — unit tests แบบออฟไลน์
// รัน: node --test frontend/tests/kiosk/greet-policy.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { greetDecision as d, returnWindowMs, STALE_CONVO_MS } from "../../kiosk/interaction/greet-policy.js";
import { KIOSK_CONFIG } from "../../kiosk/kiosk-config.js";

const base = { force: false, arrival: false, autoGreeting: true, phase: "attract", state: "idle", speakingKind: null,
  quietMs: 0, sinceGreetMs: Infinity, cooldownMs: 25000, absenceGreetMs: 8000 };

/** กติกาเดิมก่อน 16 พ.ย. 2569 (คัดลอกจาก greet() ใน app.js รุ่นก่อนแก้) */
function legacy({ force, autoGreeting, phase, state, speakingKind, quietMs, sinceGreetMs, cooldownMs }) {
  const staleConvo = phase === "convo" && state === "idle" && quietMs > 20000;
  if (!force && (!autoGreeting || (phase !== "attract" && !staleConvo))) return "skip";
  if (state === "listening" || state === "thinking" || (state === "speaking" && speakingKind === "conversation")) return "wait";
  if (!force && sinceGreetMs < cooldownMs) return "cooldown";
  return "greet";
}

test("absence window: 8 s without anyone = new visitor (session ends after leaveMs, then the rest)", () => {
  assert.equal(returnWindowMs({ absenceGreetMs: 8000, leaveMs: 6000 }), 2000);
  assert.equal(returnWindowMs({ absenceGreetMs: 5000, leaveMs: 6000 }), 0);
  assert.equal(returnWindowMs(), 2000);
  assert.equal(KIOSK_CONFIG.visitor.absenceGreetMs, 8000);
  assert.equal(returnWindowMs({ absenceGreetMs: KIOSK_CONFIG.visitor.absenceGreetMs, leaveMs: KIOSK_CONFIG.visitor.leaveMs }) + KIOSK_CONFIG.visitor.leaveMs, 8000);
  assert.equal(KIOSK_CONFIG.visitor.returnWindowMs, undefined);
});

test("new visitor is greeted immediately, even inside the greeting cooldown", () => {
  assert.equal(d({ ...base, arrival: true, sinceGreetMs: 9000 }), "greet");
  assert.equal(d({ ...base, arrival: true, sinceGreetMs: 100 }), "greet");
  assert.equal(d({ ...base, arrival: false, sinceGreetMs: 9000 }), "cooldown");      // ท่าแบมือ/การทักที่ค้างไว้ ยังรอคูลดาวน์
});

test("previous conversation left on screen: greet after 8 s of no interaction, and clear it first", () => {
  const convo = { ...base, arrival: true, phase: "convo", sinceGreetMs: 12000 };
  assert.equal(d({ ...convo, quietMs: 8001 }), "greet-reset");
  assert.equal(d({ ...convo, quietMs: 60000 }), "greet-reset");
  assert.equal(d({ ...convo, quietMs: 8000 }), "skip");                               // ยังไม่ครบ
  assert.equal(d({ ...convo, quietMs: 3000 }), "skip");                               // มีคนเพิ่งแตะ/พูดกับหน้าจอ → ไม่ทักแทรก
  assert.equal(d({ ...convo, quietMs: 9000, absenceGreetMs: 15000 }), "skip");        // ปรับค่าได้จาก kiosk-config
});

test("never interrupts listening / thinking / answering a user", () => {
  for (const arrival of [true, false]) {
    assert.equal(d({ ...base, arrival, state: "listening" }), "wait");
    assert.equal(d({ ...base, arrival, state: "thinking" }), "wait");
    assert.equal(d({ ...base, arrival, state: "speaking", speakingKind: "conversation" }), "wait");
    assert.equal(d({ ...base, arrival, state: "speaking", speakingKind: "announcing" }), "greet");   // แทรกประกาศข่าวได้ (เหมือนเดิม)
    assert.equal(d({ ...base, arrival, phase: "convo", state: "speaking", speakingKind: "conversation", quietMs: 99999 }), "skip");
  }
});

test("auto greeting off → never; forced test greeting → always, without reset by policy", () => {
  assert.equal(d({ ...base, arrival: true, autoGreeting: false }), "skip");
  assert.equal(d({ ...base, autoGreeting: false }), "skip");
  assert.equal(d({ ...base, force: true, autoGreeting: false, phase: "convo", sinceGreetMs: 1 }), "greet");
  assert.equal(d({ ...base, force: true, arrival: true, phase: "convo", quietMs: 99999 }), "greet");
});

test("non-arrival greetings behave exactly as before (exhaustive comparison with the old rule)", () => {
  assert.equal(STALE_CONVO_MS, 20000);
  let n = 0;
  for (const force of [false, true]) for (const autoGreeting of [false, true]) for (const phase of ["attract", "convo", "other"])
    for (const state of ["idle", "listening", "thinking", "speaking"]) for (const speakingKind of [null, "conversation", "greeting", "announcing"])
      for (const quietMs of [0, 7999, 8001, 19999, 20000, 20001, 90000]) for (const sinceGreetMs of [0, 24999, 25000, Infinity]) {
        const c = { ...base, force, autoGreeting, phase, state, speakingKind, quietMs, sinceGreetMs };
        assert.equal(d(c), legacy(c), JSON.stringify(c));
        n++;
      }
  assert.equal(n, 2 * 2 * 3 * 4 * 4 * 7 * 4);
});

test("app.js wiring: new-visitor event greets as arrival; policy and absence window are used", () => {
  const app = readFileSync(fileURLToPath(new URL("../../kiosk/app.js", import.meta.url)), "utf8");
  assert.ok(app.includes("greet(session.people, { arrival: true, quietMs })"));
  assert.ok(/const quietMs = Date\.now\(\) - S\.lastActivity;[^\n]*\n\s*touch\(\);/.test(app), "quiet time must be measured before touch()");
  assert.ok(app.includes("greetDecision({ force, arrival,") && app.includes('if (decision === "greet-reset") { S.greetPending = 0; resetSession(); }'));
  assert.ok(app.includes("returnWindowMs({ absenceGreetMs: KIOSK_CONFIG.visitor.absenceGreetMs ?? 8000, leaveMs: KIOSK_CONFIG.visitor.leaveMs })"));
  assert.ok(!app.includes("KIOSK_CONFIG.visitor.returnWindowMs"));
  assert.equal((app.match(/greet\(session\.people\)/g) || []).length, 1, "deferred (cooldown) greeting stays a non-arrival greeting");
});
