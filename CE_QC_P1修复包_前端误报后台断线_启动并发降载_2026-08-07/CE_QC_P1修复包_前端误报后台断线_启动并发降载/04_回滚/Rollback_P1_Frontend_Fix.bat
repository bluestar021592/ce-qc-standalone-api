@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Rollback_P1_Frontend_Fix.ps1"
if errorlevel 1 pause
