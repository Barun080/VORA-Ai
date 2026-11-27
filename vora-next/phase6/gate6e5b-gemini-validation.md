# Gate 6E-5B — Gemini-only Real Provider Validation

สถานะ ณ 6 พ.ย. 2569 18:40 (Asia/Bangkok): **NEEDS DECISION — ถูกบล็อกด้วยความพร้อมของผู้ให้บริการ (HTTP 503)**
ยังไม่มีคำขอ generateContent ที่สำเร็จ · ยังไม่ได้รัน `gemini-validate` · ยังไม่ได้ประเมินคุณภาพของ Gemini
Production ไม่เปลี่ยน: `.env` = `VORA_LLM_PROVIDER=none` · `DEFAULT_MODELS["gemini"]` = `gemini-2.5-flash` · timeout 4 / งบ 8 / concurrency 4
Anthropic ใน Gate 6E-5B: 0 คำขอ

## 1. Model capability (จาก Gemini API `models.get` — ไม่ใช่การเดาจากชื่อ)
ที่มา: `data/bakeoff_6e0/20261106-180156-gemini-check/gemini_check.json` (และรอบ 175708 ผลตรงกัน)

| ฟิลด์ (API ยืนยัน) | gemini-2.5-flash (ค่าเริ่มต้น production) | gemini-3.8-flash (ทดสอบ) |
|---|---|---|
| HTTP | 200 | 200 |
| version | 001 | 3.0 |
| supportedGenerationMethods | generateContent, countTokens, createCachedContent, batchGenerateContent | เหมือนกัน |
| inputTokenLimit / outputTokenLimit | 1,048,576 / 65,536 | 1,048,576 / 65,536 |
| thinking | true | true |

ยืนยันจาก API ในทางอ้อม (คำตอบ error ของ generateContent): `gemini-3.8-flash` **ไม่รองรับ** `thinkingLevel=MINIMAL`
(HTTP 400 "Thinking level MINIMAL is not supported for this model")

API **ไม่ได้เปิดเผย / ยังยืนยันไม่ได้**
- ระดับ thinking ที่รองรับ (models.get บอกแค่ `thinking: true`) — ทราบเพียงว่า MINIMAL ไม่รองรับ
- ระดับ thinking ค่าเริ่มต้นที่ใช้เมื่อไม่ส่ง thinkingConfig (แบบ production)
- สถานะ/วันหมดอายุของโมเดล (models.get ไม่มีฟิลด์ lifecycle) · การตอบ 200 ของ models.get ไม่ได้รับรองว่า generateContent ใช้ได้
- ความจุ/ความพร้อมให้บริการ ณ เวลาใช้งาน (ทราบจาก 503 เท่านั้น)
- ข้อจำกัด Free Tier (RPM/RPD) ของบัญชีนี้ — ยังไม่พบ 429
- ฟิลด์อื่นของ resource (description, temperature, topP, topK) — harness บันทึกเฉพาะฟิลด์ข้างต้น

## 2. Timeout diagnosis (ปิดแล้ว)
เส้นทาง timeout ใน VORA: `llm.complete` → `limit = min(VORA_LLM_TIMEOUT, งบที่เหลือ)` → `httpx.AsyncClient(timeout=limit)` + `asyncio.wait_for(limit)`
ไม่มีคิวรอ (คำขอเดียว) · deadline ร่วม 8 วิไม่ใช่ตัวตัด · ขั้นก่อนเรียกผู้ให้บริการใช้เวลาระดับ ms

รอบที่ใช้สรุป: `data/bakeoff_6e0/20261106-183026-gemini-diagnose/` (หลังแก้บั๊ก content-length ของ harness)

| path | timeout | thinking | HTTP | completed | latency | ผล |
|---|---:|---|---:|---|---:|---|
| VORA | 4s | production (ไม่ส่ง) | – | no | 4,000 ms | ตัดตาม timeout (CancelledError) |
| VORA | 6s | production | – | no | 6,017 ms | ตัดตาม timeout |
| VORA | 8s | production | – | no | 7,996 ms | ตัดตาม timeout |
| API ตรง | 30s | production | 503 | no | 17,026 ms | UNAVAILABLE — high demand |
| VORA | 8s | minimal (วินิจฉัย) | 400 | no | 1,190 ms | MINIMAL ไม่รองรับ |

รอบก่อนหน้า (182002): ผลแบบเดียวกัน (API ตรง 503 หลัง 27,989 ms) · แถว minimal ล้มในเครื่องเพราะบั๊ก content-length ของ harness (แก้แล้ว)

ข้อสรุป
- VORA per-call timeout / deadline ทำงานตามที่ออกแบบ (ตัดตรงเวลา · ไม่ crash · ตอบจากฐานความรู้แทน)
- คำขอตรงไป Gemini (ไม่ผ่าน VORA) ก็ไม่สำเร็จ — 503 high demand → ความล่าช้าอยู่ที่ฝั่งผู้ให้บริการ ไม่ใช่ application layer
- **ยังไม่มีหลักฐานพอจะเลือก production timeout ใหม่** (ไม่มีคำขอที่สำเร็จให้วัด latency จริง)
- **ไม่สรุปว่า thinking เป็นสาเหตุของ latency** — ยังไม่มีการวัดเปรียบเทียบที่สำเร็จ
- ไม่มี usage metadata (503 คืนค่า 0)

## 3. คำขอจริงทั้งหมดใน Gate 6E-5B (จากไฟล์ผล)
| ขั้น | คำขอ | ผล |
|---|---:|---|
| gemini-check × 4 รอบ | 8 (models.get · ไม่สร้าง token) | 2 รอบ 401 (คีย์ไม่ถูก) · 2 รอบ 200 |
| gemini-smoke × 2 รอบ | 4 generateContent | timeout 4 วิทั้งหมด |
| gemini-diagnose 182002 | 5 (น่าจะถึง Google 4) | ดูข้างบน |
| gemini-diagnose 182803 | 0 (worker exit 1 ก่อนเรียก · ไม่มี payload) | ไม่มีผล |
| gemini-diagnose 183026 | 5 | ดูข้างบน |
| capability check (รอบนี้) | **0** | ใช้ผล models.get เดิม |
| **รวม** | generateContent ≈ 13 (สำเร็จ 0) · models.get 8 | Anthropic 0 |

## 4. Security / privacy ของการทดสอบ
คีย์รับผ่าน getpass → header `x-goog-api-key` เท่านั้น (ไม่อยู่ใน URL/body/ไฟล์) · สแกนไฟล์ผลทุกรอบไม่พบคีย์ ·
payload = ข้อมูลสาธิต (FF-02 / คำถามทั่วไป) ไม่มี PII / session / IP / กล้อง / เสียง / บัญชีเจ้าหน้าที่ · ฐานข้อมูลชั่วคราว + หุ่นยนต์จำลอง

## 5. Harness (scripts/bakeoff_6e0.py)
โหมด Gemini-only: gemini-selftest / gemini-check / gemini-smoke / gemini-validate / gemini-diagnose · แก้บั๊ก content-length เมื่อเติม thinkingConfig ·
บันทึก CancelledError · ทดสอบ `backend/tests/test_gate6e5b_harness.py` (18) · โหมด bake-off เดิมยังอยู่

## 6. ต้องตัดสินใจ (ไม่ได้ตัดสินแทน)
- รัน gemini-diagnose ซ้ำในช่วงเวลาอื่น (503 อาจเป็นชั่วคราว) — 5 คำขอ
- ระดับ thinking สำหรับการวินิจฉัยครั้งถัดไป (เช่น low) — ไม่เปิดใน production
- ทางเลือกโมเดล / paid tier — เจ้าของโครงการเป็นผู้ตัดสิน
