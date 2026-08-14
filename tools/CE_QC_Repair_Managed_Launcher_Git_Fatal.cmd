@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title CE QC APP - Launcher Emergency Repair

set "APP=%LOCALAPPDATA%\CE_QC_LAUNCHER\app"
set "CURRENT="
set "REMOTE="
set "DIRTY="
set "DEPS_CHANGED="

echo =============================================================
echo  CE QC APP - Managed Launcher Emergency Repair
echo =============================================================
echo.

if not exist "%APP%\.git" goto :missing_app
if not exist "%APP%\Start_CE_QC.cmd" goto :missing_app

where git.exe >nul 2>&1
if errorlevel 1 goto :missing_git
where node.exe >nul 2>&1
if errorlevel 1 goto :missing_node

for /f "delims=" %%I in ('git -C "%APP%" rev-parse HEAD 2^>nul') do set "CURRENT=%%I"
if not defined CURRENT goto :git_state_failed

for /f "delims=" %%I in ('git -C "%APP%" status --porcelain --untracked-files=no 2^>nul') do set "DIRTY=1"
if defined DIRTY goto :dirty_tree

echo [1/5] Fetching fixed launcher from GitHub...
git -C "%APP%" fetch --quiet origin main
if errorlevel 1 goto :fetch_failed

for /f "delims=" %%I in ('git -C "%APP%" rev-parse origin/main 2^>nul') do set "REMOTE=%%I"
if not defined REMOTE goto :git_state_failed

git -C "%APP%" merge-base --is-ancestor "%CURRENT%" "%REMOTE%" >nul 2>&1
if errorlevel 1 goto :not_fast_forward

for /f "delims=" %%I in ('git -C "%APP%" diff --name-only "%CURRENT%" "%REMOTE%" -- package.json package-lock.json 2^>nul') do set "DEPS_CHANGED=1"

echo [2/5] Creating verified pre-update database backup...
if not exist "%APP%\scripts\CE_QC_PreUpdate_Backup.mjs" goto :backup_tool_missing
node "%APP%\scripts\CE_QC_PreUpdate_Backup.mjs" "%CURRENT%" "%REMOTE%"
if errorlevel 1 goto :backup_failed

echo [3/5] Installing fast-forward launcher fix...
git -C "%APP%" pull --ff-only --quiet origin main
if errorlevel 1 goto :pull_failed

if defined DEPS_CHANGED (
  echo [4/5] Dependencies changed. Refreshing node_modules...
  where npm.cmd >nul 2>&1
  if errorlevel 1 goto :missing_npm
  pushd "%APP%"
  call npm.cmd ci --prefer-offline --no-audit --no-fund
  set "NPM_EC=!ERRORLEVEL!"
  popd
  if not "!NPM_EC!"=="0" goto :npm_failed
) else (
  echo [4/5] Dependencies unchanged. No npm refresh needed.
)

echo [5/5] Repair complete. Starting CE QC APP...
echo.
call "%APP%\Start_CE_QC.cmd"
set "APP_EC=%ERRORLEVEL%"
exit /b %APP_EC%

:missing_app
echo [ERROR] CE QC installed app was not found:
echo %APP%
goto :failed

:missing_git
echo [ERROR] git.exe was not found in PATH.
goto :failed

:missing_node
echo [ERROR] node.exe was not found in PATH.
goto :failed

:missing_npm
echo [ERROR] npm.cmd was not found in PATH.
goto :failed

:git_state_failed
echo [ERROR] Unable to read the installed Git repository state.
goto :failed

:dirty_tree
echo [ERROR] Installed tracked code has local changes. Repair stopped instead of overwriting them.
echo Close this window and send a screenshot to ChatGPT.
goto :failed

:fetch_failed
echo [ERROR] GitHub fetch failed. Network or GitHub authentication may be unavailable.
goto :failed

:not_fast_forward
echo [ERROR] Installed code and GitHub main are not a safe fast-forward. Nothing was changed.
goto :failed

:backup_tool_missing
echo [ERROR] Pre-update database backup tool is missing. Nothing was updated.
goto :failed

:backup_failed
echo [ERROR] Database safety backup failed. Nothing was updated.
goto :failed

:pull_failed
echo [ERROR] Fast-forward update failed. Database was not modified by this repair.
goto :failed

:npm_failed
echo [ERROR] Dependency refresh failed after code update. Send this window screenshot to ChatGPT.
goto :failed

:failed
echo.
echo Repair did not continue. No business-data purge was performed.
echo Press any key to close...
pause >nul
exit /b 1
