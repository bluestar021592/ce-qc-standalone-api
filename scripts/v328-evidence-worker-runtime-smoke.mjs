import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v329-worker-'));
const env={...process.env,DATA_DIR:root,DB_FILE:path.join(root,'v329-worker.db'),ACCESS_MODE:'LOCAL',SQLITE_MMAP_BYTES:'0',SQLITE_CACHE_KIB:'8192',NODE_ENV:'test',CE_QC_DISABLE_V246_TRACKING:'1',REQUEST_TIMEOUT_MS:'1000'};
Object.assign(process.env,env);
const {getDb,closeDb}=await import('../src/db.js');
let db=getDb();const now='2026-08-06T20:00:00Z';
const addUnified=(date,type,bill)=>{const batch=`B-${type}-${date}`,snap=`S-${type}-${date}`;db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)`).run(snap,batch,date,'COMPLETED','{}',now);db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)`).run(batch,snap,date,'worker.xlsx',`${type}-${date}`,'VALID','{}','[]',now);db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(batch,snap,date,type,bill,'PP',type,type,'日报',1,'V329','{}',now);};
addUnified('2026-07-01','TBKH','TBKH-W1');addUnified('2026-07-13','SHOPEECN','CN-W1');
db.prepare(`INSERT INTO final_rows(shipmentCode,reportDate,sourceType,isPod,category,primaryCategory,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)`).run('TBKH-W1','2026-07-01','TBKH',1,'POD','POD','{}',now,now);
db.prepare(`INSERT INTO track_events(shipmentCode,reportDate,eventCode,eventTime,rawJson,createdAt) VALUES(?,?,?,?,?,?)`).run('TBKH-W1','2026-07-01','70','2026-07-01 09:00:00','{}',now);db.prepare(`INSERT INTO track_events(shipmentCode,reportDate,eventCode,eventTime,rawJson,createdAt) VALUES(?,?,?,?,?,?)`).run('TBKH-W1','2026-07-01','80','2026-07-01 18:00:00','{}',now);
db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,recipient_group,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)`).run('SHOPEE','CN-W1','2026-07-13',1,'POD','CN','{}',now,now);
db.prepare(`INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES(?,?,?,?,?,?,?)`).run('SHOPEE','CN-W1','2026-07-13','2026-07-13 09:00:00','70','{}',now);db.prepare(`INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES(?,?,?,?,?,?,?)`).run('SHOPEE','CN-W1','2026-07-13','2026-07-13 18:00:00','80','{}',now);
closeDb();
for(const [type,to] of [['TBKH','2026-07-01'],['SHOPEECN','2026-07-13']])execFileSync(process.execPath,['scripts/v329-three-business-cache-worker.mjs',`--type=${type}`,`--to=${to}`],{cwd:process.cwd(),env,stdio:'pipe',timeout:30000});
db=getDb();
for(const [type,date] of [['TBKH','2026-07-01'],['SHOPEECN','2026-07-13']]){
  const legacy=db.prepare(`SELECT * FROM v328_attempt_daily_cache WHERE businessType=? AND reportDate=?`).get(type,date);assert.ok(legacy,`${type} compatibility attempt cache missing`);assert.equal(Number(legacy.total),1);assert.equal(Number(legacy.pod),1);assert.equal(Number(legacy.attempt1),1);assert.equal(Number(legacy.signingDaysCount),1);assert.equal(Number(legacy.signingDaysSum),1);
  const canonical=db.prepare(`SELECT * FROM v329_three_business_daily_cache WHERE businessType=? AND reportDate=?`).get(type,date);assert.ok(canonical,`${type} canonical history cache missing`);assert.equal(Number(canonical.total),1);assert.equal(Number(canonical.pod),1);assert.equal(Number(canonical.attempt1),1);
  const ledger=db.prepare(`SELECT podDate,attemptNo,attemptSource FROM qc_tracking_ledger WHERE businessType=? AND shipmentCode=?`).get(type,type==='TBKH'?'TBKH-W1':'CN-W1');assert.equal(ledger.podDate,date);assert.equal(Number(ledger.attemptNo),1);assert.match(String(ledger.attemptSource),/严格|V246_STRICT_TRACK|轨迹70/);
}
const source=fs.readFileSync('scripts/v329-three-business-cache-worker.mjs','utf8');assert.match(source,/THREE_BUSINESS_HISTORY_WORKER_ID='2026-09-02-single-process-three-business-history-worker-v1'/);assert.doesNotMatch(source,/fork\(|v328-three-business-evidence-worker/,'canonical history worker must not spawn a second legacy evidence worker');
closeDb();fs.rmSync(root,{recursive:true,force:true});
console.log('[V329] single-process history worker runtime smoke passed · TBKH + SHOPEE CN saved 70→80 events produce attempt1 + real same-day signing=1 · canonical + compatibility caches written without nested worker');
