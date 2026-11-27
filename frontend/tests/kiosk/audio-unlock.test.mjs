// 27 พ.ย. 2569: iPad/iPhone ต้องแตะจอก่อนจึงเล่นเสียงได้ → ปลดล็อกเมื่อแตะครั้งแรก เฉพาะอุปกรณ์ iOS/iPadOS
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const src = readFileSync(new URL("../../kiosk/voice.js", import.meta.url), "utf8");
const fn = /export function needsAudioUnlock[\s\S]*?\n}\n/.exec(src)[0];
const tmp = join(mkdtempSync(join(tmpdir(), "vora-au-")), "au.mjs");
writeFileSync(tmp, fn);
const { needsAudioUnlock } = await import(pathToFileURL(tmp).href);

const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
test("iPad (โหมดเดสก์ท็อป มีจอสัมผัส) / iPhone = ปลดล็อก · Mac ไม่มีจอสัมผัส / Windows = แบบเดิม", () => {
  assert.equal(needsAudioUnlock(IPAD_DESKTOP_UA, 5, ""), true);
  assert.equal(needsAudioUnlock("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15", 5, ""), true);
  assert.equal(needsAudioUnlock(IPAD_DESKTOP_UA, 0, ""), false);
  assert.equal(needsAudioUnlock("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36", 10, ""), false);
  assert.equal(needsAudioUnlock("Windows Chrome", 0, "?audiounlock=1"), true);
  assert.equal(needsAudioUnlock(IPAD_DESKTOP_UA, 5, "?audiounlock=0"), false);
});
