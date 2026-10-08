import assert from 'node:assert/strict';
import fs from 'node:fs';

const truth=fs.readFileSync('src/selectedDatePersistentTruth.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(truth,/unifiedWhppSnapshotVerified/,'WHPP completion must verify an actual persisted WHPP child snapshot');
assert.match(truth,/businessType='WHPP' AND reportDate=\? AND snapshotId=\?/,'WHPP unified fast path must bind the exact selected-date child snapshot');
assert.match(truth,/unifiedCompleted&&unifiedChildStatus==='COMPLETED'&&unifiedWhppSnapshotVerified/,'aggregate COMPLETED alone must not finalize WHPP');
assert.doesNotMatch(truth,/\|\|unifiedCompleted\s*\n?\s*\)/,'bare unified completion must never be accepted as WHPP completion proof');
assert.match(truth,/Number\(canonical\?\.evidence\?\.scanRows\|\|0\)===sourceCount/,'every WHPP source member requires an actual scan');
assert.match(truth,/Number\(canonical\?\.evidence\?\.finalRows\|\|0\)===sourceCount/,'every WHPP source member requires persisted final evidence');
assert.match(truth,/Boolean\(evidence\.pod\)!==Boolean\(evidence\.returned\)/,'WHPP terminal truth must be exclusive POD or returned');
assert.match(truth,/terminalEvidenceVerified/,'historical WHPP exact terminal evidence must be an observable completion owner');

assert.match(shell,/const v738WhppCompletionLatch=new Set\(\)/,'browser completion latch missing');
assert.match(shell,/if\(v738WhppCompletionLatch\.has\(date\)&&!whppPayload\?\.completionLock\?\.locked\)/,'browser may retain only a previously verified WHPP completion lock');
assert.doesNotMatch(shell,/ccsl=projectComplete\(ccsl,'CCSL'\)/,'unified snapshot status must not fabricate CCSL completion');
assert.doesNotMatch(shell,/shopee=projectComplete\(shopee,'SHOPEE'\)/,'unified snapshot status must not fabricate SHOPEE completion');
assert.doesNotMatch(shell,/V752_UNIFIED_COMPLETED_3OF3/,'retired aggregate 3-of-3 projection must stay removed');
assert.match(shell,/v752TerminalProgressLogs/,'terminal progress logs must remain deduplicated across polling ticks');
assert.match(html,/v625-shell\.js\?v=20261007-v750-1&patch=758/,'V758 shell cache bust missing');

console.log('[V754/V738] unified COMPLETED alone cannot finalize WHPP; an exact persisted WHPP child snapshot or full terminal scan+final proof can lock completion; browser aggregate 3-of-3 projection stays removed');
