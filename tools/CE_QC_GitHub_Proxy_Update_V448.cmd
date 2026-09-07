@echo off
chcp 65001 >nul
title CE QC GitHub Proxy Update V448
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0CE_QC_GitHub_Proxy_Update_V448.ps1"
if errorlevel 1 (
  echo.
  echo V448 proxy update stopped. Check %%LOCALAPPDATA%%\CE_QC_LAUNCHER\proxy_update_latest.log
  pause
  exit /b 1
)
exit /b 0
