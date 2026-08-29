import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v247-home-'));
process.env.DATA_DIR=tempRoot;
process.env.DB_FILE=path.join(tempRoot,'v247-home-smoke.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.CE_QC_DISABLE_V246_TRACKING='1';

const {getDb,closeDb}=await import('../src/db.js');
const {ensureV246TrackingSchema}=await import('../src/v246TrackingLedgerCore.js');
const {writeV329ThreeBusinessDailyCache}=await import('../src/v329ThreeBusinessDailyCache.js');
const db=getDb();ensureV246TrackingSchema(db);
db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache(
  reportDate TEXT NOT NULL,businessType TEXT NOT NULL,regionCode TEXT NOT NULL DEFAULT '',metricsJson TEXT NOT NULL,
  snapshotId TEXT NOT NULL DEFAULT '',snapshotStatus TEXT NOT NULL DEFAULT '',sourceFingerprint TEXT NOT NULL DEFAULT '',refreshedAt TEXT NOT NULL,
  PRIMARY KEY(reportDate,businessType,regionCode));`);

function seedBatch(date,index,codes){
  const snapshotId=`V247-S${index}`,batchId=`V247-B${index}`,now=`${date}T23:00:00.000Z`;
  db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(snapshotId,batchId,date,'COMPLETED','{}',now);
  db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(batchId,snapshotId,date,'v247-home-smoke.xlsx',`hash-${index}`,'VALID','{}','[]',now);
  const insert=db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  codes.forEach((row,i)=>insert.run(batchId,snapshotId,date,'SHOPEECN',row.code,row.region,'SHOPEECN','SHOPEECN','日报',i+1,'SMOKE','{}',now));
  return{snapshotId,now};
}
function insertLedger({code,date,status='OPEN',reason='',state='OPEN',category='OPEN',podDate='',attempt=0,signingDays=null}){
  const now=`${date}T23:30:00.000Z`;
  db.prepare(`INSERT INTO qc_tracking_ledger(
    shipmentCode,businessType,firstReportDate,lastImportedDate,trackingStatus,terminalReason,currentState,currentCategory,podDate,attemptNo,attemptSource,signingDays,currentStateJson,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code,'SHOPEECN',date,date,status,reason,state,category,podDate,attempt,attempt?`V246_STRICT_TRACK:SMOKE`:'',signingDays,JSON.stringify({currentState:state,primaryCategory:category}),now,now);
}

const d1='2026-08-20';const b1=seedBatch(d1,1,[{code:'CN-A',region:'PP'},{code:'CN-B',region:'PV'},{code:'CN-RECOVERED',region:'PP'}]);
// Deliberately stale cache claims only 2; V284 must ignore it for source membership.
db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)')
  .run(d1,'SHOPEECN','',JSON.stringify({total:2,pod:0,ocCurrent:0}),b1.snapshotId,'COMPLETED','STALE-V240',b1.now);
// Legacy ledger signingDays are deliberately present for compatibility, but the visible
// average must come only from the V329 real first-dispatch START -> real POD cache.
insertLedger({code:'CN-A',date:d1,status:'TERMINAL',reason:'POD',state:'POD',category:'POD',podDate:d1,attempt:1,signingDays:9});
insertLedger({code:'CN-B',date:d1,status:'TERMINAL',reason:'POD',state:'POD',category:'POD',podDate:'2026-08-22',attempt:2,signingDays:9});
insertLedger({code:'CN-RECOVERED',date:d1,status:'OPEN',state:'OC',category:'OC'});
writeV329ThreeBusinessDailyCache('SHOPEECN',[
  {reportDate:d1,total:3,pod:2,ocCurrent:1,attempt1:1,attempt2:1,attempt3:0,signingDaysSum:4,signingDaysCount:2,ppSigningDaysSum:1,ppSigningDaysCount:1,pvSigningDaysSum:3,pvSigningDaysCount:1,ready:true}
],db,'V247_REAL_START_TO_POD_SMOKE');

// A newer rejected re-upload deliberately flips CN-A from PP to PV. Region truth
// must ignore this batch and keep the latest VALID source membership (PP).
const invalidSnapshot='V247-INVALID-S1',invalidBatch='V247-INVALID-B1',invalidNow='2026-08-20T23:59:59.000Z';
db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(invalidSnapshot,invalidBatch,d1,'COMPLETED','{}',invalidNow);
db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(invalidBatch,invalidSnapshot,d1,'rejected-reupload.xlsx','invalid-hash','INVALID','{}','[]',invalidNow);
db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(invalidBatch,invalidSnapshot,d1,'SHOPEECN','CN-A','PV','SHOPEECN','SHOPEECN','日报',1,'INVALID_SMOKE','{}',invalidNow);

const d2='2026-08-21';const b2=seedBatch(d2,2,[{code:'CN-PARTIAL-1',region:'PP'},{code:'CN-PARTIAL-2',region:'PV'}]);
db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)')
  .run(d2,'SHOPEECN','',JSON.stringify({total:2,pod:1,ocCurrent:1}),b2.snapshotId,'COMPLETED','STALE-V240',b2.now);
insertLedger({code:'CN-PARTIAL-1',date:d2,status:'TERMINAL',reason:'POD',state:'POD',category:'POD',podDate:d2,attempt:1,signingDays:1});

const {readV247ShopeeTrends,V247_SHOPEE_TREND_ID}=await import('../src/v244ShopeeTrendRuntimePatch.js');
const dates=[d1,d2];
const result=readV247ShopeeTrends('SHOPEECN',d1,d2);
assert.equal(result.readId,V247_SHOPEE_TREND_ID);
assert.deepEqual(result.dates,dates);

const first=result.daily[0];
assert.equal(first.ledgerReady,true,'all three exact daily members have lifecycle truth');
assert.equal(first.total,3,'latest VALID daily membership must beat stale cache total=2');
assert.equal(first.cacheTotal,3,'compat cacheTotal now describes the authoritative daily source total, not stale dashboard cache');
assert.equal(first.recoveredExtra,0,'V284 no longer invents source membership from ledger firstReportDate');
assert.equal(first.pod,2,'later POD must update the exact original daily member wherever it appears in lifecycle truth');
assert.equal(first.podRate,66.67);
assert.equal(first.oc,1,'still-open OC from the locked ledger must remain visible');
assert.equal(first.avgPodDays,2,'strict START-to-POD samples must average real 1-day and 3-day PODs instead of legacy ledger signingDays');
assert.equal(first.attempt1,1);assert.equal(first.attempt2,1);assert.equal(first.attempt3,0);
assert.equal(first.attempt1Rate,50);assert.equal(first.attempt2Rate,50);assert.equal(first.attemptUnknown,0);
assert.equal(first.regions.PP.total,2,'invalid re-upload must not flip CN-A away from its valid PP evidence');
assert.equal(first.regions.PP.pod,1);assert.equal(first.regions.PP.attempt1Rate,100);
assert.equal(first.regions.PV.total,1);assert.equal(first.regions.PV.pod,1);assert.equal(first.regions.PV.attempt2Rate,100);

const second=result.daily[1];
assert.equal(second.ledgerReady,false,'one matched row out of two daily members must remain incomplete');
assert.equal(second.total,2,'exact daily membership remains the denominator even while lifecycle coverage is incomplete');
assert.equal(second.pod,1,'known POD count may remain visible together with explicit coverage diagnostics');
assert.equal(second.avgPodDays,null,'partial coverage must not publish a misleading average signing day');
assert.equal(second.attempt1,0);assert.equal(second.attempt1Rate,null,'partial coverage must not publish a misleading attempt rate');
assert.equal(second.attemptCoverageRate,null,'partial coverage must not publish a misleading attempt evidence percentage');

const home=fs.readFileSync('public/v237-home-dashboard-owner.js','utf8');
const backend=fs.readFileSync('src/v244ShopeeTrendRuntimePatch.js','utf8');
const v284=fs.readFileSync('src/v284DailyMembershipTruth.js','utf8');
const injection=fs.readFileSync('src/v231MetricTruthUiInjectionPatch.js','utf8');
assert.match(home,/\/api\/v246\/shopee-trends\?businessType=/,'home must request the V246-compatible Shopee truth endpoint');
assert.match(home,/businessType=SHOPEE/,'home must load the old aggregate Shopee contribution before replacing it with locked CN/VN truth');
assert.match(home,/correctedAllTrend/,'home ALL trend must replace stale Shopee contribution instead of displaying stale totals');
assert.match(home,/homeTruthPayload/,'home current cards must replace Shopee current totals/POD with locked ledger truth when ready');
assert.match(home,/setHomePodCards/,'home current POD/POD-rate cards must remain consistent with corrected business totals');
assert.match(home,/POD数量趋势/,'home trend must expose POD quantity instead of duplicate first-day assessment');
assert.match(home,/OC数量趋势/,'home trend must expose current OC quantity');
assert.match(home,/removeDuplicateHomeAssessment/,'home must remove duplicate first-day POD assessment cards');
assert.match(home,/regions\?\.PP/,'home dispatch distribution must use daily-member PP/PV truth');
assert.doesNotMatch(home,/首日POD妥投率趋势/,'home must no longer render the duplicate first-day POD trend');
assert.match(backend,/readV284ShopeeTrends/,'compat endpoint must use V284 truth');
assert.match(v284,/FROM unified_import_batches b[\s\S]*b\.status='VALID'/,'PP/PV source membership must only use VALID import batches');
assert.match(v284,/LEFT JOIN qc_tracking_ledger l ON l\.shipmentCode=v\.shipmentCode AND l\.businessType=v\.businessType/,'region/status truth must join exact daily members to V246 ledger');
assert.doesNotMatch(v284,/GROUP BY\s+l\.firstReportDate/i,'region truth must not regroup daily members by firstReportDate');
assert.match(injection,/v237-home-dashboard-owner\.js\?v=20260823-v247-1/,'V247 home owner must be cache-busted');
assert.match(injection,/X-CE-QC-V247-UI/,'V247 UI response must expose an observable header');

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V284/V247/V329] home Shopee smoke passed: latest-VALID daily membership + later POD/current OC + strict START-to-POD signing samples + strict attempts + VALID PP-PV truth + incomplete-coverage masking + corrected home totals/trends');
