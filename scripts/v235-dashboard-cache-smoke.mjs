import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v235-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'v235-smoke.db');
process.env.SQLITE_MMAP_BYTES = '0';
process.env.SQLITE_CACHE_KIB = '8192';
process.env.SQLITE_TEMP_STORE = 'FILE';
process.env.ACCESS_MODE = 'LOCAL';

const { getDb, closeDb } = await import('../src/db.js');
const { refreshV235CurrentDashboardCacheDate, V235_DASHBOARD_CURRENT_CACHE_ID } = await import('../src/v235DashboardCurrentCache.js');
const { readV236CurrentSummary, V236_DASHBOARD_CURRENT_READ_ID } = await import('../src/v236DashboardCurrentRead.js');
const db = getDb();
const date = '2026-08-21';
const snapshotId = 'V235-SNAPSHOT-1';
const batchId = 'V235-BATCH-1';
const now = '2026-08-21T23:00:00.000Z';

db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)')
  .run(snapshotId,batchId,date,'COMPLETED','{}',now);
db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(batchId,snapshotId,date,'v235-smoke.xlsx','hash-v235','VALID','{}','[]',now);

const insertImport = db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const [type,bill,region] of [
  ['CE','C1','PP'],['CEAF','A1','PP'],['TBKH','T1','PV'],['ALI1688','L1','PP'],
  ['SHOPEECN','N1','PP'],['SHOPEECN','N2','PV'],['SHOPEEVN','V1','PP'],['SHOPEEVN','V2','PV']
]) insertImport.run(batchId,snapshotId,date,type,bill,region,type,type,'日报',1,'SMOKE','{}',now);

const insertCcsl = db.prepare(`INSERT INTO final_rows(shipmentCode,reportDate,isPod,category,primaryCategory,pendingDays,ocDays,cycleCountDays,deliveringDays,rawJson,createdAt,updatedAt)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
insertCcsl.run('C1',date,1,'POD闭环','POD闭环',0,0,0,0,'{}',now,now);
insertCcsl.run('A1',date,1,'POD闭环','POD闭环',0,0,0,0,'{}',now,now);
insertCcsl.run('T1',date,0,'Pending','Pending',1,0,0,0,JSON.stringify({'Pending连续性':'连续'}),now,now);
insertCcsl.run('L1',date,0,'派送中','派送中',0,0,0,1,'{}',now,now);

const insertShopee = db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,rawJson,createdAt,updatedAt,podAttemptNo)
  VALUES('SHOPEE',?,?,?,?,?,?,?,?)`);
insertShopee.run('N1',date,1,'POD',JSON.stringify({podAttemptNo:1}),now,now,1);
insertShopee.run('N2',date,0,'退回',JSON.stringify({'退回状态':'已退回'}),now,now,0);
insertShopee.run('V1',date,1,'POD',JSON.stringify({podAttemptNo:1}),now,now,1);
insertShopee.run('V2',date,0,'Pending',JSON.stringify({'Pending次数':1,'Pending当前次数':1}),now,now,0);

const before = readV236CurrentSummary(date);
assert.equal(before.readId,V236_DASHBOARD_CURRENT_READ_ID);
assert.equal(before.readyBusinessCount,0,'without cache the fresh reader must show imported totals but never fake all-open truth');
assert.equal(before.business.SHOPEECN.total,2);
assert.equal(before.business.SHOPEECN.ready,false);

const first = refreshV235CurrentDashboardCacheDate(date,{force:true});
assert.equal(first.ok,true);
assert.equal(first.refreshed,true);
assert.equal(first.readyTypes,6);
assert.equal(first.cacheId,V235_DASHBOARD_CURRENT_CACHE_ID);

const rows = db.prepare("SELECT businessType,regionCode,metricsJson,snapshotId,snapshotStatus FROM dashboard_daily_cache WHERE reportDate=? ORDER BY businessType,regionCode").all(date);
assert.equal(new Set(rows.map(row=>row.businessType)).size,6,'all six dashboard businesses must be cached, including CEAF');
assert.ok(rows.every(row=>row.snapshotId===snapshotId&&row.snapshotStatus==='COMPLETED'),'cache must bind to exact completed snapshot');
const metrics = type => rows.filter(row=>row.businessType===type).reduce((out,row)=>{
  const m=JSON.parse(row.metricsJson||'{}');
  for(const [key,value] of Object.entries(m)) if(Number.isFinite(Number(value))) out[key]=(out[key]||0)+Number(value);
  return out;
},{});
assert.deepEqual({total:metrics('CEAF').total,pod:metrics('CEAF').pod},{total:1,pod:1});
assert.equal(metrics('TBKH').pending1,1);
assert.deepEqual({total:metrics('SHOPEECN').total,pod:metrics('SHOPEECN').pod,returned:metrics('SHOPEECN').returned},{total:2,pod:1,returned:1});
assert.deepEqual({total:metrics('SHOPEEVN').total,pod:metrics('SHOPEEVN').pod,pending1:metrics('SHOPEEVN').pending1},{total:2,pod:1,pending1:1});

const live = readV236CurrentSummary(date);
assert.equal(live.readyBusinessCount,6);
assert.deepEqual({total:live.business.SHOPEECN.total,pod:live.business.SHOPEECN.pod,returned:live.business.SHOPEECN.returned,unresolved:live.business.SHOPEECN.unresolved},{total:2,pod:1,returned:1,unresolved:0});
assert.deepEqual({total:live.business.SHOPEEVN.total,pod:live.business.SHOPEEVN.pod,pending1:live.business.SHOPEEVN.pending1,unresolved:live.business.SHOPEEVN.unresolved},{total:2,pod:1,pending1:1,unresolved:1});
assert.equal(live.business.CEAF.podRate,100);
assert.equal(live.business.TBKH.pendingRate,100);

const second = refreshV235CurrentDashboardCacheDate(date,{force:false});
assert.equal(second.reason,'CURRENT_CACHE_READY');
assert.equal(second.readyTypes,6);

closeDb();
fs.rmSync(tempRoot,{recursive:true,force:true});
console.log(`[V235/V236] exact cache build + fresh current reader functional smoke passed · ${V235_DASHBOARD_CURRENT_CACHE_ID}`);
