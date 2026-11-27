// 24 พ.ย. 2569: กล่องตรวจข้อมูล (Sandbox) — การ์ดแต่ละรายการในหลังบ้าน
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIDENCE_TH, sandboxCard } from "../../admin/sandbox-view.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const badge = (s, l) => `<span class="badge ${s}">${l}</span>`;
const fmt = (d) => (d ? "วันที่" : "-");
const H = { esc, badge, fmt };
const base = { id: 7, question: "หัวหน้าแผนกช่างยนต์คือใคร", alt_questions: "ใครเป็นหัวหน้าแผนกช่างยนต์", answer_th: "ก", status: "pending",
  evidence: "U", data_year: "2569", reason: "ชื่อไม่ตรงกัน", sources: [{ title: "หน้าแผนก", url: "https://www.technicnan.ac.th/x" }],
  choices: [{ label: "หน้าเว็บ", answer_th: "นาย ก" }, { label: "ตาราง", answer_th: "นาย ข" }] };

test("แหล่งขัดกัน → มีตัวเลือกให้เลือก + ปุ่มอนุมัติเฉพาะผู้ดูแล", () => {
  const h = sandboxCard(base, { ...H, canApprove: true });
  assert.match(h, /type="radio" name="ch7" value="0" checked/);
  assert.match(h, /value="1"/);
  assert.match(h, /data-sb-ok="7"/);
  assert.match(h, /แหล่งขัดกัน/);
  assert.doesNotMatch(sandboxCard(base, { ...H, canApprove: false }), /data-sb-ok/);
});

test("ไม่มีตัวเลือก → แสดงคำตอบที่เสนอ · ปีของข้อมูล · ลิงก์เปิดแท็บใหม่", () => {
  const h = sandboxCard({ ...base, choices: [], evidence: "B", data_year: "2564", answer_th: "ตามข้อมูลปี 2564 อาคาร 1" }, H);
  assert.match(h, /คำตอบที่เสนอ/);
  assert.match(h, /ข้อมูลปี 2564/);
  assert.match(h, /target="_blank" rel="noopener noreferrer"/);
  assert.equal(EVIDENCE_TH.B[0], "ข้อมูลเก่า/กรอบส่วนกลาง");
});

test("กันสคริปต์: ข้อความถูก escape และลิงก์ที่ไม่ใช่ http(s) ถูกตัด", () => {
  const h = sandboxCard({ ...base, question: "<img src=x onerror=alert(1)>", sources: [{ title: "x", url: "javascript:alert(1)" }] }, H);
  assert.doesNotMatch(h, /<img src=x/);
  assert.doesNotMatch(h, /href="javascript:/);
});

test("ตรวจแล้ว → แสดงผู้ตรวจและปุ่มย้อนกลับ", () => {
  const h = sandboxCard({ ...base, status: "approved", reviewed_by: "admin", knowledge_id: 99 }, { ...H, canApprove: true });
  assert.match(h, /ความรู้ #99/);
  assert.match(h, /data-sb-reopen="7"/);
  assert.doesNotMatch(h, /data-sb-ok/);
});
