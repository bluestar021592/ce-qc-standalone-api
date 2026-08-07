$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageRoot = Split-Path -Parent $ScriptDir
$Patch = Join-Path $PackageRoot "01_补丁\app.js"

$ExpectedOriginal = "295dd1c1ebb69ac0910d9756024456aa65ce42c55277edd10843bf58cfa014cd"
$ExpectedPatched = "b0ee8eddad73d9d9403a194c53fb8d6ea28e7ad59a165a56324fcb34bc34f57e"

function Sha([string]$p) {
    return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
}
function IsRoot([string]$p) {
    if ([string]::IsNullOrWhiteSpace($p)) { return $false }
    try {
        return (Test-Path -LiteralPath (Join-Path $p "package.json")) -and
               (Test-Path -LiteralPath (Join-Path $p "public\app.js"))
    } catch { return $false }
}
function FindRoot {
    $known = "C:\Users\CELNT-EE-097\Documents\CE CCSL 质控研发APP\ce-qc-standalone-api"
    if (IsRoot $known) { return $known }
    $candidate = Join-Path $env:USERPROFILE "Documents\CE CCSL 质控研发APP\ce-qc-standalone-api"
    if (IsRoot $candidate) { return $candidate }
    $manual = Read-Host "Paste CE QC project folder"
    if (IsRoot $manual) { return $manual }
    throw "CE QC project root not found."
}

Write-Host ""
Write-Host "==== CE QC P1 Frontend Connection Fix ====" -ForegroundColor Cyan
$root = [System.IO.Path]::GetFullPath((FindRoot)).TrimEnd('\')
$target = Join-Path $root "public\app.js"
Write-Host "Project:" -ForegroundColor Green
Write-Host $root -ForegroundColor Green

$current = Sha $target
Write-Host ""
Write-Host "Current app.js SHA256:"
Write-Host $current

if ($current -eq $ExpectedPatched) {
    Write-Host "Already patched." -ForegroundColor Green
    Read-Host "Press Enter to exit"
    exit 0
}

if ($current -ne $ExpectedOriginal) {
    Write-Host ""
    Write-Host "SAFETY STOP: current public/app.js differs from the version uploaded to ChatGPT." -ForegroundColor Red
    Write-Host "Expected: $ExpectedOriginal" -ForegroundColor Yellow
    Write-Host "Actual:   $current" -ForegroundColor Yellow
    Write-Host "No file or database was modified." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 3
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $root ("_PATCH_BACKUP_frontend_connection_" + $ts)
New-Item -ItemType Directory -Path (Join-Path $backup "public") -Force | Out-Null
Copy-Item -LiteralPath $target -Destination (Join-Path $backup "public\app.js") -Force

$stateDir = Join-Path $root "_PATCH_STATE"
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
Set-Content -LiteralPath (Join-Path $stateDir "last_frontend_connection_backup.txt") -Value $backup -Encoding UTF8

Copy-Item -LiteralPath $Patch -Destination $target -Force

if ((Sha $target) -ne $ExpectedPatched) {
    Copy-Item -LiteralPath (Join-Path $backup "public\app.js") -Destination $target -Force
    throw "SHA verification failed. Original app.js restored."
}

& node --check $target
if ($LASTEXITCODE -ne 0) {
    Copy-Item -LiteralPath (Join-Path $backup "public\app.js") -Destination $target -Force
    throw "Node syntax check failed. Original app.js restored."
}

Write-Host ""
Write-Host "P1 frontend fix installed successfully." -ForegroundColor Green
Write-Host "Backup:" -ForegroundColor Green
Write-Host $backup -ForegroundColor Green
Write-Host ""
Write-Host "Database and business data were not modified." -ForegroundColor Yellow
Write-Host "Now press Ctrl+F5 in the browser and reopen /settings and /logs." -ForegroundColor Cyan
Read-Host "Press Enter to exit"
