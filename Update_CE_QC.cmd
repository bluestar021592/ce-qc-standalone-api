@echo off
setlocal EnableExtensions
chcp 65001 >nul
title CE QC Update and Start

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"
if errorlevel 1 (
  echo [ERROR] Cannot open CE QC project folder.
  pause
  exit /b 1
)

where git.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git for Windows was not found.
  pause
  exit /b 1
)

git diff --quiet
if errorlevel 1 (
  echo [STOP] Tracked project files have local changes.
  echo To protect your work, automatic update has been stopped.
  echo Send a screenshot of this window to ChatGPT before continuing.
  pause
  exit /b 2
)

git diff --cached --quiet
if errorlevel 1 (
  echo [STOP] There are staged local changes.
  echo To protect your work, automatic update has been stopped.
  pause
  exit /b 2
)

echo Updating CE QC from GitHub main...
git fetch origin main
if errorlevel 1 (
  echo [ERROR] git fetch failed.
  pause
  exit /b 3
)

git pull --ff-only origin main
if errorlevel 1 (
  echo [ERROR] git pull failed. No project files were overwritten by force.
  pause
  exit /b 4
)

echo.
echo Update completed. Starting CE QC...
echo.
call "%PROJECT_DIR%Start_CE_QC.cmd"
