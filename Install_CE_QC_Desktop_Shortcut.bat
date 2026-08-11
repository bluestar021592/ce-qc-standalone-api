@echo off
chcp 65001 >nul
title CE QC Desktop Launcher Installer v3
cd /d "%~dp0"
echo.
echo [CE QC] Desktop Launcher Installer v3 - NO VBS
echo [CE QC] Removing old VBS shortcuts and creating CE QC APP...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Install_CE_QC_Desktop_Shortcut.ps1"
if errorlevel 1 (
  echo.
  echo [CE QC] Desktop launcher install FAILED. Please send this window screenshot.
  pause
  exit /b 1
)
echo.
echo [CE QC] Install finished. Close this window and double-click the NEW "CE QC APP" icon.
pause
