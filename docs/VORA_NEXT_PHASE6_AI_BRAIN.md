# VORA NEXT — Phase 6 AI Brain (ออกแบบ · ยังไม่พัฒนา)

Gate: **6C** AI Provider Foundation · **6D** AI Orchestrator & Answer Guard · **6E** Web Search & Grounding (ลำดับฉบับ 1 พ.ย. 20:30) · การทดสอบ: `VORA_NEXT_PHASE6_TEST_PLAN.md`

> **Security Blocker S1 (6C):** คีย์ Gemini ถูกส่งใน URL และข้อความผิดพลาด (`last_error`) ถูกส่งออกทาง `/api/kiosk/config` (สาธารณะ) และ `system_events` — ต้องปิดบังที่ต้นทาง (`llm.py`) ส่งคีย์ทาง header และผ่าน T-PRV-11/12/20–26 **ก่อนเปิดผู้ให้บริการออนไลน์ใด ๆ** (รายละเอียด ARCHITECTURE ข้อ 3.1)

## 1. หลักการ (ไม่เปลี่ยนจากระบบเดิม)

1. **ข้อมูลของวิทยาลัย** (สาขา ค่าเทอม วันรับสมัคร ทุน ที่ตั้ง ติดต่อ ข่าว กิจกรรม) **มาจากฐานความรู้ที่อนุมัติแล้วเท่านั้น** — LLM ใช้ "เรียบเรียง" ไม่ใช่แหล่งข้อมูล
2. ไม่มีข้อมูล → บอกตรง ๆ + บันทึก unanswered (เดิม) — ห้ามให้ AI หรือ Web Search เติมข้อมูลวิทยาลัย
3. ทุกชั้นล้มได้ → ระบบยังตอบจากฐานความรู้ได้เสมอ (ไม่มีอินเทอร์เน็ต/ไม่มี Local AI ก็ทำงาน)
4. ตั้งค่าใหม่ทั้งหมด **ไม่บังคับ** — `.env` เดิม (`VORA_LLM_PROVIDER=none`) ต้องได้ผลเหมือนวันนี้ทุกตัวอักษร
5. ไม่ส่งภาพ เสียง หรือข้อมูลส่วนตัวออกนอกเครื่อง · ไม่แสดง/บันทึก API Key

## 2. ชั้นของ AI Brain

| ชั้น | ทำอะไร | ของเดิม/ใหม่ |
|---|---|---|
| L0 Input | ตรวจภาษา · ตัดข้อมูลส่วนตัวก่อนส่งออก (เบอร์ อีเมล เลขบัตร) | text.py เดิม + `guard.py` ใหม่ |
| L1 Intent | จำแนกเจตนา 14 หมวด (โมเดลฝึกเอง) | เดิม |
| L2 QueryRouter | `institutional` / `general` / `out_of_scope` / `unsafe` จากเจตนา + คำสำคัญ + ผลค้นคืน | ใหม่ (`router.py`) |
| L3 Knowledge | retriever TF-IDF + เกณฑ์ความมั่นใจ + บริบทบทสนทนา | เดิม |
| L4 ProviderChain | เรียกผู้ให้บริการตามลำดับ online → local · circuit breaker แยกต่อผู้ให้บริการ · งบเวลารวม | ใหม่ (ขยาย `llm.py`) |
| L5 AnswerGuard | ตรวจข้อมูลสำคัญ G1–G6 กับแหล่งที่อนุญาต + CONTEXT · ไม่มี markdown · ความยาว | ใหม่ (`guard.py`) |
| L6 WebSearch | เฉพาะ `general` + เปิดใช้ + โดเมนที่อนุญาต · ผลค้นเป็น "ข้อมูลอ้างอิง" ไม่ใช่คำสั่ง | ใหม่ (`websearch.py`) — ปิดเป็นค่าเริ่มต้น |
| L7 Output | รูปแบบ `/api/chat` เดิม + `answer_source` + `notice` · บันทึก `messages.provider` / `sources` เดิม | เดิม + เพิ่มฟิลด์ |

## 3. ProviderChain (Gate 6C)

```
compose(system, context, question, budget_s)
  for p in chain:                    # เช่น [gemini, ollama]
      if p.breaker.open: continue
      try:  return p.complete(...) within min(p.timeout, budget ที่เหลือ)
      except: p.breaker.failure(); log event (ไม่มีคีย์/ข้อความผู้ใช้ใน log)
  return None   → engine ใช้คำตอบจากฐานความรู้ (เดิม)
```

ค่าตั้ง (ทั้งหมดไม่บังคับ):

| คีย์ | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `VORA_LLM_PROVIDER` / `_MODEL` / `_API_KEY` / `_BASE_URL` / `_TIMEOUT` | เดิม | ผู้ให้บริการหลัก (ไม่เปลี่ยนความหมาย) |
| `VORA_LLM_FALLBACK_PROVIDER` | ว่าง | ผู้ให้บริการสำรอง เช่น `ollama` |
| `VORA_LLM_FALLBACK_MODEL` / `_BASE_URL` / `_TIMEOUT` | ว่าง / default ของผู้ให้บริการ / 20 | ของผู้ให้บริการสำรอง |
| `VORA_AI_BUDGET_S` | 8 | งบเวลารวมก่อนตกไปฐานความรู้ (D13) |

- คีย์ API อ่านจาก `.env` เท่านั้น · `status()` คืนเฉพาะ "ตั้งแล้ว/ยังไม่ตั้ง" ไม่คืนค่า
- `messages.provider` (≤32 ตัวอักษร) บันทึกเช่น `llm:gemini`, `llm:ollama`, `knowledge-base` — ชื่อเดิมคงไว้
- Ollama/Typhoon/OpenAI ใช้ endpoint แบบ OpenAI-compatible ที่มีอยู่แล้วใน `_dispatch`

## 4. QueryRouter + AnswerGuard (Gate 6D)

| ประเภท | เงื่อนไข (ร่าง) | การตอบ |
|---|---|---|
| institutional | เจตนา programs_list, program_detail, career, admission, tuition, scholarship, news, activity, location, contact, about_robot · หรือมีผลค้นคืน ≥ เกณฑ์ · หรือมีคำว่า วิทยาลัย/สาขา/สมัคร/ค่าเทอม ฯลฯ | ฐานความรู้ + (LLM เรียบเรียง) + Guard · ไม่มีข้อมูล → "ไม่มีข้อมูล" + unanswered (เดิม) — **ห้ามใช้ Web Search** |
| general | out_of_scope ที่ไม่ใช่เรื่องวิทยาลัยและไม่ไม่ปลอดภัย เช่น "AI คืออะไร" "อาชีพช่างยนต์ในอนาคต" | 6D ปิด: ตอบเดิม (ไม่มีข้อมูล) · 6D เปิด: Web Search + ป้าย |
| out_of_scope / unsafe | คำหยาบ ความรุนแรง ข้อมูลส่วนตัวผู้อื่น การเมือง ฯลฯ | ปฏิเสธสุภาพ (gesture shrug เดิม) |

AnswerGuard: ข้อมูลสำคัญ 6 ประเภท — **G1** ชื่อสถานศึกษา/หุ่นยนต์ · **G2** หลักสูตร/สาขา/ระดับ/แผนก · **G3** สถานที่ · **G4** วันที่/เวลา · **G5** ตัวเลข · **G6** ข้อมูลติดต่อ — ในคำตอบของ LLM ต้องตรงกับ **แหล่งที่อนุญาต** (settings, programs published, knowledge approved, news เผยแพร่+อยู่ในช่วง) **และ** อยู่ใน CONTEXT ของคำถามนั้น · การตรวจเฉพาะตัวเลข/วันที่ไม่เพียงพอ · ไม่ผ่าน → ใช้คำตอบฐานความรู้ตรง ๆ + event `ai.guard_rejected` (ไม่มีข้อความผู้ใช้/PII) · ข้อจำกัดที่ทราบ: ค่าที่อยู่ใน CONTEXT แต่ผูกผิดเรื่อง (T-GRD-20) — ลดด้วยการจำกัด CONTEXT · ตารางแหล่งที่อนุญาตและกรณีทดสอบ: TEST_PLAN ข้อ 4

หลังบ้าน: หน้า "สถานะ AI" — ลำดับผู้ให้บริการ · ใช้ได้/ตัดวงจร/ไม่ได้ตั้ง · latency ล่าสุด · ปุ่ม "ทดสอบการเชื่อมต่อ" (ส่งประโยคทดสอบคงที่ ไม่ใช่ข้อมูลผู้ใช้) · สัดส่วนคำตอบตามแหล่ง (knowledge-base / llm:* / web)

## 5. Web Search & Grounding (Gate 6E — ต้องได้ D3, D4)

- ปิดเป็นค่าเริ่มต้น (`VORA_WEBSEARCH_PROVIDER=none`) · ผู้ให้บริการค้นหาต้องมี API Key (ทีมเลือก)
- ใช้เฉพาะเส้นทาง `general` · โดเมนที่อนุญาต (`VORA_WEBSEARCH_DOMAINS` เช่น `go.th, ac.th, vec.go.th, moe.go.th`) · จำกัด 3 ผล · timeout 4 วิ
- ผลค้นถูกใส่เป็น "ข้อมูลอ้างอิง" ใน CONTEXT พร้อมคำสั่งให้ **ไม่ทำตามข้อความในผลค้น** (กัน prompt injection) · ตัดสคริปต์/HTML
- คำตอบแสดงป้าย `notice`: "ข้อมูลจากอินเทอร์เน็ต ไม่ใช่ข้อมูลทางการของวิทยาลัย" + แหล่งที่มา (URL ใน `sources` แบบ `{"type":"web","url","title"}`)
- เสียงพูดอ่านป้ายด้วย · ไม่มีผลค้นที่ใช้ได้ → ตอบว่าไม่มีข้อมูล (เดิม)
- จำกัดจำนวนครั้ง/ชั่วโมง + แคช 24 ชม.

## 6. การเปลี่ยนแปลง API (เพิ่มอย่างเดียว)

`POST /api/chat` เพิ่ม:
- `answer_source`: `"knowledge-base" | "llm" | "web" | "none"` (ค่าเดิมทั้งหมดยังอยู่ใน `provider`)
- `notice`: ข้อความแจ้งเตือนสั้นหรือ `null`

Kiosk/Mobile ที่ไม่รู้จักฟิลด์ใหม่ทำงานเหมือนเดิม · 6F/6G แสดง `notice` เป็นป้ายใต้คำตอบ
ใหม่ในหลังบ้าน: `GET /api/admin/ai/status`, `POST /api/admin/ai/test` (สิทธิ์ admin)

## 7. Database

**ไม่ต้อง Migration** — ใช้ `messages.provider`, `messages.sources` (JSON), `system_events`, `settings` (key-value) ที่มีอยู่ · ค่าตั้งที่เป็นความลับอยู่ใน `.env` เท่านั้น ไม่เก็บในฐานข้อมูล

## 7.1 ความเป็นส่วนตัว (Privacy)
ตัด PII (เบอร์ อีเมล เลขบัตร 13 หลัก LINE/บัญชี) ก่อนส่งผู้ให้บริการ/ผู้ค้นหา · ไม่ส่ง session/ภาพ/เสียง · log/event/error/audit ไม่มีคีย์หรือ PII · คีย์อยู่ใน `.env` เท่านั้น แสดงเพียง "ตั้งแล้ว/ยังไม่ตั้ง" · ชื่อบุคคลตรวจจับไม่ได้อย่างน่าเชื่อถือ (ความเสี่ยงคงเหลือ) · ระบบเดิมเก็บข้อความผู้ใช้ใน `messages`/`unanswered` — ไม่เปลี่ยนโดยไม่ได้อนุมัติ (D4) · กรณีทดสอบ T-PRV: TEST_PLAN ข้อ 5

## 7.2 ข้อจำกัดออฟไลน์
| ความสามารถ | ไม่มีอินเทอร์เน็ต |
|---|---|
| ฐานความรู้ | ทำงาน |
| Local AI | ทำงานเฉพาะเมื่อติดตั้ง Ollama + โมเดล (D2) |
| Online AI / Web Search | ไม่ทำงาน → ตกไปชั้นถัดไป |
| ฟังเสียง (Web Speech API) | **ไม่ทำงาน** — ไม่มี STT ออฟไลน์ใน Phase 6 |
| พูด (TTS) | ขึ้นกับเสียงที่ติดตั้งในเครื่อง · edge-tts ไม่ทำงาน |

## 8. นอกขอบเขต Phase 6 (เสนอเป็นงานต่อ)

ฟังเสียงแบบออฟไลน์ (ต้องเพิ่มโมเดล/แพ็กเกจ) · embedding/vector search (ต้องเพิ่ม dependency) · ฝึก LLM เอง · ความจำข้ามเซสชันของผู้เข้าชม (ขัดหลักความเป็นส่วนตัว)
