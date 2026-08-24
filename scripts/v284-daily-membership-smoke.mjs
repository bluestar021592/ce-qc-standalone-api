import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
process.env.NODE_ENV='test';
const { ensureV246TrackingSchema } = await import('../src/v246TrackingLedgerCore.js');
const { readV284DashboardTrends, readV284ShopeeTrends, summarizeV284Range, V284_DAILY_MEMBERSHIP_TRUTH_ID } = await import('../src/v284DailyMembershipTruth.js');

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
CREATE TABLE unified_import_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,batchId TEXT,snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT,regionCode TEXT);
CREATE TABLE final_rows(shipmentCode TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT,category TEXT,rawJson TEXT,lastEventTime TEXT,pendingDays INTEGER,ocDays INTEGER,cycleCountDays INTEGER,shopState TEXT,shopRetentionNaturalDays INTEGER);
CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,currentMainCategory TEXT,primaryCategory TEXT,rawJson TEXT,latestEventTime TEXT,podAttemptNo INTEGER,currentAttemptNo INTEGER,shopState TEXT,shopRetentionNaturalDays INTEGER);
CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT);
CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT);
`);
ensureV246TrackingSchema(db);
const now='2026-08-24T00:00:00Z';
const addBatch=(date,id)=>db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)').run(`B${id}`,`S${id}`,date,'VALID',`${date}T08:00:00Z`);
const addImport=(date,id,type,bill,region='PP')=>db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode) VALUES(?,?,?,?,?,?)').run(`B${id}`,`S${id}`,date,type,bill,region);
addBatch('2026-08-17','17');
addImport('2026-08-17','17','CE','CC_DAILY_A','PP');
addImport('2026-08-17','17','CE','CC_DAILY_B','PV');
addImport('2026-08-17','17','SHOPEECN','CN_DAILY_C','PP');
addBatch('2026-08-18','18');
addImport('2026-08-18','18','CE','CC_UNMATCHED','PP');

const ins=db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
// Both CE rows deliberately have firstReportDate values that do NOT equal the 08-17
// daily membership date. V273/V274 old grouping would render 08-17 as missing.
ins.run('CC_DAILY_A','CE','2026-08-10','2026-08-20','SOLD','SNEW','TERMINAL','POD',now,'POD','POD',now,'2026-08-17',0,'',8,'{}','{}',now,'SMOKE',now,now);
ins.run('CC_DAILY_B','CE','2026-08-18','2026-08-20','SOLD','SNEW','OPEN','','','OC','OC',now,'',0,'',null,'{}',JSON.stringify({ocDays:2,'OC天数':2,'Pending不连续':'是'}),now,'SMOKE',now,now);
ins.run('CN_DAILY_C','SHOPEECN','2026-08-12','2026-08-20','SOLD','SNEW','TERMINAL','POD',now,'POD','POD',now,'2026-08-17',2,'V246_STRICT_TRACK:SMOKE',6,'{}','{}',now,'SMOKE',now,now);

const ce=readV284DashboardTrends('CE','2026-08-17','2026-08-18',db);
assert.equal(ce.id,V284_DAILY_MEMBERSHIP_TRUTH_ID);
assert.deepEqual(ce.dates,['2026-08-17','2026-08-18']);
assert.equal(ce.daily[0].total,2);
assert.equal(ce.daily[0].matched,2,'daily membership must join ledger by shipmentCode even when firstReportDate differs');
assert.equal(ce.daily[0].ready,true);
assert.equal(ce.daily[0].podRate,50);
assert.equal(ce.daily[0].sameDayPodRate,50);
assert.equal(ce.daily[0].ocRate,50);
assert.equal(ce.daily[0].oc2,1);
assert.equal(ce.daily[0].pendingNonContinuous,1);
assert.equal(ce.daily[1].total,1);
assert.equal(ce.daily[1].matched,0);
assert.equal(ce.daily[1].ready,false);
assert.deepEqual(ce.missingDates,['2026-08-18'],'coverage gate must identify only truly unmatched daily membership');
assert.equal(ce.podRate[1],null,'incomplete daily membership must not fabricate a zero percentage');

const shopee=readV284ShopeeTrends('SHOPEECN','2026-08-17','2026-08-17',{exact:true,includeRegions:true},db);
assert.deepEqual(shopee.dates,['2026-08-17']);
assert.equal(shopee.daily[0].total,1);
assert.equal(shopee.daily[0].matched,1);
assert.equal(shopee.daily[0].podRate,100);
assert.equal(shopee.daily[0].attempt2,1);
assert.equal(shopee.daily[0].attempt2Rate,100);
assert.equal(shopee.daily[0].avgPodDays,6,'V246 locked signingDays remains authoritative while cohort date comes from daily membership');
assert.equal(shopee.daily[0].regions.PP.total,1);

const range=summarizeV284Range('2026-08-17','2026-08-18',db);
assert.equal(range.sourceTotal,4);
assert.equal(range.analyzedTotal,3);
assert.equal(range.analysisPending,1);
assert.deepEqual(range.missingDates,['2026-08-18']);
assert.equal(range.byType.CE.total,3);
assert.equal(range.byType.CE.matched,2);
assert.equal(range.byType.SHOPEECN.total,1);

console.log('[V284] daily membership truth smoke passed · firstReportDate mismatch no longer blanks 08-17 · exact coverage gate + Shopee attempts preserved');
db.close();
