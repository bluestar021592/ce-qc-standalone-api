$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $ProjectRoot 'CE_QC_Start.bat'
if (-not (Test-Path $Launcher)) { throw "未找到启动器：$Launcher" }

$Desktop = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop 'CE 质控APP启动.lnk'
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Launcher
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = 'CE EXPRESS 金边仓质量控制管理系统 - 自动同步 GitHub main 并启动'
$Shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,15"
$Shortcut.WindowStyle = 1
$Shortcut.Save()

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host 'CE 质控APP桌面启动按钮创建成功' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host "桌面位置：$ShortcutPath"
Write-Host '以后每次只需要双击桌面上的“CE 质控APP启动”。' -ForegroundColor Yellow
Write-Host '启动器会自动检查 GitHub main 更新，然后启动APP。' -ForegroundColor DarkGray
Start-Sleep -Seconds 3
