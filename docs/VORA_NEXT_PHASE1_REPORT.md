# VORA NEXT — Phase 1 Report: Spatial Experience Foundation

วันที่: 31 ต.ค. 2569 23:10 – 1 พ.ย. 2569 00:30 (Asia/Bangkok)

**PHASE: 1 · STATUS: PASS**

## สรุป

เพิ่ม **Experience Orchestrator** (IDLE ⇄ ACTIVE ⇄ PRESENTATION), **Orbital Menu** 6 หมวดรอบอวตาร (เปลี่ยนเป็น Compact Menu อัตโนมัติบนจอเล็ก), **Presentation Mode** (Floating Cards จากข้อมูลจริง) และ **เมนูตัวอักษรใหญ่** สำหรับผู้สูงอายุ — ต่อยอดจาก UIController / AvatarController / CameraManager เดิม ไม่สร้างใหม่ ไม่แตะ Backend, Database, Robot, Firmware, Authentication

## โครงสร้าง (ตามข้อเน้นย้ำข้อ 1)

```
Application (frontend/kiosk/app.js)
 ├── CameraManager            (เดิม · Persistent)  ← ไม่รู้จัก UI State เลย
 ├── LiveSocket /ws           (เดิม · 1 connection)
 ├── AvatarController         (เดิม · + ResizeObserver บนเวที)
 ├── UIController idle-ui.js  (เดิม · + extraBusy hook)
 └── ExperienceOrchestrator   (ใหม่) ── data-mode = idle | active | presentation
       ├── SpatialMenu        (ใหม่) Orbital ↔ Compact · คีย์บอร์ด · Touch
       └── PresentationView   (ใหม่) /api/programs · /api/news · /api/kiosk/config เดิม
```

การเปลี่ยนโหมด = สลับ class/`data-mode` บน `#app` เท่านั้น — กล้อง WebSocket อวตาร ไม่ถูกปิด/สร้างใหม่ (ยืนยันด้วยทดสอบข้อ 14–16)

## ฟีเจอร์ตามสเปก

| สเปก | สิ่งที่ทำ |
|---|---|
| A. Idle Mode | ใช้โหมด Idle เดิม (อวตารขยายกลางจอ ซ่อนแผง ข้อความแนะนำ) + ซ่อน Orbital Menu · อวตารยังขยับ/ทักทายได้ · กล้อง/เสียงทำงานต่อ |
| B. Active Mode | Trigger: เมาส์ คลิก แตะ คีย์บอร์ด เสียง ท่ามือ (เดิม) · แสดง Orbital Menu + Quick Actions + Chat + Tool Icons + Voice Controls · **Visitor Detection: ดูข้อตัดสินใจด้านล่าง** |
| C. Presentation Mode | ขยายพื้นที่ข้อมูล (เวทีอวตารซ้าย / ข้อมูลขวา) · Floating Cards + ภาพ · รายละเอียด + อวตารบรรยายด้วยเสียง (`openCard` เดิม) · ปุ่มกลับ/ปิด/Esc → Active · ไม่มีการใช้งาน 45 วิ **และไม่มีงานค้าง** → Idle |
| D. Spatial UI | 6 หมวด College / Departments / News / Admission / AI Assistant / Feedback · คลิก แตะ Hover คีย์บอร์ด (ลูกศร Home End Enter Esc) · Animation: ออกจากตัวอวตาร (Orbit/Scale/Fade), ลอย (Float), เลือก (Pulse), ปิด (Fade) · CSS Transform + SVG + JS |
| E. Responsive | 1366/1600/1920 = Orbital · แท็บเล็ต 768×1024 = Orbital · มือถือ 390×844 = Compact (แถวเลื่อนได้) · Presentation บนจอ ≤1100 px = เต็มจอ |
| ไม่บังหน้าอวตาร | ตำแหน่งคำนวณจากขนาดอวตารจริง: ทุกปุ่มต่ำกว่าระดับใบหน้า (30% บนของตัว) ไม่ทับตัวอวตาร ไม่ทับกัน ไม่ทับกล่องคำพูด — ถ้าที่ไม่พอเปลี่ยนเป็น Compact |
| เมนูข้อความผู้สูงอายุ | ปุ่ม "ตัวอักษรใหญ่" ในแถบล่าง → รายการ 6 หมวด ตัวอักษร ~35 px ปุ่มสูง ~100 px |
| Reduced Motion | ปิด Animation ลอย/เคลื่อนทั้งหมด |

**ข้อมูลจริงเท่านั้น:** หมวดวิทยาลัย/รับสมัครแสดง "คำถาม" ที่ส่งให้ AI เดิมตอบจาก Approved Knowledge Base — ไม่มีข้อความเกี่ยวกับวิทยาลัยเขียนตายตัวในหน้า · ถ้าไม่มีข่าวรับสมัครจะแสดง "ยังไม่มีประกาศรับสมัครที่เผยแพร่"

## ข้อตัดสินใจที่ควรรู้ (ต้องการความเห็นทีม)

1. **ผู้เข้าชมเดินเข้ามา → เปิด Active หรือไม่:** Master Prompt ระบุ Visitor Detection เป็น Trigger ของ Active แต่รอบก่อนหน้า (31 ต.ค. รอบ 2) กำหนดให้ "อวตารทักทายในโหมด Idle ได้ โดยหน้าจอไม่เด้ง" และมีชุดทดสอบยืนยันไว้ → ทำเป็นตัวเลือก `experience.wakeOnVisitor` ใน `kiosk-config.js` **ค่าเริ่มต้น `false` (คงพฤติกรรมเดิม)** · ตั้ง `true` แล้วจะเปิด Active เมื่อพบผู้เข้าชม (ทดสอบแล้วทั้ง 2 แบบ ข้อ 6b) — แจ้งได้ถ้าต้องการให้ค่าเริ่มต้นเป็น `true`
2. **เมนูซ้ายเดิม** (ลิ้นชักข้อมูลในแผงขวา) ยังอยู่และใช้งานได้เหมือนเดิม — Orbital Menu เป็นทางเข้าเพิ่ม ไม่ได้แทนที่
3. **Space บนปุ่มที่โฟกัส** = กดปุ่มนั้น (เดิม Space เริ่มฟังเสมอ) เพื่อให้ Keyboard Navigation ใช้ได้ · Space ที่อื่นยังเริ่มฟังเหมือนเดิม · **Esc ยังสั่งหยุดเสียง + `/api/robot/stop` เสมอ** แม้อยู่ในโหมดนำเสนอ

## ไฟล์

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `frontend/kiosk/experience/ExperienceOrchestrator.js` | **ใหม่** |
| `frontend/kiosk/experience/SpatialMenu.js` | **ใหม่** |
| `frontend/kiosk/experience/PresentationView.js` | **ใหม่** |
| `frontend/kiosk/app.js` | + import, `startExperience()`, `onSection()`, `renderTextMenu()`, ตัวเลือก wakeOnVisitor (2 จุด), Space บนปุ่ม, debug hooks |
| `frontend/kiosk/index.html` | + `<section id="present">`, ปุ่ม "ตัวอักษรใหญ่", `<dialog id="textMenu">` |
| `frontend/kiosk/kiosk.css` | + ส่วน "VORA NEXT Phase 1" ต่อท้ายไฟล์ (กฎเดิมไม่แก้) |
| `frontend/kiosk/idle-ui.js` | + ตัวเลือก `extraBusy`, แยก `busyIgnoringExtra()` (ตรรกะเดิมไม่เปลี่ยน) |
| `frontend/kiosk/core/event-bus.js` | + `EXPERIENCE_MODE`, `EXPERIENCE_OPEN`, `EXPERIENCE_CLOSE` |
| `frontend/kiosk/avatar/AvatarController.js` | + สังเกตขนาดเวที (1 บรรทัด) เพื่อคำนวณ Focus ใหม่หลังออกจากโหมดนำเสนอ |
| `frontend/kiosk/kiosk-config.js` | + `experience: { orbitalMenu, presentationIdleMs, wakeOnVisitor }` |
| `docs/vora-next/phase1/` | ชุดทดสอบ Gate 1 + ผล + ภาพหน้าจอ |

**ไม่ได้แก้:** Backend ทั้งหมด, Database/Schema, Robot (protocol/bridge/drivers/simulator), Firmware, Authentication, `shared/vision.js`, `CameraManager.js`, `VisitorTracker.js`, `voice.js`, หลังบ้าน, หน้ามือถือ, `/pastel/`, `/classic/`

## ผลทดสอบ (เครื่องทดสอบ Linux, Chromium จริง + เซิร์ฟเวอร์ VORA จริง, SQLite)

| ชุด | ผล |
|---|---|
| **Gate 1** `docs/vora-next/phase1/phase1-scenarios.js` | **38/38 ผ่าน** |
| Regression: pytest | **46/46 ผ่าน** |
| Regression: Kiosk เดิม `browser-scenarios.js` | **25/25 ผ่าน** |
| Regression: Idle/Focus เดิม `idle-scenarios.js` | รอบ 1: 25/26 (ข้อ 5b ไม่ผ่าน) → รันข้อ 5 แยก 2 รอบ ผ่าน → **รันทั้งชุดซ้ำ 26/26 ผ่าน** |

**หมายเหตุข้อ 5b (ลำดับ Event การทักทาย):** รอบแรกล้มหลังรีสตาร์ทเซิร์ฟเวอร์ทันที มี Event `avatar:alert`/`avatar:speaking` สลับถี่ผิดปกติ (สถานะการเชื่อมต่อยังไม่นิ่ง) — รันซ้ำ 3 ครั้งผ่านทั้งหมด และ Phase 1 ไม่ได้แก้เส้นทางการทักทาย (`greet()`, `VisitorTracker`, `AvatarController` ส่วน Event) จึงจัดเป็น **ผลไม่เสถียรของชุดทดสอบเดิมบนเครื่องที่ไม่มี GPU** ไม่ใช่ Regression — บันทึกเป็น Known Issue ให้ตรวจบนเครื่องจริง

### Gate 1

| เกณฑ์ | ผล | หลักฐาน (ข้อทดสอบ) |
|---|---|---|
| Idle ทำงานถูกต้อง | ✅ | 4@1366/1600/1920 |
| Active ทำงานถูกต้อง | ✅ | 1, 3, 6, 6b |
| Presentation ทำงานถูกต้อง | ✅ | 7, 7b, 8, 9, 10, 12 |
| Camera ไม่หยุดเมื่อเปลี่ยน State | ✅ | 14: `getUserMedia` 1→1 ครั้ง, track `live`, วิดีโอเดินต่อ 100→125 วิ หลังสลับ 5 รอบ |
| WebSocket ไม่หลุดเมื่อเปลี่ยน State | ✅ | 15: สร้าง 1 ครั้ง เปิดอยู่ 1 |
| Avatar ไม่กระตุก | ✅ (ตรรกะ) | 16: SVG เดิมตัวเดียว ไม่สร้างใหม่ · 17: สลับรัว 30 ครั้งไม่ค้าง · ⚠️ ความลื่นด้วยตาต้องดูบนเครื่องจริงที่มี GPU |
| UI ไม่บังเนื้อหาสำคัญ | ✅ | 1, 2 (ใบหน้า ตัวอวตาร กล่องคำพูด ไม่ทับ) · 5 (มือถือ/แท็บเล็ต) |
| ระบบเดิมยังใช้งานได้ | ✅ | 18 + Regression 25/25 |
| Regression Tests ผ่านทั้งหมด | ✅ | ดูตาราง |

### บั๊กที่พบและแก้ระหว่างทดสอบ
1. ปุ่มเมนูในคอลัมน์เดียวกันทับกันที่ 1366/1600 (ระยะแถวเล็กกว่าความสูงปุ่ม) → คำนวณระยะจากความสูงปุ่มจริง วางชิดล่าง และซ่อนคำอธิบายย่อยบนจอเตี้ย
2. Compact Menu บนมือถือตัดปุ่มแรกทางซ้าย → จัดกลางแบบเลื่อนได้ครบ
3. โหมดนำเสนอบีบช่องพิมพ์คำถามจนแทบมองไม่เห็น → แถบล่างใช้ความกว้างเต็ม
4. ผู้เข้าชมที่กลับมาในช่วงคูลดาวน์ไม่เปิด Active แม้ตั้ง `wakeOnVisitor` → เพิ่มใน `VISITOR_RETURNED`
5. เมนูยังเห็นจาง ๆ ซ้อนบนตัวอวตารระหว่างเข้า Idle → จางหายเร็วโดยไม่วิ่งกลับเข้าตัว

## Known Issues
- ข้อ 5b ของ `idle-scenarios.js` ล้มได้เป็นครั้งคราวบนเครื่องทดสอบที่ไม่มี GPU (ดูหมายเหตุผลทดสอบ)
- ยังไม่ได้ทดสอบบนจอสัมผัสจริงและเครื่อง Windows ของทีม (ความลื่นของ Animation, ขนาดปุ่มกับนิ้วจริง)
- Compact Menu ทับขา/เท้าอวตารบนมือถือ (ไม่ทับใบหน้า) — ยอมรับได้ตามสเปก
- ในโหมดนำเสนอแผงสนทนาถูกซ่อน: คำตอบของ AI แสดงในกล่องคำพูดของอวตาร + เสียง (ประวัติแชตกลับมาเมื่อปิดการนำเสนอ)
- ตำแหน่งเมนูอิงกรอบ SVG ของอวตาร Placeholder (กว้าง 400×820) — เมื่อเปลี่ยนเป็นอวตารจริงที่สัดส่วนต่างกัน ระบบคำนวณใหม่เอง แต่ควรตรวจภาพอีกครั้ง

## Rollback
คัดลอกไฟล์จาก `_backups/before-changes/2026-10-31_2310_before-phase1-spatial/` กลับตำแหน่งเดิม แล้วลบ (หรือปล่อยไว้ได้) โฟลเดอร์ `frontend/kiosk/experience/` — ไฟล์ใหม่ไม่ถูกเรียกเมื่อ `app.js` เดิมกลับมา · หรือปิดเฉพาะเมนูรอบตัว: `kiosk-config.js` → `experience.orbitalMenu: false`
