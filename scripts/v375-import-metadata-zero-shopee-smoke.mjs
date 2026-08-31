import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v377-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'v377.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.NODE_ENV='test';
process.env.CE_QC_DISABLE_V246_TRACKING='1';

const {getDb,closeDb}=await import('../src/db.js');
const {saveUnifiedImport}=await import('../src/unifiedImportStore.js');
const {readV375LatestUnifiedImport,V375_UNIFIED_IMPORT_METADATA_ID,V377_UNIFIED_IMPORT_STATUS_TRUTH_ID}=await import('../src/v375UnifiedImportMetadataPatch.js');
const {inspectV311ShopeeRecovery,prepareV311ShopeeRecovery,V375_SHOPEE_ZERO_WORK_ID,V377_SHOPEE_IMPORT_LIFECYCLE_ID}=await import('../src/v311ShopeeIncompleteRecoveryPatch.js');
const {inspectV317CcslRecovery,prepareV317CcslRecovery,V377_CCSL_IMPORT_LIFECYCLE_ID}=await import('../src/v317CcslIncompleteRecoveryPatch.js');

const reportDate='2026-08-23';
const rows=[
  {shipmentCode:'V375-CE-PP',businessType:'CE',regionCode:'PP',recipientRaw:'A',recipientNormalized:'A',sheetName:'日报',rowNumber:2,classificationReason:'V375',classificationSource:'RECIPIENT',classificationMatchedValue:'CE'},
  {shipmentCode:'V375-CE-PV',businessType:'CE',regionCode:'PV',recipientRaw:'B',recipientNormalized:'B',sheetName:'日报',rowNumber:3,classificationReason:'V375',classificationSource:'RECIPIENT',classificationMatchedValue:'CE'},
  {shipmentCode:'V375-TBKH-PP',businessType:'TBKH',regionCode:'PP',recipientRaw:'TBKH',recipientNormalized:'TBKH',sheetName:'日报',rowNumber:4,classificationReason:'V375',classificationSource:'RECIPIENT',classificationMatchedValue:'TBKH'},
  {shipmentCode:'V375-WHPP-PV',businessType:'WHPP',regionCode:'PV',recipientRaw:'WHPP',recipientNormalized:'WHPP',sheetName:'日报',rowNumber:5,classificationReason:'V375',classificationSource:'PREFIX',classificationMatchedValue:'WHPP'}
];
const parsed={
  reportDate,dateDetectionSource:'文件名',dateCandidates:[{date:reportDate,count:4}],dateConflict:false,dateWasManuallyCorrected:false,containerFormat:'OLE_XLS',fileHash:'v375-file-hash',
  classificationCounts:{CE:2,CEAF:0,TBKH:1,ALI1688:0,SHOPEECN:0,SHOPEEVN:0,WHPP:1},
  sourceReconciliation:{balanced:true,validUniqueWaybills:4,classifiedWaybills:4,difference:0},regionCounts:{PP:2,PV:2,UNKNOWN:0},
  summary:{rawRows:4,validUniqueWaybills:4,duplicateRows:0,missingWaybillRows:0,missingRecipientWarnings:0,classificationConflicts:0},sheetDiagnostics:[{sheetName:'日报',rows:4}],warnings:[],rows
};
const saved=saveUnifiedImport(parsed,'8-23.xls');
const db=getDb();
// Reproduce the visible metadata regression: batch columns are blank while the
// exact snapshot and persisted member rows still contain the source truth.
db.prepare("UPDATE unified_import_batches SET dateDetectionSource='',dateCandidatesJson='[]',regionCountsJson='{}',summaryJson='{}' WHERE batchId=?").run(saved.batchId);

const hydrated=readV375LatestUnifiedImport(db);
assert.equal(hydrated.metadataHydrationId,V375_UNIFIED_IMPORT_METADATA_ID);
assert.equal(hydrated.statusTruthId,V377_UNIFIED_IMPORT_STATUS_TRUTH_ID);
assert.equal(hydrated.reportDate,reportDate);
assert.equal(hydrated.containerFormat,'OLE_XLS');
assert.equal(hydrated.dateDetectionSource,'文件名');
assert.deepEqual(hydrated.dateCandidates,[{date:reportDate,count:4}]);
assert.equal(hydrated.regionCounts.PP,2);
assert.equal(hydrated.regionCounts.PV,2);
assert.equal(hydrated.regionCounts.UNKNOWN,0);
assert.equal(hydrated.summary.rawRows,4);
assert.equal(hydrated.summary.validUniqueWaybills,4);
assert.equal(hydrated.sourceReconciliation.balanced,true);
assert.equal(Object.values(hydrated.classificationCounts).reduce((a,b)=>a+b,0),4);

const zeroShopee=inspectV311ShopeeRecovery({db,reportDate});
assert.equal(zeroShopee.complete,true);
assert.equal(zeroShopee.noWork,true);
assert.equal(zeroShopee.zeroTicketDay,true);
assert.equal(zeroShopee.needsResume,false);
assert.equal(zeroShopee.reason,'EXACT_ZERO_UNIFIED_SHOPEE_MEMBERSHIP');
assert.equal(zeroShopee.policyId,V375_SHOPEE_ZERO_WORK_ID);
assert.deepEqual({cn:zeroShopee.membership.SHOPEECN,vn:zeroShopee.membership.SHOPEEVN,total:zeroShopee.membership.total},{cn:0,vn:0,total:0});

// Both browser read paths must return the same hydrated snapshot truth.
const app=express();
app.get('/api/bootstrap',async(req,res)=>res.json({ok:true,unifiedImport:{reportDate,containerFormat:'',dateDetectionSource:'',regionCounts:{PP:0,PV:0},summary:{validUniqueWaybills:4}},state:{reportDate},shopeeState:{reportDate}}));
app.get('/api/import/unified-latest',(req,res)=>res.status(599).json({legacy:true}));
const server=app.listen(0,'127.0.0.1');
await once(server,'listening');
try{
  const port=server.address().port;
  const [bootstrapResponse,latestResponse]=await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/bootstrap`),
    fetch(`http://127.0.0.1:${port}/api/import/unified-latest?compact=1`)
  ]);
  const bootstrapPayload=await bootstrapResponse.json();
  const latestPayload=await latestResponse.json();
  assert.equal(bootstrapResponse.status,200);
  assert.equal(latestResponse.status,200);
  for(const item of [bootstrapPayload.unifiedImport,latestPayload.import]){
    assert.equal(item.metadataHydrationId,V375_UNIFIED_IMPORT_METADATA_ID);
    assert.equal(item.containerFormat,'OLE_XLS');
    assert.equal(item.dateDetectionSource,'文件名');
    assert.equal(item.regionCounts.PP,2);
    assert.equal(item.regionCounts.PV,2);
    assert.equal(item.summary.rawRows,4);
  }
  assert.deepEqual(bootstrapPayload.unifiedImport.classificationCounts,latestPayload.import.classificationCounts);
  assert.deepEqual(bootstrapPayload.unifiedImport.regionCounts,latestPayload.import.regionCounts);
}finally{await new Promise(resolve=>server.close(resolve));}

// Exact reproduction of the visible 08-24 lifecycle regression: a previous run
// for the same date says CCSL failed and SHOPEE finished, then a new VALID import
// for the same date arrives with real CN/VN membership. Old run pointers must not
// decide the new batch status or block creation of a new runId.
const d24='2026-08-24';
const d24Rows=[
  ['V377-CE','CE','PP'],['V377-CEAF','CEAF','PP'],['V377-TBKH','TBKH','PV'],['V377-ALI','ALI1688','PV'],
  ['V377-CN','SHOPEECN','PP'],['V377-VN','SHOPEEVN','PV'],['V377-WHPP','WHPP','PV']
].map(([shipmentCode,businessType,regionCode],index)=>({shipmentCode,businessType,regionCode,recipientRaw:businessType,recipientNormalized:businessType,sheetName:'日报',rowNumber:index+2,classificationReason:'V377',classificationSource:'V377',classificationMatchedValue:businessType}));
const parsed24={
  reportDate:d24,dateDetectionSource:'文件名',dateCandidates:[{date:d24,count:7}],dateConflict:false,dateWasManuallyCorrected:false,containerFormat:'OLE_XLS',fileHash:'v377-0824-file',
  classificationCounts:{CE:1,CEAF:1,TBKH:1,ALI1688:1,SHOPEECN:1,SHOPEEVN:1,WHPP:1},
  sourceReconciliation:{balanced:true,validUniqueWaybills:7,classifiedWaybills:7,difference:0},regionCounts:{PP:3,PV:4,UNKNOWN:0},
  summary:{rawRows:7,validUniqueWaybills:7,duplicateRows:0,missingWaybillRows:0,missingRecipientWarnings:0,classificationConflicts:0},sheetDiagnostics:[{sheetName:'日报',rows:7}],warnings:[],rows:d24Rows
};
const saved24=saveUnifiedImport(parsed24,'8-24.xls');
const boundary=String(db.prepare("SELECT createdAt FROM unified_import_batches WHERE batchId=?").get(saved24.batchId)?.createdAt||'');
assert.ok(boundary);
const oldAt='2026-08-30T00:00:00.000Z';

db.prepare(`INSERT INTO daily_reports(reportDate,sourceFile,fileHash,pnhCount,nonPnhCount,excludedCount,duplicateCount,totalUniqueCount,totalAppearCount,summaryJson,createdAt,updatedAt)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(reportDate) DO UPDATE SET pnhCount=excluded.pnhCount,updatedAt=excluded.updatedAt`).run(d24,'8-24.xls','v377',4,0,0,0,4,4,'{}',oldAt,oldAt);
db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt)
  VALUES(?,?,?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET totalCount=excluded.totalCount,updatedAt=excluded.updatedAt`).run('SHOPEE',d24,'8-24.xls',2,'{}',oldAt,oldAt);

db.prepare(`INSERT INTO run_locks(reportDate,runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedBy,lockedAt,completedAt,updatedAt)
  VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(reportDate) DO UPDATE SET runId=excluded.runId,status=excluded.status,currentStage=excluded.currentStage,errorMessage=excluded.errorMessage,lockedAt=excluded.lockedAt,updatedAt=excluded.updatedAt`).run(d24,'STALE-CCSL','failed','旧任务失败',1,1,'old failure','test',oldAt,oldAt,oldAt);
db.prepare(`INSERT INTO business_run_locks(businessType,reportDate,runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedBy,lockedAt,completedAt,updatedAt)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET runId=excluded.runId,status=excluded.status,currentStage=excluded.currentStage,lockedAt=excluded.lockedAt,completedAt=excluded.completedAt,updatedAt=excluded.updatedAt`).run('SHOPEE',d24,'STALE-SHOPEE','finished','完成',1,1,'','test',oldAt,oldAt,oldAt);
db.prepare(`INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,payloadJson,generatedAt,createdAt,status,reconciliationStatus,invalidReason,whitelistVersion,whitelistSha256,payloadHash)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('STALE-SHOPEE-SNAPSHOT','SHOPEE',d24,'STALE-SHOPEE','{}',oldAt,oldAt,'VALID','COMPLETED','','TEST','','stale-hash');

const ccslBefore=inspectV317CcslRecovery({db,reportDate:d24});
assert.equal(ccslBefore.lifecyclePolicy,V377_CCSL_IMPORT_LIFECYCLE_ID);
assert.equal(ccslBefore.sourceTotal,4);
assert.equal(ccslBefore.complete,false);
assert.equal(ccslBefore.staleLockIgnored,true);
assert.equal(ccslBefore.staleRunId,'STALE-CCSL');
assert.equal(ccslBefore.lock,null);
assert.notEqual(ccslBefore.action,'FAILED');

const shopeeBefore=inspectV311ShopeeRecovery({db,reportDate:d24});
assert.equal(shopeeBefore.lifecyclePolicy,V377_SHOPEE_IMPORT_LIFECYCLE_ID);
assert.equal(shopeeBefore.sourceTotal,2);
assert.equal(shopeeBefore.complete,false);
assert.equal(shopeeBefore.staleLockIgnored,true);
assert.equal(shopeeBefore.staleRunId,'STALE-SHOPEE');
assert.equal(shopeeBefore.lock,null);
assert.deepEqual({cn:shopeeBefore.membership.SHOPEECN,vn:shopeeBefore.membership.SHOPEEVN,total:shopeeBefore.membership.total},{cn:1,vn:1,total:2});

const latest24=readV375LatestUnifiedImport(db);
assert.equal(latest24.reportDate,d24);
assert.equal(latest24.summary.rawRows,7);
assert.equal(latest24.carryover.todayOpen,7);
assert.equal(latest24.carryover.historicalOpen,4);
assert.equal(latest24.carryover.currentOpen,11);
assert.equal(latest24.carryover.currentOpen,latest24.carryover.todayOpen+latest24.carryover.historicalOpen);

const ccslPrepared=prepareV317CcslRecovery({db,reportDate:d24,actor:'V377-SMOKE'});
assert.equal(ccslPrepared.prepared,true);
assert.ok(ccslPrepared.retiredStalePointers>=1);
assert.ok(ccslPrepared.lock?.runId);
assert.notEqual(ccslPrepared.lock.runId,'STALE-CCSL');
assert.equal(ccslPrepared.staleLockIgnored,false);
assert.equal(db.prepare("SELECT COUNT(*) count FROM run_locks WHERE reportDate=? AND runId='STALE-CCSL'").get(d24).count,0);

const shopeePrepared=prepareV311ShopeeRecovery({db,reportDate:d24,actor:'V377-SMOKE'});
assert.equal(shopeePrepared.prepared,true);
assert.ok(shopeePrepared.retiredStalePointers>=1);
assert.ok(shopeePrepared.lock?.runId);
assert.notEqual(shopeePrepared.lock.runId,'STALE-SHOPEE');
assert.equal(shopeePrepared.staleLockIgnored,false);
assert.equal(db.prepare("SELECT COUNT(*) count FROM business_run_locks WHERE businessType='SHOPEE' AND reportDate=? AND runId='STALE-SHOPEE'").get(d24).count,0);
assert.equal(db.prepare("SELECT COUNT(*) count FROM business_export_snapshots WHERE snapshotId='STALE-SHOPEE-SNAPSHOT'").get().count,1);

closeDb();
fs.rmSync(root,{recursive:true,force:true});
console.log('[V377/V376/V375] import/status lifecycle smoke passed · metadata survives bootstrap/latest · current queue=today+historical · same-date stale CCSL failed + SHOPEE completed cannot leak into a fresh VALID import · prepare retires only stale run pointers and creates new runIds · old audit snapshot preserved · zero-Shopee rule retained');
