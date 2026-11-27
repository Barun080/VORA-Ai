"""Phase 6 · Gate 6B — Unified Design Foundation (ตรวจไฟล์ frontend/shared โดยไม่ต้องเปิดเบราว์เซอร์)

ยืนยันว่า: token ใช้ชื่อ --vora-* เท่านั้นและไม่ชนกับตัวแปรเดิม · คอมโพเนนต์จับเฉพาะ class .vora-* (หน้าเดิมไม่ได้รับผล)
ธีม light/dark มีชุดสีครบเท่ากัน · contrast ผ่าน WCAG AA · ฟอนต์หลัก Anuphan มีไฟล์ในเครื่อง · ไอคอนไม่มีลิงก์ภายนอก
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FE = ROOT / "frontend"
SHARED = FE / "shared"
TOKENS = SHARED / "tokens.css"
COMPONENTS = SHARED / "components.css"
BASE = SHARED / "base.css"
ICONS = SHARED / "icons.js"

DECL = re.compile(r"(--[\w-]+)\s*:\s*([^;]+);")


def _strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def _blocks(css: str) -> dict[str, dict[str, str]]:
    """selector -> {ตัวแปร: ค่า} (เฉพาะบล็อกระดับบนสุด)"""
    out: dict[str, dict[str, str]] = {}
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", _strip_comments(css)):
        out.setdefault(sel.strip(), {}).update({k: v.strip() for k, v in DECL.findall(body)})
    return out


def _split_top(group: str) -> list[str]:
    """แยก selector ด้วยจุลภาคระดับบนสุดเท่านั้น (ไม่แยกภายใน :where(...))"""
    parts, depth, cur = [], 0, ""
    for ch in group:
        depth += ch == "("
        depth -= ch == ")"
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    return parts + [cur]


def _hex(v: str) -> tuple[float, float, float] | None:
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", v.strip())
    return tuple(int(m.group(1)[i:i + 2], 16) / 255 for i in (0, 2, 4)) if m else None


def _lum(rgb):
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4  # noqa: E731
    r, g, b = (f(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a: str, b: str) -> float:
    la, lb = sorted((_lum(_hex(a)), _lum(_hex(b))), reverse=True)
    return (la + 0.05) / (lb + 0.05)


@pytest.fixture(scope="module")
def blocks():
    return _blocks(TOKENS.read_text(encoding="utf-8"))


def test_files_exist_and_base_imports_them_first():
    for f in (TOKENS, COMPONENTS, ICONS, SHARED / "theme.js", SHARED / "design-system.html"):
        assert f.exists(), f
    rules = [ln.strip() for ln in _strip_comments(BASE.read_text(encoding="utf-8")).splitlines() if ln.strip()]
    assert rules[0] == '@import url("/shared/tokens.css");'
    assert rules[1] == '@import url("/shared/components.css");'


def test_tokens_only_declare_vora_prefix(blocks):
    names = [k for decls in blocks.values() for k in decls]
    assert names and all(n.startswith("--vora-") for n in names), [n for n in names if not n.startswith("--vora-")]
    assert set(blocks) == {":root", '[data-vora-theme="light"]', '[data-vora-theme="dark"]'}


def test_no_variable_collision_with_existing_css():
    """ไฟล์ CSS/หน้าเดิมทุกไฟล์ (รวม pastel/classic) ต้องไม่ประกาศ --vora-* และ token ต้องไม่ประกาศชื่อเดิม"""
    others = [p for p in FE.rglob("*") if p.suffix in (".css", ".html") and p not in (TOKENS, COMPONENTS)
              and "vendor" not in p.parts and p.name != "design-system.html"]
    assert len(others) >= 8
    for p in others:
        assert not re.search(r"--vora-[\w-]+\s*:", _strip_comments(p.read_text(encoding="utf-8"))), p
    old = {k for p in others for k, _ in DECL.findall(_strip_comments(p.read_text(encoding="utf-8")))}
    assert {"--glow", "--surface", "--line"} <= old            # ตัวแปรเดิมยังอยู่ (ไม่ได้ลบ/เปลี่ยน)
    new = {k for decls in _blocks(TOKENS.read_text(encoding="utf-8")).values() for k in decls}
    assert not (new & old)


def test_components_only_target_vora_classes():
    """ทุก selector ของ components.css ต้องเริ่มที่ class .vora-* (ตรง ๆ หรือใน :where) → ไม่มีผลกับ element ที่ไม่มี class vora-*"""
    css = _strip_comments(COMPONENTS.read_text(encoding="utf-8"))
    css = re.sub(r"@media[^{]*\{", "", css)
    selectors = [s.strip() for s in re.findall(r"([^{}]+)\{[^{}]*\}", css) if s.strip()]
    assert len(selectors) > 40
    # คอมโพเนนต์ที่เป็น <button>/<input> ต้องชนะกฎ element ของ base.css (button, input { color/font: inherit })
    for root in (".vora-btn {", ".vora-btn--primary {", ".vora-tab {", ".vora-input {", ".vora-link {"):
        assert root in css, root
    for group in selectors:
        for sel in _split_top(group):
            sel = sel.strip()
            if not sel:
                continue
            assert sel.startswith((".vora-", ":where(.vora-")), sel
            assert not re.search(r"(^|[\s>+~])(html|body|button|input|select|textarea|a|h[1-6]|\*)(?=[\s:.\[#{]|$)", sel.split(":where(")[0]), sel
    assert not re.search(r"#[0-9a-fA-F]{3,6}\b", css), "components.css ต้องใช้ token ไม่ hard-code สี"


def test_light_and_dark_define_same_color_tokens(blocks):
    light, dark = blocks['[data-vora-theme="light"]'], blocks['[data-vora-theme="dark"]']
    assert set(light) == set(dark) and len(light) >= 20
    assert light["--vora-bg"] != dark["--vora-bg"] and light["--vora-text"] != dark["--vora-text"]
    assert set(light) <= set(blocks[":root"])                 # :root มีค่าตั้งต้นของทุกตัวแปรสี


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_contrast_wcag_aa(blocks, theme):
    t = {**blocks[":root"], **blocks[f'[data-vora-theme="{theme}"]']}
    pairs = [("--vora-text", "--vora-bg"), ("--vora-text", "--vora-surface-1"), ("--vora-text", "--vora-surface-2"),
             ("--vora-text-muted", "--vora-bg"), ("--vora-text-muted", "--vora-surface-1"), ("--vora-text-muted", "--vora-surface-2"),
             ("--vora-link", "--vora-surface-1"), ("--vora-text-accent", "--vora-surface-1"), ("--vora-on-brand", "--vora-brand"),
             ("--vora-ok", "--vora-surface-1"), ("--vora-warn", "--vora-surface-1"), ("--vora-danger", "--vora-surface-1"),
             ("--vora-info", "--vora-surface-1"), ("--vora-on-danger", "--vora-danger"), ("--vora-on-ink", "--vora-ink")]
    low = [(a, b, round(_contrast(t[a], t[b]), 2)) for a, b in pairs if _contrast(t[a], t[b]) < 4.5]
    assert not low, low


def test_primary_font_is_anuphan_and_files_are_local():
    root = _blocks(TOKENS.read_text(encoding="utf-8"))[":root"]
    assert root["--vora-font-body"].startswith('"Anuphan"') and root["--vora-font-display"].startswith('"Anuphan"')
    srcs = re.findall(r'font-family:\s*"Anuphan"[^}]*src:\s*url\(([^)]+)\)', BASE.read_text(encoding="utf-8"))
    assert len(srcs) >= 8
    for s in srcs:
        assert s.startswith("/assets/vendor/fonts/") and (FE / s.lstrip("/")).exists(), s


def test_icons_are_local_svg_without_external_links():
    js = ICONS.read_text(encoding="utf-8")
    names = re.findall(r'^\s*"?([\w-]+)"?:\s*\'<', js, flags=re.M)
    assert len(names) >= 30 and len(set(names)) == len(names)
    for need in ("pin", "online", "calendar", "clock", "qr", "map", "mic", "mic-off", "wifi-off", "info", "alert", "back", "close"):
        assert need in names
    assert "http://" not in js and "https://" not in js.replace("http://www.w3.org", "")
    for f in (TOKENS, COMPONENTS, SHARED / "theme.js"):
        assert "url(http" not in f.read_text(encoding="utf-8")
