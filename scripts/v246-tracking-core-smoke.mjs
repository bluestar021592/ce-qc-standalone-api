import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { classifyV246Terminal, v246InclusiveDays } from '../src/v246TrackingLedgerCore.js';
import { analyzeV246ShopeeAttemptCycle, findV246PodDate, v246PositivePodText } from '../src/shopeeAttemptCycleV246.js';
import { whppCompletionAuthorityDecision, whppLegacyCompletionRecoveryDecision } from '../src/v142SevenBusinessHistoryAudit.js';

const terminal = stateJson => classifyV246Terminal({ stateJson });

for (const stateJson of [
  { currentState:'NORMAL_FINAL', latestEventDesc:'正常分流节点，未签收' },
  { currentState:'SELF_PICKUP', primaryCategory:'仓库自提' },
  { currentState:'CCSL580_RETENTION', primaryCategory:'580滞留包裹' },
  { currentState:'SHOP_ARRIVED_CURRENT', primaryCategory:'门店入库' },
  { currentState:'RETURN_IN_PROGRESS', 退回状态:'退回处理中', latestEventDesc:'正在退回' },
  { currentState:'OPEN_TRACK_REQUIRED', latestEventDesc:'未妥投，继续派送' }
]) {
  assert.equal(terminal(stateJson).terminal,false,`must stay OPEN: ${JSON.stringify(stateJson)}`);
}
assert.equal(classifyV246Terminal({closeReason:'RETURNED',stateJson:{currentState:'RETURN_IN_PROGRESS',退回状态:'退回处理中'}}).terminal,false,'legacy broad RETURNED closeReason must not close return-in-progress');
assert.equal(terminal({orderStatus:'85'}).reason,'POD');
assert.equal(terminal({latestTrackStatusCode:'80',latestEventDesc:'POD'}).reason,'POD');
assert.equal(terminal({currentState:'POD'}).reason,'POD');
assert.equal(terminal({orderStatus:'100'}).reason,'RETURNED');
assert.equal(terminal({latestTrackStatusCode:'86'}).reason,'RETURNED');
assert.equal(terminal({currentState:'RETURN_COMPLETED'}).reason,'RETURNED');
assert.equal(terminal({orderStatus:'10'}).reason,'ORDER_CANCELLED');
assert.equal(v246PositivePodText('未签收状态(70)'),false);
assert.equal(v246PositivePodText('未妥投'),false);
assert.equal(v246PositivePodText('Successfully delivered'),true);
assert.equal(v246InclusiveDays('2026-08-01','2026-08-01'),1);
assert.equal(v246InclusiveDays('2026-08-01','2026-08-03'),3,'signing days must remain first report -> POD inclusive');

const e=(code,time,desc='')=>({eventCode:String(code),eventTime:time,trackingEventDescZh:desc});
let cycle=analyzeV246ShopeeAttemptCycle([
  e(70,'2026-08-01 09:00:00','开始派送'),e(70,'2026-08-01 09:05:00','重复派送节点'),e(80,'2026-08-01 15:00:00','POD')
],{podDate:'2026-08-01'});
assert.equal(cycle.attemptNo,1,'duplicate START must stay attempt 1');
cycle=analyzeV246ShopeeAttemptCycle([
  e(70,'2026-08-01 09:00:00','开始派送'),e(150,'2026-08-01 18:00:00','Pending 无人接听'),e(70,'2026-08-02 09:00:00','再次开始派送'),e(80,'2026-08-02 16:00:00','POD')
],{podDate:'2026-08-02'});
assert.equal(cycle.attemptNo,2,'new START after failure/Pending must become attempt 2');
cycle=analyzeV246ShopeeAttemptCycle([
  e(70,'2026-08-01 09:00:00'),e(150,'2026-08-01 18:00:00','Pending'),e(70,'2026-08-02 09:00:00'),e(150,'2026-08-02 18:00:00','派送失败'),e(70,'2026-08-03 09:00:00'),e(80,'2026-08-03 17:00:00','已签收')
],{podDate:'2026-08-03'});
assert.equal(cycle.attemptNo,3,'two failure-separated restarts must become attempt 3+');
cycle=analyzeV246ShopeeAttemptCycle([
  e(70,'2026-08-01 09:00:00'),e(70,'2026-08-02 09:00:00'),e(80,'2026-08-02 17:00:00','已签收')
],{podDate:'2026-08-02'});
assert.equal(cycle.attemptNo,1,'different-day START without failure evidence must not fabricate attempt 2');
cycle=analyzeV246ShopeeAttemptCycle([
  e(60,'2026-08-01 08:00:00','分配快递员'),e(150,'2026-08-01 18:00:00','Pending'),e(60,'2026-08-02 08:00:00','重新分配'),e(80,'2026-08-02 17:00:00','POD')
],{podDate:'2026-08-02'});
assert.equal(cycle.attemptNo,2,'code 60 must be fallback when no code 70 exists');
assert.equal(cycle.startMode,'TRACK_60_FALLBACK');
assert.equal(findV246PodDate([e(70,'2026-08-02 10:00:00','未签收'),e(80,'2026-08-03 17:00:00','POD')]),'2026-08-03');
assert.equal(findV246PodDate([e(70,'2026-08-02 10:00:00','未签收')]),'','negative POD wording must never fabricate POD date');

// V456: non-zero WHPP history must use the exact same completion authority as
// formal export. Merely having any same-date snapshot can never make history safe.
let whppAuthority=whppCompletionAuthorityDecision({
  reportPresent:true,reported:228,summary:{completed:false,snapshotStatus:'',finalizedSnapshotId:''},snapshotRows:[]
});
assert.equal(whppAuthority.eligible,false);
assert.equal(whppAuthority.reason,'WHPP_DAILY_NOT_COMPLETED');
whppAuthority=whppCompletionAuthorityDecision({
  reportPresent:true,reported:228,summary:{completed:true,snapshotStatus:'COMPLETED',finalizedSnapshotId:'WHPP-FINAL'},snapshotRows:[]
});
assert.equal(whppAuthority.eligible,false);
assert.equal(whppAuthority.reason,'WHPP_FINALIZED_SNAPSHOT_ROW_MISSING');
whppAuthority=whppCompletionAuthorityDecision({
  reportPresent:true,reported:228,summary:{completed:true,snapshotStatus:'COMPLETED',finalizedSnapshotId:'WHPP-FINAL'},
  snapshotRows:[{snapshotId:'WHPP-OTHER',status:'VALID',reconciliationStatus:'COMPLETED'}]
});
assert.equal(whppAuthority.eligible,false,'unrelated same-date snapshot must not authorize export');
assert.equal(whppAuthority.reason,'WHPP_FINALIZED_SNAPSHOT_ROW_MISSING');
whppAuthority=whppCompletionAuthorityDecision({
  reportPresent:true,reported:228,summary:{completed:true,snapshotStatus:'COMPLETED',finalizedSnapshotId:'WHPP-FINAL'},
  snapshotRows:[{snapshotId:'WHPP-FINAL',status:'INVALID',reconciliationStatus:'FAILED'}]
});
assert.equal(whppAuthority.eligible,false,'invalid/failed exact snapshot must fail closed');
assert.equal(whppAuthority.reason,'WHPP_FINALIZED_SNAPSHOT_INVALID_OR_FAILED');
whppAuthority=whppCompletionAuthorityDecision({
  reportPresent:true,reported:228,summary:{completed:true,snapshotStatus:'COMPLETED',finalizedSnapshotId:'WHPP-FINAL'},
  snapshotRows:[{snapshotId:'WHPP-FINAL',status:'',reconciliationStatus:''}]
});
assert.equal(whppAuthority.eligible,true,'legacy exact snapshot may be accepted only when completed daily authority attests it');
assert.equal(whppAuthority.reason,'WHPP_LEGACY_FINALIZED_SNAPSHOT_ATTESTED');
whppAuthority=whppCompletionAuthorityDecision({
  reportPresent:true,reported:228,summary:{completed:true,snapshotStatus:'COMPLETED',finalizedSnapshotId:'WHPP-FINAL'},
  snapshotRows:[{snapshotId:'WHPP-FINAL',status:'VALID',reconciliationStatus:'COMPLETED'}]
});
assert.equal(whppAuthority.eligible,true);
assert.equal(whppAuthority.reason,'WHPP_VALID_COMPLETED_SNAPSHOT');

// V457/V460: legacy recovery still requires absent completion metadata and exact
// daily-member final coverage. Multiple old same-date snapshots are allowed only
// when business_history_summary.snapshotId uniquely selects one viable candidate.
let legacy=whppLegacyCompletionRecoveryDecision({
  reportPresent:true,reported:190,summary:{batchId:'B',snapshotId:'UNIFIED',total:190},dailyRows:190,coveredDailyRows:190,
  snapshotRows:[{snapshotId:'WHPP-OLD',status:'',reconciliationStatus:''}],historySnapshotId:'WHPP-OLD'
});
assert.equal(legacy.eligible,true);
assert.equal(legacy.reason,'WHPP_LEGACY_COMPLETION_METADATA_LOST_ATTESTED');
assert.equal(legacy.attestedSnapshotCandidateCount,1);
legacy=whppLegacyCompletionRecoveryDecision({
  reportPresent:true,reported:190,summary:{completed:false,snapshotStatus:'PROCESSING'},dailyRows:190,coveredDailyRows:190,
  snapshotRows:[{snapshotId:'WHPP-OLD',status:'VALID',reconciliationStatus:'COMPLETED'}],historySnapshotId:'WHPP-OLD'
});
assert.equal(legacy.eligible,false,'explicit incomplete metadata must never use legacy recovery');
legacy=whppLegacyCompletionRecoveryDecision({
  reportPresent:true,reported:190,summary:{batchId:'B',total:190},dailyRows:190,coveredDailyRows:189,
  snapshotRows:[{snapshotId:'WHPP-OLD',status:'VALID',reconciliationStatus:'COMPLETED'}],historySnapshotId:'WHPP-OLD'
});
assert.equal(legacy.eligible,false,'one uncovered daily member must keep export blocked');
legacy=whppLegacyCompletionRecoveryDecision({
  reportPresent:true,reported:190,summary:{batchId:'B',total:190},dailyRows:190,coveredDailyRows:190,
  snapshotRows:[{snapshotId:'A',status:'VALID',reconciliationStatus:'COMPLETED'},{snapshotId:'B',status:'VALID',reconciliationStatus:'COMPLETED'}],historySnapshotId:'A'
});
assert.equal(legacy.eligible,true,'multiple old candidates are safe only when the persisted history id uniquely selects one');
assert.equal(legacy.recoveredSnapshotId,'A');
assert.equal(legacy.viableSnapshotCandidateCount,2);
assert.equal(legacy.attestedSnapshotCandidateCount,1);
legacy=whppLegacyCompletionRecoveryDecision({
  reportPresent:true,reported:190,summary:{batchId:'B',total:190},dailyRows:190,coveredDailyRows:190,
  snapshotRows:[{snapshotId:'WHPP-OLD',status:'VALID',reconciliationStatus:'COMPLETED'}],historySnapshotId:'DIFFERENT'
});
assert.equal(legacy.eligible,false,'history attestation must point to an exact viable same-date snapshot');
assert.equal(legacy.reason,'WHPP_LEGACY_HISTORY_SNAPSHOT_MISMATCH');

// V451 owners are part of the already-wired go-live smoke. This locks the
// 27GB-safe read path so a later patch cannot silently reintroduce range scans.
for(const file of ['src/v142SevenBusinessHistoryAudit.js','public/v142-history-integrity-audit.js','public/v246-qc-tracking.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const trackingUi=fs.readFileSync('public/v246-qc-tracking.js','utf8');
assert.match(trackingUi,/2026-09-07-v450-tracking-summary-auto-read-v1/,'V450 tracking read-only summary marker missing');
assert.match(trackingUi,/function mount\(\)\{const panel=ensurePanel\(\);if\(panel&&!initialReadStarted\)\{initialReadStarted=true;queueMicrotask\(\(\)=>void read\(\)\);\}\}/,'tracking counters must auto-read once after mount');
assert.match(trackingUi,/\/api\/v246\/tracking\/summary\?/,'auto read must use the summary GET route');
assert.doesNotMatch(trackingUi,/function mount\([^)]*\)[\s\S]{0,220}tracking\/reconcile/,'mount must never auto-start reconcile');

const historyAudit=fs.readFileSync('src/v142SevenBusinessHistoryAudit.js','utf8');
assert.match(historyAudit,/2026-09-07-v451-snapshot-indexed-readonly-history-audit-v2-fail-closed/,'V451 indexed history audit marker missing');
assert.match(historyAudit,/2026-09-08-v456-whpp-finalized-snapshot-authority-diagnostic-v1/,'V456 WHPP authority diagnostic marker missing');
assert.match(historyAudit,/2026-09-08-v457-whpp-legacy-metadata-loss-attestation-v1/,'V457 legacy completion attestation marker missing');
assert.match(historyAudit,/2026-09-08-v460-whpp-history-snapshot-exact-disambiguation-v1/,'V460 exact history snapshot disambiguation marker missing');
assert.match(historyAudit,/scanMode:'V451_SNAPSHOT_INDEXED_READ'/,'history audit must expose snapshot-indexed read mode');
assert.match(historyAudit,/snapshotId IN \(\$\{marks\}\)/,'large unified history reads must be anchored by selected snapshotId');
assert.doesNotMatch(historyAudit,/FROM unified_import_rows\s+WHERE reportDate BETWEEN/,'unified_import_rows must never be range-scanned by reportDate');
assert.doesNotMatch(historyAudit,/FROM business_track_events\s+WHERE reportDate BETWEEN/,'business_track_events diagnostic must never block history audit');
assert.doesNotMatch(historyAudit,/FROM scan_results\s+WHERE reportDate BETWEEN/,'scan_results diagnostic must never block history audit');
assert.match(historyAudit,/heavyDiagnosticCountsSkipped:true/,'V451 must explicitly report skipped heavy diagnostics');
assert.match(historyAudit,/const exportReady=missing\.length===0&&incomplete\.length===0/,'export readiness must remain fail-closed');
assert.doesNotMatch(historyAudit,/catch\s*\{\s*return\s*\[\]\s*;?\s*\}/,'SQL read failures must not be swallowed as empty history');
assert.match(historyAudit,/WHERE businessType='WHPP' AND reportDate BETWEEN \? AND \?/,'WHPP indexed daily history must stay date-bounded');
assert.match(historyAudit,/SELECT reportDate,snapshotId,status,reconciliationStatus,createdAt,id/,'V456/V457/V460 WHPP authority check must stay metadata-only');
assert.match(historyAudit,/whppCompletionAuthorityDecision/,'V456 must use one explicit fail-closed WHPP authority decision');
assert.match(historyAudit,/whppLegacyCompletionRecoveryDecision/,'V457/V460 must use one explicit fail-closed legacy recovery decision');
assert.match(historyAudit,/business_history_summary/,'legacy recovery must require persisted history snapshot attestation');
assert.match(historyAudit,/coveredDailyRows/,'legacy recovery must prove exact daily-member final coverage');
assert.match(historyAudit,/attestedSnapshotCandidateCount/,'V460 must expose exact history-id match count instead of rejecting unrelated old candidates');
assert.doesNotMatch(historyAudit,/payloadJson\s+FROM business_export_snapshots/,'history audit must not hydrate WHPP snapshot payloads');
assert.doesNotMatch(historyAudit,/function whppDay\(/,'old per-day WHPP query loop must remain retired');
assert.doesNotMatch(historyAudit,/function airMismatch\(/,'old per-day wildcard air-marker scan must remain retired');

const historyUi=fs.readFileSync('public/v142-history-integrity-audit.js','utf8');
assert.match(historyUi,/2026-09-07-v451-snapshot-indexed-history-audit-ui-v1/,'V451 indexed history UI marker missing');
assert.match(historyUi,/2026-09-08-v456-whpp-authority-diagnostic-ui-v1/,'V456 exact WHPP diagnostic UI marker missing');
assert.match(historyUi,/2026-09-08-v460-whpp-history-snapshot-disambiguation-ui-v1/,'V460 UI disambiguation marker missing');
assert.match(historyUi,/2026-09-08-v470-whpp-current-vs-retained-retry-display-v1/,'V470 retry display marker missing');
assert.match(historyUi,/function retryDisplayTruth\(payload=\{\}\)/,'V470 must derive retry display from the already-returned history payload');
assert.match(historyUi,/\/-V464-\/i\.test\(snapshotId\)/,'only V464 recovery snapshots may move retry markers into retained-history display');
assert.match(historyUi,/raw-retained/,'current interface retry display must subtract only V464 retained historical markers');
assert.match(historyUi,/当前接口待重试/,'V470 UI must label actionable retries explicitly');
assert.match(historyUi,/历史retry标记保留/,'V470 UI must label retained historical retry markers explicitly');
assert.match(historyUi,/V464离线恢复审计事实，不需重跑/,'V470 UI must tell operators retained markers do not require business rerun');
assert.match(historyUi,/WHPP诊断/,'V456 UI must show the exact WHPP authority reason and bounded counts');
assert.match(historyUi,/历史精确命中/,'V460 UI must show the exact history snapshot match count');
assert.match(historyUi,/finalizedSnapshotId/,'V456 UI must expose whether the final snapshot id exists');
assert.match(historyUi,/new AbortController\(\)/,'manual history audit must keep a browser-side timeout guard');
assert.match(historyUi,/heavyDiagnosticCountsSkipped===true/,'UI must distinguish skipped heavy diagnostics from numeric zero');
assert.match(historyUi,/不是0票/,'UI must explicitly prevent skipped diagnostics being misread as zero');
assert.match(historyUi,/不需要重新跑业务数据/,'timeout guidance must not ask operators to rerun business data');

const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');
assert.match(shell,/v142-history-integrity-audit\.js\?v=20260908-v470-1/,'V470 shell must cache-bust the corrected retry display UI');
assert.doesNotMatch(shell,/v142-history-integrity-audit\.js\?v=20260908-v460-1/,'retired V460 cache key must not pin the pre-retry-split UI');
assert.doesNotMatch(shell,/v142-history-integrity-audit\.js\?v=20260908-v457-1/,'retired V457 cache key must not pin the pre-disambiguation UI');
assert.doesNotMatch(shell,/v142-history-integrity-audit\.js\?v=20260902-v419-priority-1/,'retired V419 cache key must not pin browsers to the V456 history UI');

console.log('[V470/V460/V458/V457/V456/V451/V246] smoke passed: readonly tracking + snapshot-indexed history audit + exact WHPP completion authority + V464 retained retry display split + V470 cache-bust + fail-closed export safety');
execFileSync(process.execPath,['scripts/v252-lifecycle-smoke.mjs'],{stdio:'inherit'});