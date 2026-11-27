# VORA NEXT — Phase 6 PROGRESS (อ่านก่อนทำงานต่อ)

อัปเดตล่าสุด: 6 พ.ย. 2569 (Asia/Bangkok) — **Gate 6E-5A No-API Preflight: PASS** (Real Provider Calls 0) · Linux 838 passed · Browser 150/150 · Gate 6B 11/11 · Windows รอผู้ใช้ · ขั้นถัดไป 6E-5B Real Provider Bake-off · `VORA_LLM_PROVIDER=none`

| Gate | ชื่อ | สถานะ |
|---|---|---|
| 6A | System Audit & Architecture Lock | ✅ เสร็จ |
| 6B | Unified Design Foundation | ✅ **PASS — Windows Confirmed** (ทีมยืนยัน 1 พ.ย. 21:33: `test.bat` 102 passed, 0 failed, 1 deprecation warning · เปิด Design System ได้จริง) |
| 6C | AI Provider Foundation | ✅ **PASS — Windows Confirmed** (`test.bat` 207 passed, ยืนยันโดยผู้ใช้ 2 พ.ย.) · Manual ที่ต้องใช้คีย์/Ollama ยัง BLOCKED · Online AI ปิด |
| 6D | AI Orchestrator & Answer Guard | ✅ **PASS** (5 พ.ย. — Windows 642 passed / 2 skipped BLOCKED) · Provider จริง BLOCKED (D1) · D6D-2 deferred · D6D-7c รอถ้อยคำ |
| 6E | Real AI Provider + Provider Foundation (Web Search ย้ายไป Gate ถัดไป) | 🟡 6E-0 harness พร้อม (Bake-off พัก — ไม่มีคีย์) · **6E-1…6E-4 เสร็จ (Linux)** · Windows รอผู้ใช้ · Provider จริง BLOCKED |
| 6F | Mobile & Admin Integration | ⬜ |
| 6G | Kiosk, Avatar & Voice Integration | ⬜ |
| 6H | Full Integration & Release Validation | ⬜ |

## Baseline
| ชุด | Baseline | หลัง 6B (Linux) |
|---|---|---|
| pytest | 93 | 6B: 102 (Windows) · **6C: 207 — Windows ยืนยัน** (Linux PostgreSQL 16 + SQLite 207/207) |
| เบราว์เซอร์ | 150 | **หลัง 6C (engine A/B): รอบ regression 149/150** — Gate 1 37/38 (ข้อ 6b) · Gate 2 21 · 3 15 · 4 14 · **5 11/11** · Kiosk 25 · Idle 26 · Gate 6B 11/11 · **รันซ้ำ Gate 1 = 38/38** → ไม่มี Regression ใหม่ · ดู "Known Test Flakiness" |
| Evaluation Cases | 20 | **20/20** หลังแก้ engine.py (สำเนาข้อมูลจริง, ไม่มี LLM) · ผลรายกรณีเหมือนค่าอ้างอิงก่อน 6C ทุกข้อ |

## Gate 6C — สถานะ (22:40)
**Backup:** `_backups/before-changes/2026-11-01_2135_before-gate6c/` (`ai/llm.py`, `config.py`, `.env.example`, PROGRESS, CHANGELOG)

| ไฟล์ | สถานะ | สิ่งที่ทำ |
|---|---|---|
| `backend/app/ai/llm.py` | แก้ | **S1:** คีย์ Gemini ส่งทาง header `x-goog-api-key` (ไม่อยู่ใน URL) · ทุกข้อความผิดพลาดผ่าน `redact_secrets()` ก่อนเข้า `last_error`/`system_events`/log/`LLMError` · ProviderChain primary → fallback (circuit breaker แยก) · งบเวลารวมบังคับด้วย `asyncio.wait_for` · `status()` ฟิลด์เดิมทุกตัว · `chain_status()` ใหม่ (สำหรับ 6D) · `provider` = ผู้ให้บริการที่ตอบคำขอนั้น (contextvar ต่อคำขอ) · บันทึก event ในเธรดแยก |
| `backend/app/ai/privacy.py` | ใหม่ | `redact_secrets()`, `redact_url()`, `redact_pii()` (PII ยังไม่ต่อสาย — รอ engine.py) |
| `backend/app/config.py` | แก้ | `VORA_LLM_FALLBACK_PROVIDER/_MODEL/_API_KEY/_BASE_URL/_TIMEOUT`, `VORA_AI_BUDGET_S` — ไม่บังคับ ค่าว่าง = เหมือนเดิม |
| `.env.example` | แก้ | เพิ่มคีย์ตัวอย่างข้างต้น (ค่าว่าง) |
| `backend/tests/test_ai_chain.py` | ใหม่ | 43 กรณี (T-CH-01…08 ครบ 5 ผู้ให้บริการ × 7 แบบความล้มเหลว · T-OFF-KB-01) |
| `backend/tests/test_ai_privacy.py` | ใหม่ | 52 กรณี (S1 · T-PRV-06, 10, 11, 12, 20, 21, 22, 23, 24, 25, 26 · ตัวปิดบังคีย์ · ตัวตัด PII) · ชื่อเทสต์ไม่พิมพ์ค่าคีย์ (T-PRV-22: ไม่มี sentinel ในผล pytest/ไฟล์ใน docs) |

**หมายเหตุ Gate 5 ข้อ 9 (เบราว์เซอร์):** ล้มทั้งในรอบ regression และรันซ้ำ — **ล้มเหมือนกันเมื่อใช้โค้ดก่อน 6C** (สลับ `llm.py`/`config.py` เดิมจาก Backup แล้วรัน: 10/11 ข้อ 9 ล้มเหมือนกัน) จึงไม่ได้เกิดจาก 6C · ตรวจแล้ว: แผงนำเสนอยังเลื่อนเข้า (แอนิเมชัน) ตอนที่สคริปต์วัดที่ 900 ms (left 524 → นิ่งที่ 523 หลัง ~2 วิ) แต่ปฏิทินวัดหลังนิ่ง → ต่างกัน 1 px · เป็นจุดอ่อนด้านเวลาของสคริปต์ทดสอบเดิม (เคยผ่านเพราะแอนิเมชันจบทันใน 900 ms) · **ยังไม่แก้สคริปต์** — เสนอ: รอจนตำแหน่งแผงนิ่งก่อนวัด (เงื่อนไขเท่ากันเหมือนเดิม) รออนุมัติ
**ผลทดสอบ (Linux):** pytest **197/197** PostgreSQL 16 และ SQLite (102 เดิม + 43 + 52) · Eval 20 บนสำเนาข้อมูลจริง: โค้ดเก่า 20/20 = โค้ดใหม่ 20/20 (ผลรายกรณีเหมือนกันทุกข้อ — ค่าอ้างอิงของ Phase 6) · เบราว์เซอร์: ดูหัวข้อ Baseline
**ทดสอบว่าเทสต์จับการรั่วได้จริง:** ย้อนเป็นรูปแบบเดิม (คีย์ใน URL + ไม่ปิดบัง) → ชุด privacy ล้ม 15 กรณีตรงช่องทาง (Gemini 10 กรณี + log, LLMError, endpoint, ฐานข้อมูล, URL) แล้วคืนโค้ดถูกต้อง

**พบและแก้ระหว่างทาง (ใน `llm.py` ที่อนุมัติ):**
- (มีมาก่อน Phase 6) บันทึก `system_events` แบบรอในคำขอ → บน SQLite คำขอที่ล้มต้องรอ ~15 วิ (lock) แล้วบันทึกไม่สำเร็จ → เปลี่ยนเป็นเธรดแยก (PostgreSQL ไม่ได้รับผลแต่เดิม)
- ตัวปิดบังพลาดรูปแบบ `'x-goog-api-key': '…'` (มีเครื่องหมายคำพูด) และ "ไลน์ไอดี" → แก้แล้ว (เทสต์จับได้)

**(รอบ 1) รายการที่เคยรออนุมัติ — สถานะ 22:28:** ข้อ 1–2 ✅ อนุมัติและทำแล้ว (ดูรอบ 2) · ข้อ 3 ❌ ไม่อนุมัติ (คง contract เดิม) · ข้อเสนอแก้ Gate 5 ข้อ 9 ❌ ไม่อนุมัติ (Known Test Flakiness)

~~หยุดรออนุมัติ:~~
1. ตัด PII ใน "คำถามของผู้ใช้" ก่อนส่ง (T-PRV-01…05 แบบ end-to-end) — ต้องทำตอนสร้าง prompt ใน `engine.py` เพราะ CONTEXT มีเบอร์ติดต่อทางการของวิทยาลัยที่ต้องคงไว้ · ตัวตัด `redact_pii()` พร้อมแล้ว
2. คำตอบจาก **แคช** ของ `engine.py` ที่เดิมได้จาก fallback จะถูกบันทึกเป็นผู้ให้บริการหลัก (แคชเก็บเฉพาะข้อความ) — คำขอปกติบันทึกถูกต้องแล้ว
3. (ทางเลือก) ตัด `last_error` ออกจาก `/api/kiosk/config` สาธารณะ — เปลี่ยน API contract · ไม่จำเป็นต่อ S1 แล้ว (ปิดบังที่ต้นทาง) แต่ลดข้อมูลที่เปิดเผยได้ · ไม่มีหน้าเว็บใดอ่านฟิลด์นี้

**BLOCKED:** M-6C-1/2 (ทดสอบผู้ให้บริการจริง — ไม่มี API Key; ยืนยัน header `x-goog-api-key` กับ Gemini จริงด้วย) · M-6C-3 / T-OFF-AI-01 (ไม่มี Ollama — D2) · D1, D2, D4, D13 ยังไม่ตัดสิน (ค่า `VORA_AI_BUDGET_S` ตั้งต้น 0 = ไม่จำกัดเพิ่ม เพื่อคงพฤติกรรมเดิม ต่างจากร่างใน AI_BRAIN ที่เสนอ 8 วิ — รอ D13)

## Gate 6C รอบ 2 — engine.py (อนุมัติเฉพาะ 2 รายการ, ผู้ใช้ 22:28)
**Backup:** `_backups/before-changes/2026-11-01_2230_before-gate6c-engine/` (`ai/engine.py`, `tests/test_ai_privacy.py` รุ่นก่อน, PROGRESS, CHANGELOG + MANIFEST)

| ไฟล์ | สถานะ | สิ่งที่ทำ |
|---|---|---|
| `backend/app/ai/engine.py` | แก้ (เฉพาะ `_compose_with_llm` + จุดเรียก) | **A:** `redact_pii()` เฉพาะ "คำถามของผู้ใช้" ใน prompt · CONTEXT (ฐานความรู้ที่อนุมัติ/ข้อมูลติดต่อทางการ) ไม่ถูกกรอง · ไม่เพิ่มการ log ข้อความ · **B:** แคชเก็บ (ข้อความ, ผู้ให้บริการที่ตอบจริง) → คำตอบจากแคชระบุ `llm:<ผู้ให้บริการจริง>` · รูปแบบ `/api/chat` เดิม |
| `backend/tests/test_engine_privacy_cache.py` | ใหม่ | 10 กรณี (A1–A4, B1–B5, `/api/kiosk/config` รูปแบบเดิม + ไม่มีข้อมูลลับ) |
| `backend/tests/test_ai_privacy.py` | แก้ | ตั้งชื่อเทสต์ (ids) ของชุด `redact_pii` ไม่ให้พิมพ์ข้อมูลทดสอบ — เงื่อนไขเดิม |

**ตรวจว่าเทสต์จับได้จริง:** รันกับ `engine.py` เดิม → A1 (PII ดิบถูกส่ง), B1 (แคช fallback ถูกระบุเป็น primary), B5 ล้ม · กรณีที่เหลือผ่านกับโค้ดเดิม (เป็นตัวกันถดถอย เช่น ข้อมูลติดต่อทางการไม่ถูกกรอง, ไม่มี PII ใน log)

### Security Test Results (6C ทั้งหมด)
| ช่องทาง | ผล |
|---|---|
| คีย์ Gemini ใน URL (S1) | ✅ ไม่อยู่ใน URL — ส่งทาง header `x-goog-api-key` (T-PRV-23) |
| `last_error`, `LLMError`, `llm.status()` | ✅ ไม่มีคีย์ — 5 ผู้ให้บริการ × 5 แบบความล้มเหลว × คีย์ 2 รูปแบบ (T-PRV-11/12) |
| `system_events`, log ของแอป | ✅ ไม่มีคีย์ / PII ดิบ (T-PRV-10, A4) |
| endpoint สาธารณะ + หลังบ้าน (`/api/health`, `/api/kiosk/config`, `/api/chat`, `/api/admin/system`, `/settings`, `/events`, `/audit` ฯลฯ) | ✅ ไม่มีคีย์ (T-PRV-20) |
| `/api/kiosk/config` ฟิลด์ `ai.last_error` | ✅ **รูปแบบเดิม** (ไม่เปลี่ยน contract ตามที่สั่ง) · ค่าไม่มีคีย์/`key=` |
| ทั้งฐานข้อมูลทดสอบ | ✅ ไม่มีคีย์ (T-PRV-21) |
| ผล pytest / ไฟล์ใน `docs/` | ✅ ไม่มี sentinel/ข้อมูลทดสอบส่วนบุคคล (T-PRV-22) |
| credential ใน `base_url` · สถานะคีย์ | ✅ ปิดบัง · แสดงเพียง `key_set` (T-PRV-24/26) |
| ตั้งค่าคีย์ผ่าน `/api/admin/settings` · `.env.example` | ✅ ไม่รับ/ไม่มีคีย์จริง (T-PRV-25) |
| PII ในคำถามก่อนส่งผู้ให้บริการ | ✅ เบอร์โทร (3 รูปแบบ), อีเมล, เลขบัตร 13 หลัก, LINE ID ถูกแทนด้วยป้าย · ข้อมูลติดต่อทางการใน CONTEXT คงเดิม (A1–A3) |
| session id / ภาพ / เสียง ไปผู้ให้บริการ | ✅ ไม่ถูกส่ง (T-PRV-06) |

### Known Test Flakiness (ไม่แก้เกณฑ์ · คง Baseline 150 เดิม)
| ชุด/ข้อ | อาการ | หลักฐาน | สถานะ |
|---|---|---|---|
| Gate 5 ข้อ 9 (1280×800 ตำแหน่งแผงปฏิทิน = หมวดข่าว) | วัดแผงข่าวที่ 900 ms ขณะแอนิเมชันยังเลื่อน (524 → 523 px) | ล้มกับโค้ดก่อน 6C ด้วย · รอบล่าสุดผ่าน 11/11 | **Known Test Flakiness** — ผู้ใช้ยังไม่อนุมัติให้แก้สคริปต์ |
| Gate 1 ข้อ 6b (Visitor Detection + wakeOnVisitor) | ล้ม 1 ครั้งในรอบ regression | รันซ้ำ 38/38 · ผ่านใน regression 6B และ 6C รอบแรก · เป็นตรรกะกล้อง/หน้าจอฝั่งเบราว์เซอร์ที่ engine.py ไม่เกี่ยว | ไม่ต่อเนื่อง (เฝ้าดู) — ไม่ใช่ Regression ใหม่ |
| Kiosk ข้อ 8 / Idle ข้อ 5c | ล้มในรอบ regression 6C รอบแรก (เครื่องโหลดสูง) | รันซ้ำผ่าน 25/25, 26/26 · รอบนี้ผ่านครั้งแรก | ไม่ต่อเนื่อง — ไม่ใช่ Regression |

### ปัญหาที่ยังค้าง
- `messages` / `unanswered` ยังเก็บข้อความคำถามดิบ (พฤติกรรมเดิม, T-PRV-15) — การตัด PII ก่อนบันทึกต้องเป็นข้อตัดสินใจ D4
- ชื่อบุคคลตรวจจับไม่ได้อย่างน่าเชื่อถือ (T-PRV-05) — ความเสี่ยงคงเหลือ
- ยืนยัน header `x-goog-api-key` กับ Gemini จริง + M-6C-1/2/3 — BLOCKED (ไม่มีคีย์/Ollama; ห้ามเปิด/ติดตั้งในรอบนี้)
- D1, D2, D4, D13 ยังไม่ตัดสิน

## ข้อตัดสินใจ
✅ D6 ฟอนต์หลัก Anuphan · ✅ D8 ตรึง `/pastel/` `/classic/` · รอ D1–D5, D7, D9–D13 (`PHASE6_PLAN.md` ข้อ 6) — สีแบรนด์ใน token = ดำ-เหลืองของ Kiosk (เปลี่ยนได้ที่ `tokens.css` ที่เดียวเมื่อได้ D5)

## Gate 6B — สิ่งที่ส่งมอบ
| ไฟล์ | สถานะ | หมายเหตุ |
|---|---|---|
| `frontend/shared/tokens.css` | ใหม่ | token `--vora-*` เท่านั้น · `:root` + `[data-vora-theme="light"]` + `[data-vora-theme="dark"]` (ชุดสีครบเท่ากัน 23 ตัว) · Anuphan · ระยะ/มุม/ขนาด/การเคลื่อนไหว |
| `frontend/shared/components.css` | ใหม่ | ปุ่ม การ์ด ป้าย แท็บ ช่องกรอก ลิงก์ notice meta(วัน/เวลา/สถานที่) QR-card ตาราง สถานะ AI toast ไอคอน — selector ทุกตัวต้องมี class `.vora-*` · ไม่มีสี hard-code |
| `frontend/shared/icons.js` | ใหม่ | 32 ไอคอน SVG วาดเอง · `icon()`, `hydrateIcons()`, `ICON_NAMES` · ไม่มีลิงก์ภายนอก |
| `frontend/shared/theme.js` | ใหม่ | `applyTheme()`, `currentTheme()`, `token()` |
| `frontend/shared/design-system.html` | ใหม่ | หน้าอ้างอิงสำหรับทีม `/shared/design-system.html` (ไม่มีลิงก์จากหน้าผู้เข้าชม) |
| `frontend/shared/base.css` | **แก้** | เพิ่ม 3 บรรทัดหลังบรรทัดแรก: คอมเมนต์ + `@import` tokens.css + components.css — ส่วนอื่นไม่เปลี่ยน |
| `backend/tests/test_design_tokens.py` | ใหม่ | 9 กรณี (รันใน `test.bat`) |
| `docs/vora-next/phase6/` | ใหม่ | `gate6b-scenarios.js` (11), `gate6b-visual.js`, `gate6b-pixels.py`, ผลทดสอบ, `gate6b-visual-summary.json`, ภาพหน้าอ้างอิง |

ไม่แตะ: HTML/CSS ของแต่ละหน้า (kiosk/mobile/admin) · `/pastel/` `/classic/` (md5 11 ไฟล์ตรงกับ `FROZEN_pastel_classic.md5`) · AI Engine · Database · Migration · Robot · Firmware · API · Dependencies

## หลักฐาน "หน้าตาไม่เปลี่ยน" (24 หน้า/ขนาด: Kiosk idle/active/ข่าว ×3 ขนาด, Mobile ×3, Admin login/ข่าว ×3, pastel ×3, classic ×3)
- computed style ทุก element (29 คุณสมบัติ) + ตัวแปร CSS เดิม 40 ตัว + โครงสร้าง DOM + ฟอนต์ที่โหลด: **ไม่เปลี่ยนทุกหน้า** ยกเว้น element ที่เปลี่ยนเองตามเวลา — วงเรืองแสง/ตาอวตารของ pastel/classic (`ellipse`, `circle`: ค่า `opacity` จากแอนิเมชัน — เปลี่ยนแบบเดียวกันระหว่าง 2 รอบ "ก่อน")
- ภาพ: หน้าที่คงที่ (Admin, Mobile) ต่าง **0.0%** · หน้าที่มีแอนิเมชันต่างระหว่าง 2 รอบ "ก่อน" เองแล้ว (classic สูงสุด 28%, kiosk idle 1366 7.2%) จึงวัดเกณฑ์ภาพ 0.1% ไม่ได้ ใช้ computed style แทน · `kiosk-idle-1600` ต่าง 0.13% ตรวจแล้วเป็นท่าทางใบหน้าอวตาร (รันโค้ดใหม่ 5 รอบต่างกันเอง 0.10–0.23%)
- คำขอไปโดเมนภายนอก: ไม่มีทั้งก่อนและหลัง

## ปัญหาที่พบและแก้ใน 6B
- คอมโพเนนต์ที่ห่อด้วย `:where()` (ความเฉพาะเจาะจง 0) แพ้กฎ `button, input, select, textarea {color/font: inherit}` ของ base.css → ปุ่ม/แท็บ/ช่องกรอกเสียสี · ทดสอบ 6B ข้อ 7 จับได้ → ใช้ class เดี่ยวสำหรับคอมโพเนนต์หลัก + กฎ focus ที่ชนะ `:focus-visible` เดิม · เพิ่มเงื่อนไขใน pytest
- pytest แยก selector ผิดที่จุลภาคใน `:where(h1, h2…)` (ข้อผิดพลาดของตัวทดสอบ) → แยกเฉพาะระดับบนสุด (เงื่อนไขไม่ลดลง)

## รอ / BLOCKED
- ✅ ทีมรัน `test.bat` บน Windows: **102 passed** (21:33) · ✅ Design System เปิดใช้งานได้จริง
- BLOCKED สำหรับ Gate ถัดไป: D1 D2 D4 D13 (6C) · อนุมัติแก้ `ai/engine.py` (6D) · D3 + คีย์ค้นหา (6E) · อนุมัติแก้ `frontend/admin/*` + D12 (6F) · D10 (6G)
- ค้างจาก Phase 5: ทดสอบ QR Time Portal ซ้ำบนโทรศัพท์ (ขั้นตอน F)

## Backup
- ก่อนปรับเอกสาร (20:15): `_backups/before-changes/2026-11-01_2015_before-phase6-doc-revision/`
- ก่อนจัดทำแผน 6D (2 พ.ย. 19:20): `_backups/before-changes/2026-11-02_1920_before-gate6d-plan/` (PROGRESS, CHANGELOG)
- ก่อน Gate 6C (21:35): `_backups/before-changes/2026-11-01_2135_before-gate6c/` — PROGRESS, CHANGELOG, `ai/llm.py`, `config.py`, `.env.example`
- ก่อน Gate 6B (20:25): `_backups/before-changes/2026-11-01_2025_before-gate6b/` — 7 เอกสาร + `frontend/shared/base.css` + `MANIFEST.md5` + `FROZEN_pastel_classic.md5`
- **Rollback 6B:** คืน `frontend/shared/base.css` จากโฟลเดอร์ข้างบน (หน้าเดิมกลับเป็นเหมือนก่อนทันที) → ลบไฟล์ใหม่ในตาราง "สิ่งที่ส่งมอบ" ได้ (ไม่มีหน้าใดอ้างถึงนอกจาก base.css)

## ทำต่อจากตรงนี้
1. ✅ 6B PASS — Windows Confirmed
2. ✅ 6C PASS — Windows 207
3. 6D: ผู้ใช้ตรวจแผน `VORA_NEXT_PHASE6_GATE6D_PLAN.md` → อนุมัติ D6D-5 (+ D1/D2/D4/D13/D6D-1…4) → จึงเริ่มแก้โค้ด · ห้ามเริ่ม 6E

## 2 พ.ย. 2569 20:30 — Gate 6D Plan v2 (เอกสารเท่านั้น)
- แก้แผน 6D ตามคำสั่ง 8 ข้อ (19:33): ด่าน unsafe ก่อนทุกการเรียก LLM (ปิดช่องโหว่ RAG พบข้อมูล → `_compose_with_llm`), Guard แยกความแน่นอน + G8/G9, canary เป็นกลไกเสริม, Contract Test (รวม fallback 15 ฟิลด์), D4 เปรียบเทียบ A/B ไม่ตัดสิน, Rollback แยกกลุ่ม, Decisions ตามผู้ใช้, เกณฑ์ unsafe = 0 requests
- พบใหม่: `public.py` บันทึกคำถามดิบลง `system_events` เมื่อ `answer()` ล้ม → D6D-6 (รออนุมัติ)
- ไม่แก้ Source Code / .env / DB / Dependency / Frontend · Backup: `_backups/before-changes/2026-11-02_2000_before-gate6d-plan-v2/`
- สถานะ: **รออนุมัติแผน v2** · ยังไม่เริ่มเขียนโค้ด 6D · ไม่เริ่ม 6E

## 2 พ.ย. 2569 — Gate 6D Plan v3 (Final Inspection Revision · เอกสารเท่านั้น)
- แยก API Consumers 5 หมวด (เรียก /api/chat ตรง / ผ่าน ask() / answer() ผ่าน Endpoint อื่น / answer() ตรง / WebSocket ผู้รับ broadcast) · `/ws` ไม่ประมวลผลคำถาม
- **แก้ข้อเท็จจริงผิดใน v2:** fallback เมื่อ answer() ล้ม = **13 ฟิลด์** (ไม่ใช่ 15) — `public.py:155-159`
- ตรวจหน้า Unanswered (Backend+Frontend) + Data Flow · ไม่พบ: แก้ข้อความก่อน resolve, ลบรายการ, รวมด้วยมือ, CSV ของ unanswered
- Router แยก initial (ก่อน RAG) / refine (หลัง RAG) · unsafe เปลี่ยนไม่ได้ · เพิ่ม I-UNS-7/8, R-IMM-1…4
- D4 เพิ่มผลกระทบราย ปลายทาง · แยก D6D-6 เป็นการตัดสินอิสระ · ไม่เลือก/ไม่อนุมัติ
- ลบถ้อยคำ "ไม่มี PII" แบบครอบคลุม · เพิ่มข้อจำกัด redact_pii
- Backup: `_backups/before-changes/2026-11-02_2000_before-gate6d-plan-v3/` · Source 84 ไฟล์ md5 ก่อน = หลัง · `.env` ไม่เปลี่ยน
- สถานะ: **รอตรวจและอนุมัติ** · ไม่เริ่มโค้ด 6D · ไม่เริ่ม 6E

## 2 พ.ย. 2569 — Gate 6D Plan v4 (Final Architecture & Privacy Review · เอกสารเท่านั้น)
- unsafe แยก `content:*` / `injection:*` · unsafe ข้าม RAG/เส้นทางกฎ → ปฏิเสธคงที่ ไม่คืน Knowledge อัตโนมัติ · ไม่เรียก Provider · I-UNS-1…10
- D4: ยืนยัน `normalized` สร้างจากข้อความดิบ (`engine.py:136`) · B ต้อง redact_pii ก่อน normalize · ตาราง S1–S10 จุดจัดเก็บข้อความผู้ใช้
- D6D-6: `{e}` อาจมีข้อความผู้ใช้ (SQLAlchemy ไม่ตั้ง hide_parameters — ยืนยันจากการตั้งค่า ไม่ได้ทดลองจริง) · (i) ใหม่ไม่บันทึก exception message ดิบ · พบจุดที่สอง main.py:81
- ใหม่ D6D-7 (รายละเอียด unsafe) · D6D-8 (broadcast คำถามดิบไปทุก role เจ้าหน้าที่)
- Contract แยก C-OLD / C-NEW · D6D-2 → fallback 13→15 ต้องแก้ public.py
- Gate 6D PASS = Mock + Regression เท่านั้น · Provider จริง BLOCKED
- Backup: `_backups/before-changes/2026-11-02_2010_before-gate6d-plan-v4/` · Source 84 ไฟล์ md5 ก่อน = หลัง · `.env` ไม่เปลี่ยน
- รอเจ้าของโครงการ: D4, D6D-6 (+ขอบเขต main.py), D6D-7a/b/c, D6D-8, D6D-2 (รวม fallback), D1, D2, D13 · ไม่เริ่มโค้ด 6D/6E

## 2 พ.ย. 2569 — Gate 6D Implementation (ตามแผน v4 · ค่าตั้งต้นตามข้อสรุป · รอตรวจ)
- ใหม่ `ai/router.py`, `ai/guard.py` · แก้ `engine.py` (ก)–(ง), `admin.py` (+/ai/status, /ai/test), `config.py` (+VORA_AI_GENERAL_ENABLED=false), `.env.example`
- ไม่แก้ `public.py`, `main.py`, Frontend, DB schema, `.env`, dependency · ไม่มีไฟล์นอกขอบเขต
- ค่าตั้งต้นของเรื่องที่ยังไม่ตัดสิน: D4=A · D6D-6=(iii) · D6D-8=(a) · D6D-2/(จ) ไม่ทำ · D6D-7a ปฏิเสธ · D6D-7b ไม่บันทึก unanswered · D6D-7c ใช้ข้อความปฏิเสธเดิม
- ต่างจากแผน: คำถามผู้ใช้คงรูปแบบ `คำถามของผู้ใช้: …` (ชุดทดสอบ 6C ตรึงไว้) — CONTEXT อยู่ในบล็อกคั่นตามแผน
- pytest Linux SQLite / PostgreSQL 16: 642 passed + 2 skipped (BLOCKED: D6D-2, D6D-7c) · เดิม 207 ผ่านครบ
- 60 คำถามเหมือนก่อน 6D ทุกตัวอักษร · Eval 20/20 (ฐานใหม่ และสำเนาข้อมูลจริง ก่อน=หลัง) · Unsafe คำขอไปผู้ให้บริการ = 0 · Guard false reject = 0 (Mock)
- เบราว์เซอร์ 150/150 + Gate 6B 11/11 · Regression ใหม่ 0
- ผลกับ Provider จริง: BLOCKED (D1) · Windows test.bat: รอผู้ใช้รัน
- รายงาน: `docs/vora-next/phase6/gate6d-report.md` · Backup: `_backups/before-changes/2026-11-02_2035_before-gate6d/`
- สถานะ: **รอตรวจและยืนยัน Windows** · ไม่เริ่ม 6E

## 5 พ.ย. 2569 17:50 — ปิด Gate 6D (เอกสารเท่านั้น · ไม่แก้โค้ด)
- **Gate 6D PASS — Implementation, automated tests and regression completed.** SQLite/Linux, PostgreSQL 16/Linux และ Windows `test.bat` ผ่าน 642 tests โดยมี 2 skipped ตามรายการ decision ที่ยัง BLOCKED · Browser regression 150/150 และ Gate 6B 11/11 ผ่าน ไม่มี regression ใหม่ · Real AI Provider integration remains BLOCKED pending D1 provider selection · D6D-2 remains deferred · D6D-7c remains pending wording decision
- Windows `test.bat`: ผู้ใช้ยืนยัน 642 passed · 2 skipped (BLOCKED: D6D-2 / C-NEW, D6D-7c / I-UNS-10)
- ความหมายของ PASS: ผ่านด้วย Mock Provider + Regression เท่านั้น ไม่ใช่การยืนยัน Provider จริง
- ยังค้าง (ไม่ใช่ความล้มเหลวของ Implementation): D1, D2, D4, D6D-2 (deferred), D6D-6, D6D-7a/7b (ใช้ค่าตั้งต้นอยู่), **D6D-7c**, D6D-8, D13
- D6D-7c: เจ้าของโครงการเห็นว่า **ไม่ควรใช้ข้อความ out-of-scope เดิมกับ `content:self_harm` ในระยะ production** เพราะเป็นคนละบริบท · ข้อเสนอถ้อยคำเตรียมแล้ว รอเลือก — เป็นเรื่องสุดท้ายของ 6D ก่อนเริ่ม 6E
- Backup: `_backups/before-changes/2026-11-05_1750_before-gate6d-close/`
- ห้ามเริ่ม 6E จนกว่าตัดสิน D6D-7c และได้รับอนุมัติ

## 5 พ.ย. 2569 — D6D-7c ตัดสินแล้ว (ถ้อยคำ · ยังไม่แก้โค้ด)
- เจ้าของโครงการเลือก **แบบ A** สำหรับ `content:self_harm` (แทนข้อความ out-of-scope เดิม)
  - TH: "หนูเป็นห่วงนะคะ ถ้าตอนนี้รู้สึกไม่ไหว ลองคุยกับครู ผู้ปกครอง หรือคนที่ไว้ใจได้นะคะ โทรสายด่วนสุขภาพจิต 1323 ได้ตลอด 24 ชั่วโมง ถ้าตอนนี้อยู่ในอันตราย โทร 1669 ทันทีค่ะ"
  - EN: "I'm worried about you. Please talk to a teacher, a parent, or someone you trust. You can call the Mental Health Hotline 1323, 24 hours a day. If you are in danger right now, call 1669."
- คงพฤติกรรมเดิมของ unsafe: ไม่ส่งไปผู้ให้บริการ · ไม่ค้นคืน · ไม่สั่งท่าหุ่นยนต์ · emotion "sorry" (ไม่ต้องแก้ Frontend)
- ที่มาของเบอร์: 1323 สายด่วนสุขภาพจิต กรมสุขภาพจิต (24 ชม.) · 1669 การแพทย์ฉุกเฉิน — ตรวจ 5 พ.ย. 2569 · ไม่ใส่เบอร์ Samaritans เพราะแหล่งข้อมูลให้เบอร์ไม่ตรงกัน
- งานโค้ดที่ตามมา (รออนุมัติแยก): แก้ `engine.py` จุดเดียว (ข้อความตาม reason) + เปิด I-UNS-10 (ปัจจุบัน skipped) · คาดผล pytest 643 passed / 1 skipped (D6D-2) · 60 คำถามต้องเหมือนเดิม
- หมายเหตุสำหรับ 6G: ตรวจว่าเสียงพูด (TTS) อ่าน "1323" เป็น "หนึ่ง-สาม-สอง-สาม" ไม่ใช่ "หนึ่งพันสามร้อยยี่สิบสาม"

## 5 พ.ย. 2569 — D6D-7c Implementation (ขอบเขตแคบ · รอตรวจ)
- แก้ `backend/app/ai/engine.py` จุดเดียว: เส้นทาง unsafe เลือกข้อความแบบ A เมื่อ reason = `content:self_harm` · reason อื่นยังใช้ข้อความปฏิเสธเดิม · md5 `6aa2391f0013` → `22db956064ac`
- แก้ `backend/tests/test_ai_orchestrator.py` เฉพาะ I-UNS-10 (เดิม skip → ทดสอบจริง 1 รายการ) · md5 `562c640574d5` → `bbe2b01f421e`
- ไม่เปลี่ยน: routing, safety classification, emotion "sorry", robot_action, Frontend, DB/schema, API contract, provider, `.env`, dependency
- pytest Linux SQLite / PostgreSQL 16: **643 passed, 1 skipped (BLOCKED: D6D-2)** · 60 คำถามเหมือนเดิม · I-UNS-10: provider 0 · retrieval 0 · ไม่มีฐานความรู้ · ไม่มี robot action
- เบราว์เซอร์ 150/150 + Gate 6B 11/11 · Regression ใหม่ 0 · Windows `test.bat`: รอผู้ใช้รัน (คาด 643 passed / 1 skipped)
- Backup: `_backups/before-changes/2026-11-05_1755_before-d6d-7c/` · หลักฐาน: `docs/vora-next/phase6/d6d7c-*`
- ไม่เริ่ม 6E

## 5 พ.ย. 2569 — Gate 6E batch: 6E-1 / 6E-2 / 6E-3 / 6E-4 (รอ Windows)
- **6E-3 Privacy:** FAQ title (`KnowledgeItem.question` จาก unanswered) ผ่าน `redact_pii` ก่อนเข้า CONTEXT · payload ขาออกผ่าน `redact_secrets` · pipeline error เก็บ `text_len` + `text_sha256` แทนคำถามดิบ
- **6E-1 Hardening:** finish กลาง stop/length/safety/empty/other · ถูกบล็อก/ตัด/ว่าง → `LLMUnusable` ไม่แตะ breaker ไม่ส่งต่อ fallback → ตอบจาก KB (ไม่ใช่ no_info) · deadline ร่วมต่อคำขอ `VORA_AI_BUDGET_S=8` (รวมรอคิว) · `VORA_AI_CONCURRENCY=4` · timeout 4 / fallback ≤ เวลาที่เหลือ · ไม่ retry · **ชื่อโมเดล Gemini และ thinking config ไม่เปลี่ยน (รอ Bake-off)**
- **6E-2 Contract:** `answer_source` / `verification` / `notice` จาก branch จริง · ส่งออกเฉพาะ header `X-VORA-Contract: 2` · ไม่มี header = 18 / 13 ฟิลด์เดิม · C-NEW เปิดเป็นทดสอบจริง (skip → pass)
- **6E-4 F1/F1b:** สิทธิ์ kiosk ตัดสินจาก IP (`VORA_KIOSK_TRUSTED_HOSTS`, ค่าเริ่มต้น 127.0.0.1,::1) · spoof `channel=kiosk` → rate limit + ไม่สั่งท่า + บันทึกเป็น mobile · `/api/greet`, `/api/vision/recognized` → 403 · `/ws?role=kiosk` → 4403 · `/api/robot/stop` คงเดิม · rollback `VORA_CHANNEL_TRUST=legacy` · Frontend ไม่ต้องแก้ (kiosk รันบน localhost)
- Test infra (อนุมัติ): `conftest.py`, `gate6d_snapshot.py` ตั้ง `VORA_KIOSK_TRUSTED_HOSTS=...,testclient` เท่านั้น · assertion ของ Gate 6D ไม่เปลี่ยน
- pytest Linux SQLite / PostgreSQL 16: **793 passed, 0 skipped** (643 + C-NEW + ใหม่ 149) · Baseline 60 ตรงเดิม · Eval 20/20
- Browser 150/150 (Gate 2 ข้อ 10 ล้มรอบแรกด้วยจังหวะเวลาฝั่งหน้าจอ — รันซ้ำ 21/21) · Gate 6B 11/11 · Bake-off selftest OK
- Windows `test.bat`: รอผู้ใช้รัน (คาด 793 passed / 0 skipped)
- Cost guard: นอกขอบเขต (หลัง Bake-off) · No real API call · No API key used · `.env` ไม่ถูกแก้
- Backup: `_backups/before-changes/2026-11-05_2020_before-gate6e-batch/` · รายงาน: `docs/vora-next/phase6/gate6e-report.md` · หลักฐาน: `docs/vora-next/phase6/gate6e-*`
- ยังค้าง: Bake-off → เลือก provider/โมเดล Gemini · cost guard · frontend contract v2 (6F/6G) · retrieval · `/ws` admin role

## 6 พ.ย. 2569 — Gate 6E-5A No-API Preflight: PASS
- ฐาน: Windows `test.bat` ของ 6E-1…6E-4 = 793 passed · 0 skipped · 1 warning (ผู้ใช้ยืนยัน)
- Mode: No-API Preflight · Real Provider Calls 0 · Gemini API NOT CALLED · Anthropic API NOT CALLED · External Network Provider Calls 0 · ไม่ใช้คีย์จริง
- เพิ่ม `backend/tests/test_gate6e5a_preflight.py` (46 รายการ) — โค้ดระบบไม่เปลี่ยน
- pytest Linux SQLite / PostgreSQL 16: 838 passed · 1 skipped (ตรวจ `.env` — ไม่มีไฟล์ในเครื่องทดสอบ) · Browser 150/150 · Gate 6B 11/11 · Bake-off selftest OK
- ข้อจำกัดที่ทราบ: Knowledge ที่อนุมัติแล้วซึ่งมีคำสั่งแฝง — Guard ไม่ปฏิเสธถ้าโมเดลพิมพ์ข้อความที่อยู่ใน CONTEXT (วัดใน Bake-off INJ-KB)
- ไม่ได้ประเมินคุณภาพ Gemini · ยังไม่ได้เลือก production provider · ขั้นถัดไป Gate 6E-5B Real Provider Bake-off
- Backup: `_backups/before-changes/2026-11-06_1030_before-gate6e5a/`

## 6 พ.ย. 2569 18:40 — Gate 6E-5B Gemini-only: NEEDS DECISION (ผู้ให้บริการตอบ 503)
- harness: เพิ่มโหมด gemini-selftest/check/smoke/validate/diagnose · แก้บั๊ก content-length · production ไม่เปลี่ยน
- models.get (API ยืนยัน): gemini-2.5-flash และ gemini-3.8-flash ตอบ 200 · generateContent · thinking=true · in/out 1,048,576/65,536
- gemini-3.8-flash ไม่รองรับ thinkingLevel MINIMAL (HTTP 400)
- timeout diagnosis ปิดแล้ว: VORA ตัดตรง 4/6/8 วิ · API ตรงได้ 503 "high demand" (17–28 วิ) → ปัญหาฝั่งผู้ให้บริการ · ยังไม่มีหลักฐานเลือก timeout ใหม่ · ไม่สรุปว่า thinking เป็นสาเหตุ
- คำขอจริงรวม: generateContent ≈13 (สำเร็จ 0) · models.get 8 · Anthropic 0 · ยังไม่รัน gemini-validate · Gate 6E-6 ยังไม่เริ่ม
- รายงาน: `docs/vora-next/phase6/gate6e5b-gemini-validation.md`

