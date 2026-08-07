@echo off
setlocal
title CE QC API Diagnostic Installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install_API_Diagnostic.ps1"
if errorlevel 1 pause
endlocal
