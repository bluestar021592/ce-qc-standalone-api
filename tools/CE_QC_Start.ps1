$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'CE QC APP START'

if ($env:CE_QC_LAUNCHER_TEST_MODE -eq '1') {
  Write-Host 'CE_QC_LAUNCHER_TEST_OK'
  exit 0
}

function Write-Section([string]$Text) {
  Write-Host ''
  Write-Host ('=' * 58) -ForegroundColor Cyan
  Write-Host $Text -ForegroundColor Cyan
  Write-Host ('=' * 58) -ForegroundColor Cyan
}

function Run-Git([string[]]$Arguments, [switch]$AllowFailure) {
  & git @Arguments
  $code = $LASTEXITCODE
  if ($code -ne 0 -and -not $AllowFailure) {
    throw "Git command failed: git $($Arguments -join ' ')"
  }
  return $code
}

function Get-PortOwnerPids([int]$Port) {
  $result = @()
  try {
    $result += @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.OwningProcess })
  }
  catch {}
  if ($result.Count -eq 0) {
    try {
      $pattern = ":$Port\s+.*LISTENING\s+(\d+)\s*$"
      foreach ($line in @(netstat -ano -p tcp 2>$null)) {
        $match = [regex]::Match([string]$line, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($match.Success) { $result += [int]$match.Groups[1].Value }
      }
    }
    catch {}
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
  }
  catch {}
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
      foreach ($token in $legacyTokens) {
        if ($cmd.Contains($token)) { return $true }
      }
      if ($cmd.Contains($root) -and $cmd.Contains('bootstrap.js')) { return $true }
      return $false
    })
  }
  catch {}

  foreach ($process in $matches) {
    Stop-ProcessTree ([int]$process.ProcessId) 'legacy CE QC supervisor'
  }
  if ($matches.Count -gt 0) { Start-Sleep -Seconds 2 }
}

function Stop-PortOwners([int]$Port) {
  for ($attempt = 1; $attempt -le 10; $attempt++) {
    $owners = @(Get-PortOwnerPids $Port)
    if ($owners.Count -eq 0) { return }
    foreach ($ownerPid in $owners) {
      $supervisor = Get-ShellSupervisorForProcess $ownerPid
      if ($supervisor) {
        Stop-ProcessTree ([int]$supervisor.ProcessId) "supervisor of port $Port owner"
      }
      else {
        Stop-ProcessTree $ownerPid "port $Port owner"
      }
    }
    Start-Sleep -Milliseconds 900
  }
  $remaining = @(Get-PortOwnerPids $Port)
  if ($remaining.Count -gt 0) {
    throw "Port $Port is still occupied after cleanup: $($remaining -join ',')"
  }
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SelfPath = $PSCommandPath
Set-Location $ProjectRoot
$Port = 5177
$TimeStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$DependenciesChanged = $false
$Updated = $false
$SelfHashBefore = ''
$LogDir = Join-Path $ProjectRoot 'logs'
$RuntimePidFile = Join-Path $LogDir 'runtime_supervisor.pid'
if (Test-Path -LiteralPath $SelfPath) {
  try { $SelfHashBefore = (Get-FileHash -LiteralPath $SelfPath -Algorithm SHA256).Hash } catch {}
}

Write-Section 'CE QC APP - SAFE UPDATE AND START'
Write-Host "Project: $ProjectRoot"
Write-Host 'Every start checks GitHub main first. Runtime data is preserved.' -ForegroundColor DarkGray

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is not installed or not available in PATH.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed or not available in PATH.' }

Write-Host ''
Write-Host '[1/5] Checking GitHub main...' -ForegroundColor Yellow
$LocalHead = (& git rev-parse HEAD).Trim()
$FetchCode = Run-Git @('fetch','origin','main') -AllowFailure
if ($FetchCode -eq 0) {
  $RemoteHead = (& git rev-parse origin/main).Trim()
  Write-Host "Local : $LocalHead"
  Write-Host "GitHub: $RemoteHead"
  if ($LocalHead -ne $RemoteHead) {
    $BackupBranch = "local-backup-before-ce-qc-start-$TimeStamp"
    Run-Git @('branch',$BackupBranch,$LocalHead) | Out-Null
    Write-Host "Safety branch: $BackupBranch" -ForegroundColor DarkYellow

    $TrackedDirty = @(& git status --porcelain --untracked-files=no)
    if ($TrackedDirty.Count -gt 0) {
      Run-Git @('stash','push','-m',"CE-QC tracked backup $TimeStamp") | Out-Null
      Write-Host 'Tracked local edits were stashed safely. Untracked local files were left in place.' -ForegroundColor DarkYellow
    }

    $DependencyDiff = @(& git diff --name-only $LocalHead $RemoteHead -- package.json package-lock.json)
    $DependenciesChanged = $DependencyDiff.Count -gt 0
    Run-Git @('switch','main') | Out-Null
    Run-Git @('reset','--hard','origin/main') | Out-Null
    $Updated = $true
    Write-Host 'GitHub main synchronized.' -ForegroundColor Green
  }
  else {
    Write-Host 'Already on the latest GitHub main.' -ForegroundColor Green
  }
}
else {
  Write-Host 'GitHub is temporarily unavailable. Starting the installed local version.' -ForegroundColor Yellow
}

if ($Updated -and $SelfHashBefore) {
  $SelfHashAfter = ''
  try { $SelfHashAfter = (Get-FileHash -LiteralPath $SelfPath -Algorithm SHA256).Hash } catch {}
  if ($SelfHashAfter -and $SelfHashAfter -ne $SelfHashBefore) {
    Write-Host ''
    Write-Host 'Launcher itself was updated. Restarting with the new launcher now...' -ForegroundColor Yellow
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $SelfPath
    exit $LASTEXITCODE
  }
}

if ($Updated -and $DependenciesChanged) {
  Write-Host ''
  Write-Host '[2/5] Dependencies changed. Running npm ci...' -ForegroundColor Yellow
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
elseif (-not (Test-Path (Join-Path $ProjectRoot 'node_modules'))) {
  Write-Host ''
  Write-Host '[2/5] node_modules missing. Running npm ci...' -ForegroundColor Yellow
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
else {
  Write-Host '[2/5] Dependencies ready.' -ForegroundColor Green
}

Write-Host ''
Write-Host '[3/5] Stopping old CE QC runtime and taking port 5177...' -ForegroundColor Yellow
Stop-RecordedRuntime $RuntimePidFile
Stop-LegacySupervisors $ProjectRoot
Stop-PortOwners $Port
Start-Sleep -Seconds 2
Stop-PortOwners $Port
Write-Host 'Old CE QC runtime stopped. Port 5177 is stable and free.' -ForegroundColor Green

$RuntimeScript = Join-Path $ProjectRoot 'Start_CE_QC.ps1'
if (-not (Test-Path -LiteralPath $RuntimeScript)) { throw 'Start_CE_QC.ps1 is missing.' }

Write-Host ''
Write-Host '[4/5] Starting protected CE QC runtime...' -ForegroundColor Yellow
Write-Host 'The runtime window will stay active and automatically restart Node after a crash.' -ForegroundColor DarkGray
Write-Host '[5/5] The protected runtime will verify port 5177 and open the APP.' -ForegroundColor Yellow
Write-Section 'HANDING OFF TO PROTECTED RUNTIME'
Write-Host 'SQLite, .env, token/cookie, backups, node_modules and untracked local files are preserved.' -ForegroundColor DarkGray

& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $RuntimeScript
exit $LASTEXITCODE
