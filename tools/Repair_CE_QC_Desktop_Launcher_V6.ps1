$ErrorActionPreference = 'Stop'

$Shell = New-Object -ComObject WScript.Shell
$Desktop = [string]$Shell.SpecialFolders.Item('Desktop')
if ([string]::IsNullOrWhiteSpace($Desktop)) {
  $Desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
}
if ([string]::IsNullOrWhiteSpace($Desktop)) { throw 'Desktop path could not be resolved.' }

$LauncherRoot = Join-Path $env:LOCALAPPDATA 'CE_QC_LAUNCHER'
$AppRoot = Join-Path $LauncherRoot 'app'
$LauncherPs1 = Join-Path $LauncherRoot 'Launch_CE_QC.ps1'
$LauncherVbs = Join-Path $LauncherRoot 'Launch_CE_QC.vbs'
$LauncherIcon = Join-Path $LauncherRoot 'CE_EXPRESS_APP_V5.ico'
$Supervisor = Join-Path $AppRoot 'Start_CE_QC.ps1'
$LogFile = Join-Path $LauncherRoot 'launcher_latest.log'

if (-not (Test-Path -LiteralPath $AppRoot)) { throw "CE QC launcher bridge is missing: $AppRoot" }
if (-not (Test-Path -LiteralPath $Supervisor)) { throw "CE QC supervisor is missing: $Supervisor" }
if (-not (Test-Path -LiteralPath $LauncherIcon)) { throw "CE EXPRESS icon is missing: $LauncherIcon" }

$LauncherContent = @'
$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:5177/'
$launcherRoot = $PSScriptRoot
$appRoot = Join-Path $launcherRoot 'app'
$supervisor = Join-Path $appRoot 'Start_CE_QC.ps1'
$logFile = Join-Path $launcherRoot 'launcher_latest.log'

function Write-LauncherLog([string]$Text) {
  try { Add-Content -LiteralPath $logFile -Value (('{0:yyyy-MM-dd HH:mm:ss.fff} {1}' -f (Get-Date), $Text)) -Encoding UTF8 } catch {}
}

function Test-CeQcReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
    $status = [int]$response.StatusCode
    return ($status -ge 200 -and $status -lt 500)
  } catch {
    try {
      if ($_.Exception.Response) {
        $status = [int]$_.Exception.Response.StatusCode
        return ($status -ge 200 -and $status -lt 500)
      }
    } catch {}
    return $false
  }
}

function Open-CeQcBrowser {
  Write-LauncherLog 'Opening CE QC in default browser via explorer.exe.'
  Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList $url | Out-Null
}

function Show-LauncherError([string]$Message) {
  Write-LauncherLog ('ERROR ' + $Message)
  try {
    Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
    [System.Windows.MessageBox]::Show($Message, 'CE QC APP') | Out-Null
  } catch {}
}

try {
  Remove-Item -LiteralPath $logFile -Force -ErrorAction SilentlyContinue
  Write-LauncherLog 'Desktop launcher V6 started.'

  if (Test-CeQcReady) {
    Write-LauncherLog 'Backend already ready.'
    Open-CeQcBrowser
    exit 0
  }

  if (-not (Test-Path -LiteralPath $supervisor)) {
    Show-LauncherError 'CE QC startup file is missing. Please reinstall the desktop launcher.'
    exit 2
  }

  $powerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path -LiteralPath $powerShellExe)) {
    Show-LauncherError 'Windows PowerShell was not found.'
    exit 3
  }

  Write-LauncherLog ('Starting hidden supervisor: ' + $supervisor)
  $oldCi = $env:CI
  $env:CI = '1'
  try {
    $proc = Start-Process -FilePath $powerShellExe `
      -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"' + $supervisor + '"')) `
      -WorkingDirectory $appRoot `
      -WindowStyle Hidden `
      -PassThru
  } finally {
    if ($null -eq $oldCi) { Remove-Item Env:CI -ErrorAction SilentlyContinue } else { $env:CI = $oldCi }
  }

  for ($i = 0; $i -lt 480; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-CeQcReady) {
      Write-LauncherLog 'Backend became ready.'
      Open-CeQcBrowser
      exit 0
    }
    try {
      $proc.Refresh()
      if ($proc.HasExited) {
        Write-LauncherLog ('Supervisor exited early with code ' + $proc.ExitCode)
        break
      }
    } catch {}
  }

  $startupLog = Join-Path $appRoot 'logs\startup_latest.log'
  Show-LauncherError ("CE QC did not become ready.`n`nStartup log: $startupLog`nLauncher log: $logFile")
  exit 10
}
catch {
  Show-LauncherError ('CE QC could not start: ' + $_.Exception.Message + "`n`nLauncher log: " + $logFile)
  exit 11
}
'@
[IO.File]::WriteAllText($LauncherPs1, $LauncherContent, (New-Object Text.UTF8Encoding($false)))

$VbsContent = @'
Option Explicit
Dim shell, ps, script, cmd
Set shell = CreateObject("WScript.Shell")
ps = shell.ExpandEnvironmentStrings("%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe")
script = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\CE_QC_LAUNCHER\Launch_CE_QC.ps1")
cmd = Chr(34) & ps & Chr(34) & " -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & script & Chr(34)
shell.Run cmd, 0, False
'@
[IO.File]::WriteAllText($LauncherVbs, $VbsContent, (New-Object Text.UTF8Encoding($false)))

$WScriptExe = Join-Path $env:WINDIR 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $WScriptExe)) { throw 'wscript.exe was not found.' }

$ShortcutPath = Join-Path $Desktop 'CE QC APP.lnk'
Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction SilentlyContinue
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $WScriptExe
$Shortcut.Arguments = '"' + $LauncherVbs + '"'
$Shortcut.WorkingDirectory = $LauncherRoot
$Shortcut.Description = 'CE Express Quality Control APP - one click silent start'
$Shortcut.WindowStyle = 7
$Shortcut.IconLocation = $LauncherIcon + ',0'
$Shortcut.Save()

$Saved = $Shell.CreateShortcut($ShortcutPath)
if ([string]$Saved.TargetPath -ne [string]$WScriptExe) { throw "Shortcut target verification failed: $($Saved.TargetPath)" }
if ([string]$Saved.Arguments -notlike '*Launch_CE_QC.vbs*') { throw "Shortcut argument verification failed: $($Saved.Arguments)" }

Write-Host ''
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host 'CE QC desktop launcher V6 repaired successfully.' -ForegroundColor Green
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host "Desktop shortcut: $ShortcutPath"
Write-Host "Shortcut target:  $WScriptExe"
Write-Host "Silent wrapper:   $LauncherVbs"
Write-Host "Hidden launcher:  $LauncherPs1"
Write-Host ''
Write-Host 'V6 prevents the blank Windows Terminal window and opens the browser itself after backend readiness.' -ForegroundColor Yellow
