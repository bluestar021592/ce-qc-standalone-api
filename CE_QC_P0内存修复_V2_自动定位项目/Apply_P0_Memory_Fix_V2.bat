@echo off
setlocal EnableExtensions
title CE QC P0 Memory Fix V2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Apply_P0_Memory_Fix_V2.ps1"
if errorlevel 1 (
  echo.
  echo Patch was not completed. Please send this window screenshot to ChatGPT.
  pause
)
endlocal
