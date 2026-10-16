# V788 one-time candidate pilot; not a formal installation.
# No main checkout, release or production D:\CE CCSL database updates.
param(
  [Parameter(Mandatory=$true)][string]$ExpectedSha,
  [string]$CandidateRef = 'v788-board-calibration'
)
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $PSScriptRoot
$Sandbox='D:\CE_QC_V788_试用沙盒'
$Source='D:\CE_QC_V788_验收副本\ce_qc_monitor.db'
$Sentinel=Join-Path $Sandbox 'V788_只用于隔离试用.txt'
$App=Join-Path $Sandbox 'app'
$PilotData=Join-Path $Sandbox 'data'
$PilotDb=Join-Path $PilotData 'ce_qc_monitor.db'
$Port=5278
$Server=$null
$SandboxCreated=$false
$WorktreeCreated=$false
$CurrentHead=''
$EnvOriginal=@{}
$EnvSaved=$false
$EnvNames=@('DATA_DIR','DB_FILE','LOCALAPPDATA','EXPORTS_DIR','BACKUPS_DIR','IMPORTS_DIR',
  'PORT','HOST','PUBLIC_HOSTNAME','NODE_ENV','ACCESS_MODE',
  'CE_QC_BACKGROUND_MAINTENANCE_ENABLED','CE_QC_SKIP_STARTUP_POD_REPAIR',
  'CE_QC_ENABLE_EXPORT_SIDECAR_AT_STARTUP','CE_QC_DISABLE_V246_TRACKING',
  'CE_QC_AUTH_SIDECAR_PORT','CE_QC_AUTH_SIDECAR_HOST',
  'CE_QC_EXPORT_SIDECAR_PORT','CE_QC_V788_PILOT_ISOLATED','CE_QC_LOCAL_SESSION_SECRET')
function Require([bool]$Condition,[string]$Message){
  if(-not $Condition){throw $Message}
}
function GitText([string[]]$Arguments){
  $result=(& git @Arguments | Out-String).Trim()
  if($LASTEXITCODE -ne 0){throw 'Git command failed; existing V787 was not changed.'}
  return $result
}
function RestoreEnvironment {
  if(-not $EnvSaved){return}
  foreach($name in $EnvNames){
    [Environment]::SetEnvironmentVariable($name,$EnvOriginal[$name],'Process')
  }
}
function StopPilot {
  if($Server -and (-not $Server.HasExited)){
    & taskkill.exe /PID $Server.Id /T /F 2>$null | Out-Null
  }
}
function AssertPortFree {
  $listener=$null
  try{
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'),$Port)
    $listener.Start()
  }catch{throw 'Port 5278 is occupied. The existing APP will not be stopped or replaced.'}
  finally{if($listener){$listener.Stop()}}
}

Require ($ExpectedSha -match '^[a-fA-F0-9]{40}$') 'Exact 40-character candidate SHA required.'
Require (Test-Path -LiteralPath $Source -PathType Leaf) 'V788 D-drive acceptance copy is missing; nothing was launched.'
Require (-not (Test-Path -LiteralPath $Sandbox)) 'V788 trial sandbox folder already exists. Refusing to remove or overwrite it.'
foreach($name in @('git','node','npm')){
  Require ([bool](Get-Command $name -ErrorAction SilentlyContinue)) "Missing $name; no APP changes were made."
}
AssertPortFree
# Reserve separate sidecar ports; never take over V787 auth (usually 5179).
foreach($sidecarPort in @(5280,5281)){
  $probe=$null
  try{
    $probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'),$sidecarPort)
    $probe.Start()
  }catch{throw "V788 trial sidecar port $sidecarPort is already occupied. Existing APP remains untouched."}
  finally{if($probe){$probe.Stop()}}
}
Push-Location -LiteralPath $Root
try{
  $CurrentHead=GitText @('rev-parse','HEAD')
  & git fetch --quiet origin $CandidateRef
  if($LASTEXITCODE -ne 0){throw 'Cannot fetch candidate branch; V787 is unchanged.'}
  $actual=(GitText @('rev-parse','FETCH_HEAD')).ToLowerInvariant()
  Require ($actual -eq $ExpectedSha.ToLowerInvariant()) 'Candidate SHA changed. Refusing moving-version trial.'
  New-Item -ItemType Directory -Path $Sandbox -Force | Out-Null
  $SandboxCreated=$true
  Set-Content -LiteralPath $Sentinel -Value "Temporary V788 pilot created for $actual" -Encoding UTF8
  & git worktree add --detach $App $actual
  if($LASTEXITCODE -ne 0){throw 'Could not create detached candidate worktree.'}
  $WorktreeCreated=$true
  New-Item -ItemType Directory -Path $PilotData -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $Sandbox 'logs') -Force | Out-Null
  Push-Location -LiteralPath $App
  try{
    & npm ci --no-audit --no-fund
    if($LASTEXITCODE -ne 0){throw 'Candidate dependency installation failed; no official APP update.'}
    & node scripts/v788-create-isolated-pilot-snapshot.mjs "--out=$PilotDb"
    if($LASTEXITCODE -ne 0){throw 'Read-only isolated-copy cloning failed; no official data was opened.'}
    foreach($name in $EnvNames){
      $EnvOriginal[$name]=[Environment]::GetEnvironmentVariable($name,'Process')
    }
    $EnvSaved=$true
    $env:DATA_DIR=$PilotData
    $env:DB_FILE=$PilotDb
    $env:LOCALAPPDATA=(Join-Path $Sandbox 'localapp')
    $env:EXPORTS_DIR=(Join-Path $Sandbox 'exports')
    $env:BACKUPS_DIR=(Join-Path $Sandbox 'backups')
    $env:IMPORTS_DIR=(Join-Path $Sandbox 'imports')
    $env:HOST='127.0.0.1'
    $env:PORT=[string]$Port
    $env:PUBLIC_HOSTNAME=''
    $env:NODE_ENV='development'
    $env:ACCESS_MODE='LOCAL'
    $env:CE_QC_BACKGROUND_MAINTENANCE_ENABLED='0'
    $env:CE_QC_SKIP_STARTUP_POD_REPAIR='1'
    $env:CE_QC_ENABLE_EXPORT_SIDECAR_AT_STARTUP='0'
    $env:CE_QC_DISABLE_V246_TRACKING='1'
    $env:CE_QC_AUTH_SIDECAR_PORT='5280'
    $env:CE_QC_AUTH_SIDECAR_HOST='127.0.0.1'
    $env:CE_QC_EXPORT_SIDECAR_PORT='5281'
    $env:CE_QC_V788_PILOT_ISOLATED='1'
    # The V788 app and its isolated auth sidecar must sign with exactly the
    # same per-pilot key; never reuse, read, or modify the V787 session key.
    $PilotSecretBytes=New-Object byte[] 48
    $PilotRng=[System.Security.Cryptography.RandomNumberGenerator]::Create()
    try{$PilotRng.GetBytes($PilotSecretBytes)}finally{$PilotRng.Dispose()}
    $env:CE_QC_LOCAL_SESSION_SECRET=[Convert]::ToBase64String($PilotSecretBytes)
    $logs=Join-Path $Sandbox 'logs'
    $Server=Start-Process -FilePath 'node.exe' -ArgumentList 'bootstrap.js' -WorkingDirectory $App -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError (Join-Path $logs 'server-errors.log')
    $ready=$false
    for($i=0;$i -lt 90;$i++){
      if($Server.HasExited){throw 'Candidate backend exited before opening the browser.'}
      $probe=$null
      try{
        $probe=[Net.Sockets.TcpClient]::new()
        $probe.Connect('127.0.0.1',$Port)
        if($probe.Connected){$ready=$true;break}
      }catch{}
      finally{if($probe){$probe.Close();$probe.Dispose()}}
      Start-Sleep -Milliseconds 700
    }
    Require $ready 'Candidate backend did not start. Nothing was installed.'
    Write-Host ''
    Write-Host 'V788 isolated trial is ready in a separate local window (port 5278).' -ForegroundColor Green
    Write-Host 'All application writes go to the disposable trial database; formal V787 remains running.' -ForegroundColor Green
    $CiSelfTest=($env:GITHUB_ACTIONS -eq 'true' -and $env:CI -eq 'true' -and $env:CE_QC_V788_PILOT_CI_NO_BROWSER -eq '1')
    if($CiSelfTest){
      Write-Host '[V788_PILOT_E2E] READY local V788 backend on 5278, separate auth on 5280; disposable isolated database only.' -ForegroundColor Green
      # No browser or interactive prompt in the GitHub runner.
      # The Finally blocks must stop every V788 child and clean the trial sandbox.
    }else{
      Start-Process "http://127.0.0.1:$Port/settings?auth=v625"
      [void](Read-Host 'Use the trial browser. When finished, return here and press Enter to stop and remove the sandbox')
    }
  }finally{
    StopPilot
    RestoreEnvironment
    Pop-Location
  }
}finally{
  Pop-Location
  if($WorktreeCreated){
    Push-Location -LiteralPath $Root
    try{& git worktree remove --force $App 2>$null | Out-Null; & git worktree prune 2>$null | Out-Null}catch{}
    Pop-Location
  }
  if($SandboxCreated -and (Test-Path -LiteralPath $Sentinel)){
    # Only erase this invocation's explicitly created D-drive sandbox.
    if($Sandbox -eq 'D:\CE_QC_V788_试用沙盒'){
      Remove-Item -LiteralPath $Sandbox -Recurse -Force
    }
  }
  if($CurrentHead){
    Push-Location -LiteralPath $Root
    try{
      $after=GitText @('rev-parse','HEAD')
      Require ($after -eq $CurrentHead) 'Live Git HEAD changed unexpectedly. STOP.'
    }finally{Pop-Location}
  }
}
