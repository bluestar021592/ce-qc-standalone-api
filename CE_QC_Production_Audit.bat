@echo off
setlocal
cd /d "%~dp0"
title CE QC Production Audit

echo ==============================================
echo   CE QC Production Audit
echo   Read-only database and history verification
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Start the CE QC project environment first, then run this file again.
  echo.
  pause
  exit /b 20
)

node scripts\CE_QC_Production_Audit.mjs
set "RC=%ERRORLEVEL%"
echo.

if "%RC%"=="0" (
  echo [PASS] All imported dates are complete and reconciled.
) else if "%RC%"=="10" (
  echo [REBUILD REQUIRED] Source data is intact, but some dates need historical rebuild.
) else (
  echo [BLOCKED] Database or source reconciliation needs attention before any rebuild.
)

echo.
echo The detailed JSON report is saved under the exports\audit folder in the configured data directory.
echo.
pause
exit /b %RC%
