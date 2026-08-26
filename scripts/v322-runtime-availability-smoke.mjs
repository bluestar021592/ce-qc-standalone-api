import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

for(const file of ['src/rangeDashboardStoreV320.js','src/v322WebAvailabilityPatch.js','src/v147TrackTimeoutConfig.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const rangeSource=fs.readFileSync('src/rangeDashboardStoreV320.js','utf8');
const progressSource=fs.readFileSync('src/v322WebAvailabilityPatch.js','utf8');
const activation=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
assert.match(rangeSource,/V322_SINGLE_DAY_DASHBOARD_CACHE_ONLY/);
assert.match(rangeSource,/readV236CurrentSummary\(date,\{cacheOnly:true\}\)/,'single-day period dashboard must use the tiny completed-cache reader');
assert.match(rangeSource,/requestedFrom===requestedTo\)return fastSingleDay\(requestedTo\)/,'single-day must return before historical V295/V294 work');
assert.ok(rangeSource.indexOf('return fastSingleDay(requestedTo)')<rangeSource.indexOf('const range=loadRangeDashboardV295'),'heavy historical range owner must be unreachable for a one-day request');
assert.match(progressSource,/V322_TINY_LOCK_CHECKPOINT_NO_FACT_TABLE_SCAN/);
assert.doesNotMatch(progressSource,/FROM\s+(?:scan_results|business_scan_results|final_rows|business_final_rows)/i,'run-progress must not count large fact tables');
assert.match(progressSource,/\/api\/v33\/run-progress/,'V322 must replace the legacy progress handler');
assert.match(activation,/v322WebAvailabilityPatch\.js/,'V322 web availability guard must activate before server route registration');

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v322-'));
process.env.DATA_DIR=tempRoot;process.env.DB_FILE=path.join(tempRoot,'v322.db');process.env.ACCESS_MODE='LOCAL';process.env.SQLITE_MMAP_BYTES='0';process.env.SQLITE_CACHE_KIB='8192';process.env.NODE_ENV='test';process.env.CE_QC_DISABLE_V246_TRACKING='1';
const {getDb,closeDb}=await import('../src/db.js');
const {loadRangeDashboard}=await import('../src/rangeDashboardStoreV320.js');
const {readV322RunProgress}=await import('../src/v322WebAvailabilityPatch.js');
const db=getDb(),date='2026-08-06',snapshotId='V322-S',batchId='V322-B',now=`${date}T23:00:00.000Z`;
// dashboard_daily_cache is a runtime-maintained table rather than a base migration
// table in some isolated test databases. Create only the minimal production-compatible
// shape required by this fixture so the smoke tests the V322 read path, not unrelated
// cache-worker schema creation order.
db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache(
  reportDate TEXT NOT NULL,
  businessType TEXT NOT NULL,
  regionCode TEXT NOT NULL DEFAULT '',
  metricsJson TEXT NOT NULL,
  snapshotId TEXT NOT NULL DEFAULT '',
  snapshotStatus TEXT NOT NULL DEFAULT '',
  sourceFingerprint TEXT NOT NULL DEFAULT '',
  refreshedAt TEXT NOT NULL,
  PRIMARY KEY(reportDate,businessType,regionCode)
)`);
db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(snapshotId,batchId,date,'COMPLETED','{}',now);
db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(batchId,snapshotId,date,'v322.xlsx','v322-hash','VALID','{}','[]',now);
const insRow=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
const types=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
for(let i=0;i<types.length;i++)insRow.run(batchId,snapshotId,date,types[i],`V322-${types[i]}`,'PP',types[i],types[i],'日报',i+1,'V322','{}',now);
const cache=db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)');
for(const type of [...types,'WHPP'])cache.run(date,type,'',JSON.stringify({total:1,pod:1,returned:0,cancelled:0,sameDayPod:1,ocCurrent:0,pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,delivery1:0,deliveryStay:0,provinceOpen:0,attempt1:type.startsWith('SHOPEE')?1:0,attempt2:0,attempt3:0}),snapshotId,'COMPLETED','V322',now);

let started=performance.now();const range=loadRangeDashboard(date,date),rangeMs=performance.now()-started;
assert.equal(range.queryMode,'V322_SINGLE_DAY_DASHBOARD_CACHE_ONLY');assert.equal(range.dates.length,1);assert.equal(range.dates[0],date);assert.equal(range.sourceTotal,7);assert.ok(rangeMs<500,`single-day period dashboard must stay sub-500ms in fixture, got ${rangeMs.toFixed(1)}ms`);
started=performance.now();const progress=readV322RunProgress('CCSL',db),progressMs=performance.now()-started;
assert.equal(progress.progressRule,'V322_TINY_LOCK_CHECKPOINT_NO_FACT_TABLE_SCAN');assert.equal(progress.dailyTotal,4);assert.ok(progressMs<200,`tiny run progress must stay sub-200ms in fixture, got ${progressMs.toFixed(1)}ms`);
closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log(`[V322] runtime availability smoke passed · single-day period=${rangeMs.toFixed(1)}ms · tiny progress=${progressMs.toFixed(1)}ms · no large fact-table scans`);
