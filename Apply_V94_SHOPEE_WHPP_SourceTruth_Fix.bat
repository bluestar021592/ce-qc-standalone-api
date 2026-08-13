@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\Apply_V94_SHOPEE_WHPP_SourceTruth_Fix.ps1"
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo [CE-QC] V94 apply/verify failed with exit code %EXITCODE%.
  pause
  exit /b %EXITCODE%
)
echo.
echo [CE-QC] V94 SHOPEE WHPP source truth + CEAF display synchronization verified.
pause
