@echo off
setlocal
cd /d "%~dp0"

echo [CE-QC] STEP 1/2 - Go-live preflight
call RUN_GOLIVE_PREFLIGHT.cmd
if errorlevel 1 goto :FAIL

echo.
echo [CE-QC] STEP 2/2 - Full regression
call RUN_FULL_TESTS_V2.cmd
if errorlevel 1 goto :FAIL

echo.
echo =============================================
echo [CE-QC] ACCEPTANCE RESULT: PASS
echo =============================================
pause
exit /b 0

:FAIL
echo.
echo =============================================
echo [CE-QC] ACCEPTANCE RESULT: FAIL
echo [CE-QC] Read the log printed above for details.
echo =============================================
pause
exit /b 1
