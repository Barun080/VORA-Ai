@echo off
chcp 65001 >nul
title VORA - Import sandbox candidates
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem   import_sandbox.bat              = ดูอย่างเดียว (ไม่แก้อะไร)
rem   import_sandbox.bat --apply      = สำรองฐานข้อมูล แล้วทำจริง
rem   import_sandbox.bat --undo FILE  = ย้อนกลับจากไฟล์ใน data\backups
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
python scripts\import_sandbox.py %*
pause
