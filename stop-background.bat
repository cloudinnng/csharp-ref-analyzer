@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo [stop-background] stopping tray host and port 8780...

set "KILLED=0"

rem 1) Kill tray host by PID file (need delayed expansion inside parentheses)
if exist "logs\tray-host.pid" (
  set /p TRAYPID=<"logs\tray-host.pid"
  echo [stop-background] tray-host PID=!TRAYPID!
  if not "!TRAYPID!"=="" (
    taskkill /F /T /PID !TRAYPID! >nul 2>&1
    if not errorlevel 1 set "KILLED=1"
  )
  del "logs\tray-host.pid" >nul 2>&1
)

rem 2) Fallback: kill whatever still listens on 8780
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8780" ^| findstr "LISTENING"') do (
  echo [stop-background] kill listener PID=%%P
  taskkill /F /T /PID %%P >nul 2>&1
  if not errorlevel 1 set "KILLED=1"
)

if "%KILLED%"=="1" (
  echo [stop-background] stopped.
) else (
  echo [stop-background] nothing to stop.
)

exit /b 0