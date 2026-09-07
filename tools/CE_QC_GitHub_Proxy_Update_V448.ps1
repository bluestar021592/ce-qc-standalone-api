$ErrorActionPreference = 'Stop'

$ProjectRoot = Join-Path $env:LOCALAPPDATA 'CE_QC_LAUNCHER\app'
$LogFile = Join-Path $env:LOCALAPPDATA 'CE_QC_LAUNCHER\proxy_update_latest.log'
$V448_ID = '2026-09-07-v448-windows-system-proxy-pac-git-recovery-v1'

function Write-V448Log([string]$Text, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
  $line = ('{0:yyyy-MM-dd HH:mm:ss.fff} {1}' -f (Get-Date), $Text)
  try { Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8 } catch {}
  Write-Host $Text -ForegroundColor $Color
}

function Stop-V448([string]$Text) {
  Write-V448Log "[V448] $Text" Red
  throw $Text
}

function Invoke-V448Exe([string]$File, [string[]]$Args, [switch]$AllowFailure) {
  & $File @Args | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
  if ($code -ne 0 -and -not $AllowFailure) { throw "$File exited with code ${code}: $($Args -join ' ')" }
  if ($AllowFailure) { return [int]$code }
}

function Get-V448GitText([string[]]$Args) {
  $text = (& $script:GitExe -C $ProjectRoot @Args 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "git failed: $($Args -join ' ')" }
  return $text
}

function Normalize-V448Proxy([string]$Value) {
  $v = [string]$Value
  if ([string]::IsNullOrWhiteSpace($v)) { return '' }
  $v = $v.Trim()
  if ($v -match '^(?i)(https?|socks4|socks5|socks5h)://') { return $v }
  if ($v -match '^[^=;\s]+:\d+$') { return "http://$v" }
  return ''
}

function Add-V448ProxyCandidate([System.Collections.ArrayList]$List, [string]$Value, [string]$Source) {
  $uri = Normalize-V448Proxy $Value
  if (-not $uri) { return }
  foreach ($item in @($List)) { if ([string]$item.Uri -eq $uri) { return } }
  [void]$List.Add([pscustomobject]@{ Uri=$uri; Source=$Source })
}

function Get-V448ProxyDisplay([string]$Value) {
  try {
    $u = [Uri]$Value
    $port = if ($u.IsDefaultPort) { '' } else { ":$($u.Port)" }
    return "$($u.Scheme)://$($u.Host)$port"
  } catch { return '[configured proxy]' }
}

function Get-V448ProxyCandidates {
  $list = New-Object System.Collections.ArrayList
  foreach ($name in @('HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy')) {
    $value = [Environment]::GetEnvironmentVariable($name,'Process')
    if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name,'User') }
    if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name,'Machine') }
    if ($value) { Add-V448ProxyCandidate $list $value "ENV:$name" }
  }

  try {
    $target = [Uri]'https://github.com/'
    $proxy = [System.Net.WebRequest]::GetSystemWebProxy()
    if ($proxy) {
      try { $proxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials } catch {}
      $resolved = $proxy.GetProxy($target)
      if ($resolved -and $resolved.AbsoluteUri -ne $target.AbsoluteUri) {
        Add-V448ProxyCandidate $list $resolved.AbsoluteUri 'WINDOWS_SYSTEM_PROXY_OR_PAC'
      }
    }
  } catch {
    Write-V448Log "[V448] Windows system proxy/PAC resolution failed: $($_.Exception.Message)" DarkYellow
  }

  try {
    $key = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
    if ([string]$key.AutoConfigURL) { Write-V448Log '[V448] Windows automatic proxy/PAC configuration detected.' DarkCyan }
    if ([int]$key.ProxyEnable -eq 1 -and [string]$key.ProxyServer) {
      $raw = [string]$key.ProxyServer
      if ($raw -match '(?i)(?:^|;)https=([^;]+)') { Add-V448ProxyCandidate $list $Matches[1] 'WINDOWS_STATIC_HTTPS_PROXY' }
      elseif ($raw -match '(?i)(?:^|;)http=([^;]+)') { Add-V448ProxyCandidate $list $Matches[1] 'WINDOWS_STATIC_HTTP_PROXY' }
      else { Add-V448ProxyCandidate $list $raw 'WINDOWS_STATIC_PROXY' }
    }
  } catch {}
  return @($list)
}

function Test-V448PortFree {
  try { return ($null -eq (Get-NetTCPConnection -LocalPort 5177 -State Listen -ErrorAction SilentlyContinue)) }
  catch {
    $hit = (& netstat.exe -ano -p tcp 2>$null | Select-String -Pattern '[:.]5177\s+.*LISTENING')
    return ($null -eq $hit)
  }
}

function Remove-V448Candidate([string]$Path, [bool]$LinkedModules) {
  if ($LinkedModules) {
    $junction = Join-Path $Path 'node_modules'
    if (Test-Path -LiteralPath $junction) { try { cmd.exe /d /c "rmdir `"$junction`"" | Out-Null } catch {} }
  }
  try { & $script:GitExe -C $ProjectRoot worktree remove --force $Path 2>$null | Out-Null } catch {}
  try { & $script:GitExe -C $ProjectRoot worktree prune 2>$null | Out-Null } catch {}
}

function Install-V448VerifiedCandidate([string]$RemoteCommit, [string]$CurrentCommit) {
  $tempRoot = Join-Path $env:TEMP ("CE_QC_PROXY_VERIFY_{0}_{1}" -f $PID,(Get-Date -Format 'yyyyMMddHHmmss'))
  $linked = $false
  $oldBackupRoot = $env:CE_QC_BACKUP_PROJECT_ROOT
  try {
    Write-V448Log "[V448] Verifying exact candidate $($RemoteCommit.Substring(0,8)) before install..." Cyan
    Invoke-V448Exe $script:GitExe @('-C',$ProjectRoot,'worktree','add','--detach','--quiet',$tempRoot,$RemoteCommit)
    $dependencyFiles = Get-V448GitText @('diff','--name-only',$CurrentCommit,$RemoteCommit,'--','package.json','package-lock.json')
    $currentModules = Join-Path $ProjectRoot 'node_modules'
    $candidateModules = Join-Path $tempRoot 'node_modules'
    if ([string]::IsNullOrWhiteSpace($dependencyFiles) -and (Test-Path -LiteralPath $currentModules)) {
      New-Item -ItemType Junction -Path $candidateModules -Target $currentModules -Force | Out-Null
      $linked = $true
      Write-V448Log '[V448] Dependencies unchanged; reusing installed node_modules for isolated candidate tests.' DarkCyan
    } else {
      Push-Location $tempRoot
      try { Invoke-V448Exe $script:NpmExe @('ci','--prefer-offline','--no-audit','--no-fund') }
      finally { Pop-Location }
    }

    Push-Location $tempRoot
    try { Invoke-V448Exe $script:NpmExe @('run','test:golive') }
    finally { Pop-Location }

    $backupTool = Join-Path $tempRoot 'scripts\CE_QC_PreUpdate_Backup.mjs'
    if (-not (Test-Path -LiteralPath $backupTool)) { throw 'Candidate backup tool is missing.' }
    Invoke-V448Exe $script:NodeExe @('--check',$backupTool)
    $env:CE_QC_BACKUP_PROJECT_ROOT = $ProjectRoot
    Write-V448Log '[V448] Candidate tests passed. Running verified SQLite backup gate...' Green
    Invoke-V448Exe $script:NodeExe @($backupTool,$CurrentCommit,$RemoteCommit)

    $status = Get-V448GitText @('status','--porcelain','--untracked-files=no')
    if (-not [string]::IsNullOrWhiteSpace($status)) { throw 'Tracked files changed during candidate validation.' }
    $ancestor = Invoke-V448Exe $script:GitExe @('-C',$ProjectRoot,'merge-base','--is-ancestor',$CurrentCommit,$RemoteCommit) -AllowFailure
    if ($ancestor -ne 0) { throw 'Candidate is not a fast-forward descendant of the installed version.' }

    Write-V448Log "[V448] Installing already-verified exact SHA $($RemoteCommit.Substring(0,8)) locally..." Cyan
    Invoke-V448Exe $script:GitExe @('-C',$ProjectRoot,'merge','--ff-only','--quiet',$RemoteCommit)
    if (-not [string]::IsNullOrWhiteSpace($dependencyFiles)) {
      Push-Location $ProjectRoot
      try { Invoke-V448Exe $script:NpmExe @('ci','--prefer-offline','--no-audit','--no-fund') }
      finally { Pop-Location }
    }
    $installed = Get-V448GitText @('rev-parse','HEAD')
    if ($installed -ne $RemoteCommit) { throw "Installed SHA mismatch. expected=$RemoteCommit actual=$installed" }
    Write-V448Log "[V448] SUCCESS - installed exact verified version $($installed.Substring(0,8))." Green
    Write-V448Log '[V448] Database was not rewritten by this updater.' Green
    return $installed
  } finally {
    if ($null -eq $oldBackupRoot) { Remove-Item Env:CE_QC_BACKUP_PROJECT_ROOT -ErrorAction SilentlyContinue }
    else { $env:CE_QC_BACKUP_PROJECT_ROOT = $oldBackupRoot }
    Remove-V448Candidate $tempRoot $linked
  }
}

try {
  Write-Host '===================================================' -ForegroundColor Cyan
  Write-Host ' CE QC - GITHUB SYSTEM PROXY UPDATE' -ForegroundColor Cyan
  Write-Host " $V448_ID" -ForegroundColor Cyan
  Write-Host '===================================================' -ForegroundColor Cyan
  if (-not (Test-Path -LiteralPath $ProjectRoot)) { Stop-V448 "Project directory not found: $ProjectRoot" }
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot '.git'))) { Stop-V448 'Git metadata is missing.' }
  if (-not (Test-V448PortFree)) { Stop-V448 'CE QC is still running on port 5177. Close the black CE QC launcher window first.' }

  $git = Get-Command git.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $git -or -not $npm -or -not $node) { Stop-V448 'Git / Node.js / npm is missing.' }
  $script:GitExe = $git.Source; $script:NpmExe = $npm.Source; $script:NodeExe = $node.Source

  $status = Get-V448GitText @('status','--porcelain','--untracked-files=no')
  if (-not [string]::IsNullOrWhiteSpace($status)) { Stop-V448 'Tracked project files have local changes. Recovery stopped to avoid overwriting them.' }
  $current = Get-V448GitText @('rev-parse','HEAD')
  Write-V448Log "[V448] Current installed SHA: $current" DarkCyan

  $candidates = @(Get-V448ProxyCandidates)
  if (-not $candidates.Count) { Stop-V448 'Windows did not expose a system/PAC/static/environment proxy for GitHub. No settings were changed.' }

  $fetched = $false
  foreach ($candidate in $candidates) {
    $proxyUri = [string]$candidate.Uri; $source = [string]$candidate.Source
    Write-V448Log "[V448] Trying GitHub with $source -> $(Get-V448ProxyDisplay $proxyUri)" Cyan
    $code = Invoke-V448Exe $script:GitExe @('-C',$ProjectRoot,'-c',"http.proxy=$proxyUri",'-c','http.proxyAuthMethod=anyauth','fetch','--quiet','origin','main') -AllowFailure
    if ($code -eq 0) { Write-V448Log "[V448] GitHub fetch succeeded through $source." Green; $fetched = $true; break }
  }
  if (-not $fetched) { Stop-V448 'All detected Windows proxy/PAC paths failed for GitHub. No system settings were changed.' }

  $remote = Get-V448GitText @('rev-parse','origin/main')
  Write-V448Log "[V448] Remote main SHA: $remote" DarkCyan
  if ($current -eq $remote) { Write-V448Log "[V448] Already current: $($current.Substring(0,8))." Green }
  else { [void](Install-V448VerifiedCandidate $remote $current) }

  $launcher = Join-Path $ProjectRoot 'tools\CE_QC_Managed_Launcher.ps1'
  if (Test-Path -LiteralPath $launcher) {
    Write-V448Log '[V448] Starting CE QC Managed Launcher...' Cyan
    $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Start-Process -FilePath $powershell -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$launcher`"") -WorkingDirectory $ProjectRoot
  }
} catch {
  Write-Host ''
  Write-Host ('V448 proxy recovery stopped: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host ('Log: ' + $LogFile) -ForegroundColor Yellow
  exit 1
}
