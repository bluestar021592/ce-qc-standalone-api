@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "LOG=golive-preflight.log"
if exist "%LOG%" del /q "%LOG%"

> "%LOG%" echo [CE-QC] LOCAL GO-LIVE PREFLIGHT
>>"%LOG%" echo [CE-QC] Started: %date% %time%

echo [1/3] Checking Node.js and npm...
where node >nul 2>&1 || goto :NODE_MISSING
where npm >nul 2>&1 || goto :NPM_MISSING
node --version >>"%LOG%" 2>&1
npm --version >>"%LOG%" 2>&1

echo [2/3] Running critical syntax checks...
call :CHECK src\trajectoryFacts.js || goto :FAILED
call :CHECK src\analyzerV30.js || goto :FAILED
call :CHECK src\analyzerFinal.js || goto :FAILED
call :CHECK src\analyzer.js || goto :FAILED
call :CHECK src\shopeeAnalyzer.js || goto :FAILED
call :CHECK src\unifiedImportStore.js || goto :FAILED
call :CHECK src\rangeDashboardStore.js || goto :FAILED
call :CHECK src\dataPurge.js || goto :FAILED
call :CHECK scripts\CE_QC_Production_Audit.mjs || goto :FAILED
call :CHECK scripts\CE_QC_Production_Diagnostic_ReadOnly.mjs || goto :FAILED

echo [3/3] Running go-live regression suite...
call npm run test:golive >>"%LOG%" 2>&1
set "TEST_EXIT=%ERRORLEVEL%"

echo.
echo ==================== GO-LIVE TEST SUMMARY ====================
findstr /R /C:"^# tests " /C:"^# pass " /C:"^# fail " "%LOG%"
if errorlevel 1 (
  echo # tests summary missing
  echo # pass summary missing
  echo # fail summary missing
)
echo ==============================================================

if not "%TEST_EXIT%"=="0" goto :TEST_FAILED

echo.
echo [CE-QC] GO-LIVE PREFLIGHT: PASS
>>"%LOG%" echo [CE-QC] GO-LIVE PREFLIGHT: PASS
echo [CE-QC] Log: %CD%\%LOG%
pause
exit /b 0

:CHECK
node --check "%~1" >>"%LOG%" 2>&1
if errorlevel 1 (
  echo [CE-QC] Syntax FAIL: %~1
  >>"%LOG%" echo [CE-QC] Syntax FAIL: %~1
  exit /b 1
)
echo [CE-QC] Syntax PASS: %~1
>>"%LOG%" echo [CE-QC] Syntax PASS: %~1
exit /b 0

:TEST_FAILED
echo.
echo [CE-QC] Failing test entries:
findstr /B /C:"not ok " "%LOG%"
echo.
echo [CE-QC] GO-LIVE PREFLIGHT: FAIL ^(tests exit=%TEST_EXIT%^)
>>"%LOG%" echo [CE-QC] GO-LIVE PREFLIGHT: FAIL ^(tests exit=%TEST_EXIT%^)
echo [CE-QC] Log: %CD%\%LOG%
pause
exit /b %TEST_EXIT%

:NODE_MISSING
echo [CE-QC] Node.js was not found.
>>"%LOG%" echo [CE-QC] Node.js was not found.
goto :FAILED

:NPM_MISSING
echo [CE-QC] npm was not found.
>>"%LOG%" echo [CE-QC] npm was not found.
goto :FAILED

:FAILED
echo.
echo [CE-QC] GO-LIVE PREFLIGHT: FAIL
echo [CE-QC] Log: %CD%\%LOG%
pause
exit /b 1
