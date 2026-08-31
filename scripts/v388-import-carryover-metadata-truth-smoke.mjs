import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import XLSX from 'xlsx';

process.env.CI='1';
process.env.NODE_ENV='test';
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.CE_QC_DISABLE_V246_TRACKING='1';
process.env.CE_QC_BACKGROUND_MAINTENANCE_ENABLED='0';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v388-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'v388.db');
process.env.IMPORTS_DIR=path.join(root,'imports');
process.env.EXPORTS_DIR=path.join(root,'exports');
process.env.BACKUPS_DIR=path.join(root,'backups');
process.env.LOGS_DIR=path.join(root,'logs');

let closeDb=()=>{};
try{
  const sourceFile=path.join(root,'archived-source.xlsx');
  const sheet=XLSX.utils.aoa_to_sheet([
    ['运单编号','日报日期','收件人','省份标识','客户名称'],
    ['CC-V388-001','2026-08-25','','PP',''],
    ['CC-V388-002','2026-08-25','','PV','CCAF Customer'],
    ['TBKH-V388-003','2026-08-25','','PP',''],
    ['CC-V388-004','2026-08-25','ALI1688','PV','']
  ]);
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,'日报');
  XLSX.writeFile(book,sourceFile);

  const hash=crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex');
  const archiveDir=path.join(root,'evidence_archive','source_uploads','2026-08');
  fs.mkdirSync(archiveDir,{recursive:true});
  fs.copyFileSync(sourceFile,path.join(archiveDir,`${hash}.xlsx`));

  const {getDb,closeDb:close}=await import('../src/db.js');
  closeDb=close;
  const {parseUnifiedDailyExcel}=await import('../src/unifiedExcelParser.js');
  const {saveUnifiedImport}=await import('../src/unifiedImportStore.js');
  const parsed=parseUnifiedDailyExcel(sourceFile,{originalName:'historical-source.xlsx'});
  assert.equal(parsed.reportDate,'2026-08-25');
  assert.equal(parsed.dateDetectionSource,'日报日期列','fixture must carry real date-source evidence in workbook cells');
  assert.equal(parsed.fileHash,hash);
  assert.deepEqual({PP:parsed.regionCounts.PP,PV:parsed.regionCounts.PV},{PP:2,PV:2});
  const saved=saveUnifiedImport(parsed,'historical-source.xlsx');
  const db=getDb();

  // Reproduce the installed historical symptom: compact batch/snapshot metadata
  // and normalized row region codes are blank, while exact V266 source evidence
  // remains immutable on disk.
  db.prepare("UPDATE unified_import_batches SET dateDetectionSource='',dateCandidatesJson='[]',regionCountsJson='{}',summaryJson='{}' WHERE batchId=?").run(saved.batchId);
  db.prepare("UPDATE unified_snapshots SET payloadJson='{}' WHERE snapshotId=?").run(saved.snapshotId);
  db.prepare("UPDATE unified_import_rows SET regionCode='' WHERE batchId=?").run(saved.batchId);

  const now=new Date().toISOString();
  const insertCarry=db.prepare(`INSERT OR REPLACE INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,'OPEN','SUCCESS','','{}',?,?)`);
  insertCarry.run('V388-HIST-1','CE','2026-08-23','2026-08-25','V388-H1','V388-H1',now,now);
  insertCarry.run('V388-HIST-2','SHOPEECN','2026-08-24','2026-08-25','V388-H2','V388-H2',now,now);

  const {
    readV375LatestUnifiedImport,
    recoverV388ArchivedImportMetadata,
    V388_ARCHIVED_IMPORT_METADATA_ID
  }=await import('../src/v375UnifiedImportMetadataPatch.js');
  const {normalizeV161UnifiedImport,V161_UNIFIED_IMPORT_RUNTIME_TRUTH_PATCH_ID}=await import('../src/v161UnifiedImportRuntimeTruthPatch.js');

  const rawBefore=db.prepare('SELECT dateDetectionSource,dateCandidatesJson,regionCountsJson,summaryJson FROM unified_import_batches WHERE batchId=?').get(saved.batchId);
  const snapshotBefore=db.prepare('SELECT payloadJson,status FROM unified_snapshots WHERE snapshotId=?').get(saved.snapshotId);
  const changesBeforeReads=Number(db.prepare('SELECT total_changes() n').get()?.n||0);

  const recoveredDirect=recoverV388ArchivedImportMetadata({fileHash:hash,reportDate:'2026-08-25',sourceName:'historical-source.xlsx',dateWasManuallyCorrected:0});
  assert.equal(recoveredDirect?.recoveryId,V388_ARCHIVED_IMPORT_METADATA_ID);
  assert.equal(recoveredDirect?.evidence,'V266_EXACT_SHA_SOURCE_UPLOAD');
  assert.equal(recoveredDirect?.dateDetectionSource,'日报日期列');
  assert.equal(recoveredDirect?.dateEvidenceRecovered,true);
  assert.equal(recoveredDirect?.nonDateFallbackUsed,false);
  assert.notEqual(recoveredDirect?.dateDetectionSource,'手动日期','archive recovery must never fabricate manual-date evidence');
  assert.equal(recoveredDirect?.containerFormat,'OOXML_ZIP');
  assert.equal(recoveredDirect?.regionCounts?.PP,2);
  assert.equal(recoveredDirect?.regionCounts?.PV,2);
  assert.equal(recoveredDirect?.summary?.rawRows,4);
  assert.ok(Array.isArray(recoveredDirect?.dateCandidates)&&recoveredDirect.dateCandidates.length>0,'archive recovery must preserve real date candidates');
  assert.equal(recoveredDirect.dateCandidates[0]?.date,'2026-08-25');

  const hydrated=readV375LatestUnifiedImport(db);
  assert.equal(hydrated.reportDate,'2026-08-25');
  assert.equal(hydrated.dateDetectionSource,'日报日期列');
  assert.equal(hydrated.containerFormat,'OOXML_ZIP');
  assert.equal(hydrated.regionCounts.PP,2);
  assert.equal(hydrated.regionCounts.PV,2);
  assert.equal(hydrated.summary.rawRows,4);
  assert.equal(hydrated.metadataRecovery?.recovered,true);
  assert.ok(Array.isArray(hydrated.dateCandidates)&&hydrated.dateCandidates.length>0,'hydrated import must expose recovered date candidates');
  assert.equal(hydrated.dateCandidates[0]?.date,'2026-08-25');
  assert.equal(hydrated.carryover.historicalOpen,2);
  assert.equal(hydrated.carryover.todayOpen,4);
  assert.equal(hydrated.carryover.currentOpen,6,'V375 current queue truth must be today OPEN + historical OPEN');

  const runningInitial=normalizeV161UnifiedImport(hydrated);
  assert.match(V161_UNIFIED_IMPORT_RUNTIME_TRUTH_PATCH_ID,/v388-current-queue-includes-historical-open-v1/);
  assert.equal(runningInitial.snapshotStatus,'IMPORTED');
  assert.equal(runningInitial.carryover.todayOpen,4);
  assert.equal(runningInitial.carryover.historicalOpen,2);
  assert.equal(runningInitial.carryover.currentOpen,6,'fresh imported queue must expose four current OPEN plus two historical OPEN');
  assert.equal(runningInitial.carryover.runtimeTruth,'TODAY_OPEN_PLUS_HISTORICAL_OPEN');
  assert.equal(runningInitial.regionCounts.PP,2,'V161 must not overwrite recovered PP with legacy blank region rows');
  assert.equal(runningInitial.regionCounts.PV,2,'V161 must not overwrite recovered PV with legacy blank region rows');
  assert.ok(Array.isArray(runningInitial.dateCandidates)&&runningInitial.dateCandidates.length>0,'V161 must not overwrite recovered date candidates with an empty legacy batch array');
  assert.equal(runningInitial.dateCandidates[0]?.date,'2026-08-25');
  assert.equal(Number(db.prepare('SELECT total_changes() n').get()?.n||0),changesBeforeReads,'metadata recovery and runtime normalization must remain read-only');

  // Simulate a real processing/refresh result closing one current-day package while
  // the unified snapshot is still IMPORTED. Current queue must shrink immediately;
  // it must never keep showing the entire original daily membership as OPEN.
  db.prepare("UPDATE carryover_open_items SET status='CLOSED',closeReason='SIGNED',updatedAt=? WHERE shipmentCode='CC-V388-001'").run(new Date().toISOString());
  const changesAfterFixtureClose=Number(db.prepare('SELECT total_changes() n').get()?.n||0);
  const runningAfterClose=normalizeV161UnifiedImport(hydrated);
  assert.equal(runningAfterClose.snapshotStatus,'IMPORTED');
  assert.equal(runningAfterClose.carryover.todayOpen,3);
  assert.equal(runningAfterClose.carryover.historicalOpen,2);
  assert.equal(runningAfterClose.carryover.currentOpen,5,'an IMPORTED/running queue must drop a current package as soon as persisted OPEN truth closes it');
  assert.equal(runningAfterClose.carryover.runtimeTruth,'TODAY_OPEN_PLUS_HISTORICAL_OPEN');

  db.prepare("UPDATE unified_snapshots SET status='COMPLETED' WHERE snapshotId=?").run(saved.snapshotId);
  const completedBase=readV375LatestUnifiedImport(db);
  const completed=normalizeV161UnifiedImport(completedBase);
  assert.equal(completed.snapshotStatus,'COMPLETED');
  assert.equal(completed.carryover.todayOpen,3);
  assert.equal(completed.carryover.historicalOpen,2);
  assert.equal(completed.carryover.currentOpen,5,'completed runtime queue must use the same persisted OPEN truth');
  assert.equal(completed.dateCandidates[0]?.date,'2026-08-25','completed runtime truth must keep recovered date candidates too');

  const rawAfter=db.prepare('SELECT dateDetectionSource,dateCandidatesJson,regionCountsJson,summaryJson FROM unified_import_batches WHERE batchId=?').get(saved.batchId);
  const snapshotAfter=db.prepare('SELECT payloadJson FROM unified_snapshots WHERE snapshotId=?').get(saved.snapshotId);
  assert.deepEqual(rawAfter,rawBefore,'read-only archive hydration must never rewrite historical batch metadata');
  assert.equal(snapshotAfter.payloadJson,snapshotBefore.payloadJson,'read-only archive hydration must never rewrite immutable snapshot payload');
  const changesAfter=Number(db.prepare('SELECT total_changes() n').get()?.n||0);
  // After the deliberate fixture close, the only subsequent write is the deliberate
  // snapshot status flip. Metadata recovery/normalization itself must add no writes.
  assert.equal(changesAfter,changesAfterFixtureClose+1,'V388 metadata/carryover reads must remain database read-only');

  const auditSource=fs.readFileSync('src/v142SevenBusinessHistoryAudit.js','utf8');
  const auditUi=fs.readFileSync('public/v142-history-integrity-audit.js','utf8');
  assert.match(auditSource,/sourceReportDate BETWEEN \? AND \?/,'history audit OPEN count must stay bound to selected export source-date range');
  assert.match(auditSource,/carryOpenScope:'SOURCE_REPORT_DATE_BETWEEN_EXPORT_RANGE'/,'backend must expose the history-card range contract');
  assert.match(auditSource,/carryOpenFromDate:from,carryOpenToDate:to/,'backend must expose exact selected range boundaries');
  assert.match(auditUi,/选定导出区间仍OPEN/,'UI must no longer label export-range OPEN as if it were current processing queue');
  assert.match(auditUi,/它不是当前日报“当前处理队列”/,'UI must explicitly distinguish history export scope from current queue truth');
  assert.match(auditUi,/当日OPEN \+ 当前日前历史OPEN/,'UI must state the current processing queue formula');

  console.log('[V388] import carryover + archived metadata truth smoke passed · V266 exact-SHA workbook restores real date/container/PP-PV/dateCandidates/rawRows read-only · V161 preserves recovered metadata and uses persisted todayOPEN+historicalOPEN in IMPORTED/COMPLETED states · partial current closure shrinks queue before completion · export-range OPEN scope is explicit');
}finally{
  try{closeDb();}catch{}
  try{fs.rmSync(root,{recursive:true,force:true});}catch{}
}
