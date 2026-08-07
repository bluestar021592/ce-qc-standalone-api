@echo off
setlocal EnableExtensions
chcp 65001 >nul
title CE QC Standalone API

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"
if errorlevel 1 (
  echo [ERROR] Cannot open project folder:
  echo %PROJECT_DIR%
  pause
  exit /b 1
)

set "NODE_EXE="
for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"

if not defined NODE_EXE (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 22+ and run Start_CE_QC again.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%V in ('"%NODE_EXE%" -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo [ERROR] Unable to read Node.js version.
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 22 (
  echo [ERROR] CE QC uses node:sqlite and requires Node.js 22 or newer.
  echo Current Node.js:
  "%NODE_EXE%" -v
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo node_modules not found. Installing dependencies...
  where npm.cmd >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] npm was not found.
    pause
    exit /b 1
  )
  call npm ci
  if errorlevel 1 (
    echo [ERROR] npm ci failed.
    pause
    exit /b 1
  )
)

echo Stopping old listener on port 5177 if present...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":5177 .*LISTENING"') do taskkill /F /PID %%P >nul 2>nul
timeout /t 1 /nobreak >nul

if not exist "logs\" mkdir "logs"
set "LOG_FILE=%PROJECT_DIR%logs\startup_latest.log"

echo.
echo ================================================
echo CE QC project: %PROJECT_DIR%
echo Node: %NODE_EXE%
"%NODE_EXE%" -v
echo URL : http://127.0.0.1:5177
echo Log : %LOG_FILE%
echo ================================================
echo Keep this window open while using CE QC.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "^& $env:NODE_EXE 'bootstrap.js' 2^>^&1 ^| Tee-Object -FilePath $env:LOG_FILE"

echo.
echo [ERROR] CE QC server stopped or failed to start.
echo Last startup log:
powershell.exe -NoProfile -Command "if (Test-Path $env:LOG_FILE) { Get-Content $env:LOG_FILE -Tail 80 }"
echo.
pause
exit /b 1
