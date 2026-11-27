// Holographic Core — เอฟเฟกต์ด้านหลังอวตาร VORA (8 พ.ย. 2569)
// ทุกชั้นเป็น HTML/SVG ขนาดเล็ก + CSS Animation (transform/opacity บน Compositor) — ไม่มี canvas ไม่มี WebGL ไม่มี requestAnimationFrame
// สีและความเร็วตามสถานะอวตารมาจาก CSS (.app[data-avatar] → --state) · ความดังเสียงมาจาก Event เดิม AVATAR_MOUTH
// (ระดับเสียงที่ voice.js ส่งให้ปากอวตารอยู่แล้ว) — ไม่สร้างตัววิเคราะห์เสียงหรือเปิดไมโครโฟนเพิ่ม
//
// ชั้น (หลัง → หน้า ทั้งหมดอยู่หลังตัวอวตาร): แสงนุ่ม · Energy Core · ตารางพื้น + เส้นสแกน · วงแหวนพลังงาน/วงโคจร/วงสแกน · จุดข้อมูล + เส้นเชื่อม · อนุภาค

import { EV } from "../core/event-bus.js";

// ตำแหน่งคงที่ (ไม่สุ่มทุกครั้ง ภาพเหมือนเดิมทุกเครื่อง) — x, y เป็น % ของกรอบ Core, d = หน่วงเวลา (วินาที)
const PARTICLES = [
  [12, 30, 0], [22, 70, 2.5], [30, 14, 5], [78, 18, 1.2], [88, 46, 3.6], [70, 82, 6.1],
  [8, 58, 4.4], [92, 72, 7.3], [40, 90, 1.8], [60, 8, 6.8], [18, 88, 3.1], [84, 30, 8.2],
];
const NODES = [[6, 40], [16, 18], [28, 76], [74, 12], [90, 34], [94, 64], [80, 86]];
const LINKS = [[0, 1], [0, 2], [3, 4], [4, 5], [5, 6]];

export class HoloCore {
  constructor(holo, bus) {
    this.root = document.createElement("div");
    this.root.className = "hc";
    this.root.setAttribute("aria-hidden", "true");
    const lines = LINKS.map(([a, b]) => `<line x1="${NODES[a][0]}" y1="${NODES[a][1]}" x2="${NODES[b][0]}" y2="${NODES[b][1]}"/>`).join("");
    this.root.innerHTML = `
      <div class="hc-glow"></div>
      <div class="hc-grid"><i class="hc-scan"></i></div>
      <div class="hc-core">
        <div class="hc-react">
          <div class="hc-energy"></div>
          <svg class="hc-hex" viewBox="0 0 100 100"><polygon points="50,2 92,26 92,74 50,98 8,74 8,26"/><polygon points="50,14 82,32 82,68 50,86 18,68 18,32"/></svg>
          <div class="hc-ring hc-r1"></div>
          <div class="hc-ring hc-r2"></div>
          <div class="hc-ring hc-r3"></div>
          <div class="hc-ring hc-scanring"></div>
          <div class="hc-orbit hc-o1"><i></i></div>
          <div class="hc-orbit hc-o2"><i></i></div>
        </div>
        <div class="hc-sweep"></div>
        <div class="hc-net"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>
          ${NODES.map(([x, y], i) => `<i class="hc-node" style="left:${x}%;top:${y}%;--d:${(i * 0.7).toFixed(1)}s"></i>`).join("")}</div>
        ${PARTICLES.map(([x, y, d]) => `<i class="hc-dot" style="left:${x}%;top:${y}%;--d:${d}s"></i>`).join("")}
      </div>`;
    holo.appendChild(this.root);
    this.level = 0;
    // ระดับเสียง 0..1 จากตัวพูดเดิม → ตัวแปร CSS (ปรับให้นุ่มด้วยค่าเฉลี่ยเคลื่อนที่ + transition ใน CSS) · ไม่มีเสียงนาน 250ms = กลับ 0
    this.off = bus.on(EV.AVATAR_MOUTH, (lvl) => {
      const v = Math.max(0, Math.min(1, +lvl || 0));
      this.level = this.level * 0.6 + v * 0.4;
      this.root.style.setProperty("--lvl", this.level.toFixed(2));
      clearTimeout(this.decay);
      this.decay = setTimeout(() => { this.level = 0; this.root.style.setProperty("--lvl", "0"); }, 250);
    });
  }

  /** ป้องกันเครื่องช้า: วัดอัตราเฟรมของหน้าจอครั้งเดียว 3 วินาที (หลังเริ่ม 10 วิ ให้โหลดโมเดลกล้องเสร็จก่อน) ถ้าต่ำกว่า minFps (30) → โหมดเบา (หยุดแอนิเมชันของเอฟเฟกต์ทั้งหมด)
   *  วงวัดหยุดเองหลังวัดเสร็จ ไม่มีวงรอบค้าง · ระบบกล้อง/อวตาร/เสียงไม่ถูกแตะ — ลดเอฟเฟกต์ก่อนเสมอ */
  autoLite({ delayMs = 10000, sampleMs = 3000, minFps = 30 } = {}) {
    this.liteTimer = setTimeout(() => {
      if (document.hidden) return;
      let frames = 0;
      const t0 = performance.now();
      const step = (now) => {
        frames++;
        if (now - t0 < sampleMs) { requestAnimationFrame(step); return; }
        this.fps = Math.round((frames * 1000) / (now - t0));
        if (this.fps < minFps) this.root.classList.add("lite");
        this.root.dataset.fps = String(this.fps);
      };
      requestAnimationFrame(step);
    }, delayMs);
  }

  destroy() {
    clearTimeout(this.liteTimer);
    this.off && this.off();
    clearTimeout(this.decay);
    this.root.remove();
  }
}
