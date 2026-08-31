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
  reportDate,dateDetectionSource:'filename',dateCandidates:[reportDate],dateConflict:false,dateWasManuallyCorrected:false,containerFormat:'OLE_XLS',fileHash:'v375-file-hash',
  classificationCounts:{CE:2,CEAF:0,TBKH:1,ALI1688:0,SHOPEECN:0,SHOPEEVN:0,WHPP:1},
  sourceReconciliation:{balanced:true,validUniqueWaybills:4,classifiedWaybills:4,difference:0},regionCounts:{PP:2,PV:2},
  summary:{originalRows:4,rawRows:4,validUniqueWaybills:4,duplicateWaybills:0,missingWaybills:0,missingRecipients:0,classificationConflicts:0},sheetDiagnostics:[{sheetName:'日报',rows:4}],warnings:[],rows
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
assert.equal(hydrated.dateDetectionSource,'filename');
assert.deepEqual(hydrated.dateCandidates,[reportDate]);
assert.equal(hydrated.regionCounts.PP,2);
assert.equal(hydrated.regionCounts.PV,2);
assert.equal(hydrated.summary.originalRows,4);
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

// The V375 Express patch must own the legacy reload endpoint, not only its helper.
const app=express();
app.get('/api/import/unified-latest',(req,res)=>res.status(599).json({legacy:true}));
const server=app.listen(0,'127.0.0.1');
await once(server,'listening');
try{
  const port=server.address().port;
  const response=await fetch(`http://127.0.0.1:${port}/api/import/unified-latest`);
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.ok,true);
  assert.equal(payload.import.metadataHydrationId,V375_UNIFIED_IMPORT_METADATA_ID);
  assert.equal(payload.import.containerFormat,'OLE_XLS');
  assert.equal(payload.import.regionCounts.PP,2);
  assert.equal(payload.import.regionCounts.PV,2);
}finally{await new Promise(resolve=>server.close(resolve));}

closeDb();
fs.rmSync(root,{recursive:true,force:true});
console.log('[V375] import metadata + zero-Shopee runtime smoke passed · reload restores snapshot date/container/PP-PV/summary · exact CN=0/VN=0 closes without remote run · WHPP semantics untouched');
