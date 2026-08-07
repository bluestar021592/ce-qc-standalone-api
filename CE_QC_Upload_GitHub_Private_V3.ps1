$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Step([string]$Text) {
    Write-Host ""
    Write-Host "==== $Text ====" -ForegroundColor Cyan
}

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

Step "检查项目目录"
Write-Host "项目目录: $ProjectRoot"

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json")) -and
    -not (Test-Path -LiteralPath (Join-Path $ProjectRoot "server.js"))) {
    Write-Host "[错误] 当前目录没有 package.json 或 server.js。" -ForegroundColor Red
    Read-Host "按Enter退出"
    exit 1
}

Step "检查Git"
if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    Write-Host "未检测到Git for Windows。" -ForegroundColor Red
    Read-Host "按Enter退出"
    exit 2
}
git --version

Step "写入安全.gitignore"
Copy-Item -LiteralPath (Join-Path $ProjectRoot ".gitignore.ce-qc") `
          -Destination (Join-Path $ProjectRoot ".gitignore") -Force

Step "初始化/继续Git仓库"
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot ".git"))) {
    git init
    git branch -M main
} else {
    Write-Host "当前项目已有Git仓库，继续使用。" -ForegroundColor Yellow
}

Step "输入GitHub私有仓库地址"
$repoUrl = (Read-Host "粘贴HTTPS仓库地址").Trim()

if ($repoUrl -notmatch '^https://github\.com/[^/]+/[^/]+?(\.git)?$') {
    Write-Host "仓库地址格式不正确。" -ForegroundColor Red
    Read-Host "按Enter退出"
    exit 3
}

$existingOrigin = $null
try { $existingOrigin = (git remote get-url origin 2>$null) } catch {}
if ($existingOrigin) {
    git remote set-url origin $repoUrl
} else {
    git remote add origin $repoUrl
}

Step "暂存源码"
git add .
if ($LASTEXITCODE -ne 0) { throw "git add失败" }

$staged = @(git diff --cached --name-only)

# 安全校验：
# 允许 .env.example / .env.*.example
# 禁止真实 .env / .env.local / .env.production 等
$unsafe = @($staged | Where-Object {
    $p = $_.Replace('\','/')

    $isAllowedEnvExample =
        $p -match '(^|/)\.env\.example$' -or
        $p -match '(^|/)\.env\..+\.example$'

    $isRealEnv =
        $p -match '(^|/)\.env$' -or
        ($p -match '(^|/)\.env\.' -and -not $isAllowedEnvExample)

    $isSensitiveName =
        $p -match '(?i)(^|/)(token|tokens|cookie|cookies|credentials?|secrets?)(\.|/|$)'

    $isSensitiveExtension =
        $p -match '(?i)\.(db|sqlite|sqlite3|pem|key|pfx|p12)$'

    return ($isRealEnv -or $isSensitiveName -or $isSensitiveExtension)
})

if ($unsafe.Count -gt 0) {
    git reset
    Write-Host "检测到不应上传的真实敏感文件，已取消暂存：" -ForegroundColor Red
    $unsafe | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host ".env.example属于允许上传的示例文件，不会再误判。" -ForegroundColor Yellow
    Read-Host "按Enter退出"
    exit 4
}

Write-Host ("准备上传源码文件数: {0}" -f $staged.Count) -ForegroundColor Green

Step "配置Git提交身份"
$name = git config user.name
if (-not $name) {
    $name = Read-Host "输入Git提交用户名（例如 Lee）"
    git config user.name "$name"
}
$email = git config user.email
if (-not $email) {
    $email = Read-Host "输入GitHub邮箱"
    git config user.email "$email"
}

Step "提交源码"
if ($staged.Count -gt 0) {
    git commit -m "Import CE QC source code for ChatGPT development"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "git commit失败，请截图发给ChatGPT。" -ForegroundColor Red
        Read-Host "按Enter退出"
        exit 5
    }
} else {
    Write-Host "没有新的源码需要提交。" -ForegroundColor Yellow
}

Step "推送GitHub"
Write-Host "如弹出GitHub网页登录窗口，请正常登录授权。" -ForegroundColor Yellow
git push -u origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "推送失败，请把当前窗口截图发给ChatGPT。" -ForegroundColor Red
    Read-Host "按Enter退出"
    exit 6
}

Step "完成"
Write-Host "源码已成功上传GitHub私有仓库：" -ForegroundColor Green
Write-Host $repoUrl -ForegroundColor Green
Write-Host ""
Write-Host "正式数据库、.env、Token、Cookie、node_modules、日志和备份均未上传。" -ForegroundColor Yellow
Read-Host "按Enter退出"
