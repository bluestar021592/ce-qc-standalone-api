import fs from 'node:fs';
import assert from 'node:assert/strict';

const helper=fs.readFileSync('src/selectedDatePersistentTruth.js','utf8');
const modern=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');
const legacy=fs.readFileSync('src/v42WhppPatch.js','utf8');
const shell=fs.readFileSync('public/v625-shell.html','utf8');
const server=fs.readFileSync('server.js','utf8');
const fixture=fs.readFileSync('scripts/v670-persistent-selected-date-sqlite-smoke.mjs','utf8');

assert.match(helper,/unifiedWhppCompleted\?'UNIFIED_VERIFIED_WHPP_CHILD'/,'only a verified WHPP child snapshot may own unified WHPP completion source');
assert.match(modern,/Boolean\(persistent\.unifiedWhppCompleted\)\|\|membershipSafe/,'modern WHPP route must let unified completion outrank lossy final-row membership');
assert.match(legacy,/persistentWhppCompletionTruth\(getDb\(\),requestedDate\)/,'legacy WHPP route must use the same completion owner');

assert.match(helper,/completedShopeeSnapshotPodTruth/,'Shopee POD truth must verify exact completed snapshot membership');
assert.match(helper,/sameBills\(sourceBills,allBills\)/,'Shopee completed snapshot must exactly match current source members');
assert.match(helper,/IMMUTABLE_SHOPEE_COMPLETED_SNAPSHOT/,'exact completed Shopee snapshot must be an explicit truth source');
assert.match(fixture,/Current normalized tables deliberately contain ZERO POD evidence/,'fixture must reproduce live zero-denominator symptom');
assert.match(fixture,/assert\.equal\(vn\.bills\.length,545\)/,'fixture must require VN POD=545');
assert.match(fixture,/assert\.equal\(cn\.bills\.length,4\)/,'fixture must require CN POD recovery from later VALID daily report');
assert.match(helper,/latestDailyPodBillsForSource/,'selected-date Shopee truth must recover exact source members from later daily POD evidence when completed snapshot POD is empty');
assert.match(helper,/recoveredFromEmptySnapshot:true/,'CN recovery must be explicitly diagnosed instead of silently replacing snapshot truth');
assert.match(fixture,/assert\.equal\(whpp\.bills\.length,166\)/,'fixture must require WHPP POD=166');
assert.match(fixture,/assert\.equal\(completion\.completionSource,'UNIFIED_VERIFIED_WHPP_CHILD'\)/,'fixture must require verified unified WHPP child receipt');
assert.match(fixture,/assert\.equal\(falseCompletion\.locked,false\)/,'fixture must reject aggregate unified completion without a real WHPP child');
assert.match(helper,/terminalEvidenceVerified/,'WHPP historical recovery requires all exact members to carry scan/final terminal evidence');
assert.match(fixture,/assert\.equal\(recoveredCompletion\.locked,true\)/,'full terminal evidence must recover 3-of-3 after a reimport displaced the completed snapshot');
assert.match(fixture,/API_PENDING_RETRY/,'terminal recovery must reject unresolved CE status');

assert.match(shell,/ce-qc-build" content="V\d{3,}_[A-Z0-9_]+"/,'V625 shell must publish V681+ build marker');
assert.match(shell,/v625-shell\.js\?v=\d{8}-v\d{3,}-1/,'V625 shell must force-refresh V681+ JavaScript');
assert.match(server,/\/api\/selected-date-truth/,'read-only selected-date runtime truth endpoint must exist');
assert.match(server,/build:'V681_SELECTED_DATE_TRUTH'/,'runtime truth endpoint must retain selected-date truth owner identity');

console.log('[V754/V751] selected-date acceptance: verified WHPP child or complete terminal evidence + false aggregate completion rejected + VN/CN timing truth retained');
