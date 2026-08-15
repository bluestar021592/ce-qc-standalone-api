$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot
$LauncherLogDir = Join-Path $ProjectRoot 'logs'
New-Item -ItemType Directory -Path $LauncherLogDir -Force | Out-Null
$LauncherLog = Join-Path $LauncherLogDir 'managed_launcher_latest.log'

function Write-ManagedLog([string]$Text, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
  $line = ('{0:yyyy-MM-dd HH:mm:ss.fff} {1}' -f (Get-Date), $Text)
  try { Add-Content -LiteralPath $LauncherLog -Value $line -Encoding UTF8 } catch {}
  Write-Host $Text -ForegroundColor $Color
}

# Native stdout must never leak into a PowerShell function's return value. Candidate
# validation is a Boolean contract; output pollution previously made a rejected
# candidate look truthy and allowed installation to continue.
function Invoke-Exe([string]$File, [string[]]$ArgumentList, [switch]$AllowFailure) {
  & $File @ArgumentList | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
  if ($code -ne 0 -and -not $AllowFailure) { throw "$File exited with code ${code}: $($ArgumentList -join ' ')" }
  if ($AllowFailure) { return [int]$code }
}

function Get-GitText([string[]]$GitArguments) {
  $text = (& $script:GitExe @GitArguments 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "git failed: $($GitArguments -join ' ')" }
  return $text
}

function Test-TrackedTreeClean {
  $text = Get-GitText @('status','--porcelain','--untracked-files=no')
  return [string]::IsNullOrWhiteSpace($text)
}

function Test-SafeValidationPath([string]$Path) {
  try {
    $full = [IO.Path]::GetFullPath($Path)
    $temp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    return $full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -and ([IO.Path]::GetFileName($full) -like 'CE_QC_UPDATE_VERIFY_*')
  } catch { return $false }
}

function Remove-JunctionOnly([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  try {
    $item = Get-Item -LiteralPath $Path -Force
    $isReparsePoint = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
    if (-not $isReparsePoint) {
      Write-ManagedLog "[UPDATE] Refusing junction cleanup because path is not a reparse point: $Path" Yellow
      return $false
    }
    $cmd = if ($env:ComSpec) { $env:ComSpec } else { 'cmd.exe' }
    & $cmd /d /c "rmdir `"$Path`"" | Out-Null
    if ($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath $Path)) {
      Write-ManagedLog "[UPDATE] Validation node_modules junction could not be detached safely; temp directory will be retained: $Path" Yellow
      return $false
    }
    return $true
  } catch {
    Write-ManagedLog ("[UPDATE] Safe junction cleanup failed; temp directory will be retained. " + $_.Exception.Message) Yellow
    return $false
  }
}

function Remove-ValidationWorktree([string]$Path, [bool]$SafeToRecurse = $false) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  try { & $script:GitExe worktree remove --force $Path 2>$null | Out-Null } catch {}
  if (Test-Path -LiteralPath $Path) {
    if ($SafeToRecurse -and (Test-SafeValidationPath $Path)) {
      try { Remove-Item -LiteralPath $Path -Recurse -Force -Confirm:$false -ErrorAction Stop } catch {
        Write-ManagedLog "[UPDATE] Validation temp directory retained for later cleanup: $Path" Yellow
      }
    } else {
      Write-ManagedLog "[UPDATE] Validation temp directory retained for safety: $Path" Yellow
    }
  }
  try { & $script:GitExe worktree prune 2>$null | Out-Null } catch {}
}

function Test-RemoteCandidate([string]$RemoteCommit, [string]$CurrentCommit) {
  $tempRoot = Join-Path $env:TEMP ("CE_QC_UPDATE_VERIFY_{0}_{1}" -f $PID, (Get-Date -Format 'yyyyMMddHHmmss'))
  $linkedModules = $false
  $junctionCleanupOk = $true
  $oldBackupRoot = $env:CE_QC_BACKUP_PROJECT_ROOT
  try {
    Write-ManagedLog "[UPDATE] Verifying candidate $($RemoteCommit.Substring(0,[Math]::Min(8,$RemoteCommit.Length))) before installing..." Cyan
    Invoke-Exe $script:GitExe @('worktree','add','--detach','--quiet',$tempRoot,$RemoteCommit) | Out-Null

    $dependencyFiles = Get-GitText @('diff','--name-only',$CurrentCommit,$RemoteCommit,'--','package.json','package-lock.json')
    $currentModules = Join-Path $ProjectRoot 'node_modules'
    $candidateModules = Join-Path $tempRoot 'node_modules'
    $canReuseModules = [string]::IsNullOrWhiteSpace($dependencyFiles) -and (Test-Path -LiteralPath $currentModules)

    if ($canReuseModules) {
      Write-ManagedLog '[UPDATE] Dependencies unchanged; reusing installed node_modules for isolated candidate tests.' DarkCyan
      New-Item -ItemType Junction -Path $candidateModules -Target $currentModules -Force | Out-Null
      $linkedModules = $true
    } else {
      Write-ManagedLog '[UPDATE] Dependencies changed or missing; installing candidate dependencies once.' DarkCyan
      Push-Location $tempRoot
      try { Invoke-Exe $script:NpmExe @('ci','--prefer-offline','--no-audit','--no-fund') | Out-Null }
      finally { Pop-Location }
    }

    Push-Location $tempRoot
    try { Invoke-Exe $script:NpmExe @('run','test:golive') }
    finally { Pop-Location }

    $candidateBackup = Join-Path $tempRoot 'scripts\CE_QC_PreUpdate_Backup.mjs'
    if (-not (Test-Path -LiteralPath $candidateBackup)) { throw 'Candidate pre-update backup tool is missing.' }
    Invoke-Exe $script:NodeExe @('--check',$candidateBackup) | Out-Null
    $env:CE_QC_BACKUP_PROJECT_ROOT = $ProjectRoot
    Write-ManagedLog '[UPDATE] Candidate tests passed. Creating verified SQLite online backup before code switch...' Green
    Invoke-Exe $script:NodeExe @($candidateBackup,$CurrentCommit,$RemoteCommit) | Out-Null

    Write-ManagedLog '[UPDATE] Candidate tests and verified database backup passed. Code is eligible for installation.' Green
    return $true
  } catch {
    Write-ManagedLog ("[UPDATE] Candidate rejected; current known-good version will be kept. " + $_.Exception.Message) Yellow
    return $false
  } finally {
    if ($null -eq $oldBackupRoot) { Remove-Item Env:CE_QC_BACKUP_PROJECT_ROOT -ErrorAction SilentlyContinue }
    else { $env:CE_QC_BACKUP_PROJECT_ROOT = $oldBackupRoot }
    if ($linkedModules) { $junctionCleanupOk = Remove-JunctionOnly (Join-Path $tempRoot 'node_modules') }
    if (-not $linkedModules -or $junctionCleanupOk) { Remove-ValidationWorktree $tempRoot $true }
    else { Write-ManagedLog "[UPDATE] Candidate temp worktree intentionally retained to protect installed node_modules: $tempRoot" Yellow }
  }
}

function Invoke-SafeAutoUpdate {
  $git = Get-Command git.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $git -or -not $npm -or -not $node -or -not (Test-Path -LiteralPath (Join-Path $ProjectRoot '.git'))) {
    Write-ManagedLog '[UPDATE] Git/Node/npm or repository metadata unavailable; starting current installed version.' Yellow
    return
  }
  $script:GitExe = $git.Source
  $script:NpmExe = $npm.Source
  $script:NodeExe = $node.Source

  if (-not (Test-TrackedTreeClean)) {
    Write-ManagedLog '[UPDATE] Tracked project files have local changes; automatic update is skipped to avoid overwriting work.' Yellow
    return
  }

  $current = Get-GitText @('rev-parse','HEAD')
  try {
    $fetchCode = Invoke-Exe $script:GitExe @('fetch','--quiet','origin','main') -AllowFailure
    if ($fetchCode -ne 0) {
      Write-ManagedLog '[UPDATE] GitHub is temporarily unreachable; starting current installed version.' Yellow
      return
    }
  } catch {
    Write-ManagedLog '[UPDATE] GitHub fetch failed; starting current installed version.' Yellow
    return
  }
  $remote = Get-GitText @('rev-parse','origin/main')
  if ($current -eq $remote) {
    Write-ManagedLog "[UPDATE] Already current: $($current.Substring(0,8))." Green
    return
  }

  $ancestorCode = Invoke-Exe $script:GitExe @('merge-base','--is-ancestor',$current,$remote) -AllowFailure
  if ($ancestorCode -ne 0) {
    Write-ManagedLog '[UPDATE] Remote history is not a fast-forward of this installation; automatic update blocked for safety.' Yellow
    return
  }

  # FAIL_CLOSED_CANDIDATE_GATE_V152
  # Exactly one Boolean value must come back from validation. Any stray pipeline
  # output is itself a validation failure and blocks installation.
  $candidateResult = @(Test-RemoteCandidate $remote $current)
  $candidateAccepted = ($candidateResult.Count -eq 1 -and $candidateResult[0] -eq $true)
  if (-not $candidateAccepted) {
    Write-ManagedLog '[UPDATE] Candidate validation did not return one clean TRUE result; installation blocked.' Yellow
    return
  }

  $dependencyFiles = Get-GitText @('diff','--name-only',$current,$remote,'--','package.json','package-lock.json')
  Write-ManagedLog '[UPDATE] Installing verified fast-forward update...' Cyan
  Invoke-Exe $script:GitExe @('pull','--ff-only','--quiet','origin','main') | Out-Null
  if (-not [string]::IsNullOrWhiteSpace($dependencyFiles)) {
    Write-ManagedLog '[UPDATE] Dependencies changed; refreshing node_modules...' Cyan
    Invoke-Exe $script:NpmExe @('ci','--prefer-offline','--no-audit','--no-fund') | Out-Null
  }
  $installed = Get-GitText @('rev-parse','HEAD')
  Write-ManagedLog "[UPDATE] Installed verified version $($installed.Substring(0,8)). Database was not rewritten by updater." Green
}

function Add-JobObjectType {
  if ('CeQcNativeJob' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CeQcNativeJob {
  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct IO_COUNTERS {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  public const int JobObjectExtendedLimitInformation = 9;

  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr hObject);

  public static IntPtr CreateKillOnCloseJob() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
    IntPtr ptr = Marshal.AllocHGlobal(length);
    try {
      Marshal.StructureToPtr(info, ptr, false);
      if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr, (uint)length))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(ptr); }
    return job;
  }
}
'@
}

function Start-ManagedSupervisor {
  $supervisor = Join-Path $ProjectRoot 'Start_CE_QC.ps1'
  if (-not (Test-Path -LiteralPath $supervisor)) { throw "Missing supervisor: $supervisor" }
  $powerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path -LiteralPath $powerShellExe)) { throw 'Windows PowerShell was not found.' }

  Add-JobObjectType
  $job = [CeQcNativeJob]::CreateKillOnCloseJob()
  $proc = $null
  try {
    Write-ManagedLog '[APP] Starting CE QC backend under managed process tree.' Cyan
    Write-ManagedLog '[APP] Closing THIS window will automatically stop the backend and release port 5177.' Yellow
    $quotedSupervisor = '"' + $supervisor + '"'
    $proc = Start-Process -FilePath $powerShellExe -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$quotedSupervisor) -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru
    if (-not [CeQcNativeJob]::AssignProcessToJobObject($job, $proc.Handle)) {
      throw "Unable to attach CE QC supervisor to managed job. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    $proc.WaitForExit()
    return [int]$proc.ExitCode
  } finally {
    if ($job -ne [IntPtr]::Zero) { [void][CeQcNativeJob]::CloseHandle($job) }
  }
}

try {
  Write-Host '===================================================' -ForegroundColor Cyan
  Write-Host ' CE EXPRESS - QUALITY CONTROL MANAGEMENT SYSTEM' -ForegroundColor Cyan
  Write-Host ' Managed Desktop Launcher' -ForegroundColor Cyan
  Write-Host '===================================================' -ForegroundColor Cyan
  Write-ManagedLog '[APP] Startup requested.' Cyan
  try { Invoke-SafeAutoUpdate }
  catch { Write-ManagedLog ("[UPDATE] Update check failed, but startup will continue with the current installed version. " + $_.Exception.Message) Yellow }
  $exitCode = Start-ManagedSupervisor
  Write-ManagedLog "[APP] Supervisor exited with code $exitCode. Port 5177 process tree has been released." Yellow
  exit $exitCode
} catch {
  Write-ManagedLog ("[FATAL] " + $_.Exception.Message) Red
  Write-ManagedLog ("[FATAL] Log: " + $LauncherLog) Red
  Write-Host ''
  Write-Host 'Press Enter to close.' -ForegroundColor Yellow
  [void](Read-Host)
  exit 1
}
