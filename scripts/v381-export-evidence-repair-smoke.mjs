import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildConsistencyReport, V382_CCSL_PROCESSING_PROOF_ID } from '../src/consistency.js';
import { V384_CCSL_PROCESSING_PROOF_ID } from '../src/v384CcslProcessingProof.js';

for(const file of ['src/v381ExportEvidenceRepair.js','src/v225ExportReturnTruth.js','src/v183SingleBusinessExportJobWorker.js','src/consistency.js','src/v317CcslIncompleteRecoveryPatch.js','src/v384CcslProcessingProof.js','src/v375UnifiedImportMetadataPatch.js','scripts/v384-import-post-processing-proof-smoke.mjs'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const repair=fs.readFileSync('src/v381ExportEvidenceRepair.js','utf8');
const exportTruth=fs.readFileSync('src/v225ExportReturnTruth.js','utf8');
const worker=fs.readFileSync('src/v183SingleBusinessExportJobWorker.js','utf8');
const snapshotSource=fs.readFileSync('src/snapshots.js','utf8');
const ccslRecovery=fs.readFileSync('src/v317CcslIncompleteRecoveryPatch.js','utf8');
const importTruth=fs.readFileSync('src/v375UnifiedImportMetadataPatch.js','utf8');

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
assert.match(exportTruth,/applyV381LedgerExportTruth/,'export must hydrate persisted V381 ledger evidence');
const ledgerIndex=exportTruth.indexOf('applyV381LedgerExportTruth(businessType,rows');
const strictIndex=exportTruth.indexOf('applyV320DispatchSigningTruth(businessType,rows');
assert.ok(ledgerIndex>0&&strictIndex>ledgerIndex,'ledger POD/START hydration must happen before final V320 START->POD signing owner');
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

assert.match(importTruth,/2026-08-31-v384-import-post-hydrated-snapshot-truth-v1/,'successful POST hydration owner must be active');
assert.match(importTruth,/path==='\/api\/import\/unified-daily-report'/,'the exact import POST must be intercepted');
assert.match(importTruth,/readV375LatestUnifiedImport\(\)/,'POST hydration must reuse the same exact snapshot reader as bootstrap/latest');

execFileSync(process.execPath,['scripts/v384-import-post-processing-proof-smoke.mjs'],{stdio:'inherit'});
console.log('[V384/V383/V382/V381] export + import hydration + CCSL processing-proof smoke passed · V381 saved-first 50x4 strict START->POD · import POST renders exact snapshot truth · terminal scan/POD closes directly · nonterminal scan requires non-retry final trajectory proof · API failure never closes · old false-complete snapshot reopens without reupload');
