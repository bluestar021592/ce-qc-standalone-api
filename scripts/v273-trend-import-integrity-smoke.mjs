import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import { DatabaseSync } from 'node:sqlite';
process.env.NODE_ENV='test';
const {parseUnifiedDailyExcel}=await import('../src/unifiedExcelParser.js');
const {compareV273ReuploadCounts,compareV273Membership,readV273SourceWaybillCensus,compareV273ParsedToCensus}=await import('../src/v273ImportCompletenessGuard.js');
const {readV273DashboardTrends,V273_DASHBOARD_TRUTH_ID}=await import('../src/v273DashboardTruthReadPatch.js');
const {ensureV246TrackingSchema}=await import('../src/v246TrackingLedgerCore.js');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v273-'));
try{
  const file=path.join(temp,'2026-08-17.xlsx');
  const wb=XLSX.utils.book_new();
  // This sheet intentionally has NO recipient/customer column. It verifies that
  // a valid waybill sheet can no longer be silently skipped only because the
  // recipient header is absent.
  const noRecipient=XLSX.utils.aoa_to_sheet([
    ['运单号','日报日期'],
    ['CC260817000001','2026-08-17'],
    ['CE260817000002','2026-08-17'],
    ['TBKH000000003','2026-08-17']
  ]);
  XLSX.utils.book_append_sheet(wb,noRecipient,'无收件人列');
  // CEAF still requires the real strong customer-name rule, so keep that case
  // on a separate normal sheet rather than accidentally making 客户名称 count as
  // a recipient header in the no-recipient fixture above.
  const ceaf=XLSX.utils.aoa_to_sheet([
    ['运单号','客户名称','日报日期'],
    ['CC260817000004','CCAF','2026-08-17']
  ]);
  XLSX.utils.book_append_sheet(wb,ceaf,'CEAF');
  XLSX.writeFile(wb,file);

  const census=readV273SourceWaybillCensus(file);
  assert.equal(census.count,4,'independent workbook census must see all visible waybill-shaped cells');
  const parsed=parseUnifiedDailyExcel(file,{reportDate:'2026-08-17',originalName:'2026-08-17.xlsx'});
  assert.equal(parsed.summary.validUniqueWaybills,4,'sheet without recipient column must not be silently skipped');
  assert.equal(parsed.classificationCounts.CE,1);assert.equal(parsed.classificationCounts.WHPP,1);assert.equal(parsed.classificationCounts.TBKH,1);assert.equal(parsed.classificationCounts.CEAF,1);
  assert.equal(parsed.sourceReconciliation.balanced,true);
  const noRecipientDiag=parsed.sheetDiagnostics.find(row=>row.sheetName==='无收件人列');
  assert.equal(noRecipientDiag?.status,'VALID');
  assert.match(String(noRecipientDiag?.reason||''),/收件人列未识别/);
  assert.equal(noRecipientDiag?.detectedColumns?.recipientDetection,'NOT_FOUND_OPTIONAL');
  assert.equal(compareV273ParsedToCensus(parsed.rows.map(r=>r.shipmentCode),census.bills).ok,true);
  assert.equal(compareV273ParsedToCensus(parsed.rows.slice(0,3).map(r=>r.shipmentCode),census.bills).ok,false,'source census must catch a parser-side missing bill');
  assert.equal(compareV273ReuploadCounts(1200,1000).ok,true);
  assert.equal(compareV273ReuploadCounts(999,1000).ok,false,'same-date smaller reupload must be blocked');
  assert.equal(compareV273Membership(['CC1','CC2','CC3'],['CC1','CC2']).ok,true);
  assert.equal(compareV273Membership(['CC1','CC3','CC4'],['CC1','CC2']).ok,false,'larger reupload must still be blocked if it drops an old bill');

  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
    CREATE TABLE unified_import_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,batchId TEXT,snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT);
    CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT);
    CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT);`);
  ensureV246TrackingSchema(db);
  db.prepare("INSERT INTO unified_import_batches VALUES(?,?,?,?,?)").run('B20','S20','2026-08-20','VALID','2026-08-20T10:00:00Z');
  db.prepare("INSERT INTO unified_import_batches VALUES(?,?,?,?,?)").run('B21','S21','2026-08-21','VALID','2026-08-21T10:00:00Z');
  db.prepare("INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode) VALUES(?,?,?,?,?)").run('B20','S20','2026-08-20','CE','CC20');
  db.prepare("INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode) VALUES(?,?,?,?,?)").run('B21','S21','2026-08-21','CE','CC21');
  const now='2026-08-24T00:00:00Z';
  const ins=db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  ins.run('CC20','CE','2026-08-20','2026-08-20','S20','S20','TERMINAL','POD',now,'POD','POD',now,'2026-08-20',0,'',1,'{}','{}',now,'TEST',now,now);
  ins.run('CC21','CE','2026-08-21','2026-08-21','S21','S21','OPEN','', '', 'OC','OC',now,'',0,'',null,'{}','{}',now,'TEST',now,now);
  const trends=readV273DashboardTrends('CE','2026-08-21','2026-08-21',db);
  assert.equal(trends.id,V273_DASHBOARD_TRUTH_ID);
  assert.deepEqual(trends.dates,['2026-08-20','2026-08-21']);
  assert.equal(trends.daily[0].ready,true);assert.equal(trends.daily[0].podRate,100);assert.equal(trends.daily[0].sameDayPodRate,100);
  assert.equal(trends.daily[1].ready,true);assert.equal(trends.daily[1].ocRate,100);
  assert.deepEqual(trends.missingDates,[],'ledger-backed generic trends must not stay blank when final_rows history is missing');
  db.close();
  console.log('[V273] source census + true no-recipient preservation + anti-shrink/membership-loss + ledger-backed CE trend truth passed');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
