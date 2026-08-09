@echo off
chcp 65001 >nul
title 创建 CE 质控APP桌面启动按钮
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Install_CE_QC_Desktop_Shortcut.ps1"
if errorlevel 1 (
  echo.
  echo [CE QC] 桌面启动按钮创建失败，请把窗口截图发给我。
  pause
)
