# CE QC local ADMIN password recovery. Windows PowerShell 5 compatible (ASCII).
# Run only on the CE QC PC with elevated Windows PowerShell.
# This is a console-only operation; no internet or password-reset HTTP endpoint.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run Windows PowerShell as Administrator, then retry.'
    }
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $nodeScript = Join-Path $projectRoot 'scripts\reset-local-admin-password.mjs'
    if (-not (Test-Path -LiteralPath $nodeScript)) {
        throw 'CE QC reset tool not found. Update the CE QC desktop launcher first.'
    }
    $ports = @(Get-NetTCPConnection -State Listen -LocalPort 5177,5179 -ErrorAction SilentlyContinue)
    if ($ports.Count -gt 0) {
        throw 'Close the CE QC desktop launcher first. Ports 5177 and 5179 must be stopped.'
    }
    $nodeExe = ''
    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCmd -and $nodeCmd.Source) { $nodeExe = $nodeCmd.Source }
    if (-not $nodeExe -and $env:ProgramFiles) {
        $candidate = Join-Path $env:ProgramFiles 'nodejs\node.exe'
        if (Test-Path -LiteralPath $candidate) { $nodeExe = $candidate }
    }
    if (-not $nodeExe) { throw 'Node.js not found. Install CE QC launcher dependencies first.' }
    $username = (Read-Host 'Enter existing CE QC ADMIN username').Trim().ToLowerInvariant()
    if ($username -notmatch '^[a-z0-9_.-]{1,60}$') { throw 'Invalid administrator username.' }
    $confirm = Read-Host ("Type YES to confirm password reset for " + $username)
    if ($confirm -cne 'YES') { throw 'Cancelled. No account data changed.' }
    $secureA = Read-Host 'Enter new password (at least 10 characters; hidden)' -AsSecureString
    $secureB = Read-Host 'Confirm new password (hidden)' -AsSecureString
    $bstrA = [IntPtr]::Zero
    $bstrB = [IntPtr]::Zero
    $textA = $null
    $textB = $null
    $json = $null
    try {
        $bstrA = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureA)
        $bstrB = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureB)
        $textA = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstrA)
        $textB = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstrB)
        if ($textA -cne $textB) { throw 'Passwords do not match. No changes made.' }
        if ($textA.Length -lt 10 -or [Text.Encoding]::UTF8.GetByteCount($textA) -gt 72) {
            throw 'Password must be at least 10 characters and at most 72 UTF-8 bytes.'
        }
        $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $json = @{username=$username;password=$textA} | ConvertTo-Json -Compress
        Push-Location -LiteralPath $projectRoot
        try {
            $json | & $nodeExe $nodeScript
            if ($LASTEXITCODE -ne 0) { throw 'Password reset failed. No business data has been cleared.' }
        } finally { Pop-Location }
        Write-Host 'RESET SUCCESS. Restart CE QC launcher and sign in with your new password.' -ForegroundColor Green
    } finally {
        $json = $null; $textA = $null; $textB = $null
        if ($bstrA -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstrA) }
        if ($bstrB -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstrB) }
        if ($secureA) { $secureA.Dispose() }
        if ($secureB) { $secureB.Dispose() }
    }
} catch {
    Write-Host ('[CE QC PASSWORD RESET] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
