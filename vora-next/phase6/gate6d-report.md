# Gate 6D — รายงานผล Implementation (AI Orchestrator & Answer Guard)

วันที่: 2 พ.ย. 2569 · อ้างอิงแผน: `docs/VORA_NEXT_PHASE6_GATE6D_PLAN.md` v4

## สถานะ: ✅ Gate 6D PASS (ปิด 5 พ.ย. 2569)

**Gate 6D PASS — Implementation, automated tests and regression completed.** SQLite/Linux, PostgreSQL 16/Linux และ Windows `test.bat` ผ่าน 642 tests โดยมี 2 skipped ตามรายการ decision ที่ยัง BLOCKED · Browser regression 150/150 และ Gate 6B 11/11 ผ่าน ไม่มี regression ใหม่ · Real AI Provider integration remains BLOCKED pending D1 provider selection · D6D-2 remains deferred · D6D-7c remains pending wording decision

รายการที่เหลือถูกแยกเป็น BLOCKED/Decision — ไม่ใช่ความล้มเหลวของ Implementation 6D
Backup ก่อนแก้: `_backups/before-changes/2026-11-02_2035_before-gate6d/` (`MANIFEST.md5`, `SOURCE_MD5_BEFORE.txt`, `TESTS_BEFORE.txt`)

> **ความหมายของผลนี้:** ผ่าน Automated Tests ด้วย **Mock Provider (MockTransport)** และ Regression ตามแผนเท่านั้น
> **ไม่ใช่**การยืนยันว่า AI Provider จริงทำงานถูกต้อง — Provider จริงทั้งหมดเป็น **BLOCKED (D1)** · Online AI ยังปิด (`VORA_LLM_PROVIDER=none`)

## 1. ค่าตั้งต้นที่ใช้ (ตามคำสั่ง 2 พ.ย. 20:31 — "ใช้ข้อสรุปข้างต้นเป็นค่าตั้งต้น")

| การตัดสินใจ | ค่าที่ใช้ใน Implementation | สถานะ |
|---|---|---|
| D6D-5 (ก)–(ง) | ดำเนินการ | อนุมัติแล้ว |
| D6D-1 | `VORA_AI_GENERAL_ENABLED=false` | อนุมัติแล้ว |
| D6D-4 | unsafe ไม่ส่งไปผู้ให้บริการ | อนุมัติแล้ว |
| D6D-2 / (จ) | **ไม่ดำเนินการ** — ไม่มีฟิลด์ `answer_source`/`notice` · ไม่แก้ `public.py` | รอยืนยัน → C-NEW = BLOCKED |
| D4 / (ฉ) | **A (คงเดิม)** — `messages`/`unanswered` บันทึกเหมือนเดิม | รอเจ้าของโครงการ |
| D6D-6 | **(iii) คงเดิม** — ไม่แก้ `public.py:154`, `main.py:81` | รอเจ้าของโครงการ |
| D6D-8 | **(a) คงเดิม** — broadcast ส่ง `q` เดิม | รอเจ้าของโครงการ |
| D6D-7a | injection + คำถามสถาบัน → **ปฏิเสธ** (ค่าเริ่มต้นในแผน) | รออนุมัติ |
| D6D-7b | unsafe **ไม่บันทึก** unanswered (ผลตามสถาปัตยกรรม 3u — ข้ามเส้นทาง RAG) | รออนุมัติ — เปลี่ยนได้โดยเพิ่ม 1 จุดใน engine |
| D6D-7c | ทุก reason ใช้ข้อความปฏิเสธ out_of_scope เดิม (รวม `content:self_harm`) | รออนุมัติถ้อยคำ → I-UNS-10 = BLOCKED |

## 2. ไฟล์ที่เปลี่ยน (ตรงข้อ 3 ของแผน — ไม่มีไฟล์นอกขอบเขต)

| ไฟล์ | ประเภท | md5 ก่อน → หลัง |
|---|---|---|
| `backend/app/ai/engine.py` | แก้ | `6c567020cb76` → `6aa2391f0013` |
| `backend/app/routers/admin.py` | แก้ (+2 endpoint) | `2d28ef21d6cb` → `a5d171c0abc7` |
| `backend/app/config.py` | แก้ (+1 ค่าตั้ง) | `f99f03bd5f86` → `31e969ddd7e0` |
| `.env.example` | แก้ (+1 คีย์ ค่า false) | `7b1859497f30` → `4ae1eca49b57` |
| `backend/app/ai/router.py` | ใหม่ | `1db3d350f2cc` |
| `backend/app/ai/guard.py` | ใหม่ | `5dbbf718ff1c` |
| `backend/tests/test_ai_router.py` (292) · `test_answer_guard.py` (73) · `test_ai_orchestrator.py` (37) · `test_chat_contract.py` (15) · `test_ai_admin.py` (20) | ทดสอบใหม่ | ดูข้อ 7 |
| `backend/tests/gate6d_snapshot.py` (`b30cc2fedceb`) · `backend/tests/data/gate6d_baseline_60.json` (`19e83ac2fc8f` — สร้างจากโค้ดก่อน 6D) | ตัวช่วยทดสอบใหม่ (ไม่อยู่ในรายการแผนเดิม — อยู่ในโฟลเดอร์ทดสอบ ใช้โดย `test_chat_contract.py`) | ข้อ 7 |

**ไม่เปลี่ยน:** `public.py`, `main.py`, `llm.py`, `privacy.py`, `text.py`, `retriever.py`, `intent.py`, `training.py`, `reports.py`, `models.py`, `db.py`, Migration, Frontend ทั้งหมด, `.env`, `requirements.txt`, robot, firmware · **ไม่เปลี่ยนโครงสร้างฐานข้อมูล** · ไม่ติดตั้ง dependency ใหม่ (`pytest-asyncio` ไม่ได้ใช้)

## 3. สิ่งที่ทำ

- **Router (`ai/router.py`)** — `initial()` ก่อนเส้นทางกฎ/RAG/LLM: `unsafe` (`injection:*` 4 ชนิด ตรวจก่อน `content:*` 7 ชนิด) → `institutional` → `out_of_scope` → `pending` · `refine()` หลัง RAG อนุญาตเฉพาะ `pending → institutional | general` · ไม่ใช้ LLM ไม่ค้นคืน
- **engine.py** — `allow_llm` คำนวณครั้งเดียว · unsafe: ข้ามเส้นทางกฎ ค้นคืน LLM general · ตอบข้อความปฏิเสธเดิม · `robot_action=None`, `gesture=shrug` · event `ai.route route=unsafe reason=…` (ไม่มีข้อความผู้ใช้) · `_compose_with_llm` และ `_general_answer` รับ `allow_llm` เป็นพารามิเตอร์บังคับ (ด่านชั้น 2) · Guard หลัง compose — ปฏิเสธ → คำตอบฐานความรู้ + event `ai.guard_rejected` (รหัสเท่านั้น) และไม่เก็บแคช · general ปิดเป็นค่าเริ่มต้น (คำตอบ general มีคำนำ "(ข้อมูลทั่วไป ไม่ใช่ข้อมูลทางการของวิทยาลัย)" แทนฟิลด์ `notice` ที่ยัง BLOCKED)
- **Prompt (ง)** — System Instruction อยู่ใน field ระบบของผู้ให้บริการ · CONTEXT อยู่ในบล็อก `<<<CONTEXT id=n>>>…<<<END_CONTEXT>>>` · ตัวคั่นในคำถาม/ฐานความรู้ถูก escape · canary ท้าย system prompt (กลไกเสริม)
  - **ต่างจากแผน:** คำถามผู้ใช้ยังอยู่ในรูปแบบ `คำถามของผู้ใช้: …` เป็นส่วนสุดท้าย (ไม่ห่อด้วย `<<<USER_QUESTION>>>`) เพราะชุดทดสอบ 6C (`test_engine_privacy_cache.py::test_a3`) ตรึงรูปแบบนี้ไว้ และห้ามแก้ชุดทดสอบเดิม · system prompt ระบุว่าข้อความหลังป้ายนี้เป็นข้อมูล ไม่ใช่คำสั่ง
- **guard.py** — G1–G9 ตามตาราง 1.3 · เลขไทย · ตัวเลขเป็นคำ (ไทย/อังกฤษ เมื่อมีหน่วยหรือตัวคูณ) · พ.ศ.↔ค.ศ. · เบอร์หลายรูปแบบ · เดือนไทย/อังกฤษ · อาคาร/ห้อง/ชั้น ↔ Building/Room/Floor · G8 คู่ (เอนทิตี, ค่า) ข้ามรายการ · โหมด general ห้ามข้อมูลสถานศึกษา
- **admin.py** — `GET /api/admin/ai/status`, `POST /api/admin/ai/test` (admin เท่านั้น · allowlist · ประโยคคงที่ · 5 ครั้ง/นาที/บัญชี · audit ไม่มีคีย์ · `local_ai: not_configured`)

## 4. ผลทดสอบ

| รายการ | ผล |
|---|---|
| pytest SQLite (Linux) | **642 passed, 2 skipped (BLOCKED)** — เดิม 207 ผ่านทั้งหมด + ใหม่ 435 ผ่าน |
| pytest PostgreSQL 16 (Linux) | **642 passed, 2 skipped (BLOCKED)** |
| Windows `test.bat` | **642 passed, 2 skipped (BLOCKED)** — ผู้ใช้ยืนยัน 5 พ.ย. 2569 |
| เปรียบเทียบ 60 คำถาม (โหมด `none`, general ปิด, ฐานข้อมูลใหม่) | **60/60 เหมือนก่อน 6D ทุกตัวอักษร** · ไม่มีคำถามใดถูกจัดเป็น unsafe |
| Eval 20 (ฐานข้อมูลใหม่) | **20/20** |
| Eval 20 บนสำเนาข้อมูลจริง (PostgreSQL) | **20/20 ก่อน และ 20/20 หลัง · ผลรายข้อเหมือนกัน** |
| Unsafe I-UNS-1…9 | **คำขอไปผู้ให้บริการ = 0 ทุกกรณี** · ไม่เรียก retriever · ไม่คืนเนื้อหาฐานความรู้ · R-IMM-1…4 ผ่าน |
| Guard false reject (LLM จำลองคัดลอก CONTEXT, 60 คำถาม, 27 ข้อผ่าน LLM) | **0** |
| Guard false reject (LLM จำลอง "ถอดความแบบจำกัด": สลับประโยค เลขไทย คำนำ) | **0** — ไม่ใช่การถอดความของ LLM จริง (BLOCKED) |
| Router บนคำถามผู้ใช้จริงในสำเนาข้อมูล | 26 ข้อความ (17 แบบ) — ถูกจัดเป็น unsafe **0** (ตัวอย่างน้อย) |
| เบราว์เซอร์ 150 | **150/150** (Phase1 38 · Phase2 21 · Phase3 15 · Phase4 14 · Phase5 11 · Kiosk 25 · Idle 26) + Gate 6B 11/11 · Known Flakiness รอบนี้ไม่เกิด · Regression ใหม่ 0 |

## 5. BLOCKED (ไม่นับเป็น PASS)

C-NEW + (จ) ← D6D-2 · (ฉ) + P-D4-* + T-PRV-15 ← D4 · P-EV-* ← D6D-6 · P-BC-1 ← D6D-8 · I-UNS-10 ← D6D-7c · ผู้ให้บริการจริงทั้งหมด (คุณภาพคำตอบ, FP/FN จริง, เวลา, PI-4/5/6/8 จริง, Manual M-6D-1) ← D1 · T-OFF-AI-01 ← D2

## 6. ข้อจำกัดที่ทราบ (ทดสอบเพื่อบันทึก ไม่ใช่การป้องกันได้)

- Guard ตรวจไม่ได้: ข้อความเชิงคุณภาพ · จำนวนเชิงคุณภาพ · เวลาเชิงสัมพัทธ์ · ชื่อไม่มีคำนำหน้า · การถอดความคำสั่งระบบ · การสลับค่าภายในรายการ CONTEXT เดียวกัน
- คำสั่งแฝงในฐานความรู้ที่อนุมัติแล้ว (PI-5/6) และเส้นทาง Unanswered → ฐานความรู้ (PI-8) ผ่าน Guard ได้ถ้าไม่มีข้อมูลสำคัญผิด
- Router ใช้รายการคำคงที่ — มี false negative (ตัวอย่างใน PI-4) และอาจมี false positive กับคำถามที่ยังไม่ได้ทดสอบ · `content:self_harm` ได้ข้อความปฏิเสธทั่วไปจนกว่า D6D-7c
- คำถามที่ Router จัดเป็น `pending` และค้นไม่พบจะไป general เมื่อเปิด general — คำถามสถาบันที่ไม่มีคำสำคัญอาจไปเส้นทางนี้ (general ปิดเป็นค่าเริ่มต้น)
- ใน process เดียวกับชุดทดสอบอื่น Eval ได้ 19/20 เพราะ `test_ai.py` เพิ่มความรู้ที่ทำให้กรณี "ห้องแล็บเคมี…" ตอบได้ — เกิดเหมือนกันกับโค้ดก่อน 6D · จึงวัด Eval ในฐานข้อมูลใหม่แยก (C-OLD-7)

## 7. หลักฐาน (`docs/vora-next/phase6/`)

`gate6d-pytest-sqlite-linux.txt` · `gate6d-pytest-postgresql16-linux.txt` · `gate6d-regression-{p1,p2,p3,p4,p5,br,id,g6b}.txt` · `gate6d-eval-realdata-{before,after}.json` · `gate6d-guard-fp-report.json`

## 8. Rollback

คืน 4 ไฟล์จาก Backup (`engine.py`, `admin.py`, `config.py`, `.env.example`) · ลบ/ย้าย `ai/router.py`, `ai/guard.py`, ทดสอบใหม่ 5 ไฟล์, `tests/gate6d_snapshot.py`, `tests/data/gate6d_baseline_60.json` · ยืนยัน md5 ตรง `MANIFEST.md5` และ `test.bat` = 207 · ไม่มีข้อมูลในฐานข้อมูลที่ต้องย้อน (D4/D6D-6/D6D-8 ไม่ได้เปิด)

## 9. D6D-7c (เรื่องสุดท้ายก่อน 6E)

ปัจจุบัน `content:self_harm` ใช้ข้อความปฏิเสธ out-of-scope เดิม · เจ้าของโครงการเห็นว่า **ไม่ควรใช้ต่อในระยะ production** (คนละบริบทกับคำถามนอกขอบเขต) · รอเลือกถ้อยคำ แล้วจึงแก้ `engine.py` จุดเดียว + เปิด I-UNS-10 (ต้องอนุมัติการแก้โค้ดแยก)

**ตัดสินแล้ว 5 พ.ย. 2569: แบบ A** — TH: "หนูเป็นห่วงนะคะ ถ้าตอนนี้รู้สึกไม่ไหว ลองคุยกับครู ผู้ปกครอง หรือคนที่ไว้ใจได้นะคะ โทรสายด่วนสุขภาพจิต 1323 ได้ตลอด 24 ชั่วโมง ถ้าตอนนี้อยู่ในอันตราย โทร 1669 ทันทีค่ะ" · EN: "I'm worried about you. Please talk to a teacher, a parent, or someone you trust. You can call the Mental Health Hotline 1323, 24 hours a day. If you are in danger right now, call 1669." · รออนุมัติแก้โค้ด (engine.py จุดเดียว + I-UNS-10)

