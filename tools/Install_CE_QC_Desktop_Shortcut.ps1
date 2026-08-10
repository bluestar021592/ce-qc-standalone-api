$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AutoLauncher = Join-Path $ProjectRoot 'Start_CE_QC_Auto.vbs'
if (-not (Test-Path -LiteralPath $AutoLauncher)) {
  throw "CE QC one-click launcher not found: $AutoLauncher"
}

$Shell = New-Object -ComObject WScript.Shell

# Ask Windows Script Host for the real Desktop folder first. This also works
# when Desktop is redirected by OneDrive/domain policy. Fall back to the normal
# user Desktop only when WSH cannot resolve it.
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

$Wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $Wscript)) { throw 'wscript.exe was not found.' }

$PrimaryShortcut = Join-Path $Desktop ($ChineseLauncherName + '.lnk')
$AsciiShortcut = Join-Path $Desktop 'CE_QC_APP.lnk'
$FallbackVbs = Join-Path $Desktop 'CE_QC_APP.vbs'
$OldCmd = Join-Path $Desktop ($ChineseLauncherName + '.cmd')
$OldAsciiCmd = Join-Path $Desktop 'CE_QC_APP.cmd'
$OldTempLink = Join-Path $Desktop 'CE_QC_APP_START_INSTALLING.lnk'

foreach ($old in @($PrimaryShortcut,$AsciiShortcut,$FallbackVbs,$OldCmd,$OldAsciiCmd,$OldTempLink)) {
  Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
}

function Save-CeQcShortcut([string]$ShortcutPath) {
  $Shortcut = $Shell.CreateShortcut($ShortcutPath)
  $Shortcut.TargetPath = $Wscript
  $Shortcut.Arguments = '"' + $AutoLauncher + '"'
  $Shortcut.WorkingDirectory = $ProjectRoot
  $Shortcut.Description = 'CE Express Quality Control APP - one click start'
  $Shortcut.WindowStyle = 1
  $Shortcut.Save()
  if (-not (Test-Path -LiteralPath $ShortcutPath)) {
    throw "Shortcut save returned without creating the file: $ShortcutPath"
  }
  return $ShortcutPath
}

$CreatedLauncher = ''
$PrimaryError = $null

# Prefer the Chinese desktop name. Some Windows/WSH combinations can fail to
# persist a Unicode .lnk name, so automatically fall back to an ASCII .lnk.
try {
  $CreatedLauncher = Save-CeQcShortcut $PrimaryShortcut
}
catch {
  $PrimaryError = $_
  Write-Host '[CE QC] Unicode shortcut name could not be saved. Retrying with CE_QC_APP.lnk ...' -ForegroundColor Yellow
  try {
    $CreatedLauncher = Save-CeQcShortcut $AsciiShortcut
  }
  catch {
    # Last-resort launcher does not use .lnk at all. It is still a normal
    # double-click desktop entry and starts CE QC invisibly through wscript.
    Write-Host '[CE QC] Windows shortcut COM save failed again. Creating direct VBS desktop launcher ...' -ForegroundColor Yellow
    $escaped = $AutoLauncher.Replace('"','""')
    $vbs = @(
      'Option Explicit',
      'Dim shell',
      'Set shell = CreateObject("WScript.Shell")',
      ('shell.Run Chr(34) & "' + $escaped + '" & Chr(34), 0, False')
    ) -join "`r`n"
    [IO.File]::WriteAllText($FallbackVbs, $vbs, [Text.Encoding]::Unicode)
    if (-not (Test-Path -LiteralPath $FallbackVbs)) {
      if ($PrimaryError) { Write-Host $PrimaryError.Exception.Message -ForegroundColor DarkRed }
      throw 'Unable to create either .lnk or .vbs desktop launcher.'
    }
    $CreatedLauncher = $FallbackVbs
  }
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host 'CE QC one-click desktop launcher created.' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host "Desktop launcher: $CreatedLauncher"
Write-Host 'Daily use: double-click once. No Git pull, no npm test, no npm start.' -ForegroundColor Yellow
Write-Host 'If CE QC is already running, it opens immediately without restarting the backend.' -ForegroundColor DarkGray
Write-Host 'If CE QC is stopped, it starts the protected runtime silently and opens the browser when ready.' -ForegroundColor DarkGray
Write-Host 'Use the visible project launcher only when troubleshooting startup errors.' -ForegroundColor DarkGray
Start-Sleep -Seconds 2
