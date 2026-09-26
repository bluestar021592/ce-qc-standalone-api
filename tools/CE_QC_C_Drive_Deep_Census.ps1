param(
  [string]$OutputFile = ''
)

$ErrorActionPreference='SilentlyContinue'
$Patch='2026-09-26-v587-deep-c-drive-census-v1'
if([string]::IsNullOrWhiteSpace($OutputFile)){
  $projectRoot=Split-Path -Parent $PSScriptRoot
  $logDir=Join-Path $projectRoot 'logs'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $OutputFile=Join-Path $logDir 'c_drive_deep_census_latest.log'
}

function GiB([Int64]$Bytes){ [math]::Round(($Bytes / 1GB),2) }
function Write-Line([string]$Text){
  try{ Add-Content -LiteralPath $OutputFile -Value $Text -Encoding UTF8 }catch{}
}
function Root-Key([string]$Root,[string]$Path){
  try{
    $base=[IO.Path]::GetFullPath($Root).TrimEnd('\')
    $full=[IO.Path]::GetFullPath($Path)
    if($full.Length -le $base.Length){ return '__ROOT_FILES__' }
    $rel=$full.Substring($base.Length).TrimStart('\')
    if([string]::IsNullOrWhiteSpace($rel)){ return '__ROOT_FILES__' }
    $idx=$rel.IndexOf('\')
    if($idx -lt 0){ return $rel }
    return $rel.Substring(0,$idx)
  }catch{ return '__UNKNOWN__' }
}
function Scan-ByFirstLevel([string]$Root,[int]$BudgetSeconds=90,[string[]]$SkipTop=@()){
  $result=[ordered]@{Root=$Root;Bytes=[Int64]0;Files=[Int64]0;Dirs=[Int64]0;Partial=$false;ElapsedMs=0;Rows=@()}
  if([string]::IsNullOrWhiteSpace($Root)-or -not (Test-Path -LiteralPath $Root)){ return [pscustomobject]$result }
  $skip=New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  foreach($s in $SkipTop){ if($s){ [void]$skip.Add($s) } }
  $map=@{}
  $sw=[Diagnostics.Stopwatch]::StartNew()
  $stack=New-Object 'System.Collections.Generic.Stack[string]'
  $stack.Push([IO.Path]::GetFullPath($Root))
  while($stack.Count -gt 0){
    if($sw.Elapsed.TotalSeconds -ge $BudgetSeconds){$result.Partial=$true;break}
    $dir=$stack.Pop()
    $result.Dirs++
    try{
      foreach($filePath in [IO.Directory]::EnumerateFiles($dir)){
        try{
          $key=Root-Key $Root $filePath
          if($skip.Contains($key)){continue}
          $fi=[IO.FileInfo]::new($filePath)
          $bytes=[Int64]$fi.Length
          if(-not $map.ContainsKey($key)){$map[$key]=[ordered]@{Bytes=[Int64]0;Files=[Int64]0}}
          $map[$key].Bytes += $bytes
          $map[$key].Files++
          $result.Bytes += $bytes
          $result.Files++
        }catch{}
        if(($result.Files % 1024)-eq 0 -and $sw.Elapsed.TotalSeconds -ge $BudgetSeconds){$result.Partial=$true;break}
      }
      if($result.Partial){break}
      foreach($subPath in [IO.Directory]::EnumerateDirectories($dir)){
        try{
          $key=Root-Key $Root $subPath
          if($skip.Contains($key)){continue}
          $di=[IO.DirectoryInfo]::new($subPath)
          if(($di.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){continue}
          $stack.Push($subPath)
        }catch{}
      }
    }catch{}
  }
  $sw.Stop()
  $result.ElapsedMs=[int]$sw.ElapsedMilliseconds
  $rows=@()
  foreach($entry in $map.GetEnumerator()){
    $rows += [pscustomobject]@{Name=[string]$entry.Key;Bytes=[Int64]$entry.Value.Bytes;Files=[Int64]$entry.Value.Files}
  }
  $result.Rows=@($rows | Sort-Object Bytes -Descending)
  return [pscustomobject]$result
}
function Write-Scan([string]$Label,$Scan,[int]$Top=30){
  Write-Line ("SCAN={0} ROOT={1} SCANNED={2}GiB FILES={3} DIRS={4} PARTIAL={5} ELAPSED_MS={6}" -f $Label,$Scan.Root,(GiB $Scan.Bytes),$Scan.Files,$Scan.Dirs,$Scan.Partial,$Scan.ElapsedMs)
  $rank=0
  foreach($row in @($Scan.Rows | Select-Object -First $Top)){
    $rank++
    Write-Line ("  TOP{0:00} {1} = {2}GiB files={3}" -f $rank,$row.Name,(GiB $row.Bytes),$row.Files)
  }
}
function Write-SystemFile([string]$Path){
  try{
    if(Test-Path -LiteralPath $Path){
      $item=Get-Item -LiteralPath $Path -Force
      Write-Line ("SYSTEM_FILE={0} SIZE={1}GiB" -f $Path,(GiB ([Int64]$item.Length)))
    }
  }catch{}
}
function Capture-Command([string]$Label,[string]$Exe,[string]$ArgumentLine,[int]$TimeoutSeconds=30){
  $tmpOut=[IO.Path]::GetTempFileName()
  $tmpErr=[IO.Path]::GetTempFileName()
  try{
    $p=Start-Process -FilePath $Exe -ArgumentList $ArgumentLine -PassThru -WindowStyle Hidden -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
    if(-not $p.WaitForExit($TimeoutSeconds*1000)){
      try{$p.Kill()}catch{}
      Write-Line ("COMMAND={0} TIMEOUT={1}s" -f $Label,$TimeoutSeconds)
      return
    }
    Write-Line ("COMMAND={0} EXIT={1}" -f $Label,$p.ExitCode)
    foreach($line in @(Get-Content -LiteralPath $tmpOut -ErrorAction SilentlyContinue)){ Write-Line ("  "+$line) }
    foreach($line in @(Get-Content -LiteralPath $tmpErr -ErrorAction SilentlyContinue)){ Write-Line ("  ERR "+$line) }
  }catch{
    Write-Line ("COMMAND={0} ERROR={1}" -f $Label,$_.Exception.Message)
  }finally{
    Remove-Item -LiteralPath $tmpOut,$tmpErr -Force -ErrorAction SilentlyContinue
  }
}
function Find-LargeVirtualDisks([string[]]$Roots,[int]$BudgetSeconds=45){
  $sw=[Diagnostics.Stopwatch]::StartNew()
  $found=@()
  foreach($root in $Roots){
    if(-not $root -or -not (Test-Path -LiteralPath $root)){continue}
    $stack=New-Object 'System.Collections.Generic.Stack[string]'
    $stack.Push([IO.Path]::GetFullPath($root))
    while($stack.Count -gt 0){
      if($sw.Elapsed.TotalSeconds -ge $BudgetSeconds){break}
      $dir=$stack.Pop()
      try{
        foreach($file in [IO.Directory]::EnumerateFiles($dir)){
          try{
            $ext=[IO.Path]::GetExtension($file).ToLowerInvariant()
            if($ext -in @('.vhdx','.vhd','.vmdk','.qcow2')){
              $fi=[IO.FileInfo]::new($file)
              if($fi.Length -ge 256MB){$found += [pscustomobject]@{Path=$file;Bytes=[Int64]$fi.Length}}
            }
          }catch{}
        }
        foreach($sub in [IO.Directory]::EnumerateDirectories($dir)){
          try{
            $di=[IO.DirectoryInfo]::new($sub)
            if(($di.Attributes -band [IO.FileAttributes]::ReparsePoint)-eq 0){$stack.Push($sub)}
          }catch{}
        }
      }catch{}
    }
    if($sw.Elapsed.TotalSeconds -ge $BudgetSeconds){break}
  }
  foreach($row in @($found | Sort-Object Bytes -Descending | Select-Object -First 30)){
    Write-Line ("VIRTUAL_DISK={0} SIZE={1}GiB" -f $row.Path,(GiB $row.Bytes))
  }
  Write-Line ("VIRTUAL_DISK_SCAN_PARTIAL={0} ELAPSED_MS={1}" -f ($sw.Elapsed.TotalSeconds -ge $BudgetSeconds),$sw.ElapsedMilliseconds)
}

try{ Remove-Item -LiteralPath $OutputFile -Force -ErrorAction SilentlyContinue }catch{}
$drive=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$total=[Int64]$drive.Size
$free=[Int64]$drive.FreeSpace
$used=$total-$free
Write-Line "[$Patch] C drive deep read-only census"
Write-Line ("START={0:yyyy-MM-dd HH:mm:ss}" -f (Get-Date))
Write-Line ("C_TOTAL={0}GiB C_USED={1}GiB C_FREE={2}GiB" -f (GiB $total),(GiB $used),(GiB $free))
Write-Line 'NOTE=No delete/cleanup action is performed. SCANNED values are logical file bytes; PARTIAL=True means the time budget ended before that tree completed.'

$profile=$env:USERPROFILE
$local=$env:LOCALAPPDATA
$roaming=$env:APPDATA

Write-SystemFile 'C:\hiberfil.sys'
Write-SystemFile 'C:\pagefile.sys'
Write-SystemFile 'C:\swapfile.sys'
Write-SystemFile 'C:\Windows\MEMORY.DMP'

try{
  $pf=Get-CimInstance Win32_PageFileUsage
  foreach($row in $pf){ Write-Line ("PAGEFILE_CIM={0} ALLOCATED={1}MB CURRENT={2}MB PEAK={3}MB" -f $row.Name,$row.AllocatedBaseSize,$row.CurrentUsage,$row.PeakUsage) }
}catch{}

$rootEntries=Get-ChildItem -LiteralPath 'C:\' -Force -ErrorAction SilentlyContinue
foreach($item in $rootEntries){
  try{
    if(-not $item.PSIsContainer){
      Write-Line ("ROOT_FILE={0} SIZE={1}GiB" -f $item.FullName,(GiB ([Int64]$item.Length)))
    } elseif($item.Name -in @('Windows.old','$WINDOWS.~BT','$WINDOWS.~WS')){
      $scan=Scan-ByFirstLevel $item.FullName 45
      Write-Scan ("ROOT_SPECIAL_"+$item.Name) $scan 20
    }
  }catch{}
}

$profileScan=Scan-ByFirstLevel $profile 90 @('AppData')
Write-Scan 'USER_PROFILE_EXCEPT_APPDATA' $profileScan 30

$localScan=Scan-ByFirstLevel $local 150
Write-Scan 'LOCALAPPDATA' $localScan 40

$roamingScan=Scan-ByFirstLevel $roaming 90
Write-Scan 'ROAMING_APPDATA' $roamingScan 30

$windowsScan=Scan-ByFirstLevel 'C:\Windows' 150
Write-Scan 'WINDOWS' $windowsScan 40

$programDataScan=Scan-ByFirstLevel 'C:\ProgramData' 120
Write-Scan 'PROGRAMDATA' $programDataScan 30

# Drill the heaviest LocalAppData categories one more level so a 100+ GiB aggregate
# such as Packages/Microsoft/Google/Tencent/Kingsoft is immediately attributable.
foreach($top in @($localScan.Rows | Where-Object {$_.Name -notmatch '^__'} | Select-Object -First 6)){
  $sub=Join-Path $local $top.Name
  $subScan=Scan-ByFirstLevel $sub 45
  Write-Scan ("LOCAL_DRILL_"+$top.Name) $subScan 25
}

Find-LargeVirtualDisks @($local,'C:\ProgramData') 60

Capture-Command 'VSS_SHADOW_STORAGE' 'vssadmin.exe' 'list shadowstorage /for=C:' 30
Capture-Command 'VSS_SHADOWS' 'vssadmin.exe' 'list shadows /for=C:' 30
Capture-Command 'DISM_COMPONENT_STORE' 'dism.exe' '/Online /English /Cleanup-Image /AnalyzeComponentStore' 120

try{
  $restore=Get-CimInstance -Namespace 'root/default' -ClassName SystemRestore
  Write-Line ("SYSTEM_RESTORE_POINTS={0}" -f @($restore).Count)
}catch{ Write-Line 'SYSTEM_RESTORE_POINTS=UNAVAILABLE' }

Write-Line ("DONE={0:yyyy-MM-dd HH:mm:ss}" -f (Get-Date))
