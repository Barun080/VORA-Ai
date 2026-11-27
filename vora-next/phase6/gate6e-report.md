# Gate 6E — Batch Implementation Report (6E-1 · 6E-2 · 6E-3 · 6E-4)

วันที่: 5 พ.ย. 2569 (Asia/Bangkok) · สถานะ: **Implementation + automated tests + regression ผ่าน (Linux)** · Windows `test.bat` รอผู้ใช้รัน
ความหมายของ PASS: ผ่านด้วยผู้ให้บริการจำลอง (httpx MockTransport) + regression เท่านั้น — **ไม่ใช่การยืนยันผู้ให้บริการจริง**

## ขอบเขตที่ทำ
| งาน | สถานะ | สรุป |
|---|---|---|
| 6E-3 Privacy Boundary | ✅ | FAQ title ผ่าน `redact_pii` ก่อนเข้า CONTEXT (เฉพาะ `doc.type == "faq"`) · payload ขาออกผ่าน `redact_secrets` · pipeline error เก็บเพียง `text_len` + `text_sha256[:16]` |
| 6E-1 Provider Hardening | ✅ | `ProviderResult(text, finish)` · finish ∈ stop/length/safety/empty/other · finish ≠ stop → `LLMUnusable` (ไม่แตะ breaker · ไม่ส่งต่อ fallback) → engine ใช้ KB ตรง · deadline ร่วมต่อคำขอ (8 วิ) รวมเวลารอคิว · concurrency 4 · ข้อความว่างไม่ใช่ NO_INFO |
| 6E-2 Answer Contract | ✅ | `answer_source` / `verification` / `notice` คำนวณจาก branch จริง · ส่งออกเฉพาะ header `X-VORA-Contract: 2` · ไม่มี header = 18 / 13 ฟิลด์เดิม |
| 6E-4 F1 / F1b | ✅ | สิทธิ์ kiosk = IP ใน `VORA_KIOSK_TRUSTED_HOSTS` (ค่าเริ่มต้น `127.0.0.1,::1`) · `/api/chat` ไม่เชื่อ `channel` · `/api/greet`, `/api/vision/recognized` → 403 · `/ws?role=kiosk` → close 4403 · `/api/robot/stop` คงเดิม · rollback `VORA_CHANNEL_TRUST=legacy` |
| Cost guard | ⬜ นอกขอบเขต | ตามคำสั่ง (ทำหลัง Bake-off) |

## ไฟล์ที่เปลี่ยน (md5 12 ตัวแรก)
| ไฟล์ | ก่อน → หลัง |
|---|---|
| `backend/app/ai/llm.py` | `873f704279b8` → `1b3e50ddcc37` |
| `backend/app/ai/engine.py` | `22db956064ac` → `fffff38a9290` |
| `backend/app/config.py` | `31e969ddd7e0` → `c24e8d4b4134` |
| `backend/app/routers/public.py` | `1ce03cdb6bc2` → `4b5b5d838bb2` |
| `backend/app/main.py` | `27dbc3caa7a2` → `8b6446092344` (เฉพาะ `/ws` role kiosk) |
| `.env.example` | `4ae1eca49b57` → `153e65ea0072` |
| `backend/tests/conftest.py` | `7bbe445102f5` → `16f61f8e7b51` (env `VORA_KIOSK_TRUSTED_HOSTS` เท่านั้น) |
| `backend/tests/gate6d_snapshot.py` | `b30cc2fedceb` → `23959927640b` (env เท่านั้น · คำถาม 60 ข้อ/การเทียบไม่เปลี่ยน) |
| `backend/tests/test_chat_contract.py` | `b1bada1fb60c` → `6ece80aaa999` (C-NEW: จาก skip เป็นทดสอบจริง · assertion C-OLD ไม่เปลี่ยน) |
| ใหม่ `backend/tests/test_ai_hardening.py` | `9b0cfafe82fe` (62) |
| ใหม่ `backend/tests/test_ai_privacy_boundary.py` | `5338959424ab` (11) |
| ใหม่ `backend/tests/test_answer_contract_v2.py` | `72e2985d4c27` (51) |
| ใหม่ `backend/tests/test_channel_trust.py` | `1e4d5fe272d2` (25) |

ไม่แตะ: `.env` จริง · `frontend/**` (รวม `/pastel/`, `/classic/`) · `robot/**` · `firmware/**` · `models.py` / schema / migration · `ai/router.py` · `ai/guard.py` · `ai/retriever.py` · ข้อความ D6D-7c · `gate6d_baseline_60.json` · `scripts/bakeoff_6e0*` · requirements

## ผลทดสอบ
| ชุด | ผล |
|---|---|
| Targeted (ใหม่) | 149/149 (hardening 62 · privacy 11 · contract 51 · channel 25) |
| pytest SQLite / Linux (Python 3.13) | **793 passed, 0 skipped** (= 643 + C-NEW ที่เคย skip + 149 ใหม่) |
| pytest PostgreSQL 16 / Linux | **793 passed, 0 skipped** |
| Baseline 60 (C-OLD-5) | ตรงเดิมทุกข้อ · Eval 20/20 (C-OLD-7) |
| Browser regression | **150/150** — Kiosk 25 · Idle 26 · Gate 1 38 · Gate 2 21 (รอบแรก 20/21 ข้อ 10 Presence Session — จังหวะเวลาฝั่งหน้าจอ, `/api/greet` ตอบ 200 ทุกครั้ง · รันซ้ำ 21/21) · Gate 3 15 · 4 14 · 5 11 |
| Gate 6B | 11/11 |
| Bake-off harness selftest (offline) | SELFTEST OK (harness ไม่ถูกแก้) |
| Windows `test.bat` | ⏳ รอผู้ใช้รัน (คาด 793 passed / 0 skipped) |

ตรวจว่าเทสต์จับข้อบกพร่องได้จริง (mutation): ถอด redaction ของ title · ใช้ `body.channel` สั่งท่า · นับ unusable เป็น failure · ถอด deadline ร่วม · ถอดการตรวจ `/ws` · log คำถามดิบ → เทสต์ใหม่ล้ม 30 กรณีตรงจุด แล้วคืนโค้ดที่ถูกต้อง

## Security (F1 / F1b) — ก่อน → หลัง
| ช่องทาง | ก่อน | หลัง |
|---|---|---|
| `/api/chat` + `channel:"kiosk"` จากมือถือ/LAN | ข้าม rate limit · สั่งท่าหุ่นยนต์ · บันทึกเป็น kiosk | rate limit 30/นาที · ไม่สั่งท่า · บันทึกเป็น mobile |
| `X-Forwarded-For: 127.0.0.1` | — | ไม่มีผล (ไม่อ่าน header นี้) |
| `/api/greet` จาก LAN | สั่ง wave ได้ ไม่จำกัด | 403 |
| `/api/vision/recognized` จาก LAN | สั่ง present ได้ ไม่จำกัด | 403 |
| `/ws?role=kiosk` (หรือไม่ระบุ role) จาก LAN | รับคำสั่งพูด/ส่งสถานะหน้าจอได้ | close 4403 · `role=mobile` ยังใช้ได้ |
| `/api/robot/stop` | เปิดเสมอ | เปิดเสมอ (ไม่เปลี่ยน) |
| Kiosk บน localhost | — | เหมือนเดิมทุกอย่าง (Browser 150/150) |

## Privacy
- FAQ ที่สร้างจากคำถามที่ตอบไม่ได้: เบอร์/อีเมล/เลขบัตรของผู้ใช้ใน title ไม่ไปถึงผู้ให้บริการ · ข้อมูลในฐานข้อมูลและ flow การอนุมัติไม่เปลี่ยน
- ข้อมูลติดต่อทางการใน answer / ข่าว / สาขา ยังส่งครบ
- คีย์ที่ตั้งไว้ · `sk-…` · `AIza…` · `Bearer …` ในข้อความผู้ใช้ → `[REDACTED]` ก่อนส่ง
- pipeline exception: `system_events` และ log ไม่มีคำถามดิบ
- payload ขาออกไม่มี session id / IP / ข้อมูลบัญชีเจ้าหน้าที่

## AI provider / Gemini
- No real API call · No API key used · `.env` ไม่ถูกแก้ (`VORA_LLM_PROVIDER=none`)
- Production Gemini model was NOT changed based on guess (`DEFAULT_MODELS["gemini"]` ยังเป็นค่าเดิม — ทดสอบตรึงไว้)
- Thinking configuration was NOT promoted to production (request body ของ Gemini ไม่มี thinkingConfig — ทดสอบตรึงไว้)

## ข้อสังเกต
- ตามการตรวจโค้ด: routing ปัจจุบันไม่มีคำขอที่เรียกทั้ง compose และ general ในคำถามเดียว (compose เกิดเมื่อ retrieval ผ่านเกณฑ์ → route = institutional) · deadline ร่วมยังบังคับไว้และทดสอบด้วยการเรียกต่อกันในคำขอเดียว
- `.env` จริงมี `VORA_LLM_TIMEOUT=12` (ค่าจากตัวอย่างเดิม) → เมื่อเปิด provider timeout หลัก = 12 แต่ถูกจำกัดด้วยงบรวม 8 วิ (ไม่มี `VORA_AI_BUDGET_S` ใน `.env` → ใช้ค่าเริ่มต้นใหม่ 8) · ปรับเป็น 4 ได้เมื่อเจ้าของโครงการอนุมัติแก้ `.env`
- `/api/kiosk/state` และ `/api/interaction` ยังไม่จำกัดตาม trusted host (ไม่ได้สั่งหุ่นยนต์ · อยู่นอกรายการ F1b ที่สั่ง)
- Bake-off: harness ตั้ง `VORA_AI_BUDGET_S=0` เอง จึงไม่ถูกงบ 8 วิตัด · คำตอบที่ถูกบล็อก/ตัดตอนนี้จะลงเอยเป็นคำตอบ KB (ไม่ใช่ no_info) — harness บันทึก finish reason ดิบไว้แล้ว

## Rollback
- คืนไฟล์จาก `_backups/before-changes/2026-11-05_2020_before-gate6e-batch/` แล้วตรวจ `MANIFEST.md5` · ลบ 4 ไฟล์ทดสอบใหม่
- ทางลัดไม่ต้องคืนโค้ด: provider = none (ค่าปัจจุบัน) → path 6E-1/6E-3 ไม่ทำงาน · ไม่ส่ง header v2 → contract เดิม · `VORA_CHANNEL_TRUST=legacy` → F1 กลับเป็นพฤติกรรมเดิม (ไม่ปลอดภัย ใช้ชั่วคราว)

## งานที่ยังเหลือจริง
1. Windows `test.bat` (ผู้ใช้)
2. Bake-off 6E-0 (ต้องมีคีย์) → เลือก provider หลัก/สำรอง → เลือกโมเดล Gemini production + thinking config
3. Cost guard ($1/วัน · $15/เดือน · token accounting)
4. Frontend ใช้ contract v2 (6F/6G)
5. Retrieval (ห้องสมุด → ห้องน้ำ) · Guard ปฏิเสธคำตอบ "ไม่พบสาขา X"
6. `/ws` admin ตรวจเฉพาะลายเซ็น token ไม่ตรวจ role (นอกขอบเขตนี้)

---

# Gate 6E-5A — No-API Preflight (6 พ.ย. 2569)

```text
Gate 6E-5A: PASS
Mode: No-API Preflight
Real Provider Calls: 0
Gemini API: NOT CALLED
Anthropic API: NOT CALLED
External Network Provider Calls: 0
```

ไม่ได้ประเมินคุณภาพของ Gemini หรือผู้ให้บริการใด และ **ยังไม่ได้เลือก production provider** — ต้องรอ Gate 6E-5B (Real Provider Bake-off)

## สิ่งที่ตรวจ (ด้วย MockTransport / ตัวกันเครือข่ายเท่านั้น)
| หมวด | ผล |
|---|---|
| ตัวกันเครือข่าย (socket + httpx transport จริง) | จับได้จริง: Gemini + คีย์ปลอม + ไม่มี mock → ถูกบล็อก 1 ครั้ง → ตอบจากฐานความรู้ · `provider=none`: 60 คำถาม baseline + v2 + unsafe → **0** การเชื่อมต่อออก |
| Gemini adapter (24 กรณี) | ปกติ · ไม่มีฟิลด์ finish · ว่าง (3 แบบ) · บล็อก (finish SAFETY / promptFeedback / RECITATION) · MAX_TOKENS · finish ไม่รู้จัก · thought-only · HTTP 400/401/403/404/429/500/503 · ไม่ใช่ JSON · JSON list · candidate/content ผิดรูป · parts=None · ConnectError → ทุกกรณีเป็น ok / `LLMUnusable` (ไม่แตะ breaker) / `LLMError` (breaker นับ) อย่างใดอย่างหนึ่ง · 1 คำขอต่อกรณี ไม่ retry · ข้อความผิดพลาดไม่มีคีย์ |
| Gemini request | คีย์อยู่ใน `x-goog-api-key` เท่านั้น (ไม่อยู่ใน URL/body) · body = systemInstruction/contents/generationConfig · ไม่มี thinkingConfig · โมเดลค่าเริ่มต้นไม่เปลี่ยน |
| Provider config | override โมเดลหลัก/สำรอง · Gemini→Anthropic และ Anthropic→Gemini · Gemini ถูกบล็อก → ไม่ถาม fallback · breaker เปิด → ไม่ส่งคำขอ · 503 → ตอบจาก KB · Anthropic adapter รูปแบบเดิม |
| Deadline (ค่าเริ่มต้นจริง 8/4/8/4) | primary ถูกตัดที่ ≈4 วิ · fallback ได้เวลาที่เหลือ · รวม ≈8 วิ (ไม่ใช่ 4+8) |
| Safety | unsafe / injection / unsafe + คำถามสถานศึกษา → retrieval 0 · provider 0 · `answer_source=refusal` · ไม่มี robot action |
| Malicious Knowledge | เนื้อหาอยู่ในบล็อก CONTEXT เท่านั้น ไม่เข้า systemInstruction · ตัวคั่นในฐานความรู้ถูก escape |
| Guard reject | ตัวเลข/เบอร์ที่ไม่มีใน CONTEXT → ตอบจาก KB (`knowledge_base` / `knowledge_verified`) |
| Bake-off harness | ค่าตั้ง 3 configs · 90 cases (id ไม่ซ้ำ) · 5 kb_injections มี marker · กติกาตัดสิน · ตัวสแกนคีย์ลบไฟล์และหยุด · `selftest` เต็ม: **SELFTEST OK** (router_block 20/20 · error 0) |

## ข้อจำกัดที่ทราบ (ไม่ใช่ regression · ไม่แก้ Guard ตามขอบเขต)
- ถ้าฐานความรู้ **ที่อนุมัติแล้ว** มีคำสั่งแฝง และโมเดลทำตามโดยพิมพ์ข้อความที่อยู่ใน CONTEXT → Guard (ตรวจ grounding) ไม่ปฏิเสธ · ป้องกันด้วยการอนุมัติโดยเจ้าหน้าที่ · วัดจริงใน Bake-off กรณี INJ-KB-1..5

## ผลทดสอบ 6E-5A
| ชุด | ผล |
|---|---|
| ใหม่ `test_gate6e5a_preflight.py` | 45 passed · 1 skipped (ตรวจ `.env` — ไม่มี `.env` ในเครื่องทดสอบ Linux · บน Windows จะรันจริง) |
| pytest SQLite / Linux | **838 passed, 1 skipped** (793 เดิม + 45) |
| pytest PostgreSQL 16 / Linux | **838 passed, 1 skipped** |
| Baseline 60 · Eval 20 | ผ่าน |
| Browser | **150/150** (รอบแรก) |
| Gate 6B | 11/11 |
| Bake-off selftest | SELFTEST OK |
| Windows `test.bat` | ⏳ รอผู้ใช้ (คาด 839 passed / 0 skipped) |

ไฟล์ที่เปลี่ยน: ใหม่ `backend/tests/test_gate6e5a_preflight.py` (+ เอกสาร) เท่านั้น · โค้ดระบบไม่เปลี่ยน
Backup: `_backups/before-changes/2026-11-06_1030_before-gate6e5a/` · หลักฐาน: `docs/vora-next/phase6/gate6e5a-*`

ขั้นถัดไป: **Gate 6E-5B — Real Provider Bake-off** (ต้องมีคีย์ + อนุมัติค่าใช้จ่าย) · ยังไม่ได้เลือก Gemini เป็น production provider

