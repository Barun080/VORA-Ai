# VORA NEXT — Phase 0 Audit (ตรวจสอบระบบเดิมก่อนพัฒนา)

วันที่ตรวจ: 31 ต.ค. 2569 22:00–22:30 (Asia/Bangkok) · ผู้ตรวจ: Claude (ตาม MASTER DEVELOPMENT PROMPT)
ขอบเขต: `C:\VORA_Robot` ทั้งโฟลเดอร์ · **Phase 0 ไม่ได้แก้ Source Code ใด ๆ**

## 1. สรุปสั้น

- ระบบเดิม **ใหญ่และสมบูรณ์กว่าที่ Prompt บรรยาย** — รอบก่อนหน้า (31 ต.ค. รอบ 1–2) ได้ทำโครงสร้างที่ Phase 1–2 ต้องการไว้แล้วบางส่วน: `CameraManager` (persistent), `VisitorTracker` (Presence Session + Cooldown, ไม่มี Face Recognition), `AvatarController` + Renderer แยก (Placeholder SVG / Layered PNG จาก PSD), `InteractionManager` (ลำดับความสำคัญเสียง), `core/event-bus.js`, `UIController` โหมด Idle/Active
- สิ่งที่ **ยังไม่มี**: Presentation Mode, Orbital/Spatial Menu, Journey Engine, Knowledge Constellation, Time Portal, Dynamic Presentation Scenes, QR Session Token, VORA Pulse, Experience Orchestrator
- ดังนั้นแผนคือ **ต่อยอดโมดูลเดิม** ไม่สร้างซ้ำ (เช่น ไม่เขียน CameraManager ใหม่ แต่เติมความสามารถที่ขาด)

## 2. โครงสร้างโปรเจกต์ (ไม่นับ `.venv`, `_backups`)

225 ไฟล์ · ~38 MB (ส่วนใหญ่คือโมเดล MediaPipe 13 MB, vendor 11 MB, ภาพหน้าจอใน docs 13 MB)

| ส่วน | ไฟล์หลัก | หมายเหตุ |
|---|---|---|
| Backend | `backend/app/main.py`, `routers/{public,admin,auth,robot,reports}.py`, `ai/*`, `robot/*`, `scheduler.py`, `realtime.py`, `models.py`, `db.py` | FastAPI · ~4,100 บรรทัด |
| Kiosk (หน้าหลัก) | `frontend/kiosk/index.html`, `app.js` (910 บรรทัด), `kiosk.css`, `idle-ui.js`, `kiosk-config.js`, `voice.js` | ธีมดำ-เหลืองแล้ว |
| Kiosk modules | `core/event-bus.js`, `camera/{CameraManager,CameraVisitorController,VisitorTracker}.js`, `avatar/{AvatarController,AvatarRenderer,LayeredImageRenderer,avatar-states,index}.js`, `interaction/InteractionManager.js` | ES Modules |
| ดีไซน์เดิม | `frontend/kiosk/pastel/`, `frontend/kiosk/classic/` | สำเนาแยก ใช้ได้อิสระ — **ห้ามแตะ** |
| Shared | `frontend/shared/{api.js,vision.js,base.css}` | `vision.js` ใช้ร่วมกับหน้าหลังบ้าน (สอนกล้อง) |
| Admin | `frontend/admin/*` | หลังบ้าน |
| Mobile | `frontend/mobile/index.html` | เปิดผ่าน QR (`/m/`) |
| Firmware | `firmware/vora_esp32/vora_esp32.ino` | ทีมฮาร์ดแวร์ — **ห้ามแตะ** |
| Tests | `backend/tests/test_{ai,robot,system}.py` (46 กรณี), `docs/kiosk-redesign/{browser,idle}-scenarios.js` (25 + 26 กรณี, Playwright) | |
| Scripts | `setup.bat`, `start.bat`, `test.bat`, `backup_db.bat`, `scripts/{backup_db,migrate_db,setup_postgres,download_models}.py` | |
| Git | **ไม่มี Git** | ใช้ระบบ `_backups/` แทน (ดูข้อ 11) |

## 3. Frontend (Kiosk)

- `app.js` เป็นตัวประสานงานบทสนทนา (chat, greet, คิวประกาศ, ภาษา, QR, ประเมิน) สื่อสารกับ Controller อื่นผ่าน Event Bus
- `idle-ui.js` → `UIController` มี 2 โหมด `idle` / `active` (เข้า Idle เมื่อว่าง 15 วิ, ไม่เข้า Idle ระหว่างตอบ/มีหน้าต่างเปิด)
- เมนูซ้ายปัจจุบัน: สาขา / ข่าว / ข้อมูลวิทยาลัย / ประเมิน (เปิด "ลิ้นชักข้อมูล" จาก API จริง)
- Responsive ออกแบบสำหรับจอนอน ≥1366 px; จอ <1100 px เรียงเป็นคอลัมน์เดียว (ยังไม่มี Compact Menu สำหรับมือถือ/แท็บเล็ตตั้ง)
- มี `prefers-reduced-motion` แล้ว
- โหมดทดสอบ `?debug=1` เปิด `window.VORA` (simulateVisitor/simulateEmpty) — ใช้กับชุดทดสอบเบราว์เซอร์

**ช่องว่างเทียบ Phase 1:** ไม่มี Presentation Mode, ไม่มี Orbital Menu, ไม่มีเมนูข้อความสำหรับผู้สูงอายุแยก, Idle ยังไม่ "ซ่อนเหลือข้อความแนะนำเดียว" ครบตามสเปก (ปัจจุบันมี idleHint มุมขวาล่างแล้ว — ใกล้เคียง)

## 4. Backend / API

- REST: public 17 เส้นทาง (`/api/chat`, `/api/greet`, `/api/news`, `/api/programs`, `/api/health`, `/api/kiosk/config`, `/api/interaction`, `/api/robot/stop` …), admin ~55, robot 15, auth 3, reports 3
- Static: `/` kiosk, `/admin`, `/m` (mobile), `/assets`, `/shared`, `/uploads`
- ไม่มี API สำหรับ: Journey, Knowledge Graph, Timeline, QR Token — ต้องเพิ่มแบบ **endpoint ใหม่** ไม่แก้ของเดิม

## 5. Database

- ตาราง: `users, news, programs, knowledge, intent_examples, vision_classes, vision_samples, model_versions, chat_sessions, messages, feedback, unanswered, schedules, settings, audit_log, eval_*, robot_routes` (ดู `docs/database.md`)
- `.env` ชี้ไป **PostgreSQL** `localhost:5432/vora` (ระบบจริง) และ `vora_test` (ชุดทดสอบ) · SQLite `data/vora.db` เป็นระบบสำรอง
- ข้อมูลใน SQLite (สำเนาที่ตรวจ): ข่าว 4 (ทุกข่าวมี `event_date`), สาขา 7 (ปวช. 5 / ปวส. 2, มี `department`, `careers_th`), ความรู้ที่อนุมัติ 14 รายการ ใน 9 หมวด
- **ข้อสังเกตสำคัญ:**
  1. ข้อมูลเป็น **ข้อมูลตัวอย่าง (seed)** เช่น เบอร์ติดต่อ `0-0000-0000` — ทุกฟีเจอร์ใหม่ต้องแสดงสิ่งที่อยู่ในฐานข้อมูลเท่านั้น และทีมต้องใส่ข้อมูลจริงก่อนประกวด
  2. วันที่เก็บเป็น `DateTime` แบบไม่มี timezone (naive) — ระบบถือเป็นเวลาท้องถิ่น Asia/Bangkok; Time Portal ต้องตีความแบบเดียวกันและห้ามเดาวันที่ให้ข่าวที่ไม่มี `event_date`
  3. ไม่มีตารางความสัมพันธ์ความรู้ (knowledge graph) — ความสัมพันธ์ที่ **มีหลักฐานในข้อมูลจริง** คือ ระดับ → แผนก → สาขา → อาชีพ (`careers_th`) และ หมวดความรู้ (`knowledge.category`) — Constellation ต้องสร้างจากความสัมพันธ์เหล่านี้เท่านั้น
- Migration: มี `scripts/migrate_db.py` (SQLite → PostgreSQL) แต่ **ไม่มีระบบ Schema Migration (Alembic)** — ถ้าต้องเพิ่มตาราง ใช้ `create_all` สำหรับตาราง *ใหม่* เท่านั้น (ไม่แก้ตารางเดิม) และต้องขออนุมัติก่อนตาม §10

## 6. WebSocket

- `/ws?role=kiosk|mobile|admin` เส้นเดียว (`realtime.Hub`) — topics: `robot.status`, `announce`, `say`, `kiosk.state`, `kiosk.event`
- Kiosk ต่อ 1 connection และเชื่อมต่อใหม่อัตโนมัติ (`shared/api.js`) · ทดสอบแล้วไม่หลุดระหว่าง Idle/Active
- Phase ใหม่ต้อง **ใช้ connection เดิม** (ส่ง `type:"event"` เดิม) ไม่เปิดเพิ่ม

## 7. Camera / Vision

- `CameraManager.js`: เปิดเองตาม Permission, กันเปิดซ้อน (`getUserMedia` 1 ครั้ง), แยกสถานะ `on / denied / not-found / lost / staff-off`, ลองใหม่แบบ backoff 3→30 วิ, เจ้าหน้าที่ปิดได้และจำค่าหลังรีโหลด
- `vision.js` (MediaPipe): **Face Detection (BlazeFace)** + Gesture Recognizer + ตัวจำป้าย (MobileNet embedding + โมเดลของทีม)
- `VisitorTracker.js`: Presence Session (V1, V2…), Tracking ID ชั่วคราว, `arriveMs 800`, `leaveMs 6000`, ล้าง ID เมื่อจบ Session · `CameraVisitorController`: ถ้า Session ใหม่เริ่มภายในช่วงคูลดาวน์ → `VISITOR_RETURNED` (ไม่ทักซ้ำ) — ใช้ **เวลาเท่านั้น** ไม่ใช่การจำใบหน้า ✔ ตรงกับข้อเน้นย้ำข้อ 2
- กล้องไม่ผูกกับ UI State แล้ว ✔ ตรงกับข้อเน้นย้ำข้อ 1 (ยืนยันด้วยทดสอบ Idle 6–8b)
- ข้อจำกัด: ตรวจ "ใบหน้า" ไม่ใช่ "ร่างกาย" → คนหันหลัง/ใส่หน้ากากอาจไม่ถูกนับ (Prompt อนุญาต "วิธีที่เหมาะสมกับระบบเดิม") · ปุ่ม Privacy Pause มีในรูปแบบ "เจ้าหน้าที่ปิดกล้อง" ในแผงเครื่องมือ แต่ **ยังไม่มีปุ่มที่ผู้เข้าชมเห็นเอง**

## 8. Avatar

- `AvatarController` + Renderer แยกกันแล้ว ✔ (ข้อเน้นย้ำข้อ 5) — สลับ `placeholder` ↔ `layered` ด้วย `kiosk-config.js` เท่านั้น, ถ้า manifest เสียกลับไปใช้ Placeholder เอง
- States ปัจจุบัน 8: `idle, listening, thinking, speaking, greeting, announcing, happy, error`
- **ขาด** ตามสเปก Phase 2/§7: `presenting, pointing, waving, thanking` (ท่าทาง `wave, present, point_screen, bow` มีเป็น *gesture* แล้ว — ต่อยอดเป็น state ได้)
- **ขาด** method ตามสเปก: `loadCharacter, setExpression, playAnimation, setGaze, setSpeech, setVisibility, dispose` (มีของใกล้เคียง: `setRenderer, setEmotion, gesture, setBubble, disconnect` + gaze ผ่าน `FACE_POSITION`) → Phase 2 เพิ่มเป็น **Adapter interface** ครอบของเดิม
- Lip sync: มี Event `AVATAR_MOUTH` (ระดับเสียง 0..1) แล้ว แต่ Web Speech API ไม่ให้ระดับเสียงจริง → ปัจจุบันจำลองการขยับปาก
- `frontend/kiosk/avatar.js` (ไฟล์เดิมรุ่นแรก) ไม่มีหน้าไหนใช้ใน kiosk หลักแล้ว — **ไม่ลบ** (pastel/classic มีสำเนาของตัวเอง)

## 9. AI

- Pipeline ของทีม: Intent Classifier (TF-IDF char n-gram + Logistic Regression, โมเดล v2 active) → Hybrid Retrieval + เกณฑ์ปฏิเสธ (`VORA_RETRIEVAL_THRESHOLD`) → คำตอบจากฐานความรู้ที่ **approved** เท่านั้น; LLM = `none` (ปิด)
- ตรวจจริง: คำถามนอกขอบเขต → ปฏิเสธสุภาพ; คำถามที่ไม่มีข้อมูล ("มีสาขาการบินไหม") → `answered:false` + บันทึกให้เจ้าหน้าที่ + บอกช่องทางติดต่อ ✔
- Journey/Constellation ต้องเรียก pipeline นี้ ไม่สร้างคำตอบเอง

## 10. Robot Protocol / Safety

- Protocol v1 (`robot/protocol.py`): JSON-lines, `MAX_SPEED 0.6`, `MAX_DISTANCE_CM 300`, `WATCHDOG_MS 1000`, ตรวจคำสั่งก่อนส่ง, E-Stop บล็อกทุกคำสั่งจนกว่ารีเซ็ต, timeout ต่อคำสั่ง, OBSTACLE error
- Driver ปัจจุบัน: `simulator` · `VORA_ROBOT_ENABLE_MOTION=true`
- UI ส่งได้แค่ `/api/robot/stop` และ gesture ผ่าน AI → bridge — **ไม่มีเส้นทางที่ UI สั่งเดินตรง** ✔
- **ห้ามแตะ:** `robot/protocol.py`, `robot/bridge.py` (safety), `firmware/`, `routers/robot.py` — ฟีเจอร์ใหม่ (Presentation gesture, Pulse) ส่งได้แค่ gesture ที่ `moves_base=False` ผ่าน bridge เดิม

## 11. Dependencies

- Python: fastapi, uvicorn, sqlalchemy 2, psycopg 3, scikit-learn, numpy, PyJWT, pyserial, edge-tts (ไม่บังคับ), pytest — ทดสอบแล้วกับ Python 3.10 และ 3.13
- Frontend: ไม่มี build step / npm — vendor ในเครื่อง: MediaPipe tasks-vision, Chart.js, qrcode.js, ฟอนต์ Mitr/Anuphan/Kanit/Inter (OFL) → **ทำงานออฟไลน์ได้** ต้องรักษาไว้ (ไม่เพิ่ม CDN)
- Phase ใหม่ตั้งใจ **ไม่เพิ่ม dependency** (CSS Transform + SVG + JS ตามสเปก)

## 12. Performance (เครื่องทดสอบ Linux ไม่มี GPU)

- `/api/chat` 80 คำถามติดกัน: median 11 ms, p95 13 ms, max 15 ms (SQLite, LLM ปิด)
- MediaPipe ใช้ CPU ~2 รอบ/วิ บนเครื่องทดสอบ — บนเครื่อง Windows ที่มี GPU จะเร็วกว่า
- Listener/heap ไม่โตหลังสลับโหมด 300 ครั้ง (ชุดทดสอบ Idle ข้อ 10)

## 13. Backup

| รายการ | ไฟล์ | ตรวจสอบ |
|---|---|---|
| Source snapshot (ก่อน VORA NEXT) | `_backups/snapshots/VORA_Robot-backup-20261031-2202-before-vora-next.zip` (225 ไฟล์, 27.5 MB, ไม่รวม `.venv` และ `.env`) | `unzip -t` ผ่าน · SHA-256 `2b1b9e99…af19b` ตรงกับต้นฉบับ |
| SQLite | `_backups/database/vora-sqlite-20261031-2202-before-vora-next.db` | SHA-256 ตรงกับ `data/vora.db` |
| `.env` | `_backups/env/.env.bak-20261031-2202-before-vora-next` | |
| PostgreSQL | `_backups/database/vora-20261031-225927.dump` (ทีมรัน `backup_db.bat` บน Windows 31 ต.ค. 22:59) | ✅ หัวไฟล์ `PGDMP` ถูกต้อง · (เครื่องทดสอบเข้าถึง PostgreSQL บน Windows ไม่ได้ จึงให้ทีมสำรองเอง) |

ไม่มีการเขียนทับ Backup เดิม · ไฟล์ชั่วคราวจากการสำรอง (zip temp, probe, ไฟล์ส่งต่อชุดทดสอบ) ย้ายไว้ที่ `_backups/_to_delete/` ลบทิ้งได้

## 14. ส่วนที่แก้ไขได้ / ห้ามแตะ

**แก้/ต่อยอดได้ (พร้อม Backup ก่อนทุกครั้ง):** `frontend/kiosk/{index.html, kiosk.css, app.js, idle-ui.js, kiosk-config.js}`, `frontend/kiosk/avatar/*` (เพิ่ม state/adapter), `frontend/kiosk/camera/*` (เพิ่ม privacy pause/สถานะ), `frontend/mobile/index.html` (รับ QR token), `backend/app/routers/public.py` (เพิ่ม endpoint ใหม่เท่านั้น), ไฟล์ใหม่ใต้ `frontend/kiosk/experience/`, `backend/app/experience/`, ชุดทดสอบใหม่

**ห้ามแตะโดยไม่ขออนุมัติ:** `robot/*`, `firmware/*`, `security.py`, `routers/auth.py`, Schema ตารางเดิมใน `models.py`, `db.py`, `ai/engine.py` (ตรรกะคำตอบ), `frontend/admin/*` (ยกเว้นเพิ่มเมนูภายหลังเมื่ออนุมัติ), `kiosk/pastel/`, `kiosk/classic/`, ข้อมูลในฐานข้อมูล

## 15. ความเสี่ยงที่พบ

1. **ชุดทดสอบเบราว์เซอร์ล้ม 2 กรณีใน Baseline** (เอกสารรอบก่อนรายงาน 25/25) — วิเคราะห์ใน `VORA_NEXT_TEST_BASELINE.md` §3: เป็นปัญหาการตั้งเวลาในสคริปต์ทดสอบ ไม่ใช่บั๊กของระบบ
2. ไม่มี Git → ใช้ Backup ราย Phase + CHANGELOG แทน (แนะนำให้ทีม `git init` ภายหลัง)
3. PostgreSQL ทดสอบได้เฉพาะบนเครื่อง Windows ของทีม (`test.bat`) — ทีมรันแล้ว 46/46 ผ่าน (31 ต.ค. 23:02)
4. Seed data ไม่ใช่ข้อมูลจริงของวิทยาลัย
