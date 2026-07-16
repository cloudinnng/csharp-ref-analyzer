@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [run-background] C# ref analyzer - tray mode
echo [run-background] URL: http://127.0.0.1:8780
echo [run-background] App log:  %~dp0logs\run-background.log
echo [run-background] Tray log: %~dp0logs\tray-host.log
echo [run-background] Tray: right-click icon to exit
echo.

if not exist "logs" (
  mkdir "logs"
  echo [run-background] created logs\
)

rem Already up: just open browser
netstat -ano | findstr ":8780" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [run-background] port 8780 already listening, open browser
  start "" "http://127.0.0.1:8780"
  exit /b 0
)

rem Launch tray host: STA required by WinForms NotifyIcon; hide PowerShell window
echo [run-background] starting tray host...
start "" /MIN powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0scripts\run-tray-host.ps1"

echo [run-background] started. Look for tray icon near the clock.
echo [run-background] You can close this window.
exit /b 0