$ErrorActionPreference = 'Stop'

$Shell = New-Object -ComObject WScript.Shell
$Desktop = [string]$Shell.SpecialFolders.Item('Desktop')
if ([string]::IsNullOrWhiteSpace($Desktop)) { $Desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory) }
if ([string]::IsNullOrWhiteSpace($Desktop)) { throw 'Desktop path could not be resolved.' }

$LauncherRoot = Join-Path $env:LOCALAPPDATA 'CE_QC_LAUNCHER'
$AppRoot = Join-Path $LauncherRoot 'app'
$LauncherVbs = Join-Path $LauncherRoot 'Launch_CE_QC.vbs'
$LauncherIcon = Join-Path $LauncherRoot 'CE_EXPRESS_APP_V5.ico'
$ManagedStart = Join-Path $AppRoot 'Start_CE_QC.cmd'

if (-not (Test-Path -LiteralPath $AppRoot)) { throw "CE QC launcher bridge is missing: $AppRoot" }
if (-not (Test-Path -LiteralPath $ManagedStart)) { throw "CE QC managed start is missing: $ManagedStart" }
if (-not (Test-Path -LiteralPath $LauncherIcon)) { throw "CE EXPRESS icon is missing: $LauncherIcon" }

# V7 keeps the existing stable ASCII bridge/icon, but the desktop icon now opens
# one visible managed console. That console owns the entire 5177 process tree.
# Closing it closes the Windows kill-on-close job in CE_QC_Managed_Launcher.ps1.
$VbsContent = @'
Option Explicit
Dim shell, cmdExe, startFile, command
Set shell = CreateObject("WScript.Shell")
cmdExe = shell.ExpandEnvironmentStrings("%WINDIR%\System32\cmd.exe")
startFile = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\CE_QC_LAUNCHER\app\Start_CE_QC.cmd")
command = Chr(34) & cmdExe & Chr(34) & " /d /c " & Chr(34) & Chr(34) & startFile & Chr(34) & Chr(34)
shell.Run command, 1, False
'@
[IO.File]::WriteAllText($LauncherVbs, $VbsContent, (New-Object Text.UTF8Encoding($false)))

$WScriptExe = Join-Path $env:WINDIR 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $WScriptExe)) { throw 'wscript.exe was not found.' }

$ShortcutPath = Join-Path $Desktop 'CE QC APP.lnk'
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $WScriptExe
$Shortcut.Arguments = '"' + $LauncherVbs + '"'
$Shortcut.WorkingDirectory = $LauncherRoot
$Shortcut.Description = 'CE Express Quality Control APP - managed update and backend lifecycle'
$Shortcut.WindowStyle = 1
$Shortcut.IconLocation = $LauncherIcon + ',0'
$Shortcut.Save()

$Saved = $Shell.CreateShortcut($ShortcutPath)
if ([string]$Saved.TargetPath -ne [string]$WScriptExe) { throw "Shortcut target verification failed: $($Saved.TargetPath)" }
if ([string]$Saved.Arguments -notlike '*Launch_CE_QC.vbs*') { throw "Shortcut argument verification failed: $($Saved.Arguments)" }

Write-Host ''
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host 'CE QC desktop launcher V7 installed successfully.' -ForegroundColor Green
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host "Desktop shortcut: $ShortcutPath"
Write-Host "Managed start:    $ManagedStart"
Write-Host ''
Write-Host 'Daily use: double-click CE QC APP.' -ForegroundColor Yellow
Write-Host 'Keep the CE QC black window open while using the system.' -ForegroundColor Yellow
Write-Host 'Closing that window automatically stops the backend and releases port 5177.' -ForegroundColor Yellow
