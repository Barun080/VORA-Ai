@echo off
chcp 65001 >nul
title VORA - Database Schema Migration
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem   migrate.bat                    = show schema status (changes nothing)
rem   migrate.bat upgrade            = backup + verify backup + apply pending migrations
rem   migrate.bat downgrade 0001     = backup + export + undo migration 0001 (asks YES)
rem   Close start.bat before upgrade/downgrade.
if "%~1"=="" (
  python scripts\migrate_schema.py status
) else (
  python scripts\migrate_schema.py %*
)
set RC=%ERRORLEVEL%
echo.
if not "%RC%"=="0" echo *** STOPPED - see the message above. Database was not changed unless it says so. ***
pause
exit /b %RC%
