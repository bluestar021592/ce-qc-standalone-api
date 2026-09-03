import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v246-ledger-'));
process.env.DATA_DIR=tempRoot;
process.env.DB_FILE=path.join(tempRoot,'v246-ledger-smoke.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.CE_QC_DISABLE_V246_TRACKING='1';

const {getDb,closeDb}=await import('../src/db.js');
const {
  reconcileV246TrackingLedger,
  v246TrackingSummary,
  applyV246StrictAttemptEvidence,
  ensureV246TrackingSchema
}=await import('../src/v246TrackingLedgerCore.js');
const db=getDb();ensureV246TrackingSchema(db);
const now='2026-08-23T00:00:00.000Z';
const reportDate='2026-08-01';const snapshotId='V246-S1',batchId='V246-B1';

db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(snapshotId,batchId,reportDate,'COMPLETED','{}',now);
db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(batchId,snapshotId,reportDate,'v246-ledger-smoke.xlsx','hash-v246','VALID','{}','[]',now);
const insertImport=db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for(const [i,bill] of ['TBKH-LEAK-NORMAL','TBKH-RETURN-OPEN','TBKH-TRUE-POD'].entries())insertImport.run(batchId,snapshotId,reportDate,'TBKH',bill,'PP','TBKH','TBKH','日报',i+1,'SMOKE','{}',now);

const insertCarry=db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
insertCarry.run('TBKH-LEAK-NORMAL','TBKH','2026-08-01','2026-08-01',snapshotId,snapshotId,'CLOSED','SUCCESS','NORMAL_FINAL',JSON.stringify({currentState:'NORMAL_FINAL',primaryCategory:'正常分流节点',latestEventDesc:'正常分流，未签收'}),now,now);
insertCarry.run('TBKH-RETURN-OPEN','TBKH','2026-08-01','2026-08-01',snapshotId,snapshotId,'CLOSED','SUCCESS','RETURNED',JSON.stringify({currentState:'RETURN_IN_PROGRESS',退回状态:'退回处理中',latestEventDesc:'正在退回'}),now,now);
insertCarry.run('TBKH-TRUE-POD','TBKH','2026-08-01','2026-08-01',snapshotId,snapshotId,'CLOSED','SUCCESS','POD',JSON.stringify({currentState:'POD',orderStatus:'85',是否POD:'是',POD时间:'2026-08-03 12:00:00'}),now,now);
insertCarry.run('TBKH-OLD-UPLOAD-ONLY','TBKH','2026-08-02','2026-08-02','OLD-SNAPSHOT','OLD-SNAPSHOT','CLOSED','SUCCESS','NORMAL_FINAL',JSON.stringify({currentState:'NORMAL_FINAL',primaryCategory:'正常分流节点',latestEventDesc:'未签收'}),now,now);

const result=reconcileV246TrackingLedger({businessType:'TBKH',fromDate:'2026-08-01',toDate:'2026-08-03',days:3},{db,reason:'V246_LEDGER_SMOKE'});
assert.equal(result.expected,4,'source union must keep latest-valid imports plus historical carryover');
assert.ok(result.reopened>=3,'false closed rows must be reopened');
for(const bill of ['TBKH-LEAK-NORMAL','TBKH-RETURN-OPEN','TBKH-OLD-UPLOAD-ONLY']){
  const ledger=db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?').get(bill);
  const carry=db.prepare('SELECT * FROM carryover_open_items WHERE shipmentCode=?').get(bill);
  assert.equal(ledger.trackingStatus,'OPEN',`${bill} must stay tracked`);
  assert.equal(ledger.terminalReason,'');
  assert.equal(carry.status,'OPEN',`${bill} legacy carry row must be reopened`);
  assert.equal(carry.closeReason,'');
}
const pod=db.prepare("SELECT * FROM qc_tracking_ledger WHERE shipmentCode='TBKH-TRUE-POD'").get();
assert.equal(pod.trackingStatus,'TERMINAL');
assert.equal(pod.terminalReason,'POD');
assert.equal(pod.firstReportDate,'2026-08-01');
assert.equal(pod.podDate,'2026-08-03');
assert.equal(Number(pod.signingDays),3,'pre-strict compatibility may retain first-report-to-POD days until a real START is proven');

const summary=v246TrackingSummary({businessType:'TBKH',fromDate:'2026-08-01',toDate:'2026-08-03',days:3},db);
assert.equal(summary.total,4);assert.equal(summary.open,3);assert.equal(summary.pod,1);

db.prepare("UPDATE qc_tracking_ledger SET attemptNo=3,attemptSource='LEGACY_DISTINCT_DELIVERY_DATES' WHERE shipmentCode='TBKH-TRUE-POD'").run();
const corrected=applyV246StrictAttemptEvidence([{shipmentCode:'TBKH-TRUE-POD',attemptNo:1,source:'轨迹70严格START/失败循环',podDate:'2026-08-03',starts:[{time:'2026-08-02 09:00:00',code:'70'}],failures:[]}],{db,reason:'V246_STRICT_CORRECTION_SMOKE'});
assert.equal(corrected.corrected,1);
const correctedRow=db.prepare("SELECT attemptNo,attemptSource,signingDays,evidenceJson FROM qc_tracking_ledger WHERE shipmentCode='TBKH-TRUE-POD'").get();
assert.equal(Number(correctedRow.attemptNo),1,'strict cycle must overwrite—not max—with the authoritative attempt');
assert.match(correctedRow.attemptSource,/^V246_STRICT_TRACK:/);
assert.equal(Number(correctedRow.signingDays),2,'strict signing days must be first real START through actual POD, inclusive');
const strictEvidence=JSON.parse(correctedRow.evidenceJson||'{}');
assert.equal(strictEvidence.starts?.[0]?.time,'2026-08-02 09:00:00');

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V246] ledger reconcile smoke passed: historical-source union + false-close reopen + true terminal lock + strict START-to-POD signing days + strict attempt correction');

// Keep package.json/dependencies unchanged. The existing V246 gate explicitly
// chains the V247 dashboard truth smoke as a fresh process so its DB/env are isolated.
execFileSync(process.execPath,['scripts/v247-home-ledger-smoke.mjs'],{stdio:'inherit'});