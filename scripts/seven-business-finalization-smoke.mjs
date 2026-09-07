import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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
  getDb().prepare(sql).run(...cols.map(c=>data[c]));
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

  const {readV449WhppZeroTicketStatusAuthority}=await import('../src/v441StatusSidecarSupervisor.js');
  const zeroStatusClaim=readV449WhppZeroTicketStatusAuthority(getDb(),{reportDate:zero.reportDate,snapshotId:zero.snapshotId});
  assert.equal(zeroStatusClaim?.claimSource,'UNIFIED_ZERO_TICKET_COMPLETED','5180 must honor the exact selected COMPLETED unified snapshot for a true zero-WHPP day');
  assert.equal(zeroStatusClaim?.expected,0);
  const nonZeroStatusClaim=readV449WhppZeroTicketStatusAuthority(getDb(),{reportDate:saved.reportDate,snapshotId:saved.snapshotId});
  assert.equal(nonZeroStatusClaim,null,'5180 zero-ticket authority must never close a non-zero WHPP cohort');
  const wrongSnapshotClaim=readV449WhppZeroTicketStatusAuthority(getDb(),{reportDate:zero.reportDate,snapshotId:'OLD-OR-WRONG-SNAPSHOT'});
  assert.equal(wrongSnapshotClaim,null,'5180 zero-ticket authority must never cross the exact selected snapshot boundary');

  const historyWorker=fs.readFileSync('scripts/v329-three-business-cache-worker.mjs','utf8');
  assert.match(historyWorker,/THREE_BUSINESS_HISTORY_WORKER_ID='2026-09-02-single-process-three-business-history-worker-v1'/,'three-business history must have one canonical worker');
  assert.match(historyWorker,/CE_QC_HISTORY_NETWORK_REPAIR/,'historical trajectory network repair must be explicit opt-in');
  assert.match(historyWorker,/缺少历史START\/POD证据，保持未知，不自动请求CE接口/,'missing historical evidence must stay unknown rather than silently querying CE');
  assert.doesNotMatch(historyWorker,/fork\(|v328-three-business-evidence-worker/,'finalization path must not restore a nested historical evidence worker');
  const cacheWorker=fs.readFileSync('src/dashboardCacheWorker.js','utf8');
  assert.match(cacheWorker,/PERSISTED_CACHE_STARTUP_READ_ONLY/,'normal startup must read persisted dashboard cache');
  assert.doesNotMatch(cacheWorker,/recentCompletedDashboardDates\(7\)/,'normal startup must not rebuild recent seven dates');

  for(const file of ['src/localStatusSidecar.js','src/v441StatusSidecarSupervisor.js','public/v169-seven-business-legacy-status-sync.js','src/v44WhppUiPatch.js','src/v322WebAvailabilityPatch.js']){
    execFileSync(process.execPath,['--check',file],{stdio:'pipe',env:{...process.env,NODE_ENV:'test'}});
  }
  const statusSidecar=fs.readFileSync('src/localStatusSidecar.js','utf8');
  const statusSupervisor=fs.readFileSync('src/v441StatusSidecarSupervisor.js','utf8');
  const statusUi=fs.readFileSync('public/v169-seven-business-legacy-status-sync.js','utf8');
  const statusOwner=fs.readFileSync('src/v322WebAvailabilityPatch.js','utf8');
  const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');
  assert.match(statusSidecar,/2026-09-07-v441-isolated-readonly-status-sidecar-v1/);
  assert.match(statusSidecar,/new DatabaseSync\(file,\{readOnly:true\}\)/,'status sidecar must open production SQLite read-only');
  assert.match(statusSidecar,/PRAGMA query_only=ON/,'status sidecar must enforce query_only');
  assert.doesNotMatch(statusSidecar,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\s+(?:INTO|FROM|[a-z_])/i,'isolated status sidecar must not write business state');
  assert.match(statusSupervisor,/CE_QC_STATUS_SIDECAR_CHILD/);
  assert.match(statusSupervisor,/localStatusSidecar\.js/);
  assert.match(statusSupervisor,/2026-09-07-v442-whpp-finalized-daily-status-parity-v1/,'V442 must be the active 5180 WHPP completion parity owner');
  assert.match(statusSupervisor,/business_export_snapshots/,'V442 must accept finalized WHPP snapshot authority without requiring a surviving run lock');
  assert.match(statusSupervisor,/business_daily_reports/,'V442 must preserve attested legacy finalized WHPP daily authority');
  assert.match(statusSupervisor,/readV418BusinessSuccessCoverage/,'V442 completion still requires exact current-member SUCCESS coverage');
  assert.match(statusSupervisor,/new DatabaseSync\(file,\{readOnly:true\}\)/,'V442 status process must remain read-only');
  assert.match(statusSupervisor,/PRAGMA query_only=ON/,'V442 status process must enforce query_only');
  assert.doesNotMatch(statusSupervisor,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\s+(?:INTO|FROM|[a-z_])/i,'V442 status parity must not write business state');
  assert.match(statusSupervisor,/2026-09-07-v449-5180-zero-ticket-exact-unified-completion-v1/,'V449 exact zero-ticket authority must be delivered by the visible 5180 owner');
  assert.match(statusSupervisor,/SELECT status FROM unified_snapshots WHERE snapshotId=\? AND reportDate=\? LIMIT 1/,'V449 must bind completion to the exact selected unified snapshot and date');
  assert.match(statusSupervisor,/COUNT\(DISTINCT UPPER\(TRIM\(shipmentCode\)\)\) count FROM unified_import_rows/,'V449 must prove the exact selected unified cohort has zero WHPP members');
  assert.match(statusSupervisor,/if\(text\(latest\?\.snapshotId\)!==id\)return null/,'V449 must reject a stale/non-selected unified snapshot');
  assert.match(statusOwner,/2026-09-07-v445-whpp-zero-ticket-exact-unified-completion-v1/,'V445 zero-ticket WHPP authority must be present in the canonical V322 status owner');
  assert.match(statusOwner,/if\(n\(counts\.WHPP\)===0&&\(whppMembershipOk\|\|unifiedClaim\)\)WHPP=completedStage\(WHPP,snapshotId,unifiedClaim\?'UNIFIED_ZERO_TICKET_COMPLETED':'ZERO_TICKET'\)/,'a zero-ticket WHPP day may inherit completion only from the exact selected unified COMPLETED snapshot when legacy daily membership is inconsistent');
  assert.match(statusOwner,/function unifiedCompletionClaim\(db,batch\)[\s\S]*WHERE snapshotId=\? AND reportDate=\?/,'V445 zero-ticket authority must stay bound to the exact selected snapshot and date');
  assert.match(statusUi,/STATUS_SIDECAR_PORT=5180/);
  assert.match(statusUi,/\/api\/local-status\/run-progress/);
  assert.match(statusUi,/event\.stopImmediatePropagation\(\)/,'unconfirmed Start click must be blocked at capture phase');
  assert.match(statusUi,/btn\.disabled=true/,'unconfirmed Start must stay DOM-disabled');
  assert.match(shell,/v441StatusSidecarSupervisor\.js/);
  assert.match(shell,/v169-seven-business-legacy-status-sync\.js\?v=20260907-v441-1/);
  assert.match(shell,/X-CE-QC-V441-Status-Sidecar/);

  console.log('[SEVEN-BUSINESS-FINALIZATION] passed · SHOPEE defers non-zero WHPP without INVALID · exact WHPP finalization closes all 7 · zero-WHPP completes directly · V445/V449 exact selected unified COMPLETED snapshot restores zero-ticket WHPP in both canonical 5177 and visible 5180 status owners · V449 rejects non-zero and wrong-snapshot claims · dashboard cache requires 7/7 · completed history is persisted-read/no implicit CE re-query · one canonical history worker · V441 local/LAN status is read-only isolated on 5180 and unconfirmed Start is fail-closed at DOM+click entry · V442/V444 preserve finalized non-zero WHPP authority');
} finally {
  try{closeDb();}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}
