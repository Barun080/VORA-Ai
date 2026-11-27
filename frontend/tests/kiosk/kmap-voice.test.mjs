// 27 พ.ย. 2569: แผนผังความรู้ — ถึงกล่องคำถามแล้ว VORA พูดคำตอบเอง · รัน: node --test frontend/tests/kiosk/kmap-voice.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("ConstellationView speaks knowledge leaf once per arrival and stops on leave", () => {
  const src = readFileSync(new URL("../../kiosk/experience/ConstellationView.js", import.meta.url), "utf8");
  assert.match(src, /f\.category === "knowledge" && f\.description && this\.actions\.say && this\.lastFocus !== f\.id/);
  assert.match(src, /data-act="say"/);
  assert.match(src, /this\.actions\.stop\(\)/);
});

test("app.js wires say/stop for the constellation", () => {
  const src = readFileSync(new URL("../../kiosk/app.js", import.meta.url), "utf8");
  assert.match(src, /say: \(text\) => \{[^\n]*speakAs\(tok, text, S\.lang\)/);
  assert.match(src, /stop: \(\) =>/);
});
