// 24 พ.ย. 2569: นำเข้ารายการให้กล้องจำทีละมาก — ฟังก์ชันล้วน (ไม่ต้องใช้เบราว์เซอร์)
import { test } from "node:test";
import assert from "node:assert/strict";
import { VARIANTS_PER_IMAGE, augmentPlan, newsToItem, trainable } from "../../admin/vision-import.js";

test("augmentPlan: first is the full image, others vary within safe ranges, deterministic", () => {
  const p = augmentPlan();
  assert.equal(p.length, VARIANTS_PER_IMAGE);
  assert.deepEqual(p[0], { scale: 1, dx: 0, dy: 0, rot: 0, bright: 1, contrast: 1, flip: false });
  for (const v of p.slice(1)) {
    assert.ok(v.scale >= 0.7 && v.scale <= 0.95 && Math.abs(v.rot) <= 10 && v.bright >= 0.75 && v.bright <= 1.25 && !v.flip);
  }
  assert.deepEqual(augmentPlan(), p);
  assert.notDeepEqual(augmentPlan(10, 99), p);
});

test("newsToItem links the news and keeps details empty (filled from news automatically)", () => {
  const it = newsToItem({ id: 7, title_th: "Open House", suggest_kind: "event", images: ["/uploads/a.jpg"] });
  assert.deepEqual(it, { display_name: "Open House", kind: "event", details: {}, images: ["/uploads/a.jpg"], news_id: 7, ref: "news:7" });
  assert.equal(newsToItem({ id: 1, title_th: "x", images: [] }, "poster").kind, "poster");
});

test("only same-origin uploads can be used to teach the camera", () => {
  assert.ok(trainable("/uploads/x.jpg"));
  assert.ok(!trainable("https://example.com/x.jpg"));
  assert.ok(!trainable(""));
  assert.ok(!trainable(null));
});
