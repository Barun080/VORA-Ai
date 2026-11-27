@echo off
rem Open the robot screen full-screen (Chrome or Edge kiosk mode). Press Alt+F4 to exit.
set URL=http://localhost:8000/
set CHROME="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist %CHROME% (
  start "" %CHROME% --kiosk --autoplay-policy=no-user-gesture-required --disable-pinch --overscroll-history-navigation=0 %URL%
) else (
  start "" msedge --kiosk %URL% --edge-kiosk-type=fullscreen --autoplay-policy=no-user-gesture-required
)
