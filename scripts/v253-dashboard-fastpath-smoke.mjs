import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v253-fast-'));
process.env.DATA_DIR=tempRoot;
process.env.DB_FILE=path.join(tempRoot,'v253-fast.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.CE_QC_DISABLE_V246_TRACKING='1';
process.env.NODE_ENV='test';

const runtimeSource=fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js','utf8');
const injectSource=fs.readFileSync('src/v231MetricTruthUiInjectionPatch.js','utf8');
const fastSource=fs.readFileSync('src/v253DashboardFastPath.js','utf8');
const uiSource=fs.readFileSync('public/v253-dashboard-fast-owner.js','utf8');
assert.match(runtimeSource,/import '\.\/v253DashboardFastPath\.js';/,'V253 backend fast path must activate before server registration');
const cacheDelayMatch=runtimeSource.match(/primeDashboardCacheInChild\(delayMs\s*=\s*([^)]+)\)/);
assert.ok(cacheDelayMatch,'legacy cache maintenance must expose an explicit default startup delay');
const cacheDelayMs=Function(`"use strict";return (${cacheDelayMatch[1]});`)();
assert.ok(Number.isFinite(cacheDelayMs)&&cacheDelayMs>=60_000,`legacy cache maintenance must stay away from first paint by at least 60s; got ${cacheDelayMs}`);
assert.doesNotMatch(fastSource,/dashboard_daily_cache/,'V253 visible trend path must not depend on dashboard_daily_cache');
assert.match(fastSource,/V253_BULK_NORMALIZED_READ_NO_DASHBOARD_CACHE/,'V253 response must expose cache-independent ownership');
assert.match(fastSource,/FROM unified_import_rows u WHERE u\.snapshotId=\? AND u\.businessType='CEAF' AND EXISTS/,'instant WHPP overlap correction must drive from the small CEAF slice');
assert.match(fastSource,/\/api\/v253\/shopee-region/,'exact Shopee PP\/PV must have an indexed one-day endpoint');
assert.match(fastSource,/!registered&&path==='\/api\/v234\/trends'/,'V253 read-only endpoints must register only when authenticated V234 dashboard routes are being installed');
assert.doesNotThrow(()=>new Function(uiSource),'V253 browser owner must compile');
assert.match(uiSource,/\/api\/v89\/instant-dashboard/,'V253 browser owner must intercept the slow legacy instant-dashboard request');
assert.match(uiSource,/\/api\/v253\/instant-dashboard/,'legacy first-paint request must be redirected to V253');
assert.match(uiSource,/\/api\/v234\/trends/,'V253 must intercept old cache-dependent trend reads');
assert.match(uiSource,/\/api\/v253\/trends/,'V253 compatibility interception point must remain present even when V290/V289 route visible trends onward to proven truth');
assert.match(uiSource,/removeHomeLegacyAttempts/,'home must remove the obsolete dual Shopee attempt chart block');
assert.match(uiSource,/sessionStorage/,'repeat navigation must retain the stale-while-revalidate compatibility session helper');
assert.match(injectSource,/v253-dashboard-fast-owner\.js\?v=20260823-v253-1/,'V253 browser owner must be cache-busted into delivered HTML');
assert.ok(injectSource.indexOf('V253_FAST_MARKER')<injectSource.indexOf('const tags = []'),'V253 must be injected in head before body dashboard clients');
assert.match(injectSource,/X-CE-QC-V253-UI/,'V253 response header must be observable');

const {getDb,closeDb}=await import('../src/db.js');
const {ensureV246TrackingSchema}=await import('../src/v246TrackingLedgerCore.js');
const {readV253DashboardTrends,readV253InstantSummary,readV253ShopeeRegion,V253_DASHBOARD_FAST_PATH_ID}=await import('../src/v253DashboardFastPath.js');
const db=getDb();ensureV246TrackingSchema(db);
const dates=['2026-08-19','2026-08-20','2026-08-21'];
const core=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const insertSnapshot=db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)');
const insertBatch=db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)');
const insertImport=db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertCcslFinal=db.prepare(`INSERT INTO final_rows(shipmentCode,reportDate,isPod,primaryCategory,category,ocDays,rawJson,lastEventTime,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)`);
const insertBusinessFinal=db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,rawJson,latestEventTime,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)`);
const insertLedger=db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,trackingStatus,terminalReason,currentState,currentCategory,podDate,attemptNo,attemptSource,signingDays,currentStateJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertWhppParse=db.prepare(`INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode,rowJson,createdAt) VALUES(?,?,?,?,?)`);
const insertWhppReport=db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)`);

for(let di=0;di<dates.length;di++){
  const date=dates[di],snapshotId=`V253-S${di}`,batchId=`V253-B${di}`,now=`${date}T23:00:00.000Z`;
  insertSnapshot.run(snapshotId,batchId,date,'COMPLETED','{}',now);
  insertBatch.run(batchId,snapshotId,date,'v253.xlsx',`hash-${di}`,'VALID','{}','[]',now);
  let rowNo=1;
  for(const type of core){
    const count=type==='SHOPEECN'&&di===2?2:1;
    for(let j=0;j<count;j++){
      const bill=`${type}-${di}-${j}`,region=j%2===0?'PP':'PV';
      insertImport.run(batchId,snapshotId,date,type,bill,region,type,type,'日报',rowNo++,'V253_SMOKE','{}',now);
      if(['CE','CEAF','TBKH','ALI1688'].includes(type)){
        const isPod=(di+j)%2===0?1:0,category=!isPod&&di===1?'OC':'正常',podTime=isPod?`${date} 15:00:00`:'';
        insertCcslFinal.run(bill,date,isPod,category,category,category==='OC'?1:0,JSON.stringify({POD时间:podTime,当前状态:category}),podTime||`${date} 18:00:00`,now,now);
      }else{
        const isPod=(di+j)%2===0?1:0,category=!isPod&&di===1?'OC':'Pending',podTime=isPod?`${date} 16:00:00`:'';
        insertBusinessFinal.run('SHOPEE',bill,date,isPod,category,JSON.stringify({POD时间:podTime,当前状态:category}),podTime||`${date} 18:00:00`,now,now);
        const attempt=isPod?1:0;
        insertLedger.run(bill,type,date,date,isPod?'TERMINAL':'OPEN',isPod?'POD':'',isPod?'POD':category,isPod?'POD':category,isPod?date:'',attempt,attempt?'V246_STRICT_TRACK:SMOKE':'',isPod?1:null,JSON.stringify({当前状态:isPod?'POD':category,状态标识:isPod?'POD':category}),now,now);
      }
    }
  }
  const overlap=`CEAF-${di}-0`,unique=`WHPP-${di}-UNIQUE`;
  insertWhppParse.run('WHPP',date,overlap,'{}',now);insertWhppParse.run('WHPP',date,unique,'{}',now);
  insertWhppReport.run('WHPP',date,'v253-whpp.xls',2,'{}',now,now);
  const whppPod=di%2===0?1:0;
  insertBusinessFinal.run('WHPP',unique,date,whppPod,whppPod?'POD':(di===1?'OC':'Pending'),JSON.stringify({POD时间:whppPod?`${date} 17:00:00`:'',当前状态:di===1?'OC':'Pending'}),`${date} 17:00:00`,now,now);
}

for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP','CCSL','SHOPEE','ALL']){
  const trend=readV253DashboardTrends(type,dates.at(-1),dates.at(-1));
  assert.equal(trend.readId,V253_DASHBOARD_FAST_PATH_ID);
  assert.deepEqual(trend.dates,dates,`${type} single-day selection must still expose the recent three fixture dates`);
  assert.equal(trend.missingDates.length,0,`${type} must render without dashboard_daily_cache`);
  assert.ok(trend.daily.every(row=>row.ready),`${type} fallback facts must be complete`);
}
const ceaf=readV253DashboardTrends('CEAF',dates.at(-1),dates.at(-1));
assert.deepEqual(ceaf.podRate,[100,0,100],'CEAF rates must vary by actual daily facts rather than flat/missing cache');
const whpp=readV253DashboardTrends('WHPP',dates.at(-1),dates.at(-1));
assert.deepEqual(whpp.ticket,[1,1,1],'WHPP trends must exclude CEAF-overlap members on every day');
const instant=readV253InstantSummary(dates.at(-1));
assert.equal(instant.counts.WHPP,1,'instant summary must subtract CEAF overlap without WHPP-wide anti-join');
assert.equal(instant.sourceCorrection.removedFromWhpp,1);
const region=readV253ShopeeRegion('SHOPEECN',dates.at(-1));
assert.equal(region.daily[0].regions.PP.total,1);
assert.equal(region.daily[0].regions.PV.total,1);
assert.equal(region.daily[0].regions.PP.attempt1,1,'exact PP region must read strict attempt evidence from indexed lifecycle ledger');

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V253/V290] dashboard fastpath smoke passed: no dashboard cache dependency + minimum startup delay + all boards multi-day trends + fast WHPP overlap + indexed exact Shopee regions + authenticated owner');
