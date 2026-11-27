@echo off
chcp 65001 >nul
title VORA - Fix news dates
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem   fix_news_dates.bat             = preview (no change)
rem   fix_news_dates.bat --apply     = backup database, then fix dates
rem   fix_news_dates.bat --undo FILE = restore from data\backups\fix_news_dates_....json
if /i "%~1"=="--undo" (
  python scripts\fix_news_dates.py --undo "%~2"
  pause
  exit /b 0
)
if /i not "%~1"=="--apply" (
  python scripts\fix_news_dates.py
  pause
  exit /b 0
)
python scripts\backup_db.py
if errorlevel 1 (
  echo *** Backup failed - stopped. Database was not changed. ***
  pause
  exit /b 1
)
python scripts\fix_news_dates.py --apply
pause
