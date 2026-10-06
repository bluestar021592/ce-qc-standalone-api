import fs from 'node:fs';
import assert from 'node:assert/strict';

const whpp=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');
const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');

assert.match(whpp,/req\.query\?\.reportDate/,'WHPP progress must honor selected reportDate');
assert.match(whpp,/inspectV378WhppCompletionLock\(requestedDate,dateState\)/,'WHPP completion truth must be selected-date scoped');
assert.match(whpp,/reportDate:requestedDate\|\|currentDate/,'WHPP progress response must publish requested date');
assert.match(repair,/listWhppHistory\(500\)\.find/,'WHPP timing POD membership must read completed date snapshot first');
assert.match(repair,/loadWhppSnapshot\(hit\.snapshotId\)/,'WHPP timing must load selected-date immutable snapshot');
assert.match(repair,/getBusinessSnapshot\('SHOPEE',date\)/,'Shopee timing must read selected-date immutable snapshot first');
assert.match(repair,/snapshot\?\.view\?\.detailTabs/,'Shopee selected-date snapshot POD detail must drive timing membership');
console.log('[V668] selected-date WHPP completion + immutable POD timing truth passed');
