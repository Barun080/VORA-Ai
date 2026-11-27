# VORA NEXT — CHANGELOG

รูปแบบแต่ละรายการ: วันที่เวลา (Asia/Bangkok) · Phase · ไฟล์ · DB · Backup · วิธีย้อนกลับ

## 2026-10-31 22:45 · Phase 0 — Audit & Baseline

**Source Code:** ไม่มีการแก้ไข
**Database:** ไม่มีการเปลี่ยนแปลง

**เพิ่ม**
- `docs/VORA_NEXT_AUDIT.md`, `docs/VORA_NEXT_ARCHITECTURE.md`, `docs/VORA_NEXT_TEST_BASELINE.md`, `docs/VORA_NEXT_CHANGELOG.md`, `docs/VORA_NEXT_PROGRESS.md`
- `docs/vora-next/phase0/` — ผลทดสอบดิบ (pytest, เบราว์เซอร์ก่อน/หลังแก้สคริปต์, idle) และ `browser-scenarios.diff`

**แก้ไข (สคริปต์ทดสอบเท่านั้น)**
- `docs/kiosk-redesign/browser-scenarios.js` — แก้การตั้งเวลา/ตัวแปรที่ตรวจในกรณี 7, 8, 9 (เหตุผลใน `VORA_NEXT_TEST_BASELINE.md` §3) ไม่ได้ลดเงื่อนไขผ่าน

**Backup**
- `_backups/snapshots/VORA_Robot-backup-20261031-2202-before-vora-next.zip` (ตรวจ `unzip -t` + SHA-256 แล้ว)
- `_backups/database/vora-sqlite-20261031-2202-before-vora-next.db`
- `_backups/env/.env.bak-20261031-2202-before-vora-next`
- `_backups/before-changes/2026-10-31_2245_phase0-test-harness/docs/kiosk-redesign/browser-scenarios.js`

**ย้อนกลับ:** คัดลอก `browser-scenarios.js` จากโฟลเดอร์ before-changes ข้างต้นกลับไปที่ `docs/kiosk-redesign/` · เอกสาร VORA_NEXT_* ลบได้โดยไม่กระทบระบบ

## 2026-10-31 23:10 · Phase 0 — อัปเดตผลจากเครื่อง Windows ของทีม

- `test.bat` บน Windows 11 / Python 3.12.0 / PostgreSQL (`vora_test`): **46/46 ผ่าน** 37.42 วิ, Warning 1 (Starlette/httpx), ไม่มี Failure
- `backup_db.bat`: `_backups/database/vora-20261031-225927.dump` — ตรวจหัวไฟล์ `PGDMP` แล้ว
- อัปเดต `VORA_NEXT_TEST_BASELINE.md`, `VORA_NEXT_AUDIT.md`, `VORA_NEXT_PROGRESS.md` · Gate 0 เปลี่ยนจาก "มีเงื่อนไข" เป็น **PASS**

## 2026-11-01 00:15 · Phase 1 — Spatial Experience Foundation

**Database:** ไม่มีการเปลี่ยนแปลง · **Backend/Robot/Firmware/Auth:** ไม่มีการเปลี่ยนแปลง

**เพิ่ม:** `frontend/kiosk/experience/{ExperienceOrchestrator,SpatialMenu,PresentationView}.js`, `docs/VORA_NEXT_PHASE1_REPORT.md`, `docs/vora-next/phase1/` (ชุดทดสอบ + ผล + ภาพ)

**แก้ไข:** `frontend/kiosk/{app.js,index.html,kiosk.css,idle-ui.js,kiosk-config.js}`, `frontend/kiosk/core/event-bus.js`, `frontend/kiosk/avatar/AvatarController.js` (1 บรรทัด) — รายละเอียดใน Phase 1 Report

**Backup ก่อนแก้:** ตรวจ snapshot zip (SHA-256 + `unzip -t`) และยืนยันว่าไฟล์ที่จะแก้ตรงกับ snapshot · สำรองรายไฟล์ที่ `_backups/before-changes/2026-10-31_2310_before-phase1-spatial/` (ตรวจ `cmp` ทุกไฟล์)

**ทดสอบ:** Gate 1 38/38 · pytest 46/46 · Kiosk เดิม 25/25 · Idle เดิม (ดู Phase 1 Report)

**ย้อนกลับ:** คัดลอกไฟล์จากโฟลเดอร์ before-changes ข้างต้นกลับ (ไฟล์ใน `experience/` จะไม่ถูกเรียก) หรือปิดเฉพาะเมนูรอบตัวด้วย `experience.orbitalMenu: false`

## 2026-11-01 01:40 · Phase 2 — Living Character & Vision Awareness

**Database:** ไม่มีการเปลี่ยนแปลง · **Backend/Robot/Firmware/Auth:** ไม่มีการเปลี่ยนแปลง

**เพิ่ม:** `frontend/kiosk/avatar/AvatarAdapter.js`, `docs/AVATAR_INTEGRATION.md`, `docs/VORA_NEXT_PHASE2_REPORT.md`, `docs/vora-next/phase2/`

**แก้ไข:** `frontend/kiosk/avatar/{AvatarController,avatar-states,AvatarRenderer,LayeredImageRenderer,index}.js`, `avatar/README.md`, `frontend/kiosk/camera/{CameraManager,CameraVisitorController}.js`, `frontend/kiosk/{app.js,index.html,kiosk.css,kiosk-config.js}`, `core/event-bus.js`, `experience/SpatialMenu.js` — รายละเอียดใน Phase 2 Report

**ชุดทดสอบ Phase 1:** `docs/vora-next/phase1/phase1-scenarios.js` ข้อ 18 เพิ่มการรอข้อมูลลิ้นชักโหลดจาก API (เดิมนับทันทีหลังคลิก — race ในชุดทดสอบ)

**Backup ก่อนแก้:** ยืนยัน checksum ไฟล์บนเครื่องตรงกับสำเนาที่ทดสอบ · สำรองรายไฟล์ 17 ไฟล์ที่ `_backups/before-changes/2026-11-01_0005_before-phase2-character/` (ตรวจ `cmp` ทุกไฟล์)

**ย้อนกลับ:** คัดลอกไฟล์จากโฟลเดอร์ before-changes ข้างต้นกลับ

## 2026-11-01 01:45 · Phase 3 — Conversation Journey

**Database/Backend/Robot/Firmware/Auth:** ไม่มีการเปลี่ยนแปลง

**เพิ่ม:** `frontend/kiosk/experience/{JourneyEngine,JourneyView}.js`, `docs/VORA_NEXT_PHASE3_REPORT.md`, `docs/vora-next/phase3/`
**แก้ไข:** `frontend/kiosk/{app.js,index.html,kiosk.css}`, `experience/PresentationView.js`, `frontend/mobile/index.html` (อ่าน `?program=<id>`)
**แก้บั๊กที่พบใน Regression:** ย้ายโฟกัสเข้าพื้นที่นำเสนอทันที (เดิมรอ requestAnimationFrame) · ส่งสถานะอวตารซ้ำหลัง `GREETING_FINISHED` ให้ลำดับ Event แน่นอน (สาเหตุจริงของ Idle 5b ที่เคยสรุปว่าไม่เสถียร)

## 2026-11-01 02:40 · Phase 4 — Knowledge Constellation

**Database:** ไม่มีการเปลี่ยนแปลง (อ่านอย่างเดียว) · **Robot/Firmware/Auth/AI Engine:** ไม่มีการเปลี่ยนแปลง

**เพิ่ม:** `backend/app/constellation.py`, `backend/tests/test_constellation.py`, `frontend/kiosk/experience/ConstellationView.js`, `docs/VORA_NEXT_PHASE4_REPORT.md`, `docs/vora-next/phase4/`
**แก้ไข:** `backend/app/routers/public.py` (+ `GET /api/constellation` ต่อท้าย), `frontend/kiosk/{app.js,kiosk.css}`, `experience/PresentationView.js`
**แก้ที่พบใน Regression:** `AVATAR_HINT` เฉพาะเข้า/ออกโหมดนำเสนอ · ช่วงเงียบ 5 วิหลังกดหยุดก่อนพูดประกาศในคิว

**Backup ก่อน Phase 3–4:** ยืนยัน checksum ไฟล์บนเครื่องตรงกับสำเนาที่ทดสอบ · สำรอง 13 ไฟล์ที่ `_backups/before-changes/2026-11-01_0115_before-phase3-4/`
**ย้อนกลับ:** คัดลอกไฟล์จากโฟลเดอร์ข้างต้นกลับ (รายละเอียดใน Phase 3/4 Report)

## 2026-11-01 14:40 · แก้ไข Phase 3 — คำถาม "สาขานี้…" ตอบไม่ตรงกับสาขาบนจอ

**Database / AI Engine / Robot / Firmware / Auth:** ไม่มีการเปลี่ยนแปลง
**แก้ไข:** `backend/app/routers/public.py` (`ChatIn.context_program_id` ไม่บังคับ), `frontend/kiosk/app.js` (ส่งบริบท), `frontend/kiosk/experience/PresentationView.js` (`currentProgramId()`), `docs/vora-next/phase3/phase3-scenarios.js` (+ ข้อ 14)
**เพิ่ม:** `backend/tests/test_chat_context.py` (5 กรณี) → pytest 56 กรณี
**Backup:** `_backups/before-changes/2026-11-01_1440_before-fix-journey-context/` (9 ไฟล์ ตรวจ `cmp` แล้ว)
**ย้อนกลับ:** คัดลอกไฟล์จากโฟลเดอร์ข้างต้นกลับ และลบ `backend/tests/test_chat_context.py`

## 2026-11-01 15:10 · ยืนยันผลบน PostgreSQL

- ทีมรัน `test.bat` บน Windows 11 / Python 3.12.0 / PostgreSQL `vora_test`: **56 passed, 1 warning** (Starlette/httpx เดิม) ใน 37.00 วิ
- ตรวจรายชื่อ: 46 กรณีของ Baseline (Phase 0) ครบทุกกรณี + `test_constellation.py` 5 + `test_chat_context.py` 5 · ไม่มีกรณีใดหายหรือถูกข้าม
- เก็บผลไว้ที่ `docs/vora-next/phase4/pytest-postgresql-windows-20261101.txt`

## 2026-11-01 16:40 · Phase 5 — Time Portal + สถานที่จัดกิจกรรม

**Database:** Migration 0001 (อนุมัติ D1) — `news.location` VARCHAR(255), `news.location_type` VARCHAR(16), `news.location_map_url` VARCHAR(500) NULL ได้ทั้งหมด · **ยังไม่ได้รันกับฐานข้อมูลหลัก** (D4: ทีมรัน `migrate.bat upgrade` เอง)

**เพิ่ม**
- `migrate.bat`, `scripts/verify_backup.py`, `scripts/migrate_schema.py`
- `backend/app/schema_guard.py` (หยุดเริ่มระบบถ้าโครงสร้างฐานข้อมูลเก่ากว่าโค้ด), `backend/app/timeline.py`, `GET /api/timeline`
- `frontend/kiosk/experience/TimePortalView.js` · หน้ามือถือ `/m/?news=<id>`
- `backend/tests/test_migration_0001.py` (9), `test_news_location.py` (18), `test_timeline.py` (7)
- `docs/VORA_NEXT_PHASE5_MIGRATION_PLAN.md`, `docs/VORA_NEXT_PHASE5_REPORT.md`, `docs/vora-next/phase5/`

**แก้ไข**
- `backend/app/models.py` (3 คอลัมน์) · `main.py` (`check_schema`) · `routers/admin.py` (ฟิลด์สถานที่ + ตรวจกติกา · ไม่ส่งฟิลด์ = ไม่แก้ค่าเดิม) · `routers/public.py` (`/api/news*` เพิ่มฟิลด์สถานที่ · ฟิลด์เดิมครบ)
- `frontend/admin/admin.js` (ฟอร์ม/ตารางสถานที่ · `modalForm` รับ `setup` เพิ่มได้โดยไม่กระทบฟอร์มอื่น)
- `frontend/kiosk/app.js`, `experience/PresentationView.js` (หมวด "timeline" + ปุ่มในหมวดข่าว + เวลา/สถานที่ในรายละเอียดข่าว), `kiosk.css`
- `frontend/mobile/index.html` (วันที่/เวลา/สถานที่ในรายละเอียดข่าว + `?news=`)
- `docs/database.md` (ตรวจไฟล์สำรอง + Schema Migration)

**ผลทดสอบ:** pytest 90/90 (PostgreSQL 16 + SQLite) · เบราว์เซอร์ 150/150 · Migration บนสำเนาข้อมูลจริง ผ่านทั้ง upgrade/downgrade

**Backup:** `_backups/before-changes/2026-11-01_1550_before-phase5-location/` (14 ไฟล์ + MANIFEST.md5)

**ย้อนกลับ:** `migrate.bat downgrade 0001` (ถ้า upgrade แล้ว) → คัดลอกไฟล์จากโฟลเดอร์ Backup กลับ → ลบไฟล์ในหัวข้อ "เพิ่ม"

## 2026-11-01 17:47 · Phase 5 — ทีมรัน Migration 0001 บนฐานข้อมูลจริง

- `migrate.bat upgrade` บน `postgresql://…/vora`: Backup `vora-before-migrate-0001-20261101-174756.dump` ตรวจผ่าน (19 ตาราง 710 แถว · SHA-256 99bd7f2fe14a…) → เพิ่ม 3 คอลัมน์ → md5 ข้อมูลเดิมตรงทุกตาราง (`_backups/database/migrations/migration-log.jsonl`)

## 2026-11-01 18:05 · Phase 5 — แก้ WinError 32 ใน `test.bat` (86/90 → รอยืนยัน)

**อาการ:** Windows `test.bat` 86 passed 4 failed — ทั้ง 4 อยู่ใน `test_migration_0001.py` (`upgrade_adds…`, `upgrade_is_idempotent`, `downgrade_exports…`, `downgrade_requires_yes`) · `PermissionError: [WinError 32]` ที่ `shutil.move(raw, dest)` ใน `migrate_schema.safe_backup()`

**ต้นเหตุ (ยืนยันด้วยการทดลอง):** `scripts/backup_db.py` (โค้ดเดิมก่อน VORA NEXT) สำรอง SQLite ด้วย `with sqlite3.connect(src) as s, sqlite3.connect(out) as d` — context manager ของ sqlite3 **ไม่ปิด** การเชื่อมต่อ (แค่ commit) และ `Connection` มีวงอ้างอิงภายใน (statement cache) จึงค้างจนกว่า garbage collector ทำงาน → หลัง `backup()` คืนค่า ไฟล์ต้นทาง (+ -wal/-shm) และไฟล์สำรองยังเปิดอยู่ (`/proc/self/fd` แสดงครบ 4 ไฟล์ หายหลัง `gc.collect()`) · Linux ย้ายไฟล์ที่เปิดอยู่ได้ จึงไม่พบบนเครื่องทดสอบ · Windows ไม่ได้ · PostgreSQL ไม่เป็น (pg_dump เป็น process แยก) จึง `migrate.bat upgrade` บน `vora` สำเร็จ

**แก้ไข**
- `scripts/backup_db.py` — ปิดการเชื่อมต่อทั้งสองด้วย `contextlib.closing` ก่อนคืนค่า · เพิ่มพารามิเตอร์ `out_dir` (ค่าเริ่มต้น `BACKUP_DIR` → `backup_db.bat` ทำงานเหมือนเดิม รวมการเก็บ 30 ไฟล์ล่าสุด; โฟลเดอร์อื่นไม่ลบไฟล์เก่า)
- `scripts/migrate_schema.py` — `safe_backup()` เขียนไฟล์สำรองลง `migrations/` โดยตรง **ไม่ย้าย/คัดลอก/ลบไฟล์ใด ๆ** แล้วตรวจไฟล์นั้น (ไฟล์ที่ตรวจ = ไฟล์ที่เก็บ) · ตรวจว่าปลายทางอยู่ใน `migrations/` ไม่เช่นนั้นหยุด · ไม่มีการแก้ขั้นตอนตรวจ Backup / row count / fingerprint / guard / การยืนยัน downgrade
- `backend/tests/test_migration_0001.py` — ฟังก์ชันจำลองไฟล์สำรองเสียรับ `out_dir` (assertion เดิมครบ) · เพิ่ม 3 กรณี: `backup()` ไม่ทิ้ง handle (Linux ตรวจ /proc/self/fd · Windows ลองเปลี่ยนชื่อไฟล์) และย้ายไฟล์ได้ทันที · ไฟล์สำรองของ migration อยู่ใน `migrations/` โดยตรง ไม่มีไฟล์ค้างในโฟลเดอร์หลัก SHA-256 ใน .verify.json ตรงกับไฟล์ ไม่มี handle ค้าง · ตำแหน่ง/พฤติกรรมเดิมของ `backup_db.bat`
- ไม่มีการ skip / ลบ / ลดเงื่อนไขของกรณีทดสอบเดิม

**ผลทดสอบ (Linux):** pytest 93/93 (PostgreSQL 16 + SQLite) · กรณีใหม่ **ล้ม** เมื่อใช้ `backup_db.py` ตัวเก่า · Migration upgrade/downgrade บนสำเนาข้อมูลจริงผ่าน ข้อมูลเหมือนต้นฉบับ · **รอผล `test.bat` บน Windows**

**ฐานข้อมูล:** ไม่มีการเปลี่ยนแปลง · ไม่ได้รัน upgrade/downgrade กับ `vora`

**Backup:** `_backups/before-changes/2026-11-01_1800_before-fix-sqlite-backup-lock/`

**ย้อนกลับ:** คัดลอก 3 ไฟล์ (`scripts/backup_db.py`, `scripts/migrate_schema.py`, `backend/tests/test_migration_0001.py`) จากโฟลเดอร์ Backup กลับ

## 2026-11-06 · Phase 6 — Gate 6E-5A No-API Preflight

```text
Gate 6E-5A: PASS
Mode: No-API Preflight
Real Provider Calls: 0
Gemini API: NOT CALLED
Anthropic API: NOT CALLED
External Network Provider Calls: 0
```

**Source Code:** ไม่มีการแก้ไข (ระบบ) · **Database / schema / migration:** ไม่เปลี่ยน · **`.env`:** ไม่แตะ (`VORA_LLM_PROVIDER=none`)

**เพิ่ม**
- `backend/tests/test_gate6e5a_preflight.py` — ตัวกันเครือข่าย (socket + httpx) · Gemini adapter 24 กรณีด้วย MockTransport · ProviderChain Gemini↔Anthropic · deadline ค่าเริ่มต้นจริง · safety/injection ไม่ค้นคืนและไม่เรียก provider · Knowledge ฝังคำสั่งอยู่ใน CONTEXT เท่านั้น · Guard reject → KB · Bake-off harness config/cases/scanner
- หลักฐาน `docs/vora-next/phase6/gate6e5a-*` · ส่วน 6E-5A ใน `gate6e-report.md`

**ผล:** pytest SQLite / PostgreSQL 16 (Linux) 838 passed · 1 skipped (ตรวจ `.env` ข้ามเพราะไม่มีไฟล์ในเครื่องทดสอบ) · Browser 150/150 · Gate 6B 11/11 · Bake-off selftest OK · Windows รอทีม

**Backup:** `_backups/before-changes/2026-11-06_1030_before-gate6e5a/` · **ย้อนกลับ:** ลบ `backend/tests/test_gate6e5a_preflight.py` และคืนเอกสารจาก Backup

