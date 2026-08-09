$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'CE QC APP START'

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

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
$Port = 5177
$Url = "http://127.0.0.1:$Port/"
$TimeStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Updated = $false
$DependenciesChanged = $false

Write-Section 'CE QC APP - SAFE UPDATE AND START'
Write-Host "Project: $ProjectRoot"
Write-Host 'Every start checks GitHub main first. Runtime data is preserved.' -ForegroundColor DarkGray

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git is not installed or not available in PATH.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is not installed or not available in PATH.'
}

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

    $Dirty = @(& git status --porcelain)
    if ($Dirty.Count -gt 0) {
      Run-Git @('stash','push','-u','-m',"CE-QC auto backup $TimeStamp") | Out-Null
      Write-Host 'Local uncommitted files were stashed safely.' -ForegroundColor DarkYellow
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

if ($Updated -and $DependenciesChanged) {
  Write-Host ''
  Write-Host '[2/5] Dependencies changed. Running npm ci...' -ForegroundColor Yellow
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
elif (-not (Test-Path (Join-Path $ProjectRoot 'node_modules'))) {
  Write-Host ''
  Write-Host '[2/5] node_modules missing. Running npm ci...' -ForegroundColor Yellow
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
else {
  Write-Host '[2/5] Dependencies ready.' -ForegroundColor Green
}

Write-Host ''
Write-Host "[3/5] Checking local port $Port..." -ForegroundColor Yellow
try {
  $Listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($Listener in $Listeners) {
    $ListenerPid = [int]$Listener.OwningProcess
    if ($ListenerPid -le 0) { continue }
    $Info = Get-CimInstance Win32_Process -Filter "ProcessId=$ListenerPid" -ErrorAction SilentlyContinue
    $CommandLine = [string]$Info.CommandLine
    if ($CommandLine -match 'bootstrap\.js|server\.js|ce-qc-standalone-api') {
      Write-Host "Stopping previous CE QC backend PID $ListenerPid..." -ForegroundColor DarkYellow
      Stop-Process -Id $ListenerPid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 700
    }
  }
}
catch {
  Write-Host 'Port inspection was not fully available; continuing safely.' -ForegroundColor DarkYellow
}

Write-Host ''
Write-Host '[4/5] Starting CE QC backend...' -ForegroundColor Yellow
$NodePath = (Get-Command node).Source
$Backend = Start-Process -FilePath $NodePath -ArgumentList @('bootstrap.js') -WorkingDirectory $ProjectRoot -PassThru

$Ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  if ($Backend.HasExited) { break }
  try {
    $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    if ($Response.StatusCode -ge 200 -and $Response.StatusCode -lt 500) {
      $Ready = $true
      break
    }
  }
  catch {}
}

if (-not $Ready) {
  if ($Backend.HasExited) {
    throw "CE QC backend exited during startup. ExitCode=$($Backend.ExitCode)"
  }
  throw "CE QC backend did not answer at $Url within the startup window."
}

Write-Host ''
Write-Host '[5/5] Opening CE QC APP...' -ForegroundColor Yellow
Start-Process $Url

Write-Section 'CE QC APP STARTED'
$CurrentHead = (& git rev-parse HEAD).Trim()
Write-Host "Version: $CurrentHead" -ForegroundColor Green
Write-Host "URL    : $Url" -ForegroundColor Green
Write-Host 'Use the desktop CE QC shortcut for all future starts.' -ForegroundColor Cyan
Write-Host 'SQLite, .env, token/cookie, backups and ignored runtime data are not cleaned.' -ForegroundColor DarkGray
Start-Sleep -Seconds 3
