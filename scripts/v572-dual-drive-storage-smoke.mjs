import assert from 'node:assert/strict';
import fs from 'node:fs';

const cleanup=fs.readFileSync(new URL('./CE_QC_NoBackup_Cleanup.mjs',import.meta.url),'utf8');
const dedicated=fs.readFileSync(new URL('../tools/CE_QC_Dedicated_Drive_Cleanup.ps1',import.meta.url),'utf8');
const launcher=fs.readFileSync(new URL('../tools/CE_QC_Managed_Launcher.ps1',import.meta.url),'utf8');
const start=fs.readFileSync(new URL('../Start_CE_QC.ps1',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

assert.match(cleanup,/2026-09-26-v588-no-backup-storage-cleanup-v1/);
// No-new-backup mode is not permission to delete old recovery evidence.
assert.doesNotMatch(cleanup,/\{kind:'(?:DATA_BACKUPS|LEGACY_C_RUNTIME_BACKUPS|LAUNCHER_BACKUPS|UNUSED_C_FALLBACK_DATA)'/,'startup must not silently purge existing backup or legacy business roots');
assert.doesNotMatch(cleanup,/retireBackupRecords\(/,'existing backup metadata must remain truthful');
assert.match(cleanup,/EVIDENCE_ARCHIVE_PRESERVED/,'V266 historical evidence must survive startup indefinitely until explicit authorized cleanup');
assert.doesNotMatch(cleanup,/removeChildren\(cfg\.evidenceArchiveDir/,'366 days is a minimum retention, never an automatic deletion date');
assert.doesNotMatch(cleanup,/removeChildren\(cfg\.importsDir/,'unarchived original Excel uploads must not disappear at startup');
assert.match(dedicated,/\$ceC = @\(/,'dedicated C cleanup still identifies CE-owned scratch');
const ceRoots=dedicated.slice(dedicated.indexOf('$ceC = @('),dedicated.indexOf('foreach ($p in $ceC)'));
assert.doesNotMatch(ceRoots,/CE_QC_RUNTIME\\backups|CE_QC_LAUNCHER\\backups/,'Windows C startup cleanup must preserve old backup roots');
assert.match(cleanup,/EVIDENCE_RETENTION_DAYS=366/,'historical evidence retention must protect long-range operational audits');
assert.match(cleanup,/has20260701/,'startup storage census must report whether the July 1 evidence day still exists');
assert.match(cleanup,/C_CRASH_LOGS_45D/,'launcher crash logs on C must age out');
assert.match(cleanup,/cleanupNamedTempRoots\(os\.tmpdir\(\)\)/,'legacy CE-QC temp roots on C must be cleaned');
assert.match(cleanup,/driveSnapshot\(cRoot\)/,'C drive free-space change must be reported');
assert.match(cleanup,/driveSnapshot\(dRoot\)/,'D drive free-space change must be reported');
assert.match(cleanup,/LIVE_BUSINESS_DATA_IS_NEVER_SILENTLY_DELETED/,'live database data must never be silently purged by housekeeping');
assert.match(cleanup,/compactSqliteStorage/,'startup housekeeping must analyze and safely reclaim SQLite free pages even while live rows remain');
assert.match(cleanup,/INSUFFICIENT_FREE_SPACE_FOR_SAFE_VACUUM/,'live-data compaction must fail closed when the drive cannot safely hold VACUUM scratch');

assert.match(launcher,/D:\\CE_QC_TEST_TEMP\\candidate_tests/,'candidate tests must put heavy scratch on D when D is available');
assert.match(launcher,/\$env:TEMP = \$candidateScratch/);
assert.match(launcher,/\$env:TMP = \$candidateScratch/);
assert.match(launcher,/\$env:TEMP = \$oldTemp/,'candidate temp redirect must be process-local and restored');

assert.match(start,/D:\\CE_QC_RUNTIME_TEMP\\runtime/,'normal runtime scratch must prefer D');
assert.match(start,/\$env:TEMP = \$RuntimeScratch/);
assert.match(start,/\$env:TMP = \$RuntimeScratch/);

assert.match(index,/v581-stable-shell-owner\.js\?v=20260929-v600-1/,'V600 stable shell must remain shipped while storage housekeeping changes');
assert.doesNotMatch(index,/installV575CoordinateOwner|v580-visible-shell-recovery\.js|v569-final-interaction-owner\.js/,'retired layered shell owners must not be reintroduced by storage housekeeping');

console.log('[V788] dual-drive storage smoke passed · existing backups, originals and V266 archive retained · CE scratch disposable · live SQLite rows protected');
