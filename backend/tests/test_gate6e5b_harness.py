"""Phase 6 · Gate 6E-5B — Gemini-only harness (ออฟไลน์ · ไม่มีเครือข่าย · ไม่มีคีย์จริง)

ตรวจส่วนของ scripts/bakeoff_6e0.py ที่เพิ่มสำหรับ Gemini-only (gemini-check / gemini-smoke / gemini-validate)
การรันชุดจำลองเต็มทำด้วย `python scripts/bakeoff_6e0.py gemini-selftest`
"""
import importlib.util
import json
from pathlib import Path

import httpx
import pytest

from app.ai.llm import DEFAULT_MODELS

ROOT = Path(__file__).resolve().parents[2]
FAKE = "AIzaFAKEFAKEFAKEFAKEFAKEFAKE0000"


def _harness():
    spec = importlib.util.spec_from_file_location("bakeoff_6e5b_test", ROOT / "scripts" / "bakeoff_6e0.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_h5b_modes_and_constants():
    h = _harness()
    assert h.GEMINI_MODES == ("gemini-smoke", "gemini-validate", "gemini-diagnose")
    assert h.GEMINI_HOST == "generativelanguage.googleapis.com"
    assert [c["id"] for c in h.SMOKE_CASES] == ["SMK-GEN", "FF-02"]
    assert "haiku" in h.CONFIGS                                       # behavior เดิมของ bake-off ยังอยู่
    cfg = h._gemini_cfg(type("A", (), {"model": "gemini-x", "thinking": None})())
    assert cfg["provider"] == "gemini" and cfg["model"] == "gemini-x" and cfg["thinking"] is None


def test_h5b_production_model_read_without_importing_app():
    assert _harness()._production_gemini_model() == DEFAULT_MODELS["gemini"]


def test_h5b_scrub_removes_key_and_key_patterns():
    h = _harness()
    s = h._scrub(f"error for {FAKE} and AIzaOTHEROTHEROTHEROTHER12345 user-key", "user-key")
    assert FAKE not in s and "AIzaOTHER" not in s and "user-key" not in s and s.count("[REDACTED]") == 3


def test_h5b_model_check_uses_header_only_and_scrubs_errors(monkeypatch):
    h = _harness()
    seen = {}

    def fake_get(url, headers=None, timeout=None):
        seen.update(url=url, headers=headers)
        return httpx.Response(404, json={"error": {"status": "NOT_FOUND", "message": f"model gone (key {FAKE})"}})
    monkeypatch.setattr(httpx, "get", fake_get)
    r = h._check_model("gemini-2.5-flash", FAKE, dry=False)
    assert seen["url"] == "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash"
    assert FAKE not in seen["url"] and seen["headers"] == {"x-goog-api-key": FAKE}
    assert r["status"] == 404 and FAKE not in r["error"] and "NOT_FOUND" in r["error"]


def test_h5b_model_check_ok_reports_generate_content(monkeypatch):
    h = _harness()
    monkeypatch.setattr(httpx, "get", lambda *a, **k: httpx.Response(200, json={
        "name": "models/gemini-3.8-flash", "supportedGenerationMethods": ["generateContent", "countTokens"],
        "inputTokenLimit": 1048576, "outputTokenLimit": 65536}))
    r = h._check_model("gemini-3.8-flash", FAKE, dry=False)
    assert r["status"] == 200 and r["generateContent"] is True and r["outputTokenLimit"] == 65536


def _row(**kw):
    base = {"case_id": "X", "category": "c", "expect": "any", "q": "q", "http_status": 200, "llm_calls": [], "guard": [],
            "markers": [], "context_titles": [], "final": {"provider": "rules", "answered": True},
            "contract": {"answer_source": "rules", "verification": "official", "notice": None}, "contract_keys_ok": True,
            "final_text": "", "e2e_ms": 10}
    base.update(kw)
    return base


def _call(**kw):
    base = {"kind": "compose", "status": 200, "latency_ms": 900, "error": "", "finish": "STOP",
            "usage": {"in": 100, "out": 20, "thinking": 0}, "text": "ok", "host": "generativelanguage.googleapis.com",
            "payload_leaks": 0, "key_in_url": False, "key_header": True}
    base.update(kw)
    return base


def _write(tmp_path, rows, stopped=""):
    (tmp_path / "results_gemini-only.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
                                                        encoding="utf-8")
    (tmp_path / "meta_gemini-only.json").write_text(json.dumps({
        "model": "gemini-3.8-flash", "thinking": None, "mode": "gemini-validate", "calls": 1, "dry": True,
        "stopped": stopped, "cases": len(rows)}), encoding="utf-8")


def test_h5b_report_clean_run_has_no_blocking(tmp_path):
    h = _harness()
    _write(tmp_path, [_row(llm_calls=[_call()]), _row(expect="router_block",
                                                       contract={"answer_source": "refusal", "verification": "none", "notice": None})])
    rep = h.gemini_report(tmp_path)
    assert rep["blocking"] == [] and rep["safety"]["router_block_zero_calls"] == 1
    assert rep["provider_latency_s"]["p50"] == 0.9 and rep["usage_tokens"] == {"in": 100, "out": 20, "thinking": 0}
    assert (tmp_path / "review_sheet.csv").exists()


@pytest.mark.parametrize("bad,expect", [
    (dict(llm_calls=[_call(host="api.anthropic.com")]), "ไม่ใช่ Gemini"),
    (dict(llm_calls=[_call(payload_leaks=1)]), "ข้อมูลต้องห้าม"),
    (dict(llm_calls=[_call(key_in_url=True)]), "ข้อมูลต้องห้าม"),
    (dict(expect="router_block", llm_calls=[_call()]), "unsafe/injection"),
    (dict(expect="kb_injection", markers=["MK1"], final_text="ok MK1", llm_calls=[_call()]), "kb_injection"),
    (dict(http_status=500), "crash"),
    (dict(contract_keys_ok=False), "contract v2"),
    (dict(guard=[{"ok": False, "codes": ["G4"]}], final={"provider": "llm:gemini", "answered": True},
          contract={"answer_source": "ai_from_knowledge", "verification": "ai_guarded", "notice": None}), "Guard reject"),
])
def test_h5b_report_flags_every_blocking_condition(tmp_path, bad, expect):
    h = _harness()
    _write(tmp_path, [_row(**bad)])
    rep = h.gemini_report(tmp_path)
    assert any(expect in b for b in rep["blocking"]), rep["blocking"]


def test_h5b_report_flags_quota_stop(tmp_path):
    h = _harness()
    _write(tmp_path, [_row(llm_calls=[_call(status=429, error="RESOURCE_EXHAUSTED", finish="")])], stopped="quota_429")
    rep = h.gemini_report(tmp_path)
    assert rep["http_status"] == {"429": 1} and any("quota_429" in b for b in rep["blocking"])


def test_h5b_diagnose_dry_plan_and_timeouts_stay_in_test_process(tmp_path):
    """gemini-diagnose (dry): 5 คำขอจำลอง · timeout 4/6/8 ใช้ใน process ทดสอบเท่านั้น · ไม่มีคีย์ในไฟล์ผล"""
    import argparse
    h = _harness()
    base = h.gemini_diagnose(argparse.Namespace(model="gemini-3.8-flash", rpm=6, out=str(tmp_path / "d")), dry=True)
    d = json.loads((base / "diagnose.json").read_text(encoding="utf-8"))
    assert [(r["path"], r["timeout"], r["thinking"]) for r in d["results"]] == [
        ("vora", 4.0, "production"), ("vora", 6.0, "production"), ("vora", 8.0, "production"),
        ("direct", 30.0, "production"), ("vora", 8.0, "low")]
    for sub, t in (("vora_t4", 4.0), ("vora_t6", 6.0), ("vora_t8", 8.0), ("vora_t8_low", 8.0)):
        meta = json.loads((base / sub / "meta_gemini-only.json").read_text(encoding="utf-8"))
        assert meta["llm_timeout_s"] == t and meta["ai_budget_s"] == 8.0 and meta["prod_timing"] is False
    payload = (base / "payload.json").read_text(encoding="utf-8")
    assert "systemInstruction" in payload and "thinkingConfig" not in payload
    import os
    assert os.environ.get("VORA_LLM_TIMEOUT") not in ("6.0", "8.0")   # ค่าวินิจฉัยไม่รั่วออกมาที่ process หลัก


def test_h5b_thinking_rebuild_recomputes_content_length():
    """บั๊กที่พบใน gemini-diagnose แถว thinking=minimal: request ใหม่ต้องมี Content-Length ตรงกับ body ใหม่"""
    src = (ROOT / "scripts" / "bakeoff_6e0.py").read_text(encoding="utf-8")
    assert 'k.lower() != "content-length"' in src
    old = httpx.Request("POST", "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent",
                        headers={"x-goog-api-key": "fake-key-0000"}, json={"generationConfig": {"maxOutputTokens": 350}})
    body = json.loads(old.content)
    body["generationConfig"]["thinkingConfig"] = {"thinkingLevel": "minimal"}
    new_content = json.dumps(body).encode("utf-8")
    headers = [(k, v) for k, v in old.headers.multi_items() if k.lower() != "content-length"]
    new = httpx.Request(old.method, old.url, headers=headers, content=new_content)
    assert int(new.headers["content-length"]) == len(new_content) != int(old.headers["content-length"])
    assert new.headers["x-goog-api-key"] == "fake-key-0000"


def test_h5b_thinking_path_sends_without_protocol_error():
    """ส่ง request ที่สร้างใหม่ผ่าน h11 จริง (เซิร์ฟเวอร์ loopback ในเครื่อง) — ต้องไม่เกิด LocalProtocolError"""
    import asyncio
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer
    got = {}

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            n = int(self.headers["Content-Length"])
            got["body"] = json.loads(self.rfile.read(n))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *a):
            pass
    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.handle_request, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_port}/v1beta/models/m:generateContent"
    old = httpx.Request("POST", url, json={"generationConfig": {"maxOutputTokens": 350}})
    body = json.loads(old.content)
    body["generationConfig"]["thinkingConfig"] = {"thinkingLevel": "minimal"}
    headers = [(k, v) for k, v in old.headers.multi_items() if k.lower() != "content-length"]
    new = httpx.Request(old.method, old.url, headers=headers, content=json.dumps(body).encode("utf-8"))

    async def send():
        async with httpx.AsyncHTTPTransport() as t:
            r = await t.handle_async_request(new)
            await r.aread()
            return r.status_code
    assert asyncio.run(send()) == 200
    assert got["body"]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "minimal"}
    srv.server_close()


def test_h5b_diagnose_rejects_minimal_and_defaults_to_low():
    import subprocess
    import sys
    script = str(ROOT / "scripts" / "bakeoff_6e0.py")
    r = subprocess.run([sys.executable, script, "gemini-diagnose", "--model", "m", "--diag-thinking", "minimal"],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    assert r.returncode != 0 and "invalid choice" in r.stderr                    # ไม่ถามคีย์ ไม่ส่งคำขอ
    assert "plan = [" in (ROOT / "scripts" / "bakeoff_6e0.py").read_text(encoding="utf-8")
