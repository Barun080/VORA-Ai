# VORA NEXT — Phase 6 Test Plan

ฉบับปรับ 1 พ.ย. 2569 20:30 (Asia/Bangkok) — ตามลำดับ Gate ล่าสุด · ฉบับก่อนหน้าสำรองที่ `_backups/before-changes/2026-11-01_2015_before-phase6-doc-revision/`
สถาปัตยกรรมและไฟล์ที่ได้รับผลกระทบ: `VORA_NEXT_PHASE6_ARCHITECTURE.md` ข้อ 6

| Gate | ชื่อ |
|---|---|
| 6B | Unified Design Foundation |
| 6C | AI Provider Foundation |
| 6D | AI Orchestrator & Answer Guard |
| 6E | Web Search & Grounding |
| 6F | Mobile & Admin Integration |
| 6G | Kiosk, Avatar & Voice Integration |
| 6H | Full Integration & Release Validation |

---

## 0. กติกาทั่วไป

### 0.1 Baseline — ห้ามลดจำนวน ห้ามข้าม ห้ามแก้ค่าที่คาดหวัง

| ชุด | จำนวน | รายละเอียด | ที่มา |
|---|---|---|---|
| pytest | **93** | test_ai 16 · test_robot 10 · test_system 20 · test_chat_context 5 · test_constellation 5 · test_migration_0001 12 · test_news_location 18 · test_timeline 7 | Windows `test.bat` 93 passed (PostgreSQL `vora_test`) · Linux PostgreSQL 16 + SQLite 93/93 |
| เบราว์เซอร์ | **150** | Gate 1 38 · Gate 2 21 · Gate 3 15 · Gate 4 14 · Gate 5 11 · Kiosk เดิม 25 · Idle เดิม 26 | `docs/vora-next/phase1–5/`, `docs/kiosk-redesign/` |
| Evaluation Cases | **20** | ชุดประเมินคำตอบในตาราง `eval_cases` | ฐานข้อมูล (นับจากสำเนาข้อมูลจริง 1 พ.ย.) |

- ทุก Gate รายงาน: pytest = 93 + กรณีใหม่ของ Gate · เบราว์เซอร์ = 150 + กรณีใหม่ · Eval 20 กรณี: จำนวนที่ตอบถูก **ไม่น้อยกว่าค่าอ้างอิง** (วัดค่าอ้างอิงครั้งแรกก่อนแก้โค้ดใน 6C)
- **การรัน Eval เขียนแถวลงตาราง `eval_runs`** → บนเครื่องทดสอบใช้สำเนาข้อมูลจริงเท่านั้น · บนฐานข้อมูล `vora` ของทีมรันได้เมื่อผู้ใช้อนุญาตเท่านั้น
- ห้าม skip / ลบ / ลดเงื่อนไข / แก้ค่าที่คาดหวังเพื่อให้ผ่าน · ห้ามรายงานผ่านโดยไม่ได้รันจริง · ถ้าต้องแก้สคริปต์ทดสอบเดิม ต้องบันทึกเหตุผลและแสดงว่าเงื่อนไขไม่ลดลง (แบบ Phase 0/5)
- ทดสอบกับผู้ให้บริการจริงใช้ **API Key ของทีมบนเครื่องของทีม** เท่านั้น · เครื่องทดสอบใช้ผู้ให้บริการจำลอง (httpx `MockTransport`) ไม่เรียกอินเทอร์เน็ต
- ไม่มี API Key / ข้อมูลส่วนบุคคลจริงในผลทดสอบที่บันทึกลง `docs/` (ใช้คีย์ปลอมแบบ sentinel)

### 0.2 นิยามผลของ Gate

| ผล | เงื่อนไข |
|---|---|
| **PASS** | Acceptance Criteria (AC) ผ่านครบ · Automated Tests ใหม่ผ่านครบ · Baseline ครบ (93 / 150 / Eval ไม่ลด) · Manual Tests ที่กำหนดทำแล้วและผ่าน · Backup ครบตาม MANIFEST · ไม่มีไฟล์นอกขอบเขตเปลี่ยน |
| **FAIL** | AC ข้อใดไม่ผ่าน · Baseline ลด/ล้ม · **พบ API Key หรือข้อมูลส่วนบุคคลรั่ว (FAIL ทันที)** · แก้ไฟล์นอกขอบเขต · ข้อมูลเดิมในฐานข้อมูลเปลี่ยน |
| **BLOCKED** | ทดสอบไม่ได้เพราะเงื่อนไขภายนอก: ยังไม่ได้ข้อตัดสินใจ (D1–D13) · ไม่มี API Key/ฮาร์ดแวร์ (Ollama, ไมโครโฟน, จอจริง) · ผู้ใช้ยังไม่ได้รันบน Windows/โทรศัพท์จริง — ระบุสาเหตุและสิ่งที่ต้องการ **ห้ามนับ BLOCKED เป็น PASS** · Gate ที่มีรายการ BLOCKED เดินต่อได้เฉพาะเมื่อผู้ใช้อนุมัติเป็นลายลักษณ์อักษร (บันทึกใน PROGRESS) |

### 0.3 Backup และ Rollback (ทุก Gate)
1. ก่อนแก้: ตรวจไฟล์ในเครื่องตรงกับสำเนาที่ทดสอบ (md5) → คัดลอกไฟล์ที่จะแก้ไป `_backups/before-changes/<YYYY-MM-DD_HHMM>_<gate>/` + `MANIFEST.md5` → `md5sum -c` ผ่าน · ห้ามเขียนทับ Backup เดิม
2. หลังแก้: บันทึกไฟล์แก้/ใหม่ใน `VORA_NEXT_PHASE6_CHANGELOG.md` · ตรวจว่าไม่มีไฟล์นอกรายชื่อเปลี่ยน
3. Rollback: คืนไฟล์จาก Backup → ลบไฟล์ใหม่ตามรายชื่อ → `test.bat` ต้องได้จำนวนเท่าก่อน Gate นั้น → เบราว์เซอร์ชุดที่เกี่ยวข้อง
4. **ไม่มี Gate ใดเปลี่ยน Database/Schema** — ถ้าพบว่าจำเป็น หยุดและขออนุมัติ

---

## 1. Gate 6B — Unified Design Foundation

**ขอบเขต:** `shared/tokens.css` (`--vora-*`), ฟอนต์, ไอคอน SVG, คอมโพเนนต์พื้นฐาน, `base.css` ชี้ alias · **ไม่เปลี่ยนหน้าตาของหน้าจอใดในตอนนี้**
**ไฟล์:** แก้ `frontend/shared/base.css` · ใหม่ `shared/tokens.css`, `shared/components.css`, `shared/icons.js` · **ขึ้นกับ:** D5 D6 D7 D9

| AC | เกณฑ์ |
|---|---|
| 6B-AC1 | ภาพหน้าจอ Kiosk (idle/active/presentation), Mobile (แชต/ข่าว/รายละเอียด), Admin (แดชบอร์ด/ข่าว/ฟอร์ม), `/pastel/`, `/classic/` ก่อน-หลัง ที่ 1366×768, 1600×900, 1920×1080, 390×844 **ไม่ต่างกัน** (ต่างได้ ≤ 0.1% ของพิกเซลจาก anti-alias) · ส่วนที่เปลี่ยนเองตามเวลา (วิดีโอกล้อง นาฬิกา) ปิดบังและระบุในรายงาน · วัดสัญญาณรบกวนด้วยการเทียบก่อน-ก่อน |
| 6B-AC1b | computed style ของทุก element (สี ฟอนต์ ขนาด ระยะ เงา ขอบ ฯลฯ) และค่าตัวแปร CSS เดิมของทุกหน้าข้างต้น ก่อน-หลัง **เท่ากันทุกค่า** |
| 6B-AC6 | ไฟล์ใน `/pastel/`, `/classic/` md5 ไม่เปลี่ยน (เทียบ `FROZEN_pastel_classic.md5` ใน Backup) |
| 6B-AC7 | Foundation ใช้งานได้จริง: หน้าอ้างอิง `/shared/design-system.html` แสดง token, ธีม dark/light, components, ไอคอนทุกตัว · สลับธีมแล้วค่าสีเปลี่ยนตาม token |
| 6B-AC2 | token ใหม่ขึ้นต้น `--vora-` ทั้งหมด · ไม่ประกาศชื่อเดิม (`--glow`, `--surface`, `--line` …) ใหม่ด้วยความหมายต่าง |
| 6B-AC3 | ทุกคู่สีตัวอักษร/พื้นหลังใน token ผ่าน contrast ≥ 4.5:1 (ตัวอักษรใหญ่ ≥ 3:1) ทั้งธีม dark และ light |
| 6B-AC4 | ไอคอนเป็น SVG ในเครื่องทั้งหมด · มี `aria-hidden` หรือ label |
| 6B-AC5 | ฟอนต์โหลดจาก `/assets/vendor/fonts` เท่านั้น (network log ไม่มีโดเมนภายนอก) |

**Automated:** เบราว์เซอร์ 150 · pytest 93 + `backend/tests/test_design_tokens.py` (โครงสร้าง token, ไม่ชนชื่อ, ธีมครบคู่, contrast, ไอคอน) · `docs/vora-next/phase6/gate6b-scenarios.js` (โหลด token ทุกหน้า, ธีม, หน้าอ้างอิง, ฟอนต์ในเครื่อง) · `gate6b-visual.js` (computed style + ภาพ ก่อน/หลัง; เครื่องมือบนเครื่องทดสอบ ไม่เพิ่ม dependency ในโปรเจกต์)
**Manual:** ไม่มี (ไม่เปลี่ยนหน้าตา)
**Backup/Rollback:** ข้อ 0.3 (ไฟล์: `shared/base.css`; ไฟล์ใหม่ใน `frontend/shared/` + เทสต์) · Rollback เร็ว: คืน `base.css` จาก Backup (ตัด `@import`) หน้าเดิมกลับเป็นเดิมทันที
**PASS:** AC1–AC5 + Baseline · **FAIL:** ภาพต่าง > 0.1% · Baseline ล้ม · **BLOCKED:** ยังไม่ได้ D5/D6/D7/D9

## 2. Gate 6C — AI Provider Foundation

**Security Blocker:** **S1** (ARCHITECTURE ข้อ 3.1) — ห้ามเปิดผู้ให้บริการออนไลน์ใด ๆ จนกว่า 6C-AC4 และ T-PRV-11/12/20–26 ผ่าน
**ขอบเขต:** ProviderChain online → local · circuit breaker ต่อผู้ให้บริการ · งบเวลารวม · **แก้ S1** · ตัดข้อมูลส่วนบุคคลก่อนส่ง · ค่า `.env` เดิมได้ผลเดิม
**ไฟล์:** แก้ `backend/app/ai/llm.py`, `config.py`, `.env.example` · (`routers/public.py` เฉพาะตัด `last_error` จาก `/api/kiosk/config` ถ้าอนุมัติ) · ใหม่ `tests/test_ai_chain.py`, `tests/test_ai_privacy.py` · **ขึ้นกับ:** D1 D2 D4 D13

| AC | เกณฑ์ |
|---|---|
| 6C-AC1 | `.env` เดิม (`VORA_LLM_PROVIDER=none`): `/api/chat` ให้ `text/answered/provider/sources` เหมือนก่อน 6C ทุกกรณีใน test_ai และ Eval 20 |
| 6C-AC2 | primary สำเร็จ → `llm:<primary>` · primary ล้ม → `llm:<fallback>` · ล้มทั้งหมด → `knowledge-base` |
| 6C-AC3 | ผู้ให้บริการที่ตัดวงจรถูกข้ามโดยไม่รอ timeout · เวลารวมไม่เกินงบ D13 + 0.5 วิ |
| 6C-AC4 | **ไม่มี API Key** ในข้อความผิดพลาด, `last_error`, `system_events`, log, `/api/health`, `/api/kiosk/config`, `/api/admin/system` — ทุกผู้ให้บริการ (ข้อ 5.3) · คีย์ Gemini ไม่อยู่ใน URL |
| 6C-AC5 | ข้อมูลส่วนบุคคลถูกตัดก่อนส่งผู้ให้บริการ (ข้อ 5.1) — ถ้า D4 ยังไม่ตัดสินใช้ค่าปลอดภัย (ตัด) |

**Automated (ผู้ให้บริการจำลอง):** T-CH-01 ค่าเดิม = พฤติกรรมเดิม · T-CH-02 primary ok · T-CH-03 primary ล้ม → fallback · T-CH-04 ล้มทั้งหมด → KB · T-CH-05 breaker เปิด → ข้าม · T-CH-06 เกินงบ → KB ภายในงบ · T-CH-07 `NO_INFO` → `answered=false` + unanswered · T-CH-08 HTTP 400/401/429/500/timeout/JSON เสีย ทุกผู้ให้บริการ · T-PRV ข้อ 5.1–5.3 · T-OFF-KB-01 · T-OFF-AI-02 (จำลอง) · Baseline
**Manual (เครื่องทีม คีย์จริง):** M-6C-1 เปิดผู้ให้บริการที่เลือก (D1) ถาม 5 คำถามจาก Eval · M-6C-2 ใส่คีย์ผิดโดยตั้งใจ → `/api/kiosk/config`, หน้าระบบในหลังบ้าน, `system_events` ไม่มีคีย์ · M-6C-3 (ถ้า D2) ตัดอินเทอร์เน็ต → `llm:ollama` · ปิด Ollama → KB
**Backup/Rollback:** ข้อ 0.3 (ไฟล์: `llm.py`, `config.py`, `.env.example`, `public.py` ถ้าแก้)
**PASS:** AC1–AC5 + Baseline + Manual · **FAIL:** AC ใดล้ม (AC4 = FAIL ทันที) · **BLOCKED:** ไม่มีคีย์ (M-6C-1/2) · ไม่มี Ollama (M-6C-3) · ยังไม่ได้ D1/D2/D13

## 3. Gate 6D — AI Orchestrator & Answer Guard

**ขอบเขต:** QueryRouter · AnswerGuard (ข้อ 4) · ฟิลด์ `answer_source`, `notice` · `GET /api/admin/ai/status`, `POST /api/admin/ai/test`
**ไฟล์:** แก้ `backend/app/ai/engine.py` (**ต้องอนุมัติ** — Phase 0), `routers/admin.py` · ใหม่ `ai/router.py`, `ai/guard.py`, `tests/test_ai_router.py`, `tests/test_answer_guard.py`, `tests/test_ai_admin.py`

| AC | เกณฑ์ |
|---|---|
| 6D-AC1 | คำถามเรื่องสถานศึกษาทุกเจตนา → `institutional` (≥ 30 ประโยคไทย/อังกฤษ) · ไม่เคยใช้ web search |
| 6D-AC2 | คำถามสถาบันที่ไม่มีในฐานความรู้ → "ไม่มีข้อมูล" + unanswered (เดิม) |
| 6D-AC3 | AnswerGuard ผ่านทุกกรณีข้อ 4 (6 ประเภทข้อมูลสำคัญ ตรวจกับแหล่งที่อนุญาตจริง) |
| 6D-AC4 | `/api/chat` ฟิลด์เดิมครบ + `answer_source`, `notice` · Kiosk/Mobile เดิมไม่พัง (Gate 3 ข้อ 14, Gate 5 ข้อ 10) |
| 6D-AC5 | สิทธิ์และการปิดบังข้อมูลลับของ AI Status/AI Test ผ่านทุกกรณีข้อ 6 |
| 6D-AC6 | Eval 20 ไม่ต่ำกว่าค่าอ้างอิง · ไม่มีกรณีที่เคยตอบได้ถูก Guard ปฏิเสธผิด (false reject = 0) |

**Automated:** T-RT (router) · T-GRD ข้อ 4 · T-PRV ข้อ 5 · T-ADM ข้อ 6 · T-OFF-AI-03 · Baseline · Eval บนสำเนาข้อมูลจริง
**Manual:** M-6D-1 ทีมอ่านคำตอบ Eval ที่ผ่าน LLM เทียบคำตอบฐานความรู้ · M-6D-2 เข้าหลังบ้านด้วย editor/viewer ยืนยันว่าเรียกสถานะ AI/ทดสอบไม่ได้
**Backup/Rollback:** ข้อ 0.3 (ไฟล์: `engine.py`, `admin.py`; ไฟล์ใหม่ 5 ไฟล์)
**PASS:** AC1–AC6 + Baseline + Manual · **FAIL:** Guard ปล่อยข้อมูลสำคัญนอกแหล่งที่อนุญาตแม้ 1 กรณี · false reject ใน Eval · รั่วคีย์/PII · **BLOCKED:** ยังไม่อนุมัติแก้ `engine.py` · ยังไม่ได้ D4

## 4. Answer Guard Tests (T-GRD) — 6D (และ 6E สำหรับคำตอบจากเว็บ)

**หลัก:** ข้อมูลสำคัญทุกประเภทในคำตอบของ LLM ต้อง (1) ตรงกับ **แหล่งที่อนุญาต** และ (2) อยู่ใน **CONTEXT ที่ส่งให้ LLM สำหรับคำถามนั้น** · ไม่ผ่าน → ทิ้งคำตอบ LLM ใช้คำตอบจากฐานความรู้ตรง ๆ + event `ai.guard_rejected` (ไม่มีข้อความผู้ใช้/PII) · **การตรวจเฉพาะตัวเลขและวันที่ไม่เพียงพอ**

### 4.1 แหล่งที่อนุญาต (Allowed Sources)

| ประเภท | แหล่งที่อนุญาต (เท่านั้น) | ไม่อนุญาต |
|---|---|---|
| G1 ชื่อสถานศึกษา / ชื่อหุ่นยนต์ | `settings.school_name_th/en`, `settings.robot_name` | ชื่อจาก LLM/เว็บ · ชื่อย่อที่ไม่ได้กำหนด |
| G2 หลักสูตร/สาขา/ระดับ/แผนก | `programs` ที่ `status=published` (name_th/en, level, department) | สาขา draft/archived · ชื่อที่ไม่มีในระบบ |
| G3 สถานที่ (อาคาร ห้อง ที่จัดงาน ที่อยู่) | `knowledge` approved · `news.location` ของข่าวที่เผยแพร่และอยู่ในช่วงเผยแพร่ · `settings.contact_th/en` | ข่าว draft/หมดอายุ · สถานที่ที่อนุมาน |
| G4 วันที่/เวลา/ปี | `news.event_date/publish_at/expire_at` (เผยแพร่ + อยู่ในช่วง) · ข้อความใน `knowledge` approved · `programs` published | วันที่คำนวณเอง ("อีก 2 สัปดาห์") ที่ไม่มีในแหล่ง |
| G5 ตัวเลข (ค่าเทอม จำนวนรับ ทุน ระยะเวลาเรียน) | ข้อความใน `knowledge` approved · `programs` published | ตัวเลขประมาณ/ปัด/คำนวณเอง |
| G6 ข้อมูลติดต่อ (โทร อีเมล URL LINE Facebook) | `settings.contact_th/en` · `knowledge` approved · `news.location_map_url` ของข่าวที่อนุญาต | ช่องทางที่ไม่มีในแหล่ง · URL ที่ LLM สร้าง |

### 4.2 กรณีทดสอบ (LLM จำลองส่งคำตอบตามกรณี · ข้อมูลทดสอบใส่ใน DB ทดสอบ)

| ID | กรณี | ผลที่ต้องได้ |
|---|---|---|
| T-GRD-01…06 | คำตอบใช้ข้อมูล G1–G6 ที่ถูกต้องและอยู่ใน CONTEXT | ผ่าน ใช้คำตอบ LLM |
| T-GRD-07 | ชื่อสถานศึกษาผิด/ชื่ออื่น | ปฏิเสธ |
| T-GRD-08 | สาขาที่ไม่มีในระบบ ("สาขาการบินอวกาศ") | ปฏิเสธ |
| T-GRD-09 | สาขาที่มีในฐานข้อมูลแต่เป็น draft/archived | ปฏิเสธ (มีในฐานข้อมูล ≠ อนุญาต) |
| T-GRD-10 | ชื่อสาขาใกล้เคียงแต่ไม่ตรง ("เทคโนโลยีสารสนเทศและการสื่อสาร" เมื่อในระบบคือ "เทคโนโลยีสารสนเทศ") | ปฏิเสธ (ยอมรับเฉพาะชื่อ/ชื่ออังกฤษ/ชื่อย่อที่กำหนดในระบบ) |
| T-GRD-11 | สถานที่ที่ไม่มีในแหล่ง ("อาคาร 9 ชั้น 5") | ปฏิเสธ |
| T-GRD-12 | สถานที่จากข่าวที่หมดอายุหรือ draft | ปฏิเสธ |
| T-GRD-13 | วันที่แต่งขึ้น / เลื่อนวัน / คำนวณเอง | ปฏิเสธ |
| T-GRD-14 | ตัวเลขแต่งขึ้น / ปัดเศษ (12,500 → "ประมาณ 13,000") | ปฏิเสธ |
| T-GRD-15 | เบอร์โทร/อีเมล/URL/LINE ที่ไม่มีในแหล่ง | ปฏิเสธ |
| T-GRD-16 | ค่ามีในแหล่งที่อนุญาต แต่ **ไม่อยู่ใน CONTEXT ของคำถามนี้** | ปฏิเสธ |
| T-GRD-17 | รูปแบบเทียบเท่า: เลขไทย ๑๒,๕๐๐ = 12500 · พ.ศ. 2569 = ค.ศ. 2026 · "3 พ.ย." = "3 November" · 0-0000-0000 = 000000000 | ผ่าน (normalize แล้วตรง) |
| T-GRD-18 | รูปแบบต่างและค่าต่าง (2568 แทน 2569 · เบอร์สลับหลัก) | ปฏิเสธ |
| T-GRD-19 | คำตอบภาษาอังกฤษ | ตรวจกับ `name_en`, `school_name_en`, `contact_en` |
| T-GRD-20 | ค่าอยู่ใน CONTEXT แต่ผูกผิดเรื่อง (ค่าเทอมสาขา A ตอบให้สาขา B เมื่อทั้งสองอยู่ใน CONTEXT) | **ข้อจำกัดที่ทราบ** — การจับคู่ค่าตรวจไม่ได้ · ทดสอบว่า CONTEXT ถูกจำกัดเฉพาะรายการที่ตอบ (ถามสาขาเดียวไม่ใส่หลายสาขา) · รายงานผลจริง ห้ามรายงานว่าป้องกันได้ถ้าไม่ได้ |
| T-GRD-21 | ไม่มีข้อมูลสำคัญ (ประโยคทั่วไป) | ผ่าน |
| T-GRD-22 | Guard ปฏิเสธ → `provider=knowledge-base` + event `ai.guard_rejected` ระบุประเภทที่ล้ม ไม่มีข้อความผู้ใช้/คำตอบ LLM เต็ม/PII | ตามนั้น |
| T-GRD-23 | LLM ปิด (`none`) | Guard ไม่ถูกเรียก (คำตอบฐานความรู้เดิม) |
| T-GRD-24 (6E) | คำตอบจากเว็บกล่าวถึงข้อมูลสำคัญของสถานศึกษา G1–G6 | ปฏิเสธส่วนนั้น — เว็บห้ามเป็นแหล่งข้อมูลของสถานศึกษา |

## 5. Privacy Tests (T-PRV) — 6C, 6D, 6E, 6H

### 5.1 ก่อนส่งผู้ให้บริการ (ตรวจคำขอที่ออกนอกเครื่องจริงผ่าน MockTransport: URL, header, body)

| ID | ข้อมูลในคำถาม | ผลที่ต้องได้ |
|---|---|---|
| T-PRV-01 | เบอร์โทร 0812345678 / 081-234-5678 / +66 81 234 5678 | ไม่ปรากฏ (แทนด้วยเครื่องหมาย เช่น `[เบอร์โทร]`) |
| T-PRV-02 | อีเมล | ไม่ปรากฏ |
| T-PRV-03 | เลขประจำตัวประชาชน 13 หลัก (ติดกัน/มีขีด) | ไม่ปรากฏ |
| T-PRV-04 | LINE ID / เลขบัญชี ในรูปแบบชัดเจน | ไม่ปรากฏ |
| T-PRV-05 | ชื่อบุคคล | **ข้อจำกัด:** ตรวจจับชื่อไทยด้วยรูปแบบไม่น่าเชื่อถือ — ไม่อ้างว่าป้องกันได้ · บันทึกเป็นความเสี่ยงคงเหลือ + ป้ายแจ้งบนจอ (D4) |
| T-PRV-06 | `session_id`, presence id, ข้อมูลกล้อง/ภาพ/เสียง | ไม่อยู่ในคำขอเลย |
| T-PRV-07 (6E) | คำค้นที่ส่งไปผู้ให้บริการค้นหา | ผ่านการตัด PII แบบเดียวกัน |
| T-PRV-08 | ข้อความที่ AI Test ในหลังบ้านส่ง | ประโยคคงที่ ไม่ใช่ข้อมูลผู้ใช้ |

### 5.2 Log / Error / Event

| ID | ตรวจ | ผลที่ต้องได้ |
|---|---|---|
| T-PRV-10 | log ของแอป (caplog ระดับ DEBUG) ตลอดการแชต รวมกรณีผู้ให้บริการล้ม | ไม่มี PII จาก 5.1 · ไม่มีคีย์ · ไม่มีเนื้อหาคำขอที่ส่งผู้ให้บริการ |
| T-PRV-11 | `system_events` หลังผู้ให้บริการล้มทุกแบบ (400/401/429/500/timeout) | ไม่มีคีย์ · ไม่มี URL ที่มี query คีย์ · ไม่มี PII |
| T-PRV-12 | `LLMError`, `last_error`, traceback ที่ถูกบันทึก | ปิดบังแล้ว (S1) |
| T-PRV-13 | response `/api/chat` เมื่อเกิดข้อผิดพลาดภายใน | ไม่มีรายละเอียดภายใน/คีย์ |
| T-PRV-14 | `audit_log` ของ AI Test | มีผู้ทดสอบ เวลา ผู้ให้บริการ ผล — ไม่มีคีย์ |
| T-PRV-15 | ข้อความผู้ใช้ที่ระบบเดิมเก็บใน `messages`/`unanswered` | **พฤติกรรมเดิมเก็บข้อความเต็ม** — Phase 6 ไม่เปลี่ยนโดยไม่ได้อนุมัติ · ถ้า D4 ให้ตัด PII ก่อนบันทึก จะทดสอบเพิ่ม (BLOCKED จนกว่าตัดสิน) |

### 5.3 การจัดการ API Key (คีย์ sentinel เช่น `VORA-SENTINEL-KEY-…` ใน env ทดสอบ)

| ID | ตรวจ | ผลที่ต้องได้ |
|---|---|---|
| T-PRV-20 | ค้น sentinel ใน response ทุก endpoint สาธารณะ (`/api/health`, `/api/kiosk/config`, `/api/chat` …) และหลังบ้าน (`/api/admin/system`, `/ai/status`, `/ai/test`, `/settings`, `/events`, `/audit`) | ไม่พบ |
| T-PRV-21 | ค้น sentinel ในฐานข้อมูลทดสอบทั้งหมด (dump) หลังรันชุดทดสอบ | ไม่พบ |
| T-PRV-22 | ค้น sentinel ใน log, ผล pytest, ไฟล์ผลทดสอบใน `docs/` | ไม่พบ |
| T-PRV-23 | คีย์ Gemini ส่งทาง header ไม่ใช่ URL | ตรวจจากคำขอ |
| T-PRV-24 | สถานะคีย์แสดงเพียง "ตั้งแล้ว/ยังไม่ตั้ง" | ไม่มีอักขระของคีย์แม้บางส่วน |
| T-PRV-25 | คีย์อ่านจาก `.env` เท่านั้น · `/api/admin/settings` ไม่รับ/ไม่คืนคีย์ · `.env.example` ไม่มีคีย์จริง | ตามนั้น |
| T-PRV-26 | `base_url` ที่มี user:pass@ | ไม่ถูกแสดงในสถานะ (ปิดบัง) |

## 6. Admin Permission Tests (T-ADM) — `GET /api/admin/ai/status`, `POST /api/admin/ai/test` (API ใน 6D, UI ใน 6F)

| ID | กรณี | ผลที่ต้องได้ |
|---|---|---|
| T-ADM-01 | ไม่มี token / token ผิด / หมดอายุ | 401 ทั้งสอง endpoint |
| T-ADM-02 | บัญชี viewer | 403 ทั้งสอง |
| T-ADM-03 | บัญชี editor | 403 ทั้งสอง |
| T-ADM-04 | บัญชี admin | 200 |
| T-ADM-05 | response ของ status มีเฉพาะฟิลด์ใน allowlist: ผู้ให้บริการ, โมเดล, enabled, คีย์ตั้งแล้วหรือไม่ (boolean), circuit, latency ล่าสุด, ข้อผิดพลาดที่ปิดบังแล้ว, สัดส่วนแหล่งคำตอบ | ไม่มีคีย์ · ไม่มี base_url ที่มี credential · ไม่มีค่า `.env` อื่น (DATABASE_URL, ADMIN_PASSWORD ฯลฯ) |
| T-ADM-06 | AI Test ใช้ประโยคทดสอบคงที่ — ข้อความที่ผู้เรียกส่งมาถูกละเลย/ปฏิเสธ | ใช้เป็นช่องทางส่งข้อความใด ๆ ไป LLM ไม่ได้ |
| T-ADM-07 | เรียก AI Test ถี่เกินกำหนด (เช่น > 5 ครั้ง/นาที) | 429 |
| T-ADM-08 | AI Test เมื่อผู้ให้บริการล้ม/ช้า | ตอบภายในงบเวลา · ข้อผิดพลาดปิดบังแล้ว |
| T-ADM-09 | AI Test ถูกบันทึกใน `audit_log` | มี (ไม่มีคีย์) |
| T-ADM-10 | endpoint หลังบ้านเดิมทั้งหมด | สิทธิ์เดิมไม่เปลี่ยน (test_system เดิม) |

## 7. Gate 6E — Web Search & Grounding

**ขอบเขต:** ค้นเว็บเฉพาะคำถาม general · โดเมนที่อนุญาต · ผลค้นเป็นข้อมูลอ้างอิงไม่ใช่คำสั่ง · ป้าย `notice` + `sources` แบบ web · ปิดเป็นค่าเริ่มต้น
**ไฟล์:** แก้ `ai/engine.py`, `config.py` · ใหม่ `ai/websearch.py`, `tests/test_websearch.py` · **ขึ้นกับ:** D3 D4 + API Key ผู้ให้บริการค้นหา

| AC | เกณฑ์ |
|---|---|
| 6E-AC1 | ปิด (ค่าเริ่มต้น) → พฤติกรรมเท่ากับหลัง 6D ทุกกรณี |
| 6E-AC2 | คำถาม institutional **ไม่เรียกค้นเว็บเลย** (จำนวนคำขอที่ผู้ให้บริการค้นหาจำลองได้รับ = 0) |
| 6E-AC3 | คำตอบจากเว็บมี `answer_source=web`, `notice` "ข้อมูลจากอินเทอร์เน็ต ไม่ใช่ข้อมูลทางการของวิทยาลัย", `sources` มี URL |
| 6E-AC4 | ผลนอกโดเมนที่อนุญาตถูกตัด · HTML/สคริปต์ถูกตัด |
| 6E-AC5 | ผลค้นที่มีคำสั่ง (prompt injection) ไม่ถูกทำตาม (ตรวจด้วยข้อความ canary) |
| 6E-AC6 | ค้นล้ม/timeout/โควตาหมด → "ไม่มีข้อมูล" เดิม ภายในงบเวลา |
| 6E-AC7 | T-GRD-24 + T-PRV-07 ผ่าน |

**Automated:** T-WS-01…07 ตาม AC (ผู้ให้บริการค้นหาจำลอง) + Baseline
**Manual:** M-6E-1 (เครื่องทีม คีย์จริง) ถามคำถามทั่วไป 10 ข้อ ตรวจแหล่งอ้างอิงและป้าย · M-6E-2 ถามคำถามสถาบัน 10 ข้อ ยืนยันว่าไม่มีคำตอบจากเว็บ
**Backup/Rollback:** ข้อ 0.3 (ไฟล์: `engine.py`, `config.py`; ไฟล์ใหม่ 2 ไฟล์) · ปิดด้วย `VORA_WEBSEARCH_PROVIDER=none` ได้ทันทีโดยไม่ต้องคืนไฟล์
**PASS:** AC1–AC7 + Manual · **FAIL:** ค้นเว็บสำหรับคำถามสถาบันแม้ครั้งเดียว · คำตอบจากเว็บไม่มีป้าย · **BLOCKED:** ไม่ได้ D3/D4 หรือไม่มีคีย์ — ถ้าผู้ใช้ไม่อนุมัติ 6E บันทึก "ข้าม (ผู้ใช้ไม่อนุมัติ)" ไม่ใช่ PASS

## 8. Gate 6F — Mobile & Admin Integration

**ขอบเขต:** Mobile/Admin ใช้ Design System (light theme ของแบรนด์) · แก้ P1 P3 P4 P5 P8 P9 · UI สถานะ AI + ปุ่มทดสอบในหลังบ้าน · แสดง `notice` บนมือถือ · QR E2–E4 (ถ้าอนุมัติ D12)
**ไฟล์:** `frontend/mobile/index.html`, `frontend/admin/admin.css`, `admin.js`, `admin/index.html` (**ต้องอนุมัติ** — Phase 0) · `backend/app/main.py` เฉพาะ `/m` redirect (ถ้าอนุมัติ D12)

| AC | เกณฑ์ |
|---|---|
| 6F-AC1 | Mobile/Admin ใช้ token `--vora-*` · ไม่มีสี hard-code ใหม่ · สีกราฟมาจาก token |
| 6F-AC2 | หลังบ้านแสดง 00:00 เป็น "ไม่ระบุเวลา" ตรงกับ Kiosk/Mobile (P3) · ตารางไม่ตัดคำกลางคำ (P4) ที่ 1280 และ 1400 px |
| 6F-AC3 | ลิงก์บนมือถือมีสไตล์ของระบบ (P5) · contrast ≥ 4.5:1 |
| 6F-AC4 | `/m/?news=`, `/m/?program=` เปิดรายละเอียดถูก (Gate 3 ข้อ 14, Gate 5 ข้อ 10) · ถ้าอนุมัติ D12: `/m?news=1` ไม่ทิ้ง query |
| 6F-AC5 | ฟอร์มข่าว/สถานที่ในหลังบ้านบันทึกได้เหมือนเดิม (Gate 5 ข้อ 11) |
| 6F-AC6 | หน้าสถานะ AI: admin เห็น · editor/viewer ไม่เห็นเมนูและเรียก API ไม่ได้ · ไม่แสดงคีย์ (T-ADM ผ่าน UI) |
| 6F-AC7 | Mobile แสดง `notice` เมื่อมี · ไม่แสดงเมื่อไม่มี |

**Automated:** เบราว์เซอร์ชุดใหม่ Gate 6F (Mobile 390×844 + Admin 1280/1400) + Baseline 150 + pytest 93+
**Manual:** M-6F-1 Android จริง: สแกน QR ทั่วไป (เปิดแชต) และ QR กิจกรรม (เปิดรายละเอียด) ตรวจ URL เต็ม · M-6F-2 iPhone/Safari ถ้ามี · M-6F-3 ทีมตรวจความสอดคล้องแบรนด์ Kiosk ↔ Mobile ↔ Admin
**Backup/Rollback:** ข้อ 0.3 (ไฟล์ mobile/admin + `main.py` ถ้าแก้)
**PASS:** AC1–AC7 + Manual · **FAIL:** Baseline ล้ม · AC ใดล้ม · **BLOCKED:** ไม่อนุมัติแก้ `frontend/admin/*` · ไม่มีโทรศัพท์ทดสอบ

## 9. Gate 6G — Kiosk, Avatar & Voice Integration

**ขอบเขต:** Kiosk ใช้ Design System · emoji → SVG (P6) · ป้าย QR แยกชัด (P8) · แสดงและพูด `notice` · สถานะเสียงเมื่อไม่มีอินเทอร์เน็ต · จอแนวตั้ง (P7 ถ้าอนุมัติ D10) · **ไม่แก้ Avatar Adapter/Renderer**
**ไฟล์:** `frontend/kiosk/kiosk.css`, `index.html`, `app.js`, `voice.js`, `experience/*View.js`

| AC | เกณฑ์ |
|---|---|
| 6G-AC1 | Gate 1–5 + Kiosk 25 + Idle 26 ผ่านครบ |
| 6G-AC2 | ไม่บังใบหน้าอวตารทุกขนาดที่ตกลง (+ แนวตั้งถ้าอนุมัติ) · `AvatarAdapter` API ไม่เปลี่ยน · สถานะอวตารเดิมทำงาน (Gate 2) |
| 6G-AC3 | ไม่มี emoji ใน UI หลัก (ยกเว้นข้อความจากผู้ใช้/ข้อมูล) |
| 6G-AC4 | QR ทุกจุดมีป้ายบอกปลายทาง |
| 6G-AC5 | คำตอบที่มี `notice` แสดงป้ายและอ่านออกเสียง |
| 6G-AC6 | เสียง: ผลทดสอบแยกตามข้อ 10 · **ไม่มีข้อความใดอ้างว่าฟังเสียงทำงานออฟไลน์** |

**Automated:** Baseline 150 + ชุด Gate 6G (รวม T-STT-02/03 ด้วย SpeechRecognition จำลอง) + pytest
**Manual:** M-6G-1 Windows + ไมโครโฟนจริง (มีอินเทอร์เน็ต) · M-6G-2 ตัดอินเทอร์เน็ต ตรวจข้อความแจ้งเรื่องเสียงและการพิมพ์ · M-6G-3 จอจริงของหุ่นยนต์ (D10)
**Backup/Rollback:** ข้อ 0.3 (ไฟล์ kiosk ที่ระบุ)
**PASS:** AC1–AC6 + Manual · **FAIL:** Baseline ล้ม · บังอวตาร · อ้างว่าเสียงทำงานออฟไลน์ · **BLOCKED:** ไม่มีจอจริง/ไมโครโฟน · ยังไม่ได้ D10

## 10. Offline & Voice Tests — แยกความสามารถให้ชัด

| ID | ความสามารถ | วิธีทดสอบ | ผลที่ต้องได้ | Gate |
|---|---|---|---|---|
| T-OFF-KB-01 | **Offline Knowledge Base** | ตัดอินเทอร์เน็ต (หรือผู้ให้บริการจำลองล้มทั้งหมด) · ถาม Eval 20 | ตอบจากฐานความรู้เท่าค่าอ้างอิง · `provider=knowledge-base` · ภายในงบเวลา | 6C, 6H |
| T-OFF-KB-02 | | ข่าว / Time Portal / Constellation / Journey ขณะไม่มีอินเทอร์เน็ต | ทำงาน (ข้อมูลในเครื่อง) | 6H |
| T-OFF-AI-01 | **Offline AI (Local LLM)** | ตัดอินเทอร์เน็ต · Ollama ทำงานบนเครื่องเดียวกัน | `provider=llm:ollama` · Guard ทำงาน | 6C, 6H — **BLOCKED ถ้าไม่ได้ติดตั้ง (D2)** |
| T-OFF-AI-02 | | ปิด Ollama ระหว่างใช้งาน | ตกไปฐานความรู้ภายในงบเวลา · ไม่ค้าง | 6C, 6H |
| T-OFF-AI-03 | | ไม่ได้ติดตั้ง Local AI | สถานะรายงาน "Local AI: ไม่ได้ตั้งค่า" — ไม่อ้างว่ามี Offline AI | 6D |
| T-STT-01 | **Speech Recognition** (Web Speech API ของ Chrome) | มีอินเทอร์เน็ต · Windows · ไมโครโฟนจริง | รับเสียงไทย/อังกฤษได้ (manual) | 6G, 6H |
| T-STT-02 | | ไม่มีอินเทอร์เน็ต (จำลอง `onerror {error:"network"}` + ทดสอบจริง) | แจ้ง "ฟังเสียงไม่ได้ขณะไม่มีอินเทอร์เน็ต — พิมพ์คำถามแทน" · ช่องพิมพ์ใช้ได้ · ไม่ค้างในสถานะกำลังฟัง | 6G |
| T-STT-03 | | เบราว์เซอร์ไม่รองรับ SpeechRecognition | ปิดปุ่มไมค์พร้อมเหตุผล | 6G |
| T-STT-04 | **ข้อจำกัด** | — | **ไม่มี STT ออฟไลน์ใน Phase 6** · เอกสาร/หน้าจอ/รายงานห้ามระบุว่าเสียงทำงานออฟไลน์ | ทุก Gate |
| T-TTS-01 | Text-to-Speech | ไม่มีอินเทอร์เน็ต · `VORA_TTS_PROVIDER=browser` | บันทึกผลจริงบนเครื่องทีม (ขึ้นกับเสียงไทยที่ติดตั้งใน Windows) — ไม่สรุปล่วงหน้า | 6H |
| T-TTS-02 | | `edge` + ไม่มีอินเทอร์เน็ต | ตกไปเสียงเบราว์เซอร์ (พฤติกรรมเดิม) | 6H |

## 11. Gate 6H — Full Integration & Release Validation

**ขอบเขต:** Regression ทั้งหมด · เครื่อง Windows ของทีม · โทรศัพท์จริง · ตัดอินเทอร์เน็ต · สแกนความลับ/PII ทั้งระบบ · รายงาน Phase 6
**ไฟล์:** เอกสารเท่านั้น (`docs/VORA_NEXT_PHASE6_REPORT.md` ใหม่, PROGRESS, CHANGELOG)

| AC | เกณฑ์ |
|---|---|
| 6H-AC1 | pytest = 93 + กรณีใหม่ของ 6B–6G ผ่านบน **Windows `test.bat` (PostgreSQL)** และ Linux (PostgreSQL + SQLite) |
| 6H-AC2 | เบราว์เซอร์ = 150 + ชุดใหม่ 6B/6F/6G ผ่านครบ |
| 6H-AC3 | Eval 20 ไม่ต่ำกว่าค่าอ้างอิง (สำเนาข้อมูลจริง; บน `vora` เฉพาะเมื่อผู้ใช้อนุญาต) |
| 6H-AC4 | T-PRV-20…22 ทั้งระบบ (response, ฐานข้อมูลทดสอบ, log, ไฟล์ใน `docs/`) ไม่พบคีย์/PII |
| 6H-AC5 | ข้อ 10 ครบ (รายการที่ BLOCKED ระบุเหตุผล) |
| 6H-AC6 | Manual: Android สแกน QR ทั้งสองแบบ · Kiosk บน Windows ครบทุกหมวด · หลังบ้านด้วย admin/editor/viewer |
| 6H-AC7 | ฐานข้อมูลจริง: schema เหมือนหลัง Migration 0001 · ไม่มี migration ใหม่ |
| 6H-AC8 | รายงานระบุสิ่งที่ทำได้/ทำไม่ได้ตามจริง (ไม่มี STT ออฟไลน์ · ข้อจำกัด T-GRD-20, T-PRV-05) |

**Automated:** ทุกชุด · **Manual:** M-6C…M-6G ที่ยังไม่ได้ทำ + 6H-AC6
**Backup/Rollback:** Rollback ทั้ง Phase = คืนไฟล์จาก Backup ของแต่ละ Gate ย้อนลำดับ 6G → 6B · ไม่มีขั้นตอนฐานข้อมูล
**PASS:** AC1–AC8 · **FAIL:** ข้อใดล้ม · **BLOCKED:** ผู้ใช้ยังไม่ได้รันบน Windows/โทรศัพท์ · รายการ BLOCKED ของ Gate ก่อนหน้ายังไม่ได้รับอนุมัติให้ข้าม

## 12. ตารางสรุปการทดสอบตาม Gate

| Gate | Automated ใหม่ | Manual | ชุดข้ามระบบ | Baseline |
|---|---|---|---|---|
| 6B | เทียบภาพ · contrast · network | — | — | 93 / 150 |
| 6C | T-CH-01…08 | M-6C-1…3 | T-PRV-01…06, 10…13, 20…26 · T-OFF-KB-01 · T-OFF-AI-01/02 | 93 / 150 / Eval ค่าอ้างอิง |
| 6D | T-RT · T-ADM-01…10 | M-6D-1/2 | T-GRD-01…23 · T-PRV-08, 14, 15 · T-OFF-AI-03 | 93 / 150 / Eval |
| 6E | T-WS-01…07 | M-6E-1/2 | T-GRD-24 · T-PRV-07 | 93 / 150 / Eval |
| 6F | เบราว์เซอร์ 6F | M-6F-1…3 | T-ADM (UI) | 93 / 150 |
| 6G | เบราว์เซอร์ 6G | M-6G-1…3 | T-STT-01…04 | 93 / 150 |
| 6H | ทั้งหมด | ทั้งหมด | ทั้งหมด + T-TTS · T-OFF-KB-02 | 93 / 150 / Eval |
