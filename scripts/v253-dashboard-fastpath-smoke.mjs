import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v42WhppPatch.js','src/v253DashboardFastPath.js','src/v236DashboardCurrentRead.js','src/v284DailyMembershipTruth.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const fastSource=fs.readFileSync('src/v253DashboardFastPath.js','utf8');
const v236Source=fs.readFileSync('src/v236DashboardCurrentRead.js','utf8');
const v284Source=fs.readFileSync('src/v284DailyMembershipTruth.js','utf8');
const v42Source=fs.readFileSync('src/v42WhppPatch.js','utf8');
const uiSource=fs.readFileSync('public/v253-dashboard-fast-owner.js','utf8');
const runtimeSource=fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js','utf8');
const injectSource=fs.readFileSync('src/v231MetricTruthUiInjectionPatch.js','utf8');
assert.match(runtimeSource,/import '\.\/v253DashboardFastPath\.js';/,'V253 first-paint route must remain activated');
assert.match(fastSource,/V253_V335_FIRST_PAINT_ID='2026-08-27-v335-per-business-first-paint-v1'/);
assert.match(fastSource,/readV236CurrentSummary/,'single-day first paint must consume per-business current truth');
assert.match(fastSource,/readV284DashboardTrends/,'explicit ranges may delegate status calculation to canonical per-business daily truth');
assert.match(fastSource,/PER_BUSINESS_SINGLE_DAY_FIRST_PAINT_NO_HISTORY_SCAN/,'same-day first paint must not scan historical tables');
assert.match(fastSource,/latestBatchForType\(date,'CEAF'/,'WHPP overlap diagnostic must locate CEAF own same-date snapshot');
assert.match(fastSource,/WHPP_STANDARD_DAILY_ZERO/,'exact 0\/0 WHPP standard daily membership must remain a real zero');
assert.match(fastSource,/error\.code='WHPP_STANDARD_DAILY_INCOMPLETE'/,'incomplete WHPP standard membership must reject first paint instead of looking like zero');
assert.match(fastSource,/function strictWhppCurrentMetric\(date,base=\{\}\)/,'single-day WHPP trend must pass through the same strict membership owner as instant cards');
assert.match(fastSource,/function validateWhppRangeMembership\(type,rows=\[\]\)/,'multi-day WHPP trend must validate each daily cohort before publication');
assert.match(fastSource,/error\.code='WHPP_TREND_MEMBERSHIP_MISMATCH'/,'trend totals that disagree with strict WHPP daily membership must fail closed');
assert.match(fastSource,/const conflict=error\?\.code==='WHPP_STANDARD_DAILY_INCOMPLETE'\|\|error\?\.code==='WHPP_TREND_MEMBERSHIP_MISMATCH'/,'trend membership damage must surface as an explicit conflict response');
assert.match(fastSource,/error\?\.code==='WHPP_STANDARD_DAILY_INCOMPLETE'\?409:500/,'instant WHPP membership damage must surface as an explicit conflict response');
assert.match(fastSource,/export function invalidateV253DashboardFastPath\(\)\{memory\.clear\(\);\}/,'V253 must expose immediate in-memory cache invalidation after a successful import');
assert.match(v236Source,/export function invalidateV236CurrentSummary\(\)\{summaryCache\.clear\(\);\}/,'V236 must expose current-summary cache invalidation after a successful import');
assert.match(v284Source,/globalThis\.__CE_QC_INVALIDATE_V284_DAILY_MEMBERSHIP__=invalidateV284DailyMembershipTruth/,'V284 range cache invalidation must remain globally callable by the import owner');
assert.match(v42Source,/function invalidateDashboardReadCaches\(\)/,'V42 daily import owner must centrally invalidate read caches');
for(const token of ['__CE_QC_INVALIDATE_V236_CURRENT_SUMMARY__','__CE_QC_INVALIDATE_V253_DASHBOARD_FAST_PATH__','__CE_QC_INVALIDATE_V284_DAILY_MEMBERSHIP__'])assert.ok(v42Source.includes(token),`V42 import cache invalidation missing ${token}`);
const lifecycleDecisionAt=v42Source.indexOf("const whppLifecycleChanged = String(whppState.snapshotStatus || '').toUpperCase() !== 'COMPLETED';");
const pointerInvalidateAt=v42Source.indexOf('invalidateMutableSameDatePointers(parsed.reportDate, { whppChanged: whppLifecycleChanged });');
const activateAt=v42Source.indexOf('const releasedSupersededSlots = activateUnifiedCoreImport(staged);');
const verifyAt=v42Source.indexOf('const verification = verifyAtomicImportPersistence(');
const cacheInvalidateAt=v42Source.indexOf('invalidateDashboardReadCaches();',verifyAt);
assert.ok(lifecycleDecisionAt>=0&&pointerInvalidateAt>lifecycleDecisionAt&&activateAt>pointerInvalidateAt&&verifyAt>activateAt&&cacheInvalidateAt>verifyAt,'dashboard caches must invalidate only after finalized-WHPP lifecycle decision, pointer cleanup, VALID activation and persisted-truth verification');
assert.doesNotMatch(fastSource,/function latestBatches\(/,'retired global latest-batch-per-date helper must not return');
assert.doesNotMatch(fastSource,/PARTITION BY reportDate ORDER BY createdAt DESC/,'V253 must not select one global snapshot for all same-date businesses');
assert.doesNotMatch(fastSource,/V253_BULK_NORMALIZED_READ_NO_DASHBOARD_CACHE/,'retired V253 multi-day ownership must stay retired');
assert.match(fastSource,/\/api\/v253\/instant-dashboard/);assert.match(fastSource,/\/api\/v253\/trends/);assert.match(fastSource,/\/api\/v253\/shopee-region/);
assert.doesNotThrow(()=>new Function(uiSource));
assert.match(uiSource,/\/api\/v89\/instant-dashboard/);assert.match(uiSource,/\/api\/v253\/instant-dashboard/);assert.match(uiSource,/sessionStorage/);
assert.match(injectSource,/v253-dashboard-fast-owner\.js\?v=20260823-v253-1/,'existing browser marker is compatibility-only and must remain deliverable');

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v335-v253-'));
process.env.DATA_DIR=tempRoot;process.env.DB_FILE=path.join(tempRoot,'v335-v253.db');process.env.ACCESS_MODE='LOCAL';process.env.SQLITE_MMAP_BYTES='0';process.env.SQLITE_CACHE_KIB='8192';process.env.CE_QC_DISABLE_V246_TRACKING='1';process.env.NODE_ENV='test';
const {getDb,closeDb}=await import('../src/db.js');const db=getDb();
db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache (
 reportDate TEXT NOT NULL,businessType TEXT NOT NULL,regionCode TEXT NOT NULL DEFAULT '',metricsJson TEXT NOT NULL,
 snapshotId TEXT NOT NULL DEFAULT '',snapshotStatus TEXT NOT NULL DEFAULT '',sourceFingerprint TEXT NOT NULL DEFAULT '',refreshedAt TEXT NOT NULL,
 PRIMARY KEY(reportDate,businessType,regionCode)
)`);
const date='2026-08-07';
const snap=db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)');
const batch=db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)');
const member=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
const cache=db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)');
function seed(type,id,regions,createdAt){const s=`S-${id}`,b=`B-${id}`;snap.run(s,b,date,'COMPLETED','{}',createdAt);batch.run(b,s,date,`${type}.xls`,id,'VALID','{}','[]',createdAt);let rowNo=1;for(const [region,m] of Object.entries(regions)){for(let i=0;i<Number(m.total||0);i++)member.run(b,s,date,type,`${type}-${region}-${i+1}`,region,type,type,'日报',rowNo++,'V335_TEST','{}',createdAt);cache.run(date,type,region,JSON.stringify({total:Number(m.total||0),pod:Number(m.pod||0),returned:0,cancelled:0,sameDayPod:Number(m.sameDayPod||0),ocCurrent:Number(m.ocCurrent||0),pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,deliveryStay:0,provinceOpen:0,attempt1:Number(m.attempt1||0),attempt2:Number(m.attempt2||0),attempt3:Number(m.attempt3||0)}),s,'COMPLETED','v335',createdAt);}}
seed('SHOPEEVN','VN',{PP:{total:1,pod:1,attempt1:1},PV:{total:1,pod:0}},'2026-08-07T20:00:00Z');
seed('CEAF','CEAF',{'':{total:1,pod:0}},'2026-08-07T21:00:00Z');
seed('SHOPEECN','CN',{PP:{total:1,pod:1,attempt1:1},PV:{total:2,pod:1,attempt2:1}},'2026-08-07T23:00:00Z');
const whppParse=db.prepare('INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode,rowJson,createdAt) VALUES(?,?,?,?,?)');
const whppDaily=db.prepare('INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)');
whppParse.run('WHPP',date,'CEAF--1','{}','2026-08-07T22:00:00Z');
whppParse.run('WHPP',date,'WHPP-UNIQUE','{}','2026-08-07T22:00:00Z');
db.prepare("UPDATE unified_import_rows SET shipmentCode='CEAF--1' WHERE snapshotId='S-CEAF'").run();
whppDaily.run('WHPP',date,'whpp.xls',2,'{}','2026-08-07T22:00:00Z','2026-08-07T22:00:00Z');

const {readV253DashboardTrends,readV253InstantSummary,readV253ShopeeRegion,V253_DASHBOARD_FAST_PATH_ID,V253_V335_FIRST_PAINT_ID}=await import('../src/v253DashboardFastPath.js');
const instant=readV253InstantSummary(date);
assert.equal(instant.v335Id,V253_V335_FIRST_PAINT_ID);
assert.deepEqual({cn:instant.counts.SHOPEECN,vn:instant.counts.SHOPEEVN,ceaf:instant.counts.CEAF,whpp:instant.counts.WHPP},{cn:3,vn:2,ceaf:1,whpp:2},'later CN import must not zero VN/CEAF and WHPP must keep its complete independent daily membership');
assert.equal(instant.sourceCorrection.membershipSource,'WHPP_STANDARD_DAILY','2\/2 WHPP standard membership must be the first-paint authority');
assert.notEqual(instant.snapshotIds.SHOPEECN,instant.snapshotIds.SHOPEEVN);
assert.equal(instant.sourceCorrection.removedFromWhpp,0,'CEAF overlap must never subtract independent WHPP members');
assert.equal(instant.sourceCorrection.ceafOverlapDiagnostic,1,'CEAF overlap remains visible as a diagnostic only');
const whppTrend=readV253DashboardTrends('WHPP',date,date);assert.deepEqual(whppTrend.ticket,[2]);assert.equal(whppTrend.daily[0].membershipSource,'WHPP_STANDARD_DAILY','single-day WHPP trend must share the exact standard membership owner as instant cards');
const vn=readV253DashboardTrends('SHOPEEVN',date,date);assert.equal(vn.readId,V253_DASHBOARD_FAST_PATH_ID);assert.equal(vn.v335Id,V253_V335_FIRST_PAINT_ID);assert.deepEqual(vn.dates,[date]);assert.deepEqual(vn.ticket,[2]);
const cn=readV253DashboardTrends('SHOPEECN',date,date);assert.deepEqual(cn.ticket,[3]);
const region=readV253ShopeeRegion('SHOPEECN',date);assert.equal(region.daily[0].regions.PP.total,1);assert.equal(region.daily[0].regions.PV.total,2);assert.equal(region.daily[0].regions.PP.attempt1,1);assert.equal(region.daily[0].regions.PV.attempt2,1);

// Same-date membership changes must not wait for the 10s/30s read-cache TTLs.
whppParse.run('WHPP',date,'WHPP-THIRD',JSON.stringify({shipmentCode:'WHPP-THIRD',businessType:'WHPP',reportDate:date}),'2026-08-07T23:30:00Z');
db.prepare("UPDATE business_daily_reports SET totalCount=3,updatedAt=? WHERE businessType='WHPP' AND reportDate=?").run('2026-08-07T23:30:00Z',date);
assert.equal(readV253InstantSummary(date).counts.WHPP,2,'fixture must prove a cached first-paint value exists before explicit invalidation');
for(const name of ['__CE_QC_INVALIDATE_V236_CURRENT_SUMMARY__','__CE_QC_INVALIDATE_V253_DASHBOARD_FAST_PATH__','__CE_QC_INVALIDATE_V284_DAILY_MEMBERSHIP__']){
  assert.equal(typeof globalThis[name],'function',`${name} must be installed before the import owner can invalidate caches`);
  globalThis[name]();
}
const freshAfterInvalidate=readV253InstantSummary(date);
assert.equal(freshAfterInvalidate.counts.WHPP,3,'after import cache invalidation the first paint must immediately expose the new exact 3/3 WHPP membership');
assert.equal(freshAfterInvalidate.sourceCorrection.membershipSource,'WHPP_STANDARD_DAILY');
const freshTrendAfterInvalidate=readV253DashboardTrends('WHPP',date,date);
assert.deepEqual(freshTrendAfterInvalidate.ticket,[3],'after import cache invalidation WHPP trend must immediately use the same new 3/3 membership');

const zeroDate='2026-08-08';
whppDaily.run('WHPP',zeroDate,'whpp-zero.xls',0,'{}','2026-08-08T22:00:00Z','2026-08-08T22:00:00Z');
const zero=readV253InstantSummary(zeroDate);
assert.equal(zero.counts.WHPP,0,'exact 0\/0 WHPP daily membership must publish real zero');
assert.equal(zero.sourceCorrection.membershipSource,'WHPP_STANDARD_DAILY_ZERO');
assert.equal(zero.sourceCorrection.whppDirectStandard,true);
assert.equal(zero.sourceCorrection.whppExpected,0);
assert.equal(zero.sourceCorrection.whppActual,0);
const zeroTrend=readV253DashboardTrends('WHPP',zeroDate,zeroDate);
assert.deepEqual(zeroTrend.ticket,[0],'exact 0\/0 WHPP trend must remain a real zero instead of disappearing or falling back to history');
assert.equal(zeroTrend.daily[0].membershipSource,'WHPP_STANDARD_DAILY_ZERO');
assert.equal(zeroTrend.daily[0].ready,true);

const damagedDate='2026-08-09';
whppDaily.run('WHPP',damagedDate,'whpp-damaged.xls',236,'{}','2026-08-09T22:00:00Z','2026-08-09T22:00:00Z');
for(let i=1;i<=235;i++){const code=`CE-DAMAGED-${String(i).padStart(4,'0')}`;whppParse.run('WHPP',damagedDate,code,JSON.stringify({shipmentCode:code,businessType:'WHPP',reportDate:damagedDate}),'2026-08-09T22:00:00Z');}
for(const read of [
  ()=>readV253InstantSummary(damagedDate),
  ()=>readV253DashboardTrends('WHPP',damagedDate,damagedDate),
  ()=>readV253DashboardTrends('WHPP',date,damagedDate)
]){
  assert.throws(
    read,
    error=>error?.code==='WHPP_STANDARD_DAILY_INCOMPLETE'&&error?.expected===236&&error?.actual===235,
    '236 header / 235 members must reject both WHPP card and trend reads; it must never look like WHPP=0 or WHPP=235'
  );
}

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});

// This smoke is already in test:golive. Keep all current high-value regressions chained here so the Windows candidate gate cannot install a build that has not executed them.
execFileSync(process.execPath,['scripts/v335-per-business-daily-membership-smoke.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v334-history-unification-smoke.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v334-generic-history-worker-runtime-smoke.mjs'],{stdio:'inherit',timeout:120000});
execFileSync(process.execPath,['scripts/v334-first-attempt-worker-runtime-smoke.mjs'],{stdio:'inherit',timeout:120000});
execFileSync(process.execPath,['scripts/v314-shopee-throughput-smoke.mjs'],{stdio:'inherit',timeout:120000});
console.log('[V343/V335/V253] first-paint + trend + history + all-business throughput gate passed · WHPP direct daily exact membership · exact 0/0 stays zero · 236/235 rejects cards+trends · same-date cache invalidation exposes new truth immediately · CEAF overlap diagnostic only · isolated history workers · 350 scan / 50x4 track verified');