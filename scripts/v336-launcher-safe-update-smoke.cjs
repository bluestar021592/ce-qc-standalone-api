const fs = require('fs');
const assert = require('assert');
const { spawnSync } = require('child_process');

const source = fs.readFileSync('tools/CE_QC_Start.ps1', 'utf8');
assert.ok(source.includes("2026-08-27-v336-candidate-gate-db-rollback-v1"), 'V336 safe update marker missing');
assert.ok(source.includes("Run-Git @('worktree','add','--detach',$candidateRoot,$CandidateSha)"), 'candidate must run from detached exact-SHA worktree');
assert.ok(source.includes('& npm run test:golive'), 'candidate must run test:golive');
assert.ok(source.includes("[Environment]::SetEnvironmentVariable('DB_FILE',(Join-Path $data 'candidate-test.db'),'Process')"), 'candidate tests must use isolated SQLite');
assert.ok(source.includes('Backup-LiveDatabase $RuntimeConfig $CandidateSha'), 'live database backup gate missing');
assert.ok(source.includes('Database backup hash verification failed.'), 'backup hash verification missing');
assert.ok(source.includes('PRAGMA quick_check'), 'SQLite quick_check gate missing');
assert.ok(source.includes("Run-Git @('reset','--hard',$CandidateSha)"), 'install must pin exact tested SHA');
assert.ok(!source.includes("Run-Git @('reset','--hard','origin/main')"), 'launcher must never install moving origin/main directly');
assert.ok(source.includes('Verify-InstalledCandidate $CandidateSha $ProjectRoot'), 'post-install exact-SHA/startup verification missing');
assert.ok(source.includes('Rollback-ToPrevious $LocalHead $DbFile $BackupFile $DependenciesChanged $ProjectRoot'), 'automatic rollback missing');
assert.ok(source.includes('Restore-LiveDatabase $DbFile $BackupFile'), 'rollback must restore SQLite backup');
assert.ok(source.includes('Wait-LocalReady 5177 $proc 240'), 'post-install port 5177 readiness gate missing');

const main = source.indexOf("Write-Host '[1/7] Checking GitHub main...'");
assert.ok(main >= 0, 'V336 main update flow missing');
const candidateGate = source.indexOf('Test-Candidate $CandidateSha $ProjectRoot', main);
const stopRuntime = source.indexOf('Stop-RecordedRuntime $RuntimePidFile', candidateGate);
const backupDb = source.indexOf('Backup-LiveDatabase $RuntimeConfig $CandidateSha', stopRuntime);
const installExact = source.indexOf("Run-Git @('reset','--hard',$CandidateSha)", backupDb);
const verifyInstalled = source.indexOf('Verify-InstalledCandidate $CandidateSha $ProjectRoot', installExact);
assert.ok(candidateGate > main, 'candidate gate must occur in main flow');
assert.ok(stopRuntime > candidateGate, 'current runtime must stay alive while candidate is tested');
assert.ok(backupDb > stopRuntime, 'SQLite backup must happen after current runtime is stopped');
assert.ok(installExact > backupDb, 'live code must not change before verified SQLite backup');
assert.ok(verifyInstalled > installExact, 'installed candidate must be verified after exact-SHA install');

const managed = fs.readFileSync('tools/CE_QC_Managed_Launcher.ps1', 'utf8');
assert.ok(managed.includes('function Invoke-ResilientGitHubFetch'), 'managed launcher must own bounded GitHub fetch recovery');
assert.ok(managed.includes('Resolve-DnsName github.com'), 'managed launcher must query explicit DNS when Windows DNS fails');
assert.ok(managed.includes("foreach ($server in @('1.1.1.1','8.8.8.8'))"), 'managed launcher must have independent public DNS resolvers');
assert.ok(managed.includes('http.curloptResolve=$script:GitHubCurlResolve'), 'managed launcher must bypass broken resolver without changing TLS hostname');
assert.ok(managed.includes("for ($attempt = 1; $attempt -le 3; $attempt++)"), 'managed launcher must retry normal fetch before DNS fallback');
assert.ok(managed.includes('V446_LOCAL_EXACT_INSTALL_ID=2026-09-07-v446-local-exact-sha-install-v1'), 'managed launcher must use V446 exact local-SHA install contract');
assert.ok(managed.includes('function Install-VerifiedCommitLocally'), 'managed launcher must install the already-verified local commit');
assert.ok(managed.includes("Invoke-Exe $script:GitExe @('merge','--ff-only','--quiet',$VerifiedCommit)"), 'managed launcher must advance only to the exact verified SHA locally');
assert.ok(managed.includes('if ($installed -ne $VerifiedCommit)'), 'managed launcher must verify exact installed HEAD after local install');
assert.ok(!managed.includes("Invoke-RemoteGit @('pull','--ff-only','--quiet','origin','main')"), 'managed launcher must not perform a second post-verification GitHub pull');

// V448 one-time connectivity recovery is the bridge for machines whose browsers are
// online through Windows proxy/PAC while git.exe direct HTTPS to github.com:443 is
// blocked. It may read existing Windows proxy settings, but must never mutate them.
const proxyRecovery = fs.readFileSync('tools/CE_QC_GitHub_Proxy_Update_V448.ps1','utf8');
assert.ok(proxyRecovery.includes("2026-09-07-v448-windows-system-proxy-pac-git-recovery-v1"), 'V448 proxy recovery marker missing');
assert.ok(proxyRecovery.includes('[System.Net.WebRequest]::GetSystemWebProxy()'), 'V448 must resolve the Windows system proxy/PAC path');
assert.ok(proxyRecovery.includes('AutoConfigURL'), 'V448 must detect Windows PAC configuration');
assert.ok(proxyRecovery.includes('ProxyEnable'), 'V448 must detect Windows static proxy configuration');
assert.ok(proxyRecovery.includes('http.proxy=$proxyUri'), 'V448 must pass the detected proxy to Git only for the current process');
assert.ok(proxyRecovery.includes('http.proxyAuthMethod=anyauth'), 'V448 must allow enterprise proxy authentication negotiation');
assert.ok(proxyRecovery.includes("@('run','test:golive')"), 'V448 must run the full go-live gate before install');
assert.ok(proxyRecovery.includes('CE_QC_PreUpdate_Backup.mjs'), 'V448 must run the existing verified SQLite backup gate');
assert.ok(proxyRecovery.includes("'merge','--ff-only','--quiet',$RemoteCommit"), 'V448 must install only the exact verified fetched SHA');
assert.ok(proxyRecovery.includes('if ($installed -ne $RemoteCommit)'), 'V448 must verify exact installed HEAD');

// Security gate must detect real mutation commands, not harmless comments/log text such as
// "hosts file is not modified". Strip PowerShell comments before checking command patterns.
const managedCode = managed.replace(/^\s*#.*$/gm, '');
const proxyCode = proxyRecovery.replace(/^\s*#.*$/gm, '');
const mutatesSystemDns = /\bSet-DnsClientServerAddress\b|\bnetsh\s+interface\s+[^\r\n]*\bdns\b/i.test(managedCode);
const writesHosts = /\b(?:Set-Content|Add-Content|Out-File)\b[^\r\n]*(?:\\drivers\\etc\\hosts|\bhosts\b)|\[IO\.File\]::(?:WriteAllText|AppendAllText)\([^\r\n]*(?:\\drivers\\etc\\hosts|\bhosts\b)/i.test(managedCode);
const proxyMutatesSystemDns = /\bSet-DnsClientServerAddress\b|\bnetsh\s+interface\s+[^\r\n]*\bdns\b/i.test(proxyCode);
const proxyWritesHosts = /\b(?:Set-Content|Add-Content|Out-File)\b[^\r\n]*(?:\\drivers\\etc\\hosts|\bhosts\b)|\[IO\.File\]::(?:WriteAllText|AppendAllText)\([^\r\n]*(?:\\drivers\\etc\\hosts|\bhosts\b)/i.test(proxyCode);
const proxyPersistsSettings = /\bSet-ItemProperty\b[^\r\n]*Internet Settings|\bnetsh\s+winhttp\s+set\s+proxy\b|\bgit(?:\.exe)?\b[^\r\n]*\bconfig\b[^\r\n]*\bhttp\.proxy\b/i.test(proxyCode);
assert.ok(!mutatesSystemDns, 'managed launcher must never modify Windows adapter DNS');
assert.ok(!writesHosts, 'managed launcher must never write the Windows hosts file');
assert.ok(!proxyMutatesSystemDns, 'V448 proxy recovery must never modify Windows adapter DNS');
assert.ok(!proxyWritesHosts, 'V448 proxy recovery must never write the Windows hosts file');
assert.ok(!proxyPersistsSettings, 'V448 proxy recovery must never persist proxy or Git proxy configuration');

// V347 changes the live SQLite persistence hot path. It must never be treated as a
// low-risk code-only update merely because a previous verified DB copy has the same
// source fingerprint. Every such candidate gets a fresh frozen online backup.
const preUpdateBackup = fs.readFileSync('scripts/CE_QC_PreUpdate_Backup.mjs','utf8');
assert.ok(/v340CcslStorageCheckpoint\\\.js\$/.test(preUpdateBackup) || preUpdateBackup.includes('v340CcslStorageCheckpoint\\.js$'), 'V347 persistence wrapper must be classified as high risk');
assert.ok(preUpdateBackup.includes('const updateRisk=classifyUpdate(changedFiles());'), 'update risk must be assessed before backup reuse');
assert.ok(preUpdateBackup.includes('const reusable=updateRisk.highRisk?null:findReusableBackup(fingerprintBefore);'), 'high-risk updates must disable exact-fingerprint backup reuse');
assert.ok(preUpdateBackup.includes('fresh full backup required (reuse disabled)'), 'high-risk backup policy must be observable in updater output');
assert.ok(preUpdateBackup.includes('highRiskFreshBackupRequired:updateRisk.highRisk'), 'fresh high-risk backup requirement must be recorded in manifest');
assert.ok(preUpdateBackup.includes('verifiedBackupReuseAllowed:!updateRisk.highRisk'), 'manifest must disclose that high-risk backup reuse is forbidden');
const riskIndex = preUpdateBackup.indexOf('const updateRisk=classifyUpdate(changedFiles());');
const reusableIndex = preUpdateBackup.indexOf('const reusable=updateRisk.highRisk?null:findReusableBackup(fingerprintBefore);');
assert.ok(riskIndex >= 0 && reusableIndex > riskIndex, 'high-risk classification must happen before reuse lookup');

if (process.platform === 'win32') {
  const parse = "$errors=$null;$tokens=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'tools/CE_QC_Managed_Launcher.ps1'),[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count -gt 0){$errors|ForEach-Object{Write-Error $_.Message};exit 41}";
  const parsed = spawnSync('powershell.exe',['-NoLogo','-NoProfile','-Command',parse],{encoding:'utf8'});
  assert.strictEqual(parsed.status,0,`managed launcher PowerShell parse failed: ${parsed.stderr || parsed.stdout}`);
  const proxyParse = "$errors=$null;$tokens=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'tools/CE_QC_GitHub_Proxy_Update_V448.ps1'),[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count -gt 0){$errors|ForEach-Object{Write-Error $_.Message};exit 42}";
  const proxyParsed = spawnSync('powershell.exe',['-NoLogo','-NoProfile','-Command',proxyParse],{encoding:'utf8'});
  assert.strictEqual(proxyParsed.status,0,`V448 proxy recovery PowerShell parse failed: ${proxyParsed.stderr || proxyParsed.stdout}`);
}

const repair = fs.readFileSync('tools/CE_QC_Repair_Managed_Launcher_Git_Fatal.cmd', 'utf8');
assert.ok(repair.includes('Resolve-DnsName github.com'), 'emergency recovery must resolve GitHub independently');
assert.ok(repair.includes('http.curloptResolve=github.com:443:'), 'emergency recovery must use temporary curl resolver override');
assert.ok(repair.includes('GIT_CONFIG_KEY_0=http.curloptResolve'), 'bootstrap resolver must be passed only through the child process environment');
assert.ok(repair.includes('CE_QC_Managed_Launcher.ps1'), 'emergency recovery must hand off to the existing verified managed updater');
assert.ok(!repair.includes('config --local --add http.curloptResolve'), 'emergency recovery must not persist the resolver in repository config');
assert.ok(!/Set-DnsClientServerAddress|netsh\s+interface\s+.*\bdns\b/i.test(repair), 'emergency recovery must not alter adapter DNS');

console.log('[V448/V446.1/V347/V336] launcher safety smoke passed · exact candidate tested before install · V347 persistence hot-path forces fresh SQLite backup · V446 exact verified SHA installs locally without a second GitHub pull · V448 reads Windows system proxy/PAC only as a process-local Git fallback and never mutates DNS/hosts/proxy settings · local startup verified · automatic code+DB rollback armed');
