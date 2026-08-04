@echo off
chcp 65001 >nul
setlocal
set NODE_OPTIONS=--enable-source-maps
cd /d "%~dp0"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=C:\Users\CELNT-EE-097\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" (
  echo 未找到 Node.js，请先安装 Node.js 18 或更高版本。
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo 未找到项目依赖，请先运行 npm.cmd install。
  pause
  exit /b 1
)

echo 正在启动 CE 质控系统...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5177" ^| findstr "LISTENING"') do taskkill /F /PID %%P >nul 2>nul
echo.
echo 本机访问：http://127.0.0.1:5177
echo 同一局域网：启动成功后查看“局域网访问”地址
echo 不同网络/外地：https://qc.cambodianexpress.com
echo.
echo 请保持此窗口运行。
"%NODE_EXE%" server.js
echo.
echo 服务已停止或启动失败。
pause
