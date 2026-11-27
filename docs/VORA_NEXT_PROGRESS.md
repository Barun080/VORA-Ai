# VORA NEXT — PROGRESS (อ่านไฟล์นี้ก่อนทำงานต่อทุกครั้ง)

อัปเดตล่าสุด: 6 พ.ย. 2569 (Asia/Bangkok) — **Phase 6 (AI Brain) Gate 6E-5A No-API Preflight: PASS** · รายละเอียด Phase 6 ติดตามที่ `VORA_NEXT_PHASE6_PROGRESS.md`

> **Phase 6 ปัจจุบัน (AI Brain):** Gate 6D PASS · 6E-1…6E-4 PASS (Windows 793 passed) · **6E-5A No-API Preflight PASS** — Real Provider Calls 0 ·
> Gemini/Anthropic API NOT CALLED · ขั้นถัดไป Gate 6E-5B Real Provider Bake-off (ยังไม่ได้เลือก production provider) ·
> รายงาน `docs/vora-next/phase6/gate6e-report.md`
>
> ส่วนด้านล่างเป็นบันทึกถึง Phase 5 (1 พ.ย.) คงไว้เพื่ออ้างอิง

## Phase ปัจจุบัน

| Phase | ชื่อ | สถานะ | Gate |
|---|---|---|---|
| 0 | Project Audit & Baseline | ✅ เสร็จ | **PASS** |
| 1 | Spatial Experience Foundation | ✅ เสร็จ | **PASS** — `VORA_NEXT_PHASE1_REPORT.md` |
| 2 | Living Character & Vision Awareness | ✅ เสร็จ | **PASS** — `VORA_NEXT_PHASE2_REPORT.md` |
| 3 | Conversation Journey | ✅ เสร็จ (แก้ไข 1 พ.ย. 14:40) | **PASS** — `VORA_NEXT_PHASE3_REPORT.md` |
| 4 | Knowledge Constellation | ✅ เสร็จ | **PASS** — `VORA_NEXT_PHASE4_REPORT.md` |
| 5 | Time Portal + สถานที่จัดกิจกรรม | 🟡 Migration 0001 บน `vora` สำเร็จแล้ว (ทีมรัน 17:47) · `test.bat` รอบแรก 86/90 (WinError 32 — แก้แล้ว 18:05) · **รอทีมรัน `test.bat` ใหม่ ต้อง 93/93** | PASS บนเครื่องทดสอบ · รอยืนยัน Windows — `VORA_NEXT_PHASE5_REPORT.md` ข้อ 9 |
| 6 | Dynamic Presentation Engine | ⬜ (เริ่มหลังทีมยืนยันผล Phase 5 บน Windows) | — |
| 7 | QR Session Handoff & VORA Pulse | ⬜ | — |
| 8 | Final Integration & QA | ⬜ | — |

## สถานะฐานข้อมูล

- `vora` (ฐานข้อมูลจริง): **Migration 0001 ทำแล้ว** 1 พ.ย. 17:47 โดยทีม (`migrate.bat upgrade`) — Backup `_backups/database/migrations/vora-before-migrate-0001-20261101-174756.dump` ตรวจผ่าน 19 ตาราง 710 แถว · md5 ข้อมูลเดิมตรงทุกตารางหลัง upgrade
- การแก้ WinError 32 (18:05) **ไม่แตะฐานข้อมูลจริง** และไม่ต้องรัน migrate ใหม่

## ผลทดสอบล่าสุด

| ชุด | ผล |
|---|---|
| `test.bat` Windows (ทีม 1 พ.ย. ~17:50, PostgreSQL `vora_test`) | **86 passed, 4 failed** — `test_migration_0001.py` WinError 32 ที่ `shutil.move` ใน `safe_backup()` → แก้ต้นเหตุแล้ว (ดู CHANGELOG 18:05) · **รอรันใหม่** |
| pytest หลังแก้ (Linux) | **93/93 PostgreSQL 16** · **93/93 SQLite** (90 เดิม + 3 กรณีใหม่ตรวจ handle ค้าง) · กรณีใหม่ล้มเมื่อใช้ `backup_db.py` ตัวเก่า (ยืนยันว่าจับต้นเหตุได้) |
| Migration บนสำเนาข้อมูลจริง (PostgreSQL 16) หลังแก้ | upgrade → downgrade → ข้อมูล 19 ตารางเหมือนต้นฉบับ · SQLite CLI upgrade/downgrade ผ่าน · `backup_db.py` / `--list` ทำงานเหมือนเดิม |
| เบราว์เซอร์ (ก่อนการแก้นี้ · ไฟล์ที่แก้ไม่ถูกโหลดโดยเซิร์ฟเวอร์/หน้าเว็บ) | Gate 1–5 38/38 · 21/21 · 15/15 · 14/14 · 11/11 · Kiosk 25/25 · Idle 26/26 |

## สิ่งที่มีแล้ว (ใช้ต่อ ห้ามสร้างซ้ำ)

- รอบก่อน: CameraManager · VisitorTracker · InteractionManager · Event Bus · UIController · ธีมดำ-เหลือง
- Phase 1: `experience/ExperienceOrchestrator.js` · `SpatialMenu.js` · `PresentationView.js` · เมนูตัวอักษรใหญ่
- Phase 2: Avatar Adapter · สถานะ presenting/pointing/waving/thanking (`AVATAR_HINT`) · Privacy Pause · Smart Greeting
- Phase 3: `experience/JourneyEngine.js` (ตรรกะ + sessionStorage + TTL) · `JourneyView.js` · หน้ามือถือ `/m/?program=<id>`
- Phase 4: `backend/app/constellation.py` + `GET /api/constellation` · `experience/ConstellationView.js`
- Phase 5: `scripts/verify_backup.py` · `scripts/migrate_schema.py` + `migrate.bat` (ขั้น Migration ถัดไปเพิ่มเป็นคลาสใน `MIGRATIONS`) · `backend/app/schema_guard.py` · `backend/app/timeline.py` + `GET /api/timeline` · `experience/TimePortalView.js` · มือถือ `/m/?news=<id>` · ฟิลด์สถานที่ในหลังบ้าน

## งานถัดไป

1. **ทีม:** รัน `test.bat` ใหม่ (ไม่ต้องรัน migrate) → ต้อง **93 passed** → ส่ง `docs\test-results.txt` ให้ตรวจ · **ห้ามเริ่ม Phase 6 จนกว่าผ่านบน Windows**
2. หลังยืนยัน: Phase 6 — Dynamic Presentation Engine (รอคำสั่งเริ่ม)
3. Phase 8: จอแนวตั้ง 1080×1920 — พื้นที่นำเสนอทุกหมวดบังอวตาร (มีตั้งแต่ Phase 1 พบระหว่างทดสอบ Phase 5)

## ข้อตัดสินใจที่รอความเห็นทีม

- `experience.wakeOnVisitor` ค่าเริ่มต้น `false` · `camera.privacyPauseMs` 5 นาที · `experience.journeyTtlMs` 10 นาที
- ป้ายกล้องที่หัวจอ = ปุ่มพักกล้องของผู้เข้าชม (เจ้าหน้าที่ใช้ปุ่ม "เครื่องมือ")
- **ใหม่:** ช่วงเงียบ 5 วิหลังกดหยุดก่อนพูดประกาศในคิว (รวมข่าวความสำคัญสูง) — ข่าวความสำคัญ ≥ 4 ในหลังบ้านถูกจัดเป็น "ด่วน" ไม่ถูกพักระหว่างสนทนา (พฤติกรรมเดิม) ทีมอาจต้องการทบทวนระดับความสำคัญของข่าว
- ~~Phase 5 ฟิลด์สถานที่~~ → อนุมัติแล้ว (D1–D4) และทำแล้ว
- จอแนวตั้ง: จะแก้ใน Phase 8 หรือเร็วกว่านั้นถ้าจอหุ่นยนต์จริงเป็นแนวตั้ง
- Phase 7 QR token: ตั้งใจเก็บในหน่วยความจำ (ไม่แก้ DB)

## Backup ที่เกี่ยวข้อง

- ทั้งโครงการก่อน VORA NEXT: `_backups/snapshots/VORA_Robot-backup-20261031-2202-before-vora-next.zip`
- PostgreSQL: `_backups/database/vora-20261031-225927.dump`
- ก่อน Phase 1: `_backups/before-changes/2026-10-31_2310_before-phase1-spatial/`
- ก่อน Phase 2: `_backups/before-changes/2026-11-01_0005_before-phase2-character/`
- ก่อน Phase 3–4: `_backups/before-changes/2026-11-01_0115_before-phase3-4/`
- ก่อนแก้บริบทสาขา: `_backups/before-changes/2026-11-01_1440_before-fix-journey-context/`
- ก่อน Phase 5: `_backups/before-changes/2026-11-01_1550_before-phase5-location/` (+ `MANIFEST.md5`)
- ก่อน Migration 0001 บน `vora`: `_backups/database/migrations/vora-before-migrate-0001-20261101-174756.dump` (ตรวจผ่าน · SHA-256 99bd7f2f…)
- ก่อนแก้ WinError 32: `_backups/before-changes/2026-11-01_1800_before-fix-sqlite-backup-lock/` (8 ไฟล์ + MANIFEST.md5 รวม test-results.txt ที่ล้ม)

## เอกสาร

`VORA_NEXT_AUDIT.md` · `VORA_NEXT_ARCHITECTURE.md` · `VORA_NEXT_TEST_BASELINE.md` · `VORA_NEXT_CHANGELOG.md` · `VORA_NEXT_PHASE1..5_REPORT.md` · `VORA_NEXT_PHASE5_MIGRATION_PLAN.md` · `AVATAR_INTEGRATION.md` · `database.md` · `vora-next/phase0..5/`
