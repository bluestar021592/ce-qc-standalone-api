@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title CE QC GitHub Free CI

echo ==============================================
echo   CE QC GitHub Free CI
echo   Private ^> temporary Public ^> CI ^> Private
echo ==============================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\CE_QC_GitHub_Free_CI.ps1"
set "EC=%ERRORLEVEL%"

echo.
if "%EC%"=="0" (
  echo [完成] 最终 CI 已通过，仓库已恢复原来的可见性。
) else if "%EC%"=="1" (
  echo [未通过] CI 已真正运行，但存在测试失败。仓库恢复动作已执行。
) else (
  echo [错误] 免费 CI 流程未正常完成。请查看上面的具体原因。
  echo 如果看到“恢复 Private 失败”，请立即到 GitHub Settings 手动改回 Private。
)
echo.
pause
exit /b %EC%
