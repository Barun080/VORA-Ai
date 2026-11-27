// VORA Guide — ลำดับขั้นและข้อความ (17 พ.ย. 2569 · ข้อความอนุมัติแล้ว ห้ามแก้โดยไม่ได้รับอนุมัติ)
// targets: รายการ "กลุ่ม" — แต่ละกลุ่ม = 1 ช่อง Spotlight (กรอบรวมของทุก element ในกลุ่ม)
//   #railMenu เป็น display:contents (ไม่มีกรอบของตัวเอง) → ใช้ element ลูก (แถบปุ่มหมวด)
//   selector แบบ "A || B" = ใช้ตัวแรกที่มองเห็นได้ (อวตาร: canvas ของ VoraRig — #stage/#avatar กว้างเต็มจอบนจอใหญ่)
// ข้อความ body = ข้อความที่แสดงและข้อความที่ VORA พูด (ชุดเดียวกัน)

export const GUIDE_STEPS = Object.freeze([
  { id: "avatar", targets: [["#avatar canvas || #avatar img || #avatar"]],
    th: { title: "VORA ผู้ช่วย AI", body: "สวัสดีค่ะ หนูคือ VORA ผู้ช่วย AI ของวิทยาลัย ถามเรื่องสาขาวิชา การสมัครเรียน ข่าว และกิจกรรมได้เลยค่ะ" },
    en: { title: "VORA, your AI assistant", body: "Hi, I'm VORA, the college's AI assistant. Ask me about programs, admission, news and activities." } },
  { id: "mic", targets: [["#micBtn"]],
    th: { title: "ไมโครโฟน", body: "แตะปุ่มไมโครโฟนแล้วพูดคำถามได้เลยค่ะ หนูจะตอบเป็นเสียงและข้อความ" },
    en: { title: "Microphone", body: "Tap the microphone and say your question. I'll answer by voice and on screen." } },
  { id: "chat", targets: [["#askForm"]],
    th: { title: "ช่องพิมพ์คำถาม", body: "ถ้าไม่สะดวกพูด พิมพ์คำถามในช่องนี้แล้วกดส่งได้ค่ะ" },
    en: { title: "Type a question", body: "Prefer typing? Type your question here and press send." } },
  { id: "nav", targets: [["#homeBtn", "#railMenu > *"]],
    th: { title: "เมนูหลัก", body: "เมนูนี้พาไปดูข้อมูลวิทยาลัย สาขาวิชา ข่าวสาร และการรับสมัคร แตะ \"หน้าหลัก\" เพื่อกลับมาหน้านี้ค่ะ" },
    en: { title: "Main menu", body: "This menu shows the college, programs, news and admission. Tap \"Home\" to come back here." } },
  { id: "qr", targets: [["#qrBtn"]],
    th: { title: "สแกน QR", body: "สแกน QR ด้วยมือถือ เพื่อถามต่อหรือดูข้อมูลบนมือถือของคุณค่ะ" },
    en: { title: "Scan QR", body: "Scan the QR code with your phone to keep asking or read more there." } },
  { id: "camera", targets: [["#camBtn"], ["#camPill"]],
    th: { title: "ระบบกล้อง", body: "กล้องใช้ตรวจว่ามีคนมาใช้งาน ประมวลผลในเครื่องและไม่บันทึกภาพ แตะป้ายกล้องเพื่อพักกล้อง หรือแตะปุ่มกล้องเพื่อดูภาพจากกล้องได้ค่ะ" },
    en: { title: "Camera", body: "The camera only detects that someone is here. It runs on this device and saves no images. Tap the camera badge to pause it, or the camera button to see the view." } },
  { id: "status", targets: [["#sysPill"]],
    th: { title: "สถานะระบบ", body: "ตรงนี้บอกว่าระบบพร้อมใช้งานหรือไม่ ถ้าขึ้นว่าขัดข้อง กรุณาแจ้งเจ้าหน้าที่ค่ะ" },
    en: { title: "System status", body: "This shows whether the system is ready. If it shows a problem, please tell a staff member." } },
  { id: "lang", targets: [[".hdr .lang"]],
    th: { title: "เปลี่ยนภาษา", body: "เลือกภาษาไทยหรือ English ได้ที่นี่ หนูจะพูดและแสดงข้อความตามภาษาที่เลือกค่ะ" },
    en: { title: "Language", body: "Switch between Thai and English here. I'll speak and show text in the language you choose." } },
  { id: "settings", targets: [["#toolsBtn"]],
    th: { title: "ตั้งค่า", body: "ปุ่มตั้งค่าใช้เปลี่ยนธีมสีมืดหรือสว่าง และดูสถานะระบบแบบละเอียดค่ะ" },
    en: { title: "Settings", body: "Settings lets you switch between dark and light themes and see detailed system status." } },
  { id: "fullscreen", targets: [["#fsBtn"]],
    th: { title: "เต็มจอ", body: "แตะปุ่มนี้เพื่อแสดงผลเต็มจอ แตะอีกครั้งเพื่อออกค่ะ จบการแนะนำแล้ว ถามหนูได้เลยนะคะ" },
    en: { title: "Fullscreen", body: "Tap here for fullscreen, and tap again to exit. That's the tour. Go ahead and ask me anything!" } },
]);

export const GUIDE_UI = Object.freeze({
  th: { name: "VORA Guide", counter: (i, n) => `ขั้นที่ ${i} จาก ${n}`, back: "ย้อนกลับ", next: "ถัดไป", finish: "เสร็จสิ้น", close: "ปิด",
    voiceHint: "กดไมค์แล้วพูด “ถัดไป” “ย้อนกลับ” หรือ “หยุดแนะนำ” ได้" },
  en: { name: "VORA Guide", counter: (i, n) => `Step ${i} of ${n}`, back: "Back", next: "Next", finish: "Finish", close: "Close",
    voiceHint: "" },   // โหมด English ควบคุมด้วยปุ่มอย่างเดียว (อนุมัติ 17 พ.ย. 2569) — ไม่แสดงคำใบ้เสียง
});

export const GUIDE_TIMEOUT_MS = 60000;   // ไม่มี interaction 60 วิ → จบ Guide เอง

// ปุ่มที่คลิกได้เสมอระหว่าง Guide แม้ไม่ได้ถูก Highlight: ปุ่มหยุดใน dock (stopAll เดิม · ความปลอดภัย — อนุมัติข้อ 16)
export const GUIDE_ALWAYS_ALLOW = Object.freeze(["#stopBtn"]);
