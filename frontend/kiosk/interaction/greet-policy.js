// นโยบายการทักทายผู้เข้าชม (16 พ.ย. 2569) — ตรรกะล้วน ไม่มี DOM/เครือข่าย/เวลา (ทดสอบด้วย node ได้: frontend/tests/kiosk/greet-policy.test.mjs)
// กติกา "ผู้เข้าชมใหม่" (arrival): ไม่เห็นใครครบ absenceGreetMs (ค่าเริ่มต้น 8 วิ) แล้วมีคนเข้ามา → ทักทันที
//   - ไม่รอคูลดาวน์ทักทาย (VORA_GREETING_COOLDOWN) — คูลดาวน์ยังใช้กับการทักที่ไม่ได้มาจากผู้เข้าชมใหม่ (ท่าแบมือ / การทักที่ค้างไว้)
//   - บทสนทนาของคนก่อนค้างอยู่บนจอ: ทักได้ถ้าไม่มีใครแตะ/พูดกับหน้าจอมาแล้ว absenceGreetMs → ล้างบทสนทนาเก่าก่อนทัก ("greet-reset")
//   - ไม่ทักแทรกขณะ VORA กำลังฟัง/คิด/ตอบผู้ใช้ (เหมือนเดิม)
// การทักที่ไม่ใช่ arrival ทำงานเหมือนเดิมทุกประการ (ชุดทดสอบเทียบกับกติกาเดิมทุกกรณี)

export const STALE_CONVO_MS = 20000;       // กติกาเดิม (10 พ.ย. 2569): บทสนทนาค้าง 20 วิ ไม่ขวางการทักคนใหม่

/** Session ของผู้เข้าชมจบเมื่อไม่เห็นใคร leaveMs แล้ว → ต้องเว้นอีกเท่านี้จึงครบ absenceGreetMs นับจากครั้งสุดท้ายที่เห็นคน */
export function returnWindowMs({ absenceGreetMs = 8000, leaveMs = 6000 } = {}) {
  return Math.max(0, absenceGreetMs - leaveMs);
}

/** → "skip" (ไม่ทัก) | "wait" (รอจน VORA ว่าง) | "cooldown" (เลื่อนไปทักเมื่อพ้นคูลดาวน์) | "greet" | "greet-reset" (ล้างบทสนทนาเก่าแล้วทัก) */
export function greetDecision({ force = false, arrival = false, autoGreeting = true, phase = "attract", state = "idle", speakingKind = null,
  quietMs = 0, sinceGreetMs = Infinity, cooldownMs = 25000, absenceGreetMs = 8000 } = {}) {
  const stale = phase === "convo" && state === "idle" && quietMs > (arrival ? absenceGreetMs : STALE_CONVO_MS);
  if (!force && (!autoGreeting || (phase !== "attract" && !stale))) return "skip";
  if (state === "listening" || state === "thinking" || (state === "speaking" && speakingKind === "conversation")) return "wait";
  if (!force && !arrival && sinceGreetMs < cooldownMs) return "cooldown";
  return arrival && !force && phase !== "attract" ? "greet-reset" : "greet";
}
