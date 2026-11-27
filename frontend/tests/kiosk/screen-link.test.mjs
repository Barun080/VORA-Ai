// 25 พ.ย. 2569: จอในวง LAN — ฟังก์ชันล้วนของ kiosk/screen-link.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeText, isLocalHost, newKey, screenKey, KEY_NAME } from "../../kiosk/screen-link.js";

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test("main machine (localhost) never registers", () => {
  for (const h of ["localhost", "127.0.0.1", "LOCALHOST", "[::1]"]) assert.ok(isLocalHost(h));
  for (const h of ["192.168.1.20", "vora-pc", ""]) assert.ok(!isLocalHost(h));
});

test("key is 32 hex chars, created once and reused", () => {
  const k = newKey((n) => new Uint8Array(n).fill(171));
  assert.equal(k, "ab".repeat(16));
  const st = memStore();
  const a = screenKey(st), b = screenKey(st);
  assert.match(a, /^[a-f0-9]{32}$/);
  assert.equal(a, b);
  st.setItem(KEY_NAME, "bad");
  assert.notEqual(screenKey(st), "bad");
});

test("badge text: pending shows code, approved+https shows nothing, http warns about mic", () => {
  assert.match(badgeText({ status: "pending", code: "3FA9" }, true), /3FA9/);
  assert.equal(badgeText({ status: "approved", code: "3FA9" }, true), null);
  assert.match(badgeText({ status: "approved" }, false), /https/);
  assert.match(badgeText({ status: "revoked", code: "<b>" }, true), /&lt;b&gt;/);
});
