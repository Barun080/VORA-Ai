@echo off
chcp 65001 >nul
title VORA - Retire seed sample data
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem   retire_seed_samples.bat              = ดูอย่างเดียว (ไม่แก้อะไร)
rem   retire_seed_samples.bat --apply      = สำรองฐานข้อมูล แล้วทำจริง
rem   retire_seed_samples.bat --undo FILE  = ย้อนกลับจากไฟล์ใน data\backups
if /i not "%~1"=="--apply" goto run
echo [1/2] Backing up database...
python scripts\backup_db.py
if errorlevel 1 (
  echo *** Backup failed - stopped. Database was not changed. ***
  pause
  exit /b 1
)
echo.
echo [2/2] Applying...
:run
python scripts\retire_seed_samples.py %*
pause
