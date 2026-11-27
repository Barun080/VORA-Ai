@echo off
chcp 65001 >nul
title VORA - PostgreSQL Setup
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
echo Checking database driver...
pip install -q -r backend\requirements.txt
if errorlevel 1 (
  echo [ERROR] Package install failed. Check internet connection and try again.
  pause
  exit /b 1
)
python scripts\setup_postgres.py %*
pause
