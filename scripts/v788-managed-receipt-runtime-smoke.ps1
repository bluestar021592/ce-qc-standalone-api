# V788: execute real extracted managed-updater PowerShell functions against
# a disposable local root. No network, Git operations, npm or business DB.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$launcher=Join-Path $root 'tools/CE_QC_Managed_Launcher.ps1'
$tokens=$null
$parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($launcher,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw ('Launcher parse failed: '+($parseErrors | Out-String)) }
$names=@('Invoke-SafeAutoUpdate','Write-V788ManagedInstallReceipt','Test-V788ManagedInstallReceipt','Test-V788ScriptOnlyManifestChange')
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

  # JSON accepted by loose PowerShell coercion but rejected by the actual
  # Node backend must trigger a fresh candidate gate, not a permanent deadlock.
  $badReceipts=@(
    (@{schemaVersion='1';mode='INSTALLED';candidateGatePassed=$true;installedCommit=$release;remoteCommit=$release}),
    (@{schemaVersion=1;mode='INSTALLED';candidateGatePassed='true';installedCommit=$release;remoteCommit=$release}),
    (@{schemaVersion=1;mode='installed';candidateGatePassed=$true;installedCommit=$release;remoteCommit=$release}),
    (@{schemaVersion=1;mode='INSTALLED';candidateGatePassed=$true;installedCommit='NOT_A_SHA';remoteCommit=$release})
  )
  foreach ($bad in $badReceipts) {
    $bad | ConvertTo-Json -Compress | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    Assert ((Test-V788ManagedInstallReceipt $release) -eq $false) 'backend-incompatible receipt must be rejected'
    $global:revalidateResponse=$false
    $before=$global:revalidateCount
    Invoke-SafeAutoUpdate
    Assert ($global:revalidateCount -eq ($before+1)) 'bad receipt must revalidate'
    Assert ((Test-V788ManagedInstallReceipt $release) -eq $false) 'failed candidate must never repair bad proof'
  }
  ('x'*9000) | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Assert ((Test-V788ManagedInstallReceipt $release) -eq $false) 'oversized receipt must be rejected'
  $global:revalidateResponse=$true
  Invoke-SafeAutoUpdate
  Assert ((Test-V788ManagedInstallReceipt $release) -eq $true) 'valid gate must recover after malformed proof'
  # Real updater execution with stubbed Git/npm against disposable files.
  # Lockfile, dependency and malformed manifest changes stay blocked; scripts
  # only must install exact SHA without npm ci or changing dependency modules.
  $nextRelease=('b'*40)
  $global:installAttempts=0
  $global:mockPackageDiff='package-lock.json'
  $global:mockManifestMode='scripts'
  $global:mockNpmCalls=0
  function Get-GitText {
    param([string[]]$GitArguments)
    if ($GitArguments[0] -eq 'rev-parse') {
      if ($GitArguments[1] -eq 'HEAD') { return $release }
      if ($GitArguments[1] -eq 'origin/main') { return $nextRelease }
    }
    if ($GitArguments[0] -eq 'diff') { return $global:mockPackageDiff }
    if ($GitArguments[0] -eq 'show') {
      if ($GitArguments[1] -eq "${release}:package.json") {
        return '{"name":"ce-qc","scripts":{"test":"old"},"dependencies":{"alpha":"1.0.0"}}'
      }
      if ($GitArguments[1] -eq "${nextRelease}:package.json") {
        if ($global:mockManifestMode -eq 'malformed') { return '{broken' }
        if ($global:mockManifestMode -eq 'deps') {
          return '{"name":"ce-qc","scripts":{"test":"new"},"dependencies":{"alpha":"2.0.0"}}'
        }
        return '{"name":"ce-qc","scripts":{"test":"new"},"dependencies":{"alpha":"1.0.0"}}'
      }
    }
    throw 'Unexpected Git command in package-change runtime fixture.'
  }
  function Invoke-Exe {
    param([string]$File,[string[]]$ArgumentList,[switch]$AllowFailure)
    if ($ArgumentList[0] -eq 'merge-base') { return 0 }
    if ($File -eq 'npm.cmd') { $global:mockNpmCalls++ }
    throw 'Unexpected external command during updater safety test.'
  }
  function Test-RemoteCandidate { param([string]$RemoteCommit,[string]$CurrentCommit) return $true }
  function Install-VerifiedCommitLocally {
    param([string]$ExpectedCurrent,[string]$VerifiedCommit)
    $global:installAttempts++
    if ($ExpectedCurrent -ne $release -or $VerifiedCommit -ne $nextRelease) { throw 'Installed wrong SHA.' }
    return $VerifiedCommit
  }
  Remove-Item -LiteralPath $receiptPath -Force -ErrorAction SilentlyContinue
  Invoke-SafeAutoUpdate
  Assert ($global:installAttempts -eq 0) 'lockfile change must abort before live git merge'
  Assert (-not (Test-Path -LiteralPath $receiptPath)) 'lockfile rejection must not issue release receipt'

  $global:mockPackageDiff='package.json'
  $global:mockManifestMode='deps'
  Invoke-SafeAutoUpdate
  Assert ($global:installAttempts -eq 0) 'dependency change must abort before live git merge'
  Assert (-not (Test-Path -LiteralPath $receiptPath)) 'dependency rejection must not issue release receipt'

  $global:mockManifestMode='malformed'
  Invoke-SafeAutoUpdate
  Assert ($global:installAttempts -eq 0) 'unreadable manifest must fail closed'
  Assert (-not (Test-Path -LiteralPath $receiptPath)) 'malformed manifest must not issue release receipt'

  $global:mockManifestMode='scripts'
  Invoke-SafeAutoUpdate
  Assert ($global:installAttempts -eq 1) 'script-only change must install exact validated SHA once'
  Assert ($global:mockNpmCalls -eq 0) 'script-only change must not execute npm ci'
  Assert ((Test-V788ManagedInstallReceipt $nextRelease) -eq $true) 'script-only install must emit exact SHA receipt'
  Write-Output '[V788_DEPENDENCY_GUARD] PASS lockfile, dependency, malformed blocked; scripts-only exact SHA accepted without npm ci'
  Write-Output '[V788_RECEIPT_RUNTIME] PASS missing, valid, stale, failed, typed malformed, oversized and recovered receipt; no actual SQLite writes'
} finally {
  Remove-Item -LiteralPath $case -Force -Recurse -ErrorAction SilentlyContinue
}
