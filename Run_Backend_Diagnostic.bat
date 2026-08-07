@echo off
setlocal EnableExtensions
title CE QC Backend Read-Only Diagnostic
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CE_QC_Backend_ReadOnly_Diagnostic.ps1"
if errorlevel 1 (
  echo.
  echo Diagnostic failed. Please send a screenshot of this window to ChatGPT.
  pause
)
endlocal
