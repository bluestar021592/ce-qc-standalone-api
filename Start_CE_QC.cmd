@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title CE QC Standalone API

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%"

if exist "%PROJECT_DIR%package.json" goto :PROJECT_OK
if exist "%PROJECT_DIR%server.js" goto :PROJECT_OK
echo [ERROR] Cannot find package.json or server.js in:
echo %PROJECT_DIR%
pause
exit /b 1

:PROJECT_OK
cd /d "%PROJECT_DIR%"
if errorlevel 1 (
  echo [ERROR] Cannot open project folder:
  echo %PROJECT_DIR%
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  pause
  exit /b 1
)

echo Stopping old server on port 5177 if it exists...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":5177 .*LISTENING"') do taskkill /PID %%P /F >nul 2>&1
ping -n 2 127.0.0.1 >nul

echo Starting CE QC standalone API from:
echo %CD%
wscript.exe "%PROJECT_DIR%Start_CE_QC_Silent.vbs"
if errorlevel 1 (
  echo [ERROR] Failed to launch the background server.
  pause
  exit /b 1
)
ping -n 4 127.0.0.1 >nul
netstat -ano | findstr /R /C:":5177 .*LISTENING" >nul
if errorlevel 1 (
  echo [ERROR] Server did not start on port 5177.
  pause
  exit /b 1
)
echo Server started in background: http://127.0.0.1:5177
exit /b 0
