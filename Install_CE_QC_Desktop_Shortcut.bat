@echo off
chcp 65001 >nul
title CE QC Desktop Launcher Installer v7
cd /d "%~dp0"
echo.
echo [CE QC] Desktop Launcher Installer v7 - MANAGED BACKEND + SAFE AUTO UPDATE
echo [CE QC] Rebuilding CE QC APP with the validated CE EXPRESS icon...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Install_CE_QC_Desktop_Shortcut.ps1"
if errorlevel 1 (
  echo.
  echo [CE QC] Base desktop launcher install FAILED.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Repair_CE_QC_Desktop_Launcher_V6.ps1"
if errorlevel 1 (
  echo.
  echo [CE QC] Managed V7 desktop launcher setup FAILED.
  pause
  exit /b 1
)
echo.
echo [CE QC] V7 install finished.
echo [CE QC] From now on, double-click "CE QC APP" only.
echo [CE QC] Keep its black window open while using the system; closing it stops backend port 5177 automatically.
pause
