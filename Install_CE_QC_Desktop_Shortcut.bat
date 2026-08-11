@echo off
chcp 65001 >nul
title CE QC Desktop Launcher Installer v4
cd /d "%~dp0"
echo.
echo [CE QC] Desktop Launcher Installer v4 - DIRECT HIDDEN POWERSHELL
echo [CE QC] Rebuilding CE QC APP with the exact CE EXPRESS icon...
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
