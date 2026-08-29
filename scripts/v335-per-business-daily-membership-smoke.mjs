import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v236DashboardCurrentRead.js','src/v284DailyMembershipTruth.js','src/v320HistoricalDailyTruth.js','src/v308DeliveryDailyFastPath.js','src/v253DashboardFastPath.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const v320Source=fs.readFileSync('src/v320HistoricalDailyTruth.js','utf8');
const v308Source=fs.readFileSync('src/v308DeliveryDailyFastPath.js','utf8');
assert.match(v320Source,/PARTITION BY reportDate,businessType ORDER BY createdAt DESC,batchId DESC/,'V320 historical membership must rank latest VALID snapshots independently per date+business');
assert.doesNotMatch(v320Source,/PARTITION BY reportDate ORDER BY createdAt DESC,batchId DESC/,'V320 must never fall back to one global same-date snapshot');
assert.match(v308Source,/readV236CurrentSummary\(date\)/,'V308 single-day cards must allow per-business normalized fallback when exact cache ownership is missing');
assert.doesNotMatch(v308Source,/readV236CurrentSummary\(date,\{cacheOnly:true\}\)/,'V308 must not turn a stale foreign-snapshot cache miss into zero metrics');
assert.match(v308Source,/json_extract\(evidenceJson,'\$\.starts\[0\]\.time'\)/,'V308 current signing must use strict START evidence, not firstReportDate');

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v335-membership-'));
process.env.DATA_DIR=tempRoot;process.env.DB_FILE=path.join(tempRoot,'membership.db');process.env.ACCESS_MODE='LOCAL';process.env.SQLITE_MMAP_BYTES='0';process.env.SQLITE_CACHE_KIB='8192';process.env.NODE_ENV='test';process.env.CE_QC_DISABLE_V246_TRACKING='1';
const {getDb,closeDb}=await import('../src/db.js');
const {readV236CurrentSummary}=await import('../src/v236DashboardCurrentRead.js');
const {readV284DailyFacts,V284_DAILY_MEMBERSHIP_TRUTH_ID}=await import('../src/v284DailyMembershipTruth.js');
const {readV320HistoricalDaily,V320_HISTORICAL_DAILY_TRUTH_ID}=await import('../src/v320HistoricalDailyTruth.js');
const {readV308DeliveryDaily}=await import('../src/v308DeliveryDailyFastPath.js');
const {ensureV246TrackingSchema}=await import('../src/v246TrackingLedgerCore.js');
const db=getDb();ensureV246TrackingSchema(db);
db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache (reportDate TEXT NOT NULL,businessType TEXT NOT NULL,regionCode TEXT NOT NULL DEFAULT '',metricsJson TEXT NOT NULL,snapshotId TEXT NOT NULL DEFAULT '',snapshotStatus TEXT NOT NULL DEFAULT '',sourceFingerprint TEXT NOT NULL DEFAULT '',refreshedAt TEXT NOT NULL,PRIMARY KEY(reportDate,businessType,regionCode))`);
const snap=db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)');
const batch=db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)');
const member=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
const cache=db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)');
const shopeeFact=db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,recipient_group,rawJson,latestEventTime,createdAt,updatedAt,podAttemptNo) VALUES('SHOPEE',?,?,?,?,?,?,?,?,?,?)`);
const ccslFact=db.prepare(`INSERT INTO final_rows(shipmentCode,reportDate,isPod,primaryCategory,category,ocDays,rawJson,lastEventTime,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)`);
const ledger=db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
function seed(type,id,count,pod,createdAt){
  const date='2026-08-07',s=`S-${id}`,b=`B-${id}`;snap.run(s,b,date,'COMPLETED','{}',createdAt);batch.run(b,s,date,`${type}.xls`,id,'VALID','{}','[]',createdAt);
  for(let i=1;i<=count;i++){
    const bill=`${type}-${i}`,isPod=i<=pod?1:0,region=(type==='SHOPEEVN'&&i===2)?'PV':'PP';member.run(b,s,date,type,bill,region,type,type,'日报',i,'TEST','{}',createdAt);
    if(type==='SHOPEECN'||type==='SHOPEEVN'){
      const group=type==='SHOPEECN'?'CN':'VN',podTime=isPod?'2026-08-07 18:00:00':'';shopeeFact.run(bill,date,isPod,isPod?'POD':'Pending',group,JSON.stringify({POD时间:podTime,当前状态:isPod?'POD':'Pending',podAttemptNo:isPod?1:0}),podTime||'2026-08-07 19:00:00',createdAt,createdAt,isPod?1:0);
      if(isPod){const firstReportDate=region==='PV'?'2026-08-05':'2026-08-07',startAt=region==='PV'?'2026-08-06 09:00:00':'2026-08-07 09:00:00',signingDays=region==='PV'?2:1;ledger.run(bill,type,firstReportDate,date,'TERMINAL','POD',podTime,'POD','POD',podTime,date,1,'V246_STRICT_TRACK_TEST',signingDays,JSON.stringify({starts:[{time:startAt,code:'70'}]}),createdAt,createdAt);}
    }else ccslFact.run(bill,date,isPod,isPod?'POD':'Pending',isPod?'POD':'Pending',0,JSON.stringify({POD时间:isPod?'2026-08-07 18:00:00':''}),isPod?'2026-08-07 18:00:00':'2026-08-07 19:00:00',createdAt,createdAt);
  }
  cache.run(date,type,'PP',JSON.stringify({total:count,pod,returned:0,cancelled:0,sameDayPod:pod,ocCurrent:0,pending1:Math.max(0,count-pod),pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,deliveryStay:0,provinceOpen:0,attempt1:pod,attempt2:0,attempt3:0}),s,'COMPLETED','test',createdAt);
}
seed('SHOPEEVN','VN',3,2,'2026-08-07T20:00:00Z');seed('CEAF','CEAF',1,0,'2026-08-07T21:00:00Z');seed('SHOPEECN','CN',2,1,'2026-08-07T23:00:00Z');
db.prepare("DELETE FROM dashboard_daily_cache WHERE businessType='SHOPEEVN'").run();cache.run('2026-08-07','SHOPEEVN','PP',JSON.stringify({total:0,pod:0,returned:0,cancelled:0,sameDayPod:0,ocCurrent:0,pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,deliveryStay:0,provinceOpen:0,attempt1:0,attempt2:0,attempt3:0}),'S-CN','COMPLETED','legacy-global-snapshot','2026-08-07T23:00:00Z');
const cacheOnly=readV236CurrentSummary('2026-08-07',{cacheOnly:true});assert.equal(cacheOnly.business.SHOPEEVN.total,3);assert.equal(cacheOnly.business.SHOPEEVN.ready,false);const current=readV236CurrentSummary('2026-08-07');assert.equal(current.business.SHOPEECN.total,2);assert.equal(current.business.SHOPEEVN.total,3);assert.equal(current.business.SHOPEEVN.pod,2);assert.equal(current.business.SHOPEEVN.ready,true);assert.equal(current.business.CEAF.total,1);assert.notEqual(current.snapshotIds.SHOPEECN,current.snapshotIds.SHOPEEVN);
const v308=readV308DeliveryDaily('SHOPEEVN','2026-08-07','2026-08-07',db);assert.equal(v308.daily[0].total,3);assert.equal(v308.daily[0].pod,2);assert.equal(v308.daily[0].regions.PP.total,2);assert.equal(v308.daily[0].regions.PV.total,1);assert.equal(v308.daily[0].ppSigningSampleCount,1);assert.equal(v308.daily[0].pvSigningSampleCount,1);assert.equal(v308.daily[0].ppAvgSigningDays,1,'PP average must use strict START 08-07 -> POD 08-07');assert.equal(v308.daily[0].pvAvgSigningDays,2,'PV average must use strict START 08-06 -> POD 08-07, regardless of older first report date');
const daily=readV284DailyFacts('2026-08-07','2026-08-07',db),byType=Object.fromEntries(daily.map(row=>[row.businessType,row]));assert.equal(byType.SHOPEECN?.total,2);assert.equal(byType.SHOPEEVN?.total,3);assert.equal(byType.CEAF?.total,1);assert.match(V284_DAILY_MEMBERSHIP_TRUTH_ID,/v335-per-business-latest-valid-membership/);
for(const [type,total] of [['SHOPEECN',2],['SHOPEEVN',3],['CEAF',1]]){const history=readV320HistoricalDaily(type,'2026-08-07','2026-08-07',{db,expandSingle:false});assert.deepEqual(history.dates,['2026-08-07']);assert.equal(history.ticket[0],total);}assert.match(V320_HISTORICAL_DAILY_TRUTH_ID,/v335-per-business-latest-valid-history/);
closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});execFileSync(process.execPath,['scripts/v336-launcher-safe-update-smoke.cjs'],{stdio:'inherit'});console.log('[V335/V336] per-business same-date membership runtime smoke passed · later CN cannot zero VN/CEAF · foreign CN-stamped VN zero cache rejected · V308 PP/PV averages use strict START-to-POD samples · V236 current + V284 canonical + V320 history isolate latest VALID snapshots · V336 launcher safety gate chained');