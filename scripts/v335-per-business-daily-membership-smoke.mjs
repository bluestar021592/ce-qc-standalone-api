import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v236DashboardCurrentRead.js','src/v284DailyMembershipTruth.js','src/v320HistoricalDailyTruth.js','src/v308DeliveryDailyFastPath.js','src/v253DashboardFastPath.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const v320Source=fs.readFileSync('src/v320HistoricalDailyTruth.js','utf8');
assert.match(v320Source,/PARTITION BY reportDate,businessType ORDER BY createdAt DESC,batchId DESC/,'V320 historical membership must rank latest VALID snapshots independently per date+business');
assert.doesNotMatch(v320Source,/PARTITION BY reportDate ORDER BY createdAt DESC,batchId DESC/,'V320 must never fall back to one global same-date snapshot');

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v335-membership-'));
process.env.DATA_DIR=tempRoot;process.env.DB_FILE=path.join(tempRoot,'membership.db');process.env.ACCESS_MODE='LOCAL';process.env.SQLITE_MMAP_BYTES='0';process.env.SQLITE_CACHE_KIB='8192';process.env.NODE_ENV='test';process.env.CE_QC_DISABLE_V246_TRACKING='1';
const {getDb,closeDb}=await import('../src/db.js');
const {readV236CurrentSummary}=await import('../src/v236DashboardCurrentRead.js');
const {readV284DailyFacts,V284_DAILY_MEMBERSHIP_TRUTH_ID}=await import('../src/v284DailyMembershipTruth.js');
const {readV320HistoricalDaily,V320_HISTORICAL_DAILY_TRUTH_ID}=await import('../src/v320HistoricalDailyTruth.js');
const db=getDb();
db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache (
 reportDate TEXT NOT NULL,businessType TEXT NOT NULL,regionCode TEXT NOT NULL DEFAULT '',metricsJson TEXT NOT NULL,
 snapshotId TEXT NOT NULL DEFAULT '',snapshotStatus TEXT NOT NULL DEFAULT '',sourceFingerprint TEXT NOT NULL DEFAULT '',refreshedAt TEXT NOT NULL,
 PRIMARY KEY(reportDate,businessType,regionCode)
)`);
const snap=db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)');
const batch=db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)');
const member=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
const cache=db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)');
function seed(type,id,count,pod,createdAt){const date='2026-08-07',s=`S-${id}`,b=`B-${id}`;snap.run(s,b,date,'COMPLETED','{}',createdAt);batch.run(b,s,date,`${type}.xls`,id,'VALID','{}','[]',createdAt);for(let i=1;i<=count;i++)member.run(b,s,date,type,`${type}-${i}`,'PP',type,type,'日报',i,'TEST','{}',createdAt);cache.run(date,type,'PP',JSON.stringify({total:count,pod,returned:0,cancelled:0,sameDayPod:0,ocCurrent:0,pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,deliveryStay:0,provinceOpen:0,attempt1:0,attempt2:0,attempt3:0}),s,'COMPLETED','test',createdAt);}
// Reproduce the production ordering: VN is imported first, CEAF next, CN last on the same report date.
seed('SHOPEEVN','VN',3,2,'2026-08-07T20:00:00Z');
seed('CEAF','CEAF',1,0,'2026-08-07T21:00:00Z');
seed('SHOPEECN','CN',2,1,'2026-08-07T23:00:00Z');

const current=readV236CurrentSummary('2026-08-07',{cacheOnly:true});
assert.equal(current.business.SHOPEECN.total,2,'CN current card must use the latest VALID CN-containing snapshot');
assert.equal(current.business.SHOPEEVN.total,3,'later CN import must not zero the same-date VN current card');
assert.equal(current.business.CEAF.total,1,'later unrelated imports must not zero same-date CEAF');
assert.notEqual(current.snapshotIds.SHOPEECN,current.snapshotIds.SHOPEEVN,'CN and VN are allowed to have different same-date source snapshots');

const daily=readV284DailyFacts('2026-08-07','2026-08-07',db);
const byType=Object.fromEntries(daily.map(row=>[row.businessType,row]));
assert.equal(byType.SHOPEECN?.total,2,'V284 canonical membership must preserve CN from its own latest VALID snapshot');
assert.equal(byType.SHOPEEVN?.total,3,'V284 canonical membership must preserve VN from its own latest VALID snapshot');
assert.equal(byType.CEAF?.total,1,'V284 canonical membership must preserve CEAF from its own latest VALID snapshot');
assert.match(V284_DAILY_MEMBERSHIP_TRUTH_ID,/v335-per-business-latest-valid-membership/);

// V334 generic history worker reads V320. This assertion prevents the historical cache worker from reintroducing the old global-latest-batch bug.
for(const [type,total] of [['SHOPEECN',2],['SHOPEEVN',3],['CEAF',1]]){
  const history=readV320HistoricalDaily(type,'2026-08-07','2026-08-07',{db,expandSingle:false});
  assert.deepEqual(history.dates,['2026-08-07']);
  assert.equal(history.ticket[0],total,`V320 historical membership must preserve ${type} from its own same-date latest VALID snapshot`);
}
assert.match(V320_HISTORICAL_DAILY_TRUTH_ID,/v335-per-business-latest-valid-history/);

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V335] per-business same-date membership runtime smoke passed · later CN cannot zero VN/CEAF · V236 current + V284 canonical + V320 history all select independent latest VALID snapshots');