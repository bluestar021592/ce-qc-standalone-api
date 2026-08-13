@echo off
setlocal
cd /d "%~dp0"
if exist test-full.log del /q test-full.log
echo [CE-QC] Running full test suite...
call npm test > test-full.log 2>&1
set TEST_EXIT=%ERRORLEVEL%
echo.
node scripts\Summarize_Test_Log.mjs test-full.log
echo.
if %TEST_EXIT%==0 (echo [CE-QC] RESULT: PASS) else (echo [CE-QC] RESULT: FAIL)
echo [CE-QC] Full log: %CD%\test-full.log
pause
exit /b %TEST_EXIT%
