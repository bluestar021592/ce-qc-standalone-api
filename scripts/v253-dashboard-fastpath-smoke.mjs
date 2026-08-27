import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v253DashboardFastPath.js','src/v236DashboardCurrentRead.js','src/v284DailyMembershipTruth.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const fastSource=fs.readFileSync('src/v253DashboardFastPath.js','utf8');
const uiSource=fs.readFileSync('public/v253-dashboard-fast-owner.js','utf8');
const runtimeSource=fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js','utf8');
const injectSource=fs.readFileSync('src/v231MetricTruthUiInjectionPatch.js','utf8');
assert.match(runtimeSource,/import '\.\/v253DashboardFastPath\.js';/,'V253 first-paint route must remain activated');
assert.match(fastSource,/V253_V335_FIRST_PAINT_ID='2026-08-27-v335-per-business-first-paint-v1'/);
assert.match(fastSource,/readV236CurrentSummary/,'single-day first paint must consume per-business current truth');
assert.match(fastSource,/readV284DashboardTrends/,'explicit ranges may delegate to canonical per-business daily truth');
assert.match(fastSource,/V335_PER_BUSINESS_SINGLE_DAY_FIRST_PAINT_NO_HISTORY_SCAN/,'same-day first paint must not scan historical tables');
assert.match(fastSource,/latestBatchForType\(date,'CEAF'/,'WHPP overlap must locate CEAF own same-date snapshot');
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
// Import order intentionally reproduces the production failure: VN first, CEAF next, CN last.
seed('SHOPEEVN','VN',{PP:{total:1,pod:1,attempt1:1},PV:{total:1,pod:0}},'2026-08-07T20:00:00Z');
seed('CEAF','CEAF',{'':{total:1,pod:0}},'2026-08-07T21:00:00Z');
seed('SHOPEECN','CN',{PP:{total:1,pod:1,attempt1:1},PV:{total:2,pod:1,attempt2:1}},'2026-08-07T23:00:00Z');
// WHPP has two raw members; one overlaps CEAF. CN is newer globally, but de-dup must still find CEAF's own snapshot.
const whppParse=db.prepare('INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode,rowJson,createdAt) VALUES(?,?,?,?,?)');
whppParse.run('WHPP',date,'CEAF--1','{}','2026-08-07T22:00:00Z');
whppParse.run('WHPP',date,'WHPP-UNIQUE','{}','2026-08-07T22:00:00Z');
// Replace the synthetic CEAF bill with the exact overlap bill in its own snapshot.
db.prepare("UPDATE unified_import_rows SET shipmentCode='CEAF--1' WHERE snapshotId='S-CEAF'").run();
db.prepare('INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').run('WHPP',date,'whpp.xls',2,'{}','2026-08-07T22:00:00Z','2026-08-07T22:00:00Z');

const {readV253DashboardTrends,readV253InstantSummary,readV253ShopeeRegion,V253_DASHBOARD_FAST_PATH_ID,V253_V335_FIRST_PAINT_ID}=await import('../src/v253DashboardFastPath.js');
const instant=readV253InstantSummary(date);
assert.equal(instant.v335Id,V253_V335_FIRST_PAINT_ID);
assert.deepEqual({cn:instant.counts.SHOPEECN,vn:instant.counts.SHOPEEVN,ceaf:instant.counts.CEAF,whpp:instant.counts.WHPP},{cn:3,vn:2,ceaf:1,whpp:1},'later CN import must not zero VN/CEAF and WHPP must de-dup against CEAF own snapshot');
assert.notEqual(instant.snapshotIds.SHOPEECN,instant.snapshotIds.SHOPEEVN);
assert.equal(instant.sourceCorrection.removedFromWhpp,1);
const vn=readV253DashboardTrends('SHOPEEVN',date,date);
assert.equal(vn.readId,V253_DASHBOARD_FAST_PATH_ID);assert.equal(vn.v335Id,V253_V335_FIRST_PAINT_ID);assert.deepEqual(vn.dates,[date],'V253 same-day first paint must return only the selected day; V334 owns saved history');assert.deepEqual(vn.ticket,[2]);
const cn=readV253DashboardTrends('SHOPEECN',date,date);assert.deepEqual(cn.ticket,[3]);
const region=readV253ShopeeRegion('SHOPEECN',date);assert.equal(region.daily[0].regions.PP.total,1);assert.equal(region.daily[0].regions.PV.total,2);assert.equal(region.daily[0].regions.PP.attempt1,1);assert.equal(region.daily[0].regions.PV.attempt2,1);
closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});

// test:golive already executes this V253 smoke. Chain the newest regression suites here so the launcher candidate gate cannot miss them even if package.json still lists the legacy test set.
execFileSync(process.execPath,['scripts/v335-per-business-daily-membership-smoke.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v334-history-unification-smoke.mjs'],{stdio:'inherit'});
console.log('[V335/V253] first-paint smoke passed · same-day CN/VN/CEAF snapshots stay independent · single-day V253 is nonblocking · WHPP de-dup uses CEAF own snapshot · V334 remains history owner · V335/V334 chained golive regressions passed');