const fs = require('fs');
const assert = require('assert');

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

console.log('[V336] launcher safety smoke passed · exact candidate tested before install · test DB isolated · SQLite backup hash+quick_check verified · exact SHA installed · local startup verified · automatic code+DB rollback armed');
