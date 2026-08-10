@echo off
setlocal
cd /d "%~dp0"
title CE QC Go-Live Preflight

echo =====================================================
echo   CE QC GO-LIVE PREFLIGHT
echo   Non-destructive regression before fresh start
echo =====================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [BLOCKED] Node.js was not found in PATH.
  echo.
  pause
  exit /b 20
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [BLOCKED] npm was not found in PATH.
  echo.
  pause
  exit /b 21
)

echo [1/3] Syntax checks...
for %%F in (
  src\trajectoryFacts.js
  src\analyzerV30.js
  src\analyzerFinal.js
  src\analyzer.js
  src\shopeeAnalyzer.js
  src\unifiedImportStore.js
  src\rangeDashboardStore.js
  src\dataPurge.js
  scripts\CE_QC_Production_Audit.mjs
  scripts\CE_QC_Production_Diagnostic_ReadOnly.mjs
) do (
  node --check "%%F"
  if errorlevel 1 goto :FAIL
)

echo.
echo [2/3] Go-live regression tests...
call npm run test:golive
if errorlevel 1 goto :FAIL

echo.
echo [3/3] Production database read-only audit...
node scripts\CE_QC_Production_Audit.mjs
set "AUDIT_RC=%ERRORLEVEL%"
if not "%AUDIT_RC%"=="0" (
  echo.
  echo [BLOCKED] Production audit returned code %AUDIT_RC%.
  goto :FAIL
)

echo.
echo =====================================================
echo   RESULT: PASS
echo   CODE REGRESSION: PASS
echo   PRODUCTION AUDIT: PASS
echo   DATABASE MODIFIED BY AUDIT: NO
echo =====================================================
echo.
echo Do NOT clear production data yet. Send this window result for final review.
echo.
pause
exit /b 0

:FAIL
echo.
echo =====================================================
echo   RESULT: BLOCKED
echo   Do not clear production data and do not start fresh import.
echo =====================================================
echo.
pause
exit /b 1
