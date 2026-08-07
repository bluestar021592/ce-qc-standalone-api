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

Write-Host ''
Write-Host '===============================================' -ForegroundColor Green
Write-Host 'Local URL: http://127.0.0.1:5177' -ForegroundColor Green
Write-Host "Startup log: $LogFile"
Write-Host 'Keep this window open while using CE QC.' -ForegroundColor Yellow
Write-Host '===============================================' -ForegroundColor Green
Write-Host ''

try {
    & $NodeExe 'bootstrap.js' 2>&1 | Tee-Object -FilePath $LogFile
    $ExitCode = $LASTEXITCODE
} catch {
    $ExitCode = 1
    $_ | Out-String | Tee-Object -FilePath $LogFile -Append | Write-Host
}

Write-Host ''
Write-Host "[ERROR] CE QC backend stopped. Exit code: $ExitCode" -ForegroundColor Red
Write-Host 'Recent startup log:' -ForegroundColor Yellow
if (Test-Path -LiteralPath $LogFile) {
    Get-Content -LiteralPath $LogFile -Tail 80 -ErrorAction SilentlyContinue
}
Write-Host ''
Read-Host 'Press Enter to exit'
exit $ExitCode
