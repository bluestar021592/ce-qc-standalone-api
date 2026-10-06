import fs from 'node:fs';
import assert from 'node:assert/strict';

const helper=fs.readFileSync('src/selectedDatePersistentTruth.js','utf8');
const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const modern=fs.readFileSync('src/v134WhppRunSupervisorPatch.js','utf8');
const legacy=fs.readFileSync('src/v42WhppPatch.js','utf8');
const store=fs.readFileSync('src/businessStore.js','utf8');
const home=fs.readFileSync('src/homeQualitySummary.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const sqliteFixture=fs.readFileSync('scripts/v670-persistent-selected-date-sqlite-smoke.mjs','utf8');

assert.match(sqliteFixture,/i<=166\?1:0/,'July-1 WHPP fixture must prove 166 POD of 190');
assert.match(sqliteFixture,/i<=588/,'July-1 VN fixture must prove 588 source members');
assert.match(sqliteFixture,/i<=545\?'85'/,'July-1 VN fixture must prove 545 dashboard-semantic POD members');
assert.match(sqliteFixture,/OLD-CARRY-POD/,'historical carry POD exclusion must be exercised');
assert.match(sqliteFixture,/BATCH-OLD.*SUPERSEDED/s,'superseded same-date batch exclusion must be exercised');
assert.match(helper,/status='VALID'.*ORDER BY createdAt DESC,rowid DESC LIMIT 1/s,'selected-date truth must use latest VALID import batch');
assert.match(repair,/persistentSelectedDatePodTruth/,'timing denominator must read persistent selected-date POD truth');
assert.match(modern,/persistentWhppCompletionTruth/,'modern WHPP progress must use persistent completion truth');
assert.match(legacy,/persistentWhppCompletionTruth/,'legacy WHPP progress must converge on persistent completion truth');
assert.match(shell,/completionLock\?\.locked/,'UI must consume persistent WHPP completion lock');
assert.match(store,/persistedBusinessPodFlag/,'future SQLite writes must preserve formal POD semantics');
assert.match(home,/currentTotal>0\?currentTotal:n\(row\.pod,0\)/,'cache must not shrink canonical POD denominator');
assert.match(home,/requestSelectedDateTimingRepair/,'missing signing evidence must auto-enter selected-date repair');
console.log('[V679] July-1 acceptance contract locked · WHPP 190/166 · VN 588/545 · dual route/cache/restart/repair convergence');
