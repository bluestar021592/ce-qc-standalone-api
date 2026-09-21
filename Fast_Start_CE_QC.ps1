$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalUrl = 'http://127.0.0.1:5177'
$RecoveryLaunchMode = ([string]$env:CE_QC_OPEN_PURGE_CONSOLE).Trim() -eq '1'
$LaunchUrl = if ($RecoveryLaunchMode) { "$LocalUrl/purge-console.html?v=20260920-recovery-first" } else { $LocalUrl }

function Test-CeQcAlreadyRunning {
    try {
        $response = Invoke-WebRequest -Uri $LocalUrl -UseBasicParsing -TimeoutSec 1
        $status = [int]$response.StatusCode
        return ($status -ge 200 -and $status -lt 500)
    } catch {
        try {
            if ($_.Exception.Response) {
                $status = [int]$_.Exception.Response.StatusCode
                return ($status -ge 200 -and $status -lt 500)
            }
        } catch {}
        return $false
    }
}

if (Test-CeQcAlreadyRunning) {
    Write-Host '[CE-QC] Backend is already running. Reusing it without restart.' -ForegroundColor Green
    if ($RecoveryLaunchMode) {
        Write-Host "[CE-QC] Explicit recovery mode opening $LaunchUrl" -ForegroundColor Yellow
    } else {
        Write-Host "[CE-QC] Opening normal dashboard $LaunchUrl" -ForegroundColor Cyan
    }
    try { Start-Process $LaunchUrl | Out-Null } catch {}
    exit 0
}

# Cold start keeps the existing proven supervisor/restart logic. The important fast
# path is evaluated before npm inspection and before port cleanup, so opening CE QC
# again no longer kills a healthy backend and pays the whole database cold-start cost.
$launcher = Join-Path $ProjectRoot 'Start_CE_QC.ps1'
if (-not (Test-Path -LiteralPath $launcher)) {
    Write-Host '[ERROR] Start_CE_QC.ps1 was not found.' -ForegroundColor Red
    exit 2
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher
exit $LASTEXITCODE
