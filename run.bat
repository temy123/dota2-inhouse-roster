@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo Dota 2 Inhouse Manager
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Install Node.js from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [INFO] Installing required packages. Please wait...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
  echo.
)

node manager.js
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
