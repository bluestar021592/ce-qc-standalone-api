@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo [V788] 无法打开QC项目目录。未修改任何文件。
  pause
  exit /b 10
)
where node.exe >nul 2>&1
if errorlevel 1 (
  echo [V788] 未找到Node.js，无法读取本机验收记录；正式系统不受影响。
  pause
  exit /b 10
)
echo [V788] 先只读核对D盘隔离数据库中的WHPP来源、终态及OPEN账本。
node "scripts\v788-local-whpp-readonly-probe.mjs"
echo.
echo [V788] 再查看已有验收报告和真实Excel/签收时间等未核验条件。
node "scripts\v788-offline-release-review.mjs" "D:\CE_QC_V788_验收副本\V788_只读验收结果.json"
echo.
echo [V788] 当前工具仅用于查看阻断原因，不能作为清空、更新或正式发布许可。
pause
exit /b 10
