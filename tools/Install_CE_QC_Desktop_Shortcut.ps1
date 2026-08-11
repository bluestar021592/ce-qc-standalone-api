$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AutoLauncher = Join-Path $ProjectRoot 'Start_CE_QC_Auto.vbs'
$IconPath = Join-Path $ProjectRoot 'assets\CE_QC_APP.ico'

if (-not (Test-Path -LiteralPath $AutoLauncher)) {
  throw "CE QC one-click launcher not found: $AutoLauncher"
}

$Shell = New-Object -ComObject WScript.Shell

# Resolve the actual Windows desktop, including OneDrive/domain redirected desktops.
$Desktop = $env:CE_QC_SHORTCUT_DESKTOP
if (-not $Desktop) {
  try { $Desktop = [string]$Shell.SpecialFolders.Item('Desktop') } catch {}
}
if (-not $Desktop) { $Desktop = Join-Path $env:USERPROFILE 'Desktop' }
if (-not $Desktop) { throw 'Windows Desktop folder could not be resolved.' }
if (-not (Test-Path -LiteralPath $Desktop)) {
  New-Item -ItemType Directory -Path $Desktop -Force | Out-Null
}

$ChineseLauncherName = -join @(
  'CE ',
  [char]0x8D28,
  [char]0x63A7,
  'APP',
  [char]0x542F,
  [char]0x52A8
)

# Remove every launcher name used by older installers. The old shortcut stored
# the Unicode project path inside WSH Arguments, which can become ???? on some
# Windows configurations and then fail with "file name/directory syntax".
$OldLaunchers = @(
  (Join-Path $Desktop 'CE QC APP.lnk'),
  (Join-Path $Desktop 'CE_QC_APP.lnk'),
  (Join-Path $Desktop ($ChineseLauncherName + '.lnk')),
  (Join-Path $Desktop 'CE_QC_APP.vbs'),
  (Join-Path $Desktop ($ChineseLauncherName + '.cmd')),
  (Join-Path $Desktop 'CE_QC_APP.cmd'),
  (Join-Path $Desktop 'CE_QC_APP_START_INSTALLING.lnk')
)
foreach ($old in $OldLaunchers) {
  Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
}

# Use a clean ASCII shortcut file name, but point DIRECTLY to the VBS file.
# There are deliberately no command-line arguments containing the project path.
# A .lnk TargetPath is stored as Unicode and is safe when the project directory
# contains Chinese characters.
$ShortcutPath = Join-Path $Desktop 'CE QC APP.lnk'
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $AutoLauncher
$Shortcut.Arguments = ''
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = 'CE Express Quality Control APP - one click start'
$Shortcut.WindowStyle = 1

if (Test-Path -LiteralPath $IconPath) {
  $Shortcut.IconLocation = $IconPath + ',0'
} else {
  Write-Host "[CE QC] Branded icon is missing: $IconPath" -ForegroundColor Yellow
}

$Shortcut.Save()
if (-not (Test-Path -LiteralPath $ShortcutPath)) {
  throw "Shortcut save returned without creating the file: $ShortcutPath"
}

# Verify what Windows actually persisted before reporting success.
$SavedShortcut = $Shell.CreateShortcut($ShortcutPath)
if ([string]$SavedShortcut.TargetPath -ne [string]$AutoLauncher) {
  throw "Shortcut target verification failed. Expected: $AutoLauncher ; Saved: $($SavedShortcut.TargetPath)"
}
if ([string]$SavedShortcut.Arguments) {
  throw "Shortcut unexpectedly contains launcher arguments: $($SavedShortcut.Arguments)"
}
if ((Test-Path -LiteralPath $IconPath) -and ([string]$SavedShortcut.IconLocation -notlike '*CE_QC_APP.ico*')) {
  throw "Shortcut icon verification failed. Saved icon: $($SavedShortcut.IconLocation)"
}

# Ask Windows to refresh shortcut/icon presentation without restarting Explorer.
try {
  $Ie4uinit = Join-Path $env:WINDIR 'System32\ie4uinit.exe'
  if (Test-Path -LiteralPath $Ie4uinit) {
    Start-Process -FilePath $Ie4uinit -ArgumentList '-show' -WindowStyle Hidden -ErrorAction SilentlyContinue | Out-Null
  }
} catch {}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host 'CE QC desktop launcher repaired successfully.' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host "Desktop launcher: $ShortcutPath"
Write-Host "Target: $AutoLauncher"
if (Test-Path -LiteralPath $IconPath) {
  Write-Host "CE EXPRESS icon: $IconPath" -ForegroundColor Green
}
Write-Host 'Daily use: double-click CE QC APP. No Git pull or npm start is required.' -ForegroundColor Yellow
Start-Sleep -Seconds 2
