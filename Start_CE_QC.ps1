$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Fail([string]$Message, [int]$Code = 1) {
    Write-Host ''
    Write-Host $Message -ForegroundColor Red
    Write-Host ''
    Read-Host '按Enter退出'
    exit $Code
}

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

Write-Host '===============================================' -ForegroundColor Cyan
Write-Host 'CE QC Standalone API' -ForegroundColor Cyan
Write-Host '===============================================' -ForegroundColor Cyan
Write-Host "项目目录: $ProjectRoot"

$nodeCandidates = @()
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand -and $nodeCommand.Source) { $nodeCandidates += $nodeCommand.Source }
if ($env:ProgramFiles) { $nodeCandidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
if ($env:LOCALAPPDATA) { $nodeCandidates += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe') }

$NodeExe = $nodeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $NodeExe) {
    Fail '[ERROR] 未找到 Node.js。请安装 Node.js 22 或更高版本。' 10
}

try {
    $NodeVersion = (& $NodeExe -p 'process.versions.node').Trim()
} catch {
    Fail "[ERROR] 找到了 Node.js，但无法读取版本：$($_.Exception.Message)" 11
}

if (-not $NodeVersion) {
    Fail '[ERROR] 无法读取 Node.js 版本。' 12
}

$NodeMajor = 0
if (-not [int]::TryParse(($NodeVersion -split '\.')[0], [ref]$NodeMajor)) {
    Fail "[ERROR] 无法解析 Node.js 版本：$NodeVersion" 13
}

Write-Host "Node.js: $NodeExe"
Write-Host "版本: v$NodeVersion"

if ($NodeMajor -lt 22) {
    Fail "[ERROR] 当前项目使用 node:sqlite，需要 Node.js 22+。当前版本：v$NodeVersion" 14
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules'))) {
    Write-Host 'node_modules 不存在，正在安装依赖...' -ForegroundColor Yellow
    $npmCandidates = @()
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCommand -and $npmCommand.Source) { $npmCandidates += $npmCommand.Source }
    $npmCandidates += (Join-Path (Split-Path -Parent $NodeExe) 'npm.cmd')
    $NpmExe = $npmCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $NpmExe) {
        Fail '[ERROR] 未找到 npm.cmd，无法安装依赖。' 15
    }
    & $NpmExe ci
    if ($LASTEXITCODE -ne 0) {
        Fail '[ERROR] npm ci 执行失败。' 16
    }
}

Write-Host '检查5177端口...' -ForegroundColor Cyan
try {
    $listeners = Get-NetTCPConnection -LocalPort 5177 -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        if ($listener.OwningProcess -and $listener.OwningProcess -ne $PID) {
            Write-Host "停止旧5177监听进程 PID $($listener.OwningProcess)..." -ForegroundColor Yellow
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Host '端口预清理未完成，将继续尝试启动。' -ForegroundColor Yellow
}

Start-Sleep -Seconds 1

$LogDir = Join-Path $ProjectRoot 'logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$LogFile = Join-Path $LogDir 'startup_latest.log'

Write-Host ''
Write-Host '===============================================' -ForegroundColor Green
Write-Host "本机访问: http://127.0.0.1:5177" -ForegroundColor Green
Write-Host "启动日志: $LogFile"
Write-Host '使用系统期间请保持此窗口开启。' -ForegroundColor Yellow
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
Write-Host "[ERROR] CE QC 后台已停止，退出码：$ExitCode" -ForegroundColor Red
Write-Host '最近启动日志：' -ForegroundColor Yellow
if (Test-Path -LiteralPath $LogFile) {
    Get-Content -LiteralPath $LogFile -Tail 80 -ErrorAction SilentlyContinue
}
Write-Host ''
Read-Host '按Enter退出'
exit $ExitCode
