@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Rollback_P0_Memory_Fix.ps1"
if errorlevel 1 pause
