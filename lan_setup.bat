@echo off
chcp 65001 >nul
title VORA - LAN setup (https + firewall)
cd /d "%~dp0"
REM 25 Nov 2026: let other PCs on the same LAN use VORA (robot screen + admin)
REM  1) install "cryptography"  2) create self-signed https certificate (data\certs)  3) open firewall ports 8000 + 8443
if not exist ".venv\Scripts\activate.bat" (
  echo Please run setup.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
echo [1/3] Installing cryptography package...
pip install "cryptography>=42" >nul
if errorlevel 1 (
  echo [ERROR] pip install cryptography failed. Check internet connection.
  pause
  exit /b 1
)
echo [2/3] Creating https certificate for this PC...
python scripts\make_lan_cert.py %*
if errorlevel 1 (
  pause
  exit /b 1
)
echo [3/3] Opening Windows Firewall ports 8000 and 8443 (private/domain networks only)...
net session >nul 2>&1
if errorlevel 1 (
  echo   [SKIPPED] Needs administrator. Right-click lan_setup.bat and choose "Run as administrator" to open the ports.
  goto done
)
netsh advfirewall firewall delete rule name="VORA 8000" >nul 2>&1
netsh advfirewall firewall delete rule name="VORA 8443" >nul 2>&1
netsh advfirewall firewall add rule name="VORA 8000" dir=in action=allow protocol=TCP localport=8000 profile=private,domain >nul
netsh advfirewall firewall add rule name="VORA 8443" dir=in action=allow protocol=TCP localport=8443 profile=private,domain >nul
echo   Firewall rules added.
echo   Note: if Windows marks this network as "Public", set it to "Private" in Settings - Network.
:done
echo.
echo Done. Restart start.bat - the server window will show the LAN addresses.
echo Then approve new screens in Admin - "LAN screens".
pause
