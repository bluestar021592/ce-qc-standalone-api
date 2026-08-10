@echo off
setlocal
cd /d "%~dp0"

set "REPORT_DATE=%~1"
set "BUSINESS_TYPE=%~2"

if not defined REPORT_DATE (
  set /p "REPORT_DATE=Report date (YYYY-MM-DD): "
)
if not defined BUSINESS_TYPE set "BUSINESS_TYPE=ALL"

echo ============================================================
echo   CE QC Business Snapshot Audit - STRICT READ ONLY
echo   Date: %REPORT_DATE%
echo   Business: %BUSINESS_TYPE%
echo ============================================================
echo.

node ".\scripts\CE_QC_Business_Snapshot_Audit_ReadOnly.mjs" "%REPORT_DATE%" "%BUSINESS_TYPE%"
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" echo [WARN] Audit exited with code %EXITCODE%.
pause
exit /b %EXITCODE%
