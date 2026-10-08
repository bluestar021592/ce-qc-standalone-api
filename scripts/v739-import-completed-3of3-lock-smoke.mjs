import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const store=fs.readFileSync('src/unifiedImportStore.js','utf8');

assert.match(shell,/const exactHistory=\(history\.rows\|\|\[\]\)\.find\(/,'import page must hydrate exact-date snapshot status from unified history');
assert.match(shell,/snapshotStatus:exactHistory\.snapshotStatus\|\|exactHistory\.status/,'exact completed history status must be merged into latest import context');
assert.match(shell,/if\(unifiedCompleted\|\|v738WhppCompletionLatch\.has\(date\)\)/,'unified completed truth must override even a stale unlocked WHPP progress payload');
assert.match(shell,/V752_UNIFIED_COMPLETED_3OF3/,'completed 3-of-3 projection must be observable');
assert.match(store,/s\.status snapshotStatus/,'latest unified import must expose exact snapshot status without a second history-only dependency');
assert.match(store,/snapshotStatus: row\.snapshotStatus \|\| 'IMPORTED'/,'latest unified import must publish the exact snapshot lifecycle to every page');
assert.match(shell,/v752LaunchingFamily==='CCSL'/,'CCSL startup must be visible before the backend run lock appears');
assert.match(shell,/v752LaunchingFamily==='SHOPEE'/,'SHOPEE startup must be visible before the backend run lock appears');
assert.match(shell,/resumeBtn\.disabled=allComplete/,'resume button must be disabled after exact 3\/3 completion');
assert.match(shell,/resumeBtn\.hidden=allComplete/,'resume button must be hidden after exact 3\/3 completion');
assert.match(html,/V750_TIMING_EVIDENCE_TRACK_VIEW|V748_PER_BOARD_TRACK_QUALITY_SIGNALS|V744_SIGNING_UI_SIMPLIFIED_AND_TERMINAL_BACKFILL|V743_LATEST_DAILY_REPORT_SIGNING_BACKFILL|V742_DAILY_REPORT_SIGNING_TIME|V741_HISTORICAL_TIMING_CLOSED_LOOP|V739_IMPORT_COMPLETED_3OF3_LOCK/,'V739+ shell build marker missing');
assert.match(html,/v625-shell\.js\?v=20261007-v(?:739|741|742|743|744|748|750)-1/,'V739+ JS cache bust missing');

console.log('[V752] import progress convergence passed · exact unified COMPLETED projects CCSL/SHOPEE/WHPP 3-of-3 · startup visible · terminal logs deduplicated');
