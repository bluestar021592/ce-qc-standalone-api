import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ensureV246TrackingSchema } from '../src/v246TrackingLedgerCore.js';
import { applyV294ExportAttemptSigningTruth } from '../src/v294AttemptSigningTruth.js';
import { statsOf, completeAttemptRatio, completeSigningAverage } from '../src/v200Metrics.js';
import { enforceV294MetricCompleteness } from '../src/v294MetricCompletenessTruth.js';

const db = new DatabaseSync(':memory:');
try {
  db.exec(`
    CREATE TABLE unified_import_batches(
      batchId TEXT PRIMARY KEY,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT
    );
    CREATE TABLE unified_import_rows(
      snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT
    );
    CREATE TABLE track_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,shipmentCode TEXT,reportDate TEXT,eventCode TEXT,
      trackingEventCode TEXT,trackingEventDesc TEXT,trackingEventDescZh TEXT,trackingEventDescKm TEXT,
      eventTime TEXT,rawJson TEXT
    );
    CREATE TABLE business_track_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,businessType TEXT,shipmentCode TEXT,reportDate TEXT,
      eventTime TEXT,eventCode TEXT,rawJson TEXT
    );
  `);
  ensureV246TrackingSchema(db);

  const batches = [
    ['B1','S1','2026-08-01','2026-08-01T01:00:00Z'],
    ['B2','S2','2026-08-02','2026-08-02T01:00:00Z'],
    ['B3','S3','2026-08-03','2026-08-03T01:00:00Z']
  ];
  for (const [batchId,snapshotId,reportDate,createdAt] of batches) {
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,status,createdAt) VALUES(?,?,?,'VALID',?)`)
      .run(batchId,snapshotId,reportDate,createdAt);
  }

  const TB='TBKHQC000001', CN='SPEQC000001', VN='SPEQC000002';
  const memberships = [
    ['S1','2026-08-01','TBKH',TB],
    ['S1','2026-08-01','SHOPEECN',CN],
    ['S2','2026-08-02','SHOPEEVN',VN],
    ['S3','2026-08-03','TBKH',TB],
    ['S3','2026-08-03','SHOPEECN',CN],
    ['S3','2026-08-03','SHOPEEVN',VN]
  ];
  for (const row of memberships) db.prepare(`INSERT INTO unified_import_rows(snapshotId,reportDate,businessType,shipmentCode) VALUES(?,?,?,?)`).run(...row);

  const now='2026-08-05T13:00:00Z';
  const ledgerInsert=db.prepare(`INSERT INTO qc_tracking_ledger(
      shipmentCode,businessType,firstReportDate,lastImportedDate,trackingStatus,terminalReason,podDate,currentState,currentCategory,
      attemptNo,attemptSource,signingDays,lastCheckedAt,createdAt,updatedAt
    ) VALUES(?,?,?,'2026-08-03','TERMINAL','POD','2026-08-05','POD','POD',0,'',NULL,?,?,?)`);
  ledgerInsert.run(TB,'TBKH','2026-08-03',now,now,now);
  ledgerInsert.run(CN,'SHOPEECN','2026-08-03',now,now,now);
  ledgerInsert.run(VN,'SHOPEEVN','2026-08-03',now,now,now);

  const raw=(code,time,desc)=>JSON.stringify({eventCode:code,eventTime:time,trackingEventDescZh:desc});
  const coreEvent=db.prepare(`INSERT INTO track_events(shipmentCode,reportDate,eventCode,eventTime,rawJson) VALUES(?,'2026-08-03',?,?,?)`);
  coreEvent.run(TB,'70','2026-08-01 09:00:00',raw('70','2026-08-01 09:00:00','Parcel start to deliver'));
  coreEvent.run(TB,'150','2026-08-01 18:00:00',raw('150','2026-08-01 18:00:00','Pending delivery failed'));
  coreEvent.run(TB,'70','2026-08-02 09:00:00',raw('70','2026-08-02 09:00:00','Parcel start to deliver'));
  coreEvent.run(TB,'80','2026-08-05 12:00:00',raw('80','2026-08-05 12:00:00','Successfully delivered'));

  const bizEvent=db.prepare(`INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson) VALUES('SHOPEE',?,'2026-08-03',?,?,?)`);
  bizEvent.run(CN,'2026-08-03 09:00:00','70',raw('70','2026-08-03 09:00:00','Parcel start to deliver'));
  bizEvent.run(CN,'2026-08-05 12:00:00','80',raw('80','2026-08-05 12:00:00','Successfully delivered'));
  bizEvent.run(VN,'2026-08-02 09:00:00','70',raw('70','2026-08-02 09:00:00','Parcel start to deliver'));
  bizEvent.run(VN,'2026-08-02 18:00:00','150',raw('150','2026-08-02 18:00:00','Pending'));
  bizEvent.run(VN,'2026-08-03 09:00:00','70',raw('70','2026-08-03 09:00:00','Parcel start to deliver'));
  bizEvent.run(VN,'2026-08-03 18:00:00','150',raw('150','2026-08-03 18:00:00','Delivery failed'));
  bizEvent.run(VN,'2026-08-04 09:00:00','70',raw('70','2026-08-04 09:00:00','Parcel start to deliver'));
  bizEvent.run(VN,'2026-08-05 12:00:00','80',raw('80','2026-08-05 12:00:00','Successfully delivered'));

  const baseRow=(shipmentCode)=>({
    shipmentCode,pod:true,podDate:'2026-08-05',podTime:'2026-08-05 12:00:00',firstReportDate:'2026-08-03',
    area:'金边',returned:false,pending:false,delivering:false,store:false
  });
  const tbRows=[baseRow(TB)],cnRows=[baseRow(CN)],vnRows=[baseRow(VN)];
  applyV294ExportAttemptSigningTruth('TBKH',tbRows,{db,range:{from:'2026-08-03',to:'2026-08-03'}});
  applyV294ExportAttemptSigningTruth('SHOPEECN',cnRows,{db,range:{from:'2026-08-03',to:'2026-08-03'}});
  applyV294ExportAttemptSigningTruth('SHOPEEVN',vnRows,{db,range:{from:'2026-08-03',to:'2026-08-03'}});

  assert.equal(tbRows[0].attemptNo,2,'TBKH must read 70/150/70 from core track_events as second attempt');
  assert.equal(cnRows[0].attemptNo,1,'SHOPEECN must be first attempt from SHOPEE track evidence');
  assert.equal(vnRows[0].attemptNo,3,'SHOPEEVN must be third attempt from two failure-separated new STARTs');
  assert.equal(tbRows[0].firstReportDate,'2026-08-01','TBKH lifecycle first date must come from all latest-VALID daily memberships');
  assert.equal(cnRows[0].firstReportDate,'2026-08-01','CN lifecycle first date must be immutable earliest latest-VALID membership');
  assert.equal(vnRows[0].firstReportDate,'2026-08-02','VN lifecycle first date must be earliest latest-VALID membership');
  assert.deepEqual(tbRows[0].dailyMembershipDates,['2026-08-03'],'selected daily trend must stay on exact 8/3 report membership, not lifecycle first date');
  assert.equal(tbRows[0].signingDays,5,'TBKH signing days 8/1→8/5 inclusive must be 5');
  assert.equal(cnRows[0].signingDays,5,'CN signing days 8/1→8/5 inclusive must be 5');
  assert.equal(vnRows[0].signingDays,4,'VN signing days 8/2→8/5 inclusive must be 4');

  const stats=statsOf([...tbRows,...cnRows,...vnRows],{from:'2026-08-03',to:'2026-08-03'});
  const d=stats.daily.find(row=>row.date==='2026-08-03');
  assert.equal(d.total,3,'daily denominator must be exact 8/3 membership for all three fixture rows');
  assert.equal(d.pod,3);
  assert.equal(d.a1,1);
  assert.equal(d.a2,1);
  assert.equal(d.a3,1);
  assert.equal(completeAttemptRatio(d,d.a1),1/3);
  assert.equal(completeSigningAverage(d.days,d.pod),Number(((5+5+4)/3).toFixed(2)));

  const partial=enforceV294MetricCompleteness({pod:3,attempt1:2,attempt2:0,attempt3:0,attemptUnknown:1,signingDaysCount:2,signingDaysSum:6});
  assert.equal(partial.attempt1Rate,null,'partial POD attempt evidence must not publish a misleading percentage');
  assert.equal(partial.attempt2Rate,null);
  assert.equal(partial.attempt3Rate,null);
  assert.equal(partial.avgPodDays,null,'partial POD signing evidence must not publish a misleading average');
  assert.equal(partial.attemptCoverageRate,66.67);
  assert.equal(partial.signingCoverageRate,66.67);

  const complete=enforceV294MetricCompleteness({pod:3,attempt1:1,attempt2:1,attempt3:1,attemptUnknown:0,signingDaysCount:3,signingDaysSum:14});
  assert.equal(complete.attempt1Rate,33.33);
  assert.equal(complete.attempt2Rate,33.33);
  assert.equal(complete.attempt3Rate,33.33);
  assert.equal(complete.avgPodDays,4.67);

  const trendSource=fs.readFileSync(new URL('../src/v273DashboardTruthReadPatch.js',import.meta.url),'utf8');
  const shopeeTrendSource=fs.readFileSync(new URL('../src/v244ShopeeTrendRuntimePatch.js',import.meta.url),'utf8');
  const rangeFacade=fs.readFileSync(new URL('../src/rangeDashboardStore.js',import.meta.url),'utf8');
  const exportSource=fs.readFileSync(new URL('../src/v225ExportReturnTruth.js',import.meta.url),'utf8');
  const exportSummarySource=fs.readFileSync(new URL('../src/v200TemplateDashboardExporter.js',import.meta.url),'utf8');
  assert.match(trendSource,/enforceV294MetricCompleteness/,'generic dashboard trend must use complete evidence publication gate');
  assert.match(shopeeTrendSource,/enforceV294MetricCompleteness/,'Shopee trend must use same complete evidence gate');
  assert.match(rangeFacade,/rangeDashboardStoreV294/,'range/dashboard cards must pass through V294 parity wrapper');
  assert.match(exportSource,/applyV294ExportAttemptSigningTruth/,'export detail/dashboard must use V294 attempt/signing truth');
  assert.match(exportSummarySource,/completeAttemptRatio/,'export job summary must not publish partial attempt rates');
  assert.match(exportSummarySource,/completeSigningAverage/,'export job summary must not publish partial signing average');

  console.log('[V294] QC system parity smoke passed · TBKH=2派 from core track_events, CN=1派, VN=3派, daily membership date is separate from lifecycle signing origin, partial evidence publishes —');
} finally {
  db.close();
}
