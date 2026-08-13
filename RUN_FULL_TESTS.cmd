@echo off
setlocal
cd /d "%~dp0"

if exist test-full.log del /q test-full.log

echo [CE-QC] Running full test suite with TAP summary...
call npm test > test-full.log 2>&1
set "TEST_EXIT=%ERRORLEVEL%"

echo.
echo ==================== TEST SUMMARY ====================
findstr /R /C:"^# tests " /C:"^# pass " /C:"^# fail " test-full.log
if errorlevel 1 (
  echo # tests summary missing
  echo # pass summary missing
  echo # fail summary missing
)
echo ======================================================

if not "%TEST_EXIT%"=="0" (
  echo.
  echo [CE-QC] Failing test entries:
  findstr /B /C:"not ok " test-full.log
  echo.
  echo [CE-QC] RESULT: FAIL ^(exit=%TEST_EXIT%^)
) else (
  echo.
  echo [CE-QC] RESULT: PASS
)

echo [CE-QC] Full log: %CD%\test-full.log
echo.
pause
exit /b %TEST_EXIT%
