import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
process.env.NODE_ENV='test';
const { ensureV246TrackingSchema }=await import('../src/v246TrackingLedgerCore.js');
const { invalidateV284DailyMembershipTruth }=await import('../src/v284DailyMembershipTruth.js');
const { readV284EvidenceCoverage,readV284ProvenDashboardTrends,summarizeV284ProvenRange }=await import('../src/v284MembershipEvidenceCoverage.js');

// This smoke is imported after other V284 smokes inside the same go-live Node
// process. Those smokes use different in-memory SQLite handles but may reuse the
// same report date. Production uses one persistent DB; test fixtures must never
// inherit another fixture's 30-second hot membership cache.
invalidateV284DailyMembershipTruth();

const evidenceSource=fs.readFileSync(new URL('../src/v284MembershipEvidenceCoverage.js',import.meta.url),'utf8');
assert.match(evidenceSource,/PARTITION BY reportDate,businessType ORDER BY createdAt DESC,batchId DESC/,'evidence coverage must select latest VALID independently per date+business');
const whppUnionStart=evidenceSource.indexOf("SELECT DISTINCT p.reportDate,'WHPP' businessType");
const whppUnionEnd=evidenceSource.indexOf('SELECT v.reportDate,v.businessType',whppUnionStart);
assert.ok(whppUnionStart>=0&&whppUnionEnd>whppUnionStart,'WHPP evidence membership union must exist');
const whppUnion=evidenceSource.slice(whppUnionStart,whppUnionEnd);
assert.doesNotMatch(whppUnion,/CEAF|NOT EXISTS/,'WHPP evidence membership must never subtract CEAF overlap');
assert.match(evidenceSource,/WHPP keeps its full dedicated daily membership without CEAF subtraction/,'runtime authority must state independent WHPP membership');

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
CREATE TABLE unified_import_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,batchId TEXT,snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT,regionCode TEXT);
CREATE TABLE final_rows(shipmentCode TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT,category TEXT,rawJson TEXT,lastEventTime TEXT,pendingDays INTEGER,ocDays INTEGER,cycleCountDays INTEGER,shopState TEXT,shopRetentionNaturalDays INTEGER);
CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,currentMainCategory TEXT,primaryCategory TEXT,rawJson TEXT,latestEventTime TEXT,podAttemptNo INTEGER,currentAttemptNo INTEGER,shopState TEXT,shopRetentionNaturalDays INTEGER);
CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT,totalCount INTEGER);
CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT);
`);
ensureV246TrackingSchema(db);
const date='2026-08-17',now='2026-08-24T00:00:00Z';
const batch=db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)');
batch.run('B17','S17',date,'VALID',`${date}T08:00:00Z`);
batch.run('B17-CEAF','S17-CEAF',date,'VALID',`${date}T09:00:00Z`);
const imp=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode) VALUES(?,?,?,?,?,?)');
imp.run('B17','S17',date,'CE','PROVEN-POD','PP');
imp.run('B17','S17',date,'CE','ADMITTED-ONLY','PV');
// Later same-day sibling import must not erase CE. Its shipment intentionally
// overlaps WHPP to prove overlap is diagnostic-only, never subtraction.
imp.run('B17-CEAF','S17-CEAF',date,'CEAF','WHPP-PROVEN','PP');
db.prepare('INSERT INTO business_daily_reports VALUES(?,?,?)').run('WHPP',date,1);
db.prepare('INSERT INTO business_daily_parse_rows VALUES(?,?,?)').run('WHPP',date,'WHPP-PROVEN');
db.prepare(`INSERT INTO final_rows(shipmentCode,reportDate,isPod,primaryCategory,category,rawJson,lastEventTime,pendingDays,ocDays,cycleCountDays,shopState,shopRetentionNaturalDays) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('WHPP-PROVEN',date,0,'OPEN','OPEN','{}',now,0,0,0,'',0);
db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,currentMainCategory,primaryCategory,rawJson,latestEventTime,podAttemptNo,currentAttemptNo,shopState,shopRetentionNaturalDays) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('WHPP','WHPP-PROVEN',date,1,'POD','POD',JSON.stringify({'POD时间':`${date} 12:00:00`}),`${date} 12:00:00`,0,0,'',0);
const ins=db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
ins.run('PROVEN-POD','CE','2026-08-10',date,'SOLD','S17','TERMINAL','POD',now,'POD','POD',now,date,0,'',8,'{}','{}',now,'SMOKE',now,now);
ins.run('ADMITTED-ONLY','CE',date,date,'S17','S17','OPEN','','','OPEN','OPEN','','',0,'',null,'{}','{}','','V252_STARTUP_90DAY_ADMISSION_AUDIT',now,now);

let coverage=readV284EvidenceCoverage(date,date,db);
let ce=coverage.byType.get(`${date}|CE|ALL`);
let ceaf=coverage.byType.get(`${date}|CEAF|ALL`);
const whpp=coverage.byType.get(`${date}|WHPP|ALL`);
assert.ok(ce,'CE daily evidence coverage aggregate must exist under the canonical date|business|ALL key');
assert.equal(ce.total,2,'later same-day CEAF import must not erase CE membership');
assert.equal(ce.proven,1,'empty OPEN admission ledger must not count as analyzed');
assert.ok(ceaf,'later CEAF sibling must retain its own independent membership');
assert.equal(ceaf.total,1);
assert.equal(ceaf.proven,1,'CEAF final-row evidence proves its own overlapping member without consuming WHPP');
assert.ok(whpp,'WHPP must be included in seven-business proven coverage');
assert.equal(whpp.total,1,'WHPP overlap with CEAF must remain a full independent WHPP member');
assert.equal(whpp.proven,1,'WHPP final-row evidence must prove the daily WHPP member');
assert.equal(coverage.unproven.length,1);
assert.equal(coverage.unproven[0].shipmentCode,'ADMITTED-ONLY');
let trend=readV284ProvenDashboardTrends('CE',date,date,db);
assert.equal(trend.daily[0].total,2,'CE visible trend must survive the later CEAF sibling import');
assert.equal(trend.daily[0].ready,false,'proven daily truth must stay incomplete while one member is admission-only OPEN');
assert.equal(trend.daily[0].ledgerReady,false,'legacy ledgerReady alias must follow proven readiness, not raw admission presence');
const whppTrend=readV284ProvenDashboardTrends('WHPP',date,date,db);
assert.equal(whppTrend.daily[0].total,1);
assert.equal(whppTrend.daily[0].matched,1);
assert.equal(whppTrend.daily[0].podRate,100);
assert.equal(whppTrend.daily[0].ready,true,'WHPP visible trend must no longer be forced to 0% coverage');

db.prepare("UPDATE qc_tracking_ledger SET currentState='Pending',currentCategory='Pending',lastCheckedAt=?,updatedAt=? WHERE shipmentCode='ADMITTED-ONLY'").run(now,now);
invalidateV284DailyMembershipTruth();
coverage=readV284EvidenceCoverage(date,date,db);ce=coverage.byType.get(`${date}|CE|ALL`);ceaf=coverage.byType.get(`${date}|CEAF|ALL`);
assert.ok(ce,'CE daily evidence coverage aggregate must remain addressable after evidence refresh');
assert.equal(ce.proven,2,'checked current-state evidence may promote admitted member to proven analysis');
assert.equal(ceaf.proven,1);
assert.equal(coverage.unproven.length,0);
trend=readV284ProvenDashboardTrends('CE',date,date,db);
assert.equal(trend.daily[0].ready,true,'checked state must promote the daily cohort to proven ready');
assert.equal(trend.daily[0].ledgerReady,true,'legacy ledgerReady alias must promote together with proven readiness');
const all=readV284ProvenDashboardTrends('ALL',date,date,db);
assert.equal(all.daily[0].total,4,'ALL visible trend must include CE2 + CEAF1 + WHPP1 independent physical daily membership');
assert.equal(all.daily[0].matched,4,'ALL proven coverage must include the independent WHPP member instead of subtracting overlap');
assert.equal(all.daily[0].ready,true);
const range=summarizeV284ProvenRange(date,date,db);
assert.equal(range.sourceTotal,4,'seven-business range source total must preserve CEAF+WHPP overlap as two independent business memberships');
assert.equal(range.analyzedTotal,4);
assert.equal(range.analysisPending,0);
assert.equal(range.analysisComplete,true);
assert.deepEqual(range.missingDates,[]);

invalidateV284DailyMembershipTruth();
db.close();
console.log('[V286] seven-business evidence coverage smoke passed · per-business latest VALID isolation + later CEAF cannot erase CE + CEAF/WHPP overlap remains two independent members + WHPP proven final evidence + ready synchronization');
