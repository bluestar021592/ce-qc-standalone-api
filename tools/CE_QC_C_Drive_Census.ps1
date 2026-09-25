param(
  [string]$OutputFile = ''
)

$ErrorActionPreference='SilentlyContinue'
$Patch='2026-09-25-v584-c-drive-bounded-census-v1'
if([string]::IsNullOrWhiteSpace($OutputFile)){
  $projectRoot=Split-Path -Parent $PSScriptRoot
  $logDir=Join-Path $projectRoot 'logs'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $OutputFile=Join-Path $logDir 'c_drive_census_latest.log'
}

function GiB([int64]$Bytes){ [math]::Round($Bytes/1GB,2) }
function Write-Line([string]$Text){
  try{ Add-Content -LiteralPath $OutputFile -Value $Text -Encoding UTF8 }catch{}
}

function Measure-BoundedFolder([string]$Root,[int]$BudgetSeconds=12){
  $result=[ordered]@{Root=$Root;Bytes=[int64]0;Files=[int64]0;Dirs=[int64]0;Partial=$false;ElapsedMs=0}
  if([string]::IsNullOrWhiteSpace($Root)-or -not (Test-Path -LiteralPath $Root)){ return [pscustomobject]$result }
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
          $fi=[IO.FileInfo]::new($filePath)
          $result.Bytes += [int64]$fi.Length
          $result.Files++
        }catch{}
        if(($result.Files % 512)-eq 0 -and $sw.Elapsed.TotalSeconds -ge $BudgetSeconds){$result.Partial=$true;break}
      }
      if($result.Partial){break}
      foreach($subPath in [IO.Directory]::EnumerateDirectories($dir)){
        try{
          $di=[IO.DirectoryInfo]::new($subPath)
          if(($di.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){continue}
          $stack.Push($subPath)
        }catch{}
      }
    }catch{}
  }
  $sw.Stop()
  $result.ElapsedMs=[int]$sw.ElapsedMilliseconds
  return [pscustomobject]$result
}

try{ Remove-Item -LiteralPath $OutputFile -Force -ErrorAction SilentlyContinue }catch{}
$drive=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$total=[int64]$drive.Size
$free=[int64]$drive.FreeSpace
$used=$total-$free
Write-Line "[$Patch] C drive bounded read-only census"
Write-Line ("C_TOTAL={0} GiB C_USED={1} GiB C_FREE={2} GiB" -f (GiB $total),(GiB $used),(GiB $free))
Write-Line 'NOTE=This report never deletes user files. Partial=true means the time budget ended before the whole folder was scanned.'

$roots=@(
  'C:\Windows',
  'C:\Program Files',
  'C:\Program Files (x86)',
  'C:\ProgramData',
  'C:\Users',
  $env:LOCALAPPDATA,
  $env:APPDATA,
  (Join-Path $env:USERPROFILE 'Downloads'),
  (Join-Path $env:USERPROFILE 'Documents'),
  (Join-Path $env:USERPROFILE 'Desktop'),
  (Join-Path $env:LOCALAPPDATA 'CE_QC_LAUNCHER')
) | Where-Object { $_ } | Select-Object -Unique

$rows=@()
foreach($root in $roots){
  $budget=if($root -in @('C:\Windows','C:\Users','C:\Program Files','C:\Program Files (x86)','C:\ProgramData')){15}else{8}
  $row=Measure-BoundedFolder $root $budget
  $rows+=$row
  Write-Line ("ROOT={0} SIZE_SCANNED={1} GiB FILES={2} DIRS={3} PARTIAL={4} ELAPSED_MS={5}" -f $row.Root,(GiB $row.Bytes),$row.Files,$row.Dirs,$row.Partial,$row.ElapsedMs)
}

foreach($name in @('hiberfil.sys','pagefile.sys','swapfile.sys')){
  $p=Join-Path 'C:\' $name
  if(Test-Path -LiteralPath $p){
    try{
      $bytes=[int64](Get-Item -LiteralPath $p -Force).Length
      Write-Line ("SYSTEM_FILE={0} SIZE={1} GiB" -f $name,(GiB $bytes))
    }catch{}
  }
}
Write-Line ("DONE={0:yyyy-MM-dd HH:mm:ss}" -f (Get-Date))
