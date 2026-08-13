$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Port = 5177

Write-Host '[CE-QC] V93 SHOPEE resume resilience apply + verify' -ForegroundColor Cyan
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

Write-Host '[CE-QC] Creating a pre-V93 database safety copy...' -ForegroundColor Cyan
$dbPath = (& node --input-type=module -e "import {getRuntimeConfig} from './src/db.js'; console.log(getRuntimeConfig().dbFile)").Trim()
if ($dbPath -and (Test-Path $dbPath)) {
  $dbDir = Split-Path -Parent $dbPath
  $backupDir = Join-Path $dbDir 'backups'
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $baseName = "pre_v93_shopee_resume_$stamp"
  Copy-Item $dbPath (Join-Path $backupDir "$baseName.db") -Force
  foreach ($suffix in @('-wal','-shm')) {
    $sidecar = "$dbPath$suffix"
    if (Test-Path $sidecar) { Copy-Item $sidecar (Join-Path $backupDir "$baseName.db$suffix") -Force }
  }
  Write-Host "[CE-QC] Backup saved: $backupDir\$baseName.db" -ForegroundColor Green
} else {
  Write-Host '[CE-QC] Database path was not found; continuing because the backend may be using the project fallback data directory.' -ForegroundColor Yellow
}

Write-Host '[CE-QC] Running the deployment gate for resume/TLS/terminal rules...' -ForegroundColor Cyan
& node --test `
  'test/v93-shopee-resume-resilience.test.js' `
  'test/v70-confirm-query-resilience.test.js' `
  'test/v86-strict-track-status-gate.test.js' `
  'test/v92-whpp-terminal-authority.test.js'
if ($LASTEXITCODE -ne 0) { throw "V93 deployment tests failed (exit=$LASTEXITCODE). Backend was not restarted with an unverified build." }
Write-Host '[CE-QC] Deployment gate passed.' -ForegroundColor Green

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

Write-Host '[CE-QC] Auditing persisted SHOPEE resume metadata...' -ForegroundColor Cyan
& node (Join-Path $ProjectRoot 'scripts\CE_QC_SHOPEE_Resume_Audit_ReadOnly.mjs')
if ($LASTEXITCODE -ne 0) { throw "SHOPEE resume audit is still BLOCKED (exit=$LASTEXITCODE)." }

Write-Host '[CE-QC] V93_SHOPEE_RESUME_READY' -ForegroundColor Green
Write-Host '[CE-QC] Fixed: numeric batch-key collision on resume; TLS/socket resets now retry automatically before fallback.' -ForegroundColor Green
Write-Host '[CE-QC] Existing completed scan/event/final data was preserved; only audit-key metadata was re-keyed.' -ForegroundColor Green
Start-Process 'http://127.0.0.1:5177/shopeecn'
