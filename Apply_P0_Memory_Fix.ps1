$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$PackageRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ProjectRoot = Split-Path -Parent $PackageRoot
$Target = Join-Path $ProjectRoot "src\snapshots.js"
$Patch = Join-Path $PackageRoot "01_补丁文件\snapshots.js"
$ExpectedOriginal = "9f45fce81e87ceb8906db873baff00f27bdba2e1578d88a95b1cda38e861e7f1"
$ExpectedPatched = "8e55ddeb61b0ee04d9c6ab6e72b55e1d0f4861f10a26ad581d3ddd50d98a7f15"

function Sha($path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }

Write-Host ""
Write-Host "==== CE QC P0 Snapshot Memory Fix ====" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json"))) {
    throw "package.json not found. Put the whole patch folder inside the ce-qc-standalone-api project root."
}
if (-not (Test-Path -LiteralPath $Target)) { throw "src\snapshots.js not found" }
if (-not (Test-Path -LiteralPath $Patch)) { throw "Patch snapshots.js not found" }

$current = Sha $Target
Write-Host "Current snapshots.js SHA256: $current"

if ($current -eq $ExpectedPatched) {
    Write-Host "Already patched." -ForegroundColor Green
    Read-Host "Press Enter to exit"
    exit 0
}
if ($current -ne $ExpectedOriginal) {
    Write-Host ""
    Write-Host "SAFETY STOP: current snapshots.js differs from the version uploaded to ChatGPT." -ForegroundColor Red
    Write-Host "Expected: $ExpectedOriginal" -ForegroundColor Yellow
    Write-Host "Actual:   $current" -ForegroundColor Yellow
    Write-Host "No file or database was modified." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 3
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$backupRoot = Join-Path $ProjectRoot ("_PATCH_BACKUP_snapshot_memory_" + $ts)
$backupSrc = Join-Path $backupRoot "src"
New-Item -ItemType Directory -Path $backupSrc -Force | Out-Null
Copy-Item -LiteralPath $Target -Destination (Join-Path $backupSrc "snapshots.js") -Force

$stateDir = Join-Path $ProjectRoot "_PATCH_STATE"
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
Set-Content -LiteralPath (Join-Path $stateDir "last_snapshot_memory_backup.txt") -Value $backupRoot -Encoding UTF8

Copy-Item -LiteralPath $Patch -Destination $Target -Force

$after = Sha $Target
if ($after -ne $ExpectedPatched) {
    Copy-Item -LiteralPath (Join-Path $backupSrc "snapshots.js") -Destination $Target -Force
    throw "SHA verification failed after copy. Original file restored."
}

& node --check $Target
if ($LASTEXITCODE -ne 0) {
    Copy-Item -LiteralPath (Join-Path $backupSrc "snapshots.js") -Destination $Target -Force
    throw "Node syntax check failed. Original file restored."
}

Write-Host ""
Write-Host "Patch installed successfully." -ForegroundColor Green
Write-Host "Backup: $backupRoot" -ForegroundColor Green
Write-Host "Database was not modified." -ForegroundColor Yellow
Write-Host "Next: run your original Start_CE_QC." -ForegroundColor Cyan
Read-Host "Press Enter to exit"
