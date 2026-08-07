@echo off
setlocal
title CE QC P1 Frontend Fix
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Apply_P1_Frontend_Fix.ps1"
if errorlevel 1 pause
endlocal
