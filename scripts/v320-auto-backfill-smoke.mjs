import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v320EvidenceAutoBackfill.js','src/v319TrendCacheFastPatch.js','src/v320DispatchMetricOverlay.js','public/v308-dashboard-read-bridge.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const backfill=fs.readFileSync('src/v320EvidenceAutoBackfill.js','utf8');
const route=fs.readFileSync('src/v319TrendCacheFastPatch.js','utf8');
const overlay=fs.readFileSync('src/v320DispatchMetricOverlay.js','utf8');
const ui=fs.readFileSync('public/v308-dashboard-read-bridge.js','utf8');

assert.doesNotMatch(route,/import '\.\/v320EvidenceAutoBackfill\.js';/,'web trend runtime must not auto-load evidence backfill during startup');
assert.match(backfill,/const CHUNK=50,CONCURRENCY=4/,'evidence repair implementation remains bounded at 50 tickets x 4 concurrency when explicitly run');
assert.match(backfill,/runV320EvidenceBackfillNow/,'repair capability must remain callable outside page-entry ownership');
assert.match(backfill,/processingBusy\(db\)/,'repair must still yield while foreground QC processing is active');
assert.match(backfill,/applyV246StrictAttemptEvidence/,'repaired attempt truth must persist through strict evidence owner');
assert.match(backfill,/persistFinalEvidence/,'repaired START/attempt truth must write back to historical final rows');
assert.match(backfill,/json_valid\(evidenceJson\)/,'malformed ledger evidence must remain safe');
assert.match(backfill,/json_valid\(l\.evidenceJson\)/,'candidate selection must tolerate malformed legacy evidence');
assert.match(overlay,/json_valid\(f\.attemptHistoryJson\)/,'historical metric reads must tolerate malformed attempt history');
assert.match(overlay,/RECONCILED_COMPLETED_DASHBOARD_CACHE_MATCHED_DENOMINATOR/,'current cards keep denominator-reconciled cache truth');
assert.doesNotMatch(ui,/setInterval\(\(\)=>\{if\(activeShopeeType\(\)\)loadTable\(true\);\},10000\)/,'visible page must not poll every 10s');
assert.doesNotMatch(ui,/\/api\/v315\/evidence-recheck/,'user-facing table must not force manual recheck just to render');

console.log('[V321] evidence repair isolation smoke passed · repair capability retained · startup auto-load retired · no 10s UI polling · malformed legacy JSON safe');
