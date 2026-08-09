@echo off
chcp 65001 >nul
title CE 质控APP启动
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\CE_QC_Start.ps1"
exit /b %errorlevel%
