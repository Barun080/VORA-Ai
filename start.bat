@echo off
chcp 65001 >nul
title VORA - Server
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
echo Starting VORA server...  (close this window to stop)
echo   Robot screen : http://localhost:8000/
echo   Admin        : http://localhost:8000/admin/
echo   Other PCs    : see the LAN addresses below (run lan_setup.bat once for https)
start "" /b cmd /c "timeout /t 4 >nul && start http://localhost:8000/admin/"
cd backend
:loop
REM 25 Nov 2026: serve.py = http 8000 + https 8443 (when data\certs exists) in one process
REM old command (http only): python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
python serve.py
echo Server stopped unexpectedly. Restarting in 3 seconds... (Ctrl+C to quit)
timeout /t 3 >nul
goto loop
