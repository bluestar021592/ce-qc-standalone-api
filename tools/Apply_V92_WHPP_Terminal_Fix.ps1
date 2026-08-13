$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Port = 5177
$SampleBill = 'CE01072600002'

Write-Host '[CE-QC] V92 WHPP terminal authority apply + verify' -ForegroundColor Cyan
Set-Location $ProjectRoot

Write-Host '[CE-QC] Stopping existing CE QC backend/supervisor...' -ForegroundColor Cyan
try {
  Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match 'ce-qc-standalone-api.*bootstrap\.js' -or
      $_.CommandLine -match 'ce-qc-standalone-api.*Start_CE_QC\.ps1' -or
      $_.CommandLine -match 'CE_QC_LAUNCHER.*Start_CE_QC\.ps1'
    )
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
} catch {}
try {
  $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($pidValue in $pids) { Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue }
} catch {}
Start-Sleep -Seconds 2

Write-Host '[CE-QC] Starting corrected backend...' -ForegroundColor Cyan
$cmd = Join-Path $ProjectRoot 'Start_CE_QC.cmd'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', ('"{0}"' -f $cmd) -WorkingDirectory $ProjectRoot

$ready = $false
for ($i=0; $i -lt 120; $i++) {
  Start-Sleep -Seconds 1
  try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) { $ready = $true; break }
  } catch {}
}
if (-not $ready) { throw 'CE QC backend did not listen on port 5177 within 120 seconds.' }
Write-Host '[CE-QC] Backend is listening on 5177.' -ForegroundColor Green
Start-Sleep -Seconds 2

Write-Host "[CE-QC] Auditing terminal truth for $SampleBill and all WHPP persisted rows..." -ForegroundColor Cyan
& node (Join-Path $ProjectRoot 'scripts\CE_QC_WHPP_Terminal_Authority_Audit_ReadOnly.mjs') $SampleBill
if ($LASTEXITCODE -ne 0) { throw "WHPP terminal authority audit is still BLOCKED (exit=$LASTEXITCODE)." }

Write-Host '[CE-QC] V92_TERMINAL_AUTHORITY_VERIFIED' -ForegroundColor Green
Write-Host '[CE-QC] Expected sample: orderStatus=85 / eventCode=80 => POD, CLOSED, never unresolved.' -ForegroundColor Green
Start-Process 'http://127.0.0.1:5177/whpp'
