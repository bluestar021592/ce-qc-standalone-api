$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Patch = Join-Path $ScriptDir "snapshots.patched.js"

$ExpectedOriginal = "9f45fce81e87ceb8906db873baff00f27bdba2e1578d88a95b1cda38e861e7f1"
$ExpectedPatched = "8e55ddeb61b0ee04d9c6ab6e72b55e1d0f4861f10a26ad581d3ddd50d98a7f15"

function Sha([string]$path) {
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function IsProjectRoot([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return $false }
    try {
        return (Test-Path -LiteralPath (Join-Path $path "package.json")) -and
               (Test-Path -LiteralPath (Join-Path $path "src\snapshots.js"))
    } catch {
        return $false
    }
}

function FindProjectRoot {
    $candidates = New-Object System.Collections.Generic.List[string]

    # 1. Script directory and parents
    $current = $ScriptDir
    for ($i = 0; $i -lt 6; $i++) {
        if (-not [string]::IsNullOrWhiteSpace($current)) {
            $candidates.Add($current)
            try {
                $parent = Split-Path -Parent $current
                if ($parent -eq $current -or [string]::IsNullOrWhiteSpace($parent)) { break }
                $current = $parent
            } catch { break }
        }
    }

    # 2. Known production location from this machine
    $known = "C:\Users\CELNT-EE-097\Documents\CE CCSL 质控研发APP\ce-qc-standalone-api"
    $candidates.Add($known)

    # 3. Current user's Documents common locations
    $userProfile = $env:USERPROFILE
    if ($userProfile) {
        $docs = Join-Path $userProfile "Documents"
        if (Test-Path -LiteralPath $docs) {
            $candidates.Add((Join-Path $docs "CE CCSL 质控研发APP\ce-qc-standalone-api"))
        }
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (IsProjectRoot $candidate) {
            return [System.IO.Path]::GetFullPath($candidate).TrimEnd('\')
        }
    }

    # 4. Last resort: ask user to paste the real project path
    Write-Host ""
    Write-Host "Automatic project detection failed." -ForegroundColor Yellow
    Write-Host "Please paste the folder that contains package.json and src\snapshots.js." -ForegroundColor Yellow
    $manual = Read-Host "Project folder"
    if (IsProjectRoot $manual) {
        return [System.IO.Path]::GetFullPath($manual).TrimEnd('\')
    }

    throw "Could not locate the CE QC project root."
}

Write-Host ""
Write-Host "==== CE QC P0 Memory Fix V2 ====" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $Patch)) {
    throw "Patch file snapshots.patched.js is missing beside this installer."
}

$ProjectRoot = FindProjectRoot
$Target = Join-Path $ProjectRoot "src\snapshots.js"

Write-Host "Project found:" -ForegroundColor Green
Write-Host $ProjectRoot -ForegroundColor Green
Write-Host ""

$currentSha = Sha $Target
Write-Host "Current snapshots.js SHA256:"
Write-Host $currentSha

if ($currentSha -eq $ExpectedPatched) {
    Write-Host ""
    Write-Host "This project is already using the patched snapshots.js." -ForegroundColor Green
    Read-Host "Press Enter to exit"
    exit 0
}

if ($currentSha -ne $ExpectedOriginal) {
    Write-Host ""
    Write-Host "SAFETY STOP." -ForegroundColor Red
    Write-Host "The current snapshots.js is not the exact version previously uploaded to ChatGPT." -ForegroundColor Yellow
    Write-Host "Expected original: $ExpectedOriginal"
    Write-Host "Actual current:    $currentSha"
    Write-Host ""
    Write-Host "Nothing was changed. Database was not touched." -ForegroundColor Yellow
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

$afterSha = Sha $Target
if ($afterSha -ne $ExpectedPatched) {
    Copy-Item -LiteralPath (Join-Path $backupSrc "snapshots.js") -Destination $Target -Force
    throw "Patch SHA verification failed. The original file was restored."
}

Write-Host ""
Write-Host "Running Node syntax check..." -ForegroundColor Cyan
& node --check $Target
if ($LASTEXITCODE -ne 0) {
    Copy-Item -LiteralPath (Join-Path $backupSrc "snapshots.js") -Destination $Target -Force
    throw "Node syntax check failed. The original file was restored."
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "P0 memory patch installed successfully." -ForegroundColor Green
Write-Host "Backup:" -ForegroundColor Green
Write-Host $backupRoot -ForegroundColor Green
Write-Host ""
Write-Host "No SQLite database or business data was modified." -ForegroundColor Yellow
Write-Host "Next: start CE QC using your normal Start_CE_QC launcher." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
Read-Host "Press Enter to exit"
