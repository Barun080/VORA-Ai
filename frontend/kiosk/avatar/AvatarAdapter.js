// Avatar Adapter Interface — สัญญาระหว่าง "ระบบหลัก" กับ "ตัวละคร" (VORA NEXT Phase 2)
// ระบบหลัก (AI, กล้อง, เสียง, Spatial UI, Scene) เรียกอวตารผ่านคำสั่งในรายการนี้เท่านั้น
// เมื่อได้อวตารจริง (PSD → ภาพเลเยอร์ / Live2D / Spine / Sprite) ให้ทำ Renderer ใหม่ที่ AvatarController ใช้ได้
// หรือทำคลาสใหม่ที่มีคำสั่งครบตามรายการนี้ แล้วตรวจด้วย assertAvatarAdapter() — ไม่ต้องแก้ระบบหลัก
// รายละเอียด: docs/AVATAR_INTEGRATION.md

export const AVATAR_ADAPTER_METHODS = Object.freeze([
  "loadCharacter",   // async (cfg) → { kind, ok, fallback, error? }
  "setState",        // (state) — idle, greeting, listening, thinking, speaking, presenting, pointing, waving, thanking, happy (+ announcing, error)
  "setExpression",   // (name) → { expression, supported }
  "playAnimation",   // (name) → { name, supported, durationMs } — ไม่รองรับ = supported:false (ห้ามแสดงว่าเล่นสำเร็จ)
  "setGaze",         // (x, y) ช่วง -1..1
  "setSpeech",       // ({ text?, partial?, level? }) — level 0..1 สำหรับ Lip Sync
  "setVisibility",   // (visible) → boolean
  "dispose",         // () — คืนทรัพยากรทั้งหมด
  "capabilities",    // () → { kind, states, animations, expressions, lipSync }
]);

/** ตรวจว่าออบเจ็กต์มีคำสั่งครบตามสัญญา — คืนรายชื่อที่ขาด (ว่าง = ครบ) */
export function missingAdapterMethods(obj) {
  return AVATAR_ADAPTER_METHODS.filter((m) => !obj || typeof obj[m] !== "function");
}

export function assertAvatarAdapter(obj) {
  const miss = missingAdapterMethods(obj);
  if (miss.length) throw new Error(`Avatar Adapter ไม่ครบ: ขาด ${miss.join(", ")}`);
  return obj;
}
