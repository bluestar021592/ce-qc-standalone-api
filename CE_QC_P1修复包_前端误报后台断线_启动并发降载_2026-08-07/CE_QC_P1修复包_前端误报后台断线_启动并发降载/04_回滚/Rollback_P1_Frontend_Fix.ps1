$ErrorActionPreference = "Stop"
$known = "C:\Users\CELNT-EE-097\Documents\CE CCSL 质控研发APP\ce-qc-standalone-api"
$root = $known
if (-not (Test-Path -LiteralPath (Join-Path $root "package.json"))) {
  $root = Read-Host "Paste CE QC project folder"
}
$state = Join-Path $root "_PATCH_STATE\last_frontend_connection_backup.txt"
if (-not (Test-Path -LiteralPath $state)) { throw "Backup record not found." }
$backup = (Get-Content -LiteralPath $state -Raw).Trim()
$source = Join-Path $backup "public\app.js"
$target = Join-Path $root "public\app.js"
Copy-Item -LiteralPath $source -Destination $target -Force
& node --check $target
Write-Host "Original public/app.js restored." -ForegroundColor Green
Write-Host "Database was not modified." -ForegroundColor Yellow
Read-Host "Press Enter to exit"
