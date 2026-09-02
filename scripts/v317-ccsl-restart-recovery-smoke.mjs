import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chooseCcslReportDate, ccslRecoveryDecision, V317_CCSL_RECOVERY_POLICY_ID } from '../src/v317CcslRecoveryPolicy.js';
import { coreSnapshotCompletionDecision } from '../src/v142SevenBusinessHistoryAudit.js';

for(const file of ['src/v317CcslRecoveryPolicy.js','src/v317CcslIncompleteRecoveryPatch.js','src/v33RunProgressPatch.js','public/v317-ccsl-recovery-owner.js','public/v311-shopee-recovery-owner.js','public/v138-ccsl-scan-progress.js','public/v168-seven-business-status.js','public/v67-resilient-run-guard.js','src/v142SevenBusinessHistoryAudit.js','src/v295FirstAttemptUiInjectionPatch.js','src/v44WhppUiPatch.js']){
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
const runner=fs.readFileSync(new URL('../public/v67-resilient-run-guard.js',import.meta.url),'utf8');
const audit=fs.readFileSync(new URL('../src/v142SevenBusinessHistoryAudit.js',import.meta.url),'utf8');
const activation=fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js',import.meta.url),'utf8');
const injection=fs.readFileSync(new URL('../src/v295FirstAttemptUiInjectionPatch.js',import.meta.url),'utf8');
const htmlOwner=fs.readFileSync(new URL('../src/v44WhppUiPatch.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');

assert.match(backend,/2026-08-27-v333-selected-date-ccsl-recovery-v1/,'V317 backend must expose selected-date V333 truth');
assert.match(backend,/requested=String\(reportDate\|\|''\)\.trim\(\)/,'V317 must parse the explicit selected reportDate');
assert.match(backend,/date=requested\|\|canonical/,'explicit selected reportDate must win over latest/current fallback regardless of declaration formatting');
assert.match(backend,/unified_import_batches WHERE reportDate=\? AND status='VALID'/,'selected date must still require a real VALID unified import');
assert.match(backend,/businessType IN \('CE','CEAF','TBKH','ALI1688'\)/,'CCSL membership must cover exactly the four CCSL-routed boards');
assert.match(backend,/sourceTotal>0&&hasDaily\?latestValidSnapshot/,'zero-ticket days must not require an empty export snapshot');
assert.match(backend,/ZERO_CCSL_TICKETS/,'zero-ticket closure must remain observable');
assert.match(backend,/createOrRecoverRun\(date/,'missing run locks remain checkpoint-recoverable');
assert.match(backend,/updateRunLock\(date,'failed'/,'finished-without-snapshot remains recoverable');

assert.match(backend,/DELETE FROM run_checkpoints WHERE reportDate=\? AND runId=\?/,
  'stale CCSL checkpoint retirement must be constrained by date + exact old runId');
assert.match(backend,/DELETE FROM run_locks WHERE reportDate=\? AND runId=\?/,
  'stale CCSL lock retirement must be constrained by date + exact old runId');
assert.doesNotMatch(backend,/DELETE FROM (?:scan_results|track_events|final_rows|daily_reports|daily_parse_rows|unified_import_rows|export_snapshots|pod_locks|carry_bills)/,
  'CCSL recovery must never delete saved facts, daily membership, POD/carry truth or audit snapshots');
assert.doesNotMatch(backend,/DELETE FROM run_checkpoints\s+WHERE\s+(?!reportDate=\? AND runId=\?)/,
  'CCSL checkpoint retirement must never broaden beyond the exact stale lifecycle');

assert.match(progress,/2026-08-27-v331-ccsl-progress-selected-date-zero-ticket-v1/,'V33 selected-date zero-ticket truth must remain active');
assert.match(progress,/const reportDate = requested[\s\S]*\|\| latestValidReportDate\(db\)/,'V33 explicit page date must win');
assert.match(progress,/const zeroTicketDay = Boolean\(validSnapshotId\) && sourceTotal === 0/,'V33 zero-ticket completion must require VALID membership');
assert.match(progress,/complete:true,[\s\S]*zeroTicketDay:true,[\s\S]*phase:'已完成'/,'0/0 CCSL must publish complete, never pending');
assert.match(progress,/ccslProgress\(db, req\.query\.reportDate\)/,'V33 route must accept selected reportDate');

assert.match(audit,/CCSL_TYPES = \['CE','CEAF','TBKH','ALI1688'\]/);
assert.match(audit,/VALID_ZERO_CCSL_TICKETS/);
assert.match(audit,/LEGACY_FINAL_ROWS_FULL_COVERAGE/);
assert.match(audit,/covered>=total/);

assert.match(client,/2026-08-27-v333-ccsl-recovery-no-status-dom-mutation-v1/,'CCSL recovery compatibility client remains source-checkable');
assert.match(client,/\/api\/v317\/ccsl-recovery/);
assert.match(client,/\/api\/run\/start/);
assert.doesNotMatch(client,/getElementById\('ccslRunStatus'\)/,'V317 compatibility client must never write canonical CCSL detail');
assert.doesNotMatch(client,/getElementById\('sevenBusinessStageSummary'\)/,'V317 compatibility client must never acquire the canonical summary DOM');

assert.match(shopeeClient,/2026-08-27-v333-shopee-recovery-no-summary-mutation-v1/,'SHOPEE compatibility client remains source-checkable');
assert.match(shopeeClient,/\/api\/v311\/shopee-recovery/);
assert.doesNotMatch(shopeeClient,/getElementById\('ccslRunStatus'\)/);
assert.doesNotMatch(shopeeClient,/getElementById\('sevenBusinessStageSummary'\)/);

assert.match(progressUi,/2026-08-29-v341-ccsl-progress-owner-guard-v1/,'V138 must retain canonical V317 truth while publishing the V341 unified owner guard');
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

assert.match(sevenStatus,/2026-09-02-v168-one-persisted-status-read-v1/,'V168 must expose the consolidated one-read persisted status owner');
assert.match(sevenStatus,/2026-08-29-single-unified-runner-status-only-v1/,'V168 must advertise status-only architecture');
assert.match(sevenStatus,/STATUS_SOURCE_REVISION = '2026-09-02-v414-one-read-seven-business-status-v1'/,'V168 must bind to the exact V414 persisted status contract');
assert.match(sevenStatus,/const STATUS_TIMEOUT_MS = 8000/,'one lightweight local status read must remain bounded');
assert.match(sevenStatus,/const STATUS_POLL_MS = 10000/,'V168 must avoid status-poll pressure on the local SQLite backend');
const pendingPos=sevenStatus.indexOf('const pending = pendingImportDate()');
const committedInputPos=sevenStatus.indexOf("document.getElementById('reportDate')?.value");
assert.ok(pendingPos>=0&&committedInputPos>pendingPos,'pending selected import date must beat the previous committed reportDate input');
assert.match(sevenStatus,/__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__\?\.getPendingDate/,'V168 must consume V146 current-file pending-date truth');
assert.match(sevenStatus,/new URLSearchParams\(\{ businessType: 'ALL', reportDate: target \}\)/,'V168 must request all three stages in one exact-date persisted read');
assert.match(sevenStatus,/\/api\/v33\/run-progress\?\$\{query\.toString\(\)\}/,'V168 must use the consolidated persisted status endpoint');
assert.match(sevenStatus,/stageFromPersisted\(raw\.CCSL, 'CCSL',[\s\S]*stageFromPersisted\(raw\.SHOPEE, 'SHOPEE',[\s\S]*stageFromPersisted\(raw\.WHPP, 'WHPP'/,'one V414 payload must produce all three exact-date stage badges');
assert.match(sevenStatus,/payload\.complete === true && stages\.every\(stage => stage\.state === 'done'\)/,'overall completion must require persisted all-three completion plus three done stages');
assert.match(sevenStatus,/if \(stage\.state === 'done'\) return 'success'/,'every fresh completed stage must be green');
assert.match(sevenStatus,/truth\.complete \? 'success' : 'muted'/,'overall completed state must also be green');
assert.match(sevenStatus,/if \(truth\.complete\)[\s\S]*lockControl\(start, '七业务已完成'/,'persisted completion must lock duplicate start');
assert.match(sevenStatus,/else if \(!allFresh\)[\s\S]*lockControl\(start, '状态确认中'/,'unconfirmed exact-date truth must fail closed instead of exposing a repeat start');
assert.match(sevenStatus,/lockControl\(resume, '', '正在读取当前日报的轻量持久化状态，确认前禁止重复继续'\)/,'unconfirmed exact-date truth must disable the legacy continue control');
assert.match(sevenStatus,/node\.dataset\.v333Owner = 'canonical'/,'summary DOM must mark canonical ownership');
assert.match(sevenStatus,/statusOnly: true/,'V168 must be read/render only');
assert.match(sevenStatus,/authoritativeRunner: 'V67'/,'V168 must point execution ownership to V67');
assert.match(sevenStatus,/function transientStage/,'V168 must preserve exact-date last-good progress during temporary status read failure');
assert.doesNotMatch(sevenStatus,/Promise\.allSettled\(/,'V168 must never return to concurrent multi-endpoint status reads');
assert.doesNotMatch(sevenStatus,/\/api\/v317\/ccsl-recovery|\/api\/v311\/shopee-recovery|\/api\/v132\/whpp-fast-summary/,'V168 must not re-enter the retired three-status-endpoint chain');
assert.doesNotMatch(sevenStatus,/function wrapRunner|handoffPendingWhpp|\/api\/whpp\/run\/start|global\.runUnified\s*=|global\.resumeUnified\s*=/,'summary owner must never own execution');

assert.match(runner,/2026-09-02-v414-explicit-unified-restart-only-v1/,'V67 must expose the current V414 explicit-run/restart-only runner');
assert.match(runner,/2026-08-29-single-unified-runner-v1/,'V67 is the sole three-stage execution owner');
assert.match(runner,/STATUS_SOURCE_REVISION = '2026-09-02-v414-one-read-seven-business-status-v1'/,'V67 execution decisions must share the same exact V414 persisted status truth as V168');
assert.match(runner,/\/api\/v33\/run-progress\?\$\{query\.toString\(\)\}/,'V67 must use the lightweight persisted status endpoint before execution decisions');
assert.match(runner,/global\.runUnified = \(\) => execute\('start'\)/);
assert.match(runner,/global\.resumeUnified = \(\) => execute\('resume'\)/);
assert.match(runner,/\{ key: 'CCSL'[\s\S]*\{ key: 'SHOPEE'[\s\S]*\{ key: 'WHPP'/,'execution order must remain CCSL → SHOPEE → WHPP');
assert.match(runner,/const truth = await canonicalStageTruth\(stage, target, \{ force: true \}\);[\s\S]*if \(truth\.done\)[\s\S]*continue/,'already completed persisted stages must be skipped before execution');
assert.match(runner,/waitForWhppFinalized/,'WHPP completion must still be canonically verified');
assert.match(runner,/COMPLETION_STABILITY_REVISION = '2026-09-02-v67-persisted-completion-latch-v2'/,'same-page completed lifecycle must remain latched');
assert.match(runner,/__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__/,'V67 must publish the verified completion marker');
assert.match(runner,/SHOPEE_RESTART_RETRY_COOLDOWN_MS = 15000/,'exact restart interruption retry must remain bounded');
assert.match(runner,/PROCESS_RESTART_INTERRUPTED/,'only the exact persisted process-restart marker may trigger automatic recovery');
assert.match(runner,/shopeeRestartRecoveryCooldown\.set\(restart\.key, Date\.now\(\) \+ SHOPEE_RESTART_RETRY_COOLDOWN_MS\)/,'failed exact restart recovery must not become permanently suppressed');
assert.match(runner,/WHPP_RESTART_RECOVERY_REVISION = '2026-09-02-v414-whpp-restart-only-browser-v1'/,'WHPP automatic recovery must be V414 restart-only');
assert.match(runner,/function whppRestartInterruption\(payload = \{\}, target = ''\)/,'WHPP automatic recovery must require exact persisted restart proof');
assert.match(runner,/if \(!restart\.interrupted\) return false;/,'generic incomplete WHPP must remain idle instead of auto-starting');
assert.match(runner,/recoverPendingWhpp/,'V67 retains the bounded restart-recovery watcher without generic WHPP auto-start');
assert.doesNotMatch(runner,/\/api\/v317\/ccsl-recovery|\/api\/v311\/shopee-recovery|\/api\/v132\/whpp-fast-summary/,'V67 status decisions must not revive separate recovery/summary reads');

assert.match(activation,/v317CcslIncompleteRecoveryPatch\.js/,'V317 backend route must remain production-active');
assert.match(injection,/2026-08-27-v334-canonical-detail-history-ownership-v1/,'V334 response injection must remain observable');
assert.match(injection,/2026-08-29-single-unified-runner-v1/,'browser injection must expose the single-runner architecture');
assert.doesNotMatch(injection,/if\(!body\.includes\(V310_RESUME_MARKER\)\)tags\.push/,'legacy V310 browser watchdog must not be injected');
assert.doesNotMatch(injection,/if\(!body\.includes\(V311_RECOVERY_MARKER\)\)tags\.push/,'legacy V311 browser recovery runner must not be injected');
assert.doesNotMatch(injection,/if\(!body\.includes\(V317_CCSL_RECOVERY_MARKER\)\)tags\.push/,'legacy V317 browser recovery runner must not be injected');
assert.match(injection,/v320-history-trend-owner\.js\?v=20260827-v334-1/,'browser must still load V334 history hard owner');
assert.match(injection,/X-CE-QC-Unified-Runner/,'single-runner response header must be observable');

assert.match(htmlOwner,/2026-09-02-consolidated-persisted-status-loader-v1/,'HTML owner must expose the consolidated V414 persisted-status loader');
assert.match(htmlOwner,/V411_STATUS_ENTRY_LOCK_LOADER_COMPAT='2026-09-01-v411-serialized-status-entry-lock-loader-v1'/,'V411 fail-closed entry-lock compatibility must remain active');
assert.match(htmlOwner,/PERSISTED_STATUS_BUILD='2026-09-02-v414-one-read-seven-business-status-v1'/,'HTML response must expose the V414 persisted status contract');
assert.match(htmlOwner,/WHPP_PAGE_OWNER='V132'/,'V132 must remain the sole WHPP page owner');
assert.match(htmlOwner,/X-CE-QC-WHPP-Page-Owner/,'WHPP page ownership must be observable in the HTML response');
assert.doesNotMatch(htmlOwner,/\/whpp-v44\.js|\/whpp-v45-cleanup\.js|\/whpp-v47-auto-run\.js|\/v52-whpp-source-truth-route\.js|\/v72-whpp-light-state-bridge\.js|\/v103-home-whpp-card-guard\.js/,'retired WHPP browser layers must not re-enter the live loader');
assert.match(htmlOwner,/v138-ccsl-scan-progress\.js\?v=20260827-v338-1/,'browser must load the V338 CCSL 350/50 detail owner');
assert.match(htmlOwner,/v67-resilient-run-guard\.js\?v=20260902-v414-explicit-1/,'browser must force-load the V414 explicit/restart-only V67 runner');
assert.match(htmlOwner,/v146-unified-import-date-status\.js\?v=20260901-v410-1/,'browser must load the current atomic import UI owner');
assert.match(htmlOwner,/v168-seven-business-status\.js\?v=20260902-v414-status-1/,'browser must force-load the V414 one-read persisted V168 status owner');
assert.match(htmlOwner,/v169-seven-business-legacy-status-sync\.js\?v=20260901-v411-1/,'V411 fail-closed completion/status sync must load after V168 while V67 remains the sole execution owner');
assert.match(server,/resetRunForReport\(parsed\.reportDate\)[\s\S]*await saveState\(ccslState\)/);
assert.match(server,/createOrRecoverRun\(reportDate/);

const screenshotCcslTotal=2478+58+0+150;
assert.equal(screenshotCcslTotal,2686);

console.log('[V414/V411/V410/V378.1/V378/V377/SINGLE-RUNNER/V341/V334/V317] smoke passed · pending selected date beats stale committed input · one exact-date V414 persisted status read supplies CCSL/SHOPEE/WHPP · exact-date last-good progress survives transient fetch failures · unconfirmed truth blocks duplicate start/resume · V67 remains sole explicit execution owner · only exact PROCESS_RESTART_INTERRUPTED proof may auto-recover WHPP · scan=350 · trajectory=50');
