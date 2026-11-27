// 27 พ.ย. 2569: หน้าข่าวสาร — วันที่ปี พ.ศ. ไม่เพี้ยน · ข่าวเด่นต้องมีรูป · ข่าวมีรูปขึ้นก่อน แล้วใหม่ → เก่า
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// โมดูลจริงนำเข้า /shared/... (ใช้ได้เฉพาะในเบราว์เซอร์) → ตัดบรรทัด import ออกแล้วโหลดเฉพาะฟังก์ชันที่ทดสอบ
const src = readFileSync(new URL("../../kiosk/experience/PresentationView.js", import.meta.url), "utf8").replace(/^import .*$/gm, "");
const tmp = join(mkdtempSync(join(tmpdir(), "vora-news-")), "pv.mjs");
writeFileSync(tmp, src);
const { formatDate, PresentationView } = await import(pathToFileURL(tmp).href);

test("formatDate: ปี พ.ศ. ในข้อมูลแปลงเป็น ค.ศ. ก่อนแสดง · ปี 0001 = ไม่แสดง", () => {
  assert.equal(formatDate("2569-09-12T13:30:00", "th"), formatDate("2026-09-12T13:30:00", "th"));
  assert.match(formatDate("2026-09-12", "th"), /2569/);
  assert.equal(formatDate("0001-01-01T00:00:00", "th"), "");
});

test("arrangeNews: ข่าวเด่น = สำคัญสุดที่มีรูป · ที่เหลือมีรูปก่อน แล้วใหม่ → เก่า", () => {
  const items = [
    { id: 1, publish_at: "2026-11-12", priority: 3 },
    { id: 2, publish_at: "2026-10-01", priority: 3, image: "/a.jpg" },
    { id: 3, publish_at: "2569-09-17", priority: 5, image: "/b.jpg" },
    { id: 4, publish_at: "2026-11-01", priority: 2, image: "/c.jpg" },
  ];
  const { hero, rest } = PresentationView.prototype.arrangeNews.call({}, items);
  assert.equal(hero.id, 3);
  assert.deepEqual(rest.map((n) => n.id), [4, 2, 1]);
  assert.equal(PresentationView.prototype.arrangeNews.call({}, [items[0]]).hero, null);
});
