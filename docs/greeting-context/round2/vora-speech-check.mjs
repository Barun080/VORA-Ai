// ตรวจคำทักทายทั้ง 7 บริบทด้วยตัวเตรียมข้อความจริงของหน้าจอ: ไม่มี Emoji, ไม่มี "VORA", มี "โวร่า" ในทุกท่อนที่มีชื่อ
import fs from "node:fs";
const root = process.argv[2];
const { normalizeForSpeech } = await import(root + "/frontend/kiosk/voice/speech-text.js");
// ตัดประโยคแบบเดียวกับ splitSentences() ใน voice.js (voice.js ต้องใช้ window จึง import ใน node ไม่ได้)
const split = (text) => { const out = []; for (const p of text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+|(?<=ค่ะ)\s+|(?<=ครับ)\s+|(?<=นะคะ)\s+/)) { if (!p.trim()) continue; if (out.length && (out[out.length - 1].length + p.length) < 140) out[out.length - 1] += " " + p; else out.push(p); } return out; };
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/u;
const rows = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
let emoji = 0, latin = 0, thaiName = 0, shown = 0;
for (const r of rows) {
  const spoken = split(r.display).map(normalizeForSpeech).filter(Boolean).join(" ");
  if (EMOJI.test(spoken)) emoji++;
  if (/VORA/i.test(spoken)) { latin++; console.log("STILL LATIN:", spoken); }
  if (spoken.includes("โวร่า")) thaiName++;
  if (!r.display.includes("VORA")) console.log("display lost VORA:", r.display);
  if (shown < 3 && r.ctx === "kiosk" && !r.display.includes("ทุกคน")) { shown++; console.log(`display: ${r.display}\nspoken : ${spoken}`); }
}
console.log(`rows=${rows.length} spokenWithEmoji=${emoji} spokenWithLatinVORA=${latin} spokenWithโวร่า=${thaiName}`);
