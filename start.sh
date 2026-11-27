#!/usr/bin/env bash
# VORA สำหรับ Linux / macOS / Raspberry Pi
set -e
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv; .venv/bin/pip install -r backend/requirements.txt; }
[ -f .env ] || cp .env.example .env
cd backend
exec ../.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
