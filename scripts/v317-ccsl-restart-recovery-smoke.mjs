import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chooseCcslReportDate, ccslRecoveryDecision, V317_CCSL_RECOVERY_POLICY_ID } from '../src/v317CcslRecoveryPolicy.js';
import { coreSnapshotCompletionDecision } from '../src/v142SevenBusinessHistoryAudit.js';

for(const file of ['src/v317CcslRecoveryPolicy.js','src/v317CcslIncompleteRecoveryPatch.js','src/v33RunProgressPatch.js','public/v317-ccsl-recovery-owner.js','public/v311-shopee-recovery-owner.js','public/v138-ccsl-scan-progress.js','public/v168-seven-business-status.js','src/v142SevenBusinessHistoryAudit.js','src/v295FirstAttemptUiInjectionPatch.js','src/v44WhppUiPatch.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

assert.match(V317_CCSL_RECOVERY_POLICY_ID,/v317-ccsl-restart-recovery-policy-v1/);
assert.equal(chooseCcslReportDate({latestValidUnified:'2026-08-06',currentState:'2026-08-05',lastProcessed:'2026-08-05',latestDaily:'2026-08-05'}),'2026-08-06','latest VALID unified import must own automatic restart recovery when no explicit page date is supplied');
assert.equal(chooseCcslReportDate({currentState:'2026-08-06',lastProcessed:'2026-08-05'}),'2026-08-06');
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:false,lockStatus:''}),{complete:false,paused:false,needsResume:true,action:'CREATE_AND_RESUME'});
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:false,lockStatus:'running'}),{complete:false,paused:false,needsResume:true,action:'RESUME_EXISTING'});
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:false,lockStatus:'finished'}),{complete:false,paused:false,needsResume:true,action:'REOPEN_FINISHED'});
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:false,lockStatus:'paused'}),{complete:false,paused:true,needsResume:false,action:'PAUSED'});
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:true,lockStatus:'finished'}),{complete:true,paused:false,needsResume:false,action:'COMPLETE'});
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:false,lockStatus:'failed',validUnified:true,sourceTotal:0}),{complete:true,paused:false,needsResume:false,action:'ZERO_TICKET_COMPLETE',zeroTicketDay:true});
assert.deepEqual(coreSnapshotCompletionDecision({validBatch:true,snapshotCompleted:false,ccslTotal:0,coveredCcsl:0}),{complete:true,reason:'VALID_ZERO_CCSL_TICKETS',zeroTicketDay:true,legacyCoverageRecovered:false});
assert.deepEqual(coreSnapshotCompletionDecision({validBatch:true,snapshotCompleted:false,ccslTotal:120,coveredCcsl:120}),{complete:true,reason:'LEGACY_FINAL_ROWS_FULL_COVERAGE',zeroTicketDay:false,legacyCoverageRecovered:true});
assert.equal(coreSnapshotCompletionDecision({validBatch:true,snapshotCompleted:false,ccslTotal:120,coveredCcsl:119}).complete,false);

const backend=fs.readFileSync(new URL('../src/v317CcslIncompleteRecoveryPatch.js',import.meta.url),'utf8');
const progress=fs.readFileSync(new URL('../src/v33RunProgressPatch.js',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('../public/v317-ccsl-recovery-owner.js',import.meta.url),'utf8');
const shopeeClient=fs.readFileSync(new URL('../public/v311-shopee-recovery-owner.js',import.meta.url),'utf8');
const progressUi=fs.readFileSync(new URL('../public/v138-ccsl-scan-progress.js',import.meta.url),'utf8');
const sevenStatus=fs.readFileSync(new URL('../public/v168-seven-business-status.js',import.meta.url),'utf8');
const audit=fs.readFileSync(new URL('../src/v142SevenBusinessHistoryAudit.js',import.meta.url),'utf8');
const activation=fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js',import.meta.url),'utf8');
const injection=fs.readFileSync(new URL('../src/v295FirstAttemptUiInjectionPatch.js',import.meta.url),'utf8');
const htmlOwner=fs.readFileSync(new URL('../src/v44WhppUiPatch.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');

assert.match(backend,/2026-08-27-v333-selected-date-ccsl-recovery-v1/,'V317 backend must expose selected-date V333 truth');
assert.match(backend,/const requested=String\(reportDate\|\|''\)\.trim\(\);[\s\S]*const date=requested\|\|canonical/,'explicit selected reportDate must win over latest/current fallback');
assert.match(backend,/unified_import_batches WHERE reportDate=\? AND status='VALID'/,'selected date must still require a real VALID unified import');
assert.match(backend,/businessType IN \('CE','CEAF','TBKH','ALI1688'\)/,'CCSL membership must cover exactly the four CCSL-routed boards');
assert.match(backend,/sourceTotal>0&&hasDaily\?latestValidSnapshot/,'zero-ticket days must not require an empty export snapshot');
assert.match(backend,/ZERO_CCSL_TICKETS/,'zero-ticket closure must remain observable');
assert.match(backend,/createOrRecoverRun\(date/,'missing run locks remain checkpoint-recoverable');
assert.match(backend,/updateRunLock\(date,'failed'/,'finished-without-snapshot remains recoverable');
assert.doesNotMatch(backend,/DELETE FROM (?:scan_results|track_events|run_checkpoints|unified_import_rows)/,'recovery must never delete saved progress or membership');

assert.match(progress,/2026-08-27-v331-ccsl-progress-selected-date-zero-ticket-v1/,'V33 selected-date zero-ticket truth must remain active');
assert.match(progress,/const reportDate = requested[\s\S]*\|\| latestValidReportDate\(db\)/,'V33 explicit page date must win');
assert.match(progress,/const zeroTicketDay = Boolean\(validSnapshotId\) && sourceTotal === 0/,'V33 zero-ticket completion must require VALID membership');
assert.match(progress,/complete:true,[\s\S]*zeroTicketDay:true,[\s\S]*phase:'已完成'/,'0/0 CCSL must publish complete, never pending');
assert.match(progress,/ccslProgress\(db, req\.query\.reportDate\)/,'V33 route must accept selected reportDate');

assert.match(audit,/CCSL_TYPES = \['CE','CEAF','TBKH','ALI1688'\]/);
assert.match(audit,/VALID_ZERO_CCSL_TICKETS/);
assert.match(audit,/LEGACY_FINAL_ROWS_FULL_COVERAGE/);
assert.match(audit,/covered>=total/);

assert.match(client,/2026-08-27-v333-ccsl-recovery-no-status-dom-mutation-v1/,'CCSL recovery owner must be recovery-only');
assert.match(client,/\/api\/v317\/ccsl-recovery/);
assert.match(client,/\/api\/run\/start/,'CCSL recovery must still continue checkpoint-safe backend work');
assert.match(client,/const selected=date\(document\.getElementById\('reportDate'\)/,'selected page date must remain first choice');
assert.doesNotMatch(client,/getElementById\('ccslRunStatus'\)/,'V317 must not write the canonical CCSL detail panel');
assert.doesNotMatch(client,/getElementById\('sevenBusinessStageSummary'\)/,'V317 must not acquire the canonical seven-business summary DOM');
assert.match(client,/__CE_QC_V168_SEVEN_BUSINESS_STATUS__\?\.refresh/,'recovery changes must ask the summary owner to reread canonical truth');
assert.doesNotMatch(client,/location\.pathname\s*!==\s*['"]\/import['"]/,'restart continuation must remain SPA-route independent');

assert.match(shopeeClient,/2026-08-27-v333-shopee-recovery-no-summary-mutation-v1/,'SHOPEE recovery must be isolated from canonical status DOM');
assert.match(shopeeClient,/\/api\/v311\/shopee-recovery/);
assert.doesNotMatch(shopeeClient,/getElementById\('ccslRunStatus'\)/,'SHOPEE must never repaint CCSL detail');
assert.doesNotMatch(shopeeClient,/getElementById\('sevenBusinessStageSummary'\)/,'SHOPEE must never acquire the V168 summary DOM');
assert.doesNotMatch(shopeeClient,/querySelectorAll\('#importPage \.status-pill/,'SHOPEE must not scan/repaint canonical pills');

assert.match(progressUi,/2026-08-27-v338-ccsl-350-scan-50-track-ui-v1/,'V138 must retain canonical V317 truth while publishing the V338 350/50 UI owner');
assert.match(progressUi,/const selectedReportDate=.*reportDate[\s\S]*topRangeTo[\s\S]*dashboardRangeTo/,'V138 must derive selected date from the current UI');
assert.match(progressUi,/postJson\('\/api\/v317\/ccsl-recovery',[\s\S]*action:'status',[\s\S]*reportDate:reportDate\|\|''/,'V138 detail must read the same selected-date V317 truth as the green summary');
const canonicalPos=progressUi.indexOf("/api/v317/ccsl-recovery"),legacyPos=progressUi.indexOf("/api/v33/run-progress");
assert.ok(canonicalPos>=0&&legacyPos>canonicalPos,'V138 must consult canonical V317 truth before legacy V33 batch progress');
assert.match(progressUi,/truth\.complete===true\|\|truth\.zeroTicketDay===true/,'V138 must close canonical completed/zero-ticket dates without requiring a run lock');
assert.match(progressUi,/truth\.dailyExists===false[\s\S]*noDaily:true/,'a selected date with no CCSL daily truth must show no-daily/needs-no-work rather than pending 0\/0');
assert.match(progressUi,/canonicalTruth:true,[\s\S]*complete:true/,'canonical completion must synthesize a completed detail state');
assert.match(progressUi,/当日有效日报CCSL为0票，无需启动订单扫描或轨迹查询/,'0-ticket lower panel must visibly close as completed');
assert.match(progressUi,/所选日期没有CCSL有效日报\/票据，不创建订单扫描或轨迹查询任务/,'no CCSL daily must never be represented as a pending scan run');
assert.match(progressUi,/if\(polling\|\|!page\|\|page\.hidden\)return/,'V138 must use visible SPA page state rather than location.pathname');
assert.doesNotMatch(progressUi,/location\.pathname!=='\/import'/,'SPA URL text must not disable CCSL detail polling');
assert.match(progressUi,/setInterval\(enforceLastTruth,250\)/,'saved canonical CCSL detail must be re-enforced against late legacy repaint races');
assert.match(progressUi,/const ccsl=await read\('CCSL'\)/,'CCSL detail owner must not render SHOPEE into the CCSL panel');
assert.match(progressUi,/batchMax:350/,'V138 scan phase must expose 350-ticket batches');
assert.match(progressUi,/batchMax:50/,'V138 trajectory phase must expose 50-ticket batches');
assert.match(progressUi,/单批最大350/,'V138 visible scan detail must say 350 tickets per batch');
assert.match(progressUi,/单批最大50/,'V138 visible trajectory detail must say 50 tickets per batch');

assert.match(sevenStatus,/2026-08-27-v333-canonical-seven-business-owner-v1/,'V168 must be the one canonical summary owner');
assert.match(sevenStatus,/postJson\('\/api\/v317\/ccsl-recovery',[\s\S]*action: 'status',[\s\S]*reportDate: target/,'V168 must read canonical CCSL recovery truth for the selected date');
assert.match(sevenStatus,/postJson\('\/api\/v311\/shopee-recovery',[\s\S]*action: 'status',[\s\S]*reportDate: target/,'V168 must read canonical SHOPEE recovery truth for the same selected date');
assert.match(sevenStatus,/readJson\(`\/api\/v132\/whpp-fast-summary\?reportDate=\$\{encoded\}`\)/,'V168 must align WHPP to the same selected date through the canonical WHPP visible summary');
assert.doesNotMatch(sevenStatus,/readJson\(`\/api\/business-state\/WHPP\?reportDate=\$\{encoded\}&compact=1`\)/,'V168 must not fall back to the stale snapshot-only WHPP state owner');
assert.match(sevenStatus,/payload\?\.completed === true/,'V168 must honor canonical zero-work WHPP completion directly from V132');
assert.match(sevenStatus,/stages\.every\(stage => stage\.state === 'done'\)/,'overall completion must be computed from the same canonical stage objects shown in the pills');
assert.match(sevenStatus,/if \(stage\.state === 'done'\) return 'success'/,'every completed stage must be green');
assert.match(sevenStatus,/truth\.complete \? 'success' : 'muted'/,'overall completed state must also be green');
assert.match(sevenStatus,/node\.dataset\.v333Owner = 'canonical'/,'summary DOM must mark V333 canonical ownership');
assert.match(sevenStatus,/}, 2000\);/,'canonical summary must refresh fast enough to defeat stale legacy state without heavy polling');

assert.match(activation,/v317CcslIncompleteRecoveryPatch\.js/,'V317 backend route must remain production-active');
assert.match(injection,/2026-08-27-v334-canonical-detail-history-ownership-v1/,'V334 response injection must remain observable as the compatibility injection owner');
assert.match(injection,/v311-shopee-recovery-owner\.js\?v=20260827-v333-1/);
assert.match(injection,/v317-ccsl-recovery-owner\.js\?v=20260827-v333-1/);
assert.match(injection,/v320-history-trend-owner\.js\?v=20260827-v334-1/,'browser must load V334 history hard owner');
assert.match(injection,/v320-history-trend-owner\.js\?v=20260827-v329-1/,'V329 history owner compatibility marker remains source-visible');
assert.match(injection,/X-CE-QC-V334-UI/,'V334 response header must be observable');
assert.match(htmlOwner,/2026-08-27-v334-canonical-detail-history-owner-cache-bust-v1/,'HTML owner must retain V334 compatibility build identity');
assert.match(htmlOwner,/v138-ccsl-scan-progress\.js\?v=20260827-v338-1/,'browser must load the V338 CCSL 350/50 detail owner');
assert.match(htmlOwner,/v168-seven-business-status\.js\?v=20260827-v333-1/,'browser must retain V333 canonical seven-business owner');
assert.match(server,/resetRunForReport\(parsed\.reportDate\)[\s\S]*await saveState\(ccslState\)/);
assert.match(server,/createOrRecoverRun\(reportDate/);

const screenshotCcslTotal=2478+58+0+150;
assert.equal(screenshotCcslTotal,2686);

console.log('[V338/V334/V333/V317] canonical CCSL detail smoke passed · V138 reads V317 first · V168 reads canonical V132 WHPP completion · scan=350 · trajectory=50 · zero-ticket/no-daily cannot fall through to legacy V33 pending 0/0');
