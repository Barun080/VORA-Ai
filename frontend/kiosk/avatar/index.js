// จุดเดียวที่หน้า Kiosk ใช้สร้างอวตาร — เลือกตัววาดจาก config (หรือ ?avatar=layered ใน URL สำหรับทดสอบ)
import { AvatarController } from "./AvatarController.js";
import { PlaceholderRenderer } from "./AvatarRenderer.js";

export async function createAvatar(container, cfg = {}, { onStateChange } = {}) {
  const q = new URLSearchParams(location.search);
  const kind = q.get("avatar") || cfg.renderer || "placeholder";
  const manifest = q.get("avatarManifest") || cfg.manifest;
  // แสดงอวตารจำลองก่อนทันที ไม่ให้หน้าจอว่างระหว่างโหลดภาพอวตารจริง
  const ctrl = new AvatarController(new PlaceholderRenderer(container), { onStateChange });
  ctrl.kind = "placeholder";
  ctrl.container = container;
  // Phase 2: ใช้ loadCharacter() ของ Avatar Adapter (โหลดไม่ได้ = ใช้อวตารจำลองต่อ เหมือนเดิม)
  if (kind === "layered" && manifest) ctrl.loadResult = await ctrl.loadCharacter({ renderer: "layered", manifest });
  // อวตาร VORA ตัวจริง (VoraLiveRig) — โหลดเบื้องหลัง ไม่ให้หน้าจอรอ แล้วสลับเมื่อภาพครบ
  // ระหว่างโหลดซ่อนอวตารจำลองไว้ (ไม่ให้เห็นตัวละครคนละตัวสลับกัน) — โหลดไม่สำเร็จจะแสดงอวตารจำลองตามเดิม
  if (kind === "rig") {
    container.classList.add("is-loading");
    ctrl.loadResult = ctrl.loadCharacter({ renderer: "rig" }).finally(() => container.classList.remove("is-loading"));
  }
  return ctrl;
}
