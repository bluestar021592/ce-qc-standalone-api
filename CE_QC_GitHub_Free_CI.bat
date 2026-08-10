@echo off
setlocal
cd /d "%~dp0"
title CE QC GitHub Free CI

echo ==============================================
echo   CE QC GitHub Free CI
echo   Private ^> temporary Public ^> CI ^> Private
echo ==============================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\CE_QC_GitHub_Free_CI.ps1"
set "EC=%ERRORLEVEL%"

echo.
if "%EC%"=="0" (
  echo [PASS] Final CI passed. Repository restore completed.
) else if "%EC%"=="10" (
  echo [CI FAILED] GitHub Actions really ran, but one or more tests failed.
  echo The repository restore step was executed.
) else if "%EC%"=="21" (
  echo [CRITICAL] Automatic restore to Private failed.
  echo Open GitHub Settings - Danger Zone and restore Private immediately.
) else (
  echo [FLOW ERROR] GitHub Actions did NOT complete normally.
  echo Read the error above. This is not being reported as a test failure.
)
echo.
pause
exit /b %EC%
