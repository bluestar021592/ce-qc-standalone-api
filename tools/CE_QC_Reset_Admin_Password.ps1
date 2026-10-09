# CE QC local ADMIN password recovery. Run only on the CE QC PC from
# Windows PowerShell using Run as administrator; NOT a web/API password reset.
# User chooses the password interactively; it is never put into process args.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw '请右键选择“以管理员身份运行”Windows PowerShell，然后重新执行此命令。'
    }
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $nodeScript = Join-Path $projectRoot 'scripts\reset-local-admin-password.mjs'
    if (-not (Test-Path -LiteralPath $nodeScript)) {
        throw '找不到本机密码恢复程序，请先完成 CE QC 版本更新。'
    }
    $ports = @(Get-NetTCPConnection -State Listen -LocalPort 5177,5179 -ErrorAction SilentlyContinue)
    if ($ports.Count -gt 0) {
        throw '请先关闭 CE QC 桌面启动窗口（5177/5179 服务须已停止），再执行重置。'
    }
    $nodeExe = ''
    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCmd -and $nodeCmd.Source) { $nodeExe = $nodeCmd.Source }
    if (-not $nodeExe -and $env:ProgramFiles) {
        $candidate = Join-Path $env:ProgramFiles 'nodejs\node.exe'
        if (Test-Path -LiteralPath $candidate) { $nodeExe = $candidate }
    }
    if (-not $nodeExe) { throw '没有找到 Node.js，请确认 CE QC 启动器已成功安装。' }
    $username = (Read-Host '请输入现有ADMIN管理员账号').Trim().ToLowerInvariant()
    if ($username -notmatch '^[a-z0-9_.-]{1,60}$') { throw '管理员账号格式不正确。' }
    $confirm = Read-Host ("即将重置 "+$username+"；请输入 YES 确认")
    if ($confirm -cne 'YES') { throw '已取消：没有修改任何账号。' }
    $secureA = Read-Host '请输入你自己设置的新密码（至少10位，输入内容隐藏）' -AsSecureString
    $secureB = Read-Host '请再输入一次新密码' -AsSecureString
    $bstrA = [IntPtr]::Zero
    $bstrB = [IntPtr]::Zero
    $textA = $null
    $textB = $null
    try {
        $bstrA = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureA)
        $bstrB = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureB)
        $textA = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstrA)
        $textB = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstrB)
        if ($textA -cne $textB) { throw '两次输入的密码不一致，未做修改。' }
        if ($textA.Length -lt 10 -or [Text.Encoding]::UTF8.GetByteCount($textA) -gt 72) {
            throw '密码至少10位，最多72个UTF-8字节；请重新选择。'
        }
        $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $json = @{username=$username;password=$textA} | ConvertTo-Json -Compress
        Push-Location -LiteralPath $projectRoot
        try {
            $json | & $nodeExe $nodeScript
            if ($LASTEXITCODE -ne 0) { throw '账号密码重置失败；数据库业务记录没有被清空。' }
        } finally { Pop-Location }
        Write-Host '重置成功。关闭此窗口，重新打开 CE QC 桌面启动器，用新密码登录。' -ForegroundColor Green
    } finally {
        $json = $null; $textA = $null; $textB = $null
        if ($bstrA -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstrA) }
        if ($bstrB -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstrB) }
        if ($secureA) { $secureA.Dispose() }
        if ($secureB) { $secureB.Dispose() }
    }
} catch {
    Write-Host ('[CE QC PASSWORD RESET] '+$_.Exception.Message) -ForegroundColor Red
    exit 1
}
