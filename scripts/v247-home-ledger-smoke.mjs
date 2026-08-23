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
db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)')
  .run(d1,'SHOPEECN','',JSON.stringify({total:2,pod:0,ocCurrent:0}),b1.snapshotId,'COMPLETED','STALE-V240',b1.now);
insertLedger({code:'CN-A',date:d1,status:'TERMINAL',reason:'POD',state:'POD',category:'POD',podDate:d1,attempt:1,signingDays:1});
insertLedger({code:'CN-B',date:d1,status:'TERMINAL',reason:'POD',state:'POD',category:'POD',podDate:'2026-08-22',attempt:2,signingDays:3});
insertLedger({code:'CN-RECOVERED',date:d1,status:'OPEN',state:'OC',category:'OC'});

// A newer rejected re-upload deliberately flips CN-A from PP to PV. Region truth
// must ignore this batch and keep the latest VALID+COMPLETED evidence (PP).
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
const result=readV247ShopeeTrends('SHOPEECN',d1,d2);
assert.equal(result.readId,V247_SHOPEE_TREND_ID);
assert.deepEqual(result.dates,[d1,d2]);

const first=result.daily[0];
assert.equal(first.ledgerReady,true,'ledger recovered count >= stale cache count must make locked ledger authoritative');
assert.equal(first.total,3,'recovered historical member must restore original cohort total');
assert.equal(first.cacheTotal,2);
assert.equal(first.recoveredExtra,1);
assert.equal(first.pod,2,'later POD must update the original report-date cohort');
assert.equal(first.podRate,66.67);
assert.equal(first.oc,1,'still-open OC from the locked ledger must remain visible');
assert.equal(first.avgPodDays,2,'inclusive signing days must average locked 1-day and 3-day PODs');
assert.equal(first.attempt1,1);assert.equal(first.attempt2,1);assert.equal(first.attempt3,0);
assert.equal(first.attempt1Rate,50);assert.equal(first.attempt2Rate,50);assert.equal(first.attemptUnknown,0);
assert.equal(first.regions.PP.total,2,'invalid re-upload must not flip CN-A away from its valid PP evidence');
assert.equal(first.regions.PP.pod,1);assert.equal(first.regions.PP.attempt1Rate,100);
assert.equal(first.regions.PV.total,1);assert.equal(first.regions.PV.pod,1);assert.equal(first.regions.PV.attempt2Rate,100);

const second=result.daily[1];
assert.equal(second.ledgerReady,false,'partial ledger must not be presented as complete locked truth');
assert.equal(second.total,2,'while ledger is incomplete, preserve complete cached cohort total');
assert.equal(second.pod,1,'while ledger is incomplete, preserve complete cached POD count');
assert.equal(second.avgPodDays,null,'partial ledger must not publish a misleading average signing day');
assert.equal(second.attempt1,0);assert.equal(second.attempt1Rate,null,'partial ledger must not publish a misleading attempt rate');

const home=fs.readFileSync('public/v237-home-dashboard-owner.js','utf8');
const backend=fs.readFileSync('src/v244ShopeeTrendRuntimePatch.js','utf8');
const injection=fs.readFileSync('src/v231MetricTruthUiInjectionPatch.js','utf8');
assert.match(home,/\/api\/v246\/shopee-trends\?businessType=/,'home must request the V246/V247 locked Shopee truth endpoint');
assert.match(home,/businessType=SHOPEE/,'home must load the old aggregate Shopee contribution before replacing it with locked CN/VN truth');
assert.match(home,/correctedAllTrend/,'home ALL trend must replace stale Shopee contribution instead of displaying stale totals');
assert.match(home,/homeTruthPayload/,'home current cards must replace Shopee current totals/POD with locked ledger truth when ready');
assert.match(home,/setHomePodCards/,'home current POD/POD-rate cards must remain consistent with corrected business totals');
assert.match(home,/POD数量趋势/,'home trend must expose POD quantity instead of duplicate first-day assessment');
assert.match(home,/OC数量趋势/,'home trend must expose current OC quantity');
assert.match(home,/removeDuplicateHomeAssessment/,'home must remove duplicate first-day POD assessment cards');
assert.match(home,/regions\?\.PP/,'home dispatch distribution must use locked-ledger PP/PV region truth');
assert.doesNotMatch(home,/首日POD妥投率趋势/,'home must no longer render the duplicate first-day POD trend');
assert.match(backend,/INNER JOIN unified_import_batches b[\s\S]*b\.status='VALID'/,'PP/PV truth must only use VALID import batches');
assert.match(backend,/INNER JOIN unified_snapshots s[\s\S]*s\.status='COMPLETED'/,'PP/PV truth must only use COMPLETED snapshots');
assert.match(injection,/v237-home-dashboard-owner\.js\?v=20260823-v247-1/,'V247 home owner must be cache-busted');
assert.match(injection,/X-CE-QC-V247-UI/,'V247 UI response must expose an observable header');

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V247] home Shopee locked-ledger smoke passed: recovered missing member + historical POD correction + locked signing days + strict attempts + VALID/COMPLETED PP-PV truth + partial-ledger guard + corrected home totals/POD/trends + cache-busted owner');
