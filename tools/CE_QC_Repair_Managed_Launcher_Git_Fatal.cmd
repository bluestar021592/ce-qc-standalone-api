@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title CE QC APP - Launcher DNS Recovery

set "APP=%LOCALAPPDATA%\CE_QC_LAUNCHER\app"
set "LAUNCHER=%APP%\tools\CE_QC_Managed_Launcher.ps1"
set "IPS=%TEMP%\CE_QC_GITHUB_IPS_%RANDOM%_%RANDOM%.txt"
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
  echo [UPDATE] Temporary Git resolver fallback enabled for this recovery process only.
  set "GIT_CONFIG_COUNT=1"
  set "GIT_CONFIG_KEY_0=http.curloptResolve"
  set "GIT_CONFIG_VALUE_0=%FALLBACK_RESOLVE%"
) else (
  echo [UPDATE] Normal GitHub connectivity is available.
)

echo [3/4] Starting the existing verified managed updater...
echo       It will test the exact candidate, protect SQLite, then install only if all gates pass.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%"
set "LAUNCH_EC=%ERRORLEVEL%"

echo [4/4] Recovery process finished. No Windows DNS or persistent Git setting was changed.
if exist "%IPS%" del /q "%IPS%" >nul 2>&1
exit /b %LAUNCH_EC%

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

:fetch_failed
echo [ERROR] GitHub is still unreachable after normal retries and explicit DNS fallback.
echo         Current CE QC data was not modified.
goto :failed

:failed
if exist "%IPS%" del /q "%IPS%" >nul 2>&1
echo.
echo Recovery stopped safely. No business-data purge was performed.
echo Press any key to close...
pause >nul
exit /b 1
