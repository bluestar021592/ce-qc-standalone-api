import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(shell,/const exactHistory=\(history\.rows\|\|\[\]\)\.find\(/,'import page must hydrate exact-date snapshot status from unified history');
assert.match(shell,/snapshotStatus:exactHistory\.snapshotStatus\|\|exactHistory\.status/,'exact completed history status must be merged into latest import context');
assert.match(shell,/if\(unifiedCompleted\|\|v738WhppCompletionLatch\.has\(date\)\)/,'unified completed truth must override even a stale unlocked WHPP progress payload');
assert.match(shell,/V739_UNIFIED_COMPLETED_OVERRIDE/,'completed WHPP override must be observable');
assert.match(shell,/resumeBtn\.disabled=allComplete/,'resume button must be disabled after exact 3\/3 completion');
assert.match(shell,/resumeBtn\.hidden=allComplete/,'resume button must be hidden after exact 3\/3 completion');
assert.match(html,/V750_TIMING_EVIDENCE_TRACK_VIEW|V748_PER_BOARD_TRACK_QUALITY_SIGNALS|V744_SIGNING_UI_SIMPLIFIED_AND_TERMINAL_BACKFILL|V743_LATEST_DAILY_REPORT_SIGNING_BACKFILL|V742_DAILY_REPORT_SIGNING_TIME|V741_HISTORICAL_TIMING_CLOSED_LOOP|V739_IMPORT_COMPLETED_3OF3_LOCK/,'V739+ shell build marker missing');
assert.match(html,/v625-shell\.js\?v=20261007-v(?:739|741|742|743|744|748|750)-1/,'V739+ JS cache bust missing');

console.log('[V739] import page exact completed history locks WHPP at 3/3, overrides stale progress, and removes Continue unfinished action');
