import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v252-shopee-'));
process.env.DATA_DIR=tempRoot;
process.env.DB_FILE=path.join(tempRoot,'v252-shopee-smoke.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.CE_QC_DISABLE_V246_TRACKING='1';

const {getDb,closeDb}=await import('../src/db.js');
const {ensureV246TrackingSchema,v246InclusiveDays}=await import('../src/v246TrackingLedgerCore.js');
const {writeV329ThreeBusinessDailyCache}=await import('../src/v329ThreeBusinessDailyCache.js');
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
  const f=fixtures[i],date=f.date,snapshotId=`V252-S${i+1}`,batchId=`V252-B${i+1}`,now=`${date}T23:00:00.000Z`;
  db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(snapshotId,batchId,date,'COMPLETED','{}',now);
  db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(batchId,snapshotId,date,'v252-smoke.xlsx',`hash-${i}`,'VALID','{}','[]',now);
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

// The lifecycle ledger above intentionally still contains its historical firstReportDate-derived
// signingDays values. Visible Shopee averages must ignore those and use the compact strict START->POD cache.
writeV329ThreeBusinessDailyCache('SHOPEECN',[
  {reportDate:'2026-08-20',total:2,pod:2,ocCurrent:0,attempt1:1,attempt2:1,attempt3:0,signingDaysSum:3,signingDaysCount:2,ppSigningDaysSum:1,ppSigningDaysCount:1,pvSigningDaysSum:2,pvSigningDaysCount:1,ready:true},
  {reportDate:'2026-08-21',total:2,pod:1,ocCurrent:1,attempt1:0,attempt2:0,attempt3:1,signingDaysSum:2,signingDaysCount:1,ppSigningDaysSum:2,ppSigningDaysCount:1,pvSigningDaysSum:0,pvSigningDaysCount:0,ready:true},
  {reportDate:'2026-08-22',total:2,pod:0,ocCurrent:0,attempt1:0,attempt2:0,attempt3:0,signingDaysSum:0,signingDaysCount:0,ready:true},
  {reportDate:'2026-08-23',total:1,pod:1,ocCurrent:0,attempt1:0,attempt2:0,attempt3:0,signingDaysSum:1,signingDaysCount:1,ppSigningDaysSum:1,ppSigningDaysCount:1,pvSigningDaysSum:0,pvSigningDaysCount:0,ready:true}
],db,'V244_STRICT_START_POD_SMOKE');

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
assert.deepEqual(result.avgPodDays,[1.5,2,null,1],'average signing days must use real dispatch START through actual POD, not firstReportDate');
assert.deepEqual(result.attempt1,[1,0,0,0]);
assert.deepEqual(result.attempt2,[1,0,0,0]);
assert.deepEqual(result.attempt3,[0,1,0,0]);
assert.deepEqual(result.attempt1Rate,[50,0,null,null]);
assert.deepEqual(result.attempt2Rate,[50,0,null,null]);
assert.deepEqual(result.attempt3Rate,[0,100,null,null]);
assert.deepEqual(result.attemptUnknown,[0,0,0,1],'POD without validated attempt evidence must stay explicit instead of becoming fake 0% dispatch');
assert.deepEqual(result.attemptCoverageRate,[100,100,null,0]);
assert.deepEqual(result.signingCoverageRate,[100,100,null,100]);
assert.ok(result.daily.every(row=>row.ledgerReady),'complete locked ledger must be authoritative for every fixture day');
assert.equal(result.daily[3].attemptEvidenceComplete,false);
assert.equal(result.daily[1].signingTruth,'V329_REAL_START_TO_POD_CACHE');
assert.match(result.definitions.avgPodDays,/真实首次派送START日期到真实POD日期/);
assert.match(result.definitions.attemptRate,/无(?:真实派次证据时|证据)显示—/);
const lastSeven=readV247ShopeeTrends('SHOPEECN',dates.at(-1),dates.at(-1));
assert.deepEqual(lastSeven.dates,dates,'single-day dashboard selection must still expose up to seven recent locked report dates');
const fast=readV247ShopeeTrends('SHOPEECN',dates[0],dates.at(-1),{includeRegions:false});
assert.equal(fast.regionsIncluded,false,'independent Shopee dashboard must be able to skip expensive PP/PV joins');
assert.ok(fast.daily.every(row=>Object.keys(row.regions||{}).length===0),'regions=0 lifecycle reads must not calculate historical PP/PV truth');
const exact=readV247ShopeeTrends('SHOPEECN',dates.at(-1),dates.at(-1),{includeRegions:false,exact:true});
assert.deepEqual(exact.dates,[dates.at(-1)],'exact=1 must return only the requested date for lightweight current PP/PV or summary reads');
assert.equal(exact.avgPodDays[0],1);

const owner=fs.readFileSync('public/v244-shopee-trend-owner.js','utf8');
const finalOwner=fs.readFileSync('public/v250-shopee-metric-visibility.js','utf8');
const lifecycleUi=fs.readFileSync('public/v252-qc-lifecycle-ui.js','utf8');
const injection=fs.readFileSync('src/v231MetricTruthUiInjectionPatch.js','utf8');
assert.doesNotThrow(()=>new Function(owner),'V248 Shopee browser owner must compile');
assert.match(owner,/stability-shopee-readonly-trend-v1/,'Shopee page owner must identify the stability read-only build');
assert.doesNotMatch(owner,/function bind\(\)\{\s*if\(!type\(\)\)return/,'Shopee owner must not permanently exit when the application initially opens on home');
assert.match(owner,/__v248ShopeeOwner/,'navigatePage must be wrapped so SPA navigation activates the Shopee owner');
assert.match(owner,/addEventListener\('popstate'/,'browser back\/forward navigation must reactivate the Shopee owner');
assert.match(owner,/attributeFilter:\['hidden'\]/,'Shopee page visibility changes must reactivate the owner after SPA render');
assert.match(owner,/\/api\/v319\/trends\?businessType=/,'independent Shopee page must read the read-only V319 saved-cache endpoint');
assert.doesNotMatch(owner,/\/api\/v246\/shopee-trends\?businessType=/,'page navigation must never auto-launch the V246 evidence path');

assert.doesNotThrow(()=>new Function(finalOwner),'V251 final Shopee owner must compile as browser JavaScript');
assert.match(finalOwner,/v251-shopee-final-render-owner-v1/,'final Shopee owner must identify V251');
assert.match(finalOwner,/global\.renderShopeePage=wrapped/,'V251 must wrap canonical renderShopeePage so legacy rerenders cannot win');
assert.match(finalOwner,/global\.renderAll=wrapped/,'V251 must also wrap renderAll because background state refresh can rerender Shopee');
for(const label of ['票数趋势','POD数量趋势','平均签收天数趋势','OC数量趋势','签收天数覆盖','平均签收天数','1/2/3派签收占POD趋势','派次证据覆盖','派次未识别POD'])assert.ok(finalOwner.includes(label),`V251 final Shopee owner missing ${label}`);
assert.match(finalOwner,/首次真实70 START=1派/,'V251 UI must expose the strict first-attempt rule');
assert.match(finalOwner,/150 Pending\/派送失败后/,'V251 UI must explain that a new attempt requires failure evidence before a new START');
assert.match(finalOwner,/row\.podDaysCount/,'V251 daily table must expose signing-day evidence coverage');
assert.match(finalOwner,/row\.attemptCoverageRate/,'V251 attempt table must expose strict-attempt evidence coverage');

assert.doesNotThrow(()=>new Function(lifecycleUi),'V252 lifecycle UI must compile as browser JavaScript');
assert.match(lifecycleUi,/regions=0/,'V252 must force legacy Shopee trend reads onto lifecycle-only SQL');
assert.match(lifecycleUi,/regions:String\(regions\)/,'V252 must explicitly choose whether PP\/PV evidence is needed');
assert.match(lifecycleUi,/exact:exact\?'1':'0'/,'V252 exact-date region read must be explicit');
assert.match(lifecycleUi,/__CE_QC_V251_SHOPEE_FINAL_OWNER__/,'V252 independent pages must reuse the final V251 renderer instead of creating another competing page owner');
for(const label of ['SHOPEE 派次与签收摘要','派次证据覆盖','未识别POD','平均签收天数','签收天数覆盖','账本状态'])assert.ok(lifecycleUi.includes(label),`V252 compact home lifecycle summary missing ${label}`);
assert.doesNotMatch(lifecycleUi,/data-v247-attempt=|SHOPEE CN 1\/2\/3派签收占POD趋势/,'V252 home must not rebuild the two cramped side-by-side attempt charts');
assert.match(injection,/v252-qc-lifecycle-ui\.js\?v=20260823-v252-1/,'V252 lifecycle UI must be cache-busted into delivered HTML');
assert.match(injection,/X-CE-QC-V252-UI/,'V252 delivered HTML must expose an observable response header');
assert.ok(injection.indexOf('V252_LIFECYCLE_MARKER') < injection.indexOf('HOME_MARKER'),'V252 fetch policy must be defined before the legacy home owner marker');

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V252] SHOPEECN/SHOPEEVN smoke passed: fast lifecycle-only reads + strict START-to-POD signing days + strict attempts + compact home QC summary');
