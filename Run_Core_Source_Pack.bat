@echo off
setlocal EnableExtensions
title CE QC Core Source Pack
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CE_QC_Core_Source_Pack.ps1"
if errorlevel 1 (
  echo.
  echo Pack failed. Please send a screenshot to ChatGPT.
  pause
)
endlocal
