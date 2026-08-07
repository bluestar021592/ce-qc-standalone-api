$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$known = "C:\Users\CELNT-EE-097\Documents\CE CCSL 质控研发APP\ce-qc-standalone-api"
function IsRoot($p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $false }
  return (Test-Path -LiteralPath (Join-Path $p "package.json")) -and (Test-Path -LiteralPath (Join-Path $p "public"))
}
if (IsRoot $known) { $root=$known }
else {
  $root=Read-Host "Paste ce-qc-standalone-api project folder"
  if (-not (IsRoot $root)) { throw "Project root not found." }
}
$src=Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "api-diagnostic.html"
$dst=Join-Path $root "public\api-diagnostic.html"
Copy-Item -LiteralPath $src -Destination $dst -Force
Write-Host ""
Write-Host "Diagnostic page installed:" -ForegroundColor Green
Write-Host $dst -ForegroundColor Green
Write-Host ""
Write-Host "Open:" -ForegroundColor Cyan
Write-Host "http://127.0.0.1:5177/api-diagnostic.html" -ForegroundColor Cyan
Start-Process "http://127.0.0.1:5177/api-diagnostic.html"
Read-Host "Press Enter to exit"
