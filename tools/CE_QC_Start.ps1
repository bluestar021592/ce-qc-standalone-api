$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = 'CE 质控APP启动'

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
    throw "Git 命令失败：git $($Arguments -join ' ')"
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

Write-Section 'CE 质控APP · 一键更新并启动'
Write-Host "项目目录：$ProjectRoot"
Write-Host '规则：每次启动先安全同步 GitHub main，再启动本地质控系统。' -ForegroundColor DarkGray

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw '未检测到 Git，无法自动同步 GitHub。'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '未检测到 Node.js，无法启动 CE 质控APP。'
}

Write-Host ''
Write-Host '① 检查 GitHub 最新版本...' -ForegroundColor Yellow
$LocalHead = (& git rev-parse HEAD).Trim()
$FetchCode = Run-Git @('fetch','origin','main') -AllowFailure
if ($FetchCode -eq 0) {
  $RemoteHead = (& git rev-parse origin/main).Trim()
  Write-Host "当前本机：$LocalHead"
  Write-Host "GitHub main：$RemoteHead"

  if ($LocalHead -ne $RemoteHead) {
    $BackupBranch = "local-backup-before-ce-qc-start-$TimeStamp"
    Run-Git @('branch',$BackupBranch,$LocalHead) | Out-Null
    Write-Host "已建立安全备份分支：$BackupBranch" -ForegroundColor DarkYellow

    $Dirty = @(& git status --porcelain)
    if ($Dirty.Count -gt 0) {
      Run-Git @('stash','push','-u','-m',"CE-QC auto backup $TimeStamp") | Out-Null
      Write-Host '检测到本地未提交文件，已安全放入 Git stash；不会删除 SQLite/.env/Token/Cookie/backups。' -ForegroundColor DarkYellow
    }

    $DependencyDiff = @(& git diff --name-only $LocalHead $RemoteHead -- package.json package-lock.json)
    $DependenciesChanged = $DependencyDiff.Count -gt 0

    Run-Git @('switch','main') | Out-Null
    Run-Git @('reset','--hard','origin/main') | Out-Null
    $Updated = $true
    Write-Host 'GitHub main 同步完成。' -ForegroundColor Green
  }
  else {
    Write-Host '已经是 GitHub 最新版本。' -ForegroundColor Green
  }
}
else {
  Write-Host 'GitHub 当前无法连接，将使用本机现有版本启动；不会影响数据库。' -ForegroundColor Yellow
}

if ($Updated -and $DependenciesChanged) {
  Write-Host ''
  Write-Host '② 检测到依赖变化，正在安全更新 node_modules...' -ForegroundColor Yellow
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败。' }
}
elif (-not (Test-Path (Join-Path $ProjectRoot 'node_modules'))) {
  Write-Host ''
  Write-Host '② 首次运行，正在安装依赖...' -ForegroundColor Yellow
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败。' }
}
else {
  Write-Host '② node_modules 已存在，无需重复安装。' -ForegroundColor Green
}

Write-Host ''
Write-Host "③ 检查端口 $Port..." -ForegroundColor Yellow
try {
  $Listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($Listener in $Listeners) {
    $Pid = [int]$Listener.OwningProcess
    if ($Pid -le 0) { continue }
    $Info = Get-CimInstance Win32_Process -Filter "ProcessId=$Pid" -ErrorAction SilentlyContinue
    $CommandLine = [string]$Info.CommandLine
    if ($CommandLine -match 'bootstrap\.js|server\.js|ce-qc-standalone-api') {
      Write-Host "停止旧 CE QC 后台 PID $Pid..." -ForegroundColor DarkYellow
      Stop-Process -Id $Pid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 700
    }
  }
}
catch {
  Write-Host '端口检查未完全执行，将继续尝试启动。' -ForegroundColor DarkYellow
}

Write-Host ''
Write-Host '④ 启动 CE 质控APP 后台...' -ForegroundColor Yellow
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
    throw "CE QC 后台启动失败，Node 进程已退出（ExitCode=$($Backend.ExitCode)）。"
  }
  throw "CE QC 后台已启动，但 $Url 在等待时间内没有响应。"
}

Write-Host ''
Write-Host '⑤ 打开 CE 质控APP...' -ForegroundColor Yellow
Start-Process $Url

Write-Section 'CE 质控APP 已启动'
$CurrentHead = (& git rev-parse HEAD).Trim()
Write-Host "当前版本：$CurrentHead" -ForegroundColor Green
Write-Host "访问地址：$Url" -ForegroundColor Green
Write-Host '以后只需要点击桌面上的“CE 质控APP启动”即可。' -ForegroundColor Cyan
Write-Host '每次点击都会先检查 GitHub 更新；数据库、.env、Token/Cookie、backups 不会因为同步而清理。' -ForegroundColor DarkGray
Start-Sleep -Seconds 3
