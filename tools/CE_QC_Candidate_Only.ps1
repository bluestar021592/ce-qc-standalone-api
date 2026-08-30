$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'CE QC CANDIDATE ONLY VALIDATION'
$V367_CANDIDATE_ONLY_ID = '2026-08-30-v367-isolated-candidate-only-no-live-mutation-v1'

param(
  [string]$CandidateRef = '',
  [string]$ExpectedSha = ''
)

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

function Set-CandidateTestEnvironment([string]$SandboxRoot) {
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

function Restore-CandidateTestEnvironment($Snapshot) {
  if (-not $Snapshot) { return }
  foreach ($name in $Snapshot.Names) {
    [Environment]::SetEnvironmentVariable($name, $Snapshot.Old[$name], 'Process')
  }
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is not installed or not available in PATH.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed or not available in PATH.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is not installed or not available in PATH.' }

$CandidateRef = ([string]$CandidateRef).Trim()
if (-not $CandidateRef) { $CandidateRef = ([string]$env:CE_QC_CANDIDATE_REF).Trim() }
if (-not $CandidateRef) { $CandidateRef = 'recovery/20260830-daily-chain' }
$ExpectedSha = ([string]$ExpectedSha).Trim()
if (-not $ExpectedSha) { $ExpectedSha = ([string]$env:CE_QC_CANDIDATE_SHA).Trim() }

$LiveHeadBefore = Git-Text @('rev-parse','HEAD')
$TrackedBefore = (@(& git status --porcelain --untracked-files=no) | Out-String).Trim()

Write-Host "Candidate-only safety gate: $V367_CANDIDATE_ONLY_ID" -ForegroundColor Cyan
Write-Host "Live HEAD before: $LiveHeadBefore" -ForegroundColor DarkGray
Write-Host "Fetching candidate ref only: $CandidateRef" -ForegroundColor Yellow
$FetchCode = Run-Git @('fetch','origin',$CandidateRef) -AllowFailure
if ($FetchCode -ne 0) {
  throw 'Candidate fetch failed. Live runtime/code/database were not changed.'
}

$CandidateSha = Git-Text @('rev-parse','FETCH_HEAD')
if ($ExpectedSha) {
  if ($CandidateSha.ToLowerInvariant() -ne $ExpectedSha.ToLowerInvariant()) {
    throw "Candidate SHA mismatch. Expected $ExpectedSha, fetched $CandidateSha. Live runtime/code/database were not changed."
  }
}
Write-Host "Exact candidate SHA: $CandidateSha" -ForegroundColor Cyan

$short = $CandidateSha.Substring(0, [Math]::Min(12, $CandidateSha.Length))
$CandidateRoot = Join-Path ([IO.Path]::GetTempPath()) ("CE_QC_candidate_only_${short}_" + (Get-Date -Format 'yyyyMMddHHmmss'))
$EnvSnapshot = $null
$Pushed = $false
try {
  if (Test-Path -LiteralPath $CandidateRoot) { Remove-Item -LiteralPath $CandidateRoot -Recurse -Force }
  Run-Git @('worktree','add','--detach',$CandidateRoot,$CandidateSha) | Out-Null
  Push-Location $CandidateRoot
  $Pushed = $true
  $EnvSnapshot = Set-CandidateTestEnvironment (Join-Path $CandidateRoot '.candidate-runtime')
  Write-Host 'Installing candidate dependencies inside temporary worktree only...' -ForegroundColor Yellow
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Candidate-only npm ci failed.' }
  Write-Host 'Running full candidate test:golive inside isolated worktree...' -ForegroundColor Yellow
  & npm run test:golive
  if ($LASTEXITCODE -ne 0) { throw 'Candidate-only test:golive failed.' }
}
finally {
  if ($Pushed) { try { Pop-Location } catch {} }
  Restore-CandidateTestEnvironment $EnvSnapshot
  Set-Location -LiteralPath $ProjectRoot
  try { & git worktree remove --force $CandidateRoot 2>$null | Out-Null } catch {}
  try { if (Test-Path -LiteralPath $CandidateRoot) { Remove-Item -LiteralPath $CandidateRoot -Recurse -Force } } catch {}
  try { & git worktree prune 2>$null | Out-Null } catch {}
}

$LiveHeadAfter = Git-Text @('rev-parse','HEAD')
$TrackedAfter = (@(& git status --porcelain --untracked-files=no) | Out-String).Trim()
if ($LiveHeadAfter -ne $LiveHeadBefore) {
  throw "LIVE_HEAD_MUTATED: before=$LiveHeadBefore after=$LiveHeadAfter"
}
if ($TrackedAfter -ne $TrackedBefore) {
  throw 'LIVE_TRACKED_WORKTREE_MUTATED: candidate-only validation changed tracked files.'
}

Write-Host ''
Write-Host 'CANDIDATE_ONLY_PASS' -ForegroundColor Green
Write-Host "Candidate SHA: $CandidateSha" -ForegroundColor Green
Write-Host "Live HEAD unchanged: $LiveHeadAfter" -ForegroundColor Green
Write-Host 'Live runtime was not stopped. Live SQLite path was never resolved or opened. No installation was performed.' -ForegroundColor Green
exit 0
