// 27 พ.ย. 2569: iPad/Safari วาดอวตารใน <foreignObject> ไม่ย่อตาม viewBox (ตัวใหญ่เต็มจอ) → ใช้โหมดวาง canvas ทับ svg เฉพาะ WebKit
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const src = readFileSync(new URL("../../kiosk/avatar/VoraRigRenderer.js", import.meta.url), "utf8");
const fn = /export function useOverlay[\s\S]*?\n}\n/.exec(src)[0];
const tmp = join(mkdtempSync(join(tmpdir(), "vora-rig-")), "ov.mjs");
writeFileSync(tmp, fn);
const { useOverlay } = await import(pathToFileURL(tmp).href);

const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const IPAD_CHROME = "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1";
const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const WIN_EDGE = WIN_CHROME + " Edg/131.0.0.0";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";

test("iPad Safari / Chrome บน iPad (WebKit) = วางทับ · Chrome/Edge/Firefox บนคอม = แบบเดิม", () => {
  assert.equal(useOverlay(IPAD, ""), true);
  assert.equal(useOverlay(IPAD_CHROME, ""), true);
  assert.equal(useOverlay(WIN_CHROME, ""), false);
  assert.equal(useOverlay(WIN_EDGE, ""), false);
  assert.equal(useOverlay(FIREFOX, ""), false);
});

test("บังคับด้วย ?rigoverlay=1 / 0", () => {
  assert.equal(useOverlay(WIN_CHROME, "?rigoverlay=1"), true);
  assert.equal(useOverlay(IPAD, "?rigoverlay=0"), false);
});
