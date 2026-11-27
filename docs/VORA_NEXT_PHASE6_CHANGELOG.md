# VORA NEXT — Phase 6 CHANGELOG

รูปแบบ: วันที่เวลา (Asia/Bangkok) · Gate · ไฟล์ · DB · Backup · วิธีย้อนกลับ

## 2026-11-01 20:45 · Gate 6A — System Audit & Architecture Lock

**Source Code:** ไม่มีการแก้ไข
**Database:** ไม่มีการเปลี่ยนแปลง · ไม่ได้รัน migration
**Dependencies:** ไม่ได้ติดตั้ง/เปลี่ยน
**การตรวจที่ทำ (อ่านอย่างเดียว):** Git status (ไม่มี repo) · `docs/test-results.txt` (93 passed) · โค้ด backend/AI/frontend · ชื่อคีย์ใน `.env` (ไม่อ่านค่าความลับ — คีย์ API แสดงเพียง "ว่าง/ตั้งแล้ว")

**เพิ่ม (เอกสารเท่านั้น)**
- `docs/VORA_NEXT_PHASE6_PLAN.md`
- `docs/VORA_NEXT_PHASE6_ARCHITECTURE.md`
- `docs/VORA_NEXT_PHASE6_AI_BRAIN.md`
- `docs/VORA_NEXT_PHASE6_DESIGN_SYSTEM.md`
- `docs/VORA_NEXT_PHASE6_TEST_PLAN.md`
- `docs/VORA_NEXT_PHASE6_PROGRESS.md`
- `docs/VORA_NEXT_PHASE6_CHANGELOG.md`

**Backup:** ไม่จำเป็น (ไม่ได้แก้ไฟล์เดิม — สร้างไฟล์ใหม่เท่านั้น)

**ย้อนกลับ:** ลบ 7 ไฟล์ข้างต้น (ไม่มีผลต่อระบบ)

## 2026-11-01 20:15 · เอกสาร — ปรับลำดับ Gate (ARCHITECTURE, TEST_PLAN)
- Backup: `_backups/before-changes/2026-11-01_2015_before-phase6-doc-revision/`
- เพิ่มข้อค้นพบ S1 (คีย์ Gemini รั่วผ่าน `last_error`) · TEST_PLAN เขียนใหม่ตาม Gate 6B–6H (Answer Guard G1–G6, Privacy, Admin permission, Offline/Voice แยกชัด)
- Source Code / Database: ไม่เปลี่ยน

## 2026-11-01 20:35 · เอกสาร — จัดเอกสาร Phase 6 ทั้ง 7 ไฟล์ให้ตรงกัน
- Backup: `_backups/before-changes/2026-11-01_2025_before-gate6b/` (+ `FROZEN_pastel_classic.md5`)
- แก้: PLAN, AI_BRAIN, DESIGN_SYSTEM, TEST_PLAN, PROGRESS, CHANGELOG · ลำดับ Gate เดียวกัน · S1 เป็น Security Blocker ของ 6C · Guard G1–G6 · Privacy · ข้อจำกัดออฟไลน์ · Baseline 93/150/20 · D6 = Anuphan, D8 = ตรึง pastel/classic
- Source Code / Database: ไม่เปลี่ยน
- ย้อนกลับ: คืนไฟล์จากโฟลเดอร์ Backup

## 2026-11-01 22:20 · Gate 6B — Unified Design Foundation

**เพิ่ม:** `frontend/shared/tokens.css`, `components.css`, `icons.js`, `theme.js`, `design-system.html` · `backend/tests/test_design_tokens.py` · `docs/vora-next/phase6/` (สคริปต์ทดสอบ 6B, ผลทดสอบ, ภาพ)
**แก้:** `frontend/shared/base.css` (+3 บรรทัด: `@import` tokens/components) · เอกสาร PROGRESS, CHANGELOG, DESIGN_SYSTEM
**ไม่แก้:** HTML/CSS ของหน้า Kiosk/Mobile/Admin · `/pastel/` `/classic/` · AI Engine · Database/Migration · Robot/Firmware · API · Dependencies
**ผลทดสอบ (Linux):** pytest 102/102 (PostgreSQL 16 + SQLite) · เบราว์เซอร์ 150/150 + Gate 6B 11/11 · computed style 24 หน้า/ขนาด ไม่เปลี่ยน (นอกจากแอนิเมชันที่เปลี่ยนเอง) · `/pastel/` `/classic/` md5 ไม่เปลี่ยน
**Backup:** `_backups/before-changes/2026-11-01_2025_before-gate6b/`
**ย้อนกลับ:** คืน `frontend/shared/base.css` จาก Backup · ลบไฟล์ที่เพิ่ม

## 2026-11-01 21:33 · Gate 6B — Windows Confirmed
- ทีมยืนยันบน Windows: `test.bat` **102 passed, 0 failed, 1 deprecation warning** (PostgreSQL `vora_test`) · Design System (`/shared/design-system.html`) เปิดใช้งานได้จริง
- สถานะ Gate 6B: **PASS — Windows Confirmed** · ไม่มีการแก้ไฟล์อื่นในรอบนี้ (อัปเดตเฉพาะ PROGRESS และ CHANGELOG)

## 2026-11-01 23:15 · Gate 6C — AI Provider Foundation (ส่วนที่อนุมัติ) · Security Blocker S1 แก้แล้ว
**Backup:** `_backups/before-changes/2026-11-01_2135_before-gate6c/`
**แก้:** `backend/app/ai/llm.py` (S1: คีย์ Gemini ทาง header · ปิดบังคีย์ทุกข้อความผิดพลาด · ProviderChain + circuit breaker แยก + งบเวลา · event ในเธรดแยก · `status()` ฟิลด์เดิม) · `backend/app/config.py` (คีย์ใหม่ไม่บังคับ) · `.env.example` · PROGRESS · CHANGELOG
**เพิ่ม:** `backend/app/ai/privacy.py` · `backend/tests/test_ai_chain.py` (43) · `backend/tests/test_ai_privacy.py` (52) · `docs/vora-next/phase6/gate6c-*` (ผล pytest, Eval, regression)
**ไม่แก้:** `ai/engine.py` (md5 เดิม) · Database/Migration · Robot/Firmware · API contract · Dependencies · `.env` (Online AI ยังปิด)
**ผลทดสอบ (Linux):** pytest 197/197 (PostgreSQL 16 + SQLite) · Eval 20/20 ก่อน = หลัง · เบราว์เซอร์ 149/150 — Gate 5 ข้อ 9 ล้มเหมือนกันกับโค้ดก่อน 6C (จุดอ่อนเวลาในสคริปต์ทดสอบเดิม — เสนอแก้ รออนุมัติ) · Kiosk/Idle ล้มในรอบหนัก 1 ข้อ/ชุด ผ่านเมื่อรันซ้ำ
**หยุดรออนุมัติ:** ตัด PII ในคำถาม (ต้องแก้ engine.py) · การบันทึกผู้ให้บริการของคำตอบจากแคช (engine.py) · (ทางเลือก) ตัด `last_error` จาก `/api/kiosk/config`
**ย้อนกลับ:** คืน `llm.py`, `config.py`, `.env.example` จาก Backup · ลบไฟล์ที่เพิ่ม

## 2026-11-01 23:55 · Gate 6C รอบ 2 — engine.py (อนุมัติเฉพาะ Privacy + Cached Provider Attribution)
**Backup:** `_backups/before-changes/2026-11-01_2230_before-gate6c-engine/`
**แก้:** `backend/app/ai/engine.py` (`_compose_with_llm`: ตัด PII เฉพาะคำถามผู้ใช้ · แคชเก็บผู้ให้บริการที่ตอบจริง · จุดเรียกอ่าน tuple) · `backend/tests/test_ai_privacy.py` (ids ไม่พิมพ์ข้อมูลทดสอบ) · PROGRESS · CHANGELOG
**เพิ่ม:** `backend/tests/test_engine_privacy_cache.py` (10) · `docs/vora-next/phase6/gate6c2-*`
**ไม่แก้:** `/api/kiosk/config` contract (ไม่อนุมัติ — คง `last_error` แต่ตรวจแล้วไม่มีข้อมูลลับ) · สคริปต์ Gate 5 ข้อ 9 (ไม่อนุมัติ — Known Test Flakiness) · Database · Robot · Firmware · Dependencies · `.env` (Online AI ปิด) · ไม่ติดตั้ง Ollama
**ผลทดสอบ (Linux):** pytest 207/207 (PostgreSQL 16 + SQLite) · Eval 20/20 (เหมือนค่าอ้างอิงทุกกรณี) · เบราว์เซอร์ 149/150 ในรอบ regression (Gate 1 ข้อ 6b) → รันซ้ำ Gate 1 38/38 · Gate 5 11/11 · ไม่มี Regression ใหม่
**ย้อนกลับ:** คืน `engine.py` และ `test_ai_privacy.py` จาก Backup · ลบ `test_engine_privacy_cache.py`

## 2026-11-02 · Gate 6C — Windows Confirmed
- ผู้ใช้ยืนยัน: `test.bat` **207 passed** (Windows, PostgreSQL `vora_test`) · Gate 6C = **PASS** ตามขอบเขตที่อนุมัติ

## 2026-11-02 19:40 · Gate 6D — แผน (ไม่แก้โค้ด)
- เพิ่ม `docs/VORA_NEXT_PHASE6_GATE6D_PLAN.md` (Architecture, Data Flow, ไฟล์ที่จะแก้/ไม่แก้, แผนทดสอบ Unit/Integration/Regression/Security, Backup/Rollback, ความเสี่ยง, Decisions D1/D2/D4/D13/D6D-1…5, เกณฑ์ PASS/FAIL/BLOCKED)
- แก้: PROGRESS, CHANGELOG · Backup: `_backups/before-changes/2026-11-02_1920_before-gate6d-plan/`
- Source Code / .env / Dependency / Database / Robot / Firmware: ไม่เปลี่ยน · Online AI ปิด · ไม่ติดตั้ง Ollama

## 2026-11-02 20:30 — docs: Gate 6D Plan v2
- `docs/VORA_NEXT_PHASE6_GATE6D_PLAN.md` แก้ทั้งฉบับ (v1 สำรองไว้แล้ว) · ไม่มีการเปลี่ยนโค้ด

## 2026-11-02 — docs: Gate 6D Plan v3 (Final Inspection Revision)
- `docs/VORA_NEXT_PHASE6_GATE6D_PLAN.md` v3 · แก้ fallback 15→13 ฟิลด์ · API Consumers · Unanswered Data Flow · Router initial/refine · D4/D6D-6 แยก · ไม่มีการเปลี่ยนโค้ด

## 2026-11-02 — docs: Gate 6D Plan v4 (Final Architecture & Privacy Review)
- `docs/VORA_NEXT_PHASE6_GATE6D_PLAN.md` v4 · unsafe content/injection + ปฏิเสธคงที่ · D4 ลำดับ redact→normalize · D6D-6 ไม่บันทึก `{e}` · D6D-7, D6D-8 ใหม่ · C-OLD/C-NEW · Mock vs Real · ไม่มีการเปลี่ยนโค้ด

## 2026-11-02 — Gate 6D: AI Orchestrator & Answer Guard
- เพิ่ม `backend/app/ai/router.py` (QueryRouter: unsafe content/injection, initial/refine), `backend/app/ai/guard.py` (Answer Guard G1–G9)
- `engine.py`: ด่าน unsafe ก่อนทุกเส้นทาง (ปฏิเสธคงที่ ไม่ค้นคืน ไม่เรียกผู้ให้บริการ) · `allow_llm` บังคับในทุกจุดเรียก LLM · Guard หลังเรียบเรียง · CONTEXT ในบล็อกคั่น + escape + canary · general (ปิดเป็นค่าเริ่มต้น)
- `admin.py`: `GET /api/admin/ai/status`, `POST /api/admin/ai/test` (admin เท่านั้น) · `config.py`/`.env.example`: `VORA_AI_GENERAL_ENABLED=false`
- ทดสอบใหม่ 437 รายการ (435 ผ่าน · 2 BLOCKED) + `tests/gate6d_snapshot.py`, `tests/data/gate6d_baseline_60.json`
- API `/api/chat` เดิมไม่เปลี่ยน (18 / fallback 13) · ไม่มีฟิลด์ใหม่ (D6D-2 ยังไม่ยืนยัน)

## 2026-11-05 — docs: ปิด Gate 6D (PASS)
- **Gate 6D PASS — Implementation, automated tests and regression completed.** SQLite/Linux, PostgreSQL 16/Linux และ Windows `test.bat` ผ่าน 642 tests โดยมี 2 skipped ตามรายการ decision ที่ยัง BLOCKED · Browser regression 150/150 และ Gate 6B 11/11 ผ่าน ไม่มี regression ใหม่ · Real AI Provider integration remains BLOCKED pending D1 provider selection · D6D-2 remains deferred · D6D-7c remains pending wording decision
- เอกสารที่ปรับ: PROGRESS, CHANGELOG, GATE6D_PLAN (สถานะ), `vora-next/phase6/gate6d-report.md` · ไม่มีการเปลี่ยนโค้ด

## 2026-11-05 — docs: D6D-7c ตัดสิน = แบบ A (ถ้อยคำ self_harm: ห่วงใย + 1323 + 1669) · โค้ดยังไม่เปลี่ยน

## 2026-11-05 — D6D-7c: ข้อความเฉพาะสำหรับ `content:self_harm` (แบบ A) ใน `engine.py` + เปิด I-UNS-10 · pytest 643 passed / 1 skipped

## 2026-11-05 — Gate 6E batch: Provider Hardening · Answer Contract v2 · Privacy Boundary · F1/F1b
- แก้ `backend/app/ai/llm.py` (finish กลาง · `LLMUnusable` · deadline ร่วม · concurrency · redact ขาออก) · `engine.py` (FAQ title redact · ข้อความว่าง ≠ NO_INFO · deadline ต่อคำขอ · contract ภายใน) · `config.py` (`VORA_AI_BUDGET_S`=8, `VORA_LLM_TIMEOUT`=4, `VORA_LLM_FALLBACK_TIMEOUT`=8, `VORA_AI_CONCURRENCY`=4, `VORA_KIOSK_TRUSTED_HOSTS`, `VORA_CHANNEL_TRUST`) · `routers/public.py` (trusted kiosk · v2 header · log ไม่มีคำถามดิบ · greet/vision 403) · `main.py` (`/ws` role kiosk) · `.env.example`
- ทดสอบ: ใหม่ `test_ai_hardening.py`, `test_ai_privacy_boundary.py`, `test_answer_contract_v2.py`, `test_channel_trust.py` · `test_chat_contract.py` C-NEW เปิดใช้ · `conftest.py`/`gate6d_snapshot.py` ตั้ง env trusted host
- pytest 793 passed (SQLite + PostgreSQL 16 / Linux) · Browser 150/150 · Gate 6B 11/11 · DB/schema/migration ไม่เปลี่ยน · dependency ไม่เปลี่ยน · `.env` ไม่แตะ
- Backup: `_backups/before-changes/2026-11-05_2020_before-gate6e-batch/` · ย้อนกลับ: คืนไฟล์จาก backup + ลบ 4 ไฟล์ทดสอบใหม่ (หรือ `VORA_CHANNEL_TRUST=legacy` สำหรับ F1 ชั่วคราว)

## 2026-11-06 — Gate 6E-5A No-API Preflight: PASS (Real Provider Calls 0)
- เพิ่ม `backend/tests/test_gate6e5a_preflight.py` · โค้ดระบบ / DB / `.env` / frontend / robot / firmware / requirements ไม่เปลี่ยน
- pytest 838 passed · 1 skipped (Linux SQLite + PostgreSQL 16) · Browser 150/150 · Gate 6B 11/11 · Bake-off selftest OK

