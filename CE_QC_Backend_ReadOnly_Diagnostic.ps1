$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
Set-Location -LiteralPath $ProjectRoot

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$out = Join-Path $ProjectRoot "_CE_QC_DIAG_$ts"
New-Item -ItemType Directory -Path $out -Force | Out-Null
$report = Join-Path $out "诊断报告.txt"

function Add-Line([string]$Text="") {
    $Text | Out-File -FilePath $report -Append -Encoding utf8
}
function Section([string]$Title) {
    Add-Line ""
    Add-Line ("=" * 72)
    Add-Line $Title
    Add-Line ("=" * 72)
    Write-Host ""
    Write-Host "==== $Title ====" -ForegroundColor Cyan
}
function Safe-Run([string]$Label, [scriptblock]$Block) {
    Add-Line ""
    Add-Line ("--- " + $Label + " ---")
    try {
        $result = & $Block 2>&1 | Out-String
        if ([string]::IsNullOrWhiteSpace($result)) { $result = "(no output)" }
        Add-Line $result.TrimEnd()
        return $result
    } catch {
        $msg = "ERROR: " + $_.Exception.Message
        Add-Line $msg
        return $msg
    }
}

Add-Line "CE QC 后台连接只读诊断"
Add-Line ("时间: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Add-Line ("项目目录: " + $ProjectRoot)
Add-Line "说明: 本工具只读取状态，不修改代码、不删除文件、不修改SQLite。"

Section "1. 项目根目录确认"
Safe-Run "根目录文件" {
    Get-ChildItem -LiteralPath $ProjectRoot -Force |
      Select-Object Name,Length,LastWriteTime |
      Format-Table -AutoSize
}

Section "2. Node / NPM"
Safe-Run "node -v" { node -v }
Safe-Run "npm -v" { npm -v }
Safe-Run "where node" { where.exe node }
Safe-Run "where npm" { where.exe npm }

Section "3. package.json 启动脚本"
$package = Join-Path $ProjectRoot "package.json"
if (Test-Path -LiteralPath $package) {
    Copy-Item -LiteralPath $package -Destination (Join-Path $out "package.json") -Force
    Safe-Run "package.json scripts" {
        $p = Get-Content -LiteralPath $package -Raw | ConvertFrom-Json
        $p.scripts | ConvertTo-Json -Depth 10
    }
} else {
    Add-Line "未找到 package.json"
}

Section "4. 5177端口与Node进程"
$netstatText = Safe-Run "netstat :5177" {
    netstat -ano | Select-String ":5177"
}

$pids = @()
try {
    $pids = netstat -ano |
      Select-String ":5177" |
      ForEach-Object {
        $parts = ($_ -replace '^\s+','') -split '\s+'
        if ($parts.Count -ge 5) { $parts[-1] }
      } |
      Where-Object { $_ -match '^\d+$' } |
      Sort-Object -Unique
} catch {}

if ($pids.Count -eq 0) {
    Add-Line "结论提示: 当前没有检测到5177监听/连接PID。"
} else {
    foreach ($pidValue in $pids) {
        Safe-Run ("PID " + $pidValue + " 进程信息") {
            Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" |
              Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine |
              Format-List
        }
    }
}

Safe-Run "所有node.exe进程" {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine |
      Format-Table -Wrap -AutoSize
}

Section "5. 本地HTTP连通性"
$urls = @(
    "http://127.0.0.1:5177/",
    "http://127.0.0.1:5177/logs",
    "http://127.0.0.1:5177/settings"
)
foreach ($u in $urls) {
    Safe-Run ("HTTP " + $u) {
        try {
            $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 8
            [PSCustomObject]@{
                Url=$u
                StatusCode=[int]$r.StatusCode
                ContentLength=$r.RawContentLength
                ContentType=$r.Headers["Content-Type"]
            } | Format-List
        } catch {
            if ($_.Exception.Response) {
                $resp = $_.Exception.Response
                "HTTP_ERROR StatusCode=$([int]$resp.StatusCode) Url=$u"
            } else {
                "REQUEST_ERROR Url=$u Message=$($_.Exception.Message)"
            }
        }
    }
}

Section "6. 启动日志和运行日志"
$logCandidates = @(
    (Join-Path $ProjectRoot "logs\startup_latest.log"),
    (Join-Path $ProjectRoot "startup_latest.log")
)
foreach ($lp in $logCandidates) {
    if (Test-Path -LiteralPath $lp) {
        Safe-Run ("日志尾部: " + $lp) {
            Get-Content -LiteralPath $lp -Tail 250
        }
        Copy-Item -LiteralPath $lp -Destination (Join-Path $out ([IO.Path]::GetFileName($lp))) -Force -ErrorAction SilentlyContinue
    }
}

# Also collect recent *.log, but cap each to last 300 lines.
$recentLogs = Get-ChildItem -LiteralPath $ProjectRoot -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Extension -eq ".log" -and
        $_.FullName -notmatch "\\node_modules\\" -and
        $_.FullName -notmatch "\\_CE_QC_DIAG_"
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 8

foreach ($lf in $recentLogs) {
    $safeName = ($lf.FullName.Substring($ProjectRoot.Length).TrimStart('\') -replace '[\\/:*?"<>|]','_')
    $dest = Join-Path $out ("logtail_" + $safeName + ".txt")
    try { Get-Content -LiteralPath $lf.FullName -Tail 300 | Out-File $dest -Encoding utf8 } catch {}
    Add-Line ("已收集日志尾部: " + $lf.FullName)
}

Section "7. 前端“后台连接中断”提示定位"
$sourceExt = @(".js",".mjs",".cjs",".ts",".tsx",".jsx",".html",".css",".json")
$sourceFiles = Get-ChildItem -LiteralPath $ProjectRoot -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object {
        $sourceExt -contains $_.Extension.ToLowerInvariant() -and
        $_.FullName -notmatch "\\node_modules\\" -and
        $_.FullName -notmatch "\\.git\\" -and
        $_.FullName -notmatch "\\_CE_QC_DIAG_"
    }

$patterns = @(
    "与后台的连接已中断",
    "自动恢复任务状态",
    "Failed to fetch",
    "ECONNREFUSED",
    "ERR_CONNECTION_REFUSED"
)

foreach ($pat in $patterns) {
    Safe-Run ("搜索: " + $pat) {
        $sourceFiles | Select-String -Pattern $pat -SimpleMatch -ErrorAction SilentlyContinue |
          Select-Object Path,LineNumber,Line |
          Format-Table -Wrap -AutoSize
    }
}

Section "8. API地址/硬编码域名检查"
$apiPatterns = @(
    "127.0.0.1:5177",
    "localhost:5177",
    "192.168.",
    "trycloudflare.com",
    "qc.cambodianexpress.com",
    "fetch(",
    "/api/"
)
foreach ($pat in $apiPatterns) {
    Safe-Run ("搜索API相关: " + $pat) {
        $sourceFiles | Select-String -Pattern $pat -SimpleMatch -ErrorAction SilentlyContinue |
          Select-Object Path,LineNumber,Line |
          Select-Object -First 250 |
          Format-Table -Wrap -AutoSize
    }
}

Section "9. 后端路由声明扫描"
Safe-Run "Express路由候选" {
    $backendFiles = $sourceFiles | Where-Object {
        $_.FullName -match "(server|src|routes|api|controller)"
    }
    $backendFiles | Select-String -Pattern '\b(app|router)\.(get|post|put|patch|delete)\s*\(' -AllMatches -ErrorAction SilentlyContinue |
      Select-Object Path,LineNumber,Line |
      Select-Object -First 500 |
      Format-Table -Wrap -AutoSize
}

Section "10. 常见后台异常源码/日志检索"
$errorPatterns = @(
    "SQLITE_ERROR",
    "SQLITE_BUSY",
    "no such column",
    "Cannot read properties of null",
    "toFixed",
    "uncaughtException",
    "unhandledRejection",
    "fetch failed",
    "ECONNREFUSED"
)
$searchFiles = @($sourceFiles) + @($recentLogs)
foreach ($pat in $errorPatterns) {
    Safe-Run ("搜索错误: " + $pat) {
        $searchFiles | Select-String -Pattern $pat -SimpleMatch -ErrorAction SilentlyContinue |
          Select-Object Path,LineNumber,Line |
          Select-Object -First 200 |
          Format-Table -Wrap -AutoSize
    }
}

Section "11. SQLite文件只读清单"
Safe-Run "SQLite文件位置/大小" {
    Get-ChildItem -LiteralPath $ProjectRoot -File -Recurse -Force -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Extension -in @(".db",".sqlite",".sqlite3") -or
        $_.Name -match '\.(db|sqlite|sqlite3)-(wal|shm)$'
      } |
      Where-Object { $_.FullName -notmatch "\\node_modules\\" } |
      Select-Object FullName,Length,LastWriteTime |
      Sort-Object Length -Descending |
      Format-Table -Wrap -AutoSize
}

Section "12. Git状态（只读）"
if (Test-Path -LiteralPath (Join-Path $ProjectRoot ".git")) {
    Safe-Run "git branch/status" {
        git branch --show-current
        git rev-parse HEAD
        git status --short
    }
} else {
    Add-Line "当前目录没有.git"
}

Section "13. 自动初判"
# Re-probe with simple logic
$listener = $false
try {
    $listener = [bool](netstat -ano | Select-String -Pattern ":5177\s+.*LISTENING")
} catch {}

$rootOk = $false
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:5177/" -UseBasicParsing -TimeoutSec 5
    $rootOk = ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
} catch {}

if (-not $listener) {
    Add-Line "P0判断: 5177没有LISTENING。优先检查Start_CE_QC/npm run start/server.js退出原因。"
} elseif (-not $rootOk) {
    Add-Line "P0判断: 5177有监听，但HTTP根页面请求失败。优先检查Node服务是否卡死/代理/请求处理异常。"
} else {
    Add-Line "P0判断: 5177和静态页面可达。问题更可能集中在具体API接口、前端API base URL、SSE/轮询或后端路由异常。"
}
Add-Line "注意: 此判断仅基于只读采集，详细根因需要结合本报告的路由、日志和源码搜索结果。"

# Create a compact index for upload
$summary = Join-Path $out "请上传这个诊断包给ChatGPT.txt"
@"
诊断完成时间: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
项目: $ProjectRoot

请把同目录生成的 ZIP：
$(Split-Path $out -Leaf).zip
上传到ChatGPT。

本工具未修改代码、数据库或配置。
"@ | Out-File $summary -Encoding utf8

# Zip via Compress-Archive
$zip = "$out.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $out "*") -DestinationPath $zip -CompressionLevel Optimal

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "诊断完成，没有修改项目或数据库。" -ForegroundColor Green
Write-Host "请上传这个文件给ChatGPT：" -ForegroundColor Cyan
Write-Host $zip -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Read-Host "按Enter退出"
