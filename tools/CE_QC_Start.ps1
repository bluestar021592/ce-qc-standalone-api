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

function Describe-Process([int]$ProcessId) {
  try {
    $info = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if ($null -ne $info) {
      return "PID=$ProcessId Name=$($info.Name) CommandLine=$($info.CommandLine)"
    }
  }
  catch {}
  return "PID=$ProcessId"
}

function Stop-PortOwners([int]$Port) {
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    $owners = @(Get-PortOwnerPids $Port)
    if ($owners.Count -eq 0) { return }

    foreach ($ownerPid in $owners) {
      if ($ownerPid -eq $PID) { continue }
      Write-Host ("Stopping port owner: " + (Describe-Process $ownerPid)) -ForegroundColor DarkYellow

      try {
        & taskkill.exe /PID $ownerPid /T /F 2>$null | Out-Null
      }
      catch {}

      try {
        Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
      }
      catch {}
    }

    Start-Sleep -Milliseconds 650
  }

  $remaining = @(Get-PortOwnerPids $Port)
  if ($remaining.Count -gt 0) {
    $details = @($remaining | ForEach-Object { Describe-Process $_ }) -join ' | '
    throw "Port $Port is still occupied after cleanup: $details"
  }
}

function Test-AppReady([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  }
  catch {
    return $false
  }
}

function Start-CeQcBackend([string]$NodePath, [string]$ProjectRoot, [string]$Url, [int]$Port) {
  for ($launchAttempt = 1; $launchAttempt -le 2; $launchAttempt++) {
    Stop-PortOwners $Port
    Start-Sleep -Milliseconds 450

    $backend = Start-Process -FilePath $NodePath -ArgumentList @('bootstrap.js') -WorkingDirectory $ProjectRoot -PassThru
    $ready = $false

    for ($i = 0; $i -lt 50; $i++) {
      Start-Sleep -Milliseconds 400
      if (Test-AppReady $Url) {
        $ready = $true
        break
      }
      if ($backend.HasExited) { break }
    }

    if ($ready) { return $backend }

    if (-not $backend.HasExited) {
      try { Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue } catch {}
    }

    if ($launchAttempt -lt 2) {
      Write-Host 'Backend start collided with an old listener. Cleaning port and retrying once...' -ForegroundColor DarkYellow
      Stop-PortOwners $Port
      Start-Sleep -Milliseconds 900
      continue
    }

    if ($backend.HasExited) {
      throw "CE QC backend exited during startup. ExitCode=$($backend.ExitCode)"
    }
    throw "CE QC backend did not answer at $Url within the startup window."
  }
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
Write-Host "[3/5] Taking ownership of local port $Port..." -ForegroundColor Yellow
Stop-PortOwners $Port
Write-Host "Port $Port is free." -ForegroundColor Green

Write-Host ''
Write-Host '[4/5] Starting CE QC backend...' -ForegroundColor Yellow
$NodePath = (Get-Command node).Source
$Backend = Start-CeQcBackend $NodePath $ProjectRoot $Url $Port
Write-Host "Backend ready. PID=$($Backend.Id)" -ForegroundColor Green

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
