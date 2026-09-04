const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');

for(const file of ['public/v318-single-sidebar-owner.js','public/v67-resilient-run-guard.js','public/v168-seven-business-status.js','public/v169-seven-business-legacy-status-sync.js','public/v412-seven-business-convergence.js','src/v102UnifiedImportSafetyGatePatch.js','src/v317CcslIncompleteRecoveryPatch.js','src/v322WebAvailabilityPatch.js','src/v418StatusProofFastPath.js','src/v295FirstAttemptUiInjectionPatch.js','src/v44WhppUiPatch.js','src/v132WhppFastIntegrationPatch.js','src/whppStore.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}
const ui=fs.readFileSync('public/v318-single-sidebar-owner.js','utf8');
const runner=fs.readFileSync('public/v67-resilient-run-guard.js','utf8');
const statusUi=fs.readFileSync('public/v168-seven-business-status.js','utf8');
const completionGuard=fs.readFileSync('public/v169-seven-business-legacy-status-sync.js','utf8');
const convergence=fs.readFileSync('public/v412-seven-business-convergence.js','utf8');
const importSafety=fs.readFileSync('src/v102UnifiedImportSafetyGatePatch.js','utf8');
const ccslRecovery=fs.readFileSync('src/v317CcslIncompleteRecoveryPatch.js','utf8');
const persistedStatus=fs.readFileSync('src/v322WebAvailabilityPatch.js','utf8');
const fastProof=fs.readFileSync('src/v418StatusProofFastPath.js','utf8');
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

assert.match(runner,/2026-09-02-v414-explicit-unified-restart-only-v1/,'V67 must expose the current explicit-run/restart-only runner revision');
assert.match(runner,/2026-09-02-v67-retryable-process-restart-recovery-v2/,'V67 sole executor must expose retryable exact Shopee restart recovery');
assert.match(runner,/V424_RESUME_FLOOR_REVISION = '2026-09-04-v424-restart-proof-resume-floor-v1'/,'V67 must expose the V424 same-proof resume-floor revision');
assert.match(runner,/function shopeeRestartInterruption\(payload = \{\}, target = ''\)/,'restart recovery must classify persisted Shopee status without a second executor');
assert.match(runner,/PROCESS_RESTART_INTERRUPTED/,'only the persisted process-restart interruption marker is eligible for automatic recovery');
assert.match(runner,/const shopeeRestartRecoveryCooldown = new Map\(\)/,'restart recovery must use a cooldown map, never a permanent suppression set');
assert.match(runner,/SHOPEE_RESTART_RETRY_COOLDOWN_MS = 15000/,'failed exact restart recovery must have bounded retry cooldown');
assert.match(runner,/if \(Date\.now\(\) < nextRetryAt\) return false/,'same interrupted lock must not be hammered while its cooldown is active');
assert.match(runner,/handoff\.token !== resumeHandoffNonce/,'resume-floor privilege must require an opaque V67 process-local token');
assert.match(runner,/const handoff = createPersistedRestartHandoff\(all, target, 'SHOPEE'\)/,'automatic Shopee restart recovery must mint its resume floor from the same persisted proof');
assert.match(runner,/shopeeRestartRecoveryCooldown\.set\(restart\.key, Date\.now\(\) \+ SHOPEE_RESTART_RETRY_COOLDOWN_MS\)/,'cooldown must be armed before the single V67 resume attempt');
assert.match(runner,/const handoff = createPersistedRestartHandoff\(all, target, 'SHOPEE'\);[\s\S]*const result = await execute\('resume', handoff\);[\s\S]*if \(result\?\.ok\) shopeeRestartRecoveryCooldown\.delete\(restart\.key\)/,'successful exact restart recovery must carry the same proof into V67 and clear its cooldown only after success');
assert.match(runner,/if \(resumeFloor && index < resumeFloor\.index\)[\s\S]*resumeFloor: V424_RESUME_FLOOR_REVISION/,'only an accepted resume floor may skip an already-proven prior stage');
assert.match(runner,/检测到\$\{target\}的SHOPEE因程序重启中断，正在自动恢复SHOPEE CN\/VN → WHPP本土/,'visible recovery state must explain exact process-restart Shopee-to-WHPP continuation');
assert.match(runner,/WHPP_RESTART_RECOVERY_REVISION = '2026-09-02-v414-whpp-restart-only-browser-v1'/,'generic incomplete WHPP must remain idle; automatic WHPP recovery is restart-only');
assert.match(runner,/function whppRestartInterruption\(payload = \{\}, target = ''\)/,'WHPP automatic recovery must require persisted restart proof');
assert.match(runner,/if \(!restart\.interrupted\) return false/,'V67 must not auto-start a generic incomplete WHPP lifecycle');
assert.match(runner,/\/api\/v33\/run-progress\?\$\{query\.toString\(\)\}/,'V67 stage decisions must use the tiny persisted status endpoint');
assert.doesNotMatch(runner,/\/api\/v311\/shopee-recovery|\/api\/v317\/ccsl-recovery|\/api\/v132\/whpp-fast-summary/,'V67 must not re-enter heavy status/recovery/summary reads while deciding completed stages');
assert.match(runner,/global\.runUnified = \(\) => execute\('start'\)/,'V67 remains the public start owner');
assert.match(runner,/global\.resumeUnified = handoff => execute\('resume', handoff\)/,'V67 remains the public resume owner; ordinary callers get no resume-floor privilege without an opaque handoff');

assert.match(statusUi,/2026-09-02-v168-one-persisted-status-read-v1/);
assert.match(statusUi,/STATUS_SOURCE_REVISION = '2026-09-02-v414-one-read-seven-business-status-v1'/,'V168 must bind to the exact V414 persisted status contract');
assert.match(statusUi,/businessType: 'ALL', reportDate: target/,'V168 must request all three persisted stages once');
assert.match(statusUi,/\/api\/v33\/run-progress\?\$\{query\.toString\(\)\}/);
assert.doesNotMatch(statusUi,/\/api\/v311\/shopee-recovery|\/api\/v317\/ccsl-recovery|\/api\/v132\/whpp-fast-summary/);
assert.doesNotMatch(statusUi,/\/api\/shopee\/run\/start|\/api\/whpp\/run\/start|async function execute|function execute\(/,'V168 remains status-only');

assert.match(persistedStatus,/2026-09-02-v414-one-read-seven-business-status-v1/);
assert.match(persistedStatus,/2026-09-02-v414-whpp-success-evidence-parity-v1/);
assert.match(persistedStatus,/2026-09-02-v419-scalar-status-priority-no-json-v1/);
assert.match(persistedStatus,/2026-09-04-v424-same-lifecycle-completion-snapshot-v1/,'V322 must expose bounded same-lifecycle completion recovery');
assert.match(persistedStatus,/claimSource:'SAME_VALID_IMPORT_LIFECYCLE'/,'a later accidental runId may not hide a boundary-valid completion snapshot');
assert.match(persistedStatus,/lifecycle&&atOrAfter\(lifecycle\.generatedAt,boundary\)/,'same-lifecycle completion recovery must never cross the current VALID import boundary');
assert.match(persistedStatus,/readV322SevenBusinessStatus/);
assert.match(persistedStatus,/stages:\{CCSL,SHOPEE,WHPP\}/);
assert.match(persistedStatus,/PERSISTED_DAILY_HEADER_RUN_LOCK_SNAPSHOT/);
assert.match(persistedStatus,/PERSISTED_WHPP_V414_SUCCESS_AND_RESTART_PROOF/);
assert.match(persistedStatus,/readV418CurrentMembershipCounts\(db,batch\|\|\{\}\)/,'V419 status must read the exact current seven-business membership through the scalar helper');
assert.match(persistedStatus,/const whppMembershipOk=counts\._whppMembershipOk!==false/,'WHPP completion must fail closed when the current membership is inconsistent');
assert.match(persistedStatus,/COMPLETE_LOCK\.has\(text\(whppLock\?\.status\)\.toLowerCase\(\)\),unifiedClaim=unifiedCompletionClaim\(db,batch\)/,'WHPP positive proof requires a current completion claim before SUCCESS coverage is consulted');
assert.match(persistedStatus,/readV418BusinessSuccessCoverage\(db,\{businessType:'WHPP',date,snapshotId,boundary,memberTypes:\['WHPP'\]\}\)/,'WHPP completion must use the exact current WHPP cohort');
assert.match(persistedStatus,/coverage\?\.ok&&n\(coverage\.count\)>=n\(counts\.WHPP\)/,'WHPP completion must require full successful processing coverage of the current cohort');
assert.match(persistedStatus,/restartInterrupted/,'V414 persisted status must expose restart interruption truth');
assert.match(persistedStatus,/PROCESS_RESTART_INTERRUPTED/,'V414 persisted status must expose exact restart proof rather than generic auto-run eligibility');
assert.match(persistedStatus,/ok:false,code:'V322_PERSISTED_STATUS_READ_FAILED'/,'unknown persisted status must fail closed with the canonical compatibility code');
assert.match(persistedStatus,/detailCode:'V419_SCALAR_STATUS_READ_FAILED'/,'V419 scalar failure diagnostics must remain visible without breaking V322 consumers');
assert.doesNotMatch(persistedStatus,/SELECT[^`\n]*(?:payloadJson|stateJson|summaryJson|valueJson)/,'normal status SQL must never materialize heavy JSON payloads');
assert.doesNotMatch(persistedStatus,/scan_results|business_scan_results|business_track_events|track_events/,'normal status owner must never reconstruct scan or trajectory facts');
assert.match(fastProof,/V418_STATUS_PROOF_FAST_PATH_ID='2026-09-02-v418-large-db-set-join-status-proof-v1'/);
assert.match(fastProof,/UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/,'positive current-member completion proof must count only successful processing evidence');
assert.match(fastProof,/FROM business_daily_parse_rows d[\s\S]*JOIN business_final_rows f[\s\S]*f\.shipmentCode=d\.shipmentCode/,'WHPP positive proof must remain an indexed current-member set join');
assert.match(fastProof,/FROM unified_import_rows u[\s\S]*JOIN business_final_rows f[\s\S]*f\.shipmentCode=u\.shipmentCode/,'SHOPEE positive proof must remain an indexed current-snapshot set join');

assert.match(completionGuard,/2026-09-01-v411-unconfirmed-status-entry-lock-v1/,'V169 filename must expose the V411 fail-closed entry guard build');
assert.match(completionGuard,/2026-09-04-v424-v169-v67-proof-handoff-v1/,'V169 must expose the V424 same-proof handoff bridge');
assert.doesNotMatch(completionGuard,/getElementById\('ccslRunStatus'\)/,'V411 entry guard must never acquire the CCSL detail panel');
assert.doesNotMatch(completionGuard,/getElementById\('sevenBusinessStageSummary'\)/,'V411 entry guard must never acquire the canonical summary');
assert.match(completionGuard,/__CE_QC_V168_SEVEN_BUSINESS_STATUS__\?\.refresh/,'V411 guard may ask V168 to refresh canonical truth');
assert.match(completionGuard,/__CE_QC_V138_CCSL_SCAN_PROGRESS__\?\.enforceLastTruth/,'V411 guard may ask V138 to re-enforce CCSL detail truth');
assert.match(completionGuard,/wrapUnifiedEntry\('runUnified'\)/,'V411 must guard the public start entry after V67 installs it');
assert.match(completionGuard,/wrapUnifiedEntry\('resumeUnified'\)/,'V411 must guard the public resume entry after V67 installs it');
assert.match(completionGuard,/createShopeeRestartHandoff/,'V169 exact restart routing must request a V67-owned opaque handoff instead of calling a bare resume');
assert.match(completionGuard,/originalEntries\.resumeUnified\.call\(this,handoff\)/,'V169 must pass the same restart proof into V67 exactly once');
assert.match(completionGuard,/return original\.apply\(this,arguments\)/,'only ordinary fresh incomplete truth may delegate to the original V67 entry');
assert.match(completionGuard,/SEVEN_BUSINESS_ALREADY_COMPLETE/,'completed lifecycle must be rejected before it can re-enter V67');
assert.match(completionGuard,/SEVEN_BUSINESS_STATUS_UNCONFIRMED/,'missing, stale or wrong-date canonical status must be rejected before it can re-enter V67');
assert.match(completionGuard,/CURRENT_DATE_STATUS_NOT_READY/,'V411 must distinguish an unready exact-date status from a real incomplete lifecycle');
assert.match(completionGuard,/CURRENT_DATE_STATUS_STALE/,'V411 must fail closed when the exact-date status is stale');
assert.match(completionGuard,/state\.kind==='unconfirmed'[\s\S]*lockResumeButtons\(state\)/,'unconfirmed status must keep legacy resume controls hidden and disabled');
assert.doesNotMatch(completionGuard,/\/api\/whpp\/run\/start|\/api\/whpp\/run\/resume|\/api\/run\/start|\/api\/v311\/shopee-recovery[^\n]*action[^\n]*start/,'V411/V424 guard must never start any CCSL, SHOPEE or WHPP processing API itself');
assert.doesNotMatch(completionGuard,/async function execute|function execute\(/,'V411/V424 guard must not own a duplicate three-stage executor');

assert.match(convergence,/2026-09-01-v413-lifecycle-bound-seven-business-convergence-v4/,'V412 filename must expose the V413 import-total-text convergence build');
assert.match(convergence,/\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]/,'visible total must always sum all seven businesses');
assert.match(convergence,/function lifecycleKey\(\)/,'completion memory must be bound to an import lifecycle key');
assert.match(convergence,/snapshotId\|\|state\.batchId\|\|state\.sourceSnapshotId/,'lifecycle key must prefer persisted import identity instead of date-only memory');
assert.match(convergence,/function truthCurrentEnough\(truth\)/,'new imports must reject V168 truth checked before the new lifecycle started');
assert.match(convergence,/SEVEN_BUSINESS_ALREADY_COMPLETE_V413/,'exact lifecycle completion must short-circuit duplicate unified entry');
assert.match(convergence,/invalidateForNewLifecycle\(\)/,'new import selection/commit must invalidate old WHPP completion memory');
assert.match(convergence,/patchText\(document\.getElementById\('importPage'\),total\)/,'green import-success text must converge to the same seven-business total as the classification card');
assert.match(convergence,/setTimeout\(runObservedSync,60\)/,'import-page total reconciliation must be throttled rather than run on every DOM mutation');
assert.match(convergence,/String\(valid\.textContent\|\|''\)\.trim\(\)!==totalText/,'unchanged seven-business total must not retrigger the body observer');
assert.doesNotMatch(convergence,/\/api\/whpp\/run\/(?:start|resume)|\/api\/(?:run|resume)|\/api\/shopee\/run\/(?:start|resume)/,'V413 convergence guard must never own processing APIs');
assert.doesNotMatch(convergence,/async function execute|function execute\(/,'V413 convergence guard must not become a second executor');

assert.match(importSafety,/2026-09-01-v102-effective-range-duplicate-review-v1/,'duplicate ownership review must expose the bounded-range revision');
assert.match(importSafety,/getUnifiedEffectiveSheetRange/,'duplicate ownership review must reuse the canonical parser effective-range clamp');
assert.match(importSafety,/sheet_to_json\(sheet, \{ header: 1, defval: '', raw: false, range: effectiveRangeObject \}\)/,'duplicate ownership review must never expand the raw legacy Excel UsedRange');
assert.match(importSafety,/V102_DUPLICATE_REVIEW/,'duplicate review duration/result must be observable in backend logs');
assert.doesNotMatch(importSafety,/sheet_to_json\(sheet, \{ header: 1, defval: '', raw: false \}\)/,'unbounded duplicate-review matrix expansion must stay retired');

assert.match(ccslRecovery,/2026-09-01-v317-status-proof-lazy-until-completion-snapshot-v1/,'CCSL exact-date recovery proof remains available for execution-time strict verification');
assert.match(ccslRecovery,/rawSnapshot\s*\?ccslProcessingProof\(db,date,validBatch,sourceTotal\)\s*:pendingProcessingProof\(validBatch,sourceTotal\)/,'V384 member proof remains strict when V317 is explicitly invoked');
assert.match(ccslRecovery,/SKIPPED_UNTIL_COMPLETION_SNAPSHOT/);

assert.match(shell,/v67-resilient-run-guard\.js\?v=20260904-v424-1/,'single V67 runner must force-load the V424 resume-floor build');
assert.match(shell,/v168-seven-business-status\.js\?v=20260902-v414-status-1/,'canonical V168 status-only owner must force-load the V414 single-read build');
assert.match(shell,/v169-seven-business-legacy-status-sync\.js\?v=20260904-v424-1/,'entry guard must force-load the V424 same-proof handoff build');
assert.match(shell,/v412-seven-business-convergence\.js\?v=20260904-v420-1/,'V420/V413 import-total-text convergence must remain after V169');
const v67At=shell.indexOf('v67-resilient-run-guard.js?v=20260904-v424-1');
const v168At=shell.indexOf('v168-seven-business-status.js?v=20260902-v414-status-1');
const v169At=shell.indexOf('v169-seven-business-legacy-status-sync.js?v=20260904-v424-1');
const v413At=shell.indexOf('v412-seven-business-convergence.js?v=20260904-v420-1');
assert.ok(v67At>=0&&v168At>v67At&&v169At>v168At&&v413At>v169At,'runtime order must remain V67 V424 executor → V168 V414 persisted status → V169 V424 fail-closed handoff guard → V420/V413 lifecycle convergence');

assert.match(whppSummary,/STATUS_REVISION='2026-09-02-v414-whpp-success-evidence-status-v1'/,'WHPP canonical summary must expose the V414 SUCCESS-evidence lifecycle status revision');
assert.match(whppSummary,/function loadCurrentLifecycleCompletion/,'WHPP summary must recover an already-finalized current lifecycle after browser reload');
assert.match(whppSummary,/stateMemberCount===num\(memberCount\)/,'current lifecycle completion must match the exact daily membership count');
assert.match(whppSummary,/sourceMatches=!sourceSnapshotId\|\|stateSourceSnapshotId===sourceSnapshotId/,'current lifecycle completion must remain bound to the same imported source snapshot');
assert.match(whppSummary,/CURRENT_FINALIZED_WHPP_STATE/,'an already finalized WHPP state must close the visible stage even when some members are unresolved rather than missing processing');
assert.match(whppSummary,/CURRENT_DAILY_FINALIZATION_MARKER/,'future WHPP runs must persist a lightweight exact daily completion marker');
assert.match(whppSummary,/FULL_MEMBER_SUCCESS_EVIDENCE/,'V132 completion must use successful current-member processing evidence');
assert.match(whppStore,/completed: true,[\s\S]*snapshotStatus: 'COMPLETED',[\s\S]*finalizedSnapshotId: snapshotId/,'WHPP finalization must write the lightweight completion marker into the exact daily cohort row');
assert.match(whppStore,/const explicitEmptyRehydrate = preserveFinalizedLifecycle === true && unique\.length === 0/,'explicit finalized rehydrate must be limited to an empty incoming WHPP cohort');
assert.match(whppStore,/existingDaily\.finalized && \(existingDaily\.identicalMembership \|\| explicitEmptyRehydrate\)/,'identical finalized same-date WHPP membership must remain immutable, while explicit preserve applies only to an empty rehydrate');
assert.doesNotMatch(whppStore,/existingDaily\.finalized && \(preserveFinalizedLifecycle === true \|\| existingDaily\.identicalMembership\)/,'a non-empty changed membership must never preserve completion merely because preserveFinalizedLifecycle=true');
assert.match(whppStore,/\.\.\.emptyWhppState\(\),[\s\S]*reportDate,[\s\S]*dailyReportReady: true/,'a changed/new WHPP membership must still start from a fresh runtime state instead of inheriting old completion');

assert.match(inject,/v318-single-sidebar-owner\.js\?v=20260826-v318-1/,'V318 UI owner must remain delivered');
assert.match(inject,/X-CE-QC-V318-UI/,'V318 response header must be observable');

console.log('[V424/V419/V414/V168/V322/SINGLE-RUNNER] smoke passed · one scalar persisted exact-date status read replaces repeated V311/V317/V132 UI polling · exact PROCESS_RESTART_INTERRUPTED recovery carries one opaque same-proof V67 resume floor so completed CCSL cannot be reopened · current-member completion remains boundary-locked and fail-closed · generic incomplete WHPP remains idle · generic failures remain fail-closed · WHPP dashboard is display-only · seven-business total and completion lifecycle remain exact');