@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\Apply_V92_WHPP_Terminal_Fix.ps1"
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo [CE-QC] V92 apply/verify failed with exit code %EXITCODE%.
  pause
  exit /b %EXITCODE%
)
echo.
echo [CE-QC] V92 WHPP terminal authority verified.
pause
