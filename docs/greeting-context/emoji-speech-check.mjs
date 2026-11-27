import fs from "node:fs";
const root = process.argv[2];
const { normalizeForSpeech } = await import(root + "/frontend/kiosk/voice/speech-text.js");
let speechChunks = null;
try { ({ speechChunks } = await import(root + "/frontend/kiosk/voice.js")); } catch (e) { console.log("voice.js not importable in node:", String(e).slice(0, 80)); }
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/u;
const rows = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
let bad = 0, withEmoji = 0, vora = 0;
for (const r of rows) {
  const spoken = speechChunks ? speechChunks(r.display).join(" ") : normalizeForSpeech(r.display);
  if (EMOJI.test(r.display)) withEmoji++;
  if (EMOJI.test(spoken)) { bad++; console.log("EMOJI LEFT:", r.ctx, r.id, spoken); }
  if (!spoken.includes("VORA")) console.log("VORA missing:", spoken); else vora++;
  if (r.ctx === "kiosk" && !r.display.includes("ทุกคน")) console.log(`[${r.ctx} ${r.id}] display: ${r.display}\n              spoken : ${spoken}`);
}
console.log(`rows=${rows.length} displayWithEmoji=${withEmoji} spokenWithEmoji=${bad} via=${speechChunks ? "speechChunks (voice.js)" : "normalizeForSpeech"}`);
