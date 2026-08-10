param(
  [string]$Repository = 'bluestar021592/ce-qc-standalone-api',
  [string]$Workflow = 'final-system-regression.yml',
  [string]$Ref = 'main'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$Text) {
  Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Invoke-NativeCapture {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $oldPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $Exe @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $oldPreference
  }

  return [pscustomobject]@{
    ExitCode = [int]$exitCode
    Output = @($output)
  }
}

function Invoke-NativeInteractive {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $oldPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $Exe @Arguments
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $oldPreference
  }

  return [int]$exitCode
}

function Resolve-GhCli {
  $command = Get-Command gh -ErrorAction SilentlyContinue
  if ($command) { return [string]$command.Source }

  $candidates = @(
    "$env:ProgramFiles\GitHub CLI\gh.exe",
    "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return [string]$candidate }
  }

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'GitHub CLI (gh) was not found and winget is unavailable. Install GitHub CLI and run this file again.'
  }

  Write-Step 'First run: installing GitHub CLI'
  $installExit = Invoke-NativeInteractive -Exe $winget.Source -Arguments @(
    'install', '--id', 'GitHub.cli', '-e', '--source', 'winget',
    '--accept-package-agreements', '--accept-source-agreements'
  )
  if ($installExit -ne 0) {
    throw "GitHub CLI installation failed. Exit code: $installExit"
  }

  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machinePath;$userPath"

  $command = Get-Command gh -ErrorAction SilentlyContinue
  if ($command) { return [string]$command.Source }
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return [string]$candidate }
  }
  throw 'GitHub CLI was installed but gh.exe is not visible in this process. Close this window and run the BAT again.'
}

function Test-GhAuthentication([string]$GhPath) {
  $result = Invoke-NativeCapture -Exe $GhPath -Arguments @('auth', 'status', '-h', 'github.com')
  return ($result.ExitCode -eq 0)
}

function Ensure-GhAuthentication([string]$GhPath) {
  if (Test-GhAuthentication $GhPath) {
    Write-Host 'GitHub authentication is already active.' -ForegroundColor Green
    return
  }

  Write-Host 'GitHub login is required once. A browser window will open.' -ForegroundColor Yellow
  Write-Host 'Complete the browser sign-in using the GitHub account that owns this repository.' -ForegroundColor Yellow

  $loginExit = Invoke-NativeInteractive -Exe $GhPath -Arguments @(
    'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'
  )
  if ($loginExit -ne 0) {
    throw "GitHub CLI login failed. Exit code: $loginExit"
  }
  if (-not (Test-GhAuthentication $GhPath)) {
    throw 'GitHub CLI login finished but authentication is still unavailable.'
  }

  Write-Host 'GitHub login completed.' -ForegroundColor Green
}

function Get-RepoVisibility([string]$GhPath) {
  $result = Invoke-NativeCapture -Exe $GhPath -Arguments @(
    'repo', 'view', $Repository, '--json', 'visibility', '--jq', '.visibility'
  )
  if ($result.ExitCode -ne 0) {
    throw "Cannot read repository visibility: $($result.Output -join ' ')"
  }
  return (($result.Output -join '').Trim().ToLowerInvariant())
}

function Set-RepoVisibility([string]$GhPath, [string]$Visibility) {
  Write-Host "Changing repository visibility to $Visibility ..." -ForegroundColor Yellow
  $result = Invoke-NativeCapture -Exe $GhPath -Arguments @(
    'repo', 'edit', $Repository, '--visibility', $Visibility,
    '--accept-visibility-change-consequences'
  )
  if ($result.ExitCode -ne 0) {
    throw "Changing repository visibility to $Visibility failed: $($result.Output -join ' ')"
  }

  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    if ((Get-RepoVisibility $GhPath) -eq $Visibility) { return }
  }
  throw "GitHub did not confirm visibility=$Visibility within 60 seconds."
}

function Get-LatestDispatchRunId([string]$GhPath) {
  $result = Invoke-NativeCapture -Exe $GhPath -Arguments @(
    'run', 'list', '-R', $Repository, '--workflow', $Workflow, '--branch', $Ref,
    '--event', 'workflow_dispatch', '--limit', '1', '--json', 'databaseId',
    '--jq', '.[0].databaseId // ""'
  )
  if ($result.ExitCode -ne 0) { return '' }
  return (($result.Output -join '').Trim())
}

$gh = $null
$originalVisibility = ''
$visibilityChanged = $false
$runId = ''
$ciExitCode = $null
$flowError = $null
$restoreError = $null

try {
  $gh = [string](Resolve-GhCli)

  Write-Step 'Checking GitHub authentication'
  Ensure-GhAuthentication $gh

  Write-Step 'Checking repository visibility'
  $originalVisibility = Get-RepoVisibility $gh
  Write-Host "Repository: $Repository"
  Write-Host "Original visibility: $originalVisibility"

  if ($originalVisibility -eq 'private') {
    Write-Step 'Temporarily switching Private to Public for free GitHub-hosted Actions'
    Set-RepoVisibility $gh 'public'
    $visibilityChanged = $true
  } elseif ($originalVisibility -eq 'public') {
    Write-Host 'Repository is already Public. No visibility change is needed.' -ForegroundColor Green
  } else {
    throw "Unsupported repository visibility: $originalVisibility"
  }

  Write-Step 'Starting final regression workflow'
  $beforeRunId = Get-LatestDispatchRunId $gh
  $trigger = Invoke-NativeCapture -Exe $gh -Arguments @(
    'workflow', 'run', $Workflow, '-R', $Repository, '--ref', $Ref
  )
  if ($trigger.ExitCode -ne 0) {
    throw "Unable to start workflow: $($trigger.Output -join ' ')"
  }

  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    $candidate = Get-LatestDispatchRunId $gh
    if ($candidate -and $candidate -ne $beforeRunId) {
      $runId = $candidate
      break
    }
  }
  if (-not $runId) {
    throw 'workflow_dispatch was sent, but no new Actions run appeared within 120 seconds.'
  }

  Write-Host "Actions Run ID: $runId" -ForegroundColor Green
  Write-Step 'Waiting for CI to finish'
  $ciExitCode = Invoke-NativeInteractive -Exe $gh -Arguments @(
    'run', 'watch', $runId, '-R', $Repository, '--compact', '--exit-status'
  )

  if ($ciExitCode -eq 0) {
    Write-Host "`nFINAL CI RESULT: PASSED" -ForegroundColor Green
  } else {
    Write-Host "`nFINAL CI RESULT: FAILED" -ForegroundColor Red
    Write-Host 'Failed-job log follows:' -ForegroundColor Red
    [void](Invoke-NativeInteractive -Exe $gh -Arguments @(
      'run', 'view', $runId, '-R', $Repository, '--log-failed'
    ))
  }
}
catch {
  $flowError = $_
  Write-Host "`nFREE CI FLOW ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  if ($visibilityChanged -and $gh) {
    try {
      Write-Step 'Restoring repository to Private'
      Set-RepoVisibility $gh 'private'
      Write-Host 'Repository visibility restored to Private.' -ForegroundColor Green
    }
    catch {
      $restoreError = $_
      Write-Host "CRITICAL: automatic restore to Private failed: $($_.Exception.Message)" -ForegroundColor Red
      Write-Host 'Open GitHub -> Repository Settings -> Danger Zone and set the repository to Private immediately.' -ForegroundColor Red
    }
  }
}

if ($restoreError) { exit 21 }
if ($flowError) { exit 20 }
if ($null -eq $ciExitCode) { exit 20 }
if ($ciExitCode -ne 0) { exit 10 }
exit 0
