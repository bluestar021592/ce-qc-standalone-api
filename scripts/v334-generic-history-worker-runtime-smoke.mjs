import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v334-generic-worker-'));
const env={...process.env,DATA_DIR:root,DB_FILE:path.join(root,'v334-generic-worker.db'),ACCESS_MODE:'LOCAL',SQLITE_MMAP_BYTES:'0',SQLITE_CACHE_KIB:'8192',NODE_ENV:'test',CE_QC_DISABLE_V246_TRACKING:'1'};
Object.assign(process.env,env);
const {getDb,closeDb}=await import('../src/db.js');
let db=getDb();
db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache(
  reportDate TEXT NOT NULL,businessType TEXT NOT NULL,regionCode TEXT NOT NULL DEFAULT '',metricsJson TEXT NOT NULL,
  snapshotId TEXT NOT NULL DEFAULT '',snapshotStatus TEXT NOT NULL DEFAULT '',sourceFingerprint TEXT NOT NULL DEFAULT '',refreshedAt TEXT NOT NULL,
  PRIMARY KEY(reportDate,businessType,regionCode)
)`);
const snap=db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)`),batch=db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)`),member=db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`),cache=db.prepare(`INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)`),whppReport=db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)`);
function seed(date,id,ceTotal,cePod,ceOc,whppTotal,whppPod,whppOc){
  const now=`${date}T23:00:00.000Z`,s=`S-${id}`,b=`B-${id}`;snap.run(s,b,date,'COMPLETED','{}',now);batch.run(b,s,date,'history.xlsx',`hash-${id}`,'VALID','{}','[]',now);
  for(let i=1;i<=ceTotal;i++)member.run(b,s,date,'CE',`CE-${id}-${i}`,'PP','CE','CE','日报',i,'V334','{}',now);
  cache.run(date,'CE','',JSON.stringify({total:ceTotal,pod:cePod,ocCurrent:ceOc,sameDayPod:Math.min(cePod,Math.max(0,cePod-1))}),s,'COMPLETED','V334',now);
  whppReport.run('WHPP',date,'whpp.xlsx',whppTotal,'{}',now,now);
  cache.run(date,'WHPP','',JSON.stringify({total:whppTotal,pod:whppPod,ocCurrent:whppOc,sameDayPod:whppPod}),s,'COMPLETED','V334',now);
}
seed('2026-08-05','D1',2,1,1,1,1,0);
seed('2026-08-06','D2',3,3,0,2,1,1);
closeDb();
for(const type of ['CE','WHPP','ALL'])execFileSync(process.execPath,['scripts/v334-generic-history-cache-worker.mjs',`--type=${type}`,'--to=2026-08-06'],{cwd:process.cwd(),env,stdio:'pipe',timeout:30000});
db=getDb();
const {readV334GenericHistoryCache}=await import('../src/v334GenericHistoryCache.js');
const ce=readV334GenericHistoryCache('CE','2026-08-06',db);assert.deepEqual(ce.dates,['2026-08-05','2026-08-06']);assert.deepEqual(ce.daily.map(r=>r.total),[2,3]);assert.deepEqual(ce.daily.map(r=>r.pod),[1,3]);assert.deepEqual(ce.daily.map(r=>r.ocCurrent),[1,0]);assert.equal(ce.daily[0].podRate,50);assert.equal(ce.daily[1].podRate,100);
const whpp=readV334GenericHistoryCache('WHPP','2026-08-06',db);assert.deepEqual(whpp.dates,['2026-08-05','2026-08-06']);assert.deepEqual(whpp.daily.map(r=>r.total),[1,2]);assert.deepEqual(whpp.daily.map(r=>r.pod),[1,1]);assert.deepEqual(whpp.daily.map(r=>r.ocCurrent),[0,1]);
const all=readV334GenericHistoryCache('ALL','2026-08-06',db);assert.deepEqual(all.dates,['2026-08-05','2026-08-06']);assert.deepEqual(all.daily.map(r=>r.total),[3,5]);assert.deepEqual(all.daily.map(r=>r.pod),[2,4]);assert.deepEqual(all.daily.map(r=>r.ocCurrent),[1,1]);assert.equal(all.daily[0].podRate,66.67);assert.equal(all.daily[1].podRate,80);
for(const type of ['CE','WHPP','ALL']){const rows=db.prepare('SELECT source FROM v334_generic_history_cache WHERE businessType=?').all(type);assert.ok(rows.length>=2);assert.ok(rows.every(row=>/V334_ISOLATED_V320_PERSISTED_HISTORY/.test(String(row.source))),`${type} must come from isolated persisted-history worker`);}
closeDb();fs.rmSync(root,{recursive:true,force:true});
console.log('[V334] generic history worker runtime smoke passed · CE + WHPP + ALL each rebuild two persisted dates in isolated child execution without touching production DB');
