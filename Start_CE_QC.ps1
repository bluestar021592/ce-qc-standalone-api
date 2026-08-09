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
if (-not $NodeExe) { Fail '[ERROR] Node.js was not found. Install Node.js 22 or newer.' 10 }

try { $NodeVersion = (& $NodeExe -p 'process.versions.node').Trim() } catch { Fail "[ERROR] Node.js version could not be read: $($_.Exception.Message)" 11 }
if (-not $NodeVersion) { Fail '[ERROR] Unable to read Node.js version.' 12 }
$NodeMajor = 0
if (-not [int]::TryParse(($NodeVersion -split '\.')[0], [ref]$NodeMajor)) { Fail "[ERROR] Unable to parse Node.js version: $NodeVersion" 13 }
Write-Host "Node.js: $NodeExe"
Write-Host "Version: v$NodeVersion"
if ($NodeMajor -lt 22) { Fail "[ERROR] CE QC requires Node.js 22+. Current version: v$NodeVersion" 14 }

$npmCandidates = @()
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand -and $npmCommand.Source) { $npmCandidates += $npmCommand.Source }
$npmCandidates += (Join-Path (Split-Path -Parent $NodeExe) 'npm.cmd')
$NpmExe = $npmCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $NpmExe) { Fail '[ERROR] npm.cmd was not found.' 15 }

$NeedInstall = -not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules'))
if (-not $NeedInstall) {
    & $NpmExe ls --depth=0 --silent *> $null
    if ($LASTEXITCODE -ne 0) { $NeedInstall = $true }
}
if ($NeedInstall) {
    Write-Host 'Dependencies are missing or do not match package-lock.json. Running npm ci...' -ForegroundColor Yellow
    & $NpmExe ci
    if ($LASTEXITCODE -ne 0) { Fail '[ERROR] npm ci failed.' 16 }
}

$LogDir = Join-Path $ProjectRoot 'logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$LogFile = Join-Path $LogDir 'startup_latest.log'
$ErrFile = Join-Path $LogDir 'startup_error.log'
$CrashDir = Join-Path $LogDir 'crashes'
$RuntimePidFile = Join-Path $LogDir 'runtime_supervisor.pid'
New-Item -ItemType Directory -Path $CrashDir -Force | Out-Null
try { [IO.File]::WriteAllText($RuntimePidFile, [string]$PID, [Text.Encoding]::ASCII) } catch {}

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

function Stop-Tree([int]$ProcessId, [string]$Reason) {
    if ($ProcessId -le 0 -or $ProcessId -eq $PID) { return }
    Write-Host "Stopping $Reason PID $ProcessId..." -ForegroundColor Yellow
    try { & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null } catch {}
    try { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}

function Get-ShellSupervisor([int]$ProcessId) {
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

function Clear-CeQcPort([int]$Port) {
    $freePasses = 0
    for ($attempt = 1; $attempt -le 18; $attempt++) {
        $owners = @(Get-PortOwnerPids $Port)
        if ($owners.Count -eq 0) {
            $freePasses += 1
            if ($freePasses -ge 3) { return }
            Start-Sleep -Milliseconds 700
            continue
        }

        $freePasses = 0
        foreach ($ownerPid in $owners) {
            if ($ownerPid -eq $PID) { continue }
            $supervisor = Get-ShellSupervisor $ownerPid
            if ($supervisor) {
                Stop-Tree ([int]$supervisor.ProcessId) "old CE QC supervisor for port $Port"
            } else {
                Stop-Tree $ownerPid "old listener on port $Port"
            }
        }
        Start-Sleep -Milliseconds 900
    }

    $remaining = @(Get-PortOwnerPids $Port)
    if ($remaining.Count -gt 0) {
        Fail "[ERROR] Port $Port is still occupied after supervisor cleanup: $($remaining -join ',')" 20
    }
}

Write-Host 'Checking port 5177...' -ForegroundColor Cyan
Clear-CeQcPort 5177
Write-Host 'Port 5177 is stable and free.' -ForegroundColor Green

$env:HOST = '0.0.0.0'
$env:PORT = '5177'
$LocalUrl = 'http://127.0.0.1:5177'

function Archive-BackendLogs([string]$Reason) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $safeReason = ($Reason -replace '[^A-Za-z0-9_-]', '_')
    if (Test-Path -LiteralPath $LogFile) {
        Copy-Item -LiteralPath $LogFile -Destination (Join-Path $CrashDir "${stamp}_${safeReason}_stdout.log") -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $ErrFile) {
        Copy-Item -LiteralPath $ErrFile -Destination (Join-Path $CrashDir "${stamp}_${safeReason}_stderr.log") -Force -ErrorAction SilentlyContinue
    }
}

function Start-BackendInstance {
    Remove-Item -LiteralPath $LogFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $ErrFile -Force -ErrorAction SilentlyContinue
    return Start-Process -FilePath $NodeExe -ArgumentList @('bootstrap.js') -WorkingDirectory $ProjectRoot -PassThru -NoNewWindow -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile
}

function Wait-BackendReady($Backend, [int]$Seconds = 60) {
    $status = 0
    for ($i = 1; $i -le $Seconds; $i++) {
        Start-Sleep -Seconds 1
        try {
            $Response = Invoke-WebRequest $LocalUrl -UseBasicParsing -TimeoutSec 2
            $status = [int]$Response.StatusCode
            if ($status -ge 200 -and $status -lt 500) { return @{ Ready = $true; Status = $status } }
        } catch {
            try {
                if ($_.Exception.Response) {
                    $status = [int]$_.Exception.Response.StatusCode
                    if ($status -ge 200 -and $status -lt 500) { return @{ Ready = $true; Status = $status } }
                }
            } catch {}
        }
        $alive = $false
        try { $alive = $null -ne (Get-Process -Id $Backend.Id -ErrorAction SilentlyContinue) } catch {}
        if (-not $alive) {
            Start-Sleep -Milliseconds 300
            break
        }
    }
    return @{ Ready = $false; Status = $status }
}

function Show-RecentBackendLogs {
    Write-Host ''
    Write-Host '--- startup_latest.log ---' -ForegroundColor Yellow
    if (Test-Path -LiteralPath $LogFile) { Get-Content -LiteralPath $LogFile -Tail 160 -ErrorAction SilentlyContinue }
    Write-Host ''
    Write-Host '--- startup_error.log ---' -ForegroundColor Yellow
    if (Test-Path -LiteralPath $ErrFile) { Get-Content -LiteralPath $ErrFile -Tail 160 -ErrorAction SilentlyContinue }
}

function Test-AddressInUseLog {
    if (-not (Test-Path -LiteralPath $ErrFile)) { return $false }
    try {
        $text = Get-Content -LiteralPath $ErrFile -Raw -ErrorAction SilentlyContinue
        return [bool]($text -match 'EADDRINUSE|address already in use')
    } catch { return $false }
}

function Test-BackendProcessAlive($Backend) {
    if (-not $Backend -or -not $Backend.Id) { return $false }
    try { return $null -ne (Get-Process -Id $Backend.Id -ErrorAction SilentlyContinue) } catch { return $false }
}

function Get-BackendExitCode($Backend) {
    try {
        $Backend.Refresh()
        if ($Backend.HasExited) { return [int]$Backend.ExitCode }
    } catch {}
    return -1
}

Write-Host ''
Write-Host 'Starting backend and waiting for the local web application...' -ForegroundColor Cyan
try { $Backend = Start-BackendInstance } catch { Fail "[ERROR] Unable to start Node.js backend: $($_.Exception.Message)" 17 }
$Probe = Wait-BackendReady $Backend 60

if (-not $Probe.Ready -and (Test-AddressInUseLog)) {
    Archive-BackendLogs 'address_in_use_first_attempt'
    Write-Host ''
    Write-Host '[WARN] Another old supervisor reclaimed port 5177. Removing it and retrying once...' -ForegroundColor Yellow
    Clear-CeQcPort 5177
    Start-Sleep -Seconds 1
    try { $Backend = Start-BackendInstance } catch { Fail "[ERROR] Unable to retry Node.js backend: $($_.Exception.Message)" 21 }
    $Probe = Wait-BackendReady $Backend 60
}

if (-not $Probe.Ready) {
    Archive-BackendLogs 'initial_start_failure'
    Write-Host ''
    Write-Host '[ERROR] Backend did not become reachable on 127.0.0.1:5177.' -ForegroundColor Red
    if (-not (Test-BackendProcessAlive $Backend)) { Write-Host "Node process exited early. Exit code: $(Get-BackendExitCode $Backend)" -ForegroundColor Red }
    else {
        Write-Host 'Node process is running but the local web application is unreachable.' -ForegroundColor Red
        Stop-Process -Id $Backend.Id -Force -ErrorAction SilentlyContinue
    }
    Show-RecentBackendLogs
    Fail '[ERROR] CE QC startup verification failed. Send this screen to ChatGPT.' 18
}

$LanIp = ''
try {
    $LanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^169\.254\.' } |
        Select-Object -First 1 -ExpandProperty IPAddress
} catch {}
$LanUrl = if ($LanIp) { "http://$LanIp`:5177" } else { '' }

Write-Host ''
Write-Host '===============================================' -ForegroundColor Green
Write-Host 'BACKEND READY - local web response verified' -ForegroundColor Green
Write-Host "Local URL: $LocalUrl" -ForegroundColor Green
if ($LanUrl) { Write-Host "LAN URL: $LanUrl" -ForegroundColor Green }
Write-Host "Local HTTP status: $($Probe.Status)" -ForegroundColor Green
Write-Host "Startup log: $LogFile"
Write-Host "Crash archive: $CrashDir"
Write-Host 'Automatic backend restart: ENABLED (max 5 crashes / 10 minutes).' -ForegroundColor Green
Write-Host 'Keep this window open while using CE QC.' -ForegroundColor Yellow
Write-Host '===============================================' -ForegroundColor Green
Write-Host ''

if (-not $env:CI) { try { Start-Process $LocalUrl | Out-Null } catch {} }

$RestartTimes = New-Object System.Collections.Generic.List[datetime]
while ($true) {
    try {
        while (Test-BackendProcessAlive $Backend) { Start-Sleep -Seconds 2 }

        $ExitCode = Get-BackendExitCode $Backend
        Archive-BackendLogs "exit_$ExitCode"
        Write-Host ''
        Write-Host "[WARN] CE QC backend stopped. Exit code: $ExitCode" -ForegroundColor Red
        Show-RecentBackendLogs

        $now = Get-Date
        $recent = @($RestartTimes | Where-Object { $_ -gt $now.AddMinutes(-10) })
        $RestartTimes.Clear()
        foreach ($time in $recent) { $RestartTimes.Add($time) }
        if ($RestartTimes.Count -ge 5) {
            Fail '[ERROR] Backend crashed 5 times within 10 minutes. Automatic restart stopped to prevent a crash loop. Send this screen and logs\crashes to ChatGPT.' 19
        }
        $RestartTimes.Add($now)

        Write-Host ''
        Write-Host "Automatic recovery: restarting backend in 3 seconds... ($($RestartTimes.Count)/5)" -ForegroundColor Yellow
        Start-Sleep -Seconds 3

        Clear-CeQcPort 5177
        try { $Backend = Start-BackendInstance } catch {
            Write-Host "[WARN] Restart process creation failed: $($_.Exception.Message)" -ForegroundColor Red
            Start-Sleep -Seconds 3
            continue
        }

        $Probe = Wait-BackendReady $Backend 45
        if ($Probe.Ready) {
            Write-Host ''
            Write-Host 'BACKEND RECOVERED - browser can reconnect automatically.' -ForegroundColor Green
            Write-Host "Local HTTP status: $($Probe.Status)" -ForegroundColor Green
            continue
        }

        Archive-BackendLogs 'restart_not_ready'
        if (Test-BackendProcessAlive $Backend) { Stop-Process -Id $Backend.Id -Force -ErrorAction SilentlyContinue }
        Write-Host '[WARN] Restarted process did not become ready; supervisor will retry.' -ForegroundColor Red
    }
    catch {
        Write-Host ''
        Write-Host "[WARN] Runtime supervisor monitor recovered from an internal error: $($_.Exception.Message)" -ForegroundColor Yellow
        try {
            if (Test-BackendProcessAlive $Backend) {
                Write-Host 'Backend is still running. Supervisor monitor will continue.' -ForegroundColor Green
                Start-Sleep -Seconds 2
                continue
            }
        } catch {}
        Write-Host 'Backend state is not healthy. Supervisor will re-enter recovery flow.' -ForegroundColor Yellow
        Start-Sleep -Seconds 2
    }
}
