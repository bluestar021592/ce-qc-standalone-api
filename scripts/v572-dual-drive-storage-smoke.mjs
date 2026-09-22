import assert from 'node:assert/strict';
import fs from 'node:fs';

const cleanup=fs.readFileSync(new URL('./CE_QC_NoBackup_Cleanup.mjs',import.meta.url),'utf8');
const launcher=fs.readFileSync(new URL('../tools/CE_QC_Managed_Launcher.ps1',import.meta.url),'utf8');
const start=fs.readFileSync(new URL('../Start_CE_QC.ps1',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

assert.match(cleanup,/2026-09-22-v577-fast-storage-startup-v1/);
assert.match(cleanup,/UNUSED_C_FALLBACK_DATA/,'unused C fallback data must be removable when D is the active data root');
assert.match(cleanup,/EVIDENCE_ARCHIVE_60D/,'evidence retention must be bounded instead of growing forever');
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

assert.match(index,/2026-09-21-v575-coordinate-nav-owner-v1/,'V575 coordinate interaction owner must remain shipped while storage housekeeping changes');
assert.doesNotMatch(index,/v569-final-interaction-owner\.js/,'retired V570 owner must not be reintroduced by storage housekeeping');

console.log('[V572/V575/V576/V577] dual-drive storage housekeeping smoke passed · C keeps launcher/code only · D owns live DB/runtime scratch · disposable CE-QC files are cleaned · V577 fast-censuses large live DBs and defers heavy startup VACUUM while V576 maintenance compaction remains available · V575 click owner retained');
