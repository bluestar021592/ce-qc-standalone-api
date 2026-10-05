import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const truth=fs.readFileSync(path.join(root,'src','whppCanonicalTruth.js'),'utf8');
const home=fs.readFileSync(path.join(root,'src','homeQualitySummary.js'),'utf8');

assert.match(truth,/function loadRecoverableWhppSnapshot/,'WHPP recoverable snapshot reader missing');
assert.match(truth,/snapshotBills\.length!==current\.length/,'WHPP snapshot recovery must require exact member count');
assert.match(truth,/snapshotBills\.every\(\(bill,index\)=>bill===current\[index\]\)/,'WHPP snapshot recovery must require exact member identity');
assert.match(truth,/WHPP_DAILY_REIMPORT_NEW_LIFECYCLE/,'only reimport-invalidated WHPP snapshot may be rescued');
assert.match(truth,/snapshotRecoveredFinalRows/,'WHPP recovery evidence diagnostics missing');
assert.match(truth,/recoveredTrackEvents/,'WHPP recovered track evidence missing');

assert.match(home,/LEFT JOIN business_pod_locks p/,'Shopee timing must read durable POD locks');
assert.match(home,/p\.shipmentCode IS NOT NULL THEN 1/,'durable POD lock must restore timing POD membership');
assert.match(home,/whpp_recovered_snapshot/,'WHPP recovered snapshot events must feed timing evidence');
assert.match(home,/timingEvidence\(events\.get\(shipmentCode\)\|\|\[\]\)/,'timing remains strict event-derived');
assert.match(home,/strictLedgerTiming/,'ledger fallback must remain available');

console.log('[V639] exact-member WHPP snapshot rescue + durable Shopee POD lock timing smoke passed');
