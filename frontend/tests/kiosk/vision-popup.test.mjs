// 24 พ.ย. 2569: ป๊อปอัปนำเสนอสิ่งที่กล้องจำได้
import { test } from "node:test";
import assert from "node:assert/strict";
import { visionPopupHtml } from "../../kiosk/experience/VisionPopup.js";

const item = { id: 3, kind: "poster", kind_label: "โปสเตอร์/ประกาศ", icon: "📢", title: "Open House", expired: false, link: "https://www.technicnan.ac.th",
  images: ["/uploads/a.jpg", "/uploads/b.jpg"], fields: [{ key: "location", label: "สถานที่", value: "หอประชุม" }, { key: "start_date", label: "วันเริ่ม", value: "5 ธ.ค. 2569" }] };

test("สไลด์หลายรูป + จุดบอกลำดับ + รายละเอียด + คำถามแนะนำตามประเภท", () => {
  const h = visionPopupHtml(item, "th", { qr: () => "<svg></svg>" });
  assert.equal((h.match(/class="vp-slide/g) || []).length, 2);
  assert.match(h, /vp-dots/);
  assert.match(h, /📍/);
  assert.match(h, /หอประชุม/);
  assert.match(h, /data-q="จัดที่ไหน"/);
  assert.match(h, /<svg><\/svg>/);
});

test("ไม่มีรูป → ไอคอนประเภท · หมดอายุ → ป้ายเตือน · ไม่มีลิงก์ → ไม่มีคิวอาร์", () => {
  const h = visionPopupHtml({ ...item, images: [], expired: true, link: "" }, "th");
  assert.match(h, /vp-noimg/);
  assert.match(h, /หมดอายุแล้ว/);
  assert.doesNotMatch(h, /vp-qr/);
});

test("กันสคริปต์: ข้อความ escape · รูป/ลิงก์ที่ไม่ใช่ http(s)/uploads ถูกตัด", () => {
  const h = visionPopupHtml({ ...item, title: "<script>x</script>", images: ["javascript:alert(1)"], link: "javascript:alert(1)",
    fields: [{ key: "detail", label: "x", value: "<img onerror=1>" }] }, "th", { qr: () => "QR" });
  assert.doesNotMatch(h, /<script>x/);
  assert.doesNotMatch(h, /<img onerror/);
  assert.doesNotMatch(h, /javascript:/);
  assert.doesNotMatch(h, /QR/);
});
