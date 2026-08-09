$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $ProjectRoot 'CE_QC_Start.bat'
if (-not (Test-Path $Launcher)) {
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

$Desktop = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop ($ShortcutName + '.lnk')
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Launcher
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = 'CE EXPRESS QC - sync GitHub main and start local app'
$Shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,15"
$Shortcut.WindowStyle = 1
$Shortcut.Save()

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host 'CE QC desktop launcher created successfully.' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host "Desktop shortcut: $ShortcutPath"
Write-Host 'Use this shortcut for all future CE QC starts.' -ForegroundColor Yellow
Write-Host 'It will check GitHub main before starting the app.' -ForegroundColor DarkGray
Start-Sleep -Seconds 3
