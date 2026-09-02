import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-seven-final-'));
process.env.DATA_DIR=root;process.env.DB_FILE=path.join(root,'seven.db');process.env.ACCESS_MODE='LOCAL';process.env.SQLITE_MMAP_BYTES='0';process.env.SQLITE_CACHE_KIB='8192';process.env.NODE_ENV='test';process.env.CE_QC_DISABLE_V246_TRACKING='1';

const {getDb,closeDb}=await import('../src/db.js');
const {saveUnifiedImport}=await import('../src/unifiedImportStore.js');
const {ensureWhppStore,saveWhppDailyMembers,getWhppDailyMembers}=await import('../src/whppStore.js');
const {ensureBusinessTables}=await import('../src/businessStore.js');
const {completeUnifiedSnapshot}=await import('../src/unifiedFinalizer.js');
const {refreshV235CurrentDashboardCacheDate}=await import('../src/v235DashboardCurrentCache.js');
const BUSINESS_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];

const parsed=(date,counts)=>{const rows=[];let i=0;for(const [businessType,count] of Object.entries(counts))for(let j=0;j<count;j++){const shipmentCode=`${businessType}-${date}-${++i}`;rows.push({reportDate:date,businessType,shipmentCode,recipientRaw:businessType,recipientNormalized:businessType,recipientGroup:businessType,regionCode:j%2?'PV':'PP',sheetName:'日报',rowNumber:i+1,classificationReason:'FINALIZATION_SMOKE',rowJson:{shipmentCode,businessType,regionCode:j%2?'PV':'PP'}});}return{reportDate:date,rows,rawRows:rows.length,summary:{validUniqueWaybills:rows.length,businessCounts:counts},sourceMeta:{fixture:true}};};
const familyRows=(saved,types)=>saved.rows.filter(r=>types.includes(r.businessType));
const snapshot=(id,date,rows,sourceSnapshotId)=>({snapshotId:id,reportDate:date,status:'VALID',reconciliationStatus:'COMPLETED',sourceSnapshotId,state:{reportDate:date,sourceSnapshotId,finalRows:rows.map(r=>({shipmentCode:r.shipmentCode,运单号:r.shipmentCode,businessType:r.businessType,业务板块:r.businessType,regionCode:r.regionCode,是否POD:'否',primaryCategory:'OPEN'}))}});

try {
  ensureBusinessTables();ensureWhppStore();
  const counts={CE:2,CEAF:1,TBKH:1,ALI1688:1,SHOPEECN:2,SHOPEEVN:1,WHPP:2};
  const saved=saveUnifiedImport(parsed('2026-08-30',counts),'8-30.xls');
  const ccslRows=familyRows(saved,['CE','CEAF','TBKH','ALI1688']);
  const shopeeRows=familyRows(saved,['SHOPEECN','SHOPEEVN']);
  const whppRows=familyRows(saved,['WHPP']);
  const ccsl=snapshot('CCSL-FINAL-SNAP','2026-08-30',ccslRows,saved.snapshotId);
  const shopee=snapshot('SHOPEE-FINAL-SNAP','2026-08-30',shopeeRows,saved.snapshotId);
  const pending=completeUnifiedSnapshot({reportDate:'2026-08-30',ccslSnapshot:ccsl,shopeeSnapshot:shopee});
  assert.equal(pending.status,'WAITING_WHPP');assert.equal(pending.ready,false);assert.equal(pending.reconciliation.expectedCounts.WHPP,2);assert.equal(pending.reconciliation.actualCounts.WHPP,0);
  let unified=getDb().prepare('SELECT status,payloadJson FROM unified_snapshots WHERE snapshotId=?').get(saved.snapshotId);assert.equal(unified.status,'VALID','non-zero WHPP wait must not invalidate the source import');

  saveWhppDailyMembers({reportDate:'2026-08-30',sourceFile:'8-30.xls',sourceHash:'whpp-final-hash',members:whppRows.map(r=>({shipmentCode:r.shipmentCode,regionCode:r.regionCode,rowJson:r.rowJson}))});
  const whppMembers=getWhppDailyMembers('2026-08-30');assert.equal(whppMembers.length,2);
  const now='2026-08-30T20:00:00Z';const db=getDb();
  db.prepare(`INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,payloadJson,generatedAt,createdAt,status,reconciliationStatus,invalidReason,whitelistVersion,whitelistSha256,payloadHash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('WHPP-FINAL-SNAP','WHPP','2026-08-30','WHPP-RUN',JSON.stringify({snapshotId:'WHPP-FINAL-SNAP',businessType:'WHPP',reportDate:'2026-08-30',status:'VALID',reconciliationStatus:'COMPLETED',sourceSnapshotId:saved.snapshotId,state:{reportDate:'2026-08-30',sourceSnapshotId:saved.snapshotId,finalRows:whppRows.map(r=>({shipmentCode:r.shipmentCode,运单号:r.shipmentCode,businessType:'WHPP',业务板块:'WHPP',regionCode:r.regionCode,是否POD:'否',primaryCategory:'OPEN'}))}}),now,now,'VALID','COMPLETED','','','','');
  const completed=completeUnifiedSnapshot({reportDate:'2026-08-30',ccslSnapshot:ccsl,shopeeSnapshot:shopee,whppSnapshotId:'WHPP-FINAL-SNAP'});
  assert.equal(completed.status,'COMPLETED');assert.equal(completed.ready,true);assert.deepEqual(completed.reconciliation.expectedCounts,counts);assert.deepEqual(completed.reconciliation.actualCounts,counts);
  unified=getDb().prepare('SELECT status,payloadJson FROM unified_snapshots WHERE snapshotId=?').get(saved.snapshotId);assert.equal(unified.status,'COMPLETED');const payload=JSON.parse(unified.payloadJson||'{}');assert.equal(payload.sourceSnapshots.WHPP,'WHPP-FINAL-SNAP');assert.equal(payload.finalRows.length,Object.values(counts).reduce((a,b)=>a+b,0));
  const cache=refreshV235CurrentDashboardCacheDate('2026-08-30',{force:true});assert.equal(cache.ok,true);assert.equal(cache.readyTypes,7);const cachedTypes=getDb().prepare("SELECT DISTINCT businessType FROM dashboard_daily_cache WHERE reportDate=? AND snapshotStatus='COMPLETED' ORDER BY businessType").all('2026-08-30').map(r=>r.businessType);assert.deepEqual(cachedTypes.sort(),[...BUSINESS_TYPES].sort());

  const zeroCounts={CE:1,CEAF:0,TBKH:1,ALI1688:0,SHOPEECN:1,SHOPEEVN:0,WHPP:0};
  const zero=saveUnifiedImport(parsed('2026-08-31',zeroCounts),'8-31.xls');
  const zeroCcsl=familyRows(zero,['CE','CEAF','TBKH','ALI1688']);
  const zeroShopee=familyRows(zero,['SHOPEECN','SHOPEEVN']);
  const zeroDone=completeUnifiedSnapshot({reportDate:'2026-08-31',ccslSnapshot:snapshot('CCSL-ZERO','2026-08-31',zeroCcsl,zero.snapshotId),shopeeSnapshot:snapshot('SHOPEE-ZERO','2026-08-31',zeroShopee,zero.snapshotId)});
  assert.equal(zeroDone.status,'COMPLETED','true zero-WHPP day must complete without manufacturing a WHPP run');assert.equal(zeroDone.reconciliation.expectedCounts.WHPP,0);assert.equal(zeroDone.reconciliation.actualCounts.WHPP,0);

  const historyWorker=fs.readFileSync('scripts/v329-three-business-cache-worker.mjs','utf8');
  assert.match(historyWorker,/THREE_BUSINESS_HISTORY_WORKER_ID='2026-09-02-single-process-three-business-history-worker-v1'/,'three-business history must have one canonical worker');
  assert.match(historyWorker,/CE_QC_HISTORY_NETWORK_REPAIR/,'historical trajectory network repair must be explicit opt-in');
  assert.match(historyWorker,/缺少历史START\/POD证据，保持未知，不自动请求CE接口/,'missing historical evidence must stay unknown rather than silently querying CE');
  assert.doesNotMatch(historyWorker,/fork\(|v328-three-business-evidence-worker/,'finalization path must not restore a nested historical evidence worker');
  const cacheWorker=fs.readFileSync('src/dashboardCacheWorker.js','utf8');
  assert.match(cacheWorker,/PERSISTED_CACHE_STARTUP_READ_ONLY/,'normal startup must read persisted dashboard cache');assert.doesNotMatch(cacheWorker,/recentCompletedDashboardDates\(7\)/,'normal startup must not rebuild recent seven dates');

  console.log('[SEVEN-BUSINESS-FINALIZATION] passed · SHOPEE defers non-zero WHPP without INVALID · exact WHPP finalization closes all 7 · zero-WHPP completes directly · dashboard cache requires 7/7 · completed history is persisted-read/no implicit CE re-query · one canonical history worker');
} finally {
  try{closeDb();}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}