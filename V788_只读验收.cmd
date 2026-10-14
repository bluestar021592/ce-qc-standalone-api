@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. V788 read-only acceptance cannot run.
  pause
  exit /b 1
)
node --version
echo V788 isolated-copy READ-ONLY acceptance: original D database will NOT be touched.
node "%~dp0scripts\v788-run-isolated-readonly-acceptance.mjs"
if errorlevel 1 (
  echo Acceptance not completed. No import, purge, or database update was performed.
  pause
  exit /b 1
)
echo Read-only acceptance report created beside this launcher.
pause
