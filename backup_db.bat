@echo off
chcp 65001 >nul
title VORA - Database Backup
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem   backup_db.bat                     = back up now to _backups\database
rem   backup_db.bat --list              = list backups
rem   backup_db.bat --restore FILE      = restore (close start.bat first)
python scripts\backup_db.py %*
if "%~1"=="" pause
