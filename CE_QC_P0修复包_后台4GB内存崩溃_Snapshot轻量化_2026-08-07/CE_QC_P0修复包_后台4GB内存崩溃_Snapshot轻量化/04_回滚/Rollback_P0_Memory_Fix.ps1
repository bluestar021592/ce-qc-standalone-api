$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PackageRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ProjectRoot = Split-Path -Parent $PackageRoot
$state = Join-Path $ProjectRoot "_PATCH_STATE\last_snapshot_memory_backup.txt"
if (-not (Test-Path -LiteralPath $state)) { throw "Patch backup record not found." }
$backupRoot = (Get-Content -LiteralPath $state -Raw).Trim()
$source = Join-Path $backupRoot "src\snapshots.js"
$target = Join-Path $ProjectRoot "src\snapshots.js"
if (-not (Test-Path -LiteralPath $source)) { throw "Backup snapshots.js not found." }
Copy-Item -LiteralPath $source -Destination $target -Force
& node --check $target
Write-Host "Original snapshots.js restored." -ForegroundColor Green
Write-Host "Database was not modified." -ForegroundColor Yellow
Read-Host "Press Enter to exit"
