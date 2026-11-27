# AVATAR_INTEGRATION — การนำอวตาร VORA ตัวจริงเข้าระบบ

สถานะ: 1 พ.ย. 2569 (VORA NEXT Phase 2) · **ยังไม่มีไฟล์อวตารจริง** — ระบบใช้ Placeholder (SVG ที่วาดด้วยโค้ด) และชุดเลเยอร์ตัวอย่างที่ Export จาก Placeholder เพื่อทดสอบเส้นทาง PSD เท่านั้น **ไม่ใช่อวตารจริง**

เป้าหมาย: เมื่อได้ไฟล์ PSD ให้ทำงานเฉพาะส่วน **Renderer / Rigging / Animation** แล้วเชื่อมเข้าระบบเดิม โดยไม่ต้องแก้ AI, Camera, Voice, Conversation, Spatial UI หรือ Presentation

---

## 1. สถาปัตยกรรม

```
ระบบหลัก (app.js · Experience Orchestrator · Presentation · Camera/Visitor · Voice)
        │  สื่อสารผ่าน Event Bus (AVATAR_* , AVATAR_HINT, FACE_POSITION, AVATAR_MOUTH)
        │  หรือเรียก Avatar Adapter Interface (9 คำสั่ง) — ไม่มีชื่อไฟล์ภาพ/เลเยอร์/PSD ในระบบหลัก
        ▼
AvatarController  (frontend/kiosk/avatar/AvatarController.js)
   · คำนวณท่าทาง (pose) เป็นตัวเลขทุกเฟรม: แขน ศีรษะ ลำตัว ตา ปาก กะพริบ มองตาม ขยับปาก
   · ลำดับความสำคัญของสถานะ · กล่องคำพูด · ขยายตัวในโหมดว่าง
        │  renderer.render(pose) / renderer.setState(state, def) / renderer.supportsAnimation(name)
        ▼
Renderer (เลือกด้วย kiosk-config.js → avatar.renderer)
   ├── PlaceholderRenderer   (AvatarRenderer.js)        — SVG วาดด้วยโค้ด (ใช้อยู่ตอนนี้)
   ├── LayeredImageRenderer  (LayeredImageRenderer.js)  — ภาพเลเยอร์ PNG/WebP จาก PSD + manifest.json
   └── (อนาคต) Live2D / Spine / Sprite Renderer        — ทำคลาสใหม่ตามข้อ 4
```

ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | หน้าที่ |
|---|---|
| `avatar/AvatarAdapter.js` | รายชื่อคำสั่งของสัญญา + `assertAvatarAdapter()` ตรวจความครบ |
| `avatar/avatar-states.js` | สถานะ, ท่าทาง (ชื่อเดียวกับ Robot Protocol), ชื่อเลเยอร์มาตรฐาน, จุดหมุน |
| `avatar/AvatarController.js` | Adapter หลัก (ทำครบทั้ง 9 คำสั่ง) |
| `avatar/AvatarRenderer.js` | `RigRenderer` (โครงเลเยอร์กลาง) + `PlaceholderRenderer` |
| `avatar/LayeredImageRenderer.js` | Renderer สำหรับภาพเลเยอร์จาก PSD |
| `avatar/index.js` | สร้างอวตารตาม config (โหลดไม่ได้ → ใช้ Placeholder ต่อ) |
| `avatar/README.md` | ขั้นตอนเตรียมไฟล์ PSD แบบละเอียด (ชื่อเลเยอร์ ขนาดผืนภาพ การ Export) |
| `assets/avatar/manifest.example.json`, `assets/avatar/example-layers/` | ตัวอย่าง manifest และชุดเลเยอร์ทดสอบ |

---

## 2. Avatar Adapter Interface

| คำสั่ง | รูปแบบ | ความหมาย |
|---|---|---|
| `loadCharacter(cfg)` | `async ({ renderer: "placeholder"\|"layered", manifest }) → { kind, ok, fallback, error? }` | โหลด/เปลี่ยนตัวละคร · โหลดไม่ได้ = ใช้ตัวที่แสดงอยู่ต่อ (`fallback: true`) หน้าจอไม่ว่าง |
| `setState(state)` | สถานะในข้อ 3 | ตั้งสถานะ (ระบบที่เชื่อม Event อยู่จะกำหนดสถานะใหม่ตามเหตุการณ์ถัดไป — ใช้ `AVATAR_HINT` ถ้าต้องการให้ค้าง) |
| `setExpression(name)` | `neutral \| happy \| sorry → { expression, supported }` | สีหน้า · ชื่อที่ไม่รู้จัก → `neutral` + `supported: false` |
| `playAnimation(name)` | `→ { name, supported, durationMs }` | เล่นท่าทาง · **ท่าที่ Renderer ไม่รองรับ → `supported: false` และไม่เล่น** (ห้ามแสดงว่าเล่นสำเร็จ) |
| `setGaze(x, y)` | `-1..1` | ทิศที่มอง (ระบบกล้องส่งตำแหน่งผู้เข้าชมผ่าน `FACE_POSITION`) |
| `setSpeech({ text, partial, level })` | `level 0..1` | กล่องคำพูด + ระดับเสียงสำหรับ Lip Sync |
| `setVisibility(visible)` | `→ boolean` | ซ่อน/แสดง (ซ่อนแล้วหยุดวาด) |
| `dispose()` | | ยกเลิก Event, ResizeObserver, วงรอบวาด และ Renderer |
| `capabilities()` | `→ { kind, states, extraStates, animations, expressions, lipSync }` | ความสามารถจริงของตัวละครที่โหลดอยู่ — ระบบใช้ตัดสินใจ ไม่เดา |

ระบบหลักใช้ผ่าน Event (ไม่ต้องถืออ้างอิงอวตาร):

| Event | ข้อมูล | ผล |
|---|---|---|
| `AVATAR_LISTENING` / `AVATAR_THINKING` / `AVATAR_SPEAKING {kind}` / `AVATAR_IDLE` | | สถานะการสนทนา |
| `GREETING_STARTED` / `GREETING_FINISHED` | | ทักทาย |
| `AVATAR_HINT` | `{ state, ms? }` | สถานะนำเสนอ: ไม่ระบุ `ms` = ค้าง (scene) · มี `ms` = ชั่วคราว · `state: null` = ล้าง |
| `AVATAR_GESTURE` | `{ name }` | ท่าทาง |
| `AVATAR_EMOTION` | `{ emotion, flashMs }` | สีหน้า |
| `AVATAR_CAPTION` | `{ text, partial }` | กล่องคำพูด |
| `AVATAR_MOUTH` | `level 0..1` | Lip Sync |
| `AVATAR_ALERT` | `{ error }` | ขัดข้อง/หยุดฉุกเฉิน |
| `FACE_POSITION` | `{ x, y }` | มองตามผู้เข้าชม |

---

## 3. Animation State มาตรฐาน

| สถานะ | ใช้เมื่อ | ท่าเข้า (gesture) | ตา / ปาก |
|---|---|---|---|
| `idle` | ว่าง | — | open / smile |
| `greeting` | ทักทายผู้เข้าชม | `wave` | happy / talk |
| `listening` | ฟังผู้ใช้ | `listen` | open / neutral |
| `thinking` | AI ประมวลผล | `think` | up / neutral |
| `speaking` | ตอบคำถาม | — (มือขยับเบา ๆ) | open / talk |
| `presenting` | ตลอดโหมดนำเสนอ | `present` | open / smile (พูด = talk) |
| `pointing` | เปิดรายละเอียดบนจอ (2.5 วิ) | `point_screen` | open / smile |
| `waving` | โบกมือ (ใช้โดย Scene ในอนาคต) | `wave` | happy / smile |
| `thanking` | หลังส่งแบบประเมิน (2.6 วิ) | `bow` | happy / smile |
| `happy` | ตอบสำเร็จ/ได้รับคำชม | `happy` | happy / smile |
| + `announcing`, `error` | ประกาศข่าว / ขัดข้อง (ของเดิม) | `point_screen`, `shrug` | |

**ลำดับความสำคัญ** (`AvatarController.refresh()`): ฟัง/คิด > ทักทาย/ประกาศ > สถานะนำเสนอ (ชั่วคราว > ค้าง) > พูด · ขณะว่าง: ดีใจชั่วคราว > ขัดข้อง > สถานะนำเสนอ > idle · ขณะพูดในสถานะนำเสนอ ปากยังขยับ

ท่าทาง (gesture) ใช้ชื่อชุดเดียวกับ `backend/app/robot/protocol.py → GESTURES` — **การเคลื่อนไหวบนจอเป็นการจำลอง แยกจากมอเตอร์หุ่นจริง** (หุ่นจริงรับคำสั่งผ่าน Robot Bridge + Safety Layer เท่านั้น)

**Lip Sync:** รับระดับเสียง 0..1 (`AVATAR_MOUTH` / `setSpeech({level})`) · เสียงพูดจากเบราว์เซอร์ (Web Speech API) ไม่ให้ระดับเสียงจริง ระบบจึงจำลองจังหวะปาก · ถ้าใช้ TTS ฝั่งเซิร์ฟเวอร์ (edge-tts) `voice.js` วัดระดับเสียงจริงส่งให้แล้ว · อวตารจริงต้องมีภาพปากอย่างน้อย `talk_half`, `talk_open`

---

## 4. รูปแบบ Asset

### 4.1 ภาพเลเยอร์จาก PSD (ทางที่แนะนำเป็นอันดับแรก — ไม่ต้องเพิ่มไลบรารี)
- ผืนภาพ 400×820 (หรือสัดส่วนเดียวกัน + แก้ `viewBox`) · PNG-24/WebP โปร่งใส · Export เต็มผืนภาพ
- ชื่อเลเยอร์ (slot): `shadow, hair_back, legs, shoes, body, arm_l_upper, arm_l_fore, arm_r_upper, arm_r_fore, neck, head, hair_front, accessories`
- ตา: `open` (จำเป็น), `closed`, `happy`, `sad` · ปาก: `smile`, `neutral`, `sad`, `talk_half`, `talk_open`
- `manifest.json`: `viewBox`, `pivots` (ไหล่ ศอก คอ เท้า — วัดจากภาพจริง), `layers[]`, `eyes{}`, `mouth{}` และ (ใหม่) `animations[]` = รายชื่อท่าที่ตัวละครนี้ทำได้จริง ถ้าไม่ระบุถือว่าทำได้ทุกท่ามาตรฐาน
- ขั้นตอนละเอียด: `frontend/kiosk/avatar/README.md`

### 4.2 ทางเลือกอื่น (ประเมินเมื่อเห็นโครงสร้าง PSD จริง)

| เทคโนโลยี | เหมาะเมื่อ | ข้อควรพิจารณา |
|---|---|---|
| Layered Image (มีแล้ว) | PSD แยกชิ้นส่วนตามตารางข้างต้น | เคลื่อนไหวแบบหมุนชิ้นส่วน ไม่มีการบิดผิว |
| Sprite Animation | ศิลปินวาดเป็นเฟรม (ไม่แยกชิ้น) | ไฟล์ใหญ่ ต้องวาดทุกท่าทุกสถานะ |
| Live2D | ต้องการการเคลื่อนไหวนุ่ม/บิดผิว | ต้อง Rig ใน Cubism Editor, ตรวจสัญญาอนุญาต SDK สำหรับการแจกจ่าย, เพิ่มไลบรารี |
| Spine | ต้องการโครงกระดูก + Mesh | ต้องมีไลเซนส์ Spine Editor, เพิ่ม Runtime |

ทุกทางเลือกต้องทำงาน **ออฟไลน์ได้** (วางไลบรารีในเครื่อง ไม่ใช้ CDN) เหมือนระบบเดิม

---

## 5. ขั้นตอนนำอวตารจริงเข้าระบบ

1. **ตรวจ PSD ก่อน**: ขนาดผืนภาพ, ชื่อ/การแยกเลเยอร์, มีตา-ปากแยกตามอารมณ์หรือไม่, แขนแยกต้นแขน-ปลายแขนหรือไม่ → เลือกเทคโนโลยีตามข้อ 4.2
2. **Layered Image**: Export เลเยอร์ → วางที่ `frontend/assets/avatar/vora/` → เขียน `manifest.json` (วัด `pivots` จากภาพจริง; ใส่ `animations` ถ้าบางท่าทำไม่ได้)
3. **ทดลองโดยไม่แก้ไฟล์ระบบ**: `http://localhost:8000/?avatar=layered&avatarManifest=/assets/avatar/vora/manifest.json` (ใส่ `&debug=1` เพื่อใช้คำสั่งทดสอบ)
4. **ตรวจด้วยคำสั่ง** (Console ของเบราว์เซอร์ เมื่อเปิด `?debug=1`):
   ```js
   const { missingAdapterMethods } = await import('/avatar/AvatarAdapter.js');
   missingAdapterMethods(VORA.avatar)            // ต้องได้ []
   VORA.avatar.capabilities()                    // ดูท่า/สถานะที่รองรับจริง
   ['idle','greeting','listening','thinking','speaking','presenting','pointing','waving','thanking','happy'].forEach(s => VORA.avatar.setState(s))
   VORA.avatar.playAnimation('wave')             // { supported: true }
   ```
5. **รันชุดทดสอบ**: `docs/vora-next/phase2/phase2-scenarios.js` (ข้อ 1–6, 18 ทดสอบ Adapter และการเปลี่ยนตัวละคร) + ชุด Phase 1 (ตำแหน่ง Orbital Menu คำนวณจากขนาดอวตารจริงอัตโนมัติ — ตรวจภาพว่าไม่บังใบหน้า; ถ้าสัดส่วนหน้าต่างจาก Placeholder ให้ปรับ `faceRatio` ใน `SpatialMenu`)
6. **ใช้ถาวร**: `kiosk-config.js → avatar.renderer: "layered"` และ `avatar.manifest`
7. **Live2D/Spine/Sprite**: ทำคลาส Renderer ใหม่ที่มี `render(pose)`, `setState(state, def)`, `supportsAnimation(name)`, `destroy()` และวาดลงใน `container` แล้วเพิ่มทางเลือกใน `AvatarController.loadCharacter()` — ส่วนอื่นไม่ต้องแก้

**ห้าม:** ใส่ชื่อเลเยอร์/ไฟล์ PSD ในระบบหลัก · สร้างภาพแทนแล้วอ้างว่าเป็นอวตารจริง · ให้ท่าทางบนจอส่งคำสั่งไปมอเตอร์หุ่นโดยตรง

---

## 6. หลักฐานการทดสอบ (Phase 2)

`docs/vora-next/phase2/phase2-test-results.json` — Adapter ครบ 9 คำสั่ง, 10 สถานะมาตรฐาน, `playAnimation` รายงาน `supported:false` สำหรับท่าที่ไม่มี, เปลี่ยนเป็นชุดเลเยอร์ตัวอย่างแล้ว AI/เมนูทำงานเหมือนเดิม, โหลด manifest ไม่ได้ → ใช้ตัวเดิมต่อ, `dispose()` คืนทรัพยากร

## 7. อวตาร VORA ตัวจริง (VoraLiveRig) — ใช้งานจริงตั้งแต่ 8 พ.ย. 2569

อวตารผมบลอนด์จาก `Vora.psd` / `VoraE1.psd` ที่ทีมทำไว้ในโฟลเดอร์ทดลอง "หน้าuiทดลอง" ถูกนำเข้าเป็น **Renderer ตัวที่ 3** ตามหัวข้อ 5 โดยไม่แก้ระบบหลัก

| ส่วน | ไฟล์ |
|---|---|
| ตัวละคร (ไม่ได้แก้) | `frontend/assets/avatar/vora-rig/vora-rig.js` (คลาส `VoraLiveRig`) + ภาพ 45 ชิ้นที่ manifest อ้างถึง (`vora/` 31, `vora_e1/` 14) |
| ตัวแปลง | `frontend/kiosk/avatar/VoraRigRenderer.js` — แปลง pose ของ `AvatarController` เป็นคำสั่งของ rig |
| เลือกใช้ | `kiosk-config.js` → `avatar.renderer: "rig"` (ทดสอบตัวอื่น: `/?avatar=placeholder`) |

การแปลงสถานะ: `thinking` → ท่าเท้าคาง (`POSE_THINKING`) · สถานะอื่น → ท่ายืน (`POSE_NORMAL`) · พูด (`mouth: talk`) → `setSpeaking(true)` ใช้ปาก `mouth_2/mouth_3`
· ทิศที่มอง → `setCameraFaceTarget()` จาก `FACE_POSITION` ของกล้องเดิม · ท่า explain/present/point_screen/think/happy/nod/listen → ท่าแขนของ rig

สิ่งที่ **ไม่ได้** นำมาจากไฟล์ทดลอง (เพื่อไม่ให้มีระบบซ้อน): `VoraCameraFaceTracker` (เปิดกล้องอีกตัว), ระบบเสียง/ไฟล์ mp3, `llama-brain.js`, `vora_server.py`, `app.js`
ข้อจำกัด: ตัวละครไม่มีภาพโบกมือ/โค้ง/หมุนตัว — `playAnimation()` รายงาน `supported: false` สำหรับท่าเหล่านี้ (ไม่แสดงว่าเล่นสำเร็จ) · การลูบหัว (แตะที่ศีรษะ) เป็นแอนิเมชันของตัวละครเอง ไม่มีเสียง
