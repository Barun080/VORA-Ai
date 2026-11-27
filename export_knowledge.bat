@echo off
chcp 65001 >nul
title VORA - Export knowledge to CSV
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
echo Exporting VORA knowledge (read-only)...
echo.
python scripts\export_knowledge.py %*
if errorlevel 1 (
  echo.
  echo *** Export failed. Is PostgreSQL running? ***
  pause
  exit /b 1
)
if exist exports start "" explorer exports
pause
