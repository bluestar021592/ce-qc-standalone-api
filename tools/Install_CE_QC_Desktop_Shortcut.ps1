$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ProjectIcon = Join-Path $ProjectRoot 'assets\CE_QC_APP.ico'
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'Start_CE_QC.cmd'))) {
  throw "CE QC project launcher not found: $ProjectRoot"
}

$Shell = New-Object -ComObject WScript.Shell

# Resolve every plausible Desktop location so old launchers are removed even
# when Windows/OneDrive redirects Desktop.
$DesktopCandidates = New-Object System.Collections.Generic.List[string]
try { $DesktopCandidates.Add([string]$Shell.SpecialFolders.Item('Desktop')) } catch {}
if ($env:USERPROFILE) { $DesktopCandidates.Add((Join-Path $env:USERPROFILE 'Desktop')) }
if ($env:OneDrive) { $DesktopCandidates.Add((Join-Path $env:OneDrive 'Desktop')) }
if ($env:OneDriveConsumer) { $DesktopCandidates.Add((Join-Path $env:OneDriveConsumer 'Desktop')) }
$Desktop = $DesktopCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $Desktop) {
  $Desktop = Join-Path $env:USERPROFILE 'Desktop'
  New-Item -ItemType Directory -Path $Desktop -Force | Out-Null
}

# IMPORTANT: never launch VBS or CMD through a shortcut path that contains the
# Chinese project folder. This Windows/WSH combination converts that path to ????
# and fails before CE QC even starts. Instead create an ASCII-only launcher root
# under LocalAppData and bridge to the real project with a directory junction.
$LauncherRoot = Join-Path $env:LOCALAPPDATA 'CE_QC_LAUNCHER'
$AppLink = Join-Path $LauncherRoot 'app'
$LauncherScript = Join-Path $LauncherRoot 'Launch_CE_QC.ps1'
$LauncherIcon = Join-Path $LauncherRoot 'CE_EXPRESS_APP.ico'

New-Item -ItemType Directory -Path $LauncherRoot -Force | Out-Null

# Remove only the junction itself. Never recurse through it into the real project.
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

$LauncherContent = @'
$ErrorActionPreference = 'SilentlyContinue'
$url = 'http://127.0.0.1:5177/'

# Fast path: server already running -> open immediately.
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1
  if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500) {
    Start-Process $url
    exit 0
  }
} catch {}

# Cold start through the ASCII junction path. Start_CE_QC.cmd and every child
# process therefore see an ASCII path, while the real source tree may remain in
# its original Chinese-named folder.
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
[IO.File]::WriteAllText($LauncherScript, $LauncherContent, (New-Object Text.UTF8Encoding($false)))

$PowerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $PowerShellExe)) { throw 'powershell.exe was not found.' }

# Remove old launchers from all detected desktop locations.
$OldNames = @(
  'CE_QC_APP.lnk','CE_QC_APP.vbs','CE_QC_APP.cmd','CE_QC_APP_START_INSTALLING.lnk',
  'CE QC APP.lnk','CE QC APP.vbs','CE QC APP.cmd'
)
foreach ($desk in ($DesktopCandidates | Select-Object -Unique)) {
  if (-not $desk) { continue }
  foreach ($name in $OldNames) {
    Remove-Item -LiteralPath (Join-Path $desk $name) -Force -ErrorAction SilentlyContinue
  }
}

$ShortcutPath = Join-Path $Desktop 'CE QC APP.lnk'
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShellExe
$Shortcut.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $LauncherScript + '"'
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

# Verify that NO Chinese project path is stored in shortcut target/arguments.
$Saved = $Shell.CreateShortcut($ShortcutPath)
if ([string]$Saved.TargetPath -ne [string]$PowerShellExe) {
  throw "Shortcut target verification failed: $($Saved.TargetPath)"
}
if ([string]$Saved.Arguments -notlike '*CE_QC_LAUNCHER*Launch_CE_QC.ps1*') {
  throw "Shortcut launcher verification failed: $($Saved.Arguments)"
}
if ([string]$Saved.Arguments -like "*$ProjectRoot*") {
  throw 'Shortcut still contains the Unicode project path; installation aborted.'
}
if ((Test-Path -LiteralPath $LauncherIcon) -and ([string]$Saved.IconLocation -notlike '*CE_EXPRESS_APP.ico*')) {
  throw "Shortcut icon verification failed: $($Saved.IconLocation)"
}

# Refresh Explorer icon presentation. A new ASCII icon path avoids stale cache
# entries from the old CE_QC_APP shortcut.
try {
  $Ie4uinit = Join-Path $env:WINDIR 'System32\ie4uinit.exe'
  if (Test-Path -LiteralPath $Ie4uinit) {
    Start-Process -FilePath $Ie4uinit -ArgumentList '-show' -WindowStyle Hidden -ErrorAction SilentlyContinue | Out-Null
  }
} catch {}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host 'CE QC desktop launcher installed successfully.' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host "Desktop shortcut: $ShortcutPath"
Write-Host "ASCII launcher:   $LauncherScript"
Write-Host "Project bridge:   $AppLink"
if (Test-Path -LiteralPath $LauncherIcon) { Write-Host "CE EXPRESS icon:  $LauncherIcon" -ForegroundColor Green }
Write-Host 'Daily use: double-click CE QC APP.' -ForegroundColor Yellow
Write-Host 'The desktop shortcut no longer stores the Chinese project path.' -ForegroundColor DarkGray
Start-Sleep -Seconds 2
