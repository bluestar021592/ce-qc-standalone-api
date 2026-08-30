import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

process.env.NODE_ENV='test';
process.env.CE_QC_LAUNCHER_TEST_MODE='1';
process.env.CARRY_REFRESH_STARTUP_DELAY_MS='600000';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v374-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'v374.db');
process.env.EXPORTS_DIR=path.join(root,'exports');
process.env.BACKUPS_DIR=path.join(root,'backups');
process.env.IMPORTS_DIR=path.join(root,'imports');
process.env.LOGS_DIR=path.join(root,'logs');

let server=null;
try {
  const source=fs.readFileSync(new URL('../src/v98CarryRefreshEndpointPatch.js',import.meta.url),'utf8');
  assert.match(source,/2026-08-30-v374-runtime-carry-hydration-v3/);
  assert.match(source,/\['CE','CEAF','TBKH','ALI1688','CCSL'\]/,'CCSL hydration must accept canonical and legacy grouped CCSL rows');
  assert.match(source,/\['SHOPEECN','SHOPEEVN','SHOPEE'\]/,'Shopee hydration must accept canonical and legacy grouped SHOPEE rows');
  assert.match(source,/c\.sourceReportDate<\?/,'runtime carry must contain historical OPEN only, never duplicate current-day membership');
  assert.match(source,/V374_RETRY_FIRST_TRUTH/,'progress owner must subtract retry truth before publishing success');

  // Import V98 before route registration exactly like bootstrap/V44. This proves
  // the real Express post/get wrappers compile and can own the registered routes.
  await import('../src/v98CarryRefreshEndpointPatch.js');
  const {getDb,closeDb}=await import('../src/db.js');
  const db=getDb();
  const now=new Date().toISOString();

  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt)
    VALUES(?,?,?,?,?,'VALID','{}','[]',?)`).run('V374-BATCH','V374-SNAP','2026-08-16','8-16.xls','V374-HASH',now);
  db.prepare(`INSERT INTO app_state(key,valueJson,updatedAt) VALUES('current',?,?)
    ON CONFLICT(key) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt`)
    .run(JSON.stringify({reportDate:'2026-08-16',pnhBills:['TODAY-1'],carryBills:[],nextCarryBills:[],processing:{running:false,paused:false,phase:'接口待重试'}}),now);

  const insertCarry=db.prepare(`INSERT INTO carryover_open_items(
    shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertCarry.run('LEGACY-CCSL-1','CCSL','2026-08-10','2026-08-15','OLD','OLD','OPEN','SUCCESS','',JSON.stringify({shipmentCode:'LEGACY-CCSL-1'}),now,now);
  insertCarry.run('CANONICAL-CE-1','CE','2026-08-14','2026-08-15','OLD','OLD','OPEN','SUCCESS','',JSON.stringify({shipmentCode:'CANONICAL-CE-1'}),now,now);
  insertCarry.run('CLOSED-CCSL-1','CCSL','2026-08-09','2026-08-15','OLD','OLD','CLOSED','SUCCESS','POD',JSON.stringify({shipmentCode:'CLOSED-CCSL-1'}),now,now);
  insertCarry.run('TODAY-CE-1','CE','2026-08-16','2026-08-16','V374-SNAP','V374-SNAP','OPEN','PENDING_SCAN','',JSON.stringify({shipmentCode:'TODAY-CE-1'}),now,now);

  db.prepare(`INSERT INTO run_locks(reportDate,runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedBy,lockedAt,completedAt,updatedAt)
    VALUES('2026-08-16','V374-RUN','failed','接口待重试',0,750,'750 retry','','','',?)`).run(now);
  db.prepare(`INSERT INTO run_checkpoints(runId,reportDate,stage,batchIndex,totalBatches,status,payloadJson,errorMessage,createdAt,updatedAt)
    VALUES('V374-RUN','2026-08-16','接口待重试',0,750,'failed',?,'750 retry',?,?)`)
    .run(JSON.stringify({scanResults:4094,trackResults:27,lastRunSummary:{reportDate:'2026-08-16',scanPool:4094,scanRetry:750,trackRetry:0,retryBills:Array.from({length:750},(_,i)=>`R${i}`)}}),now,now);

  const app=express();
  app.post('/api/run',(req,res)=>{
    const state=JSON.parse(db.prepare("SELECT valueJson FROM app_state WHERE key='current'").get()?.valueJson||'{}');
    res.json({ok:true,carryBills:state.carryBills||[],carryHydration:state.carryHydration||null});
  });
  app.get('/api/v33/run-progress',(req,res)=>res.json({
    ok:true,businessType:'CCSL',reportDate:'2026-08-16',phase:'接口待重试',runStatus:'failed',
    scanDone:4094,scanRetry:0,scanObserved:4094,scanTotal:4094,
    trackDone:27,trackRetry:0,trackObserved:27,trackTotal:27,
    done:4094,retry:0,total:4094,progressRule:'V149_TEST'
  }));

  server=await new Promise((resolve,reject)=>{
    const value=app.listen(0,'127.0.0.1',()=>resolve(value));
    value.once('error',reject);
  });
  const address=server.address();
  const base=`http://127.0.0.1:${address.port}`;

  const runResponse=await fetch(`${base}/api/run`,{method:'POST'});
  assert.equal(runResponse.status,200);
  assert.equal(runResponse.headers.get('x-ce-qc-carry-hydration'),'CCSL:2');
  const runPayload=await runResponse.json();
  assert.deepEqual(runPayload.carryBills,['LEGACY-CCSL-1','CANONICAL-CE-1'],'only historical OPEN legacy/canonical CCSL rows belong in runtime carry');
  assert.equal(runPayload.carryHydration?.historicalOpen,2);
  assert.equal(runPayload.carryHydration?.legacyBusinessRows,1);

  const progressResponse=await fetch(`${base}/api/v33/run-progress?businessType=CCSL&reportDate=2026-08-16`);
  assert.equal(progressResponse.status,200);
  const progress=await progressResponse.json();
  assert.equal(progress.scanTotal,4094);
  assert.equal(progress.scanObserved,4094);
  assert.equal(progress.scanRetry,750,'750 persisted retry bills must remain visible');
  assert.equal(progress.scanDone,3344,'retry bills must never be counted as successful scans');
  assert.equal(progress.trackDone,27);
  assert.equal(progress.trackRetry,0);
  assert.match(progress.progressRule,/V374_RETRY_FIRST_TRUTH/);

  console.log('[V374] PASS · runtime carry hydrates legacy+canonical historical OPEN only · closed/current-day excluded · 4094 observed with 750 retry publishes 3344 true success');
  closeDb();
} finally {
  if(server) await new Promise(resolve=>server.close(()=>resolve()));
  fs.rmSync(root,{recursive:true,force:true});
}
