$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

$PowerShellFiles = @(
  'tools\CE_QC_Managed_Launcher.ps1',
  'tools\Repair_CE_QC_Desktop_Launcher_V6.ps1',
  'Start_CE_QC.ps1'
)
foreach ($relative in $PowerShellFiles) {
  $file = Join-Path $ProjectRoot $relative
  if (-not (Test-Path -LiteralPath $file)) { throw "Missing managed runtime file: $relative" }
  $text = [IO.File]::ReadAllText($file)
  $null = [scriptblock]::Create($text)
  Write-Host "[PASS] PowerShell parse: $relative" -ForegroundColor Green
}

$rootStart = Join-Path $ProjectRoot 'Start_CE_QC.cmd'
if (-not (Test-Path -LiteralPath $rootStart)) { throw 'Start_CE_QC.cmd is missing.' }
$cmd = [IO.File]::ReadAllText($rootStart)
if ($cmd -notmatch 'CE_QC_Managed_Launcher\.ps1') { throw 'Start_CE_QC.cmd is not routed through the managed launcher.' }
if ($cmd -match 'Fast_Start_CE_QC\.ps1') { throw 'Start_CE_QC.cmd still references the stale-backend reuse launcher.' }
Write-Host '[PASS] Root start command is managed.' -ForegroundColor Green

$launcher = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'tools\CE_QC_Managed_Launcher.ps1'))
foreach ($marker in @('JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE','AssignProcessToJobObject','CE_QC_PreUpdate_Backup.mjs','test:golive','pull' + "','--ff-only",'Update check failed, but startup will continue')) {
  if ($launcher -notlike "*$marker*") { throw "Managed launcher safety marker missing: $marker" }
}
if ($launcher -match '\[string\[\]\]\s*\$Args\b' -or $launcher -match '@Args\b') {
  throw 'Managed launcher must not use PowerShell automatic $args as an explicit argument-list parameter.'
}
if ($launcher -notmatch '\[string\[\]\]\s*\$ArgumentList\b' -or $launcher -notmatch '\[string\[\]\]\s*\$GitArguments\b') {
  throw 'Managed launcher explicit argument-list parameters are missing.'
}
Write-Host '[PASS] Managed lifecycle/update safety markers are present.' -ForegroundColor Green
Write-Host '[PASS] Managed launcher does not collide with PowerShell automatic $args.' -ForegroundColor Green

Write-Host 'MANAGED_RUNTIME_VALIDATION: PASS' -ForegroundColor Green
exit 0
