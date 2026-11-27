# VORA NEXT — Phase 6 Plan: AI Brain & Unified Design System

สถานะ: Gate 6A เสร็จ · ปรับลำดับ Gate 1 พ.ย. 2569 20:30 · Gate 6B เริ่ม 20:25 (ผู้ใช้สั่งพร้อมข้อกำหนด: ฟอนต์หลัก Anuphan, ตรึง `/pastel/` `/classic/`, ไม่เปลี่ยนหน้าตาเดิม) · สถานะล่าสุดดู `VORA_NEXT_PHASE6_PROGRESS.md`

เอกสารชุดนี้: `PHASE6_PLAN` (ไฟล์นี้) · `PHASE6_ARCHITECTURE` · `PHASE6_AI_BRAIN` · `PHASE6_DESIGN_SYSTEM` · `PHASE6_TEST_PLAN` · `PHASE6_PROGRESS` · `PHASE6_CHANGELOG`

---

## 1. จุดตั้งต้น (ตรวจจริง 1 พ.ย. 2569 20:00–20:40)

| หัวข้อ | สถานะ |
|---|---|
| Phase 0–5 | ผ่านทุก Gate · Phase 5 ยืนยันบน Windows แล้ว: `test.bat` **93 passed** (PostgreSQL `vora_test`) · Migration 0001 บน `vora` สำเร็จ 17:47 |
| Git | **ไม่มี Git repository** ใน `C:\VORA_Robot` (และไม่มีในโฟลเดอร์ย่อย) — ควบคุมเวอร์ชันด้วย `_backups/before-changes/` + `_backups/snapshots/` เท่านั้น · ไม่มีไฟล์ใดเปลี่ยนหลังการแก้ WinError 32 (18:05) |
| งานค้างจาก Phase 5 | ทดสอบ QR ของ Time Portal บนโทรศัพท์จริงซ้ำ (ขั้นตอน F ในรายงานวินิจฉัย) · ข้อเสนอแก้ E2–E4 (ป้ายกำกับ QR, `/m` redirect เก็บ query) **ยังรออนุมัติ** |
| ผลทดสอบอ้างอิง (Baseline Phase 6) | pytest **93/93** (Windows + Linux, PostgreSQL + SQLite) · เบราว์เซอร์ **150/150** (Gate 1 38 · Gate 2 21 · Gate 3 15 · Gate 4 14 · Gate 5 11 · Kiosk 25 · Idle 26) |

## 2. เป้าหมาย Phase 6

1. **AI Brain** — เพิ่มลำดับการสำรอง Online AI → Local AI → ฐานความรู้ (ทำงานได้เมื่อไม่มีอินเทอร์เน็ต) · ค้นเว็บแบบเลือกเปิด แยกป้ายชัดเจนว่าไม่ใช่ข้อมูลทางการ · **ข้อมูลของวิทยาลัยมาจากฐานความรู้ที่อนุมัติแล้วเท่านั้น (หลักเดิม ไม่เปลี่ยน)**
2. **Unified Design System** — ชุด Design Token / ฟอนต์ / ไอคอน / คอมโพเนนต์เดียวที่ Kiosk, Mobile, Admin ใช้ร่วมกัน แทน 2 ระบบที่ซ้อนกันอยู่ตอนนี้ (+ 2 ธีมเก่า)
3. ไม่รื้อระบบเดิม · API เดิมคงรูปแบบ (เพิ่มฟิลด์ได้อย่างเดียว) · ไม่เปลี่ยน Database ถ้าไม่จำเป็น (ดู AI_BRAIN ข้อ 7 — ออกแบบให้ **ไม่ต้อง Migration**)

## 3. Gate ของ Phase 6

| Gate | ชื่อ | ขอบเขตย่อ | แตะ DB? |
|---|---|---|---|
| **6A** | System Audit & Architecture Lock | เอกสารเท่านั้น | ไม่ |
| **6B** | Unified Design Foundation | `shared/tokens.css` (`--vora-*`) · ธีม dark/light · ฟอนต์ Anuphan · `components.css` · ไอคอน SVG · **ไม่เปลี่ยนหน้าตาเดิม** | ไม่ |
| **6C** | AI Provider Foundation | ProviderChain online → local → ฐานความรู้ · circuit breaker ต่อผู้ให้บริการ · งบเวลา · **แก้ S1 (Security Blocker)** · ตัด PII ก่อนส่ง | ไม่ |
| **6D** | AI Orchestrator & Answer Guard | QueryRouter · AnswerGuard ตรวจข้อมูลสำคัญ G1–G6 กับแหล่งที่อนุญาต · `answer_source`/`notice` · AI Status/Test (admin เท่านั้น) | ไม่ |
| **6E** | Web Search & Grounding | ค้นเว็บเฉพาะคำถามทั่วไป · โดเมนที่อนุญาต · ป้าย · ปิดเป็นค่าเริ่มต้น | ไม่ |
| **6F** | Mobile & Admin Integration | Mobile/Admin ใช้ Design System · แก้ P1 P3 P4 P5 P8 P9 · UI สถานะ AI | ไม่ |
| **6G** | Kiosk, Avatar & Voice Integration | Kiosk ใช้ Design System · emoji → SVG · ป้าย QR · `notice` + เสียง · แจ้งเมื่อฟังเสียงไม่ได้ (ไม่มี STT ออฟไลน์) · จอแนวตั้งถ้าอนุมัติ | ไม่ |
| **6H** | Full Integration & Release Validation | Regression ครบ · Windows + โทรศัพท์จริง + ตัดอินเทอร์เน็ต · สแกนคีย์/PII | ไม่ |

รายละเอียด AC / Automated / Manual / Backup / PASS-FAIL-BLOCKED ทุก Gate: `VORA_NEXT_PHASE6_TEST_PLAN.md` · ไฟล์ที่ได้รับผลกระทบ: `VORA_NEXT_PHASE6_ARCHITECTURE.md` ข้อ 6
ทำทีละ Gate และหยุดรายงานทุก Gate · 6E และการแก้จอแนวตั้งใน 6G ข้ามได้ถ้าผู้ใช้ไม่อนุมัติ (บันทึกว่า "ข้าม" ไม่ใช่ PASS)

**Baseline ทุก Gate:** pytest **93** · เบราว์เซอร์ **150** · Evaluation Cases **20** — ห้ามลดหรือข้าม
**Security Blocker S1** (ARCHITECTURE ข้อ 3.1): คีย์ Gemini อาจรั่วผ่าน `last_error` → `/api/kiosk/config` (สาธารณะ) และ `system_events` — **ห้ามเปิดผู้ให้บริการออนไลน์จนกว่า 6C แก้และผ่าน T-PRV**
**ข้อจำกัดออฟไลน์:** ฐานความรู้ทำงานออฟไลน์ · Local AI ออฟไลน์เฉพาะเมื่อติดตั้ง (D2) · **ฟังเสียงไม่ทำงานออฟไลน์** (Web Speech API ของ Chrome) · TTS ขึ้นกับเสียงในเครื่อง

## 4. หลักการที่ใช้ทุก Gate (คงจาก Phase 0–5)

- Backup ไฟล์ก่อนแก้ทุกครั้ง (`_backups/before-changes/<วันเวลา>_<ชื่อ>/` + MANIFEST.md5) · ไม่เขียนทับ Backup
- ห้ามปิด/ลบ/ลดเงื่อนไขทดสอบ · ห้ามรายงานผ่านโดยไม่ได้รันจริง
- ห้ามแตะ Robot / Firmware / Auth / Safety โดยไม่ขออนุมัติ · ไม่สั่งหุ่นยนต์จริง · ไม่ deploy production
- ไม่แสดง API Key ในเอกสาร / log / หน้าจอ / ผลทดสอบ
- ข้อมูลวิทยาลัยมาจากฐานความรู้ที่อนุมัติแล้วเท่านั้น · ไม่มี Face Recognition · ภาพกล้องไม่ออกนอกเครื่อง
- ไม่ติดตั้ง Dependency ใหม่โดยไม่ขออนุมัติ (แผน 6C–6E ใช้ `httpx` ที่มีอยู่แล้ว)

## 5. ไฟล์ที่ได้รับผลกระทบ

ตารางเต็มต่อ Gate: `VORA_NEXT_PHASE6_ARCHITECTURE.md` ข้อ 6 · **ไม่แตะในทุก Gate:** Database/Schema, `models.py`, `robot/*`, `firmware/*`, `security.py`, `routers/auth.py`, Avatar Adapter/Renderer, `/pastel/`, `/classic/`

## 6. ข้อตัดสินใจ (✅ = ตัดสินแล้ว · ที่เหลือต้องได้ก่อน Gate ที่เกี่ยวข้อง)

| # | เรื่อง | ตัวเลือก | ข้อเสนอ |
|---|---|---|---|
| D1 | Online AI หลัก | Gemini · OpenAI · Anthropic · Typhoon (ไทย) · ไม่ใช้ | ทีมเลือกตามงบ/บัญชีที่มี · ต้องมี API Key ของทีมเอง |
| D2 | Local AI สำรอง | ติดตั้ง Ollama + โมเดลไทย/หลายภาษา (เช่น qwen2.5 3B–7B) · ไม่ใช้ (สำรองด้วยฐานความรู้อย่างเดียว) | ต้องทราบสเปกเครื่อง (CPU/RAM/GPU) ก่อน — ถ้าไม่มี GPU โมเดล 7B อาจตอบช้า 10–40 วิ ไม่เหมาะกับหน้าจอหุ่นยนต์ |
| D3 | Web Search | เปิด/ปิด · ผู้ให้บริการค้นหา (ต้องมี API Key) · โดเมนที่อนุญาต · ประเภทคำถาม | **ปิดเป็นค่าเริ่มต้น** · ถ้าเปิด จำกัดโดเมนราชการ/การศึกษา และเฉพาะคำถามทั่วไป |
| D4 | ความเป็นส่วนตัว | ยอมให้ส่งข้อความคำถาม (ไม่มีข้อมูลส่วนตัว/ภาพ) ไปผู้ให้บริการภายนอกหรือไม่ · ต้องมีป้ายแจ้งบนจอหรือไม่ | แจ้งบนจอ + ไม่ส่งชื่อ/เบอร์ที่ผู้ใช้พิมพ์ (ตัดออกก่อนส่ง) |
| D5 | ทิศทางแบรนด์ | (ก) ดำ-เหลือง ของ Kiosk เป็นหลักทั้งแพลตฟอร์ม · (ข) น้ำเงิน blueprint ของ Mobile/Admin · (ค) แบบใหม่ | **(ก)** Kiosk โหมดมืด · Mobile/Admin โหมดสว่าง ใช้สีแบรนด์เหลือง-ดำเดียวกัน |
| D6 ✅ | ฟอนต์ — **ตัดสินแล้ว: Anuphan เป็นฟอนต์หลัก** (ผู้ใช้ 20:22) | Kanit+Inter (Kiosk) · Anuphan+Mitr (Mobile/Admin) | ครอบครัวเดียว (เสนอ Kanit หัวข้อ + Anuphan เนื้อความ หรือ Kanit ล้วน) |
| D7 | โลโก้ | ตัว "V VORA" (Kiosk) · ไอคอนหน้าหุ่นยนต์ (Mobile/Admin) | ใช้ทั้งคู่เป็นชุดเดียว (wordmark + สัญลักษณ์) ตามคู่มือเดียว |
| D8 ✅ | ธีมเก่า `/pastel/`, `/classic/` — **ตัดสินแล้ว: ตรึง ห้ามแก้** (ผู้ใช้ 20:22) | คงไว้แบบตรึง · เลิกใช้ (เก็บใน Backup) | คงไว้แบบตรึง ไม่ย้ายเข้าระบบใหม่ |
| D9 | ไอคอน | emoji ระบบ · ชุด SVG ของ VORA (ไม่ต้องติดตั้งแพ็กเกจ) | ชุด SVG |
| D10 | จอหุ่นยนต์จริง | แนวนอน / แนวตั้ง / ขนาด | ถ้าแนวตั้ง แก้ใน 6G (ปัญหาเดิมจาก Phase 1) |
| D11 | Git | เริ่มใช้ Git (ต้องให้สิทธิ์ลบไฟล์ lock ในโฟลเดอร์) · ไม่ใช้ | แนะนำ — ตอนนี้ไม่มีประวัติเวอร์ชันนอกจาก Backup |
| D12 | งานค้าง Phase 5 | อนุมัติแก้ QR E2–E4 · ทดสอบ QR ซ้ำ | ทำก่อนหรือรวมใน 6F |
| D13 | เวลาตอบสูงสุด | เช่น 4 วิ / 8 วิ | 6 วิรวมทุกชั้นสำรอง ก่อนตอบจากฐานความรู้ |
