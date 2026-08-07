@echo off
setlocal
chcp 65001 >nul
title CE QC GitHub Upload V2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CE_QC_Upload_GitHub_Private_V2.ps1"
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo Upload did not complete. ErrorLevel=%EC%
  echo Please take a screenshot of this window and send it to ChatGPT.
  pause
)
endlocal
exit /b %EC%
