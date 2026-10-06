import fs from 'node:fs';
import assert from 'node:assert/strict';

const helper=fs.readFileSync('src/selectedDatePersistentTruth.js','utf8');
const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const whpp=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');
const legacy=fs.readFileSync('src/v42WhppPatch.js','utf8');
const home=fs.readFileSync('src/homeQualitySummary.js','utf8');
const canonical=fs.readFileSync('src/whppCanonicalTruth.js','utf8');

assert.match(helper,/FORMAL_DASHBOARD_MEMBERSHIP_SQL/,'Shopee selected-date POD truth must explicitly use formal dashboard membership SQL');
assert.match(helper,/LEFT JOIN business_final_rows/,'formal Shopee POD truth must include final rows');
assert.match(helper,/LEFT JOIN shipment_current_state/,'formal Shopee POD truth must include current state');
assert.match(helper,/LEFT JOIN business_scan_results/,'formal Shopee POD truth must include scan results');
assert.match(helper,/LEFT JOIN business_pod_locks/,'formal Shopee POD truth must include POD locks');
assert.match(helper,/loadWhppCanonicalTruth\(date,String\(batch\.snapshotId\|\|''\),db\)/,'WHPP selected-date POD truth must reuse formal canonical truth on the same DB');
assert.match(canonical,/dbOverride\|\|getDb\(\)/,'WHPP canonical truth must support caller DB sharing');
assert.match(repair,/persistentSelectedDatePodTruth\(getDb\(\),'WHPP',date\)/,'WHPP timing must use persisted canonical truth first');
assert.match(repair,/persistentSelectedDatePodTruth\(getDb\(\),type,date\)/,'Shopee timing must use persisted canonical truth first');
assert.match(repair,/persisted\.authoritative\|\|persisted\.bills\.length/,'authoritative zero-POD must not fall back to stale snapshots');
assert.match(whpp,/persistentWhppCompletionTruth\(db,date\)/,'modern WHPP completion must use selected-date persistent receipt');
assert.match(legacy,/persistentWhppCompletionTruth\(getDb\(\),requestedDate\)/,'legacy WHPP progress must use the same selected-date persistent receipt');
assert.match(home,/requestSelectedDateTimingRepair\(type,batch\.reportDate,batch\.snapshotId\)/,'selected-date home load must automatically retry missing timing evidence');
console.log('[V680] selected-date WHPP/Shopee truth is wired to the same formal dashboard evidence sources');
