# V788: execute real extracted managed-updater PowerShell functions against
# a disposable local root. No network, Git operations, npm or business DB.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$launcher=Join-Path $root 'tools/CE_QC_Managed_Launcher.ps1'
$tokens=$null
$parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($launcher,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw ('Launcher parse failed: '+($parseErrors | Out-String)) }
$names=@('Invoke-SafeAutoUpdate','Write-V788ManagedInstallReceipt','Test-V788ManagedInstallReceipt')
foreach ($name in $names) {
  $parts=@($ast.FindAll({param($a) ($a -is [System.Management.Automation.Language.FunctionDefinitionAst]) -and ($a.Name -eq $name)},$true))
  if ($parts.Count -ne 1) { throw "Expected one actual launcher function: $name, got $($parts.Count)" }
  . ([scriptblock]::Create($parts[0].Extent.Text))
}

$case=Join-Path ([IO.Path]::GetTempPath()) ('V788_RECEIPT_RUNTIME_'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $case -Force | Out-Null
try {
  $ProjectRoot=$case
  $LauncherLogDir=Join-Path $case 'logs'
  New-Item -ItemType Directory -Path $LauncherLogDir -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $case '.git') -Force | Out-Null
  $release=('a'*40)
  $receiptPath=Join-Path $LauncherLogDir 'v788_managed_install_receipt.json'
  $global:revalidateCount=0
  $global:revalidateResponse=$true
  function Write-ManagedLog([string]$Text,[string]$Color='Gray') { }
  function Get-Command {
    param([string]$Name,[string]$ErrorAction)
    if ($Name -in @('git.exe','npm.cmd','node.exe')) { return [pscustomobject]@{Source=$Name} }
    return $null
  }
  function Test-TrackedTreeClean { return $true }
  function Get-GitText {
    param([string[]]$GitArguments)
    if ($GitArguments[0] -eq 'rev-parse') { return $release }
    throw 'Unexpected Git command in recovery-only runtime fixture.'
  }
  function Invoke-ResilientGitHubFetch { return $true }
  function Test-RemoteCandidate {
    param([string]$RemoteCommit,[string]$CurrentCommit)
    if ($RemoteCommit -ne $release -or $CurrentCommit -ne $release) {
      throw 'Recovery did not verify the installed immutable commit.'
    }
    $global:revalidateCount++
    return $global:revalidateResponse
  }
  function Assert([bool]$condition,[string]$message) {
    if (-not $condition) { throw "V788 managed receipt runtime failed: $message" }
  }

  # No previous receipt: pass the real candidate branch exactly once and
  # create proof through actual production Write-V788ManagedInstallReceipt.
  Invoke-SafeAutoUpdate
  Assert (Test-Path -LiteralPath $receiptPath) 'first run must persist a release receipt'
  Assert ((Test-V788ManagedInstallReceipt $release) -eq $true) 'real PowerShell receipt reader must accept its own writer'
  Assert ($global:revalidateCount -eq 1) 'missing receipt must run one real candidate revalidation'

  $payload=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert ($payload.installedCommit -eq $release) 'installed receipt SHA must match exact main'
  Assert ($payload.remoteCommit -eq $release) 'receipt remote main SHA must match exact main'

  # An installed receipt must not rerun the expensive tests every startup.
  Invoke-SafeAutoUpdate
  Assert ($global:revalidateCount -eq 1) 'valid receipt must skip repeated candidate tests'

  # Stale proof cannot permit a clear. Failed revalidation may NOT mint a new one.
  $payload.installedCommit=('b'*40)
  $payload | ConvertTo-Json -Compress | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Assert ((Test-V788ManagedInstallReceipt $release) -eq $false) 'stale receipt must fail before retry'
  $global:revalidateResponse=$false
  Invoke-SafeAutoUpdate
  Assert ($global:revalidateCount -eq 2) 'stale receipt must retrigger revalidation'
  Assert ((Test-V788ManagedInstallReceipt $release) -eq $false) 'failed revalidation must not mint a valid receipt'

  # No proof, still a blocked state when the candidate gate produces false.
  Remove-Item -LiteralPath $receiptPath -Force
  Invoke-SafeAutoUpdate
  Assert ($global:revalidateCount -eq 3) 'missing receipt must revalidate again'
  Assert (-not (Test-Path -LiteralPath $receiptPath)) 'failed revalidation cannot create receipt'

  $global:revalidateResponse=$true
  Invoke-SafeAutoUpdate
  Assert ($global:revalidateCount -eq 4) 'recovery must rerun for a newly accepted candidate'
  Assert ((Test-V788ManagedInstallReceipt $release) -eq $true) 'accepted candidate must create matching receipt'
  Write-Output '[V788_RECEIPT_RUNTIME] PASS no proof, revalidate, valid proof, stale proof, failed proof and recovery'
} finally {
  Remove-Item -LiteralPath $case -Force -Recurse -ErrorAction SilentlyContinue
}
