# VORA Robot Protocol v1 — สัญญาการเชื่อมต่อซอฟต์แวร์กับหุ่นยนต์

เอกสารนี้คือข้อตกลงระหว่างทีมซอฟต์แวร์และทีมฮาร์ดแวร์ ถ้าบอร์ดหุ่นยนต์ทำตามนี้ ซอฟต์แวร์ VORA จะสั่งงานได้ทันทีโดยไม่ต้องแก้โค้ด
ตัวอย่างการทำตามโปรโตคอลบน ESP32 อยู่ที่ `firmware/vora_esp32/vora_esp32.ino` และหุ่นยนต์จำลองที่ `backend/app/robot/simulator.py`

## 1. การเชื่อมต่อ

| ช่องทาง | การตั้งค่าใน `.env` | หมายเหตุ |
|---|---|---|
| Serial (USB/UART) | `VORA_ROBOT_DRIVER=serial`, `VORA_ROBOT_SERIAL_PORT=COM3`, `VORA_ROBOT_SERIAL_BAUD=115200` | แนะนำสำหรับการประกวด เสถียรที่สุด |
| WebSocket (Wi-Fi) | `VORA_ROBOT_DRIVER=websocket`, `VORA_ROBOT_WS_URL=ws://192.168.4.1:81/` | บอร์ดเป็น WebSocket server |
| หุ่นจำลอง | `VORA_ROBOT_DRIVER=simulator` | ค่าเริ่มต้น ใช้พัฒนา/สาธิตก่อนมีหุ่นจริง |

- ข้อความเป็น **JSON 1 ข้อความต่อ 1 บรรทัด** ลงท้ายด้วย `\n` เข้ารหัส UTF-8 ยาวไม่เกิน 512 ไบต์
- ทุกคำสั่งที่ต้องการผลลัพธ์มี `id` (จำนวนเต็ม) บอร์ดต้องตอบกลับด้วย `id` เดิม
- ซอฟต์แวร์เชื่อมต่อใหม่อัตโนมัติถ้าสายหลุดหรือบอร์ดรีเซ็ต (รอ 1, 2, 4 … สูงสุด 15 วินาที)

## 2. คำสั่งจากซอฟต์แวร์ไปยังหุ่นยนต์

| คำสั่ง | ตัวอย่าง | ความหมาย |
|---|---|---|
| hello | `{"cmd":"hello","id":0}` | ส่งตอนเชื่อมต่อ บอร์ดตอบ `hello` พร้อมความสามารถ |
| hb | `{"cmd":"hb","t":1730000000000}` | heartbeat ทุก 300 ms (ไม่ต้องตอบ) |
| move | `{"cmd":"move","id":5,"dir":"forward","distance_cm":100,"speed":0.3}` | เดินหน้า/ถอยหลัง (`dir`: forward, backward) |
| turn | `{"cmd":"turn","id":6,"dir":"left","angle":90,"speed":0.3}` | หมุนอยู่กับที่ (`dir`: left, right) |
| gesture | `{"cmd":"gesture","id":7,"name":"wave"}` | ท่าทางของแขน/หัว (รายชื่อในข้อ 4) |
| head | `{"cmd":"head","id":8,"pan":30,"tilt":0}` | หันหัว pan -90..90, tilt -30..30 องศา |
| led | `{"cmd":"led","id":9,"color":"#00AEEF","mode":"pulse"}` | ไฟแสดงสถานะ (ถ้ามี) |
| status | `{"cmd":"status","id":10}` | ขอสถานะทันที |
| stop | `{"cmd":"stop","id":11}` | **หยุดทันที** ยกเลิกคำสั่งที่ทำอยู่ ต้องทำได้ทุกสถานะ |
| estop_reset | `{"cmd":"estop_reset","id":12}` | ปลดสถานะหยุดฉุกเฉิน (ทำได้เฉพาะเมื่อปลดปุ่มแล้ว) |

`speed` เป็นค่า 0.05–0.6 (สัดส่วนของความเร็วสูงสุดที่ฮาร์ดแวร์กำหนด) ซอฟต์แวร์ปฏิเสธค่าที่เกินขีดจำกัดตั้งแต่ต้นทาง

## 3. ข้อความจากหุ่นยนต์กลับมายังซอฟต์แวร์

| ประเภท | ตัวอย่าง | เมื่อไร |
|---|---|---|
| ack | `{"type":"ack","id":5,"ok":true}` | รับคำสั่งแล้ว เริ่มทำ (ภายใน 100 ms) |
| done | `{"type":"done","id":5}` | ทำเสร็จ (`"interrupted":true` ถ้าถูกสั่งหยุด) |
| error | `{"type":"error","id":5,"code":"OBSTACLE","msg":"path blocked"}` | ทำไม่สำเร็จ |
| status | `{"type":"status","state":"moving","battery":78,"estop":false,"obstacle_cm":120,"busy":true,"joints":{"arm_l":0,"arm_r":45,"head_pan":0}}` | ทุก 150 ms ขณะทำงาน, ทุก 500 ms ขณะว่าง |
| event | `{"type":"event","name":"obstacle_avoided"}` | เหตุการณ์สำคัญ |
| hello | `{"type":"hello","fw":"vora-esp32-1.0","protocol":1,"caps":{...}}` | ตอบคำสั่ง hello |

ฟิลด์เสริมใน status: `pose` `{x,y,th}` (ถ้ามี encoder), `odometer_cm`, `avoid_count`, `led`

**รหัสข้อผิดพลาด:** `INVALID` คำสั่งผิดรูปแบบ · `BUSY` กำลังทำคำสั่งอื่น · `OBSTACLE` ทางตัน · `ESTOP` อยู่ในสถานะหยุดฉุกเฉิน · `WATCHDOG` ขาด heartbeat · `LOW_BATTERY` · `HW_FAULT`

**เหตุการณ์:** `obstacle_detected`, `obstacle_avoided`, `obstacle_blocked`, `estop_pressed`, `watchdog_stop`, `low_battery`, `hw_fault`

## 4. ท่าทางมาตรฐาน (ชื่อเดียวกับอวตาร์บนหน้าจอ)

`idle` ยืนพัก · `wave` โบกมือ · `bow` ไหว้ · `nod` พยักหน้า · `shake` ส่ายหน้า · `present` ผายมือ · `point_screen` ชี้จอ ·
`point_direction` ชี้ทาง · `explain` ขยับมือขณะอธิบาย · `think` ครุ่นคิด · `happy` ดีใจ · `shrug` ยักไหล่ · `listen` เอียงหัวฟัง ·
`dance` เต้น (ขยับฐาน) · `spin` หมุนรอบตัว (ขยับฐาน)

ถ้าหุ่นจริงทำท่าไหนไม่ได้ ให้ตอบ `done` ทันที (ไม่ต้องตอบ error) เพื่อไม่ให้บทสนทนาสะดุด

## 5. ข้อกำหนดความปลอดภัย (บอร์ดต้องทำเอง ไม่พึ่งคอมพิวเตอร์)

1. **Watchdog** ไม่ได้รับ `hb` เกิน **1000 ms** ขณะเคลื่อนที่ → หยุดมอเตอร์ ส่ง `event: watchdog_stop`
2. **หลบสิ่งกีดขวาง** ขณะเดินหน้า ถ้าวัดระยะได้น้อยกว่า 45 ซม. → หยุดและหลบ (ส่ง `obstacle_detected` → `obstacle_avoided`) ถ้าหลบไม่ได้ให้ส่ง error `OBSTACLE`
3. **ปุ่มหยุดฉุกเฉิน** แบบกดค้าง ตัดการเคลื่อนที่ทันที ส่ง `estop_pressed` และปฏิเสธคำสั่งเคลื่อนที่จนกว่าจะได้ `estop_reset`
4. **ขีดจำกัด** ระยะต่อคำสั่ง ≤ 300 ซม., ความเร็ว ≤ 0.6, ไม่มีคำสั่งแบบเดินไม่หยุด
5. ถ้าแบตต่ำกว่า 5% ปฏิเสธคำสั่งเคลื่อนที่ด้วย `LOW_BATTERY`

ฝั่งซอฟต์แวร์ทำซ้ำอีกชั้น: ตรวจค่าก่อนส่ง, สั่ง stop ถ้าคำสั่งไม่เสร็จภายในเวลาที่คาด, ปุ่มหยุดบนหน้าจอและหลังบ้านใช้ได้เสมอ, ปิดการเคลื่อนที่ทั้งระบบได้จากหลังบ้าน

## 6. ขั้นตอนทดสอบร่วมกับทีมฮาร์ดแวร์

1. เปิด Serial Monitor ที่ 115200 พิมพ์ `{"cmd":"hello","id":0}` ต้องได้ `hello` กลับมา
2. ตั้ง `.env` เป็น `serial` แล้วเปิด `start.bat` → หลังบ้าน > หุ่นยนต์ ต้องขึ้น "เชื่อมต่อแล้ว"
3. ทดสอบตามลำดับ: ท่าทาง → หมุน → เดินระยะสั้น 30 ซม. → หลบสิ่งกีดขวาง → ถอดสาย USB ระหว่างเดิน (ต้องหยุดใน 1 วินาที) → กดปุ่มฉุกเฉิน
4. บันทึกผลในแบบฟอร์มทดสอบ (docs/install-and-test.md) พร้อมวิดีโอเป็นหลักฐาน

---

## English summary

Newline-delimited JSON over Serial (115200) or WebSocket. Software → robot: `hello`, `hb` (every 300 ms), `move`, `turn`, `gesture`, `head`, `led`, `status`, `stop`, `estop_reset`, each with an integer `id`.
Robot → software: `ack`, `done`, `error` (codes INVALID, BUSY, OBSTACLE, ESTOP, WATCHDOG, LOW_BATTERY, HW_FAULT), periodic `status`, and `event`.
The board must stop on its own after 1000 ms without a heartbeat, avoid obstacles closer than 45 cm while moving forward, honour a latching emergency-stop button, and reject commands beyond 300 cm or speed 0.6.
