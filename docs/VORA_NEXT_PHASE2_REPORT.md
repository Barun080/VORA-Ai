# VORA NEXT — Phase 2 Report: Living Character & Vision Awareness

วันที่: 1 พ.ย. 2569 00:05 – 01:40 (Asia/Bangkok)

**PHASE: 2 · STATUS: PASS**

## สรุป

ตรวจแล้วว่าระบบเดิมมี Camera Lifecycle, Visitor Presence Session, Cooldown และการทักทายหลายคนอยู่แล้ว (ไม่สร้างใหม่) Phase 2 จึงเติมเฉพาะส่วนที่ขาด:

1. **Avatar Adapter Interface** ครบ 9 คำสั่งบน `AvatarController` เดิม + ตัวตรวจสัญญา `AvatarAdapter.js` + `capabilities()` รายงานความสามารถจริง
2. **สถานะใหม่ 4 แบบ** `presenting, pointing, waving, thanking` (รวมมาตรฐาน 10 + `announcing, error` เดิม) พร้อมลำดับความสำคัญที่ไม่ทับการฟัง/คิด/ขัดข้อง และเชื่อมกับการใช้งานจริง
3. **Privacy Pause สำหรับผู้เข้าชม** — ปิดกล้องจริง กลับมาเองเมื่อครบเวลา เห็นสถานะได้ทุกโหมด
4. **Smart Greeting** — หลังทักทาย แนะนำหมวดจากข้อมูลจริง
5. **`docs/AVATAR_INTEGRATION.md`** ตาม Additional Requirement

ไม่แตะ: Backend, Database, Robot, Firmware, Authentication, `shared/vision.js`, `VisitorTracker.js`, `voice.js`

## รายละเอียด

### A. Avatar Controller / Adapter
`loadCharacter, setState, setExpression, playAnimation, setGaze, setSpeech, setVisibility, dispose, capabilities` — ทำใน `AvatarController.js` (ต่อยอด ไม่เขียนใหม่) · `avatar/index.js` ใช้ `loadCharacter()` แทนโค้ดโหลดเดิม (พฤติกรรมเดิม: โหลดไม่ได้ → ใช้ Placeholder ต่อ)
- `playAnimation()` ท่าที่ไม่มี/Renderer ไม่รองรับ → `{ supported: false }` และไม่เล่น (ตามข้อ "ห้ามแสดงว่าเล่นสำเร็จ")
- `manifest.json` ของอวตารจริงระบุ `animations[]` ได้ (ท่าที่ตัวละครทำได้จริง)
- ไม่มีชื่อเลเยอร์/ไฟล์ PSD ในระบบหลัก

### B. สถานะการนำเสนอ (Event `AVATAR_HINT`)
| เหตุการณ์จริง | สถานะ |
|---|---|
| เข้าโหมดนำเสนอ (Phase 1) | `presenting` ค้างจนปิด |
| เปิดรายละเอียดสาขา/ข่าว | `pointing` 2.5 วิ แล้วกลับ `presenting` |
| ส่งแบบประเมินความพึงพอใจ | `thanking` 2.6 วิ |
| ทักทาย | `greeting` (เดิม, ท่า wave) |

ลำดับ: ฟัง/คิด > ทักทาย/ประกาศ > นำเสนอ (ชั่วคราว > ค้าง) > พูด · ขณะว่าง ดีใจ > ขัดข้อง > นำเสนอ > idle · พูดในท่านำเสนอ ปากยังขยับ

### C. Camera Lifecycle + Privacy Pause
- ใช้ CameraManager เดิม (เปิดตาม Permission, ไม่เปิดซ้อน, แยกสาเหตุขัดข้อง, เชื่อมต่อใหม่) — เพิ่ม `privacyPause(ms)` / `privacyResume()`
- **ผู้เข้าชม** แตะป้ายกล้องที่หัวจอ (โหมดใช้งาน) หรือป้ายลอยมุมซ้ายล่าง (โหมดว่าง) → หยุด Track จริง MediaPipe หยุด ล้าง Visitor Session แสดง "พักกล้องชั่วคราว · กลับมาใน m:ss" → กลับมาเองเมื่อครบ `camera.privacyPauseMs` (ค่าเริ่มต้น 5 นาที) หรือแตะอีกครั้ง
- ต่างจาก "ปิดกล้องโดยเจ้าหน้าที่" (เดิม) ที่ปิดถาวรและจำค่า — เจ้าหน้าที่ปิดแล้วผู้เข้าชมเปิดเองไม่ได้
- กล้องไม่ได้รับอนุญาต/ไม่พบกล้อง → ไม่มีปุ่มพัก แตะป้ายกล้องเปิดแผงช่วยเหลือเหมือนเดิม

### D. Vision Awareness / Smart Greeting
- ตรวจจับ: MediaPipe Face Detection เดิม (นับคนจากกรอบใบหน้า **ไม่จดจำใบหน้า**) · Presence Session ชั่วคราว · Cooldown · กลับมาในช่วงคูลดาวน์ไม่ทักซ้ำ · หลายคนทักครั้งเดียวด้วยข้อความกลาง — ของเดิม ยืนยันด้วยทดสอบใหม่
- อวตารหันไปทางผู้เข้าชม (เดิม) · ผู้เข้าชมออก → มองตรง
- **ใหม่:** หลังทักทายจบ แนะนำหมวด: มีข่าวรับสมัครที่เผยแพร่ → "รับสมัคร + สาขาวิชา" ไม่มี → "สาขาวิชา + ข่าวสาร" — ไฮไลต์ปุ่มใน Orbital Menu 12 วิ และเปลี่ยนข้อความแนะนำในโหมดว่าง
- ไม่ติดตามตำแหน่งบุคคลเกินจำเป็น (เดิม: ล้าง Tracking ID ทุกครั้งที่ Session จบ)

## ไฟล์

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `frontend/kiosk/avatar/AvatarAdapter.js` | **ใหม่** |
| `frontend/kiosk/avatar/AvatarController.js` | + Adapter 9 คำสั่ง, สถานะนำเสนอ 2 ชั้น, ลำดับความสำคัญ, ปากขยับขณะพูดในท่านำเสนอ, หยุดวาดเมื่อซ่อน/dispose |
| `frontend/kiosk/avatar/avatar-states.js` | + 4 สถานะ, `STANDARD_STATES`, `EXPRESSIONS` |
| `frontend/kiosk/avatar/AvatarRenderer.js` | + `supportsAnimation()` |
| `frontend/kiosk/avatar/LayeredImageRenderer.js` | + อ่าน `animations[]` จาก manifest |
| `frontend/kiosk/avatar/index.js` | ใช้ `loadCharacter()` |
| `frontend/kiosk/avatar/README.md` | อ้างถึง Adapter + เอกสารใหม่ |
| `frontend/kiosk/camera/CameraManager.js` | + สถานะ `paused`, `privacyPause/privacyResume` (ไม่ retry/เปิดเองระหว่างพัก) |
| `frontend/kiosk/camera/CameraVisitorController.js` | + `privacyToggle()` |
| `frontend/kiosk/core/event-bus.js` | + `AVATAR_HINT`, `CAMERA_PRIVACY`, `VISITOR_GREETED` |
| `frontend/kiosk/experience/SpatialMenu.js` | + `highlight()` |
| `frontend/kiosk/app.js` | + ข้อความ 2 ภาษา, `togglePrivacy`, `renderPrivacy`, `suggestAfterGreeting`, `onGreeted`, เชื่อม hint กับโหมดนำเสนอ/รายละเอียด/ประเมิน · ป้ายกล้องหัวจอ = พัก/เปิดกล้อง (สถานะอื่นยังเปิดแผงเครื่องมือ) |
| `frontend/kiosk/index.html` | + ไอคอนพักบนป้ายกล้อง, ป้ายกล้องโหมดว่าง `#camBadge` |
| `frontend/kiosk/kiosk.css` | + ส่วน "VORA NEXT Phase 2" ต่อท้าย |
| `frontend/kiosk/kiosk-config.js` | + `camera.privacyPauseMs` |
| `docs/AVATAR_INTEGRATION.md`, `docs/vora-next/phase2/` | **ใหม่** |

## ผลทดสอบ (Linux + Chromium จริง + เซิร์ฟเวอร์ VORA จริง, SQLite)

ดูตารางผลรวมใน `VORA_NEXT_PROGRESS.md` และไฟล์ผลดิบใน `docs/vora-next/phase2/`

### Gate 2

| เกณฑ์ | ผล | ข้อทดสอบ |
|---|---|---|
| Camera Stream ทำงานต่อเนื่อง | ✅ | 13 |
| ไม่มี Duplicate Stream | ✅ | 13, 15 (พักแล้วเปิดใหม่ = 1 ครั้งพอดี) |
| Person Detection ทำงาน | ✅ (ตรรกะ) | 7, 11 — ⚠️ ยังไม่ได้ทดสอบกับคนจริง |
| Greeting ไม่ทำงานซ้ำไม่หยุด | ✅ | 8, 10, 11 |
| Avatar State เปลี่ยนถูกต้อง | ✅ | 2, 5, 6 |
| Permission Handling ทำงาน | ✅ | 17 |
| Privacy Pause ทำงาน | ✅ | 14, 15, 16 |
| ไม่มีการระบุตัวบุคคล | ✅ | 12 (ไม่มีภาพ/Embedding/Landmark ใน Request/Storage/Session) |
| Regression Tests ผ่าน | ✅ | ดู PROGRESS |

### บั๊ก/ปัญหาที่พบระหว่างทดสอบ
1. **(บั๊กจริง)** แตะป้ายกล้องในโหมดว่าง: `pointerdown` ปลุกหน้าจอทำให้ป้ายถูกปิดรับการแตะก่อน `click` มาถึง ผู้เข้าชมต้องแตะ 2 ครั้ง → เปลี่ยนเป็นซ่อนด้วย `visibility` หลังจางหายเสร็จ
2. ป้ายกล้องโหมดว่างมุมซ้ายบนทับกล่องคำพูด → ย้ายไปมุมซ้ายล่าง
3. ปัญหาของสคริปต์ทดสอบ (แก้ที่ชุดทดสอบ ไม่ลดเงื่อนไขผ่าน): ป้อนผู้เข้าชมจำลองแบบกำหนดเวลาตายตัวไม่พอบนเครื่องที่ MediaPipe บล็อก main thread 1–5 วิ (วัดแล้วโค้ดก่อน Phase 2 ก็หน่วงเท่ากัน), ระบบไม่ทักทายแทรกบทสนทนาที่ค้างอยู่ (ต้องเริ่มบทสนทนาใหม่ก่อนทดสอบ), เบราว์เซอร์ทดสอบที่อนุญาตกล้องอัตโนมัติทดสอบกรณีไม่ได้รับสิทธิ์ไม่ได้, กล้องเสมือนตรวจเจอใบหน้าหลอกเป็นครั้งคราว

## Known Issues
- ยังไม่ได้ทดสอบกับคนจริงหน้ากล้อง / เว็บแคมจริง / จอสัมผัสจริง
- ตรวจจับจาก "ใบหน้า" (ระบบเดิม): คนหันหลังหรือใส่หน้ากากอาจไม่ถูกนับ
- Lip Sync กับเสียงเบราว์เซอร์เป็นการจำลองจังหวะปาก (Web Speech API ไม่ให้ระดับเสียง)
- `setState()` ของ Adapter เป็นคำสั่งระดับตัวละคร — เมื่อเชื่อมกับระบบสนทนาแล้ว เหตุการณ์ถัดไปจะกำหนดสถานะใหม่ ใช้ `AVATAR_HINT` ถ้าต้องการให้ค้าง (บันทึกใน AVATAR_INTEGRATION.md)
- ป้ายกล้องหัวจอเปลี่ยนพฤติกรรม: เดิมแตะแล้วเปิดแผงเครื่องมือ ตอนนี้ (เมื่อกล้องทำงาน) = พักกล้อง · เจ้าหน้าที่เปิดแผงเครื่องมือได้จากปุ่ม "เครื่องมือ" ในแถบล่าง

## Rollback
คัดลอกไฟล์จาก `_backups/before-changes/2026-11-01_0005_before-phase2-character/` กลับตำแหน่งเดิม (ไฟล์ใหม่ `avatar/AvatarAdapter.js` ไม่ถูกเรียกเมื่อไฟล์เดิมกลับมา)
