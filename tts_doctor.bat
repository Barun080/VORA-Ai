@echo off
chcp 65001 >nul
title VORA - Voice doctor
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem Tests the speech service and offers fixes. Close start.bat first if you choose to reinstall edge-tts.
python scripts\tts_doctor.py
echo.
pause
