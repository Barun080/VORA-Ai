# VORA NEXT — Phase 6 Unified Design System

Gate: **6B** Unified Design Foundation · **6F** Mobile & Admin Integration · **6G** Kiosk, Avatar & Voice Integration (ลำดับฉบับ 1 พ.ย. 20:30) · ข้อตัดสินใจแล้ว: **ฟอนต์หลัก Anuphan (D6)** · **ตรึง `/pastel/` `/classic/` (D8)** · สถานะการพัฒนา: ดู PROGRESS

## 1. สภาพปัจจุบัน — 4 ระบบการออกแบบในแพลตฟอร์มเดียว

| | Kiosk `/` | Mobile `/m/` | Admin `/admin/` | `/pastel/` · `/classic/` |
|---|---|---|---|---|
| สีหลัก | ดำ `#08090C` + เหลือง `#FFD400` | น้ำเงิน `#1d5aa6` บนพื้น `#eef3f9` | กรมท่า `#0f2740` + น้ำเงิน `#1d5aa6` | ม่วง `#7c5ce0` / blueprint |
| ฟอนต์ | Kanit + Inter | Anuphan + Mitr | Anuphan + Mitr | — |
| มุมโค้ง | 20 px (`--r`) | 22/14/8 px | 22/14/8 px + ค่า hard-code | 28 px |
| Token | `kiosk.css` 22 ตัว **ทับ** `base.css` 20 ตัว | `base.css` + `<style>` ในหน้า 44 บรรทัด | ไม่มี token ของตัวเอง · 17 สี hard-code · สีกราฟ hard-code ใน `admin.js` | pastel 21 ตัว / classic 0 |
| โลโก้ | ตัวอักษร "V VORA" สีเหลือง | ไอคอนหน้าหุ่นยนต์ฟ้า | ไอคอนหน้าหุ่นยนต์ฟ้า | — |
| ไอคอน | emoji ระบบ (📍 💻 📅 ✦) + SVG ในหน้า | emoji (😞…😍) | ตัวอักษร | — |

ฟอนต์ทั้งหมดอยู่ในเครื่อง (`assets/vendor/fonts`) ✅ ไม่พึ่งอินเทอร์เน็ต

## 2. ปัญหาที่พบจริง (มีหลักฐาน)

| # | ปัญหา | หลักฐาน |
|---|---|---|
| P1 | ผู้เข้าชมสแกน QR จากหุ่นยนต์ดำ-เหลือง แล้วเปิดหน้ามือถือสีน้ำเงินคนละแบรนด์ คนละฟอนต์ คนละโลโก้ | ภาพโทรศัพท์จากผู้ใช้ 1 พ.ย. 19:44 · `phase5/shots/p5_mobile_external.png` เทียบ `p5_portal.png` |
| P2 | ชื่อตัวแปร CSS ซ้ำแต่ความหมายต่าง: `--glow` (base = สี `#3cc8f5`, kiosk = box-shadow) · `--surface` (ขาว vs `#14161B`) · `--line` | `shared/base.css` vs `kiosk/kiosk.css` บรรทัด 18, 27, 29 — Kiosk โหลดทั้งสองไฟล์ |
| P3 | Admin แสดงเวลา `00:00` ในคอลัมน์ "วันจัด / สถานที่" ขณะที่ Kiosk/Mobile แสดง "ไม่ระบุเวลา" (กติกา D2 ของ Phase 5 ไม่ตรงกัน) | `phase5/shots/p5_admin_list.png` |
| P4 | หัวคอลัมน์/ค่าตัดบรรทัดผิดที่ในตารางหลังบ้าน: "เปิด/ดู", "รับ/สมัคร" | `p5_admin_list.png` |
| P5 | ลิงก์ "เปิดแผนที่" บนมือถือเป็นสีลิงก์เริ่มต้นของเบราว์เซอร์ (ไม่มีสไตล์ลิงก์ใน base.css) | `p5_mobile_external.png` |
| P6 | emoji แสดงต่างกันตามเครื่อง/OS · 🗓 แสดงเป็นกล่องว่างบน Linux (เปลี่ยนเป็น 📅 แล้วใน Phase 5) | Gate 5D portrait screenshot |
| P7 | จอแนวตั้ง 1080×1920: พื้นที่นำเสนอทุกหมวดเต็มจอบังอวตาร (มีตั้งแต่ Phase 1) | `phase5/shots/portrait_news_existing.png` |
| P8 | QR ทั่วไป (`/m/`) กับ QR ของกิจกรรม (`/m/?news=`) หน้าตาและป้ายแยกไม่ออก ผู้ใช้สแกนผิด | รายงานวินิจฉัย QR 1 พ.ย. 19:46 |
| P9 | สีกราฟในหลังบ้าน hard-code (ไม่ตามธีม) | `admin.js` บรรทัด 100 |
| P10 | สถานะเดียวกันใช้คำ/สีต่างกันระหว่างหน้าจอ (เช่น `--listen` = เขียว `#1f9d63` ใน base.css แต่ชมพู `#e5559e` ใน pastel · kiosk ใช้ `--state` แยกอีกชุด) | token ใน `base.css`, `pastel/kiosk.css`, `kiosk.css` |

## 3. Design System ที่เสนอ

### 3.1 โครงสร้างไฟล์
```
frontend/shared/tokens.css   ← ใหม่: token ทั้งหมดขึ้นต้น --vora-* (ไม่ชนชื่อเดิม)
frontend/shared/base.css     ← คงไว้ · ชื่อเดิมกลายเป็น alias ชี้ไป --vora-* (ทยอยเลิก)
frontend/shared/components.css ← ใหม่ (6B · ใช้จริงใน 6F/6G): ปุ่ม การ์ด ป้าย แท็บ ช่องกรอก ตาราง QR-card toast
frontend/shared/icons.js     ← ใหม่: ชุดไอคอน SVG inline (ไม่ต้องติดตั้งแพ็กเกจ)
frontend/shared/theme.js     ← ใหม่ (6B): applyTheme / currentTheme / token()
frontend/shared/design-system.html ← ใหม่ (6B): หน้าอ้างอิงสำหรับทีม /shared/design-system.html (token, ธีม, คอมโพเนนต์, ไอคอน)
```

### 3.2 Token (ร่าง — ค่าจริงหลังได้ D5/D6)
| กลุ่ม | ตัวอย่าง |
|---|---|
| Brand | `--vora-brand` (เหลือง #FFD400) · `--vora-brand-ink` (ดำ) · `--vora-brand-2` |
| พื้น/พื้นผิว | `--vora-bg` · `--vora-surface-1/2/3` · `--vora-border` · `--vora-border-strong` |
| ตัวอักษร | `--vora-text` · `--vora-text-muted` · `--vora-text-on-brand` |
| สถานะ | `--vora-ok` · `--vora-warn` · `--vora-danger` · `--vora-info` · สถานะ AI: `--vora-state-listen/think/speak` (ค่าเดียวทุกหน้าจอ) |
| ตัวอักษร | `--vora-font-display` · `--vora-font-body` · ขนาด `--vora-fs-xs…3xl` (มาตรา 1.2) · kiosk ขยายด้วย `--vora-scale` |
| ระยะ/มุม/เงา | `--vora-space-1…8` (4px base) · `--vora-radius-sm/md/lg/pill` · `--vora-shadow-1/2` · `--vora-focus-ring` |
| การเคลื่อนไหว | `--vora-dur-fast/base/slow` · `prefers-reduced-motion` |

กติกาความเฉพาะเจาะจง (พบใน 6B): คอมโพเนนต์หลักใช้ class เดี่ยว `.vora-*` เพื่อชนะกฎ `button, input {color/font: inherit}` ของ base.css · selector ทุกตัวต้องมี class `.vora-*`

ธีม: `[data-vora-theme="dark"]` (Kiosk — ป้ายดิจิทัลในที่สว่างจ้า/ระยะไกล) · `[data-vora-theme="light"]` (Mobile/Admin — อ่านง่ายบนโทรศัพท์/งานเอกสาร) — **แบรนด์ ฟอนต์ ไอคอน มุมโค้ง คอมโพเนนต์ เหมือนกัน** ต่างกันเฉพาะพื้นหลัง/ความสว่าง

### 3.3 กติกา
- Contrast ตัวอักษร ≥ 4.5:1 (WCAG AA) · เหลืองบนขาวห้ามใช้เป็นตัวอักษร (ใช้ดำบนเหลือง)
- เป้าแตะ Kiosk ≥ 64 px · Mobile ≥ 44 px · ตัวอักษรเนื้อหา Kiosk ≥ 20 px
- ข้อความสถานะใช้คำเดียวกันทุกหน้าจอ (ไม่ระบุเวลา / ไม่ระบุสถานที่ / ออนไลน์ …) จากไฟล์ข้อความร่วม
- QR ทุกจุดมีป้ายบอกปลายทาง ("คุยกับวอร่าบนมือถือ" vs "รายละเอียดกิจกรรมนี้")

## 4. แผนนำไปใช้ (ไม่รื้อ)

| Gate | ทำ | วิธีพิสูจน์ว่าไม่พัง |
|---|---|---|
| 6B | สร้าง tokens / ธีม dark-light / components / icons / หน้าอ้างอิง Design System · โหลดผ่าน `base.css` ทุกหน้า · **ไม่เปลี่ยนหน้าตาใด ๆ** · ไม่แก้ HTML/CSS ของแต่ละหน้า | computed style ทุก element ก่อน/หลังเท่ากัน + เทียบภาพหน้าที่คงที่ · เบราว์เซอร์ 150/150 · pytest 93 + กรณีใหม่ |
| 6F | Mobile → light theme ของแบรนด์ · Admin → components ร่วม + แก้ P3 P4 P5 P9 | ภาพหน้าจอ · Gate 5 ข้อ 10–11 · contrast |
| 6G | Kiosk → token ร่วม (dark) · emoji → SVG (P6) · ป้าย QR (P8) · จอแนวตั้ง (P7 ถ้าอนุมัติ D10) | Gate 1–5 ทั้งหมด · ไม่บังอวตาร |

`/pastel/` และ `/classic/` ไม่ถูกแก้ (D8) — ทั้งสองโหลด `/shared/base.css` ร่วมกัน จึงได้รับ token ใหม่ด้วย แต่ token ใช้ชื่อ `--vora-*` ที่ไม่มีหน้าเดิมใช้ → ต้องพิสูจน์ว่าหน้าตาไม่เปลี่ยน (6B)
