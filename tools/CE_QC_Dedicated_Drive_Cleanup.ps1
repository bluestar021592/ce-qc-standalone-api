param(
  [switch]$Quiet
)

$ErrorActionPreference = 'SilentlyContinue'
$Patch = '2026-09-22-v578-dedicated-drive-cleanup-v1'
$Now = Get-Date
$DeletedBytes = [int64]0
$DeletedEntries = 0
$Failures = 0

function Write-CeLog([string]$Message) {
  if (-not $Quiet) { Write-Host $Message -ForegroundColor DarkCyan }
}

function Get-DriveFree([string]$Letter) {
  try {
    $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${Letter}:'"
    return [int64]$d.FreeSpace
  } catch { return [int64]0 }
}

function Get-FileBytes([string]$Path) {
  try {
    if (-not (Test-Path -LiteralPath $Path)) { return [int64]0 }
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer) { return [int64]$item.Length }
    $sum = [int64]0
    Get-ChildItem -LiteralPath $Path -Force -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $sum += [int64]$_.Length }
    return $sum
  } catch { return [int64]0 }
}

function Remove-CeTarget([string]$Path, [int]$MinAgeHours = 0) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) { return }
  try {
    $items = @()
    $root = Get-Item -LiteralPath $Path -Force
    if ($root.PSIsContainer) {
      $items = @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue)
    } else {
      $items = @($root)
    }
    foreach ($item in $items) {
      try {
        if ($MinAgeHours -gt 0) {
          $age = ($Now - $item.LastWriteTime).TotalHours
          if ($age -lt $MinAgeHours) { continue }
        }
        $bytes = Get-FileBytes $item.FullName
        Remove-Item -LiteralPath $item.FullName -Recurse -Force -Confirm:$false -ErrorAction Stop
        $script:DeletedBytes += $bytes
        $script:DeletedEntries += 1
      } catch { $script:Failures += 1 }
    }
  } catch { $script:Failures += 1 }
}

function Remove-Glob([string]$Folder,[string]$Pattern) {
  if (-not (Test-Path -LiteralPath $Folder)) { return }
  Get-ChildItem -LiteralPath $Folder -Force -Filter $Pattern -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $bytes = Get-FileBytes $_.FullName
      Remove-Item -LiteralPath $_.FullName -Force -Confirm:$false -ErrorAction Stop
      $script:DeletedBytes += $bytes
      $script:DeletedEntries += 1
    } catch { $script:Failures += 1 }
  }
}

$BeforeC = Get-DriveFree 'C'
$BeforeD = if (Test-Path -LiteralPath 'D:\') { Get-DriveFree 'D' } else { [int64]0 }

# CE-owned disposable roots on C.
$ceC = @(
  (Join-Path $env:LOCALAPPDATA 'CE_QC_LAUNCHER\backups'),
  (Join-Path $env:LOCALAPPDATA 'CE_QC_LAUNCHER\temp'),
  (Join-Path $env:LOCALAPPDATA 'CE_QC_LAUNCHER\app\logs\crashes')
)
foreach ($p in $ceC) { Remove-CeTarget $p 0 }

# Safe user/application caches on C. Cookies, passwords, history, documents and downloads are not touched.
$cacheRoots = @(
  (Join-Path $env:LOCALAPPDATA 'npm-cache'),
  (Join-Path $env:USERPROFILE '.npm'),
  (Join-Path $env:USERPROFILE '.cache'),
  (Join-Path $env:LOCALAPPDATA 'D3DSCache'),
  (Join-Path $env:LOCALAPPDATA 'CrashDumps'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\INetCache'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default\Cache'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default\Code Cache'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default\GPUCache'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Cache'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Code Cache'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\GPUCache')
)
foreach ($p in $cacheRoots) { Remove-CeTarget $p 0 }

# Generic temp is cleaned only when entries are older than 24h, so current updater/runtime files stay protected.
Remove-CeTarget $env:TEMP 24
if ($env:LOCALAPPDATA) { Remove-CeTarget (Join-Path $env:LOCALAPPDATA 'Temp') 24 }
if ($env:WINDIR) { Remove-CeTarget (Join-Path $env:WINDIR 'Temp') 72 }

# Windows thumbnail caches are disposable and rebuild automatically.
if ($env:LOCALAPPDATA) {
  Remove-Glob (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer') 'thumbcache_*.db'
  Remove-Glob (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer') 'iconcache_*.db'
}

# D is the CE data drive: clear only CE-generated disposable scratch/cache here.
if (Test-Path -LiteralPath 'D:\') {
  foreach ($p in @('D:\CE_QC_TEST_TEMP','D:\CE_QC_RUNTIME_TEMP','D:\CE_QC_NPM_CACHE')) {
    Remove-CeTarget $p 0
  }
}

# Empty recycle bins on the two dedicated drives; content is already user-deleted.
try {
  if (Get-Command Clear-RecycleBin -ErrorAction SilentlyContinue) {
    Clear-RecycleBin -DriveLetter C -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath 'D:\') { Clear-RecycleBin -DriveLetter D -Force -ErrorAction SilentlyContinue }
  }
} catch { $Failures += 1 }

$AfterC = Get-DriveFree 'C'
$AfterD = if (Test-Path -LiteralPath 'D:\') { Get-DriveFree 'D' } else { [int64]0 }
function GiB([int64]$Bytes) { return [math]::Round($Bytes / 1GB, 2) }

Write-CeLog "[CE-QC][V578][DEDICATED] safe cleanup complete: deleted=$DeletedEntries entries, measured=$([math]::Round($DeletedBytes / 1GB, 2)) GiB, failures=$Failures."
Write-CeLog "[CE-QC][V578][DEDICATED] C free: $(GiB $BeforeC) GiB -> $(GiB $AfterC) GiB; reclaimed=$(GiB ($AfterC-$BeforeC)) GiB."
if ($BeforeD -gt 0) {
  Write-CeLog "[CE-QC][V578][DEDICATED] D free: $(GiB $BeforeD) GiB -> $(GiB $AfterD) GiB; reclaimed=$(GiB ($AfterD-$BeforeD)) GiB."
}

# Surface protected system-file sizes so large C usage is explainable without deleting Windows.
foreach ($name in @('hiberfil.sys','pagefile.sys','swapfile.sys')) {
  $p = Join-Path 'C:\' $name
  if (Test-Path -LiteralPath $p) {
    try {
      $bytes = [int64](Get-Item -LiteralPath $p -Force).Length
      Write-CeLog "[CE-QC][V578][DEDICATED] protected system file retained: $name = $(GiB $bytes) GiB."
    } catch {}
  }
}

Write-Output ($Patch + '|deletedEntries=' + $DeletedEntries + '|deletedBytes=' + $DeletedBytes + '|failures=' + $Failures)
