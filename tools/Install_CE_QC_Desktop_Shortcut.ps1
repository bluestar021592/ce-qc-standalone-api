$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ProjectIcon = Join-Path $ProjectRoot 'assets\CE_QC_APP.ico'
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'Start_CE_QC.cmd'))) {
  throw "CE QC project launcher not found: $ProjectRoot"
}

$Shell = New-Object -ComObject WScript.Shell

# Resolve every plausible Desktop location. Some Windows installations redirect
# Desktop through OneDrive or the User Shell Folders registry value, so relying on
# only %USERPROFILE%\Desktop can leave an old VBS shortcut visible.
$DesktopCandidates = New-Object System.Collections.Generic.List[string]
function Add-DesktopCandidate([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim())
  if (-not $DesktopCandidates.Contains($expanded)) { $DesktopCandidates.Add($expanded) }
}
try { Add-DesktopCandidate ([string]$Shell.SpecialFolders.Item('Desktop')) } catch {}
try { Add-DesktopCandidate ([Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)) } catch {}
try {
  $regDesktop = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -Name Desktop -ErrorAction Stop).Desktop
  Add-DesktopCandidate ([string]$regDesktop)
} catch {}
if ($env:USERPROFILE) { Add-DesktopCandidate (Join-Path $env:USERPROFILE 'Desktop') }
if ($env:OneDrive) { Add-DesktopCandidate (Join-Path $env:OneDrive 'Desktop') }
if ($env:OneDriveConsumer) { Add-DesktopCandidate (Join-Path $env:OneDriveConsumer 'Desktop') }
if ($env:PUBLIC) { Add-DesktopCandidate (Join-Path $env:PUBLIC 'Desktop') }

$Desktop = $DesktopCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $Desktop) {
  $Desktop = Join-Path $env:USERPROFILE 'Desktop'
  New-Item -ItemType Directory -Path $Desktop -Force | Out-Null
  Add-DesktopCandidate $Desktop
}

# Never store the Unicode project path inside the desktop shortcut. The launcher
# lives under an ASCII-only LocalAppData path and reaches the source tree through
# a directory junction.
$LauncherRoot = Join-Path $env:LOCALAPPDATA 'CE_QC_LAUNCHER'
$AppLink = Join-Path $LauncherRoot 'app'
$LauncherPs1 = Join-Path $LauncherRoot 'Launch_CE_QC.ps1'
$LauncherCmd = Join-Path $LauncherRoot 'Launch_CE_QC.cmd'
$LauncherIcon = Join-Path $LauncherRoot 'CE_EXPRESS_APP.ico'

New-Item -ItemType Directory -Path $LauncherRoot -Force | Out-Null

if (Test-Path -LiteralPath $AppLink) {
  $existing = Get-Item -LiteralPath $AppLink -Force
  if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    & cmd.exe /d /c "rmdir `"$AppLink`"" | Out-Null
  } else {
    throw "Launcher bridge path already exists and is not a junction: $AppLink"
  }
}
New-Item -ItemType Junction -Path $AppLink -Target $ProjectRoot | Out-Null

if (Test-Path -LiteralPath $ProjectIcon) {
  Copy-Item -LiteralPath $ProjectIcon -Destination $LauncherIcon -Force
}

$LauncherPs1Content = @'
$ErrorActionPreference = 'SilentlyContinue'
$url = 'http://127.0.0.1:5177/'

# Fast path: if CE QC is already running, open it immediately.
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1
  if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500) {
    Start-Process $url
    exit 0
  }
} catch {}

# Cold start through the ASCII junction path.
$appRoot = Join-Path $PSScriptRoot 'app'
$cmd = Join-Path $appRoot 'Start_CE_QC.cmd'
if (-not (Test-Path -LiteralPath $cmd)) {
  Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
  try { [System.Windows.MessageBox]::Show('CE QC launcher is missing. Please reinstall the desktop shortcut.','CE QC') | Out-Null } catch {}
  exit 2
}

Start-Process -FilePath $cmd -WorkingDirectory $appRoot -WindowStyle Hidden
exit 0
'@
[IO.File]::WriteAllText($LauncherPs1, $LauncherPs1Content, (New-Object Text.UTF8Encoding($false)))

$LauncherCmdContent = @'
@echo off
start "" /b powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Launch_CE_QC.ps1"
exit /b 0
'@
[IO.File]::WriteAllText($LauncherCmd, $LauncherCmdContent, [Text.Encoding]::ASCII)

# Aggressively remove stale CE QC shortcuts, including old shortcuts with custom
# names whose hidden target/arguments still reference Start_CE_QC_Auto.vbs.
$OldNames = @(
  'CE_QC_APP.lnk','CE_QC_APP.vbs','CE_QC_APP.cmd','CE_QC_APP_START_INSTALLING.lnk',
  'CE QC APP.lnk','CE QC APP.vbs','CE QC APP.cmd','CE EXPRESS QC.lnk'
)
foreach ($desk in ($DesktopCandidates | Select-Object -Unique)) {
  if (-not $desk -or -not (Test-Path -LiteralPath $desk)) { continue }

  foreach ($name in $OldNames) {
    Remove-Item -LiteralPath (Join-Path $desk $name) -Force -ErrorAction SilentlyContinue
  }

  Get-ChildItem -LiteralPath $desk -Filter '*.lnk' -File -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $candidate = $Shell.CreateShortcut($_.FullName)
      $target = [string]$candidate.TargetPath
      $args = [string]$candidate.Arguments
      $blob = ($_.Name + ' ' + $target + ' ' + $args).ToUpperInvariant()
      if ($blob -match 'START_CE_QC_AUTO\.VBS|CE_QC_APP|CE_QC_LAUNCHER|LAUNCH_CE_QC|START_CE_QC\.CMD') {
        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
}

# Create ONE new shortcut. Its target is an ASCII .cmd file with no arguments,
# so Windows Script Host is no longer part of the launch path at all.
$ShortcutPath = Join-Path $Desktop 'CE QC APP.lnk'
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $LauncherCmd
$Shortcut.Arguments = ''
$Shortcut.WorkingDirectory = $LauncherRoot
$Shortcut.Description = 'CE Express Quality Control APP - one click start'
$Shortcut.WindowStyle = 7
if (Test-Path -LiteralPath $LauncherIcon) {
  $Shortcut.IconLocation = $LauncherIcon + ',0'
}
$Shortcut.Save()

if (-not (Test-Path -LiteralPath $ShortcutPath)) {
  throw "Desktop shortcut was not created: $ShortcutPath"
}

$Saved = $Shell.CreateShortcut($ShortcutPath)
if ([string]$Saved.TargetPath -ne [string]$LauncherCmd) {
  throw "Shortcut target verification failed: $($Saved.TargetPath)"
}
if (-not [string]::IsNullOrWhiteSpace([string]$Saved.Arguments)) {
  throw "Shortcut arguments must be empty: $($Saved.Arguments)"
}
if ([string]$Saved.TargetPath -like "*$ProjectRoot*") {
  throw 'Shortcut still contains the Unicode project path; installation aborted.'
}
if ((Test-Path -LiteralPath $LauncherIcon) -and ([string]$Saved.IconLocation -notlike '*CE_EXPRESS_APP.ico*')) {
  throw "Shortcut icon verification failed: $($Saved.IconLocation)"
}

# Refresh Explorer icon presentation.
try {
  $Ie4uinit = Join-Path $env:WINDIR 'System32\ie4uinit.exe'
  if (Test-Path -LiteralPath $Ie4uinit) {
    Start-Process -FilePath $Ie4uinit -ArgumentList '-show' -WindowStyle Hidden -ErrorAction SilentlyContinue | Out-Null
  }
} catch {}

Write-Host ''
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host 'CE QC desktop launcher installed successfully.' -ForegroundColor Green
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host "Desktop:          $Desktop"
Write-Host "Shortcut:         $ShortcutPath"
Write-Host "Shortcut target:  $LauncherCmd"
Write-Host "Project bridge:   $AppLink"
if (Test-Path -LiteralPath $LauncherIcon) { Write-Host "CE EXPRESS icon:  $LauncherIcon" -ForegroundColor Green }
Write-Host ''
Write-Host 'IMPORTANT: old VBS shortcuts were removed.' -ForegroundColor Yellow
Write-Host 'Daily use: double-click CE QC APP.' -ForegroundColor Yellow
Start-Sleep -Seconds 3
