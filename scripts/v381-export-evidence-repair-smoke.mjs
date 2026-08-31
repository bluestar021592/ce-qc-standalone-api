import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v381ExportEvidenceRepair.js','src/v225ExportReturnTruth.js','src/v183SingleBusinessExportJobWorker.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const repair=fs.readFileSync('src/v381ExportEvidenceRepair.js','utf8');
const exportTruth=fs.readFileSync('src/v225ExportReturnTruth.js','utf8');
const worker=fs.readFileSync('src/v183SingleBusinessExportJobWorker.js','utf8');

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

console.log('[V381] Shopee complete-export evidence repair smoke passed · saved-first · missing POD/START/attempt candidates · 50x4 track · strict START->POD preserved · terminal failure stops false reconnect');
