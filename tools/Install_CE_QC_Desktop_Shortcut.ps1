$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AutoLauncher = Join-Path $ProjectRoot 'Start_CE_QC_Auto.vbs'
if (-not (Test-Path -LiteralPath $AutoLauncher)) {
  throw "CE QC one-click launcher not found: $AutoLauncher"
}

$LauncherName = -join @(
  'CE ',
  [char]0x8D28,
  [char]0x63A7,
  'APP',
  [char]0x542F,
  [char]0x52A8
)

$Desktop = $env:CE_QC_SHORTCUT_DESKTOP
if (-not $Desktop) { $Desktop = [Environment]::GetFolderPath('Desktop') }
if (-not $Desktop) { throw 'Windows Desktop folder could not be resolved.' }
if (-not (Test-Path -LiteralPath $Desktop)) {
  New-Item -ItemType Directory -Path $Desktop -Force | Out-Null
}

$ShortcutPath = Join-Path $Desktop ($LauncherName + '.lnk')
$OldCmd = Join-Path $Desktop ($LauncherName + '.cmd')
$OldTempLink = Join-Path $Desktop 'CE_QC_APP_START_INSTALLING.lnk'
Remove-Item -LiteralPath $OldCmd -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $OldTempLink -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction SilentlyContinue

$Wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $Wscript)) { throw 'wscript.exe was not found.' }

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Wscript
$Shortcut.Arguments = '"' + $AutoLauncher + '"'
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = 'CE Express Quality Control APP - one click start'
$Shortcut.IconLocation = "$env:WINDIR\System32\shell32.dll,220"
$Shortcut.Save()

if (-not (Test-Path -LiteralPath $ShortcutPath)) {
  throw "Desktop shortcut was not created: $ShortcutPath"
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host 'CE QC one-click desktop launcher created.' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host "Desktop shortcut: $ShortcutPath"
Write-Host 'Daily use: double-click once. No Git pull, no npm test, no npm start.' -ForegroundColor Yellow
Write-Host 'If CE QC is already running, it opens immediately without restarting the backend.' -ForegroundColor DarkGray
Write-Host 'If CE QC is stopped, it starts the protected runtime silently and opens the browser when ready.' -ForegroundColor DarkGray
Write-Host 'Use the visible project launcher only when troubleshooting startup errors.' -ForegroundColor DarkGray
Start-Sleep -Seconds 2
