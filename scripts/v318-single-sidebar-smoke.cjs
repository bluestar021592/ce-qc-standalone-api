const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');

for(const file of ['public/v318-single-sidebar-owner.js','public/v169-seven-business-legacy-status-sync.js','src/v295FirstAttemptUiInjectionPatch.js','src/v44WhppUiPatch.js','src/v132WhppFastIntegrationPatch.js','src/whppStore.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}
const ui=fs.readFileSync('public/v318-single-sidebar-owner.js','utf8');
const legacy=fs.readFileSync('public/v169-seven-business-legacy-status-sync.js','utf8');
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

assert.match(legacy,/2026-08-27-v333-legacy-status-no-dom-owner-v1/,'V169 source remains available only for rollback diagnostics');
assert.doesNotMatch(legacy,/getElementById\('ccslRunStatus'\)/,'retired V169 source must never acquire the CCSL detail panel');
assert.doesNotMatch(legacy,/getElementById\('sevenBusinessStageSummary'\)/,'retired V169 source must never acquire the canonical summary');
assert.match(legacy,/__CE_QC_V168_SEVEN_BUSINESS_STATUS__\?\.refresh/,'legacy source may only ask V168 to refresh canonical truth');
assert.match(legacy,/__CE_QC_V138_CCSL_SCAN_PROGRESS__\?\.enforceLastTruth/,'legacy source may only ask V138 to re-enforce CCSL detail truth');
assert.doesNotMatch(shell,/v169-seven-business-legacy-status-sync\.js/,'retired V169 bridge must not be loaded in production runtime');
assert.match(shell,/v168-seven-business-status\.js\?v=20260830-v360-1/,'canonical V168 status-only owner must be cache-busted to the current verified-completion sync build');
assert.match(shell,/v67-resilient-run-guard\.js\?v=20260830-v360-1/,'single V67 runner must be cache-busted with the matching current-run finalization acknowledgement build');

assert.match(whppSummary,/2026-08-30-v361-whpp-finalized-lifecycle-status-v1/,'WHPP canonical summary must expose persistent lifecycle completion truth');
assert.match(whppSummary,/function loadCurrentLifecycleCompletion/,'WHPP summary must recover an already-finalized current lifecycle after browser reload');
assert.match(whppSummary,/stateMemberCount===num\(memberCount\)/,'current lifecycle completion must match the exact daily membership count');
assert.match(whppSummary,/sourceMatches=!sourceSnapshotId\|\|stateSourceSnapshotId===sourceSnapshotId/,'current lifecycle completion must remain bound to the same imported source snapshot');
assert.match(whppSummary,/CURRENT_FINALIZED_WHPP_STATE/,'an already finalized WHPP state must close the visible stage even when some members are unresolved rather than missing processing');
assert.match(whppSummary,/CURRENT_DAILY_FINALIZATION_MARKER/,'future WHPP runs must persist a lightweight exact daily completion marker');
assert.match(whppStore,/completed: true,[\s\S]*snapshotStatus: 'COMPLETED',[\s\S]*finalizedSnapshotId: snapshotId/,'WHPP finalization must write the lightweight completion marker into the exact daily cohort row');
assert.match(whppStore,/\.\.\.emptyWhppState\(\),[\s\S]*reportDate,[\s\S]*dailyReportReady: true/,'same-date WHPP reimport must reset runtime completion through a fresh empty state rather than inheriting the old finalized flag');

assert.match(inject,/v318-single-sidebar-owner\.js\?v=20260826-v318-1/,'V318 UI owner must remain delivered');
assert.match(inject,/X-CE-QC-V318-UI/,'V318 response header must be observable');

console.log('[SINGLE-RUNNER/V361/V360/V318] single-sidebar + status ownership smoke passed · finalized WHPP lifecycle survives browser reload · same-date reimport resets completion · V169 runtime bridge retired · exact 15-item nav');
