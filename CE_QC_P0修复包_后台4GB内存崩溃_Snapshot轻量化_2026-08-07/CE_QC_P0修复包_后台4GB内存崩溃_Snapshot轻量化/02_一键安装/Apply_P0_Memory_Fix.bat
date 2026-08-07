@echo off
setlocal EnableExtensions
title CE QC P0 Snapshot Memory Fix
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Apply_P0_Memory_Fix.ps1"
if errorlevel 1 (
  echo.
  echo Patch was not completed. Please send a screenshot to ChatGPT.
  pause
)
endlocal
