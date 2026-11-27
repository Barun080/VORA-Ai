@echo off
chcp 65001 >nul
title VORA - Fix knowledge answers
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem   fix_knowledge.bat              = preview all fix files in data\knowledge\fixes (no change)
rem   fix_knowledge.bat --apply      = backup database, then apply every fix file
rem   fix_knowledge.bat FILE         = preview one file
rem   fix_knowledge.bat --apply FILE = backup, then apply one file
rem   fix_knowledge.bat --undo FILE  = restore from data\backups\fix_knowledge_....json
if /i "%~1"=="--undo" (
  python scripts\fix_knowledge.py --undo "%~2"
  pause
  exit /b 0
)
if /i not "%~1"=="--apply" goto preview
echo [1/2] Backing up database...
python scripts\backup_db.py
if errorlevel 1 (
  echo *** Backup failed - stopped. Database was not changed. ***
  pause
  exit /b 1
)
echo.
echo [2/2] Applying fixes...
rem 27 Nov 2569: fix_knowledge.bat --apply FILE = apply only that file
if not "%~2"=="" (
  python scripts\fix_knowledge.py "%~2" --apply
  pause
  exit /b 0
)
for %%F in (data\knowledge\fixes\*.json) do python scripts\fix_knowledge.py "%%F" --apply
pause
exit /b 0
:preview
if not "%~1"=="" (
  python scripts\fix_knowledge.py "%~1"
  pause
  exit /b 0
)
for %%F in (data\knowledge\fixes\*.json) do python scripts\fix_knowledge.py "%%F"
pause
