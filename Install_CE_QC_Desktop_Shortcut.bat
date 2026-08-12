@echo off
chcp 65001 >nul
title CE QC Desktop Launcher Installer v6
cd /d "%~dp0"
echo.
echo [CE QC] Desktop Launcher Installer v6 - SILENT START + RELIABLE BROWSER OPEN
echo [CE QC] Rebuilding CE QC APP with the validated CE EXPRESS icon...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Install_CE_QC_Desktop_Shortcut.ps1"
if errorlevel 1 (
  echo.
  echo [CE QC] Base desktop launcher install FAILED. Please send this window screenshot.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Repair_CE_QC_Desktop_Launcher_V6.ps1"
if errorlevel 1 (
  echo.
  echo [CE QC] V6 desktop launcher repair FAILED. Please send this window screenshot.
  pause
  exit /b 1
)
echo.
echo [CE QC] V6 install finished. Close this window and double-click the NEW "CE QC APP" icon.
pause
