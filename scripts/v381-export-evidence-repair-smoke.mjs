import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildConsistencyReport, V382_CCSL_PROCESSING_PROOF_ID } from '../src/consistency.js';
import { V384_CCSL_PROCESSING_PROOF_ID } from '../src/v384CcslProcessingProof.js';

for(const file of ['src/v381ExportEvidenceRepair.js','src/v225ExportReturnTruth.js','src/v183SingleBusinessExportJobWorker.js','src/consistency.js','src/v317CcslIncompleteRecoveryPatch.js','src/v384CcslProcessingProof.js','src/v375UnifiedImportMetadataPatch.js','src/v161UnifiedImportRuntimeTruthPatch.js','src/v142SevenBusinessHistoryAudit.js','scripts/v384-import-post-processing-proof-smoke.mjs','scripts/v388-import-carryover-metadata-truth-smoke.mjs','public/v138-ccsl-scan-progress.js','public/v142-history-integrity-audit.js','scripts/v385-v67-detail-owner-release-smoke.mjs'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const repair=fs.readFileSync('src/v381ExportEvidenceRepair.js','utf8');
const exportTruth=fs.readFileSync('src/v225ExportReturnTruth.js','utf8');
const worker=fs.readFileSync('src/v183SingleBusinessExportJobWorker.js','utf8');
const snapshotSource=fs.readFileSync('src/snapshots.js','utf8');
const ccslRecovery=fs.readFileSync('src/v317CcslIncompleteRecoveryPatch.js','utf8');
const importTruth=fs.readFileSync('src/v375UnifiedImportMetadataPatch.js','utf8');
const runtimeTruth=fs.readFileSync('src/v161UnifiedImportRuntimeTruthPatch.js','utf8');
const historyTruth=fs.readFileSync('src/v142SevenBusinessHistoryAudit.js','utf8');
const historyUi=fs.readFileSync('public/v142-history-integrity-audit.js','utf8');

assert.match(repair,/V381_EXPORT_TRACK_BATCH=50/,'export evidence track repair must stay at 50 per request');
assert.match(repair,/V381_EXPORT_TRACK_CONCURRENCY=4/,'export evidence repair must stay at 4 concurrent groups');
assert.match(repair,/backfillV294StrictAttemptsFromSavedEvidence/,'saved SQLite trajectory evidence must be reused before network repair');
assert.match(repair,/TRIM\(COALESCE\(podDate,''\)\)=''/,'missing POD date must enter repair candidates');
assert.match(repair,/COALESCE\(attemptNo,0\)<=0/,'missing strict attempt must enter repair candidates');
assert.match(repair,/json_extract\(evidenceJson,'\$\.starts\[0\]\.time'\)/,'missing real dispatch START must enter repair candidates');
assert.match(repair,/ce\.trackQuery\(bills\)/,'repair must use the real CE trajectory endpoint');
assert.match(repair,/applyV246StrictAttemptEvidence/,'repaired truth must persist through the strict evidence owner');
assert.doesNotMatch(repair,/firstReportDate.*podDate.*signing/i,'repair must not fabricate dispatch signing days from first-report date');

assert.equal((exportTruth.match(/2026-08-27-v329-first-report-pod-export-signing-v1/g)||[]).length,1,'legacy V225 public truth id must remain compatible');
assert.match(exportTruth,/V489_FORMAL_EXPORT_EVIDENCE_PATH_ID/,'formal export must expose the V489 canonical-ledger hot-path owner');
assert.doesNotMatch(exportTruth,/applyV381LedgerExportTruth\s*\(/,'formal workbook hot path must not re-run V381 full-member ledger hydration before V419');
assert.doesNotMatch(exportTruth,/applyV320DispatchSigningTruth\s*\(/,'formal workbook hot path must not re-run V320 full-member event hydration before V419');
assert.match(exportTruth,/if\(!STRICT_DELIVERY_TYPES\.has\(businessType\)\)applyV230AttemptSigningTruth\(businessType,rows\)/,'TBKH/CN/VN must skip legacy V230 full-member saved-track hydration');
assert.match(exportTruth,/applyV419CanonicalExportLedgerTruth\(businessType,rows,\{db:getDb\(\),onProgress\}\)/,'V419 shipmentCode-PK canonical ledger must be the strict formal-export owner before actual-POD gap repair');
assert.match(exportTruth,/STRICT_START_TO_ACTUAL_POD/,'strict START-to-actual-POD export contract must remain unchanged');

const prepareIndex=worker.indexOf('prepareV381ShopeeExportEvidence');
const workbookIndex=worker.indexOf('createV200ReferenceDashboardWorkbook({type');
assert.ok(prepareIndex>0&&workbookIndex>prepareIndex,'Shopee evidence repair must complete before workbook generation starts');
assert.match(worker,/terminalTruth=rootCauseCode==='SHOPEE_EXPORT_TRUTH_INCOMPLETE'/,'truth-incomplete must be recognized as a terminal worker failure');
assert.match(worker,/terminalTruth\?'FAILED':rootCauseCode/,'terminal truth failure must stop V195 reconnect polling instead of masquerading as a transport retry');
assert.match(worker,/evidenceRepairVersion:V381_EXPORT_EVIDENCE_REPAIR_ID/,'worker progress must expose the evidence repair owner');

assert.match(V382_CCSL_PROCESSING_PROOF_ID,/v382-ccsl-scan-or-pod-proof-v1/);
assert.match(V384_CCSL_PROCESSING_PROOF_ID,/v384-scan-success-required-track-final-proof-v1/);
const missing=buildConsistencyReport({
  reportDate:'2026-08-25',pnhBills:['CC-A','CC-B'],
  scanResults:[{shipmentCode:'CC-A',orderStatus:'85',scanCategory:'已签收(POD)'},{shipmentCode:'CC-B',orderStatus:'50',scanCategory:'未签收状态(50)'}],
  podLocks:[],finalRows:[],trackEvents:[],carryBills:[],nextCarryBills:[]
});
assert.equal(missing.processingProof.source,2);
assert.equal(missing.processingProof.covered,1);
assert.equal(missing.processingProof.missing,1);
assert.equal(missing.processingProof.complete,false);
assert.deepEqual(missing.processingProof.missingBills,['CC-B']);
assert.ok(missing.errors.some(x=>String(x).includes('CCSL处理证据不完整')),'50/60/70 or unknown successful scan must not close without a final trajectory result');
const covered=buildConsistencyReport({
  reportDate:'2026-08-25',pnhBills:['CC-A','CC-B'],
  scanResults:[{shipmentCode:'CC-A',orderStatus:'85',scanCategory:'已签收(POD)'},{shipmentCode:'CC-B',orderStatus:'50',scanCategory:'未签收状态(50)'}],
  podLocks:[],finalRows:[{shipmentCode:'CC-B',primaryCategory:'派送中'}],trackEvents:[],carryBills:[],nextCarryBills:[]
});
assert.equal(covered.processingProof.covered,2);
assert.equal(covered.processingProof.missing,0);
assert.equal(covered.processingProof.complete,true);
const failedScan=buildConsistencyReport({
  reportDate:'2026-08-25',pnhBills:['CC-C'],scanResults:[{shipmentCode:'CC-C',orderStatus:'70',scanCategory:'订单扫描API失败'}],
  finalRows:[{shipmentCode:'CC-C',primaryCategory:'派送中'}],podLocks:[],trackEvents:[],carryBills:[],nextCarryBills:[]
});
assert.equal(failedScan.processingProof.complete,false);
assert.equal(failedScan.processingProof.missingReasons[0].reason,'SCAN_FAILED_OR_RETRY');
assert.match(snapshotSource,/const reconciliationFailed = consistency\?\.status === 'error'/,'snapshot validity must remain driven by consistency errors');
assert.match(snapshotSource,/payload\.status = reconciliationFailed \? 'INVALID_FAILED_RECONCILIATION' : 'VALID'/,'missing processing proof must make the formal snapshot invalid rather than green');

assert.match(ccslRecovery,/2026-08-31-v383-retroactive-ccsl-processing-proof-v1/,'V383 retroactive proof owner must remain active');
assert.match(ccslRecovery,/readV384CcslProcessingProof/,'old completed snapshots must use the same strict V384 proof as new snapshots');
assert.match(ccslRecovery,/readV384CcslProcessingProof\(db,\{reportDate,snapshotId,boundary\}\)/,'V384 persisted proof must be bound to the latest VALID import lifecycle timestamp');
assert.match(ccslRecovery,/rejectedLegacySnapshot=Boolean\(rawSnapshot&&!processingProof\.complete\)/,'a legacy completed snapshot without exact proof must be rejected at status read');
assert.match(ccslRecovery,/snapshot=rejectedLegacySnapshot\?null:rawSnapshot/,'rejected legacy snapshot must not drive canonical completion');
assert.match(ccslRecovery,/COMPLETED_SNAPSHOT_REJECTED_MISSING_PROCESSING_PROOF/,'recovery reason must remain observable');
assert.match(ccslRecovery,/V384 reopened finished CCSL run/,'finished false-complete runs must be recoverable without reupload');
assert.doesNotMatch(ccslRecovery,/DELETE FROM (?:scan_results|track_events|final_rows|daily_reports|daily_parse_rows|unified_import_rows|export_snapshots|pod_locks|carry_bills)/,'retroactive validation must preserve all saved facts and old snapshots');

assert.match(importTruth,/2026-08-31-v384-import-post-hydrated-snapshot-truth-v1/,'successful POST hydration owner must remain active');
assert.match(importTruth,/2026-08-31-v387-final-unified-import-post-owner-v1/,'V387 pre-final POST owner must remain active');
assert.match(importTruth,/2026-08-31-v388-immutable-source-metadata-recovery-v2/,'V388 archived metadata recovery owner must remain active');
assert.match(importTruth,/routePath==='\/api\/import\/unified-daily-report'/,'the exact V387 import POST route must be intercepted');
assert.match(importTruth,/readV375LatestUnifiedImport\(\)/,'POST hydration must reuse the same exact snapshot reader as bootstrap/latest');
assert.match(importTruth,/V266_EXACT_SHA_SOURCE_UPLOAD/,'legacy metadata recovery must be bound to the exact immutable source hash');
assert.match(runtimeTruth,/todayOpen:\s*one\("SELECT COUNT\(\*\) count FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate=\?"/,'V161 current-day queue must first read persisted OPEN truth instead of the original import total');
assert.match(runtimeTruth,/historicalOpen:\s*one\("SELECT COUNT\(\*\) count FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate<\?"/,'V161 must read persisted historical OPEN before reconciliation');
assert.match(runtimeTruth,/persisted\.currentOpen = num\(persisted\.todayOpen\) \+ num\(persisted\.historicalOpen\)/,'V161 must retain the persisted today+historical baseline before V417 reconciliation');
assert.match(runtimeTruth,/return reconcileV417Carryover\(getDb\(\), \{ batch, counts, baseCarry: persisted \}\)/,'V161 final owner must reconcile persisted OPEN against current closure truth');
assert.doesNotMatch(runtimeTruth,/currentOpen: mainQueue \+ historicalOpen/,'V161 must never present the full daily membership as current OPEN after rows have closed');
assert.match(runtimeTruth,/runtimeTruth: 'TODAY_OPEN_PLUS_HISTORICAL_OPEN'/,'V161 must expose the persisted queue baseline before V417 closure reconciliation');
assert.match(runtimeTruth,/out\.PP \+ out\.PV === 0 && base\.PP \+ base\.PV > 0/,'V161 must preserve stronger recovered PP/PV metadata instead of overwriting it with blank legacy row evidence');
assert.match(runtimeTruth,/batchDateCandidates\.length[\s\S]*base\.dateCandidates/,'V161 must preserve recovered date candidates when legacy batch dateCandidatesJson is empty');

// V453/V451: historical export safety no longer performs synchronous range COUNTs
// over the 27GB OPEN/scan/track mega tables. Those counts were diagnostic-only and
// could block the Node process. The authoritative export gate remains fail-closed on
// required daily membership/final-detail completeness; skipped diagnostics must be
// explicit and must never be rendered as a false zero.
assert.match(historyTruth,/V451_INDEXED_AUDIT_ONLY/,'history backend must expose the V451 indexed-audit evidence mode');
assert.match(historyTruth,/heavyDiagnosticCountsSkipped:true/,'history backend must explicitly disclose skipped mega-table diagnostics');
assert.match(historyTruth,/skippedDiagnostics:\['carryover_open_items','final_rows_range_count','scan_results','business_scan_results','business_track_events'\]/,'history backend must enumerate every intentionally skipped heavy diagnostic');
assert.match(historyTruth,/exportReady=missing\.length===0&&incomplete\.length===0/,'skipping diagnostics must not relax fail-closed export readiness');
assert.doesNotMatch(historyTruth,/FROM\s+carryover_open_items/i,'history audit must not synchronously scan carryover_open_items on the critical export-safety path');
assert.doesNotMatch(historyTruth,/FROM\s+business_track_events/i,'history audit must not synchronously scan business_track_events on the critical export-safety path');
assert.match(historyUi,/这些项目是“未执行统计”，不是0票/,'history UI must distinguish skipped diagnostics from a real zero count');
assert.match(historyUi,/不会被拿来放宽导出安全判断/,'history UI must disclose that skipped diagnostics do not weaken export safety');
assert.match(historyUi,/选定导出区间仍OPEN/,'older-backend compatibility display must still label export-range OPEN separately when legacy evidence is returned');

execFileSync(process.execPath,['scripts/v384-import-post-processing-proof-smoke.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v385-v67-detail-owner-release-smoke.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v388-import-carryover-metadata-truth-smoke.mjs'],{stdio:'inherit'});
console.log('[V489/V453/V451/V417/V388/V385/V384/V383/V382/V381] export hot-path + indexed history safety + import hydration + archived metadata + closure-reconciled carryover queue + CCSL proof + detail-owner release smoke passed · formal workbook skips duplicate V381/V320 full-member scans and keeps V419→V484 fail-closed truth');
