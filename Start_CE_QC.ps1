$ErrorActionPreference = 'Stop'

function Fail([string]$Message, [int]$Code = 1) {
    Write-Host ''
    Write-Host $Message -ForegroundColor Red
    Write-Host ''
    Read-Host 'Press Enter to exit'
    exit $Code
}

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

Write-Host '===============================================' -ForegroundColor Cyan
Write-Host 'CE QC Standalone API' -ForegroundColor Cyan
Write-Host '===============================================' -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"

$nodeCandidates = @()
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand -and $nodeCommand.Source) { $nodeCandidates += $nodeCommand.Source }
if ($env:ProgramFiles) { $nodeCandidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
if ($env:LOCALAPPDATA) { $nodeCandidates += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe') }

$NodeExe = $nodeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $NodeExe) {
    Fail '[ERROR] Node.js was not found. Install Node.js 22 or newer.' 10
}

try {
    $NodeVersion = (& $NodeExe -p 'process.versions.node').Trim()
} catch {
    Fail "[ERROR] Node.js was found but its version could not be read: $($_.Exception.Message)" 11
}

if (-not $NodeVersion) {
    Fail '[ERROR] Unable to read Node.js version.' 12
}

$NodeMajor = 0
if (-not [int]::TryParse(($NodeVersion -split '\.')[0], [ref]$NodeMajor)) {
    Fail "[ERROR] Unable to parse Node.js version: $NodeVersion" 13
}

Write-Host "Node.js: $NodeExe"
Write-Host "Version: v$NodeVersion"

if ($NodeMajor -lt 22) {
    Fail "[ERROR] CE QC uses node:sqlite and requires Node.js 22+. Current version: v$NodeVersion" 14
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules'))) {
    Write-Host 'node_modules is missing. Installing dependencies...' -ForegroundColor Yellow
    $npmCandidates = @()
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCommand -and $npmCommand.Source) { $npmCandidates += $npmCommand.Source }
    $npmCandidates += (Join-Path (Split-Path -Parent $NodeExe) 'npm.cmd')
    $NpmExe = $npmCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $NpmExe) {
        Fail '[ERROR] npm.cmd was not found. Dependencies cannot be installed.' 15
    }
    & $NpmExe ci
    if ($LASTEXITCODE -ne 0) {
        Fail '[ERROR] npm ci failed.' 16
    }
}

Write-Host 'Checking port 5177...' -ForegroundColor Cyan
try {
    $listeners = Get-NetTCPConnection -LocalPort 5177 -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        if ($listener.OwningProcess -and $listener.OwningProcess -ne $PID) {
            Write-Host "Stopping old listener PID $($listener.OwningProcess)..." -ForegroundColor Yellow
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Host 'Port pre-cleanup could not be completed; startup will continue.' -ForegroundColor Yellow
}

Start-Sleep -Seconds 1

$LogDir = Join-Path $ProjectRoot 'logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$LogFile = Join-Path $LogDir 'startup_latest.log'
$ErrFile = Join-Path $LogDir 'startup_error.log'
Remove-Item -LiteralPath $LogFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $ErrFile -Force -ErrorAction SilentlyContinue

# Force the official local/LAN binding for this application. This prevents a stale .env HOST/PORT
# value from making the console print one address while Node actually listens on another one.
$env:HOST = '0.0.0.0'
$env:PORT = '5177'

Write-Host ''
Write-Host 'Starting backend and waiting for health check...' -ForegroundColor Cyan

try {
    $Backend = Start-Process -FilePath $NodeExe -ArgumentList @('bootstrap.js') -WorkingDirectory $ProjectRoot -PassThru -NoNewWindow -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile
} catch {
    Fail "[ERROR] Unable to start Node.js backend: $($_.Exception.Message)" 17
}

$Ready = $false
$Health = $null
for ($i = 1; $i -le 45; $i++) {
    Start-Sleep -Seconds 1

    if ($Backend.HasExited) {
        break
    }

    try {
        $Health = Invoke-RestMethod 'http://127.0.0.1:5177/api/health' -TimeoutSec 2
        if ($Health -and $Health.ok) {
            $Ready = $true
            break
        }
    } catch {
        # Backend may still be initializing; keep waiting.
    }
}

if (-not $Ready) {
    Write-Host ''
    Write-Host '[ERROR] Backend did not become reachable on 127.0.0.1:5177.' -ForegroundColor Red
    if ($Backend.HasExited) {
        Write-Host "Node process exited early. Exit code: $($Backend.ExitCode)" -ForegroundColor Red
    } else {
        Write-Host 'Node process is still running but the health endpoint is unreachable.' -ForegroundColor Red
        Stop-Process -Id $Backend.Id -Force -ErrorAction SilentlyContinue
    }

    Write-Host ''
    Write-Host '--- startup_latest.log ---' -ForegroundColor Yellow
    if (Test-Path -LiteralPath $LogFile) { Get-Content -LiteralPath $LogFile -Tail 120 -ErrorAction SilentlyContinue }
    Write-Host ''
    Write-Host '--- startup_error.log ---' -ForegroundColor Yellow
    if (Test-Path -LiteralPath $ErrFile) { Get-Content -LiteralPath $ErrFile -Tail 120 -ErrorAction SilentlyContinue }
    Fail '[ERROR] CE QC startup verification failed. Send this screen to ChatGPT.' 18
}

$LanIp = ''
try {
    $LanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^169\.254\.' } |
        Sort-Object -Property InterfaceMetric |
        Select-Object -First 1 -ExpandProperty IPAddress
} catch {}

$LocalUrl = 'http://127.0.0.1:5177'
$LanUrl = if ($LanIp) { "http://$LanIp`:5177" } else { '' }

Write-Host ''
Write-Host '===============================================' -ForegroundColor Green
Write-Host 'BACKEND READY - health check passed' -ForegroundColor Green
Write-Host "Local URL: $LocalUrl" -ForegroundColor Green
if ($LanUrl) { Write-Host "LAN URL: $LanUrl" -ForegroundColor Green }
Write-Host "Database health: $($Health.db.ok)" -ForegroundColor Green
Write-Host "Startup log: $LogFile"
Write-Host 'Keep this window open while using CE QC.' -ForegroundColor Yellow
Write-Host '===============================================' -ForegroundColor Green
Write-Host ''

# Open the browser only AFTER /api/health has succeeded. CI must not launch a browser.
if (-not $env:CI) {
    try { Start-Process $LocalUrl | Out-Null } catch {}
}

# Keep the launcher alive with the backend. If Node exits, surface the logs instead of silently
# leaving the browser on a dead 127.0.0.1 page.
while (-not $Backend.HasExited) {
    Start-Sleep -Seconds 2
}

$ExitCode = $Backend.ExitCode
Write-Host ''
Write-Host "[ERROR] CE QC backend stopped. Exit code: $ExitCode" -ForegroundColor Red
Write-Host 'Recent startup output:' -ForegroundColor Yellow
if (Test-Path -LiteralPath $LogFile) { Get-Content -LiteralPath $LogFile -Tail 100 -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath $ErrFile) { Get-Content -LiteralPath $ErrFile -Tail 100 -ErrorAction SilentlyContinue }
Write-Host ''
Read-Host 'Press Enter to exit'
exit $ExitCode
