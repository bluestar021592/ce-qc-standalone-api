import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const whpp=fs.readFileSync(path.join(root,'src','whppStore.js'),'utf8');
const truth=fs.readFileSync(path.join(root,'src','whppCanonicalTruth.js'),'utf8');
const home=fs.readFileSync(path.join(root,'src','homeQualitySummary.js'),'utf8');

assert.match(server,/saveUnifiedImport\(parsed, req\.file\.originalname, \{ reuseExactDuplicate: true \}\)/,'exact duplicate unified import must reuse prior batch');
assert.match(server,/if\(ccslSameDate\) retainSameDayEvidence/,'CCSL same-day evidence preservation missing');
assert.match(server,/if\(shopeeSameDate\) retainSameDayEvidence/,'Shopee same-day evidence preservation missing');
assert.match(server,/saveWhppDailyImport\(\{/,'WHPP must be initialized by unified import');
assert.match(server,/loadWhppCanonicalTruth\(reportDate/,'WHPP board must use canonical truth merger');

assert.match(whpp,/WHPP_IDENTICAL_REIMPORT_PRESERVED/,'WHPP identical reimport preservation missing');
assert.match(whpp,/existingDaily\.exists && existingDaily\.identicalMembership/,'WHPP identical membership must be non-destructive');

assert.match(truth,/shipment_current_state/,'WHPP canonical truth must read current terminal state');
assert.match(truth,/business_final_rows/,'WHPP canonical truth must read final facts');
assert.match(truth,/business_scan_results/,'WHPP canonical truth must read scan facts');
assert.match(truth,/isPodEvidence/,'WHPP POD evidence merger missing');

assert.match(home,/LEFT JOIN shipment_current_state c/,'timing membership must read current terminal state');
assert.match(home,/LEFT JOIN business_scan_results s/,'Shopee timing membership must read scan truth');
assert.match(home,/loadWhppCanonicalTruth\(reportDate\)/,'WHPP timing must use canonical truth');
assert.match(home,/qc_tracking_ledger/,'timing evidence must retain ledger fallback');

console.log('[V638] same-day evidence preservation + WHPP canonical truth + timing membership smoke passed');
