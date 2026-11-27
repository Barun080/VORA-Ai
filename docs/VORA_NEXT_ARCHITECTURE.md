# VORA NEXT — Architecture (ระบบเดิม → สถาปัตยกรรมเป้าหมาย)

สถานะ: **Phase 4 เสร็จ** (P1: Orchestrator/SpatialMenu/PresentationView · P2: Avatar Adapter/Privacy Pause/Smart Greeting · P3: JourneyEngine/JourneyView · P4: Constellation) · ปรับปรุงทุก Phase · หลักการ: **ต่อยอดโมดูลเดิม ไม่สร้างซ้ำ**

## 1. สถาปัตยกรรมปัจจุบัน (ตรวจจากโค้ดจริง 31 ต.ค. 2569)

```
Browser (Kiosk /)
 ├── core/event-bus.js ─────────── Event กลาง (EV.*)
 ├── camera/CameraVisitorController ─ CameraManager (persistent) → shared/vision.js (MediaPipe)
 │                                   └ VisitorTracker (Presence Session, ไม่มี Face Recognition)
 ├── avatar/AvatarController ───── Renderer: PlaceholderRenderer (SVG) | LayeredImageRenderer (PSD→PNG)
 ├── idle-ui.js (UIController) ─── idle | active
 ├── interaction/InteractionManager ─ ลำดับเสียง: estop > greeting > conversation > announce > idle
 ├── voice.js ─────────────────── Web Speech API (STT/TTS)
 └── app.js ───────────────────── ตัวประสานงานบทสนทนา (chat, greet, คิวประกาศ, QR, ภาษา)
        │ REST /api/*  ·  WebSocket /ws?role=kiosk (1 connection)
FastAPI backend
 ├── ai/ (intent, retriever, engine, training) ── Approved Knowledge Base
 ├── robot/ (protocol v1, bridge + safety, drivers, simulator)
 ├── scheduler.py (ประกาศตามเวลา) · realtime.py (Hub)
 └── PostgreSQL 16 (หลัก) | SQLite (สำรอง)
```

## 2. สถาปัตยกรรมเป้าหมาย (ตามข้อเน้นย้ำข้อ 1)

```
Application (frontend/kiosk)
 ├── CameraManager            (Persistent — มีอยู่แล้ว)         ← ไม่ผูกกับ UI State · ✅ Phase 2: Privacy Pause (paused)
 ├── WebSocketManager         (Persistent — shared/api.js เดิม)  ← 1 connection
 ├── AvatarController         ✅ Phase 2: Avatar Adapter Interface 9 คำสั่ง (avatar/AvatarAdapter.js) · สถานะนำเสนอ (AVATAR_HINT)
 ├── InteractionManager       (มีอยู่แล้ว — ลำดับความสำคัญเสียง)
 ├── ExperienceOrchestrator   ✅ Phase 1 · experience/ExperienceOrchestrator.js
 │     ├── UI State: IDLE ⇄ ACTIVE ⇄ PRESENTATION  (#app[data-mode], .is-presenting)
 │     ├── SpatialMenu ✅ Phase 1      — experience/SpatialMenu.js (Orbital ↔ Compact) + <dialog id="textMenu">
 │     ├── PresentationView ✅ Phase 1 — experience/PresentationView.js (Floating Cards จาก API เดิม)
 │     ├── JourneyEngine + JourneyView ✅ Phase 3 (sessionStorage, TTL, QR /m/?program=)
 │     ├── ConstellationView ✅ Phase 4 (GET /api/constellation)
 │     ├── TimePortalView (Phase 5)
 │     ├── PresentationDirector (Phase 6) — Scene → Avatar state/gesture
 │     └── Pulse (Phase 7)                 — ปรับรูปแบบนำเสนอ (ไม่สั่งหุ่นเคลื่อนที่)
 └── app.js (ตัวประสานงานบทสนทนาเดิม — คงไว้)
```

### กฎการพึ่งพา
- Orchestrator **รู้จัก** Event Bus เท่านั้น — ไม่เรียก CameraManager โดยตรง ไม่ปิด/เปิดกล้อง
- การเปลี่ยน UI State = เปลี่ยน `data-mode` + CSS class เท่านั้น — ไม่ re-create DOM ของอวตาร/วิดีโอ, ไม่เปิด WebSocket ใหม่
- `UIController` เดิม (idle/active) ถูกครอบโดย Orchestrator: Orchestrator เพิ่ม PRESENTATION และเป็นผู้ตัดสินว่าเมื่อไหร่ "กลับ Idle ได้" (ไม่มีงานค้าง + ไม่มี Scene เปิด)
- Engine ใหม่ทุกตัว **อ่านข้อมูลผ่าน REST** จาก DB จริง — ไม่มีข้อมูล hard-code ในหน้า
- คำสั่งหุ่นยนต์จาก Engine ใหม่: gesture ที่ `moves_base=False` เท่านั้น ผ่าน bridge เดิม (Safety Layer) · ห้ามคำสั่งเดิน

### Event ใหม่ (เพิ่มใน `EV` โดยไม่เปลี่ยนชื่อเดิม)
| Event | ผู้ส่ง | ความหมาย |
|---|---|---|
| `experience:mode` `{ mode, prev, reason }` ✅ | Orchestrator | เปลี่ยนสถานะ IDLE/ACTIVE/PRESENTATION |
| `experience:open` `{ section, source }` ✅ | SpatialMenu / เมนูตัวอักษรใหญ่ | ผู้ใช้เลือกหมวด (college, departments, news, admission) |
| `experience:close` `{ reason }` ✅ | Orchestrator | ปิดการนำเสนอ (button, escape, menu, timeout) |

### กติกาการเปลี่ยนโหมด (Phase 1)
- IDLE → ACTIVE: UI_ACTIVITY (เมาส์ คลิก แตะ คีย์บอร์ด ท่ามือ ป้าย) หรือระบบสนทนาเริ่ม (ฟัง/คิด) · ผู้เข้าชม = ตามค่า `experience.wakeOnVisitor` (ค่าเริ่มต้น false)
- ACTIVE → IDLE: UIController เดิม (ว่าง 15 วิ และ busy() = false)
- ACTIVE → PRESENTATION: เลือกหมวด · ระหว่างนี้ UIController.busy() = true (extraBusy) จึงไม่ซ่อนเอง
- PRESENTATION → ACTIVE: ปุ่มปิด / Esc / เลือก ผู้ช่วย AI หรือ ความคิดเห็น
- PRESENTATION → IDLE: ไม่มีการใช้งาน `presentationIdleMs` (45 วิ) และ `busyIgnoringExtra()` = false
| `journey:*` (Phase 3) · `scene:*` (Phase 6) | | กำหนดในเฟสนั้น |

## 3. Backend ที่จะเพิ่ม (เฉพาะ endpoint ใหม่ — ไม่แก้ของเดิม)

| Phase | Endpoint | แหล่งข้อมูล | DB change |
|---|---|---|---|
| 3 ✅ | ไม่ต้องมี endpoint ใหม่: ใช้ `/api/programs`, `/api/programs/{id}`, `/api/news`, `/api/chat` เดิม · นิยาม Journey อยู่ใน `JourneyEngine.js` | programs, news, knowledge (approved ผ่าน AI) | ไม่มี (Session ใน sessionStorage) |
| 4 ✅ | `GET /api/constellation` (`backend/app/constellation.py`) | programs (level/department/careers), knowledge (approved) | ไม่มี (คำนวณทุกครั้ง อ่านอย่างเดียว) |
| 5 ✅ | `GET /api/timeline` (`backend/app/timeline.py`) · `/api/news*` เพิ่มฟิลด์สถานที่ (เพิ่มอย่างเดียว) · หลังบ้าน `NewsIn` รับฟิลด์สถานที่ (ไม่ส่ง = ไม่แก้) | news (published + ช่วงเผยแพร่, event_date) — UTC+7 คงที่ | **Migration 0001** (อนุมัติ D1): `news.location`, `location_type`, `location_map_url` NULL ได้ — `scripts/migrate_schema.py` + `migrate.bat` + ตัวกันตอนเริ่มระบบ `app/schema_guard.py` |
| 7 | `POST /api/handoff` → token, `GET /api/handoff/{token}` | ข้อมูลที่ผู้ใช้เลือก (id อ้างอิงเท่านั้น) | **อาจเพิ่มตารางใหม่ `handoff_tokens`** หรือเก็บในหน่วยความจำ (TTL) — เลือกแบบในหน่วยความจำก่อน เพื่อไม่ต้องเปลี่ยน DB; ถ้าต้องใช้ DB จะหยุดขออนุมัติ |

## 4. Avatar Adapter (Phase 2 — ข้อเน้นย้ำข้อ 5) ✅ ทำแล้ว — รายละเอียดฉบับเต็ม `docs/AVATAR_INTEGRATION.md`

```
Business logic (app.js, Orchestrator, Scenes)
        │  เรียกได้เฉพาะ AvatarAdapter interface
        ▼
AvatarController  ── implements: loadCharacter · setState · setExpression · playAnimation
        │                         setGaze · setSpeech · setVisibility · dispose
        ▼
Renderer (เปลี่ยนได้ด้วย config) : PlaceholderRenderer (SVG) | LayeredImageRenderer (PSD→PNG) | (อนาคต) Live2D/Spine
```
- States มาตรฐาน: `idle, greeting, listening, thinking, speaking, presenting, pointing, waving, thanking, happy` (+ `announcing, error` เดิม)
- ท่าที่ Renderer ไม่รองรับ → `playAnimation()` คืน **`supported:false`** และไม่เล่น (ห้ามแสดงว่าเล่นสำเร็จ — ตาม Phase 6) · ตัวละครระบุท่าที่ทำได้ใน `manifest.animations`
- สถานะนำเสนอผ่าน Event `AVATAR_HINT {state, ms?}`: ค้าง (scene) / ชั่วคราว — ไม่ทับ ฟัง/คิด/ทักทาย/ประกาศ/ขัดข้อง
- ไม่มีชื่อเลเยอร์/ไฟล์ PSD ใน business logic — อยู่ใน manifest ของ Renderer เท่านั้น

## 5. ความเป็นส่วนตัว / ความปลอดภัย
- ภาพกล้องประมวลผลในเบราว์เซอร์เท่านั้น ไม่ส่งออก ไม่บันทึก
- ไม่มี Face Recognition / Embedding ใบหน้า — Presence Session + Cooldown เท่านั้น
- Session ฝั่ง client หมดอายุเมื่อผู้เข้าชมออก/ไม่มีการใช้งาน · QR token อายุสั้น สุ่ม ไม่มีข้อมูลส่วนตัวใน URL

## 6. Time Portal (Phase 5) ✅

```
หลังบ้าน (ฟอร์มข่าว: ประเภทสถานที่/ชื่อ/ลิงก์แผนที่) ──PUT/POST /api/admin/news──► ตรวจกติกา (_location_values) ──► news
                                                                                              │
kiosk: หมวดข่าว ▸ "ดูปฏิทินกิจกรรม" ─► PresentationView(section "timeline") ─► TimePortalView ◄── GET /api/timeline (timeline.py)
        รายละเอียด: วันที่ · เวลา (00:00 = ไม่ระบุ) · สถานที่ (ไม่มี = ไม่ระบุสถานที่) · QR /m/?news=<id> · QR แผนที่ (ไม่ใช่ออนไลน์)
        เสียงบรรยาย: respond() เดิม (ลำดับความสำคัญเสียงเดิม · Esc หยุดได้) — พูดเวลา/สถานที่เฉพาะที่มีจริง
มือถือ /m/?news=<id> ─► GET /api/news/{id} ─► วันที่/เวลา/สถานที่/ลิงก์แผนที่
```
- กลุ่ม: วันสำคัญ (admission + ภายใน 60 วัน) · วันนี้ · ที่จะมาถึง · ที่ผ่านมา (≤ 30 วัน) · ไม่ระบุวันที่ — ตรวจสถานะ/ช่วงเผยแพร่ทุกคำขอ
- ไม่เพิ่ม Event ใหม่ใน `EV` · ไม่แก้ SpatialMenu (เข้าทางหมวดข่าว) · ไม่แก้ AI/ฐานความรู้
