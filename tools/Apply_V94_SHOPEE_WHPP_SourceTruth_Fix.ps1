$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Port = 5177
$AuditDate = '2026-08-01'

Write-Host '[CE-QC] V94 SHOPEE WHPP terminal-location + CEAF display source truth apply' -ForegroundColor Cyan
Set-Location $ProjectRoot

Write-Host '[CE-QC] Stopping existing CE QC backend/supervisor...' -ForegroundColor Cyan
try {
  Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match 'ce-qc-standalone-api.*bootstrap\.js' -or
      $_.CommandLine -match 'ce-qc-standalone-api.*Start_CE_QC\.ps1' -or
      $_.CommandLine -match 'CE_QC_LAUNCHER.*Start_CE_QC\.ps1'
    )
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}
try {
  $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($pidValue in $pids) { Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue }
} catch {}
Start-Sleep -Seconds 2

Write-Host '[CE-QC] Creating pre-V94 database safety copy...' -ForegroundColor Cyan
$dbPath = (& node --input-type=module -e "import {getRuntimeConfig} from './src/db.js'; console.log(getRuntimeConfig().dbFile)").Trim()
if ($dbPath -and (Test-Path $dbPath)) {
  $dbDir = Split-Path -Parent $dbPath
  $backupDir = Join-Path $dbDir 'backups'
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $baseName = "pre_v94_whpp_ceaf_truth_$stamp"
  Copy-Item $dbPath (Join-Path $backupDir "$baseName.db") -Force
  foreach ($suffix in @('-wal','-shm')) {
    $sidecar = "$dbPath$suffix"
    if (Test-Path $sidecar) { Copy-Item $sidecar (Join-Path $backupDir "$baseName.db$suffix") -Force }
  }
  Write-Host "[CE-QC] Backup saved: $backupDir\$baseName.db" -ForegroundColor Green
} else {
  Write-Host '[CE-QC] Database path not found; deployment gate continues without modifying source data.' -ForegroundColor Yellow
}

Write-Host '[CE-QC] Running V94 deployment gate...' -ForegroundColor Cyan
& node --test `
  'test/v94-shopee-whpp-source-truth.test.js' `
  'test/v93-shopee-resume-resilience.test.js' `
  'test/v86-strict-track-status-gate.test.js' `
  'test/v73-ceaf-whpp-source-split.test.js' `
  'test/v75-ceaf-upload-normalizer.test.js' `
  'test/v76-current-ceaf-split-repair.test.js' `
  'test/v89-fast-dashboard-source-truth.test.js' `
  'test/v90-instant-whpp-navigation.test.js'
if ($LASTEXITCODE -ne 0) { throw "V94 deployment tests failed (exit=$LASTEXITCODE). Backend was not restarted with an unverified build." }
Write-Host '[CE-QC] V94 deployment gate passed.' -ForegroundColor Green

Write-Host '[CE-QC] Running read-only source-truth audit before restart...' -ForegroundColor Cyan
& node (Join-Path $ProjectRoot 'scripts\CE_QC_V94_SHOPEE_WHPP_SourceTruth_Audit_ReadOnly.mjs') $AuditDate
if ($LASTEXITCODE -ne 0) { throw "V94 source-truth audit is BLOCKED before restart (exit=$LASTEXITCODE)." }

Write-Host '[CE-QC] Starting corrected backend...' -ForegroundColor Cyan
$cmd = Join-Path $ProjectRoot 'Start_CE_QC.cmd'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', ('"{0}"' -f $cmd) -WorkingDirectory $ProjectRoot

$ready = $false
for ($i=0; $i -lt 150; $i++) {
  Start-Sleep -Seconds 1
  try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) { $ready = $true; break }
  } catch {}
}
if (-not $ready) { throw 'CE QC backend did not listen on port 5177 within 150 seconds.' }
Write-Host '[CE-QC] Backend is listening on 5177.' -ForegroundColor Green
Start-Sleep -Seconds 3

Write-Host '[CE-QC] Re-running read-only V94 audit against the restarted build...' -ForegroundColor Cyan
& node (Join-Path $ProjectRoot 'scripts\CE_QC_V94_SHOPEE_WHPP_SourceTruth_Audit_ReadOnly.mjs') $AuditDate
if ($LASTEXITCODE -ne 0) { throw "V94 source-truth audit is BLOCKED after restart (exit=$LASTEXITCODE)." }

Write-Host '[CE-QC] V94_SOURCE_TRUTH_READY' -ForegroundColor Green
Write-Host '[CE-QC] SHOPEE WHPP retention now means latest effective location is WHPP only; POD/return/return-start/outbound are excluded.' -ForegroundColor Green
Write-Host '[CE-QC] SHOPEE WHPP card and detail use the same normalized track-event source.' -ForegroundColor Green
Write-Host '[CE-QC] Import-page CEAF/WHPP classification display is synchronized to the same canonical dashboard counts.' -ForegroundColor Green
Start-Process 'http://127.0.0.1:5177/shopeevn'
Start-Sleep -Milliseconds 500
Start-Process 'http://127.0.0.1:5177/import'
