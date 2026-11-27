# VORA NEXT — Phase 6 Architecture (Audit + สถาปัตยกรรมที่ล็อกไว้)

ตรวจจากโค้ดจริงใน `C:\VORA_Robot` 1 พ.ย. 2569 · ไม่มีการแก้ไขไฟล์ใด
ฉบับปรับ 1 พ.ย. 2569 20:15 — ลำดับ Gate ใหม่ (6B Design → 6H Release) · เพิ่มข้อค้นพบด้านความปลอดภัย S1 (ข้อ 3) · ข้อเท็จจริงจาก Audit ในข้อ 1–4 ไม่เปลี่ยน

## 1. สภาพระบบปัจจุบัน

### 1.1 ภาพรวม

```
เบราว์เซอร์ Kiosk (/)  ─┐                         ┌─ PostgreSQL 16 (vora) / SQLite (สำรอง)
มือถือ (/m/)           ├─ FastAPI (uvicorn :8000) ┼─ data/models (โมเดลเจตนา/ภาพ) · data/uploads
หลังบ้าน (/admin/)     ─┘   REST + WebSocket /ws   └─ Robot bridge → simulator | serial | websocket (ESP32)
ธีมเก่า /pastel/ /classic/ (สำเนาแยก ใช้ได้อิสระ)
```

| ส่วน | ขนาด (บรรทัด) | หมายเหตุ |
|---|---|---|
| Backend `app/` | 5,311 | FastAPI · SQLAlchemy 2 · 5 routers (public, admin, auth, robot, reports) |
| AI `app/ai/` | engine 385 · training 197 · retriever 165 · llm 140 · intent 116 · text 52 | ดูข้อ 2 |
| Frontend (ไม่รวม vendor) | ~9,400 | ES modules ไม่มีขั้นตอน build |
| เอกสาร `docs/*.md` | 19 ไฟล์ | |

### 1.2 Dependencies (`backend/requirements.txt`)
fastapi · uvicorn · sqlalchemy · psycopg[binary] · scikit-learn · numpy · **httpx** · PyJWT · python-multipart · websockets · pyserial · edge-tts (ไม่บังคับ) · pytest
Frontend vendor (ในเครื่อง): Chart.js · qrcode.js · MediaPipe (wasm + โมเดล 3 ไฟล์) · ฟอนต์ woff2 (Inter, Kanit, Anuphan, Mitr)
→ **Phase 6B–6D ไม่ต้องเพิ่ม Python package** (ใช้ httpx) · Local AI ต้องติดตั้งโปรแกรมภายนอก (Ollama) ถ้าผู้ใช้เลือก D2

### 1.3 การตั้งค่า (`.env` — ชื่อคีย์เท่านั้น ไม่แสดงค่า)
`VORA_LLM_PROVIDER=none` (ตอนนี้ **ไม่ได้ใช้ LLM** — ตอบจากฐานความรู้อย่างเดียว) · `VORA_LLM_API_KEY` ว่าง · `VORA_TTS_PROVIDER=browser` · `VORA_ROBOT_DRIVER=simulator` · `VORA_SCHEDULER=true` · คีย์อื่น: SCHOOL_CODE, PORT, PUBLIC_URL, ADMIN_USER/PASSWORD, LLM_MODEL/BASE_URL/TIMEOUT, RETRIEVAL_THRESHOLD, TTS_VOICE_TH/EN, ROBOT_*, GREETING_COOLDOWN, IDLE_ATTRACT, MAX_ANNOUNCE_PER_HOUR, DATABASE_URL, TEST_DATABASE_URL

### 1.4 API Contracts (สิ่งที่ห้ามทำให้เสีย)

| กลุ่ม | Endpoint |
|---|---|
| Public `/api` | `GET health` · `GET kiosk/config` · **`POST chat`** · `POST vision/recognized` · `GET vision/model` · `POST greet` · `POST feedback` · `GET news` · `GET news/{id}` · `GET programs` · `GET programs/{id}` · `GET promo/next` · `GET tts` · `POST kiosk/state` · `POST robot/stop` · `GET robot/brief` · `POST interaction` · `GET timeline` · `GET constellation` |
| Admin `/api/admin` (JWT) | system · users · news · programs · knowledge (+stats/approve/import/rebuild/test) · unanswered · feedback · intents (+examples/retrain) · models (+activate) · vision classes/samples/retrain · schedules (+run) · announce · scheduler/toggle · settings · eval cases/run/runs · audit · events · upload |
| Auth `/api/auth` | login · me · change-password |
| Robot `/api/robot` | status · capabilities · command · stop · estop-reset · motion · driver · routes (+run) · sim/* |
| Reports `/api/reports` | overview · conversations · export.csv |
| อื่น | WebSocket `/ws` · `/m` → `/m/` · `/admin` → `/admin/` |

**`POST /api/chat` response (ห้ามลบ/เปลี่ยนชนิดฟิลด์):** `session_id, message_id, text, lang, intent, intent_raw, confidence, intent_top, answered, retrieval_score, sources, media{image,video,cards}, gesture, emotion, robot_action, suggestions, provider, latency_ms` — ผู้ใช้: Kiosk (`app.js`, Journey, Constellation), Mobile, หลังบ้าน (ทดสอบฐานความรู้/ชุดประเมิน)
Phase 6 จะ **เพิ่ม** ฟิลด์ได้เท่านั้น (เสนอ `answer_source`, `notice`) — ดู AI_BRAIN ข้อ 6

### 1.5 Database ที่เกี่ยวกับ AI (ไม่ต้องเปลี่ยน)
`messages.provider` VARCHAR(32) · `messages.sources` JSON · `messages.answered/intent/retrieval_score/latency_ms` · `knowledge` (status approved) · `unanswered` · `model_versions` · `eval_cases/eval_runs` · `settings` (key-value JSON — เก็บค่าตั้ง AI ที่แก้จากหลังบ้านได้โดยไม่ต้อง Migration)

## 2. AI ที่มีอยู่แล้ว (ห้ามสร้างซ้ำ)

| ความสามารถ | ไฟล์ | สถานะ |
|---|---|---|
| ตรวจภาษา th/en | `ai/text.py` | ✅ |
| จำแนกเจตนา (TF-IDF + โมเดล scikit-learn ฝึกเอง 326 ตัวอย่าง, รุ่นโมเดล, เปิดใช้รุ่นได้) | `ai/intent.py`, `ai/training.py` | ✅ |
| ค้นคืนความรู้ (RAG แบบ TF-IDF) จาก FAQ approved + หลักสูตร/ข่าว published · เกณฑ์ความมั่นใจ | `ai/retriever.py` | ✅ |
| เรียบเรียงคำตอบด้วย LLM **ยึด CONTEXT เท่านั้น** (`NO_INFO` ถ้าไม่มีข้อมูล) + แคช 300 รายการ | `ai/engine.py::_compose_with_llm` | ✅ (ปิดอยู่ — provider none) |
| LLM 5 ผู้ให้บริการ: gemini, openai, anthropic, typhoon, ollama · circuit breaker (ล้ม 3 ครั้ง หยุด 60 วิ) · timeout 12 วิ | `ai/llm.py` | ✅ แต่ **ใช้ได้ทีละ 1 ผู้ให้บริการ** |
| สำรองเมื่อ LLM ล่ม → คำตอบจากฐานความรู้ตรง ๆ | `engine.py` | ✅ |
| บันทึกคำถามที่ตอบไม่ได้ · บอกตรง ๆ ว่าไม่มีข้อมูล | `engine.py::log_unanswered` | ✅ |
| บริบทบทสนทนา (สาขาที่กำลังคุย) + `context_program_id` | `engine.py::_ctx` | ✅ (Phase 3 แก้) |
| ชุดประเมินคำตอบ (eval cases/runs) | `training.py::run_evaluation` | ✅ |
| จำป้าย/วัตถุจากกล้อง (MobileNet embedder ในเบราว์เซอร์ + ฝึกจากหลังบ้าน) | `shared/vision.js`, `training.py::retrain_vision` | ✅ |
| ท่าทาง/อารมณ์ตามเจตนา · คำสั่งท่าหุ่นยนต์จากข้อความ | `engine.py` | ✅ |
| เสียงพูด: เบราว์เซอร์ หรือ edge-tts (ออนไลน์) + แคช | `tts.py`, `kiosk/voice.js` | ✅ |
| ฟังเสียง: Web Speech API ของเบราว์เซอร์ | `kiosk/voice.js` | ✅ (**Chrome ส่งเสียงไปประมวลผลที่ Google — ใช้ไม่ได้เมื่อไม่มีอินเทอร์เน็ต**) |

## 3. สิ่งที่ยังขาด

1. **ลำดับสำรองหลายชั้น** online → local → ฐานความรู้ (ตอนนี้ 1 ผู้ให้บริการ + ฐานความรู้)
2. **ตัวจัดเส้นทางคำถาม** แยก "เรื่องวิทยาลัย" (ต้องใช้ฐานความรู้เท่านั้น) / "ความรู้ทั่วไป" / "นอกขอบเขต" — ตอนนี้ทุกคำถามที่ไม่พบในฐานความรู้ตอบว่าไม่มีข้อมูล
3. **ตรวจคำตอบ LLM** ว่าตัวเลข/วันที่/ชื่อมาจาก CONTEXT จริง (ตอนนี้พึ่ง prompt อย่างเดียว)
4. **Web Search** — ไม่มีเลย
5. **หน้าสถานะ AI ในหลังบ้าน** (ผู้ให้บริการไหนใช้งานได้ ทดสอบการเชื่อมต่อ) — มีเพียง `ai` ใน `/api/health`
6. **ฟังเสียงแบบออฟไลน์** — ไม่มี (นอกขอบเขต Phase 6 เสนอเป็นงานต่อ — ต้องเพิ่ม dependency/โมเดล)
7. ตัดข้อมูลส่วนตัว (เบอร์โทร/อีเมล/เลขบัตร) ก่อนส่งข้อความออกนอกเครื่อง

### 3.1 ข้อค้นพบด้านความปลอดภัย (เพิ่ม 20:15 — มีหลักฐาน)

**S1 — API Key ของ Gemini อาจรั่วผ่านข้อความผิดพลาด (ยังไม่เกิดจริง เพราะตอนนี้ `VORA_LLM_PROVIDER=none`)**
- `ai/llm.py` ส่งคีย์ Gemini เป็น query string (`params={"key": ...}`) · เมื่อเรียกไม่สำเร็จ `last_error = f"{type(e).__name__}: {e}"`
- ทดลองกับ httpx (MockTransport ตอบ 400): ข้อความผิดพลาดคือ `HTTPStatusError: Client error '400 Bad Request' for url '…:generateContent?key=TESTKEY123'` — **มีคีย์อยู่ในข้อความ**
- ข้อความนี้ไปที่ (1) `system_events` ผ่าน `record_event` (หลังบ้านเห็น) และ (2) `llm.status()["last_error"]` ซึ่ง **`GET /api/kiosk/config` (สาธารณะ ไม่ต้องเข้าสู่ระบบ) ส่งออกในฟิลด์ `ai`**
- ผู้ให้บริการอื่นส่งคีย์ใน header จึงไม่ปรากฏใน URL แต่ข้อความผิดพลาดจากผู้ให้บริการบางรายอาจสะท้อนเนื้อหาคำขอ — ต้องทดสอบทุกผู้ให้บริการ
- **ต้องแก้ใน Gate 6C ก่อนเปิดใช้ผู้ให้บริการออนไลน์ใด ๆ** (ปิดบังคีย์/URL ในข้อความผิดพลาด · ส่งคีย์ Gemini ทาง header `x-goog-api-key` · `/api/kiosk/config` ไม่ส่ง `last_error`) — การตัดฟิลด์จาก `/api/kiosk/config` กระทบ API contract → ขออนุมัติใน 6C · ตรวจแล้ว (20:20): **ไม่มีหน้าเว็บใดอ่าน `ai` จาก `/api/kiosk/config`** (Kiosk อ่านสถานะ AI จาก `/api/health` ซึ่งมีเฉพาะ `llm_provider`, `llm_circuit_open` ไม่มี `last_error`) · หลังบ้าน (`/api/admin/system`, ต้องเข้าสู่ระบบ) ส่ง `llm.status()` เต็ม รวม `last_error` แม้หน้าเว็บแสดงเฉพาะ provider/model → ต้องปิดบังคีย์ที่ต้นทาง (ใน `llm.py`) ไม่ใช่แค่ซ่อนที่หน้าจอ

## 4. Frontend — สภาพจริง

| หน้าจอ | สไตล์ที่โหลด | Token | ฟอนต์ | ธีม |
|---|---|---|---|---|
| Kiosk `/` | `shared/base.css` **แล้ว** `kiosk.css` ทับ | base 20 + kiosk 22 ตัว (ชื่อซ้ำ ความหมายต่าง) | Kanit + Inter | ดำ-เหลือง |
| Mobile `/m/` | `base.css` + `<style>` ในหน้า 44 บรรทัด | base | Anuphan + Mitr | ขาว-น้ำเงิน blueprint |
| Admin `/admin/` | `base.css` + `admin.css` (ไม่มี token ของตัวเอง 17 สี hard-code) + สีกราฟ hard-code ใน `admin.js` | base | Anuphan + Mitr | กรมท่า-น้ำเงิน |
| `/pastel/`, `/classic/` | สำเนาแยก (app.js, avatar.js, voice.js ของตัวเอง) | pastel 21 ตัว / classic 0 | — | ม่วงพาสเทล / blueprint |
| Avatar | `kiosk/avatar/*` (Adapter + Placeholder SVG + LayeredImageRenderer) · `renderer: "placeholder"` · ภาพ PSD จริงยังไม่ส่งมอบ (มีเฉพาะ `example-layers`) | | | |

ปัญหาที่พบจริง → `VORA_NEXT_PHASE6_DESIGN_SYSTEM.md` ข้อ 2

## 5. สถาปัตยกรรมที่เสนอ (ล็อก)

```
                        ┌──────────── AI Brain (backend/app/ai) ─────────────┐
/api/chat ─► engine.answer ─► intent (เดิม) ─► QueryRouter (6D)
                                         │ institutional ─► retriever (เดิม) ─► ProviderChain.compose(CONTEXT) (6C)
                                         │                                       online ─► local ─► (ล้ม/เกินงบเวลา) ─► คำตอบจากฐานความรู้ (เดิม)
                                         │                                    ─► AnswerGuard (6D): ข้อมูลสำคัญทุกประเภทต้องตรงกับแหล่งที่อนุญาต
                                         │ general ──────► (ถ้าเปิด 6E) WebSearch(โดเมนที่อนุญาต) ─► compose(ผลค้น) + ป้าย "จากอินเทอร์เน็ต" + แหล่งอ้างอิง
                                         │                  (ปิด) ─► ไม่มีข้อมูล + บันทึก unanswered (เดิม)
                                         │ out_of_scope / unsafe ─► ปฏิเสธสุภาพ (เดิม)
                        └────────────────────────────────────────────────────┘
ผลลัพธ์: รูปแบบ /api/chat เดิม + ฟิลด์เพิ่ม answer_source, notice (ไม่บังคับใช้)

                        ┌──────── Unified Design System (frontend/shared) ── 6B ─┐
tokens.css (--vora-*) ─► base.css (alias ชื่อเดิม) ─► kiosk.css / admin.css / mobile
   [data-vora-theme="dark"]  Kiosk                      icons (SVG) ─► ทุกหน้า
   [data-vora-theme="light"] Mobile, Admin              components: ปุ่ม การ์ด ป้าย แท็บ ช่องกรอก QR-card
                        └───────────────────────────────────────────────────────┘
เสียง (6G): ฟัง = Web Speech API ของเบราว์เซอร์ (ต้องใช้อินเทอร์เน็ตบน Chrome — ไม่มี STT ออฟไลน์ใน Phase 6)
            พูด = speechSynthesis ของเบราว์เซอร์ / edge-tts (ออนไลน์) — เดิม
```

**ข้อแยกชัดเรื่องออฟไลน์:**

| ความสามารถ | ไม่มีอินเทอร์เน็ต | เงื่อนไข |
|---|---|---|
| ตอบจากฐานความรู้ (Offline Knowledge Base) | ✅ ทำงาน (ระบบเดิม) | — |
| Local AI (Offline AI) | ✅ เฉพาะเมื่อติดตั้ง Ollama + โมเดลบนเครื่องเดียวกัน (D2) | ไม่ติดตั้ง = ตกไปฐานความรู้ |
| Online AI / Web Search | ❌ | ตกไป Local AI หรือฐานความรู้ |
| ฟังเสียง (Speech Recognition) | ❌ **ไม่ทำงาน** (Chrome ส่งเสียงไปประมวลผลที่ Google) | ไม่มี STT ออฟไลน์ใน Phase 6 — ต้องแจ้งบนจอและให้พิมพ์แทน |
| พูด (TTS) | ⚠️ ขึ้นกับเสียงที่ติดตั้งในเครื่อง (`speechSynthesis` local voices) · edge-tts ใช้ไม่ได้ | ต้องตรวจบนเครื่องจริง (6G/6H) |

รายละเอียด: AI → `VORA_NEXT_PHASE6_AI_BRAIN.md` · Design → `VORA_NEXT_PHASE6_DESIGN_SYSTEM.md` · การทดสอบและเกณฑ์ผ่าน → `VORA_NEXT_PHASE6_TEST_PLAN.md`

## 6. Gate และไฟล์ที่ได้รับผลกระทบ (ลำดับล่าสุด)

ทุก Gate: Backup ไฟล์ที่จะแก้ไปที่ `_backups/before-changes/<YYYY-MM-DD_HHMM>_<gate>/` + `MANIFEST.md5` (ตรวจ md5 ครบ และเทียบกับไฟล์ในเครื่องก่อนแก้) · ไฟล์ใหม่บันทึกรายชื่อใน CHANGELOG · **ไม่มี Gate ใดแก้ Database/Schema** · Rollback = คัดลอกไฟล์จาก Backup กลับ + ลบไฟล์ใหม่ตามรายชื่อ + รัน `test.bat` ยืนยัน Baseline

| Gate | ขอบเขต | ไฟล์ที่แก้ | ไฟล์ใหม่ | ต้องขออนุมัติเพิ่ม | ขึ้นกับ |
|---|---|---|---|---|---|
| **6B** Unified Design Foundation | token `--vora-*` · ฟอนต์ · ชุดไอคอน SVG · คอมโพเนนต์พื้นฐาน · base.css เป็น alias · **ไม่เปลี่ยนหน้าตาเดิม** | `frontend/shared/base.css` | `shared/tokens.css`, `shared/components.css`, `shared/icons.js` | D5 D6 D7 D9 | 6A |
| **6C** AI Provider Foundation | ProviderChain online → local · circuit breaker ต่อผู้ให้บริการ · งบเวลารวม · แก้ S1 (ปิดบังคีย์ในข้อความผิดพลาด) · ค่า `.env` เดิมได้ผลเดิม | `backend/app/ai/llm.py`, `backend/app/config.py`, `.env.example` · (`routers/public.py` เฉพาะตัด `last_error` จาก `/api/kiosk/config` ถ้าอนุมัติ) | `backend/tests/test_ai_chain.py`, `test_ai_privacy.py` | D1 D2 D4 D13 · การเปลี่ยน `/api/kiosk/config` | 6A |
| **6D** AI Orchestrator & Answer Guard | QueryRouter (institutional/general/out_of_scope/unsafe) · AnswerGuard ตรวจข้อมูลสำคัญกับแหล่งที่อนุญาต · ตัดข้อมูลส่วนตัวก่อนส่งออก · `answer_source`/`notice` · หน้าสถานะ AI + ทดสอบการเชื่อมต่อ (admin) | `backend/app/ai/engine.py` (จุดเรียก LLM + router), `backend/app/routers/admin.py` (+2 endpoint) | `ai/router.py`, `ai/guard.py`, `tests/test_ai_router.py`, `tests/test_answer_guard.py`, `tests/test_ai_admin.py` | **`ai/engine.py`** (Phase 0 กำหนดห้ามแตะโดยไม่ขออนุมัติ) | 6C |
| **6E** Web Search & Grounding | ค้นเว็บเฉพาะ general · โดเมนที่อนุญาต · ผลค้นเป็นข้อมูลอ้างอิงไม่ใช่คำสั่ง · ป้าย + แหล่งอ้างอิง · ปิดเป็นค่าเริ่มต้น | `ai/engine.py` (เส้นทาง general), `config.py` | `ai/websearch.py`, `tests/test_websearch.py` | D3 D4 · API Key ผู้ให้บริการค้นหา | 6D |
| **6F** Mobile & Admin Integration | Mobile/Admin ใช้ Design System · แก้ P1 P3 P4 P5 P8 P9 · หน้าสถานะ AI ในหลังบ้าน (UI) · แสดง `notice` บนมือถือ · QR E2–E4 ถ้าอนุมัติ | `frontend/mobile/index.html`, `frontend/admin/admin.css`, `admin.js`, `admin/index.html` · (`backend/app/main.py` เฉพาะ `/m` redirect ถ้าอนุมัติ D12) | — | `frontend/admin/*` (Phase 0) · D12 | 6B, 6D |
| **6G** Kiosk, Avatar & Voice Integration | Kiosk ใช้ Design System · emoji → SVG · ป้าย QR · แสดง `notice` + พูดป้าย · สถานะเสียงเมื่อไม่มีอินเทอร์เน็ต (ฟังไม่ได้ → แจ้ง + ให้พิมพ์) · จอแนวตั้ง P7 ถ้าอนุมัติ · ไม่แก้ Avatar Adapter (ใช้สถานะเดิม) | `frontend/kiosk/kiosk.css`, `index.html`, `app.js`, `voice.js`, `experience/*View.js` | — | D10 · `/pastel/`, `/classic/` ไม่แตะ (D8) | 6B, 6D |
| **6H** Full Integration & Release Validation | Regression ครบ · Windows + โทรศัพท์จริง + ตัดอินเทอร์เน็ต · ตรวจความเป็นส่วนตัว/คีย์ทั้งระบบ · รายงาน | เอกสาร | `docs/VORA_NEXT_PHASE6_REPORT.md` | — | 6B–6G |

**ไม่เปลี่ยนใน Phase 6:** Database schema · `models.py` · `robot/*` · `firmware/*` · `security.py` · `routers/auth.py` · Avatar Adapter/Renderer · `/pastel/`, `/classic/` · API เดิม (เพิ่มฟิลด์ได้อย่างเดียว ยกเว้นการตัด `last_error` สาธารณะซึ่งต้องอนุมัติ)

## 7. ความเสี่ยงและข้อจำกัด

| ความเสี่ยง | ผลกระทบ | การรับมือ | Gate |
|---|---|---|---|
| **S1 คีย์ Gemini รั่วผ่าน `last_error` ใน `/api/kiosk/config` และ `system_events`** | คีย์ถูกขโมย/ค่าใช้จ่าย | แก้ก่อนเปิดผู้ให้บริการออนไลน์ · Privacy tests (TEST_PLAN ข้อ 4) | 6C |
| ไม่มี Git | ย้อนกลับได้เฉพาะจาก Backup ทีละไฟล์ | Backup + MANIFEST ทุก Gate · D11 | ทุก Gate |
| แตะ `engine.py` (หัวใจการตอบ) | คำตอบเดิมเปลี่ยน | ปิดฟีเจอร์ใหม่ = พฤติกรรมเดิม · test_ai 16 + eval cases 20 ต้องไม่ลด | 6D 6E |
| AI แต่งข้อมูลวิทยาลัย (ชื่อ สาขา สถานที่ วันที่ ตัวเลข ติดต่อ) | ข้อมูลผิดถึงผู้เข้าชม | AnswerGuard ตรวจทุกประเภทกับแหล่งที่อนุญาต ไม่ใช่เฉพาะตัวเลข/วันที่ | 6D |
| ข้อจำกัดของ Guard: ค่าที่ "อยู่ใน CONTEXT แต่ผูกผิดเรื่อง" (เช่นค่าเทอมของสาขา A ไปตอบสาขา B ที่อยู่ใน CONTEXT เดียวกัน) | ตรวจด้วยการจับคู่ค่าอย่างเดียวไม่ได้ | จำกัด CONTEXT ให้แคบ (เฉพาะรายการที่ค้นได้) · มีกรณีทดสอบระบุพฤติกรรมชัด · ถ้าไม่มั่นใจใช้คำตอบฐานความรู้ตรง ๆ | 6D |
| Web search ผิด/ไม่เหมาะกับเด็ก/prompt injection | ความน่าเชื่อถือ | ปิดเป็นค่าเริ่มต้น · โดเมนที่อนุญาต · ป้าย · ไม่ใช้กับคำถามวิทยาลัย | 6E |
| ข้อมูลส่วนบุคคลออกนอกเครื่อง / อยู่ใน log (PDPA) | ความเป็นส่วนตัว | D4 · ตัดก่อนส่ง · log ไม่เก็บข้อความที่ส่งไปผู้ให้บริการ | 6C 6D |
| Local AI ช้าบนเครื่องไม่มี GPU | รอนาน | งบเวลา D13 · ข้ามไปฐานความรู้ | 6C |
| ค่าใช้จ่าย/โควตา API | ใช้งานไม่ได้กลางงาน | circuit breaker ต่อผู้ให้บริการ · จำกัดครั้ง/ชม. · แคช | 6C |
| อินเทอร์เน็ตในงานจริงไม่เสถียร | ฟังเสียง/AI ออนไลน์ใช้ไม่ได้ | ฐานความรู้ทำงานเสมอ · ฟังเสียง **ใช้ไม่ได้ออฟไลน์** → แจ้ง + พิมพ์ · STT ออฟไลน์เป็นงานนอก Phase 6 | 6G |
| เปลี่ยน CSS แล้วชุดทดสอบเบราว์เซอร์ล้ม | Regression | 6B ไม่เปลี่ยนหน้าตา (pixel diff) · เปลี่ยนทีละหน้าจอ | 6B 6F 6G |
| ชื่อตัวแปร CSS ซ้ำความหมายต่าง (`--glow`, `--surface`, `--line`) | สไตล์พังเมื่อใช้คอมโพเนนต์ร่วม | namespace `--vora-*` | 6B |
| ยังไม่มีภาพ PSD อวตารจริง | Design อวตารยังไม่ final | ไม่ผูกกับอวตาร (ผ่าน Adapter เดิม) | 6G |
