import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v384-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'v384.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.NODE_ENV='test';
process.env.CE_QC_DISABLE_V246_TRACKING='1';

const {getDb,closeDb}=await import('../src/db.js');
const {saveUnifiedImport}=await import('../src/unifiedImportStore.js');
const {V384_UNIFIED_IMPORT_POST_TRUTH_ID}=await import('../src/v375UnifiedImportMetadataPatch.js');
const {buildV384CcslProcessingProof,readV384CcslProcessingProof,V384_CCSL_PROCESSING_PROOF_ID}=await import('../src/v384CcslProcessingProof.js');
const {inspectV317CcslRecovery}=await import('../src/v317CcslIncompleteRecoveryPatch.js');

function parsed(reportDate,rows,fileHash){
  const counts={CE:0,CEAF:0,TBKH:0,ALI1688:0,SHOPEECN:0,SHOPEEVN:0,WHPP:0};
  for(const row of rows)counts[row.businessType]=(counts[row.businessType]||0)+1;
  const pp=rows.filter(row=>row.regionCode==='PP').length,pv=rows.filter(row=>row.regionCode==='PV').length;
  return{
    reportDate,dateDetectionSource:'文件名',dateCandidates:[{date:reportDate,count:rows.length}],dateConflict:false,dateWasManuallyCorrected:false,containerFormat:'OLE_XLS',fileHash,
    classificationCounts:counts,sourceReconciliation:{balanced:true,validUniqueWaybills:rows.length,classifiedWaybills:rows.length,difference:0},regionCounts:{PP:pp,PV:pv,UNKNOWN:rows.length-pp-pv},
    summary:{rawRows:rows.length,validUniqueWaybills:rows.length,duplicateRows:0,missingWaybillRows:0,missingRecipientWarnings:0,classificationConflicts:0},sheetDiagnostics:[{sheetName:'日报',rows:rows.length}],warnings:[],rows
  };
}
function row(shipmentCode,businessType,regionCode,index){return{shipmentCode,businessType,regionCode,recipientRaw:businessType,recipientNormalized:businessType,sheetName:'日报',rowNumber:index+2,classificationReason:'V384',classificationSource:'V384',classificationMatchedValue:businessType};}

saveUnifiedImport(parsed('2026-08-24',[row('V384-HIST-CE','CE','PP',0)],'v384-hist'),'8-24.xls');
const currentRows=[row('V384-A','CE','PP',0),row('V384-B','CEAF','PP',1),row('V384-C','TBKH','PV',2),row('V384-D','ALI1688','PV',3)];
const saved=saveUnifiedImport(parsed('2026-08-25',currentRows,'v384-current'),'8-25.xls');
const db=getDb();
// Reproduce the current production symptom: compact batch columns are stale/empty,
// while the exact immutable snapshot still owns the real metadata.
db.prepare("UPDATE unified_import_batches SET dateDetectionSource='',dateCandidatesJson='[]',regionCountsJson='{}',summaryJson='{}' WHERE batchId=?").run(saved.batchId);

const app=express();
app.post('/api/import/unified-daily-report',(req,res)=>res.json({
  ok:true,importCommitted:true,reportDate:'2026-08-25',dateDetectionSource:'',containerFormat:'',regionCounts:{PP:0,PV:0,UNKNOWN:0},summary:{rawRows:0,validUniqueWaybills:4},carryover:{todayOpen:0,historicalOpen:1,currentOpen:0}
}));
const server=app.listen(0,'127.0.0.1');
await once(server,'listening');
try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/import/unified-daily-report`,{method:'POST'});
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.importCommitted,true);
  assert.equal(payload.postTruthId,V384_UNIFIED_IMPORT_POST_TRUTH_ID);
  assert.equal(payload.dateDetectionSource,'文件名');
  assert.equal(payload.containerFormat,'OLE_XLS');
  assert.equal(payload.regionCounts.PP,2);
  assert.equal(payload.regionCounts.PV,2);
  assert.equal(payload.summary.rawRows,4);
  assert.ok(payload.carryover.historicalOpen>=1);
  assert.equal(payload.carryover.currentOpen,payload.carryover.todayOpen+payload.carryover.historicalOpen);
  assert.ok(payload.carryover.currentOpen>0);
}finally{await new Promise(resolve=>server.close(resolve));}

const proof1=buildV384CcslProcessingProof({
  sourceBills:['V384-A','V384-B','V384-C','V384-D'],
  scanResults:[
    {shipmentCode:'V384-A',orderStatus:'85',scanCategory:'已签收(POD)'},
    {shipmentCode:'V384-B',orderStatus:'50',scanCategory:'未签收状态(50)'},
    {shipmentCode:'V384-C',orderStatus:'70',scanCategory:'未签收状态(70)'},
    {shipmentCode:'V384-D',orderStatus:'70',scanCategory:'订单扫描API失败'}
  ],
  finalRows:[{shipmentCode:'V384-B',primaryCategory:'派送中'}],podLocks:[]
});
assert.equal(proof1.id,V384_CCSL_PROCESSING_PROOF_ID);
assert.equal(proof1.source,4);
assert.equal(proof1.covered,2);
assert.equal(proof1.missing,2);
assert.deepEqual(proof1.missingBills.sort(),['V384-C','V384-D']);
assert.equal(proof1.reasons.SCAN_TERMINAL,1);
assert.equal(proof1.reasons.TRACK_FINAL_PROCESSED,1);
assert.equal(proof1.reasons.TRACK_REQUIRED_WITHOUT_FINAL_PROOF,1);
assert.equal(proof1.reasons.SCAN_FAILED_OR_RETRY,1);

const now=new Date().toISOString();
const scan=db.prepare(`INSERT OR REPLACE INTO scan_results(shipmentCode,reportDate,sourceType,orderStatus,isPod,scanCategory,rawSummary,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)`);
scan.run('V384-A','2026-08-25','今日PNH','85',1,'已签收(POD)','','{}',now,now);
scan.run('V384-B','2026-08-25','今日PNH','50',0,'未签收状态(50)','','{}',now,now);
scan.run('V384-C','2026-08-25','今日PNH','70',0,'未签收状态(70)','','{}',now,now);
scan.run('V384-D','2026-08-25','今日PNH','70',0,'订单扫描API失败','','{}',now,now);
const final=db.prepare(`INSERT OR REPLACE INTO final_rows(shipmentCode,reportDate,isPod,category,qcConclusion,primaryCategory,rawSummary,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)`);
final.run('V384-B','2026-08-25',0,'派送中','已完成轨迹分析','派送中','','{}',now,now);
let dbProof=readV384CcslProcessingProof(db,{reportDate:'2026-08-25',snapshotId:saved.snapshotId});
assert.equal(dbProof.covered,2);
assert.equal(dbProof.missing,2);

const boundary=String(db.prepare('SELECT createdAt FROM unified_import_batches WHERE batchId=?').get(saved.batchId)?.createdAt||'');
const afterBoundary=new Date(Math.max(Date.now()+2000,Date.parse(boundary||'')+2000)).toISOString();
db.prepare(`INSERT OR REPLACE INTO run_locks(reportDate,runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedBy,lockedAt,completedAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
  .run('2026-08-25','V384-RUN','finished','完成',1,1,'','V384',afterBoundary,afterBoundary,afterBoundary);
db.prepare(`INSERT INTO export_snapshots(snapshotId,reportDate,runId,snapshotType,payloadJson,metricsJson,detailCountsJson,dataHashesJson,consistencyJson,generatedAt,createdAt,status,reconciliationStatus) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run('V384-OLD-COMPLETED','2026-08-25','V384-RUN','dashboard','{}','{}','{}','{}','{}',afterBoundary,afterBoundary,'VALID','COMPLETED');
let status=inspectV317CcslRecovery({db,reportDate:'2026-08-25'});
assert.equal(status.complete,false);
assert.equal(status.action,'REOPEN_FINISHED');
assert.equal(status.rejectedSnapshotId,'V384-OLD-COMPLETED');
assert.equal(status.processingProof.missing,2);
assert.equal(status.processingProof.revision,V384_CCSL_PROCESSING_PROOF_ID);

final.run('V384-C','2026-08-25',0,'派送中','已完成轨迹分析','派送中','','{}',now,now);
db.prepare(`INSERT OR REPLACE INTO pod_locks(shipmentCode,source,podTime,evidenceType,evidenceText,lastSeenReportDate,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)`)
  .run('V384-D','V384','2026-08-25T12:00:00.000Z','TEST','terminal lock','2026-08-25',now,now);
dbProof=readV384CcslProcessingProof(db,{reportDate:'2026-08-25',snapshotId:saved.snapshotId});
assert.equal(dbProof.covered,4);
assert.equal(dbProof.missing,0);
status=inspectV317CcslRecovery({db,reportDate:'2026-08-25'});
assert.equal(status.complete,true);
assert.equal(status.snapshotId,'V384-OLD-COMPLETED');

closeDb();
fs.rmSync(root,{recursive:true,force:true});
console.log('[V384] runtime smoke passed · successful import POST is hydrated before browser render · current queue=today+historical · terminal scan/POD lock closes directly · 50/60/70/unknown scans require a non-retry final trajectory result · scan API failures never count as completion · old false-complete snapshot reopens without reupload');
