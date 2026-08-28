@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title CE QC APP - Launcher DNS Recovery

set "APP=%LOCALAPPDATA%\CE_QC_LAUNCHER\app"
set "LAUNCHER=%APP%\tools\CE_QC_Managed_Launcher.ps1"
set "IPS=%TEMP%\CE_QC_GITHUB_IPS_%RANDOM%_%RANDOM%.txt"
set "OLD=%TEMP%\CE_QC_GIT_RESOLVE_%RANDOM%_%RANDOM%.txt"
set "FALLBACK_RESOLVE="
set "LAUNCH_EC=1"

echo =============================================================
echo  CE QC APP - Managed Launcher DNS Recovery
echo =============================================================
echo.

if not exist "%APP%\.git" goto :missing_app
if not exist "%LAUNCHER%" goto :missing_launcher
where git.exe >nul 2>&1
if errorlevel 1 goto :missing_git
where powershell.exe >nul 2>&1
if errorlevel 1 goto :missing_powershell

rem Preserve any existing repository-local curl resolver setting. The fallback is
rem temporary and is always restored after the managed launcher exits.
git -C "%APP%" config --local --get-all http.curloptResolve > "%OLD%" 2>nul

echo [1/4] Checking GitHub with bounded retries...
for /L %%A in (1,1,3) do (
  git -C "%APP%" fetch --quiet origin main
  if not errorlevel 1 goto :github_ready
  if not "%%A"=="3" (
    echo [UPDATE] GitHub fetch attempt %%A/3 failed. Retrying...
    timeout /t %%A /nobreak >nul
  )
)

echo [2/4] Windows DNS could not resolve GitHub. Querying public DNS directly...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $out=@(); foreach($s in @('1.1.1.1','8.8.8.8')){ try{$out += Resolve-DnsName github.com -Server $s -Type A -DnsOnly -QuickTimeout -ErrorAction Stop} catch{} }; $out | Where-Object { $_.IPAddress -match '^\d{1,3}(\.\d{1,3}){3}$' } | Select-Object -ExpandProperty IPAddress -Unique" > "%IPS%"

for /f "usebackq delims=" %%I in ("%IPS%") do (
  echo [UPDATE] Retrying github.com through explicit DNS result %%I ...
  git -C "%APP%" -c "http.curloptResolve=github.com:443:%%I" fetch --quiet origin main
  if not errorlevel 1 (
    set "FALLBACK_RESOLVE=github.com:443:%%I"
    goto :github_ready
  )
)

goto :fetch_failed

:github_ready
if defined FALLBACK_RESOLVE (
  echo [UPDATE] Temporary Git resolver fallback enabled for this recovery only.
  git -C "%APP%" config --local --unset-all http.curloptResolve >nul 2>&1
  git -C "%APP%" config --local --add http.curloptResolve "%FALLBACK_RESOLVE%"
  if errorlevel 1 goto :resolver_config_failed
) else (
  echo [UPDATE] Normal GitHub connectivity is available.
)

echo [3/4] Starting the existing verified managed updater...
echo       It will test the exact candidate, protect SQLite, then install only if all gates pass.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%"
set "LAUNCH_EC=%ERRORLEVEL%"

echo [4/4] Restoring temporary Git resolver settings...
call :restore_resolver
if exist "%IPS%" del /q "%IPS%" >nul 2>&1
if exist "%OLD%" del /q "%OLD%" >nul 2>&1
exit /b %LAUNCH_EC%

:restore_resolver
git -C "%APP%" config --local --unset-all http.curloptResolve >nul 2>&1
if exist "%OLD%" (
  for /f "usebackq delims=" %%R in ("%OLD%") do git -C "%APP%" config --local --add http.curloptResolve "%%R" >nul 2>&1
)
exit /b 0

:missing_app
echo [ERROR] CE QC installed app was not found:
echo %APP%
goto :failed

:missing_launcher
echo [ERROR] Managed launcher was not found:
echo %LAUNCHER%
goto :failed

:missing_git
echo [ERROR] git.exe was not found in PATH.
goto :failed

:missing_powershell
echo [ERROR] Windows PowerShell was not found.
goto :failed

:resolver_config_failed
echo [ERROR] Temporary Git resolver could not be configured.
goto :failed_restore

:fetch_failed
echo [ERROR] GitHub is still unreachable after normal retries and explicit DNS fallback.
echo         Current CE QC data was not modified.
goto :failed_restore

:failed_restore
call :restore_resolver

:failed
if exist "%IPS%" del /q "%IPS%" >nul 2>&1
if exist "%OLD%" del /q "%OLD%" >nul 2>&1
echo.
echo Recovery stopped safely. No business-data purge was performed.
echo Press any key to close...
pause >nul
exit /b 1
