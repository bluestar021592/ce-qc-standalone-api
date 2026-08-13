@echo off
setlocal EnableExtensions
chcp 65001 >nul
title CE QC APP - Managed Backend

start "" /b powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\CE_QC_CarryRefresh_Poller.ps1"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\CE_QC_Managed_Launcher.ps1"
set "EC=%ERRORLEVEL%"

if not "%EC%"=="0" (
  echo.
  echo CE QC stopped with ErrorLevel=%EC%
  echo Managed launcher log: logs\managed_launcher_latest.log
  pause
)

endlocal
exit /b %EC%
