"""24 พ.ย. 2569: อ่าน/เขียนไฟล์ Excel (.xlsx) แบบง่ายด้วยไลบรารีมาตรฐานของ Python (ไม่ต้องติดตั้ง openpyxl)

write(sheets) → bytes          sheets = [(ชื่อแผ่นงาน, [[ข้อความ, ...], ...], ความกว้างคอลัมน์ list|None)]
read(data)    → {ชื่อแผ่นงาน: [[ข้อความ, ...], ...]}   อ่านได้ทั้งข้อความ (shared/inline) และตัวเลข
รองรับเฉพาะข้อความและตัวเลขพื้นฐาน — พอสำหรับแม่แบบนำเข้าข้อมูล
"""
from __future__ import annotations

import io
import re
import zipfile
from typing import Optional
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "pr": "http://schemas.openxmlformats.org/package/2006/relationships"}
MAX_ROWS = 2000
MAX_UNZIPPED = 30 * 1024 * 1024                      # กันไฟล์บีบอัดที่ขยายใหญ่ผิดปกติ


def _col(n: int) -> str:
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _col_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref or "A")
    n = 0
    for ch in letters.group(0) if letters else "A":
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _clean(text: str) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(text))


def write(sheets: list[tuple]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        n = len(sheets)
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   + "".join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(n))
                   + "</Types>")
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   "</Relationships>")
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join(f'<sheet name="{escape(_clean(s[0])[:31], {chr(34): "&quot;"})}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, s in enumerate(sheets))
                   + "</sheets></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>' for i in range(n))
                   + f'<Relationship Id="rId{n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   "</Relationships>")
        # สไตล์ 0 = ปกติ (ตัดบรรทัด) · 1 = หัวตาราง (ตัวหนา พื้นเหลือง)
        z.writestr("xl/styles.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts>'
                   '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
                   '<fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"/><bgColor indexed="64"/></patternFill></fill></fills>'
                   '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
                   '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                   '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
                   '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>'
                   "</styleSheet>")
        for i, sheet in enumerate(sheets):
            rows = sheet[1]
            widths: Optional[list] = sheet[2] if len(sheet) > 2 else None
            cols = ("<cols>" + "".join(f'<col min="{j + 1}" max="{j + 1}" width="{w}" customWidth="1"/>' for j, w in enumerate(widths)) + "</cols>") if widths else ""
            body = []
            for r, row in enumerate(rows):
                cells = "".join(
                    f'<c r="{_col(c)}{r + 1}" t="inlineStr" s="{1 if r == 0 else 0}"><is><t xml:space="preserve">{escape(_clean(v))}</t></is></c>'
                    for c, v in enumerate(row) if v not in (None, ""))
                body.append(f'<row r="{r + 1}">{cells}</row>')
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml",
                       '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                       '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                       '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
                       + cols + "<sheetData>" + "".join(body) + "</sheetData></worksheet>")
    return buf.getvalue()


def _text(el) -> str:
    return "".join(t.text or "" for t in el.iter(f"{{{NS['m']}}}t"))


def read(data: bytes) -> dict[str, list[list[str]]]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise ValueError("ไฟล์ไม่ใช่ Excel (.xlsx)") from e
    if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED:
        raise ValueError("ไฟล์ Excel ใหญ่เกินไป")
    names = set(z.namelist())
    if "xl/workbook.xml" not in names:
        raise ValueError("ไฟล์ไม่ใช่ Excel (.xlsx)")
    shared: list[str] = []
    if "xl/sharedStrings.xml" in names:
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        shared = [_text(si) for si in root.findall("m:si", NS)]
    rels = {}
    if "xl/_rels/workbook.xml.rels" in names:
        for rel in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).findall("pr:Relationship", NS):
            t = rel.get("Target", "")
            t = t.lstrip("/")
            rels[rel.get("Id")] = t if t.startswith("xl/") else "xl/" + t
    out: dict[str, list[list[str]]] = {}
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    for sh in wb.findall("m:sheets/m:sheet", NS):
        path = rels.get(sh.get(f"{{{NS['r']}}}id"), "")
        if path not in names:
            continue
        rows: list[list[str]] = []
        for row in ET.fromstring(z.read(path)).iter(f"{{{NS['m']}}}row"):
            if len(rows) >= MAX_ROWS:
                break
            vals: list[str] = []
            for c in row.findall("m:c", NS):
                i = _col_index(c.get("r", ""))
                t = c.get("t", "")
                if t == "inlineStr":
                    v = _text(c)
                else:
                    ve = c.find("m:v", NS)
                    v = ve.text if ve is not None and ve.text else ""
                    if t == "s" and v.isdigit() and int(v) < len(shared):
                        v = shared[int(v)]
                    elif t not in ("s", "str") and re.fullmatch(r"-?\d+\.0+", v or ""):
                        v = v.split(".")[0]
                while len(vals) <= i:
                    vals.append("")
                vals[i] = (v or "").strip()
            rows.append(vals)
        out[sh.get("name", "")] = rows
    return out
