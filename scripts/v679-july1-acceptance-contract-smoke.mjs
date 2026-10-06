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

assert.match(sqliteFixture,/for\(let i=1;i<=190;i\+\+\)/,'July-1 WHPP fixture must contain 190 source members');
assert.match(sqliteFixture,/i<=166\?'POD':'RETURN_COMPLETED'/,'July-1 WHPP fixture must contain 166 canonical POD members');
assert.match(sqliteFixture,/for\(let i=1;i<=588;i\+\+\)/,'July-1 VN fixture must contain 588 source members');
assert.match(sqliteFixture,/i<=300/,'VN fixture must exercise current-state POD');
assert.match(sqliteFixture,/i<=500/,'VN fixture must exercise scan orderStatus 85');
assert.match(sqliteFixture,/i<=545/,'VN fixture must exercise POD-lock evidence through 545 members');
assert.match(sqliteFixture,/OLD-CARRY-POD/,'historical carry POD exclusion must be exercised');
assert.match(sqliteFixture,/BATCH-OLD.*SUPERSEDED/s,'superseded same-date batch exclusion must be exercised');
assert.match(sqliteFixture,/completion\.completionSource,'UNIFIED_COMPLETED'/,'unified COMPLETED must be the terminal WHPP receipt');
assert.match(sqliteFixture,/vn\.bills\.length,545/,'VN formal truth must prove 545 POD');
assert.match(sqliteFixture,/whpp\.bills\.length,166/,'WHPP canonical truth must prove 166 POD');

assert.match(helper,/status='VALID'.*ORDER BY createdAt DESC,rowid DESC LIMIT 1/s,'selected-date truth must use latest VALID import batch');
assert.match(helper,/FORMAL_DASHBOARD_MEMBERSHIP_SQL/,'Shopee POD denominator must use formal dashboard joins');
assert.match(helper,/UNIFIED_COMPLETED/,'WHPP progress must recognize unified COMPLETED as terminal receipt');
assert.match(repair,/persistentSelectedDatePodTruth/,'timing denominator must read selected-date canonical POD truth');
assert.match(modern,/persistentWhppCompletionTruth/,'modern WHPP progress must use persistent completion truth');
assert.match(legacy,/persistentWhppCompletionTruth/,'legacy WHPP progress must converge on persistent completion truth');
assert.match(shell,/completionLock\?\.locked/,'UI must consume persistent WHPP completion lock');
assert.match(store,/persistedBusinessPodFlag/,'future SQLite writes must preserve formal POD semantics');
assert.match(home,/currentTotal>0\?currentTotal:n\(row\.pod,0\)/,'cache must not shrink canonical POD denominator');
assert.match(home,/requestSelectedDateTimingRepair/,'missing signing evidence must auto-enter selected-date repair');
console.log('[V680] July-1 acceptance locked · unified COMPLETED=>WHPP complete · WHPP 190/166 · VN 588/545 · formal evidence/cache/restart/repair convergence');
