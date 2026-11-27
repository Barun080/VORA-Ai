@echo off
chcp 65001 >nul
title VORA - Import technicnan.ac.th web data (26 Nov 2026)
cd /d "%~dp0..\..\.."
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set PYTHONDONTWRITEBYTECODE=1
rem   import_technicnan_web.bat              = check only, compare with the live database (no changes)
rem   import_technicnan_web.bat --apply      = back up the database, then import as pending
rem   import_technicnan_web.bat --finish     = after staff approval, retire the old answers that were replaced
rem   import_technicnan_web.bat --undo FILE  = remove items from that run that are still pending
if /i not "%~1"=="--apply" goto run
echo [1/2] Backing up database...
python scripts\backup_db.py
if errorlevel 1 (
  echo *** Backup failed - stopped. Database was not changed. ***
  pause
  exit /b 1
)
echo.
echo [2/2] Importing...
:run
python data\knowledge\technicnan_web\import_technicnan_web.py %*
pause
