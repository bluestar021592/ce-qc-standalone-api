@echo off
setlocal
cd /d "%~dp0"

set "REPORT_DATE=%~1"
if not defined REPORT_DATE set "REPORT_DATE=2026-08-01"

echo ============================================================
echo   CE QC FULL ACCEPTANCE VERIFY - READ ONLY / TEST ONLY
echo   Date: %REPORT_DATE%
echo ============================================================
echo.
node ".\scripts\CE_QC_Full_Acceptance_Verify_ReadOnly.mjs" "%REPORT_DATE%"
set "EXITCODE=%ERRORLEVEL%"
echo.
if "%EXITCODE%"=="0" (
  echo [READY] Automated acceptance gate passed. Continue with UI click-through and real export reconciliation.
) else (
  echo [BLOCKED] Automated acceptance gate found a real inconsistency or regression. Do not declare the system ready.
)
echo.
pause
exit /b %EXITCODE%
