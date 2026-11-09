@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title AI Learning Dashboard

echo ============================================
echo   AI Learning Dashboard
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo         Download it from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] Installing dependencies, first run only...
  call npm install --no-audit --no-fund
  echo.
)

netstat -ano | findstr /c:":5173 " | findstr /c:"LISTENING" >nul
if not errorlevel 1 (
  echo Server is already running. Opening the page...
  start "" "http://127.0.0.1:5173"
  ping -n 2 127.0.0.1 >nul
  exit /b 0
)

echo [2/3] Fetching today's AI news... ^(about 10 seconds^)
call npm run update
echo.

echo [3/3] Starting local server...
start "AI Learning Server" /min cmd /c "node server.js"

set /a tries=0
:wait
set /a tries+=1
netstat -ano | findstr /c:":5173 " | findstr /c:"LISTENING" >nul
if not errorlevel 1 goto ready
if %tries% geq 20 goto failed
ping -n 2 127.0.0.1 >nul
goto wait

:ready
echo Page is ready: http://127.0.0.1:5173
start "" "http://127.0.0.1:5173"
ping -n 3 127.0.0.1 >nul
exit /b 0

:failed
echo.
echo [ERROR] The server did not start within 20 seconds.
echo         Open a terminal here and run: npm run dev
echo.
pause
exit /b 1
