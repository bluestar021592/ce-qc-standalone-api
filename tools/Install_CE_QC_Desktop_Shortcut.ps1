$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LauncherScript = Join-Path $ProjectRoot 'tools\CE_QC_Start.ps1'
if (-not (Test-Path -LiteralPath $LauncherScript)) {
  throw "CE QC launcher script not found: $LauncherScript"
}

# Keep this installer source ASCII-only for Windows PowerShell 5.1.
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

# Use a real desktop CMD launcher instead of WScript.Shell .lnk. The normal
# desktop path keeps PowerShell open with -NoExit so the user can always see
# startup progress/errors and the protected runtime window cannot flash-close.
# The project path is embedded inside an ASCII EncodedCommand so Unicode/spaces
# in the project path cannot break command-line quoting.
$DesktopCmd = Join-Path $Desktop ($LauncherName + '.cmd')
$OldLink = Join-Path $Desktop ($LauncherName + '.lnk')
$OldTempLink = Join-Path $Desktop 'CE_QC_APP_START_INSTALLING.lnk'

Remove-Item -LiteralPath $OldLink -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $OldTempLink -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $DesktopCmd -Force -ErrorAction SilentlyContinue

$escapedScript = $LauncherScript.Replace("'", "''")
$psCommand = "& '$escapedScript'"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($psCommand))

$lines = @(
  '@echo off',
  'title CE QC APP START',
  'echo Starting CE QC APP...',
  'if "%CE_QC_LAUNCHER_TEST_MODE%"=="1" goto test_mode',
  ('powershell.exe -NoLogo -NoProfile -NoExit -ExecutionPolicy Bypass -EncodedCommand ' + $encoded),
  'if errorlevel 1 (',
  '  echo.',
  '  echo [CE QC] Start failed. Please send this window to ChatGPT.',
  '  pause',
  ')',
  'exit /b',
  ':test_mode',
  ('powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + $encoded),
  'exit /b %errorlevel%'
)

# ASCII only: the Unicode project path lives inside the Base64 EncodedCommand.
[IO.File]::WriteAllLines($DesktopCmd, $lines, [Text.Encoding]::ASCII)

if (-not (Test-Path -LiteralPath $DesktopCmd)) {
  throw "Desktop launcher was not created: $DesktopCmd"
}
if ((Get-Item -LiteralPath $DesktopCmd).Length -le 0) {
  throw 'Desktop launcher file is empty.'
}

$verify = Get-Content -LiteralPath $DesktopCmd -Raw
if (-not $verify.Contains('powershell.exe')) { throw 'Desktop launcher is missing PowerShell.' }
if (-not $verify.Contains('-EncodedCommand')) { throw 'Desktop launcher is missing EncodedCommand.' }
if (-not $verify.Contains('-NoExit')) { throw 'Desktop launcher is missing NoExit protection.' }
if ($verify.Contains($ProjectRoot)) { throw 'Desktop launcher unexpectedly contains an unencoded Unicode project path.' }

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host 'CE QC desktop launcher created successfully.' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host "Desktop launcher: $DesktopCmd"
Write-Host 'The previous .lnk shortcut was removed.' -ForegroundColor DarkGray
Write-Host 'Use this desktop CMD launcher for all future CE QC starts.' -ForegroundColor Yellow
Write-Host 'Its window stays open so startup progress and errors remain visible.' -ForegroundColor DarkGray
Write-Host 'It checks GitHub main before starting the app.' -ForegroundColor DarkGray
Start-Sleep -Seconds 2
