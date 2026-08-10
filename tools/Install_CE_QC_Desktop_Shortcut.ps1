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

# Build a dedicated CE EXPRESS application icon from the logo already shipped
# with the project. This avoids depending on a user-specific absolute path and
# keeps the desktop icon stable after project updates or machine restarts.
$IconSource = Join-Path $ProjectRoot 'public\assets\ce-express-logo-main.png'
$IconDirectory = Join-Path $ProjectRoot 'assets'
$IconPath = Join-Path $IconDirectory 'CE_QC_APP.ico'

function New-CeQcDesktopIcon {
  if (-not (Test-Path -LiteralPath $IconSource)) { return $false }
  try {
    Add-Type -AssemblyName System.Drawing
    if (-not (Test-Path -LiteralPath $IconDirectory)) {
      New-Item -ItemType Directory -Path $IconDirectory -Force | Out-Null
    }

    $source = New-Object System.Drawing.Bitmap($IconSource)
    try {
      # Convert the shipped CE mark into a high-contrast desktop treatment:
      # black rounded square, CE red preserved, dark logo/text converted white.
      # Near-white source background becomes transparent so it disappears.
      $processed = New-Object System.Drawing.Bitmap($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      try {
        for ($y = 0; $y -lt $source.Height; $y++) {
          for ($x = 0; $x -lt $source.Width; $x++) {
            $p = $source.GetPixel($x, $y)
            if ($p.A -eq 0 -or ($p.R -ge 245 -and $p.G -ge 245 -and $p.B -ge 245)) {
              $processed.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
              continue
            }
            $isCeRed = $p.R -ge 135 -and $p.R -gt ($p.G * 1.35) -and $p.R -gt ($p.B * 1.35)
            if ($isCeRed) {
              $processed.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($p.A, 237, 28, 36))
            } else {
              $processed.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($p.A, 255, 255, 255))
            }
          }
        }

        $canvas = New-Object System.Drawing.Bitmap(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
          $g = [System.Drawing.Graphics]::FromImage($canvas)
          try {
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.Clear([System.Drawing.Color]::Transparent)

            $path = New-Object System.Drawing.Drawing2D.GraphicsPath
            try {
              $radius = 44
              $diameter = $radius * 2
              $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
              $path.AddArc(256 - $diameter, 0, $diameter, $diameter, 270, 90)
              $path.AddArc(256 - $diameter, 256 - $diameter, $diameter, $diameter, 0, 90)
              $path.AddArc(0, 256 - $diameter, $diameter, $diameter, 90, 90)
              $path.CloseFigure()
              $black = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
              try { $g.FillPath($black, $path) } finally { $black.Dispose() }
              $g.SetClip($path)

              $maxW = 216.0
              $maxH = 176.0
              $scale = [Math]::Min($maxW / [double]$processed.Width, $maxH / [double]$processed.Height)
              $drawW = [Math]::Max(1, [int]($processed.Width * $scale))
              $drawH = [Math]::Max(1, [int]($processed.Height * $scale))
              $drawX = [int]((256 - $drawW) / 2)
              $drawY = [int]((256 - $drawH) / 2)
              $g.DrawImage($processed, $drawX, $drawY, $drawW, $drawH)
            }
            finally { $path.Dispose() }
          }
          finally { $g.Dispose() }

          # Windows ICO supports a PNG-compressed 256x256 image entry. Writing
          # the small ICO container ourselves avoids external image converters.
          $pngStream = New-Object System.IO.MemoryStream
          try {
            $canvas.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
            $pngBytes = $pngStream.ToArray()
          }
          finally { $pngStream.Dispose() }

          $icoStream = New-Object System.IO.MemoryStream
          $writer = New-Object System.IO.BinaryWriter($icoStream)
          try {
            $writer.Write([UInt16]0)       # reserved
            $writer.Write([UInt16]1)       # ICO
            $writer.Write([UInt16]1)       # one image
            $writer.Write([Byte]0)         # width 256
            $writer.Write([Byte]0)         # height 256
            $writer.Write([Byte]0)         # palette
            $writer.Write([Byte]0)         # reserved
            $writer.Write([UInt16]1)       # planes
            $writer.Write([UInt16]32)      # bpp
            $writer.Write([UInt32]$pngBytes.Length)
            $writer.Write([UInt32]22)      # image offset
            $writer.Write($pngBytes)
            $writer.Flush()
            [System.IO.File]::WriteAllBytes($IconPath, $icoStream.ToArray())
          }
          finally {
            $writer.Dispose()
            $icoStream.Dispose()
          }
        }
        finally { $canvas.Dispose() }
      }
      finally { $processed.Dispose() }
    }
    finally { $source.Dispose() }
    return (Test-Path -LiteralPath $IconPath)
  }
  catch {
    Write-Host "[CE QC] Branded icon generation failed; launcher will still be created: $($_.Exception.Message)" -ForegroundColor Yellow
    return $false
  }
}

$HasBrandIcon = New-CeQcDesktopIcon

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
  if ($HasBrandIcon -and (Test-Path -LiteralPath $IconPath)) {
    $Shortcut.IconLocation = $IconPath + ',0'
  }
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
if ($HasBrandIcon) { Write-Host "Desktop icon: $IconPath" -ForegroundColor Green }
Write-Host 'Daily use: double-click once. No Git pull, no npm test, no npm start.' -ForegroundColor Yellow
Write-Host 'If CE QC is already running, it opens immediately without restarting the backend.' -ForegroundColor DarkGray
Write-Host 'If CE QC is stopped, it starts the protected runtime silently and opens the browser when ready.' -ForegroundColor DarkGray
Write-Host 'Use the visible project launcher only when troubleshooting startup errors.' -ForegroundColor DarkGray
Start-Sleep -Seconds 2
