@echo off
setlocal

cd /d "C:\Users\CELNT-~1\DOCUME~1\CECCSL~1\CE-QC-~1"
if errorlevel 1 (
  echo Cannot open project folder.
  echo Project folder should be:
  echo C:\Users\CELNT-EE-097\Documents\CE CCSL QC APP\ce-qc-standalone-api
  pause
  exit /b 1
)

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=C:\Users\CELNT-EE-097\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" (
  echo Node.js was not found.
  echo Please install Node.js 18+ or tell Codex to use the bundled runtime.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo node_modules was not found.
  echo Please run install first.
  pause
  exit /b 1
)

echo Starting CE QC standalone API...
echo.
echo Stopping old server on port 5177 if it exists...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5177" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%P >nul 2>nul
)
echo.
echo Keep this black window open.
echo After you see "本机访问" and "局域网访问", open:
echo http://127.0.0.1:5177
echo.
"%NODE_EXE%" server.js

echo.
echo Server stopped or failed to start.
pause
