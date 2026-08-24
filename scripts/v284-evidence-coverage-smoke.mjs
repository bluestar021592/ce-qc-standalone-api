import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
process.env.NODE_ENV='test';
const { ensureV246TrackingSchema }=await import('../src/v246TrackingLedgerCore.js');
const { readV284EvidenceCoverage }=await import('../src/v284MembershipEvidenceCoverage.js');

const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
CREATE TABLE unified_import_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,batchId TEXT,snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT,regionCode TEXT);
CREATE TABLE final_rows(shipmentCode TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT,category TEXT,rawJson TEXT,lastEventTime TEXT,pendingDays INTEGER,ocDays INTEGER,cycleCountDays INTEGER,shopState TEXT,shopRetentionNaturalDays INTEGER);
CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,currentMainCategory TEXT,primaryCategory TEXT,rawJson TEXT,latestEventTime TEXT,podAttemptNo INTEGER,currentAttemptNo INTEGER,shopState TEXT,shopRetentionNaturalDays INTEGER);
`);
ensureV246TrackingSchema(db);
const date='2026-08-17',now='2026-08-24T00:00:00Z';
db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)').run('B17','S17',date,'VALID',`${date}T08:00:00Z`);
const imp=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode) VALUES(?,?,?,?,?,?)');
imp.run('B17','S17',date,'CE','PROVEN-POD','PP');
imp.run('B17','S17',date,'CE','ADMITTED-ONLY','PV');
const ins=db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
ins.run('PROVEN-POD','CE','2026-08-10',date,'SOLD','S17','TERMINAL','POD',now,'POD','POD',now,date,0,'',8,'{}','{}',now,'SMOKE',now,now);
ins.run('ADMITTED-ONLY','CE',date,date,'S17','S17','OPEN','','','OPEN','OPEN','','',0,'',null,'{}','{}','','V252_STARTUP_90DAY_ADMISSION_AUDIT',now,now);

let coverage=readV284EvidenceCoverage(date,date,db);
let ce=coverage.byType.get(`${date}|CE`);
assert.equal(ce.total,2);
assert.equal(ce.proven,1,'empty OPEN admission ledger must not count as analyzed');
assert.equal(coverage.unproven.length,1);
assert.equal(coverage.unproven[0].shipmentCode,'ADMITTED-ONLY');

db.prepare("UPDATE qc_tracking_ledger SET currentState='Pending',currentCategory='Pending',lastCheckedAt=?,updatedAt=? WHERE shipmentCode='ADMITTED-ONLY'").run(now,now);
coverage=readV284EvidenceCoverage(date,date,db);ce=coverage.byType.get(`${date}|CE`);
assert.equal(ce.proven,2,'checked current-state evidence may promote admitted member to proven analysis');
assert.equal(coverage.unproven.length,0);

db.close();
console.log('[V284] evidence coverage smoke passed · admission-only OPEN stays unproven until checked/current/final evidence exists');
