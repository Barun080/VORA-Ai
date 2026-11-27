@echo off
chcp 65001 >nul
title VORA - Setup
cd /d "%~dp0"
echo ============================================
echo   VORA Smart PR Robot - first time setup
echo ============================================
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Install Python 3.11+ from https://www.python.org/downloads/
  echo         and tick "Add python.exe to PATH" during install.
  pause
  exit /b 1
)
python --version
if not exist ".venv" (
  echo Creating virtual environment...
  python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r backend\requirements.txt
if errorlevel 1 (
  echo [ERROR] Package install failed. Check internet connection and run setup.bat again.
  pause
  exit /b 1
)
if not exist ".env" copy .env.example .env >nul
echo Downloading vision models for offline use...
python scripts\download_models.py
echo.
choice /c YN /m "Install and connect PostgreSQL database now (recommended)"
if errorlevel 2 goto skip_pg
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
python scripts\setup_postgres.py
:skip_pg
echo.
echo Setup complete. Run start.bat to start VORA.
pause
