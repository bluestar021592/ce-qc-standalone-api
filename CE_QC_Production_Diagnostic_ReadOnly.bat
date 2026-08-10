@echo off
setlocal
cd /d "%~dp0"
title CE QC Production Read-Only Diagnostic

echo ======================================================
echo   CE QC Production Read-Only Diagnostic
echo   STRICT READ-ONLY database inspection
echo ======================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Start the CE QC project environment first, then run this file again.
  echo.
  pause
  exit /b 20
)

node scripts\CE_QC_Production_Diagnostic_ReadOnly.mjs
set "RC=%ERRORLEVEL%"
echo.

if "%RC%"=="0" (
  echo [DONE] Read-only diagnostic completed.
) else (
  echo [BLOCKED] Diagnostic could not complete. Review the error above.
)

echo.
echo The JSON and TXT reports are saved under exports\audit in the configured data directory.
echo.
pause
exit /b %RC%
