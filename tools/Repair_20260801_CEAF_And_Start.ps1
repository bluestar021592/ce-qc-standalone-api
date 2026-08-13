$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RequiredAncestor = 'c686b7a04a726c27afeeb5cfff9cca0071d67b99'
$Expected = [ordered]@{
  ReportDate = '2026-08-01'
  CE = 2505
  CEAF = 80
  TBKH = 2067
  ALI1688 = 235
  SHOPEECN = 0
  SHOPEEVN = 4457
  WHPP = 196
  Total = 9540
}

function Write-Step([string]$Text) {
  Write-Host "[CE-QC] $Text" -ForegroundColor Cyan
}

function Stop-CeQcProcesses {
  Write-Step 'Stopping existing CE QC backend on port 5177...'
  $pids = @()
  try {
    $pids += Get-NetTCPConnection -LocalPort 5177 -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch {}

  try {
    $escapedRoot = [regex]::Escape($ProjectRoot)
    $pids += Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -ieq 'node.exe' -and
        $_.CommandLine -and
        $_.CommandLine -match $escapedRoot -and
        $_.CommandLine -match '(bootstrap\.js|server\.js)'
      } |
      Select-Object -ExpandProperty ProcessId
  } catch {}

  $pids | Where-Object { $_ } | Sort-Object -Unique | ForEach-Object {
    Stop-Process -Id ([int]$_) -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 800
}

function New-PreRepairBackup {
  Write-Step 'Creating pre-repair database backup...'
  $dbPath = (& node --input-type=module -e "import('./src/db.js').then(m=>{console.log(m.getRuntimeConfig().dbFile)})" 2>$null | Select-Object -Last 1).Trim()
  if (-not $dbPath -or -not (Test-Path $dbPath)) {
    throw "Database file not found: $dbPath"
  }

  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $backupDir = Join-Path (Split-Path $dbPath -Parent) "backups\pre_ceaf_repair_$stamp"
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

  Copy-Item $dbPath (Join-Path $backupDir (Split-Path $dbPath -Leaf)) -Force
  foreach ($suffix in @('-wal', '-shm')) {
    $sidecar = "$dbPath$suffix"
    if (Test-Path $sidecar) {
      Copy-Item $sidecar (Join-Path $backupDir (Split-Path $sidecar -Leaf)) -Force
    }
  }
  Write-Host "[CE-QC] Backup: $backupDir" -ForegroundColor DarkGray
}

function Invoke-CurrentCeafRepair {
  Write-Step 'Repairing persisted 2026-08-01 CEAF/WHPP membership...'
  $repairScript = @'
import { repairLatestCeafSplit } from './src/v76CurrentCeafSplitRepair.js';
import { closeDb } from './src/db.js';
try {
  const result = repairLatestCeafSplit();
  console.log(JSON.stringify(result));
  closeDb();
} catch (error) {
  try { closeDb(); } catch {}
  console.error(error?.stack || error);
  process.exit(1);
}
'@
  $resultText = ($repairScript | & node --input-type=module - 2>&1 | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0) { throw "CEAF repair failed: $resultText" }
  Write-Host "[CE-QC] Repair result: $resultText" -ForegroundColor DarkGray
}

function Get-VerifiedSplit {
  Write-Step 'Verifying database truth before the website is allowed to open...'
  $verifyScript = @'
import { getDb, closeDb } from './src/db.js';
const db = getDb();
try {
  const batch = db.prepare("SELECT batchId,snapshotId,reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1").get();
  if (!batch) throw new Error('NO_VALID_UNIFIED_BATCH');
  const rows = db.prepare("SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE batchId=? GROUP BY businessType").all(batch.batchId);
  const counts = Object.fromEntries(rows.map(row => [String(row.businessType || '').toUpperCase(), Number(row.count || 0)]));
  const whppReport = db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(batch.reportDate);
  const whppRows = db.prepare("SELECT COUNT(*) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(batch.reportDate);
  const whpp = Number(whppReport?.totalCount || 0);
  const whppMembership = Number(whppRows?.count || 0);
  const coreTotal = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].reduce((sum, type) => sum + Number(counts[type] || 0), 0);
  const result = {
    reportDate: batch.reportDate,
    batchId: batch.batchId,
    snapshotId: batch.snapshotId,
    CE: Number(counts.CE || 0),
    CEAF: Number(counts.CEAF || 0),
    TBKH: Number(counts.TBKH || 0),
    ALI1688: Number(counts.ALI1688 || 0),
    SHOPEECN: Number(counts.SHOPEECN || 0),
    SHOPEEVN: Number(counts.SHOPEEVN || 0),
    WHPP: whpp,
    whppMembership,
    coreTotal,
    total: coreTotal + whpp
  };
  console.log(JSON.stringify(result));
  closeDb();
} catch (error) {
  try { closeDb(); } catch {}
  console.error(error?.stack || error);
  process.exit(1);
}
'@
  $json = ($verifyScript | & node --input-type=module - 2>&1 | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0) { throw "Database verification failed: $json" }
  try { return $json | ConvertFrom-Json } catch { throw "Invalid verification result: $json" }
}

function Assert-ExpectedSplit($Actual) {
  $checks = @(
    @('ReportDate', [string]$Actual.reportDate, [string]$Expected.ReportDate),
    @('CE', [int]$Actual.CE, [int]$Expected.CE),
    @('CEAF', [int]$Actual.CEAF, [int]$Expected.CEAF),
    @('TBKH', [int]$Actual.TBKH, [int]$Expected.TBKH),
    @('ALI1688', [int]$Actual.ALI1688, [int]$Expected.ALI1688),
    @('SHOPEECN', [int]$Actual.SHOPEECN, [int]$Expected.SHOPEECN),
    @('SHOPEEVN', [int]$Actual.SHOPEEVN, [int]$Expected.SHOPEEVN),
    @('WHPP report', [int]$Actual.WHPP, [int]$Expected.WHPP),
    @('WHPP membership', [int]$Actual.whppMembership, [int]$Expected.WHPP),
    @('Total', [int]$Actual.total, [int]$Expected.Total)
  )
  $failed = @($checks | Where-Object { $_[1] -ne $_[2] })
  if ($failed.Count -gt 0) {
    $details = ($failed | ForEach-Object { "$($_[0])=$($_[1]) expected=$($_[2])" }) -join '; '
    throw "CEAF_SPLIT_VERIFY_FAILED: $details"
  }
  Write-Host '[CE-QC] CEAF_SPLIT_OK: CE=2505, CEAF=80, TBKH=2067, ALI1688=235, SHOPEECN=0, SHOPEEVN=4457, WHPP=196, TOTAL=9540' -ForegroundColor Green
}

function Start-CeQcAndWait {
  $launcher = Join-Path $ProjectRoot 'Start_CE_QC.cmd'
  if (-not (Test-Path $launcher)) { throw "Launcher not found: $launcher" }
  Write-Step 'Starting CE QC backend...'
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', ('"{0}"' -f $launcher)) -WorkingDirectory $ProjectRoot | Out-Null

  $ready = $false
  for ($i = 0; $i -lt 240; $i++) {
    Start-Sleep -Seconds 1
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5177/api/health' -TimeoutSec 2
      if ($health.ok) { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) { throw 'Backend did not become healthy within 240 seconds.' }
  Write-Host '[CE-QC] BACKEND_READY' -ForegroundColor Green
}

Set-Location $ProjectRoot
& git merge-base --is-ancestor $RequiredAncestor HEAD 2>$null
if ($LASTEXITCODE -ne 0) {
  $head = (& git rev-parse HEAD).Trim()
  throw "Local code is older than the required CEAF repair baseline. Current HEAD: $head"
}

Stop-CeQcProcesses
New-PreRepairBackup
Invoke-CurrentCeafRepair
$actual = Get-VerifiedSplit
Assert-ExpectedSplit $actual
Start-CeQcAndWait

$cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
Start-Process "http://127.0.0.1:5177/import?repair=$cacheBust"
Write-Host '[CE-QC] COMPLETE - current data repaired and verified before browser launch.' -ForegroundColor Green
