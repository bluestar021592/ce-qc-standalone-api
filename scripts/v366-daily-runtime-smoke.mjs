import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import XLSX from 'xlsx';

process.env.NODE_ENV='test';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v366-runtime-'));
const dbFile=path.join(root,'runtime.db');
const reportFile=path.join(root,'8-16.xlsx');
process.env.DATA_DIR=root;
process.env.DB_FILE=dbFile;
process.env.EXPORTS_DIR=path.join(root,'exports');
process.env.BACKUPS_DIR=path.join(root,'backups');
process.env.IMPORTS_DIR=path.join(root,'imports');
process.env.LOGS_DIR=path.join(root,'logs');
process.env.EVIDENCE_ARCHIVE_DIR=path.join(root,'evidence');
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB=8192;

let server=null;
try {
  // Mirror the real bootstrap route-owner order exactly. V102 owns the
  // pre-persistence safety + atomic wrapper, V146 inserts normalized report-date
  // middleware, then V42 replaces only the final handler with the seven-business
  // importer while preserving both earlier owners.
  await import('../src/v102UnifiedImportSafetyGatePatch.js');
  await import('../src/v146UnifiedImportDateBridgePatch.js');
  await import('../src/v42WhppPatch.js');
  const { getDb, closeDb }=await import('../src/db.js');
  const { saveAppState, loadAppState }=await import('../src/store.js');
  const { SHOPEE, saveBusinessState, loadBusinessState }=await import('../src/businessStore.js');
  const { saveWhppDailyImport, saveWhppState, loadWhppState }=await import('../src/whppStore.js');

  const db=getDb();

  // Previous official day: CCSL and SHOPEE are 08-15.
  saveAppState({
    businessType:'CCSL',reportDate:'2026-08-15',sourceName:'8-15.xls',dailyReportReady:true,
    pnhBills:['CC260815000001'],
    dailyParseRows:[{shipmentCode:'CC260815000001',运单号:'CC260815000001',sheetName:'日报',rowNumber:2,result:'PNH',reason:'seed'}],
    dailyParseSummary:{totalRecognized:1,totalUniqueCount:1,pnh:1,pnhCount:1,businessCounts:{CE:1,CEAF:0,TBKH:0,ALI1688:0}},
    carryBills:[],nextCarryBills:[],podLocks:[],scanPool:[],scanResults:[],trackEvents:[],finalRows:[],
    processing:{running:false,paused:false,phase:'已完成',batchIndex:0,totalBatches:0}
  });
  saveBusinessState({
    businessType:SHOPEE,reportDate:'2026-08-15',sourceName:'8-15.xls',dailyReportReady:true,
    pnhBills:['SPE260815000001'],
    dailyParseRows:[{shipmentCode:'SPE260815000001',运单号:'SPE260815000001',recipient_group:'CN',recipient_group_reason:'seed',sheetName:'日报',rowNumber:2}],
    dailyParseSummary:{totalRecognized:1,groupCounts:{CN:1,VN:0}},
    carryBills:[],nextCarryBills:[],podLocks:[],scanPool:[],scanResults:[],trackEvents:[],finalRows:[],priorCarryRows:[],needTrackBills:[],
    processing:{running:false,paused:false,phase:'已完成',batchIndex:0,totalBatches:0}
  },SHOPEE);

  // Reproduce the real fault shape deliberately: the verified WHPP membership for
  // 08-16 already exists, but WHPP's current processing state is still 08-15.
  const preservedWhppRow={
    shipmentCode:'CE260816000001',businessType:'WHPP',reportDate:'2026-08-16',sheetName:'WHPP',rowNumber:2,
    recipientRaw:'',recipientNormalized:'',regionCode:'PP',classificationSource:'SHIPMENT_PREFIX',classificationMatchedValue:'CE'
  };
  saveWhppDailyImport({reportDate:'2026-08-16',sourceName:'whpp-standard-8-16.xls',rows:[preservedWhppRow],batchId:'PRESEED',snapshotId:'PRESEED'});
  saveWhppState({
    reportDate:'2026-08-15',sourceName:'whpp-standard-8-15.xls',dailyReportReady:true,pnhBills:['CE260815000001'],
    dailyParseRows:[{shipmentCode:'CE260815000001',businessType:'WHPP',reportDate:'2026-08-15'}],carryBills:[],nextCarryBills:[],podLocks:[],
    processing:{running:false,paused:false,phase:'已完成',batchIndex:0,totalBatches:0},lastRunSummary:null,lastRun:null
  });

  assert.equal(loadAppState().reportDate,'2026-08-15');
  assert.equal(loadBusinessState(SHOPEE).reportDate,'2026-08-15');
  assert.equal(loadWhppState().reportDate,'2026-08-15','fixture must reproduce WHPP current-state lag before import');
  assert.equal(Number(db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate='2026-08-16'").get()?.totalCount||0),1,'fixture must retain verified 08-16 WHPP membership');

  // The new combined report intentionally contains the six non-WHPP business
  // members only. V366 must preserve/reload the verified dedicated WHPP member and
  // publish a seven-business total of 7 without leaving WHPP on 08-15.
  const sheet=XLSX.utils.aoa_to_sheet([
    ['运单编号','日报日期','收件人','省份标识','客户名称'],
    ['CC260816000001','2026-08-16','','PP',''],
    ['CC260816000002','2026-08-16','','PP','CCAF Customer'],
    ['TBKH2608160001','2026-08-16','','PP',''],
    ['CC260816000003','2026-08-16','ALI1688','PV',''],
    ['SPE260816000001','2026-08-16','ShopeeCN','PP',''],
    ['SPE260816000002','2026-08-16','ShopeeVN','PV','']
  ]);
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,'日报');
  XLSX.writeFile(book,reportFile);

  const app=express();
  app.post('/api/import/unified-daily-report',
    (req,_res,next)=>{
      req.file={path:reportFile,originalname:'8-16.xls'};
      req.body={reportDate:'2026/08/16'};
      next();
    },
    (_req,res)=>res.status(599).json({ok:false,error:'V42 owner was not installed'})
  );

  await new Promise((resolve,reject)=>{
    server=app.listen(0,'127.0.0.1',resolve);
    server.once('error',reject);
  });
  const port=server.address().port;
  const response=await fetch(`http://127.0.0.1:${port}/api/import/unified-daily-report`,{method:'POST'});
  const payload=await response.json();
  assert.equal(response.status,200,JSON.stringify(payload));
  assert.equal(response.headers.get('x-ce-qc-import-date'),'2026-08-16','V146 bridge must normalize the request date before V102/V42 persistence');
  assert.ok(response.headers.get('x-ce-qc-import-date-bridge'),'V146 date bridge header must prove the real middleware ran');
  assert.equal(payload.ok,true);
  assert.equal(payload.importCommitted,true);
  assert.equal(payload.reportDate,'2026-08-16');
  assert.equal(payload.summary?.validUniqueWaybills,7,'effective daily total must include preserved WHPP as business seven');
  assert.deepEqual(payload.classificationCounts,{CE:1,CEAF:1,TBKH:1,ALI1688:1,SHOPEECN:1,SHOPEEVN:1,WHPP:1});
  assert.equal(payload.whpp?.source,'REHYDRATED_EXISTING_COMPLETE_DAILY_MEMBERSHIP');
  assert.equal(payload.persistenceVerification?.total,7);

  const ccsl=loadAppState();
  const shopee=loadBusinessState(SHOPEE);
  const whpp=loadWhppState();
  assert.equal(ccsl.reportDate,'2026-08-16','CCSL current state must switch only after verified import');
  assert.equal(shopee.reportDate,'2026-08-16','SHOPEE current state must switch with CCSL');
  assert.equal(whpp.reportDate,'2026-08-16','preserved WHPP membership must rehydrate WHPP current state to target date');
  assert.equal(ccsl.dailyReportReady,true);
  assert.equal(shopee.dailyReportReady,true);
  assert.equal(whpp.dailyReportReady,true);

  assert.equal(Number(db.prepare("SELECT totalUniqueCount FROM daily_reports WHERE reportDate='2026-08-16'").get()?.totalUniqueCount||0),4,'CCSL queue membership must be four businesses');
  assert.equal(Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM daily_parse_rows WHERE reportDate='2026-08-16'").get()?.count||0),4);
  assert.equal(Number(db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='SHOPEE' AND reportDate='2026-08-16'").get()?.totalCount||0),2,'SHOPEE queue membership must contain CN+VN');
  assert.equal(Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='SHOPEE' AND reportDate='2026-08-16'").get()?.count||0),2);
  assert.equal(Number(db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate='2026-08-16'").get()?.totalCount||0),1,'WHPP dedicated queue membership must remain intact');
  assert.equal(Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate='2026-08-16'").get()?.count||0),1);
  assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM unified_import_batches WHERE reportDate='2026-08-16' AND status='VALID'").get()?.count||0),1,'08-16 must expose exactly one VALID unified batch');

  console.log('[V366 RUNTIME] PASS exact bootstrap route chain V102→V146→V42 · 08-15→08-16 · six combined + preserved WHPP = seven · CCSL/SHOPEE/WHPP current states all 08-16 · normalized queue counts 4/2/1 · explicit atomic commit verified');

  await new Promise(resolve=>server.close(resolve));
  server=null;
  closeDb();
} finally {
  if(server) await new Promise(resolve=>server.close(resolve));
  try {
    const { closeDb }=await import('../src/db.js');
    closeDb();
  } catch {}
  try { fs.rmSync(root,{recursive:true,force:true}); } catch {}
}
