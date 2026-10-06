import fs from 'node:fs';
import assert from 'node:assert/strict';

const helper=fs.readFileSync('src/selectedDatePersistentTruth.js','utf8');
const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const whpp=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');
const home=fs.readFileSync('src/homeQualitySummary.js','utf8');

assert.match(helper,/business_final_rows/,'selected-date truth must read persisted final rows');
assert.match(helper,/raw\.currentState\|\|raw\.scanNormalizedState\|\|raw\.POD状态/,'persisted POD must match formal dashboard state semantics');
assert.match(helper,/String\(raw\.orderStatus\|\|''\)\.trim\(\)==='85'/,'persisted POD must accept orderStatus 85');
assert.match(helper,/sourceBills\(db,sourceType,date\)/,'POD truth must be intersected with exact daily source membership');
assert.match(repair,/persistentSelectedDatePodTruth\(getDb\(\),'WHPP',date\)/,'WHPP timing must use persisted POD truth first');
assert.match(repair,/persistentSelectedDatePodTruth\(getDb\(\),type,date\)/,'Shopee timing must use persisted POD truth first');
assert.match(repair,/persisted\.authoritative\|\|persisted\.bills\.length/,'authoritative zero-POD must not fall back to stale snapshots');
assert.match(whpp,/persistentWhppCompletionTruth\(db,date\)/,'WHPP completion must use persisted final-row receipt');
assert.match(home,/requestSelectedDateTimingRepair\(type,batch\.reportDate,batch\.snapshotId\)/,'selected-date home load must automatically retry missing timing evidence');
console.log('[V672] persisted selected-date truth is wired into WHPP progress + timing + automatic evidence repair');
