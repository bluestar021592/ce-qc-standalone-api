$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
Set-Location -LiteralPath $ProjectRoot

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$out = Join-Path $ProjectRoot "_CE_QC_CORE_SOURCE_$ts"
New-Item -ItemType Directory -Path $out -Force | Out-Null

$wanted = @(
    "package.json",
    "package-lock.json",
    "server.js",
    "src\snapshots.js",
    "src\store.js",
    "src\pipeline.js",
    "src\ceClient.js",
    "src\trackBatching.js",
    "public\app.js"
)

$copied = @()
$missing = @()

foreach ($rel in $wanted) {
    $src = Join-Path $ProjectRoot $rel
    if (Test-Path -LiteralPath $src) {
        $dest = Join-Path $out $rel
        $destDir = Split-Path -Parent $dest
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        Copy-Item -LiteralPath $src -Destination $dest -Force
        $copied += $rel
    } else {
        $missing += $rel
    }
}

# Add startup scripts if present.
Get-ChildItem -LiteralPath $ProjectRoot -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^(?i)Start_CE_QC.*\.(cmd|bat|vbs|ps1)$|^(?i)启动CE质控.*\.bat$' } |
    ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $out $_.Name) -Force
        $copied += $_.Name
    }

# Include only small text logs relevant to the crash.
$logNames = @("server-error.log","server-output.log","server-stderr.log","server-stdout.log","startup_latest.log")
foreach ($name in $logNames) {
    $src = Join-Path $ProjectRoot ("logs\" + $name)
    if (Test-Path -LiteralPath $src) {
        $logDir = Join-Path $out "logs"
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        Get-Content -LiteralPath $src -Tail 1000 |
            Out-File -FilePath (Join-Path $logDir $name) -Encoding utf8
    }
}

@"
CE QC 核心故障源码包
生成时间: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

已复制:
$($copied -join "`r`n")

未找到:
$($missing -join "`r`n")

本包没有包含：
- SQLite数据库
- .env
- Token/Cookie
- node_modules
- exports/backups
- 大型业务数据

用途：
修复 createDashboardSnapshot / JSON.stringify / Node heap out of memory / 5177后台崩溃。
"@ | Out-File -FilePath (Join-Path $out "README_请上传给ChatGPT.txt") -Encoding utf8

$zip = "$out.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $out "*") -DestinationPath $zip -CompressionLevel Optimal

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "核心源码包已生成：" -ForegroundColor Green
Write-Host $zip -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "把这个ZIP上传到当前ChatGPT对话。" -ForegroundColor Yellow
Read-Host "按Enter退出"
