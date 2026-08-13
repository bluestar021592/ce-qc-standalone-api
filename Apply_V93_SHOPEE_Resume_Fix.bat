@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\Apply_V93_SHOPEE_Resume_Fix.ps1"
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo [CE-QC] V93 apply/verify failed with exit code %EXITCODE%.
  pause
  exit /b %EXITCODE%
)
echo.
echo [CE-QC] V93 SHOPEE resume resilience verified.
pause
