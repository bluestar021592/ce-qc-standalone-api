import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildConsistencyReport, V382_CCSL_PROCESSING_PROOF_ID } from '../src/consistency.js';

for(const file of ['src/v381ExportEvidenceRepair.js','src/v225ExportReturnTruth.js','src/v183SingleBusinessExportJobWorker.js','src/consistency.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const repair=fs.readFileSync('src/v381ExportEvidenceRepair.js','utf8');
const exportTruth=fs.readFileSync('src/v225ExportReturnTruth.js','utf8');
const worker=fs.readFileSync('src/v183SingleBusinessExportJobWorker.js','utf8');
const snapshotSource=fs.readFileSync('src/snapshots.js','utf8');

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
const missing=buildConsistencyReport({reportDate:'2026-08-25',pnhBills:['CC-A','CC-B'],scanResults:[{shipmentCode:'CC-A'}],podLocks:[],finalRows:[],trackEvents:[],carryBills:[],nextCarryBills:[]});
assert.equal(missing.processingProof.source,2);
assert.equal(missing.processingProof.covered,1);
assert.equal(missing.processingProof.missing,1);
assert.equal(missing.processingProof.complete,false);
assert.ok(missing.errors.some(x=>String(x).includes('CCSL处理证据不完整')),'a non-POD daily member without scan proof must block snapshot completion');
const covered=buildConsistencyReport({reportDate:'2026-08-25',pnhBills:['CC-A','CC-B'],scanResults:[{shipmentCode:'CC-A'}],podLocks:['CC-B'],finalRows:[],trackEvents:[],carryBills:[],nextCarryBills:[]});
assert.equal(covered.processingProof.covered,2);
assert.equal(covered.processingProof.missing,0);
assert.equal(covered.processingProof.complete,true);
assert.ok(!covered.errors.some(x=>String(x).includes('CCSL处理证据不完整')),'scan proof plus terminal POD locks must satisfy exact daily processing coverage');
assert.match(snapshotSource,/const reconciliationFailed = consistency\?\.status === 'error'/,'snapshot validity must remain driven by consistency errors');
assert.match(snapshotSource,/payload\.status = reconciliationFailed \? 'INVALID_FAILED_RECONCILIATION' : 'VALID'/,'missing processing proof must make the formal snapshot invalid rather than green');

console.log('[V382/V381] export + CCSL completion-proof smoke passed · V381 saved-first 50x4 strict START->POD · V382 every non-POD CCSL daily member requires scan proof before a VALID completed snapshot can exist');
