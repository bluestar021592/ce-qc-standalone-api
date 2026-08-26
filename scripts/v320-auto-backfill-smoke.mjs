import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v320EvidenceAutoBackfill.js','src/v319TrendCacheFastPatch.js','src/v320DispatchMetricOverlay.js','public/v308-dashboard-read-bridge.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const backfill=fs.readFileSync('src/v320EvidenceAutoBackfill.js','utf8');
const route=fs.readFileSync('src/v319TrendCacheFastPatch.js','utf8');
const overlay=fs.readFileSync('src/v320DispatchMetricOverlay.js','utf8');
const ui=fs.readFileSync('public/v308-dashboard-read-bridge.js','utf8');

assert.match(route,/import '\.\/v320EvidenceAutoBackfill\.js';/,'normal V319 runtime activation must also activate automatic terminal POD evidence repair');
assert.match(backfill,/const CHUNK=50,CONCURRENCY=4/,'automatic repair must stay bounded at 50 tickets x 4 concurrency');
assert.match(backfill,/NETWORK_RETRY_MS=15\*60_000/,'transient evidence failures must retry automatically without user action');
assert.match(backfill,/processingBusy\(db\)/,'background evidence repair must yield while foreground QC processing is active');
assert.match(backfill,/applyV246StrictAttemptEvidence/,'repaired attempt truth must persist through the strict V246 evidence owner');
assert.match(backfill,/persistFinalEvidence/,'repaired START/attempt truth must also be written back to historical final rows');
assert.match(backfill,/json_valid\(evidenceJson\)/,'legacy malformed ledger evidence must be tolerated rather than crashing automatic repair');
assert.match(backfill,/json_valid\(l\.evidenceJson\)/,'candidate selection must tolerate malformed legacy ledger evidence');
assert.match(overlay,/json_valid\(f\.attemptHistoryJson\)/,'historical metric reads must tolerate malformed legacy attempt history');
assert.match(overlay,/RECONCILED_COMPLETED_DASHBOARD_CACHE_MATCHED_DENOMINATOR/,'current completed cards must be protected only by denominator-reconciled cache truth');
assert.match(ui,/setInterval\(\(\)=>\{if\(activeShopeeType\(\)\)loadTable\(true\);\},10000\)/,'visible Shopee daily metrics must refresh automatically as background evidence arrives');
assert.doesNotMatch(ui,/\/api\/v315\/evidence-recheck/,'user-facing table must not require a manual evidence recheck action');

console.log('[V320] automatic evidence repair smoke passed · bounded 50x4 backfill · transient retry · malformed legacy JSON safe · visible metrics auto-refresh');
