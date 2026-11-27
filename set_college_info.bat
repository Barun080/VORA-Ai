@echo off
chcp 65001 >nul
title VORA - Set college info (settings)
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem   set_college_info.bat             = preview (no change)
rem   set_college_info.bat --apply     = backup database, then save
rem   set_college_info.bat --undo FILE = restore from data\backups\set_settings_....json
set F=data\settings\20261127_college_info.json
if /i "%~1"=="--undo" (
  python scripts\set_settings.py --undo "%~2"
  pause
  exit /b 0
)
if /i not "%~1"=="--apply" (
  python scripts\set_settings.py %F%
  pause
  exit /b 0
)
python scripts\backup_db.py
if errorlevel 1 (
  echo *** Backup failed - stopped. Database was not changed. ***
  pause
  exit /b 1
)
python scripts\set_settings.py %F% --apply
pause
