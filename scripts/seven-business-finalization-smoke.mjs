import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-seven-final-'));
Object.assign(process.env,{
  DATA_DIR:root,
  DB_FILE:path.join(root,'seven-final.db'),
  ACCESS_MODE:'LOCAL',
  SQLITE_MMAP_BYTES:'0',
  SQLITE_CACHE_KIB:'8192',
  NODE_ENV:'test',
  CI:'1'
});

const {getDb,closeDb}=await import('../src/db.js');
const {saveUnifiedImport,completeUnifiedSnapshot}=await import('../src/unifiedImportStore.js');
const {normalizedDashboardCoverageReady,refreshV235CurrentDashboardCacheDate}=await import('../src/v235DashboardCurrentCache.js');

const BUSINESS_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const now='2026-09-02T00:00:00.000Z';
function sourceRecon(counts){const total=BUSINESS_TYPES.reduce((s,t)=>s+Number(counts[t]||0),0);return{businessTypes:[...BUSINESS_TYPES],validUniqueWaybills:total,classifiedWaybills:total,difference:0,balanced:true};}
function parsed(reportDate,counts){
  const rows=[];let seq=0;
  for(const type of BUSINESS_TYPES){for(let i=0;i<Number(counts[type]||0);i++){seq++;rows.push({reportDate,businessType:type,shipmentCode:`${type}-${reportDate}-${i+1}`,regionCode:i%2?'PV':'PP',recipientRaw:type,recipientNormalized:type,sheetName:'日报',rowNumber:seq,classificationReason:'SEVEN_FINAL_SMOKE',classificationSource:'TEST',classificationMatchedValue:type,classificationWarning:''});}}
  const classificationCounts=Object.fromEntries(BUSINESS_TYPES.map(type=>[type,Number(counts[type]||0)]));
  const sourceReconciliation=sourceRecon(classificationCounts);
  return{reportDate,dateDetectionSource:'TEST',dateCandidates:[reportDate],dateConflict:false,containerFormat:'xlsx',classificationCounts,sourceReconciliation,regionCounts:{},summary:{validUniqueWaybills:rows.length,totalUnique:rows.length},sheetDiagnostics:[],warnings:[],rows,fileHash:`hash-${reportDate}-${rows.length}`};
}
function familyRows(saved,types){
  const set=new Set(types);return getDb().prepare('SELECT shipmentCode,businessType FROM unified_import_rows WHERE snapshotId=? ORDER BY rowid').all(saved.snapshotId).filter(r=>set.has(r.businessType)).map(r=>({shipmentCode:r.shipmentCode,reportDate:saved.reportDate,businessType:r.businessType,currentState:'OPEN',primaryCategory:'正常'}));
}
function snapshot(id,reportDate,rows,sourceSnapshotId=''){return{snapshotId:id,status:'VALID',reconciliationStatus:'COMPLETED',createdAt:now,state:{reportDate,sourceSnapshotId,finalRows:rows},view:{metrics:{}}};}
function insertMinimal(table,values){
  const db=getDb(),info=db.prepare(`PRAGMA table_info(${table})`).all(),known=new Map(info.map(c=>[c.name,c])),data={};
  for(const [key,value] of Object.entries(values))if(known.has(key))data[key]=value;
  for(const col of info){
    if(Object.hasOwn(data,col.name)||col.dflt_value!==null)continue;
    if(col.pk&&String(col.type||'').toUpperCase().includes('INT'))continue;
    if(!col.notnull&&!col.pk)continue;
    const t=String(col.type||'').toUpperCase();
    data[col.name]=/INT|REAL|NUM|DEC|BOOL/.test(t)?0:(/AT$|TIME|DATE/i.test(col.name)?now:'');
  }
  const cols=Object.keys(data);assert.ok(cols.length,`no insertable columns for ${table}`);
  const sql=`INSERT INTO ${table}(${cols.map(c=>`"${c}"`).join(',')}) VALUES(${cols.map(()=>'?').join(',')})`;
  db.prepare(sql).run(...cols.map(c=>data[c]));
}
function persistFacts(reportDate,rows){
  for(const row of rows){
    if(['CE','CEAF','TBKH','ALI1688'].includes(row.businessType))insertMinimal('final_rows',{shipmentCode:row.shipmentCode,reportDate,isPod:0,primaryCategory:'正常',category:'正常',rawJson:'{}',lastEventTime:'',createdAt:now,updatedAt:now});
    else insertMinimal('business_final_rows',{businessType:row.businessType==='WHPP'?'WHPP':'SHOPEE',shipmentCode:row.shipmentCode,reportDate,isPod:0,primaryCategory:'正常',rawJson:'{}',latestEventTime:'',createdAt:now,updatedAt:now});
  }
}

try{
  const counts={CE:2,CEAF:1,TBKH:1,ALI1688:1,SHOPEECN:2,SHOPEEVN:1,WHPP:2};
  const saved=saveUnifiedImport(parsed('2026-08-30',counts),'8-30.xls');
  const ccslRows=familyRows(saved,['CE','CEAF','TBKH','ALI1688']);
  const shopeeRows=familyRows(saved,['SHOPEECN','SHOPEEVN']);
  const whppRows=familyRows(saved,['WHPP']);
  const ccsl=snapshot('CCSL-SNAP','2026-08-30',ccslRows,saved.snapshotId);
  const shopee=snapshot('SHOPEE-SNAP','2026-08-30',shopeeRows,saved.snapshotId);

  const afterShopee=completeUnifiedSnapshot({reportDate:'2026-08-30',ccslSnapshot:ccsl,shopeeSnapshot:shopee});
  assert.equal(afterShopee.deferred,true,'Shopee completion must wait for non-zero WHPP instead of failing the unified lifecycle');
  assert.equal(afterShopee.status,'WAITING_WHPP');
  assert.equal(afterShopee.expectedWhpp,2);
  let unified=getDb().prepare('SELECT status,payloadJson FROM unified_snapshots WHERE snapshotId=?').get(saved.snapshotId);
  assert.equal(unified.status,'IMPORTED','deferred seven-business lifecycle must remain resumable, not INVALID');
  let payload=JSON.parse(unified.payloadJson||'{}');
  assert.equal(payload.validationStatus,'PENDING_WHPP');
  assert.equal(payload.reconciliation?.expectedCounts?.WHPP,2);

  persistFacts('2026-08-30',[...ccslRows,...shopeeRows]);
  const batch={snapshotId:saved.snapshotId,reportDate:saved.reportDate};
  assert.equal(normalizedDashboardCoverageReady(batch),false,'dashboard cache must refuse six-business facts while WHPP is still missing');
  const earlyCache=refreshV235CurrentDashboardCacheDate('2026-08-30',{force:true});
  assert.equal(earlyCache.skipped,true);
  assert.equal(earlyCache.reason,'LATEST_VALID_SEVEN_BUSINESS_FACTS_NOT_READY');

  persistFacts('2026-08-30',whppRows);
  assert.equal(normalizedDashboardCoverageReady(batch),true,'dashboard cache becomes eligible only after exact WHPP facts are persisted');
  const whpp=snapshot('WHPP-FINAL-SNAP','2026-08-30',whppRows,saved.snapshotId);
  const completed=completeUnifiedSnapshot({reportDate:'2026-08-30',ccslSnapshot:ccsl,shopeeSnapshot:shopee,whppSnapshot:whpp});
  assert.equal(completed.deferred,false);
  assert.equal(completed.status,'COMPLETED');
  assert.equal(completed.reconciliation.passed,true);
  assert.deepEqual(completed.reconciliation.expectedCounts,counts);
  assert.deepEqual(completed.reconciliation.actualCounts,counts);
  unified=getDb().prepare('SELECT status,payloadJson FROM unified_snapshots WHERE snapshotId=?').get(saved.snapshotId);
  assert.equal(unified.status,'COMPLETED');
  payload=JSON.parse(unified.payloadJson||'{}');
  assert.equal(payload.sourceSnapshots.WHPP,'WHPP-FINAL-SNAP');
  assert.equal(payload.finalRows.length,Object.values(counts).reduce((a,b)=>a+b,0));
  const cache=refreshV235CurrentDashboardCacheDate('2026-08-30',{force:true});
  assert.equal(cache.ok,true);assert.equal(cache.readyTypes,7);
  const cachedTypes=getDb().prepare("SELECT DISTINCT businessType FROM dashboard_daily_cache WHERE reportDate=? AND snapshotStatus='COMPLETED' ORDER BY businessType").all('2026-08-30').map(r=>r.businessType);
  assert.deepEqual(cachedTypes.sort(),[...BUSINESS_TYPES].sort());

  const zeroCounts={CE:1,CEAF:0,TBKH:1,ALI1688:0,SHOPEECN:1,SHOPEEVN:0,WHPP:0};
  const zero=saveUnifiedImport(parsed('2026-08-31',zeroCounts),'8-31.xls');
  const zeroCcsl=familyRows(zero,['CE','CEAF','TBKH','ALI1688']);
  const zeroShopee=familyRows(zero,['SHOPEECN','SHOPEEVN']);
  const zeroDone=completeUnifiedSnapshot({reportDate:'2026-08-31',ccslSnapshot:snapshot('CCSL-ZERO','2026-08-31',zeroCcsl,zero.snapshotId),shopeeSnapshot:snapshot('SHOPEE-ZERO','2026-08-31',zeroShopee,zero.snapshotId)});
  assert.equal(zeroDone.status,'COMPLETED','true zero-WHPP day must complete without manufacturing a WHPP run');
  assert.equal(zeroDone.reconciliation.expectedCounts.WHPP,0);
  assert.equal(zeroDone.reconciliation.actualCounts.WHPP,0);

  const historyWorker=fs.readFileSync('scripts/v328-three-business-evidence-worker-v2.mjs','utf8');
  assert.match(historyWorker,/CE_QC_HISTORY_NETWORK_REPAIR/,'historical trajectory network repair must be explicit opt-in');
  assert.match(historyWorker,/缺少历史START\/POD证据，保持未知，不自动请求CE接口/,'missing historical evidence must stay unknown rather than silently querying CE');
  const cacheWorker=fs.readFileSync('src/dashboardCacheWorker.js','utf8');
  assert.match(cacheWorker,/PERSISTED_CACHE_STARTUP_READ_ONLY/,'normal startup must read persisted dashboard cache');
  assert.doesNotMatch(cacheWorker,/recentCompletedDashboardDates\(7\)/,'normal startup must not rebuild recent seven dates');

  console.log('[SEVEN-BUSINESS-FINALIZATION] passed · SHOPEE defers non-zero WHPP without INVALID · exact WHPP finalization closes all 7 · zero-WHPP completes directly · dashboard cache requires 7/7 · completed history is persisted-read/no implicit CE re-query');
} finally {
  try{closeDb();}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}
