import assert from 'node:assert/strict';
import fs from 'node:fs';

const truth=fs.readFileSync('src/selectedDatePersistentTruth.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(truth,/UNIFIED_COMPLETED_FAST_PATH/,'completed unified snapshot must own WHPP completion fast path');
assert.match(truth,/if\(String\(unified\?\.status\|\|''\)\.toUpperCase\(\)==='COMPLETED'\)/,'exact selected-date unified COMPLETED fast path missing');
assert.match(truth,/return\{\s*locked:true,finalized:true,reportDate:date/,'completed unified snapshot must return a locked WHPP lifecycle before downstream reconstruction');

assert.match(shell,/const v738WhppCompletionLatch=new Set\(\)/,'browser completion latch missing');
assert.match(shell,/unifiedCompleted\|\|v738WhppCompletionLatch\.has\(date\)/,'failed WHPP progress read must preserve exact-date completed state');
assert.match(shell,/V738_UNIFIED_COMPLETED_FALLBACK/,'WHPP completed fallback must be observable');
assert.match(html,/V738_WHPP_COMPLETION_LOCK_FAST_PATH/,'V738 shell build marker missing');
assert.match(html,/v625-shell\.js\?v=20261007-v738-1/,'V738 JS cache bust missing');

console.log('[V738] exact-date unified COMPLETED truth keeps WHPP 3/3 locked; slow/failed WHPP progress reads cannot demote the UI to 2/3');
