$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AutoLauncher = Join-Path $ProjectRoot 'Start_CE_QC_Auto.vbs'
$IconPath = Join-Path $ProjectRoot 'assets\CE_QC_APP.ico'

if (-not (Test-Path -LiteralPath $AutoLauncher)) {
  throw "CE QC one-click launcher not found: $AutoLauncher"
}
if (-not (Test-Path -LiteralPath $IconPath)) {
  throw "CE EXPRESS desktop icon not found: $IconPath"
}

$Shell = New-Object -ComObject WScript.Shell

# Build every Desktop location Windows may actually be showing. This includes
# normal Desktop, OneDrive redirected Desktop, WSH Desktop and an optional
# operator override. Older installers sometimes created CE_QC_APP on a different
# Desktop path than the one later resolved by WSH, leaving the visible old file.
$DesktopCandidates = New-Object System.Collections.Generic.List[string]
function Add-DesktopCandidate([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  try { $full = [IO.Path]::GetFullPath($Path) } catch { return }
  if (-not $DesktopCandidates.Contains($full)) { $DesktopCandidates.Add($full) }
}

Add-DesktopCandidate $env:CE_QC_SHORTCUT_DESKTOP
try { Add-DesktopCandidate ([Environment]::GetFolderPath('Desktop')) } catch {}
try { Add-DesktopCandidate ([string]$Shell.SpecialFolders.Item('Desktop')) } catch {}
if ($env:USERPROFILE) { Add-DesktopCandidate (Join-Path $env:USERPROFILE 'Desktop') }
if ($env:OneDrive) { Add-DesktopCandidate (Join-Path $env:OneDrive 'Desktop') }
if ($env:OneDriveConsumer) { Add-DesktopCandidate (Join-Path $env:OneDriveConsumer 'Desktop') }
if ($env:OneDriveCommercial) { Add-DesktopCandidate (Join-Path $env:OneDriveCommercial 'Desktop') }
try {
  $regDesktop = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -Name Desktop -ErrorAction Stop).Desktop
  if ($regDesktop) { Add-DesktopCandidate ([Environment]::ExpandEnvironmentVariables([string]$regDesktop)) }
} catch {}

if ($DesktopCandidates.Count -eq 0) {
  throw 'Windows Desktop folder could not be resolved.'
}

$ChineseLauncherName = -join @('CE ',[char]0x8D28,[char]0x63A7,'APP',[char]0x542F,[char]0x52A8)
$OldNames = @(
  'CE QC APP.lnk',
  'CE_QC_APP.lnk',
  'CE_QC_APP.vbs',
  'CE_QC_APP.cmd',
  'CE_QC_APP_START_INSTALLING.lnk',
  ($ChineseLauncherName + '.lnk'),
  ($ChineseLauncherName + '.cmd')
)

# Prefer the Desktop that currently contains the visible old CE_QC_APP file.
# This makes the repair replace exactly what the user sees instead of silently
# creating a second shortcut somewhere else.
$Desktop = $null
foreach ($candidate in $DesktopCandidates) {
  foreach ($name in $OldNames) {
    if (Test-Path -LiteralPath (Join-Path $candidate $name)) {
      $Desktop = $candidate
      break
    }
  }
  if ($Desktop) { break }
}
if (-not $Desktop) {
  foreach ($candidate in $DesktopCandidates) {
    if (Test-Path -LiteralPath $candidate) { $Desktop = $candidate; break }
  }
}
if (-not $Desktop) {
  $Desktop = $DesktopCandidates[0]
  New-Item -ItemType Directory -Path $Desktop -Force | Out-Null
}

# Remove old launcher variants from ALL known Desktop locations so Explorer
# cannot keep showing the underscore version from a redirected Desktop.
foreach ($candidate in $DesktopCandidates) {
  foreach ($name in $OldNames) {
    Remove-Item -LiteralPath (Join-Path $candidate $name) -Force -ErrorAction SilentlyContinue
  }
}

# Create one clean launcher. The visible file name intentionally contains spaces
# and no underscores: CE QC APP.
$ShortcutPath = Join-Path $Desktop 'CE QC APP.lnk'
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $AutoLauncher
$Shortcut.Arguments = ''
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = 'CE Express Quality Control APP - one click start'
$Shortcut.WindowStyle = 1
$Shortcut.IconLocation = $IconPath + ',0'
$Shortcut.Save()

if (-not (Test-Path -LiteralPath $ShortcutPath)) {
  throw "Shortcut save returned without creating the file: $ShortcutPath"
}

$SavedShortcut = $Shell.CreateShortcut($ShortcutPath)
if ([string]$SavedShortcut.TargetPath -ne [string]$AutoLauncher) {
  throw "Shortcut target verification failed. Expected: $AutoLauncher ; Saved: $($SavedShortcut.TargetPath)"
}
if ([string]$SavedShortcut.Arguments) {
  throw "Shortcut unexpectedly contains launcher arguments: $($SavedShortcut.Arguments)"
}
if ([string]$SavedShortcut.IconLocation -notlike '*CE_QC_APP.ico*') {
  throw "Shortcut icon verification failed. Saved icon: $($SavedShortcut.IconLocation)"
}

# Force Explorer to discard the old generic/blank icon presentation.
try {
  $Ie4uinit = Join-Path $env:WINDIR 'System32\ie4uinit.exe'
  if (Test-Path -LiteralPath $Ie4uinit) {
    Start-Process -FilePath $Ie4uinit -ArgumentList '-ClearIconCache' -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
    Start-Process -FilePath $Ie4uinit -ArgumentList '-show' -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
  }
} catch {}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host 'CE QC desktop launcher repaired successfully.' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host "Desktop: $Desktop"
Write-Host "Desktop launcher: $ShortcutPath"
Write-Host "Target: $AutoLauncher"
Write-Host "CE EXPRESS icon: $IconPath" -ForegroundColor Green
Write-Host 'Visible name must be: CE QC APP' -ForegroundColor Yellow
Write-Host 'No underscore shortcut should remain on any detected Desktop.' -ForegroundColor DarkGray
Start-Sleep -Seconds 2
