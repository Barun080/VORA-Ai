@echo off
chcp 65001 >nul
title VORA - Import Nan Technical College programs (17 departments)
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
echo Close start.bat before continuing (database structure will be upgraded).
pause
echo [1/2] Upgrading database structure (backup + verify included)...
python scripts\migrate_schema.py upgrade
if errorlevel 1 (
  echo *** Upgrade stopped - nothing was imported. ***
  pause
  exit /b 1
)
echo.
echo [2/2] Importing 17 departments...
:run
python scripts\import_vtcn_programs.py %*
pause
