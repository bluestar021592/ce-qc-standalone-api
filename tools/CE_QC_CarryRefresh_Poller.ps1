$ErrorActionPreference = 'SilentlyContinue'
$StatusUrl = 'http://127.0.0.1:5177/api/v98/carry-refresh/status'
$RefreshUrl = 'http://127.0.0.1:5177/api/v98/carry-refresh'
$BackendMissingSince = $null

while ($true) {
  try {
    $status = Invoke-RestMethod -Uri $StatusUrl -Method Get -TimeoutSec 5
    $BackendMissingSince = $null
    if ($status.ok -and $status.due -and -not $status.foregroundProcessing) {
      $result = Invoke-RestMethod -Uri $RefreshUrl -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 1800
      if ($result.ok -and -not $result.skipped) {
        Write-Host ("[CARRY] refreshed={0} closed={1} failed={2} open={3}" -f $result.refreshed,$result.closed,$result.failed,$result.openAfter) -ForegroundColor DarkCyan
      }
    }
  } catch {
    if (-not $BackendMissingSince) { $BackendMissingSince = Get-Date }
    if (((Get-Date) - $BackendMissingSince).TotalMinutes -ge 2) { exit 0 }
  }
  Start-Sleep -Seconds 60
}
