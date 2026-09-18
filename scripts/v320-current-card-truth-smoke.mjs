import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v320DispatchMetricOverlay.js','src/rangeDashboardStoreV320.js','src/rangeDashboardStoreFinal.js','src/rangeDashboardStoreInteractive.js','src/rangeDashboardStore.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const facade=fs.readFileSync('src/rangeDashboardStore.js','utf8');
const interactiveOwner=fs.readFileSync('src/rangeDashboardStoreInteractive.js','utf8');
const finalOwner=fs.readFileSync('src/rangeDashboardStoreFinal.js','utf8');
const rangeOwner=fs.readFileSync('src/rangeDashboardStoreV320.js','utf8');
assert.match(facade,/rangeDashboardStoreInteractive\.js/,'public period-dashboard facade must pass through the interactive stability owner');
assert.doesNotMatch(facade,/export \{ loadRangeDashboard \} from '.\/rangeDashboardStoreFinal\.js'/,'public interactive facade must not directly enter final row-level normalization');
assert.match(interactiveOwner,/loadRangeDashboardV320\(from, to\)/,'single-day interactive range must use V320 cache truth');
assert.match(interactiveOwner,/loadRangeDashboardFinal\(fromDate, toDate\)/,'explicit multi-day range must retain final normalization');
assert.match(interactiveOwner,/requestTimeShipmentScan:\s*false/,'single-day interactive range must declare no request-time shipment scan');
assert.match(finalOwner,/rangeDashboardStoreV320\.js/,'final business normalization must consume V320 as its authoritative source/cache truth');
assert.doesNotMatch(finalOwner,/rangeDashboardStoreV31\.js/,'final normalization must never fall back to the obsolete V31 snapshot selector');
assert.match(facade,/rangeDashboardStoreV295[\s\S]*rangeDashboardStoreV294/,'historical V295/V294 compatibility markers must remain');
assert.match(rangeOwner,/currentCacheOverlayApplied/,'single-day range owner must only apply reconciled completed-cache rows');
assert.match(rangeOwner,/from!==to/,'V320 current-card override must stay single-day only');
assert.match(finalOwner,/finalNormalizationApplied:\s*true/,'public result must make the post-V320 normal-flow normalization observable');
assert.match(finalOwner,/PARTITION BY u\.reportDate,UPPER\(TRIM\(u\.businessType\)\)/,'final normal-flow adjustments must preserve V320-era per-date + per-business latest VALID isolation');

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v320-current-'));
process.env.DATA_DIR=tempRoot;process.env.DB_FILE=path.join(tempRoot,'current.db');process.env.ACCESS_MODE='LOCAL';process.env.SQLITE_MMAP_BYTES='0';process.env.SQLITE_CACHE_KIB='8192';process.env.NODE_ENV='test';
const {getDb,closeDb}=await import('../src/db.js');
const {readV320HistoricalDailyWithDispatch}=await import('../src/v320DispatchMetricOverlay.js');
const db=getDb();
db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache (
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
const batch=db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)');
const snap=db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)');
const member=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
const cache=db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)');
function seed(date,id,cacheTotal,cachePod){const now=`${date}T23:00:00Z`,s=`S${id}`,b=`B${id}`;snap.run(s,b,date,'COMPLETED','{}',now);batch.run(b,s,date,'x.xls',`h${id}`,'VALID','{}','[]',now);for(let i=1;i<=2;i++)member.run(b,s,date,'CE',`CE-${id}-${i}`,'PP','CE','CE','日报',i,'TEST','{}',now);cache.run(date,'CE','',JSON.stringify({total:cacheTotal,pod:cachePod,returned:0,cancelled:0,sameDayPod:cachePod,ocCurrent:0,pendingNonContinuous:0,pending3:0,oc1:0,oc2:0,cycle2:0,inboundNoScan:0,provinceOpen:0}),s,'COMPLETED','test',now);}
seed('2026-08-06','GOOD',2,2);
seed('2026-08-07','BAD',1,1);
const good=readV320HistoricalDailyWithDispatch('CE','2026-08-06','2026-08-06',{db,expandSingle:false}).daily[0];
assert.equal(good.total,2);assert.equal(good.pod,2,'denominator-matched completed cache must protect completed POD truth from an empty/unproven ledger/final reconstruction');assert.equal(good.podRate,100);assert.equal(good.currentCacheOverlayApplied,true);
const bad=readV320HistoricalDailyWithDispatch('CE','2026-08-07','2026-08-07',{db,expandSingle:false}).daily[0];
assert.equal(bad.total,2);assert.equal(bad.currentCacheOverlayApplied,false,'cache with a mismatched denominator must never override persisted daily membership');assert.equal(bad.pod,0,'mismatched cache must be rejected rather than fabricated into the current card');
closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V402/V320] current-card truth smoke passed · public facade=Interactive→single-day V320 cache / explicit multi-day Final · exact completed cache wins only at identical daily denominator · final normal-flow rules preserve per-business latest VALID truth');