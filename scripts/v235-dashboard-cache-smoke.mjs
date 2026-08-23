import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v240-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'v240-smoke.db');
process.env.SQLITE_MMAP_BYTES = '0';
process.env.SQLITE_CACHE_KIB = '8192';
process.env.SQLITE_TEMP_STORE = 'FILE';
process.env.ACCESS_MODE = 'LOCAL';

const { getDb, closeDb } = await import('../src/db.js');
const { refreshV235CurrentDashboardCacheDate, normalizedDashboardCoverageReady, V235_DASHBOARD_CURRENT_CACHE_ID } = await import('../src/v235DashboardCurrentCache.js');
const { readV236CurrentSummary, V236_DASHBOARD_CURRENT_READ_ID } = await import('../src/v236DashboardCurrentRead.js');
const { readV237DashboardTrends, V237_DASHBOARD_TREND_READ_ID } = await import('../src/v237DashboardTrendRead.js');
const db = getDb();
const date = '2026-08-21';
const snapshotId = 'V240-SNAPSHOT-1';
const batchId = 'V240-BATCH-1';
const now = '2026-08-21T23:00:00.000Z';

// Reproduce the formal-db situation where normalized result coverage is already
// complete while the snapshot status flag has not yet caught up to COMPLETED.
db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)')
  .run(snapshotId,batchId,date,'PROCESSING','{}',now);
db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(batchId,snapshotId,date,'v240-smoke.xlsx','hash-v240','VALID','{}','[]',now);

const insertImport = db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const [type,bill,region] of [
  ['CE','C1','PP'],['CEAF','A1','PP'],['TBKH','T1','PV'],['ALI1688','L1','PP'],
  ['SHOPEECN','N1','PP'],['SHOPEECN','N2','PV'],['SHOPEECN','N3','PV'],
  ['SHOPEEVN','V1','PP'],['SHOPEEVN','V2','PV']
]) insertImport.run(batchId,snapshotId,date,type,bill,region,type,type,'日报',1,'SMOKE','{}',now);

const insertCcsl = db.prepare(`INSERT INTO final_rows(shipmentCode,reportDate,isPod,category,primaryCategory,pendingDays,ocDays,cycleCountDays,deliveringDays,rawJson,createdAt,updatedAt)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
insertCcsl.run('C1',date,1,'POD闭环','POD闭环',5,4,3,2,JSON.stringify({'Pending连续性':'不连续','POD时间':'2026-08-21 12:00:00'}),now,now);
insertCcsl.run('A1',date,1,'POD闭环','POD闭环',0,0,0,0,JSON.stringify({'POD时间':'2026-08-20 12:00:00'}),now,now);
insertCcsl.run('T1',date,0,'Pending','Pending',2,0,0,0,JSON.stringify({'Pending连续性':'连续'}),now,now);
insertCcsl.run('L1',date,0,'退回','退回',3,3,3,2,JSON.stringify({'退回状态':'已退回','Pending连续性':'不连续'}),now,now);

const insertShopee = db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,rawJson,createdAt,updatedAt,podAttemptNo)
  VALUES('SHOPEE',?,?,?,?,?,?,?,?)`);
insertShopee.run('N1',date,1,'POD',JSON.stringify({podAttemptNo:1,'POD时间':'2026-08-21 13:00:00','Pending次数':3,'OC天数':3,'盘点天数':3,'派送中停留天数':2}),now,now,1);
insertShopee.run('N2',date,0,'Pending',JSON.stringify({'Pending次数':5,'OC天数':5,'盘点天数':5,'派送中停留天数':5,events:[{trackingEventDescZh:'Pending\t异常滞留:1203--派送异常:'}]}),now,now,0);
insertShopee.run('N3',date,0,'Pending',JSON.stringify({'Pending次数':2,'Pending当前次数':2}),now,now,0);
insertShopee.run('V1',date,1,'POD',JSON.stringify({podAttemptNo:2,'POD时间':'2026-08-20 18:00:00','Pending次数':4,'OC天数':4}),now,now,2);
insertShopee.run('V2',date,0,'OC',JSON.stringify({'Pending次数':0,'OC天数':1,'派送中停留天数':0,'当前状态':'OC'}),now,now,0);

const batch = { snapshotId, reportDate: date, snapshotStatus: 'PROCESSING' };
assert.equal(normalizedDashboardCoverageReady(batch),true,'full normalized coverage must be usable even if snapshot status flag is stale');

const before = readV236CurrentSummary(date);
assert.equal(before.readId,V236_DASHBOARD_CURRENT_READ_ID);
assert.equal(before.readSource,'DIRECT_NORMALIZED_FULL_COVERAGE');
assert.equal(before.readyBusinessCount,6,'all six unified-import businesses must be display-ready before cache warm');
assert.deepEqual({total:before.business.SHOPEECN.total,pod:before.business.SHOPEECN.pod,returned:before.business.SHOPEECN.returned,unresolved:before.business.SHOPEECN.unresolved},{total:3,pod:1,returned:1,unresolved:1});
assert.equal(before.business.SHOPEECN.pending1,1,'POD and 1203-return historical Pending must not remain current Pending');
assert.equal(before.business.SHOPEECN.oc1,0,'POD and 1203-return historical OC must not remain current OC');
assert.equal(before.business.SHOPEECN.cycle2,0,'1203-return historical cycle must not remain current cycle');
assert.deepEqual({pp:before.business.SHOPEECN.regions.PP.total,pv:before.business.SHOPEECN.regions.PV.total,pvReturn:before.business.SHOPEECN.regions.PV.returned},{pp:1,pv:2,pvReturn:1});
assert.equal(before.business.SHOPEEVN.pending1,0,'POD historical Pending must not remain current Pending');
assert.equal(before.business.SHOPEEVN.oc1,1,'only active VN OC remains');
assert.equal(before.business.CE.pending1,0,'CCSL POD historical Pending must not remain current Pending');
assert.equal(before.business.ALI1688.returned,1);
assert.equal(before.business.ALI1688.pending1,0,'CCSL returned shipment must not remain current Pending');
assert.equal(before.business.CE.sameDayPod,1,'same-day POD must count only POD completed on the report date');
assert.equal(before.business.CE.firstDayPodRate,100,'single CE row POD on report date must be 100% first-day POD');
assert.equal(before.business.CEAF.sameDayPod,0,'POD completed before report date must not count as first-day POD');
assert.equal(before.business.SHOPEECN.sameDayPod,1,'SHOPEE same-day POD evidence must be read from POD time');
assert.equal(before.business.SHOPEEVN.sameDayPod,0,'SHOPEE POD from prior day must not count as first-day POD');
assert.equal(before.business.SHOPEEVN.ocCurrent,1,'daily OC must represent currently-OC shipments, not a generic OC1+ label');
assert.equal(before.business.SHOPEEVN.ocRate,50,'one current OC out of two daily VN tickets must be 50%');

// Live trends are cache-only: the browser never scans seven historical dates.
const trendBefore = readV237DashboardTrends('SHOPEECN',date,date);
assert.equal(trendBefore.readId,V237_DASHBOARD_TREND_READ_ID);
assert.deepEqual(trendBefore.dates,[date]);
assert.deepEqual(trendBefore.missingDates,[date]);
assert.equal(trendBefore.ticket[0],null,'missing trend cache must be a dash/null, never a fabricated zero');

const first = refreshV235CurrentDashboardCacheDate(date,{force:true});
assert.equal(first.ok,true);
assert.equal(first.refreshed,true);
assert.equal(first.readyTypes,6,'readyTypes tracks the six unified-import businesses');
assert.equal(first.cacheId,V235_DASHBOARD_CURRENT_CACHE_ID);

const rows = db.prepare("SELECT businessType,regionCode,metricsJson,snapshotId,snapshotStatus FROM dashboard_daily_cache WHERE reportDate=? ORDER BY businessType,regionCode").all(date);
const cachedTypes = new Set(rows.map(row=>row.businessType));
assert.equal(cachedTypes.size,7,'trend cache must include six unified-import businesses plus WHPP');
for (const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']) assert.ok(cachedTypes.has(type),`trend cache missing ${type}`);
assert.ok(rows.every(row=>row.snapshotId===snapshotId&&row.snapshotStatus==='COMPLETED'),'cache must bind to exact latest snapshot membership');
const metrics = type => rows.filter(row=>row.businessType===type).reduce((out,row)=>{
  const m=JSON.parse(row.metricsJson||'{}');
  for(const [key,value] of Object.entries(m)) if(Number.isFinite(Number(value))) out[key]=(out[key]||0)+Number(value);
  return out;
},{});
assert.deepEqual({total:metrics('CEAF').total,pod:metrics('CEAF').pod},{total:1,pod:1});
assert.equal(metrics('TBKH').pending1,1);
assert.deepEqual({total:metrics('SHOPEECN').total,pod:metrics('SHOPEECN').pod,returned:metrics('SHOPEECN').returned,pending1:metrics('SHOPEECN').pending1,oc1:metrics('SHOPEECN').oc1,sameDayPod:metrics('SHOPEECN').sameDayPod},{total:3,pod:1,returned:1,pending1:1,oc1:0,sameDayPod:1});
assert.deepEqual({total:metrics('SHOPEEVN').total,pod:metrics('SHOPEEVN').pod,pending1:metrics('SHOPEEVN').pending1,ocCurrent:metrics('SHOPEEVN').ocCurrent,sameDayPod:metrics('SHOPEEVN').sameDayPod},{total:2,pod:1,pending1:0,ocCurrent:1,sameDayPod:0});
assert.deepEqual({total:metrics('WHPP').total,pod:metrics('WHPP').pod,sameDayPod:metrics('WHPP').sameDayPod},{total:0,pod:0,sameDayPod:0},'WHPP must still get a valid zero cache row when no WHPP fixture rows exist');

const trendAfter = readV237DashboardTrends('SHOPEECN',date,date);
assert.deepEqual(trendAfter.missingDates,[]);
assert.deepEqual({date:trendAfter.daily[0].reportDate,total:trendAfter.daily[0].total,pod:trendAfter.daily[0].pod,returned:trendAfter.daily[0].returned,pending1:trendAfter.daily[0].pending1,sameDayPod:trendAfter.daily[0].sameDayPod},{date,total:3,pod:1,returned:1,pending1:1,sameDayPod:1});
assert.equal(trendAfter.ticket[0],3);
assert.equal(trendAfter.podRate[0],33.33);
assert.equal(trendAfter.ocRate[0],0);
assert.equal(trendAfter.firstRate[0],33.33,'first-day POD rate must use total daily tickets as denominator');

const vnTrend = readV237DashboardTrends('SHOPEEVN',date,date);
assert.equal(vnTrend.ocRate[0],50,'daily OC trend must use current OC / daily total');
assert.equal(vnTrend.firstRate[0],0,'prior-day POD must not count as first-day POD for the report date');

const second = refreshV235CurrentDashboardCacheDate(date,{force:false});
assert.equal(second.reason,'CURRENT_CACHE_READY');
assert.equal(second.readyTypes,6);

closeDb();
fs.rmSync(tempRoot,{recursive:true,force:true});
console.log(`[V240] daily total + POD rate + current-OC rate + first-day POD rate + seven-type trend cache smoke passed · ${V235_DASHBOARD_CURRENT_CACHE_ID}`);
