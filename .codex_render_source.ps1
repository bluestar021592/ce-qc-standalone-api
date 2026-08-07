param(
  [string]$Mode = 'search',
  [string]$File = '',
  [int]$Start = 1,
  [int]$End = 300,
  [string]$Out = '.codex_source.png'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$files = if ($File) { @((Join-Path $root $File)) } else {
  @('server.js', 'src/store.js', 'public/app.js', 'public/index.html') | ForEach-Object { Join-Path $root $_ }
}
$linesOut = [System.Collections.Generic.List[string]]::new()
$pattern = 'clear|清空|backup|备份|business-data|data-management'
foreach ($path in $files) {
  if (-not (Test-Path -LiteralPath $path)) { continue }
  $content = Get-Content -LiteralPath $path -Encoding UTF8
  $linesOut.Add("===== $path =====")
  if ($Mode -eq 'range') {
    for ($i = [Math]::Max(1, $Start); $i -le [Math]::Min($End, $content.Count); $i++) {
      $linesOut.Add(('{0,5}: {1}' -f $i, $content[$i - 1]))
    }
  } else {
    $wanted = [System.Collections.Generic.SortedSet[int]]::new()
    for ($i = 0; $i -lt $content.Count; $i++) {
      if ($content[$i] -match $pattern) {
        for ($j = [Math]::Max(0, $i - 2); $j -le [Math]::Min($content.Count - 1, $i + 3); $j++) { [void]$wanted.Add($j) }
      }
    }
    foreach ($i in $wanted) { $linesOut.Add(('{0,5}: {1}' -f ($i + 1), $content[$i])) }
  }
}

$font = [System.Drawing.Font]::new('Consolas', 11)
$brush = [System.Drawing.Brushes]::Black
$bg = [System.Drawing.Brushes]::White
$width = 1900
$lineHeight = 18
$pageLines = 62
$pages = [Math]::Max(1, [Math]::Ceiling($linesOut.Count / $pageLines))
for ($page = 0; $page -lt $pages; $page++) {
  $bmp = [System.Drawing.Bitmap]::new($width, ($pageLines + 2) * $lineHeight)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.FillRectangle($bg, 0, 0, $bmp.Width, $bmp.Height)
  for ($row = 0; $row -lt $pageLines; $row++) {
    $idx = $page * $pageLines + $row
    if ($idx -ge $linesOut.Count) { break }
    $text = $linesOut[$idx]
    if ($text.Length -gt 210) { $text = $text.Substring(0, 210) }
    $g.DrawString($text, $font, $brush, 4, ($row + 1) * $lineHeight)
  }
  $base = Join-Path $root $Out
  $target = if ($pages -eq 1) { $base } else { [IO.Path]::Combine([IO.Path]::GetDirectoryName($base), ([IO.Path]::GetFileNameWithoutExtension($base) + "_$($page + 1).png")) }
  $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
$font.Dispose()
