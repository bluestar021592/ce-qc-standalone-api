$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Step([string]$Text) {
    Write-Host ""
    Write-Host "==== $Text ====" -ForegroundColor Cyan
}

$ScriptFile = $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptFile
Set-Location -LiteralPath $ProjectRoot

Step "检查项目目录"
Write-Host "项目目录: $ProjectRoot"

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json")) -and
    -not (Test-Path -LiteralPath (Join-Path $ProjectRoot "server.js"))) {
    Write-Host ""
    Write-Host "[错误] 当前目录没有 package.json 或 server.js。" -ForegroundColor Red
    Write-Host "请把本工具的3个文件复制到真正的 ce-qc-standalone-api 项目根目录。" -ForegroundColor Yellow
    Read-Host "按Enter退出"
    exit 1
}

Step "检查Git"
$git = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Host "没有检测到 Git for Windows。" -ForegroundColor Red
    Write-Host "请先安装Git，然后重新运行。" -ForegroundColor Yellow
    Start-Process "https://git-scm.com/download/win"
    Read-Host "按Enter退出"
    exit 2
}
git --version

Step "写入安全.gitignore"
$ignoreSource = Join-Path $ProjectRoot ".gitignore.ce-qc"
$ignoreTarget = Join-Path $ProjectRoot ".gitignore"
Copy-Item -LiteralPath $ignoreSource -Destination $ignoreTarget -Force

Step "检查被排除的大文件和敏感文件"
$danger = Get-ChildItem -LiteralPath $ProjectRoot -File -Recurse -Force |
    Where-Object {
        $_.FullName -notmatch "\\node_modules\\" -and
        $_.FullName -notmatch "\\.git\\" -and
        (
            $_.Length -gt 90MB -or
            $_.Name -match '^(?i)\.env' -or
            $_.Name -match '(?i)(token|cookie|credential|secret)' -or
            $_.Extension -in @(".db",".sqlite",".sqlite3",".pem",".key",".pfx",".p12")
        )
    } |
    Sort-Object Length -Descending

if ($danger.Count -gt 0) {
    Write-Host "以下文件不会上传到GitHub：" -ForegroundColor Yellow
    foreach ($f in $danger) {
        $rel = $f.FullName.Substring($ProjectRoot.Length).TrimStart('\')
        $mb = [Math]::Round($f.Length / 1MB, 2)
        Write-Host ("  {0}  ({1} MB)" -f $rel, $mb)
    }
}

Step "初始化Git仓库"
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot ".git"))) {
    git init
    if ($LASTEXITCODE -ne 0) { throw "git init失败" }
    git branch -M main
} else {
    Write-Host "当前项目已有Git仓库，继续使用。" -ForegroundColor Yellow
}

Step "输入GitHub私有仓库地址"
Write-Host "请先在GitHub创建一个Private私有仓库。" -ForegroundColor Yellow
Write-Host "建议仓库名：ce-qc-standalone-api" -ForegroundColor Yellow
Write-Host "新仓库最好不要初始化README / License / .gitignore。" -ForegroundColor Yellow
Write-Host ""

$repoUrl = (Read-Host "粘贴HTTPS仓库地址").Trim()

if ($repoUrl -notmatch '^https://github\.com/[^/]+/[^/]+?(\.git)?$') {
    Write-Host "仓库地址格式不正确，例如：" -ForegroundColor Red
    Write-Host "https://github.com/用户名/ce-qc-standalone-api.git"
    Read-Host "按Enter退出"
    exit 3
}

Step "配置origin"
$existingOrigin = $null
try { $existingOrigin = (git remote get-url origin 2>$null) } catch {}
if ($existingOrigin) {
    Write-Host "原origin: $existingOrigin" -ForegroundColor Yellow
    git remote set-url origin $repoUrl
} else {
    git remote add origin $repoUrl
}

Step "暂存源码"
git add .
if ($LASTEXITCODE -ne 0) { throw "git add失败" }

$staged = @(git diff --cached --name-only)
$unsafe = @($staged | Where-Object {
    $_ -match '(^|/)\.env($|\.)' -or
    $_ -match '(?i)(token|cookie|credential|secret)' -or
    $_ -match '(?i)\.(db|sqlite|sqlite3|pem|key|pfx|p12)$'
})

if ($unsafe.Count -gt 0) {
    git reset
    Write-Host "检测到不应上传的文件，已取消暂存：" -ForegroundColor Red
    $unsafe | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
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
        Write-Host "git commit未成功，请把窗口截图发给ChatGPT。" -ForegroundColor Red
        Read-Host "按Enter退出"
        exit 5
    }
} else {
    Write-Host "没有新文件需要提交。" -ForegroundColor Yellow
}

Step "推送GitHub"
Write-Host "如果弹出GitHub登录窗口，请正常登录。" -ForegroundColor Yellow
git push -u origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[推送失败]" -ForegroundColor Red
    Write-Host "请不要乱执行其他Git命令。" -ForegroundColor Yellow
    Write-Host "把当前整个窗口截图发给ChatGPT，我继续判断。" -ForegroundColor Yellow
    Read-Host "按Enter退出"
    exit 6
}

Step "完成"
Write-Host "源码已成功上传GitHub私有仓库：" -ForegroundColor Green
Write-Host $repoUrl -ForegroundColor Green
Write-Host ""
Write-Host "正式数据库、node_modules、日志、备份、.env和Token均未上传。" -ForegroundColor Yellow
Write-Host ""
Write-Host "现在回ChatGPT，把仓库链接发给我。" -ForegroundColor Cyan
Read-Host "按Enter退出"
