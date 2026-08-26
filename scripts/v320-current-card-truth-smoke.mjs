import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v320DispatchMetricOverlay.js','src/rangeDashboardStoreV320.js','src/rangeDashboardStore.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const facade=fs.readFileSync('src/rangeDashboardStore.js','utf8');
const rangeOwner=fs.readFileSync('src/rangeDashboardStoreV320.js','utf8');
assert.match(facade,/rangeDashboardStoreV320\.js/,'public period-dashboard facade must activate V320 single-day current truth');
assert.match(facade,/rangeDashboardStoreV295[\s\S]*rangeDashboardStoreV294/,'historical V295/V294 compatibility markers must remain');
assert.match(rangeOwner,/currentCacheOverlayApplied/,'single-day range owner must only apply reconciled completed-cache rows');
assert.match(rangeOwner,/from!==to/,'V320 current-card override must stay single-day only');

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v320-current-'));
process.env.DATA_DIR=tempRoot;process.env.DB_FILE=path.join(tempRoot,'current.db');process.env.ACCESS_MODE='LOCAL';process.env.SQLITE_MMAP_BYTES='0';process.env.SQLITE_CACHE_KIB='8192';process.env.NODE_ENV='test';
const {getDb,closeDb}=await import('../src/db.js');
const {readV320HistoricalDailyWithDispatch}=await import('../src/v320DispatchMetricOverlay.js');
const db=getDb();
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
console.log('[V320] current-card truth smoke passed · exact completed cache wins only at identical daily denominator · unproven ledger cannot collapse completed POD');
