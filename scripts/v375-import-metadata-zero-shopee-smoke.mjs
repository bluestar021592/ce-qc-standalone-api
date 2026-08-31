import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v375-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'v375.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.NODE_ENV='test';
process.env.CE_QC_DISABLE_V246_TRACKING='1';

const {getDb,closeDb}=await import('../src/db.js');
const {saveUnifiedImport}=await import('../src/unifiedImportStore.js');
const {readV375LatestUnifiedImport,V375_UNIFIED_IMPORT_METADATA_ID}=await import('../src/v375UnifiedImportMetadataPatch.js');
const {inspectV311ShopeeRecovery,V375_SHOPEE_ZERO_WORK_ID}=await import('../src/v311ShopeeIncompleteRecoveryPatch.js');

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
// Reproduce the visible regression: batch metadata is blank/stale while the exact
// same snapshot payload and persisted membership rows still contain the truth.
db.prepare("UPDATE unified_import_batches SET dateDetectionSource='',dateCandidatesJson='[]',regionCountsJson='{}',summaryJson='{}' WHERE batchId=?").run(saved.batchId);

const hydrated=readV375LatestUnifiedImport(db);
assert.equal(hydrated.metadataHydrationId,V375_UNIFIED_IMPORT_METADATA_ID);
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

const shopee=inspectV311ShopeeRecovery({db,reportDate});
assert.equal(shopee.complete,true);
assert.equal(shopee.noWork,true);
assert.equal(shopee.zeroTicketDay,true);
assert.equal(shopee.needsResume,false);
assert.equal(shopee.reason,'EXACT_ZERO_UNIFIED_SHOPEE_MEMBERSHIP');
assert.equal(shopee.policyId,V375_SHOPEE_ZERO_WORK_ID);
assert.deepEqual({cn:shopee.membership.SHOPEECN,vn:shopee.membership.SHOPEEVN,total:shopee.membership.total},{cn:0,vn:0,total:0});

// Both real browser read paths must be owned by the same hydration logic. The
// legacy bootstrap payload deliberately supplies broken metadata to prove V376
// replaces it before the browser can overwrite a correct import response.
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
  assert.equal(bootstrapPayload.ok,true);
  assert.equal(latestPayload.ok,true);
  for(const item of [bootstrapPayload.unifiedImport,latestPayload.import]){
    assert.equal(item.metadataHydrationId,V375_UNIFIED_IMPORT_METADATA_ID);
    assert.equal(item.containerFormat,'OLE_XLS');
    assert.equal(item.dateDetectionSource,'文件名');
    assert.equal(item.regionCounts.PP,2);
    assert.equal(item.regionCounts.PV,2);
    assert.equal(item.summary.rawRows,4);
    assert.equal(item.summary.validUniqueWaybills,4);
  }
  assert.deepEqual(bootstrapPayload.unifiedImport.classificationCounts,latestPayload.import.classificationCounts);
  assert.deepEqual(bootstrapPayload.unifiedImport.regionCounts,latestPayload.import.regionCounts);
}finally{await new Promise(resolve=>server.close(resolve));}

closeDb();
fs.rmSync(root,{recursive:true,force:true});
console.log('[V376/V375] import metadata + zero-Shopee runtime smoke passed · bootstrap and unified-latest return one exact snapshot truth · reload/poll cannot erase date/container/PP-PV/summary · exact CN=0/VN=0 closes without remote run · WHPP semantics untouched');
