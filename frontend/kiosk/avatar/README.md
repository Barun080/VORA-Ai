# ระบบอวตาร VORA — จากตัวจำลองสู่อวตารจริง (PSD)

อวตารแยกออกจากระบบสนทนา กล้อง และหน้าจออย่างสมบูรณ์ — ไม่มีโค้ด AI ใดผูกกับภาพอวตาร
ระบบอื่นเรียกผ่าน **Avatar Adapter Interface** (VORA NEXT Phase 2): `loadCharacter` `setState` `setExpression` `playAnimation`
`setGaze` `setSpeech` `setVisibility` `dispose` `capabilities` (สัญญาอยู่ที่ `AvatarAdapter.js`)
คำสั่งเดิม `setEmotion()` `gesture()` `setMouth()` `lookAt()` ยังใช้ได้เหมือนเดิม
ภาพรวมการนำอวตารจริงเข้าระบบ: [`docs/AVATAR_INTEGRATION.md`](../../../docs/AVATAR_INTEGRATION.md)

| ไฟล์ | หน้าที่ |
|---|---|
| `avatar-states.js` | สถานะ 12 แบบ (idle, listening, thinking, speaking, greeting, announcing, happy, error + presenting, pointing, waving, thanking), ชื่อท่าทาง (ชุดเดียวกับ Robot Protocol), ชื่อเลเยอร์มาตรฐาน, จุดหมุน |
| `AvatarAdapter.js` | รายชื่อคำสั่งของ Avatar Adapter Interface + ตัวตรวจความครบ |
| `AvatarController.js` | คำนวณท่าทาง (pose) เป็นตัวเลขทุกเฟรม: แขน ศีรษะ ลำตัว ตา ปาก กะพริบตา มองตามผู้ใช้ ขยับปากตามเสียง |
| `AvatarRenderer.js` | `RigRenderer` โครงเลเยอร์กลาง + `PlaceholderRenderer` อวตารจำลอง (SVG) |
| `LayeredImageRenderer.js` | อวตารจริงจากภาพเลเยอร์ PNG/WebP โปร่งใส อ่านค่าจาก `manifest.json` |
| `index.js` | เลือกตัววาดตาม `kiosk-config.js` ถ้าโหลดอวตารจริงไม่ได้จะกลับไปใช้ตัวจำลองเอง (หน้าจอไม่ว่าง) |

การเคลื่อนไหวบนจอเป็น **การจำลองเท่านั้น** แยกจากมอเตอร์ของหุ่นจริง (หุ่นจริงรับคำสั่งท่าทางผ่าน `/api/chat` → Robot Bridge ตามเดิม)

## ขั้นตอนนำอวตาร PSD มาใช้

เบราว์เซอร์แสดงไฟล์ PSD โดยตรงไม่ได้ จึงต้องแยกเลเยอร์แล้ว Export เป็นภาพโปร่งใสก่อน

### 1. เตรียมไฟล์ PSD

- ขนาดผืนภาพ **400 × 820 px** (หรือขนาดอื่นในสัดส่วนเดียวกัน แล้วแก้ `viewBox` ใน manifest) ตัวละครยืนเต็มตัว เท้าอยู่ที่ประมาณ y = 790
- แยกชิ้นส่วนที่ต้องขยับเป็นเลเยอร์ (หรือกลุ่มเลเยอร์) ชื่อตามตารางนี้

| ชื่อเลเยอร์ (slot) | เนื้อหา | หมุนรอบจุด |
|---|---|---|
| `shadow` | เงาที่พื้น | — |
| `hair_back` | ผมด้านหลังศีรษะ | ศีรษะ (ครึ่งหนึ่ง) |
| `legs`, `shoes` | ขา รองเท้า | ลำตัว |
| `body` | ลำตัว เสื้อ กระโปรง/กางเกง | ลำตัว |
| `neck` | คอ | ลำตัว |
| `arm_l_upper`, `arm_l_fore` | ต้นแขน / ปลายแขน+มือ ด้านซ้ายของภาพ | ไหล่ / ข้อศอก |
| `arm_r_upper`, `arm_r_fore` | ต้นแขน / ปลายแขน+มือ ด้านขวาของภาพ | ไหล่ / ข้อศอก |
| `head` | ใบหน้าเปล่า (ไม่มีตา ปาก) หู | คอ |
| `hair_front` | ผมหน้าม้า กิ๊บ | คอ |
| `accessories` | หูฟัง ไมค์ เครื่องประดับ | คอ |

- **ตา** และ **ปาก** ทำเป็นภาพแยกตามอารมณ์ (แต่ละภาพมีเฉพาะตา/ปาก):
  - ตา: `open` (จำเป็น), `closed` (กะพริบ), `happy`, `sad`
  - ปาก: `smile`, `neutral`, `sad`, `talk_half`, `talk_open`
  - ภาพที่ไม่มีจะใช้ภาพใกล้เคียงแทน (ไม่มี `closed` จะใช้การย่อแนวตั้งแทนการกะพริบ)
- วาดแขนให้ **เลยเข้าไปใต้ไหล่/ลำตัวเล็กน้อย** เพื่อไม่ให้เห็นรอยต่อเมื่อหมุน

### 2. Export เลเยอร์

ทุกเลเยอร์ Export **เต็มขนาดผืนภาพ** (400 × 820) พื้นหลังโปร่งใส ตำแหน่งจะตรงกันเองโดยไม่ต้องกำหนดพิกัด

- Photoshop: File > Export > **Layers to Files…** เลือก PNG-24 + Transparency (ไม่ติ๊ก Trim Layers)
- Photopea (ฟรี บนเว็บ): File > Export Layers
- ต้องการไฟล์เล็กลง แปลง PNG เป็น WebP ได้ (คุณภาพ 85–90) แล้วแก้นามสกุลใน manifest

### 3. เขียน manifest.json

วางไฟล์ทั้งหมดไว้ที่ `frontend/assets/avatar/vora/` แล้วสร้าง `manifest.json` ตามตัวอย่าง
`frontend/assets/avatar/manifest.example.json` หรือดูชุดที่ใช้งานได้จริงใน `frontend/assets/avatar/example-layers/`
(ชุดตัวอย่างนี้ Export จากอวตารจำลอง ใช้ทดสอบเส้นทางนี้ครบวงจรแล้ว)

- `pivots` คือพิกัดจุดหมุนบนผืนภาพ: ไหล่ ข้อศอก โคนคอ และเท้า — ต้องวัดจากภาพจริงให้ตรง ไม่เช่นนั้นแขนจะหลุดจากไหล่เวลาโบกมือ
- เลเยอร์ที่เล็กกว่าผืนภาพ ใส่ `"box": [x, y, w, h]` ได้

### 4. เปิดใช้

- ทดลองก่อนโดยไม่แก้ไฟล์: เปิด `http://localhost:8000/?avatar=layered&avatarManifest=/assets/avatar/vora/manifest.json`
- ใช้ถาวร: แก้ `frontend/kiosk/kiosk-config.js` → `avatar.renderer: "layered"`
- ถ้าโหลดภาพไม่ได้ ระบบใช้อวตารจำลองต่อเอง และเขียนสาเหตุไว้ใน Console ของเบราว์เซอร์

ไม่ต้องแก้ระบบสนทนา กล้อง หรือหน้าจอ เพราะทุกส่วนเรียกอวตารผ่าน `AvatarController` เท่านั้น
