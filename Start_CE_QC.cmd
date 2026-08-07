@echo off
setlocal EnableExtensions
chcp 65001 >nul
title CE QC Standalone API

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start_CE_QC.ps1"
set "EC=%ERRORLEVEL%"

if not "%EC%"=="0" (
  echo.
  echo CE QC stopped with ErrorLevel=%EC%
  echo Please send this window and logs\startup_latest.log to ChatGPT.
  pause
)

endlocal
exit /b %EC%
