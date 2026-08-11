$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ProjectLauncher = Join-Path $ProjectRoot 'Start_CE_QC.ps1'
$IconSourceB64 = Join-Path $ProjectRoot 'assets\CE_EXPRESS_DESKTOP_V4.ico.b64'
if (-not (Test-Path -LiteralPath $ProjectLauncher)) {
  throw "CE QC project launcher not found: $ProjectLauncher"
}
if (-not (Test-Path -LiteralPath $IconSourceB64)) {
  throw "CE EXPRESS icon source not found: $IconSourceB64"
}

$Shell = New-Object -ComObject WScript.Shell

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

# Keep the complete desktop launch chain in an ASCII-only location.
$LauncherRoot = Join-Path $env:LOCALAPPDATA 'CE_QC_LAUNCHER'
$AppLink = Join-Path $LauncherRoot 'app'
$LauncherPs1 = Join-Path $LauncherRoot 'Launch_CE_QC.ps1'
$LauncherLog = Join-Path $LauncherRoot 'launcher_latest.log'
$LauncherIcon = Join-Path $LauncherRoot 'CE_EXPRESS_APP_V4.ico'
New-Item -ItemType Directory -Path $LauncherRoot -Force | Out-Null

# Rebuild the project bridge. The real source tree can stay in the Chinese path,
# while every process launched by the desktop shortcut sees the ASCII junction.
if (Test-Path -LiteralPath $AppLink) {
  $existing = Get-Item -LiteralPath $AppLink -Force
  if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    & cmd.exe /d /c "rmdir `"$AppLink`"" | Out-Null
  } else {
    throw "Launcher bridge path already exists and is not a junction: $AppLink"
  }
}
New-Item -ItemType Junction -Path $AppLink -Target $ProjectRoot | Out-Null

# The repository stores the exact user-provided 256px CE EXPRESS artwork as
# base64 PNG text. Wrap that PNG in a valid single-frame ICO container so Explorer
# always gets the exact artwork and a NEW icon path, bypassing the stale icon cache.
$pngB64 = (Get-Content -LiteralPath $IconSourceB64 -Raw -ErrorAction Stop) -replace '\s',''
$pngBytes = [Convert]::FromBase64String($pngB64)
$stream = New-Object IO.MemoryStream
$writer = New-Object IO.BinaryWriter($stream)
try {
  $writer.Write([UInt16]0)      # reserved
  $writer.Write([UInt16]1)      # icon
  $writer.Write([UInt16]1)      # one image
  $writer.Write([byte]0)        # width 256
  $writer.Write([byte]0)        # height 256
  $writer.Write([byte]0)        # palette
  $writer.Write([byte]0)        # reserved
  $writer.Write([UInt16]1)      # planes
  $writer.Write([UInt16]32)     # bit depth
  $writer.Write([UInt32]$pngBytes.Length)
  $writer.Write([UInt32]22)     # image offset
  $writer.Write($pngBytes)
  $writer.Flush()
  [IO.File]::WriteAllBytes($LauncherIcon, $stream.ToArray())
}
finally {
  $writer.Dispose()
  $stream.Dispose()
}

$LauncherPs1Content = @'
$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:5177/'
$launcherRoot = $PSScriptRoot
$logFile = Join-Path $launcherRoot 'launcher_latest.log'

function Write-LauncherLog([string]$Text) {
  try {
    $line = ('{0:yyyy-MM-dd HH:mm:ss.fff} {1}' -f (Get-Date), $Text)
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  } catch {}
}

function Test-CeQcReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
    return ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500)
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

function Show-LauncherError([string]$Message) {
  Write-LauncherLog ('ERROR ' + $Message)
  try {
    Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
    [System.Windows.MessageBox]::Show($Message, 'CE QC APP') | Out-Null
  } catch {}
}

try {
  Remove-Item -LiteralPath $logFile -Force -ErrorAction SilentlyContinue
  Write-LauncherLog 'Desktop launcher started.'

  if (Test-CeQcReady) {
    Write-LauncherLog 'Backend already ready. Opening browser.'
    Start-Process $url | Out-Null
    exit 0
  }

  $appRoot = Join-Path $launcherRoot 'app'
  $supervisor = Join-Path $appRoot 'Start_CE_QC.ps1'
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
  Start-Process -FilePath $powerShellExe `
    -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $supervisor + '"')) `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden | Out-Null

  # Start_CE_QC.ps1 verifies the backend and opens the browser itself when ready.
  # This launcher can safely exit immediately; the hidden supervisor remains alive.
  Write-LauncherLog 'Hidden supervisor process created successfully.'
  exit 0
}
catch {
  Show-LauncherError ('CE QC could not start: ' + $_.Exception.Message + "`n`nLog: " + $logFile)
  exit 10
}
'@
[IO.File]::WriteAllText($LauncherPs1, $LauncherPs1Content, (New-Object Text.UTF8Encoding($false)))

# Remove obsolete launcher files from LocalAppData as well as stale desktop links.
Remove-Item -LiteralPath (Join-Path $LauncherRoot 'Launch_CE_QC.cmd') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $LauncherRoot 'Launch_CE_QC.vbs') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $LauncherRoot 'CE_EXPRESS_APP.ico') -Force -ErrorAction SilentlyContinue

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

# Direct PowerShell shortcut: no CMD console window, no VBS/Windows Script Host,
# and no Unicode project path is stored in the .lnk file.
$PowerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $PowerShellExe)) { throw 'powershell.exe was not found.' }

$ShortcutPath = Join-Path $Desktop 'CE QC APP.lnk'
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShellExe
$Shortcut.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $LauncherPs1 + '"'
$Shortcut.WorkingDirectory = $LauncherRoot
$Shortcut.Description = 'CE Express Quality Control APP - one click start'
$Shortcut.WindowStyle = 7
$Shortcut.IconLocation = $LauncherIcon + ',0'
$Shortcut.Save()

if (-not (Test-Path -LiteralPath $ShortcutPath)) {
  throw "Desktop shortcut was not created: $ShortcutPath"
}
$Saved = $Shell.CreateShortcut($ShortcutPath)
if ([string]$Saved.TargetPath -ne [string]$PowerShellExe) {
  throw "Shortcut target verification failed: $($Saved.TargetPath)"
}
if ([string]$Saved.Arguments -notlike '*CE_QC_LAUNCHER*Launch_CE_QC.ps1*') {
  throw "Shortcut arguments verification failed: $($Saved.Arguments)"
}
if ([string]$Saved.TargetPath -like "*$ProjectRoot*" -or [string]$Saved.Arguments -like "*$ProjectRoot*") {
  throw 'Shortcut still contains the Unicode project path; installation aborted.'
}
if ([string]$Saved.IconLocation -notlike '*CE_EXPRESS_APP_V4.ico*') {
  throw "Shortcut icon verification failed: $($Saved.IconLocation)"
}

# Force Explorer to notice the new V4 icon path.
try {
  $Ie4uinit = Join-Path $env:WINDIR 'System32\ie4uinit.exe'
  if (Test-Path -LiteralPath $Ie4uinit) {
    Start-Process -FilePath $Ie4uinit -ArgumentList '-ClearIconCache' -WindowStyle Hidden -ErrorAction SilentlyContinue | Out-Null
    Start-Sleep -Milliseconds 300
    Start-Process -FilePath $Ie4uinit -ArgumentList '-show' -WindowStyle Hidden -ErrorAction SilentlyContinue | Out-Null
  }
} catch {}

Write-Host ''
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host 'CE QC desktop launcher V4 installed successfully.' -ForegroundColor Green
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host "Desktop:          $Desktop"
Write-Host "Shortcut:         $ShortcutPath"
Write-Host "Shortcut target:  $PowerShellExe"
Write-Host "Hidden launcher:  $LauncherPs1"
Write-Host "Project bridge:   $AppLink"
Write-Host "CE EXPRESS icon:  $LauncherIcon" -ForegroundColor Green
Write-Host ''
Write-Host 'NO CMD window. NO VBS. NO Windows Script Host.' -ForegroundColor Yellow
Write-Host 'Daily use: double-click CE QC APP.' -ForegroundColor Yellow
Start-Sleep -Seconds 2
