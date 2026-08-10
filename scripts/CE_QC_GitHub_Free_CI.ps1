param(
  [string]$Repository = 'bluestar021592/ce-qc-standalone-api',
  [string]$Workflow = 'final-system-regression.yml',
  [string]$Ref = 'main'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$Text) {
  Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Resolve-GhCli {
  $command = Get-Command gh -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    "$env:ProgramFiles\GitHub CLI\gh.exe",
    "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw '未找到 GitHub CLI (gh)，并且当前电脑没有 winget。请先安装 GitHub CLI 后重新运行。'
  }

  Write-Step '首次运行：自动安装 GitHub CLI'
  & $winget.Source install --id GitHub.cli -e --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI 安装失败，退出码：$LASTEXITCODE"
  }

  $command = Get-Command gh -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw 'GitHub CLI 已安装，但当前进程未找到 gh.exe。请关闭窗口后重新双击 BAT。'
}

function Get-RepoVisibility([string]$GhPath) {
  $value = & $GhPath repo view $Repository --json visibility --jq '.visibility' 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "无法读取仓库可见性：$($value -join ' ')"
  }
  return (($value -join '').Trim().ToLowerInvariant())
}

function Set-RepoVisibility([string]$GhPath, [string]$Visibility) {
  Write-Host "切换仓库为 $Visibility ..." -ForegroundColor Yellow
  $output = & $GhPath repo edit $Repository --visibility $Visibility --accept-visibility-change-consequences 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "仓库可见性切换为 $Visibility 失败：$($output -join ' ')"
  }

  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2
    if ((Get-RepoVisibility $GhPath) -eq $Visibility) { return }
  }
  throw "GitHub 未在预期时间内确认仓库已切换为 $Visibility。"
}

function Get-LatestDispatchRunId([string]$GhPath) {
  $result = & $GhPath run list -R $Repository --workflow $Workflow --branch $Ref --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // ""' 2>&1
  if ($LASTEXITCODE -ne 0) { return '' }
  return (($result -join '').Trim())
}

$gh = Resolve-GhCli
$originalVisibility = ''
$madePublic = $false
$runId = ''
$ciExitCode = 1
$finalError = $null

try {
  Write-Step '检查 GitHub 登录'
  & $gh auth status -h github.com *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host '首次运行需要登录一次 GitHub。浏览器会自动打开，登录完成后脚本继续。' -ForegroundColor Yellow
    & $gh auth login --hostname github.com --git-protocol https --web
    if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI 登录失败。' }
  }

  Write-Step '检查仓库当前状态'
  $originalVisibility = Get-RepoVisibility $gh
  Write-Host "仓库：$Repository"
  Write-Host "原始可见性：$originalVisibility"

  if ($originalVisibility -ne 'public') {
    Write-Step '临时切换 Public，使用免费的标准 GitHub-hosted runner'
    Set-RepoVisibility $gh 'public'
    $madePublic = $true
  } else {
    Write-Host '仓库本来就是 Public，不需要切换。' -ForegroundColor Green
  }

  Write-Step '触发最终系统回归测试'
  $beforeRunId = Get-LatestDispatchRunId $gh
  $triggerOutput = & $gh workflow run $Workflow -R $Repository --ref $Ref 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "无法触发 workflow：$($triggerOutput -join ' ')"
  }
  if ($triggerOutput) { $triggerOutput | ForEach-Object { Write-Host $_ } }

  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    $candidate = Get-LatestDispatchRunId $gh
    if ($candidate -and $candidate -ne $beforeRunId) {
      $runId = $candidate
      break
    }
  }
  if (-not $runId) {
    throw '已发送 workflow_dispatch，但90秒内没有找到新的 Actions Run。'
  }

  Write-Host "Actions Run ID：$runId" -ForegroundColor Green
  Write-Step '等待 CI 完成'
  & $gh run watch $runId -R $Repository --compact --exit-status
  $ciExitCode = $LASTEXITCODE

  if ($ciExitCode -eq 0) {
    Write-Host "`n最终 CI：全部通过。" -ForegroundColor Green
  } else {
    Write-Host "`n最终 CI：有测试失败。下面输出失败日志。" -ForegroundColor Red
    & $gh run view $runId -R $Repository --log-failed
  }
}
catch {
  $finalError = $_
  Write-Host "`n免费 CI 流程发生错误：$($_.Exception.Message)" -ForegroundColor Red
}
finally {
  if ($madePublic) {
    try {
      Write-Step '恢复仓库 Private'
      Set-RepoVisibility $gh 'private'
      Write-Host '仓库已恢复 Private。' -ForegroundColor Green
    }
    catch {
      Write-Host "严重提示：自动恢复 Private 失败：$($_.Exception.Message)" -ForegroundColor Red
      Write-Host "请立即进入 GitHub Settings -> Danger Zone 手动改回 Private。" -ForegroundColor Red
      if (-not $finalError) { $finalError = $_ }
    }
  }
}

if ($finalError) { exit 2 }
if ($ciExitCode -ne 0) { exit 1 }
exit 0
