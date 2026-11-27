@echo off
chcp 65001 >nul
cd /d "%~dp0"
call .venv\Scripts\activate.bat
cd backend
python -m pytest -v tests > ..\docs\test-results.txt 2>&1
type ..\docs\test-results.txt
echo.
echo Results saved to docs\test-results.txt
pause
