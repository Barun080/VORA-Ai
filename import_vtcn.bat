@echo off
chcp 65001 >nul
title VORA - Import Nan Technical College knowledge
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
if /i "%~1"=="--undo" goto run
echo [1/2] Backing up database before import...
python scripts\backup_db.py
if errorlevel 1 (
  echo *** Backup failed - import stopped. Database was not changed. ***
  pause
  exit /b 1
)
echo.
echo [2/2] Importing knowledge...
:run
python scripts\import_vtcn_knowledge.py %*
pause
