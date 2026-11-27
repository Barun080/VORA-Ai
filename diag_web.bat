@echo off
chcp 65001 >nul
title VORA - Diagnose web search and voice
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem   diag_web.bat            = test with the word "ดาวอังคาร"
rem   diag_web.bat ภูเขาไฟ     = test with your own word
python scripts\diag_web.py %*
echo.
pause
