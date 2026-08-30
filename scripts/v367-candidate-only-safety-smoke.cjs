const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('tools/CE_QC_Candidate_Only.ps1', 'utf8').replace(/\r\n/g, '\n');

assert.match(source, /^param\(/, 'PowerShell param block must be the first executable construct');
assert.ok(source.includes('2026-08-30-v367-isolated-candidate-only-no-live-mutation-v1'), 'V367 candidate-only marker missing');
assert.ok(source.includes("$CandidateRef = 'recovery/20260830-daily-chain'"), 'candidate-only default must target the isolated recovery branch, never moving main');
assert.ok(source.includes("$ExpectedSha = ([string]$env:CE_QC_CANDIDATE_SHA).Trim()"), 'exact SHA pin must be supported');
assert.ok(source.includes("Run-Git @('fetch','origin',$CandidateRef) -AllowFailure"), 'candidate-only mode must fetch only the requested candidate ref');
assert.ok(source.includes("Git-Text @('rev-parse','FETCH_HEAD')"), 'candidate ref must resolve to one exact fetched SHA');
assert.ok(source.includes('Candidate SHA mismatch.'), 'explicit SHA mismatch must fail closed');
assert.ok(source.includes("Run-Git @('worktree','add','--detach',$CandidateRoot,$CandidateSha)"), 'candidate must run from a detached exact-SHA temporary worktree');
assert.ok(source.includes("[Environment]::SetEnvironmentVariable('DB_FILE',(Join-Path $data 'candidate-test.db'),'Process')"), 'candidate-only tests must use isolated candidate-test.db');
assert.ok(source.includes("[Environment]::SetEnvironmentVariable('PORT','5199','Process')"), 'candidate-only runtime must never use live port 5177');
assert.ok(source.includes('& npm ci --no-audit --no-fund'), 'candidate dependencies must install only inside temporary worktree');
assert.ok(source.includes('& npm run test:golive'), 'candidate-only runner must execute the full release gate');
assert.ok(source.includes("Git-Text @('rev-parse','HEAD')"), 'live HEAD must be captured before and after validation');
assert.ok(source.includes('git status --porcelain --untracked-files=no'), 'tracked live worktree state must be captured before and after validation');
assert.ok(source.includes('LIVE_HEAD_MUTATED'), 'any live HEAD mutation must fail closed');
assert.ok(source.includes('LIVE_TRACKED_WORKTREE_MUTATED'), 'any tracked live worktree mutation must fail closed');
assert.ok(source.includes('CANDIDATE_ONLY_PASS'), 'successful isolated validation must have one explicit terminal marker');
assert.ok(source.includes('Live SQLite path was never resolved or opened. No installation was performed.'), 'success message must disclose the candidate-only safety boundary');

const forbidden = [
  'Stop-RecordedRuntime',
  'Stop-LegacySupervisors',
  'Stop-PortOwners',
  'Get-PortOwnerPids',
  'taskkill.exe',
  'Backup-LiveDatabase',
  'Restore-LiveDatabase',
  'Get-LiveRuntimeConfig',
  'Invoke-SqliteCheck',
  "Run-Git @('reset'",
  "Run-Git @('switch'",
  'Start_CE_QC.ps1',
  'ce_qc_monitor.db',
  'Copy-Item',
  'Start-Process'
];
for (const token of forbidden) assert.ok(!source.includes(token), `candidate-only validator must never contain live mutation capability: ${token}`);

const fetchAt = source.indexOf("Run-Git @('fetch','origin',$CandidateRef) -AllowFailure");
const shaAt = source.indexOf("Git-Text @('rev-parse','FETCH_HEAD')", fetchAt);
const worktreeAt = source.indexOf("Run-Git @('worktree','add','--detach',$CandidateRoot,$CandidateSha)", shaAt);
const pushAt = source.indexOf('Push-Location $CandidateRoot', worktreeAt);
const dbAt = source.indexOf("[Environment]::SetEnvironmentVariable('DB_FILE',(Join-Path $data 'candidate-test.db'),'Process')");
const npmCiAt = source.indexOf('& npm ci --no-audit --no-fund', pushAt);
const goliveAt = source.indexOf('& npm run test:golive', npmCiAt);
const liveAfterAt = source.indexOf("$LiveHeadAfter = Git-Text @('rev-parse','HEAD')", goliveAt);
assert.ok(fetchAt >= 0 && shaAt > fetchAt, 'candidate ref must resolve to exact SHA after fetch');
assert.ok(worktreeAt > shaAt && pushAt > worktreeAt, 'exact SHA must be detached before entering candidate worktree');
assert.ok(dbAt >= 0 && dbAt < npmCiAt, 'isolated DB environment must be defined before candidate dependencies/tests execute');
assert.ok(npmCiAt > pushAt && goliveAt > npmCiAt, 'npm ci and test:golive must execute only after entering temporary candidate worktree');
assert.ok(liveAfterAt > goliveAt, 'live HEAD must be reverified after the complete candidate gate');

const headCaptures = (source.match(/Git-Text @\('rev-parse','HEAD'\)/g) || []).length;
const trackedCaptures = (source.match(/git status --porcelain --untracked-files=no/g) || []).length;
assert.equal(headCaptures, 2, 'candidate-only validator must capture live HEAD exactly before and after validation');
assert.equal(trackedCaptures, 2, 'candidate-only validator must capture tracked live worktree exactly before and after validation');

console.log('[V367] candidate-only safety smoke passed · recovery ref + optional exact SHA · detached temp worktree · candidate-test.db/5199 · full test:golive · no live runtime/SQLite/install mutation capability · live HEAD and tracked files verified unchanged');
