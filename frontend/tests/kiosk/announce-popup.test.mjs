// 27 พ.ย. 2569: ป๊อปอัปประกาศ / รอคุยจบ / ช่วงงดเสียง — รัน: node --test frontend/tests/kiosk/announce-popup.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { announceHtml, inQuietHours, promoCardHtml, shouldWait } from "../../kiosk/experience/AnnouncePopup.js";

test("announceHtml: video muted + poster, image, text-only, unsafe url dropped", () => {
  const v = announceHtml({ kind: "news", news_kind: "activity", title_th: "งาน", text_th: "มาเที่ยว", video: "/uploads/a.mp4", image: "/uploads/p.jpg" });
  assert.match(v, /<video[^>]+muted/); assert.match(v, /poster="\/uploads\/p.jpg"/); assert.match(v, /กิจกรรม/);
  assert.match(announceHtml({ kind: "program", title_th: "สาขา", text_th: "x", image: "/uploads/i.png" }), /<img class="ap-img"/);
  const t = announceHtml({ kind: "text", title_th: "<b>", text_th: "x", image: "javascript:alert(1)" });
  assert.doesNotMatch(t, /javascript:/); assert.match(t, /ap-textonly/); assert.match(t, /&lt;b&gt;/);
});

test("shouldWait: normal waits during chat, urgent never, resumes after 45 s quiet", () => {
  assert.equal(shouldWait({ priority: 3, phase: "convo", quietMs: 5000 }), true);
  assert.equal(shouldWait({ priority: 3, phase: "convo", quietMs: 46000 }), false);
  assert.equal(shouldWait({ priority: 3, visitor: true, quietMs: 1000 }), true);
  assert.equal(shouldWait({ priority: 5, phase: "convo", quietMs: 0 }), false);
  assert.equal(shouldWait({ priority: 3, resumeAt: Date.now() + 5000 }), true);
  assert.equal(shouldWait({ priority: 3 }), false);
});

test("inQuietHours incl. overnight", () => {
  assert.equal(inQuietHours("12:00-13:00", new Date(2026, 0, 1, 12, 30)), true);
  assert.equal(inQuietHours("12:00-13:00", new Date(2026, 0, 1, 13, 0)), false);
  assert.equal(inQuietHours("22:00-06:00", new Date(2026, 0, 1, 2, 0)), true);
  assert.equal(inQuietHours("", new Date()), false);
});

test("promoCardHtml", () => {
  assert.equal(promoCardHtml({ kind: "none" }), "");
  assert.match(promoCardHtml({ kind: "program", title_th: "สาขาช่างยนต์" }), /แนะนำสาขา/);
});

test("app.js wiring: schedule-only mode, wait box, popup, no idle speech", () => {
  const src = readFileSync(new URL("../../kiosk/app.js", import.meta.url), "utf8");
  for (const s of ["drainQueuePR", "announceWaitBox", "annPop.show(item", "playVideoSound", "prOnly()", "idle_mode"]) assert.ok(src.includes(s), s);
  const html = readFileSync(new URL("../../kiosk/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("experience/announce-popup.css"));
});
