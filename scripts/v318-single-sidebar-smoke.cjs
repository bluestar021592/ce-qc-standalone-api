const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');

for(const file of ['public/v318-single-sidebar-owner.js','public/v169-seven-business-legacy-status-sync.js','src/v295FirstAttemptUiInjectionPatch.js','src/v44WhppUiPatch.js','src/v132WhppFastIntegrationPatch.js','src/whppStore.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}
const ui=fs.readFileSync('public/v318-single-sidebar-owner.js','utf8');
const completionGuard=fs.readFileSync('public/v169-seven-business-legacy-status-sync.js','utf8');
const inject=fs.readFileSync('src/v295FirstAttemptUiInjectionPatch.js','utf8');
const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');
const whppSummary=fs.readFileSync('src/v132WhppFastIntegrationPatch.js','utf8');
const whppStore=fs.readFileSync('src/whppStore.js','utf8');

assert.match(ui,/2026-08-26-v318-single-sidebar-hard-owner-v1/);
assert.match(ui,/const NAV_ITEMS=\[/);
assert.match(ui,/sidebars\.slice\(1\)\.forEach\(node=>node\.remove\(\)\)/,'V318 must delete every duplicate sidebar root');
assert.match(ui,/\[\.\.\.sidebar\.children\]\.forEach\(node=>\{/,'V318 must inspect every direct sidebar child, not only known legacy CSS classes');
assert.match(ui,/node!==brand&&node!==nav&&node!==collapse&&node!==status\)node\.remove\(\)/,'only brand + canonical nav + collapse + status may survive');
assert.match(ui,/sidebar\.querySelectorAll\('\.side-nav'\)/,'nested duplicate nav roots must also be removed');
assert.match(ui,/nav\.replaceChildren\(\.\.\.NAV_ITEMS\.map/,'a dirty navigation tree must be rebuilt atomically');
assert.match(ui,/setInterval\(enforce,1200\)/,'V318 must continuously enforce after late legacy scripts mutate the sidebar');
assert.doesNotMatch(ui,/new MutationObserver/,'sidebar repair must remain polling/idempotent and never create a recursive observer');
assert.match(ui,/七业务处理完成/,'all-complete banner must not remain SHOPEE-only after all owners report complete');
assert.match(ui,/CCSL、SHOPEE CN\/VN、WHPP本土均已完成/);

// V411 reuses the historical V169 filename as a narrow completion/unconfirmed
// UI entry guard. It consumes V168 truth and wraps only the two public entries;
// V67 remains the sole three-stage execution owner.
assert.match(completionGuard,/2026-09-01-v411-unconfirmed-status-entry-lock-v1/,'V169 filename must expose the V411 fail-closed entry guard build');
assert.doesNotMatch(completionGuard,/getElementById\('ccslRunStatus'\)/,'V411 entry guard must never acquire the CCSL detail panel');
assert.doesNotMatch(completionGuard,/getElementById\('sevenBusinessStageSummary'\)/,'V411 entry guard must never acquire the canonical summary');
assert.match(completionGuard,/__CE_QC_V168_SEVEN_BUSINESS_STATUS__\?\.refresh/,'V411 guard may ask V168 to refresh canonical truth');
assert.match(completionGuard,/__CE_QC_V138_CCSL_SCAN_PROGRESS__\?\.enforceLastTruth/,'V411 guard may ask V138 to re-enforce CCSL detail truth');
assert.match(completionGuard,/wrapUnifiedEntry\('runUnified'\)/,'V411 must guard the public start entry after V67 installs it');
assert.match(completionGuard,/wrapUnifiedEntry\('resumeUnified'\)/,'V411 must guard the public resume entry after V67 installs it');
assert.match(completionGuard,/return original\.apply\(this,arguments\)/,'only fresh incomplete truth may delegate to the original V67 entry');
assert.match(completionGuard,/SEVEN_BUSINESS_ALREADY_COMPLETE/,'completed lifecycle must be rejected before it can re-enter V67');
assert.match(completionGuard,/SEVEN_BUSINESS_STATUS_UNCONFIRMED/,'missing, stale or wrong-date canonical status must be rejected before it can re-enter V67');
assert.match(completionGuard,/CURRENT_DATE_STATUS_NOT_READY/,'V411 must distinguish an unready exact-date status from a real incomplete lifecycle');
assert.match(completionGuard,/CURRENT_DATE_STATUS_STALE/,'V411 must fail closed when the exact-date status is stale');
assert.match(completionGuard,/state\.kind==='unconfirmed'[\s\S]*lockResumeButtons\(state\)/,'unconfirmed status must keep legacy resume controls hidden and disabled');
assert.doesNotMatch(completionGuard,/\/api\/whpp\/run\/start|\/api\/whpp\/run\/resume|\/api\/run\/start|\/api\/v311\/shopee-recovery[^\n]*action[^\n]*start/,'V411 guard must never start any CCSL, SHOPEE or WHPP processing API itself');
assert.doesNotMatch(completionGuard,/async function execute|function execute\(/,'V411 guard must not own a duplicate three-stage executor');
assert.match(shell,/v169-seven-business-legacy-status-sync\.js\?v=20260901-v411-1/,'V411 entry guard must load after the canonical status owner with an explicit cache bust');
assert.match(shell,/v168-seven-business-status\.js\?v=20260901-v411-1/,'canonical V168 status-only owner must be cache-busted to the current V411 serialized-status build');
assert.match(shell,/v67-resilient-run-guard\.js\?v=20260830-v360-1/,'single V67 runner must be cache-busted with the matching current-run finalization acknowledgement build');
const v67At=shell.indexOf('v67-resilient-run-guard.js?v=20260830-v360-1');
const v168At=shell.indexOf('v168-seven-business-status.js?v=20260901-v411-1');
const v169At=shell.indexOf('v169-seven-business-legacy-status-sync.js?v=20260901-v411-1');
assert.ok(v67At>=0&&v168At>v67At&&v169At>v168At,'runtime order must remain V67 executor → V168 canonical status → V411/V169 fail-closed entry guard');

assert.match(whppSummary,/2026-08-30-v361-whpp-finalized-lifecycle-status-v1/,'WHPP canonical summary must expose persistent lifecycle completion truth');
assert.match(whppSummary,/function loadCurrentLifecycleCompletion/,'WHPP summary must recover an already-finalized current lifecycle after browser reload');
assert.match(whppSummary,/stateMemberCount===num\(memberCount\)/,'current lifecycle completion must match the exact daily membership count');
assert.match(whppSummary,/sourceMatches=!sourceSnapshotId\|\|stateSourceSnapshotId===sourceSnapshotId/,'current lifecycle completion must remain bound to the same imported source snapshot');
assert.match(whppSummary,/CURRENT_FINALIZED_WHPP_STATE/,'an already finalized WHPP state must close the visible stage even when some members are unresolved rather than missing processing');
assert.match(whppSummary,/CURRENT_DAILY_FINALIZATION_MARKER/,'future WHPP runs must persist a lightweight exact daily completion marker');
assert.match(whppStore,/completed: true,[\s\S]*snapshotStatus: 'COMPLETED',[\s\S]*finalizedSnapshotId: snapshotId/,'WHPP finalization must write the lightweight completion marker into the exact daily cohort row');
assert.match(whppStore,/existingDaily\.finalized && \(preserveFinalizedLifecycle === true \|\| existingDaily\.identicalMembership\)/,'identical finalized same-date WHPP membership must remain immutable');
assert.match(whppStore,/\.\.\.emptyWhppState\(\),[\s\S]*reportDate,[\s\S]*dailyReportReady: true/,'a changed/new WHPP membership must still start from a fresh runtime state instead of inheriting old completion');

assert.match(inject,/v318-single-sidebar-owner\.js\?v=20260826-v318-1/,'V318 UI owner must remain delivered');
assert.match(inject,/X-CE-QC-V318-UI/,'V318 response header must be observable');

console.log('[V411/SINGLE-RUNNER/V361/V360/V318] single-sidebar + status ownership smoke passed · V67 remains sole executor · V168 current status owner is V411 serialized read · V169 is fail-closed completion/unconfirmed entry guard only · finalized identical WHPP survives reload/reupload · changed membership unlocks · exact 15-item nav');