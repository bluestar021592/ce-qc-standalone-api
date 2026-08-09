$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $ProjectRoot 'CE_QC_Start.bat'
if (-not (Test-Path -LiteralPath $Launcher)) {
  throw "CE QC launcher not found: $Launcher"
}

# Keep this script ASCII-only so Windows PowerShell 5.1 cannot misread UTF-8
# source text. Build the Chinese shortcut title from Unicode code points.
$ShortcutName = -join @(
  'CE ',
  [char]0x8D28,
  [char]0x63A7,
  'APP',
  [char]0x542F,
  [char]0x52A8
)

# WScript.Shell may reject a .bat file as TargetPath on some Windows builds.
# Point the shortcut at cmd.exe and pass the stable BAT launcher as arguments.
$CmdExe = ''
if ($env:ComSpec -and (Test-Path -LiteralPath $env:ComSpec)) {
  $CmdExe = $env:ComSpec
}
elseif ($env:SystemRoot) {
  $Candidate = Join-Path $env:SystemRoot 'System32\cmd.exe'
  if (Test-Path -LiteralPath $Candidate) { $CmdExe = $Candidate }
}
if (-not $CmdExe) { throw 'cmd.exe was not found.' }

$Desktop = $env:CE_QC_SHORTCUT_DESKTOP
if (-not $Desktop) { $Desktop = [Environment]::GetFolderPath('Desktop') }
if (-not $Desktop) { throw 'Windows Desktop folder could not be resolved.' }
if (-not (Test-Path -LiteralPath $Desktop)) {
  New-Item -ItemType Directory -Path $Desktop -Force | Out-Null
}

$ShortcutPath = Join-Path $Desktop ($ShortcutName + '.lnk')
$TempShortcutPath = Join-Path $Desktop 'CE_QC_APP_START_INSTALLING.lnk'
Remove-Item -LiteralPath $TempShortcutPath -Force -ErrorAction SilentlyContinue

$Shell = New-Object -ComObject WScript.Shell

# Create the .lnk with an ASCII-only temporary filename first. Some Windows
# PowerShell 5.1 / WScript.Shell combinations cannot Save() directly to a
# Unicode shortcut filename even though Windows itself supports that filename.
$Shortcut = $Shell.CreateShortcut($TempShortcutPath)
$Shortcut.TargetPath = $CmdExe
$Shortcut.Arguments = '/d /c ""' + $Launcher + '""'
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = 'CE EXPRESS QC - sync GitHub main and start local app'
$Shortcut.IconLocation = "$CmdExe,0"
$Shortcut.WindowStyle = 1
$Shortcut.Save()

if (-not (Test-Path -LiteralPath $TempShortcutPath)) {
  throw "Temporary desktop shortcut was not created: $TempShortcutPath"
}

# Verify the actual saved target before renaming the shortcut to its Chinese
# user-facing name.
$Saved = $Shell.CreateShortcut($TempShortcutPath)
if ([string]::IsNullOrWhiteSpace([string]$Saved.TargetPath)) {
  throw 'Desktop shortcut TargetPath is empty after save.'
}
if (-not ([string]$Saved.TargetPath).ToLowerInvariant().EndsWith('cmd.exe')) {
  throw "Desktop shortcut TargetPath is invalid: $($Saved.TargetPath)"
}
if (-not ([string]$Saved.Arguments).Contains('CE_QC_Start.bat')) {
  throw 'Desktop shortcut does not point to the stable CE QC launcher.'
}

# Rename with .NET/PowerShell after Save(). This avoids the WScript.Shell
# Unicode filename limitation while still giving the user the required name.
Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction SilentlyContinue
Move-Item -LiteralPath $TempShortcutPath -Destination $ShortcutPath -Force

if (-not (Test-Path -LiteralPath $ShortcutPath)) {
  throw "Desktop shortcut was not created: $ShortcutPath"
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host 'CE QC desktop launcher created successfully.' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host "Desktop shortcut: $ShortcutPath"
Write-Host 'Use this shortcut for all future CE QC starts.' -ForegroundColor Yellow
Write-Host 'It will check GitHub main before starting the app.' -ForegroundColor DarkGray
Start-Sleep -Seconds 3
