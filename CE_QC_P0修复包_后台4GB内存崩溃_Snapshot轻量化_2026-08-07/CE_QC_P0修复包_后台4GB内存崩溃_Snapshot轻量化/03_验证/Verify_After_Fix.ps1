$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Write-Host ""
Write-Host "==== CE QC Post-Fix Basic Verification ====" -ForegroundColor Cyan
Write-Host ""
Write-Host "[1] Port 5177" -ForegroundColor Cyan
netstat -ano | Select-String ":5177"

foreach ($u in @("http://127.0.0.1:5177/","http://127.0.0.1:5177/settings","http://127.0.0.1:5177/logs")) {
  Write-Host ""
  Write-Host "[HTTP] $u" -ForegroundColor Cyan
  try {
    $r = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 8
    Write-Host "HTTP $($r.StatusCode)" -ForegroundColor Green
  } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
}

Write-Host ""
Write-Host "[Node memory]" -ForegroundColor Cyan
Get-Process node -ErrorAction SilentlyContinue |
  Select-Object Id,StartTime,@{N="WorkingSetMB";E={[math]::Round($_.WorkingSet64/1MB,1)}},@{N="PrivateMB";E={[math]::Round($_.PrivateMemorySize64/1MB,1)}} |
  Format-Table -AutoSize

Write-Host ""
Write-Host "Basic check finished. Final acceptance requires one real daily processing run through snapshot creation." -ForegroundColor Yellow
Read-Host "Press Enter to exit"
