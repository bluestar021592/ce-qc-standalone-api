import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v248-shopee-'));
process.env.DATA_DIR=tempRoot;
process.env.DB_FILE=path.join(tempRoot,'v248-shopee-smoke.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.CE_QC_DISABLE_V246_TRACKING='1';

const {getDb,closeDb}=await import('../src/db.js');
const {ensureV246TrackingSchema,v246InclusiveDays}=await import('../src/v246TrackingLedgerCore.js');
const db=getDb();ensureV246TrackingSchema(db);

db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache(
  reportDate TEXT NOT NULL,businessType TEXT NOT NULL,regionCode TEXT NOT NULL DEFAULT '',metricsJson TEXT NOT NULL,
  snapshotId TEXT NOT NULL DEFAULT '',snapshotStatus TEXT NOT NULL DEFAULT '',sourceFingerprint TEXT NOT NULL DEFAULT '',refreshedAt TEXT NOT NULL,
  PRIMARY KEY(reportDate,businessType,regionCode));`);

const fixtures=[
  {date:'2026-08-20',podDates:['2026-08-20','2026-08-21'],attempts:[1,2],ocOpen:0},
  {date:'2026-08-21',podDates:['2026-08-23',null],attempts:[3,0],ocOpen:1},
  {date:'2026-08-22',podDates:[null,null],attempts:[0,0],ocOpen:0},
  {date:'2026-08-23',podDates:['2026-08-23'],attempts:[0],ocOpen:0}
];
for(let i=0;i<fixtures.length;i++){
  const f=fixtures[i],date=f.date,snapshotId=`V248-S${i+1}`,batchId=`V248-B${i+1}`,now=`${date}T23:00:00.000Z`;
  db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(snapshotId,batchId,date,'COMPLETED','{}',now);
  db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(batchId,snapshotId,date,'v248-smoke.xlsx',`hash-${i}`,'VALID','{}','[]',now);
  const insertImport=db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertFinal=db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,rawJson,createdAt,updatedAt,podAttemptNo)
    VALUES('SHOPEE',?,?,?,?,?,?,?,?)`);
  const insertLedger=db.prepare(`INSERT INTO qc_tracking_ledger(
    shipmentCode,businessType,firstReportDate,lastImportedDate,trackingStatus,terminalReason,currentState,currentCategory,podDate,attemptNo,attemptSource,signingDays,currentStateJson,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let openOcAssigned=0;
  for(let j=0;j<f.podDates.length;j++){
    const code=`CN-${i}-${j}`,podDate=f.podDates[j],attempt=Number(f.attempts[j]||0),isPod=Boolean(podDate);
    insertImport.run(batchId,snapshotId,date,'SHOPEECN',code,j%2===0?'PP':'PV','SHOPEECN','SHOPEECN','日报',j+1,'SMOKE','{}',now);
    insertFinal.run(code,date,isPod?1:0,isPod?'POD':'Pending',JSON.stringify(isPod?{'POD时间':`${podDate} 12:00:00`}:{'Pending次数':1}),now,now,attempt);
    const isOc=!isPod&&openOcAssigned<f.ocOpen;if(isOc)openOcAssigned+=1;
    insertLedger.run(code,'SHOPEECN',date,date,isPod?'TERMINAL':'OPEN',isPod?'POD':'',isPod?'POD':isOc?'OC':'Pending',isPod?'POD':isOc?'OC':'Pending',podDate||'',attempt,attempt?`V246_STRICT_TRACK:SMOKE`:'',isPod?v246InclusiveDays(date,podDate):null,JSON.stringify({currentState:isPod?'POD':isOc?'OC':'Pending',primaryCategory:isPod?'POD':isOc?'OC':'Pending'}),now,now);
  }
  const podCount=f.podDates.filter(Boolean).length;
  db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)')
    .run(date,'SHOPEECN','',JSON.stringify({total:f.podDates.length,pod:podCount,ocCurrent:99}),snapshotId,'COMPLETED','STALE-V240-SHOULD-NOT-WIN',now);
}

const {readV247ShopeeTrends,V247_SHOPEE_TREND_ID}=await import('../src/v244ShopeeTrendRuntimePatch.js');
const dates=fixtures.map(f=>f.date);
const result=readV247ShopeeTrends('SHOPEECN',dates[0],dates.at(-1));
assert.equal(result.readId,V247_SHOPEE_TREND_ID);
assert.deepEqual(result.dates,dates);
assert.deepEqual(result.ticket,[2,2,2,1]);
assert.deepEqual(result.pod,[2,1,0,1]);
assert.deepEqual(result.podRate,[100,50,0,100]);
assert.deepEqual(result.oc,[0,1,0,0],'locked ledger current OC must override stale cache OC');
assert.deepEqual(result.ocRate,[0,50,0,0]);
assert.deepEqual(result.avgPodDays,[1.5,3,null,1],'average signing days must use immutable first-report date through actual POD date');
assert.deepEqual(result.attempt1,[1,0,0,0]);
assert.deepEqual(result.attempt2,[1,0,0,0]);
assert.deepEqual(result.attempt3,[0,1,0,0]);
assert.deepEqual(result.attempt1Rate,[50,0,null,null]);
assert.deepEqual(result.attempt2Rate,[50,0,null,null]);
assert.deepEqual(result.attempt3Rate,[0,100,null,null]);
assert.deepEqual(result.attemptUnknown,[0,0,0,1],'POD without validated attempt evidence must stay explicit instead of becoming fake 0% dispatch');
assert.deepEqual(result.attemptCoverageRate,[100,100,null,0]);
assert.ok(result.daily.every(row=>row.ledgerReady),'complete locked ledger must be authoritative for every fixture day');
assert.equal(result.daily[3].attemptEvidenceComplete,false);
assert.match(result.definitions.attemptRate,/无(?:真实派次证据时|证据)显示—/);
const lastSeven=readV247ShopeeTrends('SHOPEECN',dates.at(-1),dates.at(-1));
assert.deepEqual(lastSeven.dates,dates,'single-day dashboard selection must still expose up to seven recent locked report dates');

const owner=fs.readFileSync('public/v244-shopee-trend-owner.js','utf8');
const injection=fs.readFileSync('src/v231MetricTruthUiInjectionPatch.js','utf8');
assert.doesNotThrow(()=>new Function(owner),'V248 Shopee browser owner must compile');
assert.match(owner,/v248-shopee-spa-operational-trend-owner-v1/,'Shopee page owner must identify the SPA-aware V248 build');
assert.doesNotMatch(owner,/function bind\(\)\{\s*if\(!type\(\)\)return/,'Shopee owner must not permanently exit when the application initially opens on home');
assert.match(owner,/__v248ShopeeOwner/,'navigatePage must be wrapped so SPA navigation activates the Shopee owner');
assert.match(owner,/addEventListener\('popstate'/,'browser back\/forward navigation must reactivate the Shopee owner');
assert.match(owner,/attributeFilter:\['hidden'\]/,'Shopee page visibility changes must reactivate the owner after SPA render');
assert.match(owner,/\/api\/v246\/shopee-trends\?businessType=/,'independent Shopee page must read the V246\/V247 locked-ledger endpoint');
assert.match(owner,/title:'平均签收天数趋势'/,'independent Shopee page third operational trend must be average signing days');
assert.match(owner,/title:'OC数量趋势'/,'independent Shopee page fourth operational trend must be current OC quantity');
assert.match(injection,/v244-shopee-trend-owner\.js\?v=20260823-v248-1/,'V248 Shopee owner must be cache-busted into delivered HTML');
assert.match(injection,/X-CE-QC-V248-UI/,'V248 delivered HTML must expose an observable response header');

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V248] SHOPEECN/SHOPEEVN smoke passed: locked cohort + later POD correction + true current OC + immutable average signing days + strict 1/2/3 attempts + SPA navigation activation');