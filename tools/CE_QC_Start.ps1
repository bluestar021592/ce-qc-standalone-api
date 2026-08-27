$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'CE QC APP SAFE UPDATE'
$V336_SAFE_UPDATE_ID = '2026-08-27-v336-candidate-gate-db-rollback-v1'

if ($env:CE_QC_LAUNCHER_TEST_MODE -eq '1') {
  Write-Host "CE_QC_LAUNCHER_TEST_OK $V336_SAFE_UPDATE_ID"
  exit 0
}

function Write-Section([string]$Text) {
  Write-Host ''
  Write-Host ('=' * 62) -ForegroundColor Cyan
  Write-Host $Text -ForegroundColor Cyan
  Write-Host ('=' * 62) -ForegroundColor Cyan
}

function Run-Git([string[]]$Arguments, [switch]$AllowFailure) {
  & git @Arguments
  $code = $LASTEXITCODE
  if ($code -ne 0 -and -not $AllowFailure) {
    throw "Git command failed: git $($Arguments -join ' ')"
  }
  return $code
}

function Git-Text([string[]]$Arguments) {
  $text = (& git @Arguments | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Git command failed: git $($Arguments -join ' ')" }
  return $text
}

function Get-PortOwnerPids([int]$Port) {
  $result = @()
  try {
    $result += @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.OwningProcess })
  } catch {}
  if ($result.Count -eq 0) {
    try {
      $pattern = ":$Port\s+.*LISTENING\s+(\d+)\s*$"
      foreach ($line in @(netstat -ano -p tcp 2>$null)) {
        $match = [regex]::Match([string]$line, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($match.Success) { $result += [int]$match.Groups[1].Value }
      }
    } catch {}
  }
  return @($result | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
}

function Stop-ProcessTree([int]$ProcessId, [string]$Reason) {
  if ($ProcessId -le 0 -or $ProcessId -eq $PID) { return }
  Write-Host "Stopping $Reason PID=$ProcessId ..." -ForegroundColor DarkYellow
  try { & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null } catch {}
  try { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}

function Get-ShellSupervisorForProcess([int]$ProcessId) {
  try {
    $child = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if (-not $child) { return $null }
    $parentId = [int]$child.ParentProcessId
    if ($parentId -le 0 -or $parentId -eq $PID) { return $null }
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue
    if (-not $parent) { return $null }
    $name = ([string]$parent.Name).ToLowerInvariant()
    if ($name -match '^(powershell|pwsh|cmd)\.exe$') { return $parent }
  } catch {}
  return $null
}

function Stop-RecordedRuntime([string]$RuntimePidFile) {
  if (-not (Test-Path -LiteralPath $RuntimePidFile)) { return }
  $raw = ''
  try { $raw = (Get-Content -LiteralPath $RuntimePidFile -Raw -ErrorAction SilentlyContinue).Trim() } catch {}
  $runtimePid = 0
  if ([int]::TryParse($raw, [ref]$runtimePid) -and $runtimePid -gt 0 -and $runtimePid -ne $PID) {
    $process = $null
    try { $process = Get-CimInstance Win32_Process -Filter "ProcessId=$runtimePid" -ErrorAction SilentlyContinue } catch {}
    if ($process) { Stop-ProcessTree $runtimePid 'recorded CE QC runtime supervisor' }
  }
  Remove-Item -LiteralPath $RuntimePidFile -Force -ErrorAction SilentlyContinue
}

function Stop-LegacySupervisors([string]$ProjectRoot) {
  $root = $ProjectRoot.ToLowerInvariant()
  $legacyTokens = @('start_ce_qc.ps1','start_ce_qc.cmd','run_ce_qc_v18_final_v5.bat','run_ce_qc_v18')
  $matches = @()
  try {
    $matches = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      if (-not $_.CommandLine) { return $false }
      if ([int]$_.ProcessId -eq $PID) { return $false }
      $cmd = ([string]$_.CommandLine).ToLowerInvariant()
      foreach ($token in $legacyTokens) { if ($cmd.Contains($token)) { return $true } }
      if ($cmd.Contains($root) -and $cmd.Contains('bootstrap.js')) { return $true }
      return $false
    })
  } catch {}
  foreach ($process in $matches) { Stop-ProcessTree ([int]$process.ProcessId) 'legacy CE QC supervisor' }
  if ($matches.Count -gt 0) { Start-Sleep -Seconds 2 }
}

function Stop-PortOwners([int]$Port) {
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    $owners = @(Get-PortOwnerPids $Port)
    if ($owners.Count -eq 0) { return }
    foreach ($ownerPid in $owners) {
      $supervisor = Get-ShellSupervisorForProcess $ownerPid
      if ($supervisor) { Stop-ProcessTree ([int]$supervisor.ProcessId) "supervisor of port $Port owner" }
      else { Stop-ProcessTree $ownerPid "port $Port owner" }
    }
    Start-Sleep -Milliseconds 900
  }
  $remaining = @(Get-PortOwnerPids $Port)
  if ($remaining.Count -gt 0) { throw "Port $Port is still occupied after cleanup: $($remaining -join ',')" }
}

function Ensure-LiveDependencies([string]$ProjectRoot) {
  $need = -not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules'))
  if (-not $need) {
    & npm ls --depth=0 --silent *> $null
    if ($LASTEXITCODE -ne 0) { $need = $true }
  }
  if ($need) {
    Write-Host 'Installed dependencies are missing or inconsistent. Restoring current version dependencies...' -ForegroundColor Yellow
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed for the installed version.' }
  }
}

function Set-TestEnvironment([string]$SandboxRoot) {
  $names = @('NODE_ENV','CI','DATA_DIR','DB_FILE','ACCESS_MODE','HOST','PORT','SQLITE_MMAP_BYTES','SQLITE_CACHE_KIB','CE_QC_DISABLE_V246_TRACKING')
  $old = @{}
  foreach ($name in $names) { $old[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  $data = Join-Path $SandboxRoot 'data'
  New-Item -ItemType Directory -Path $data -Force | Out-Null
  [Environment]::SetEnvironmentVariable('NODE_ENV','test','Process')
  [Environment]::SetEnvironmentVariable('CI','1','Process')
  [Environment]::SetEnvironmentVariable('DATA_DIR',$data,'Process')
  [Environment]::SetEnvironmentVariable('DB_FILE',(Join-Path $data 'candidate-test.db'),'Process')
  [Environment]::SetEnvironmentVariable('ACCESS_MODE','LOCAL','Process')
  [Environment]::SetEnvironmentVariable('HOST','127.0.0.1','Process')
  [Environment]::SetEnvironmentVariable('PORT','5199','Process')
  [Environment]::SetEnvironmentVariable('SQLITE_MMAP_BYTES','0','Process')
  [Environment]::SetEnvironmentVariable('SQLITE_CACHE_KIB','8192','Process')
  [Environment]::SetEnvironmentVariable('CE_QC_DISABLE_V246_TRACKING','1','Process')
  return @{ Names = $names; Old = $old }
}

function Restore-Environment($Snapshot) {
  if (-not $Snapshot) { return }
  foreach ($name in $Snapshot.Names) {
    [Environment]::SetEnvironmentVariable($name, $Snapshot.Old[$name], 'Process')
  }
}

function Test-Candidate([string]$CandidateSha, [string]$ProjectRoot) {
  $short = $CandidateSha.Substring(0, [Math]::Min(12, $CandidateSha.Length))
  $candidateRoot = Join-Path ([IO.Path]::GetTempPath()) ("CE_QC_candidate_${short}_" + (Get-Date -Format 'yyyyMMddHHmmss'))
  $envSnapshot = $null
  $pushed = $false
  Write-Host "Testing exact candidate SHA $CandidateSha before installation..." -ForegroundColor Yellow
  try {
    if (Test-Path -LiteralPath $candidateRoot) { Remove-Item -LiteralPath $candidateRoot -Recurse -Force }
    Run-Git @('worktree','add','--detach',$candidateRoot,$CandidateSha) | Out-Null
    Push-Location $candidateRoot
    $pushed = $true
    $envSnapshot = Set-TestEnvironment (Join-Path $candidateRoot '.candidate-runtime')
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Candidate npm ci failed.' }
    & npm run test:golive
    if ($LASTEXITCODE -ne 0) { throw 'Candidate test:golive failed.' }
    Write-Host 'Candidate go-live gate passed.' -ForegroundColor Green
  }
  finally {
    if ($pushed) { try { Pop-Location } catch {} }
    Restore-Environment $envSnapshot
    Set-Location -LiteralPath $ProjectRoot
    try { & git worktree remove --force $candidateRoot 2>$null | Out-Null } catch {}
    try { if (Test-Path -LiteralPath $candidateRoot) { Remove-Item -LiteralPath $candidateRoot -Recurse -Force } } catch {}
    try { & git worktree prune 2>$null | Out-Null } catch {}
  }
}

function Get-LiveRuntimeConfig {
  $code = "import('./src/db.js').then(m=>process.stdout.write(JSON.stringify(m.getRuntimeConfig()))).catch(e=>{console.error(e);process.exit(1)})"
  $json = (& node --input-type=module -e $code | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $json) { throw 'Unable to resolve the installed database path safely.' }
  try { return ($json | ConvertFrom-Json) } catch { throw 'Installed database configuration is invalid.' }
}

function Invoke-SqliteCheck([string]$DbFile, [switch]$Checkpoint) {
  if (-not $DbFile -or -not (Test-Path -LiteralPath $DbFile)) { throw "SQLite database is missing: $DbFile" }
  $mode = if ($Checkpoint) { '1' } else { '0' }
  $code = @"
import { DatabaseSync } from 'node:sqlite';
const file=process.argv[1]; const checkpoint=process.argv[2]==='1';
const db=new DatabaseSync(file); db.exec('PRAGMA busy_timeout=10000');
if(checkpoint){ const row=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(); if(Number(row?.busy||0)!==0){ db.close(); process.exit(31); } }
const rows=db.prepare('PRAGMA quick_check').all();
const ok=rows.length===1 && String(Object.values(rows[0])[0]||'').toLowerCase()==='ok';
db.close(); if(!ok) process.exit(32); process.stdout.write('SQLITE_OK');
"@
  $result = (& node --input-type=module -e $code $DbFile $mode | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $result -notmatch 'SQLITE_OK') { throw "SQLite integrity verification failed: $DbFile" }
}

function Backup-LiveDatabase($RuntimeConfig, [string]$CandidateSha) {
  $dbFile = [string]$RuntimeConfig.dbFile
  if (-not (Test-Path -LiteralPath $dbFile)) { throw "Live SQLite database is missing: $dbFile" }
  Invoke-SqliteCheck $dbFile -Checkpoint
  $backupsDir = [string]$RuntimeConfig.backupsDir
  New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
  $short = $CandidateSha.Substring(0, [Math]::Min(12, $CandidateSha.Length))
  $backupFile = Join-Path $backupsDir ("ce_qc_monitor_before_update_$(Get-Date -Format 'yyyyMMdd-HHmmss')_${short}.db")
  Copy-Item -LiteralPath $dbFile -Destination $backupFile -Force
  $sourceHash = (Get-FileHash -LiteralPath $dbFile -Algorithm SHA256).Hash
  $backupHash = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash
  if (-not $sourceHash -or $sourceHash -ne $backupHash) { throw 'Database backup hash verification failed.' }
  Invoke-SqliteCheck $backupFile
  Write-Host "Database backup verified: $backupFile" -ForegroundColor Green
  return $backupFile
}

function Restore-LiveDatabase([string]$DbFile, [string]$BackupFile) {
  if (-not $BackupFile -or -not (Test-Path -LiteralPath $BackupFile)) { throw 'Rollback database backup is missing.' }
  foreach ($suffix in @('-wal','-shm')) { Remove-Item -LiteralPath "${DbFile}${suffix}" -Force -ErrorAction SilentlyContinue }
  Copy-Item -LiteralPath $BackupFile -Destination $DbFile -Force
  Invoke-SqliteCheck $DbFile
}

function Wait-LocalReady([int]$Port, $Process, [int]$Seconds = 240) {
  $url = "http://127.0.0.1:$Port/"
  for ($i = 1; $i -le $Seconds; $i++) {
    Start-Sleep -Seconds 1
    try {
      $response = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2
      $status = [int]$response.StatusCode
      if ($status -ge 200 -and $status -lt 500) { return $status }
    } catch {
      try {
        if ($_.Exception.Response) {
          $status = [int]$_.Exception.Response.StatusCode
          if ($status -ge 200 -and $status -lt 500) { return $status }
        }
      } catch {}
    }
    try { if ($Process.HasExited) { break } } catch { break }
  }
  return 0
}

function Verify-InstalledCandidate([string]$CandidateSha, [string]$ProjectRoot) {
  $installed = Git-Text @('rev-parse','HEAD')
  if ($installed -ne $CandidateSha) { throw "Installed SHA mismatch. Expected $CandidateSha, got $installed" }

  $sandbox = Join-Path ([IO.Path]::GetTempPath()) ("CE_QC_installed_gate_" + (Get-Date -Format 'yyyyMMddHHmmss'))
  $envSnapshot = $null
  try {
    New-Item -ItemType Directory -Path $sandbox -Force | Out-Null
    $envSnapshot = Set-TestEnvironment $sandbox
    & npm run test:golive
    if ($LASTEXITCODE -ne 0) { throw 'Installed exact-SHA test:golive failed.' }
  } finally {
    Restore-Environment $envSnapshot
    try { Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue } catch {}
  }

  $verifyLog = Join-Path $ProjectRoot 'logs\update_verify_stdout.log'
  $verifyErr = Join-Path $ProjectRoot 'logs\update_verify_stderr.log'
  New-Item -ItemType Directory -Path (Split-Path -Parent $verifyLog) -Force | Out-Null
  Remove-Item -LiteralPath $verifyLog,$verifyErr -Force -ErrorAction SilentlyContinue
  $oldHost = [Environment]::GetEnvironmentVariable('HOST','Process')
  $oldPort = [Environment]::GetEnvironmentVariable('PORT','Process')
  [Environment]::SetEnvironmentVariable('HOST','127.0.0.1','Process')
  [Environment]::SetEnvironmentVariable('PORT','5177','Process')
  $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
  try {
    $proc = Start-Process -FilePath $nodeExe -ArgumentList @('bootstrap.js') -WorkingDirectory $ProjectRoot -PassThru -NoNewWindow -RedirectStandardOutput $verifyLog -RedirectStandardError $verifyErr
    $status = Wait-LocalReady 5177 $proc 240
    if ($status -eq 0) {
      try { Stop-ProcessTree $proc.Id 'failed candidate verification process' } catch {}
      $tail = ''
      try { $tail = ((Get-Content -LiteralPath $verifyErr -Tail 30 -ErrorAction SilentlyContinue) -join "`n") } catch {}
      throw "Installed candidate did not become ready on port 5177. $tail"
    }
    Stop-ProcessTree $proc.Id 'candidate verification process'
    Start-Sleep -Seconds 1
    Stop-PortOwners 5177
    try { Stop-PortOwners 5178 } catch {}
    Write-Host "Installed candidate verified: SHA=$CandidateSha HTTP=$status" -ForegroundColor Green
  }
  finally {
    [Environment]::SetEnvironmentVariable('HOST',$oldHost,'Process')
    [Environment]::SetEnvironmentVariable('PORT',$oldPort,'Process')
  }
}

function Rollback-ToPrevious([string]$OldHead, [string]$DbFile, [string]$BackupFile, [bool]$DependenciesChanged, [string]$ProjectRoot) {
  Write-Host 'Update verification failed. Rolling back code and database...' -ForegroundColor Red
  try { Stop-PortOwners 5177 } catch {}
  try { Stop-PortOwners 5178 } catch {}
  Set-Location -LiteralPath $ProjectRoot
  try { Run-Git @('switch','main') | Out-Null } catch {}
  Run-Git @('reset','--hard',$OldHead) | Out-Null
  if ($DependenciesChanged) {
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Rollback npm ci failed.' }
  }
  Restore-LiveDatabase $DbFile $BackupFile
  $restored = Git-Text @('rev-parse','HEAD')
  if ($restored -ne $OldHead) { throw 'Rollback code SHA verification failed.' }
  Write-Host 'Rollback verified. Previous code and SQLite database restored.' -ForegroundColor Green
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SelfPath = $PSCommandPath
Set-Location -LiteralPath $ProjectRoot
$Port = 5177
$LogDir = Join-Path $ProjectRoot 'logs'
$RuntimePidFile = Join-Path $LogDir 'runtime_supervisor.pid'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

Write-Section 'CE QC APP - VERIFIED UPDATE AND START'
Write-Host "Project: $ProjectRoot"
Write-Host "Safety gate: $V336_SAFE_UPDATE_ID" -ForegroundColor DarkGray

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is not installed or not available in PATH.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed or not available in PATH.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is not installed or not available in PATH.' }

Ensure-LiveDependencies $ProjectRoot
$RuntimeConfig = Get-LiveRuntimeConfig
$LocalHead = Git-Text @('rev-parse','HEAD')

Write-Host ''
Write-Host '[1/7] Checking GitHub main...' -ForegroundColor Yellow
$FetchCode = Run-Git @('fetch','origin','main') -AllowFailure
if ($FetchCode -ne 0) {
  Write-Host 'GitHub is temporarily unavailable. Starting the installed local version.' -ForegroundColor Yellow
  Stop-RecordedRuntime $RuntimePidFile
  Stop-LegacySupervisors $ProjectRoot
  Stop-PortOwners 5177
  try { Stop-PortOwners 5178 } catch {}
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'Start_CE_QC.ps1')
  exit $LASTEXITCODE
}

$CandidateSha = Git-Text @('rev-parse','origin/main')
Write-Host "Installed: $LocalHead"
Write-Host "Candidate: $CandidateSha"

if ($LocalHead -eq $CandidateSha) {
  Write-Host 'Already on the latest verified GitHub main.' -ForegroundColor Green
  Stop-RecordedRuntime $RuntimePidFile
  Stop-LegacySupervisors $ProjectRoot
  Stop-PortOwners 5177
  try { Stop-PortOwners 5178 } catch {}
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'Start_CE_QC.ps1')
  exit $LASTEXITCODE
}

Write-Host ''
Write-Host '[2/7] Candidate go-live gate in isolated worktree...' -ForegroundColor Yellow
Test-Candidate $CandidateSha $ProjectRoot
$V336_CANDIDATE_GATE_PASSED = $true
if (-not $V336_CANDIDATE_GATE_PASSED) { throw 'Candidate gate did not complete.' }

Write-Host ''
Write-Host '[3/7] Stopping current runtime and protecting SQLite...' -ForegroundColor Yellow
Stop-RecordedRuntime $RuntimePidFile
Stop-LegacySupervisors $ProjectRoot
Stop-PortOwners 5177
try { Stop-PortOwners 5178 } catch {}
Start-Sleep -Seconds 2
$BackupFile = Backup-LiveDatabase $RuntimeConfig $CandidateSha
$DbFile = [string]$RuntimeConfig.dbFile

$TimeStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupBranch = "local-backup-before-v336-update-$TimeStamp"
Run-Git @('branch',$BackupBranch,$LocalHead) | Out-Null
$TrackedDirty = @(& git status --porcelain --untracked-files=no)
if ($TrackedDirty.Count -gt 0) {
  Run-Git @('stash','push','-m',"CE-QC tracked backup $TimeStamp") | Out-Null
}
$DependencyDiff = @(& git diff --name-only $LocalHead $CandidateSha -- package.json package-lock.json)
$DependenciesChanged = $DependencyDiff.Count -gt 0

Write-Host ''
Write-Host '[4/7] Installing the exact tested candidate SHA...' -ForegroundColor Yellow
$InstallSucceeded = $false
try {
  Run-Git @('switch','main') | Out-Null
  Run-Git @('reset','--hard',$CandidateSha) | Out-Null
  $installed = Git-Text @('rev-parse','HEAD')
  if ($installed -ne $CandidateSha) { throw 'Exact candidate SHA installation verification failed.' }
  if ($DependenciesChanged -or -not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules'))) {
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed after installing candidate.' }
  }

  Write-Host ''
  Write-Host '[5/7] Verifying database preservation before startup...' -ForegroundColor Yellow
  if (-not (Test-Path -LiteralPath $DbFile)) { throw 'Live SQLite disappeared during installation.' }
  Invoke-SqliteCheck $DbFile

  Write-Host ''
  Write-Host '[6/7] Verifying exact installed SHA and local startup...' -ForegroundColor Yellow
  Verify-InstalledCandidate $CandidateSha $ProjectRoot
  $InstallSucceeded = $true
}
catch {
  $installError = $_
  try { Rollback-ToPrevious $LocalHead $DbFile $BackupFile $DependenciesChanged $ProjectRoot }
  catch { throw "Update failed and rollback also failed: $($installError.Exception.Message) | rollback: $($_.Exception.Message)" }
  Write-Host "Candidate rejected and previous version restored: $($installError.Exception.Message)" -ForegroundColor Red
  Write-Host 'Starting the restored previous version.' -ForegroundColor Yellow
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'Start_CE_QC.ps1')
  exit $LASTEXITCODE
}

if (-not $InstallSucceeded) { throw 'Installation did not reach verified state.' }
Write-Host ''
Write-Host '[7/7] Update verified. Starting protected runtime...' -ForegroundColor Green
Write-Section 'VERIFIED UPDATE COMPLETE'
Write-Host "Installed SHA: $CandidateSha" -ForegroundColor Green
Write-Host "Database backup: $BackupFile" -ForegroundColor DarkGray
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'Start_CE_QC.ps1')
exit $LASTEXITCODE
