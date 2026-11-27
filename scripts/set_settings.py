"""ตั้งค่าข้อมูลวิทยาลัยในหลังบ้าน (การตั้งค่า) จากไฟล์ที่ตรวจกับแหล่งทางการแล้ว (27 พ.ย. 2569)

ไฟล์ข้อมูลอยู่ที่ data/settings/*.json — แต่ละช่องมีค่าใหม่ + แหล่งอ้างอิง
ทำอะไร: แสดงค่าเดิม → ค่าใหม่ · --apply จึงบันทึกจริง (เก็บค่าเดิมไว้ที่ data/backups/set_settings_*.json ย้อนกลับได้ด้วย --undo)
ช่องที่เจ้าหน้าที่กรอกเองไว้แล้ว (ไม่ว่าง และไม่ใช่ค่าตัวอย่าง) จะไม่ถูกทับ เว้นแต่ใส่ --overwrite

    python scripts\\set_settings.py data\\settings\\20261127_college_info.json             # ดูอย่างเดียว
    python scripts\\set_settings.py data\\settings\\20261127_college_info.json --apply     # ทำจริง
    python scripts\\set_settings.py --undo data\\backups\\set_settings_....json
หลังทำ: กด Ctrl+F5 ที่หน้าจอหุ่นยนต์ (ไม่ต้องรีสตาร์ต)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def _short(v, n: int = 110) -> str:
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    s = s.replace("\n", " | ")
    return s if len(s) <= n else s[:n] + "…"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--undo")
    a = ap.parse_args()
    from app.config import DATA_DIR
    from app.db import SessionLocal, wait_for_db
    from app.models import AuditLog, SettingKV
    from app.services import DEFAULT_SETTINGS, all_settings, set_setting
    wait_for_db(30)
    with SessionLocal() as db:
        if a.undo:
            data = json.loads(Path(a.undo).read_text(encoding="utf-8"))
            for k, row in data["before"].items():
                if row["exists"]:
                    set_setting(db, k, row["value"])
                else:
                    r = db.get(SettingKV, k)
                    if r:
                        db.delete(r)
            db.add(AuditLog(username="script", action="undo", entity="settings", entity_id="", detail={"file": Path(a.undo).name}))
            db.commit()
            print(f"คืนค่าเดิม {len(data['before'])} ช่อง")
            return 0
        if not a.file:
            ap.error("ระบุไฟล์ข้อมูล")
        spec = json.loads(Path(a.file).read_text(encoding="utf-8"))
        cur = all_settings(db)
        samples = spec.get("sample_values", {})
        before, changed = {}, []
        for k, item in spec["settings"].items():
            if k not in DEFAULT_SETTINGS:
                print(f"\n=== {k}: ไม่ใช่ช่องตั้งค่าที่รู้จัก — ข้าม")
                continue
            new, old = item["value"], cur.get(k)
            print(f"\n=== {k} ({item.get('label', '')})")
            print(f"  เดิม: {_short(old)}")
            print(f"  ใหม่: {_short(new)}")
            if item.get("source"):
                print(f"  แหล่ง: {item['source']}")
            if old == new:
                print("  (เหมือนเดิม — ข้าม)")
                continue
            # ค่าตัวอย่างจาก add_admission_samples.bat (admission_sample = จริง) ถือว่าไม่ใช่ข้อมูลที่เจ้าหน้าที่กรอก → แทนที่ได้
            is_sample = bool(item.get("replace_if_sample") and cur.get("admission_sample"))
            staff = old not in ("", None, DEFAULT_SETTINGS.get(k)) and old not in samples.get(k, []) and not is_sample
            if staff and not a.overwrite:
                print("  มีค่าที่เจ้าหน้าที่กรอกไว้แล้ว — ไม่ทับ (ใส่ --overwrite ถ้าต้องการแทนที่)")
                continue
            if a.apply:
                row = db.get(SettingKV, k)
                before[k] = {"exists": row is not None, "value": row.value if row else None}
                set_setting(db, k, new)
                changed.append(k)
        if a.apply and any(spec["settings"].get(k, {}).get("replace_if_sample") for k in changed) and cur.get("admission_sample"):
            row = db.get(SettingKV, "admission_sample")
            before["admission_sample"] = {"exists": row is not None, "value": row.value if row else None}
            set_setting(db, "admission_sample", False)       # ไม่มีค่าตัวอย่างเหลือแล้ว → ป้าย "ตัวอย่าง" ในหลังบ้านหายไป
        if not a.apply:
            print("\n(ดูอย่างเดียว — ยังไม่ได้แก้อะไร · ใส่ --apply เพื่อบันทึกจริง)")
            return 0
        out = DATA_DIR / "backups" / f"set_settings_{datetime.now():%Y%m%d-%H%M%S-%f}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"file": Path(a.file).name, "before": before}, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        db.add(AuditLog(username="script", action="update", entity="settings", entity_id="", detail={"file": Path(a.file).name, "keys": changed}))
        db.commit()
        print(f"\nบันทึกแล้ว {len(changed)} ช่อง: {', '.join(changed)}")
        print(f"ไฟล์สำรองสำหรับย้อนกลับ: {out}")
        print("ขั้นต่อไป: กด Ctrl+F5 ที่หน้าจอหุ่นยนต์")
    return 0


if __name__ == "__main__":
    sys.exit(main())
