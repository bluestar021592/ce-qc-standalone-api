@echo off
setlocal
cd /d "%~dp0"
echo ==============================================================
echo   CE QC First-Day Go-Live Verify - STRICT READ ONLY
echo ==============================================================
echo.
node .\scripts\CE_QC_First_Day_GoLive_Verify_ReadOnly.mjs %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [READY] First-day persistence gate passed.
) else (
  echo [BLOCKED] First-day persistence gate did not pass. Do not go live yet.
)
echo.
pause
exit /b %RC%
