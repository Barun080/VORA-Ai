@echo off
chcp 65001 >nul
title VORA - Admission sample data
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem   add_admission_samples.bat         = add sample admission data (backup first, skips existing)
rem   add_admission_samples.bat --undo  = remove the sample items that staff have not edited
python scripts\add_admission_samples.py %*
if errorlevel 1 echo *** STOPPED - see the message above. Is PostgreSQL running? ***
pause
