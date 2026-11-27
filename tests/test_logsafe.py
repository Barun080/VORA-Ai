"""21 พ.ย. 2569 — log ปลอดภัยและอ่านง่าย: ปิดบังรหัสเข้าหลังบ้าน (token=) · ซ่อนบรรทัดตรวจเน็ตที่สำเร็จ"""
import logging

from app import logsafe
from app.config import settings

JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiJ9.KmOlL1Juc9IzItUFOFjt7b8Rw8kQPcxh5fLd"


def _rec(name, msg, args):
    return logging.LogRecord(name, logging.INFO, __file__, 1, msg, args, None)


def test_redact_token_in_query_and_bearer():
    assert logsafe.redact(f"/ws?role=admin&token={JWT}") == "/ws?role=admin&token=***"
    assert logsafe.redact(f"/api/x?token={JWT}&a=1") == "/api/x?token=***&a=1"
    assert logsafe.redact(f"Authorization: Bearer {JWT}") == "Authorization: Bearer ***"
    assert logsafe.redact("GET /admin/ HTTP/1.1") == "GET /admin/ HTTP/1.1"          # ข้อความทั่วไปไม่เปลี่ยน
    assert logsafe.redact("tokenizer ok") == "tokenizer ok"


def test_uvicorn_websocket_and_access_records_are_redacted():
    f = logsafe.RedactTokens()
    ws = _rec("uvicorn.error", '%s - "WebSocket %s" [accepted]', ("127.0.0.1:63286", f"/ws?role=admin&token={JWT}"))
    f.filter(ws)
    assert JWT not in ws.getMessage() and "token=***" in ws.getMessage()
    acc = _rec("uvicorn.access", '%s - "%s %s HTTP/%s" %d', ("127.0.0.1:1", "GET", f"/x?token={JWT}", "1.1", 200))
    f.filter(acc)
    assert JWT not in acc.getMessage() and acc.getMessage().endswith("200")


def test_hide_only_successful_net_probe_lines():
    f = logsafe.HideNetProbe()
    url = settings.net_check_urls[0]
    probe = _rec("httpx", 'HTTP Request: %s %s "%s %d %s"', ("GET", url, "HTTP/1.1", 204, "No Content"))
    other = _rec("httpx", 'HTTP Request: %s %s "%s %d %s"', ("POST", "https://generativelanguage.googleapis.com/x", "HTTP/1.1", 200, "OK"))
    assert f.filter(probe) is False
    assert f.filter(other) is True


def test_install_is_idempotent_and_covers_uvicorn_loggers():
    logsafe.install()
    logsafe.install()
    for name in ("uvicorn.access", "uvicorn.error", "httpx"):
        assert sum(isinstance(x, logsafe.RedactTokens) for x in logging.getLogger(name).filters) == 1
    assert sum(isinstance(x, logsafe.HideNetProbe) for x in logging.getLogger("httpx").filters) == 1


def test_admin_websocket_auth_still_works(client, admin_headers):
    token = admin_headers["Authorization"].split()[1]
    with client.websocket_connect(f"/ws?role=admin&token={token}") as ws:
        assert ws.receive_json()["topic"] == "hello"
