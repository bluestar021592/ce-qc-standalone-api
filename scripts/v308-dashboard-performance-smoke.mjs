import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v308DeliveryDailyFastPath.js','src/v308DashboardReadBridgeInjection.js','public/v308-dashboard-read-bridge.js','src/v147TrackTimeoutConfig.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}
const ui=fs.readFileSync('public/v308-dashboard-read-bridge.js','utf8');
const inject=fs.readFileSync('src/v308DashboardReadBridgeInjection.js','utf8');
const runtime=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
assert.match(ui,/\/api\/v263\/delivery-trends/,'V308 must intercept the old heavy special-board reader');
assert.match(ui,/\/api\/v308\/delivery-daily/,'V308 must route TBKH/CN/VN to the type-scoped daily reader');
assert.match(ui,/u\.pathname==='\/api\/v273\/trends'/,'passive generic V273 deep reads must be diverted away from page navigation');
assert.match(ui,/inFlight=new Map\(\)/,'duplicate trend GETs must be coalesced');
assert.match(ui,/6500/,'UI reads must have a finite short timeout');
for(const label of ['平均签收天数','1派','2派','3派+','未识别POD','派次覆盖','签收天数覆盖'])assert.ok(ui.includes(label),`Shopee daily table missing ${label}`);
assert.match(ui,/attemptEvidenceComplete===true/,'1/2/3派 final values must remain hidden until evidence coverage is complete');
assert.match(ui,/signingEvidenceComplete===true/,'average signing days must remain hidden until signing evidence is complete');
assert.match(inject,/v308-dashboard-read-bridge\.js\?v=20260826-v308-1/,'V308 bridge must be injected in the document head');
assert.match(runtime,/import '\.\/v308DeliveryDailyFastPath\.js';/,'V308 backend fast path must activate in normal runtime');
assert.match(runtime,/import '\.\/v308DashboardReadBridgeInjection\.js';/,'V308 UI bridge injection must activate in normal runtime');

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v308-'));
process.env.DATA_DIR=tempRoot;
process.env.DB_FILE=path.join(tempRoot,'v308.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.CE_QC_DISABLE_V246_TRACKING='1';
process.env.NODE_ENV='test';

const {getDb,closeDb}=await import('../src/db.js');
const {ensureV246TrackingSchema}=await import('../src/v246TrackingLedgerCore.js');
const {readV308DeliveryDaily,V308_DELIVERY_DAILY_FAST_ID}=await import('../src/v308DeliveryDailyFastPath.js');
const db=getDb();ensureV246TrackingSchema(db);
const insBatch=db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)');
const insSnap=db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)');
const insRow=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insLedger=db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

const dates=['2026-08-01','2026-08-02'];
for(let di=0;di<dates.length;di++){
  const d=dates[di],snap=`S${di}`,batch=`B${di}`,now=`${d}T23:00:00.000Z`;
  insSnap.run(snap,batch,d,'COMPLETED','{}',now);insBatch.run(batch,snap,d,'v308.xls',`h${di}`,'VALID','{}','[]',now);
  for(let j=1;j<=4;j++)insRow.run(batch,snap,d,'SHOPEEVN',`VN-${di}-${j}`,j%2?'PP':'PV','SHOPEEVN','SHOPEEVN','日报',j,'V308','{}',now);
}
const now='2026-08-02T20:00:00.000Z';
// 08-01 is fully status-proven and has complete attempts/signing: POD attempts 1 and 2.
insLedger.run('VN-0-1','SHOPEEVN','2026-08-01','2026-08-01','S0','S0','TERMINAL','POD',now,'POD','POD',now,'2026-08-01',1,'V246_STRICT_TRACK',1,'{}','{}',now,'',now,now);
insLedger.run('VN-0-2','SHOPEEVN','2026-08-01','2026-08-01','S0','S0','TERMINAL','POD',now,'POD','POD',now,'2026-08-01',2,'V246_STRICT_TRACK',2,'{}','{}',now,'',now,now);
insLedger.run('VN-0-3','SHOPEEVN','2026-08-01','2026-08-01','S0','S0','OPEN','', '', 'OC','OC',now,'',0,'',null,'{}','{}',now,'',now,now);
insLedger.run('VN-0-4','SHOPEEVN','2026-08-01','2026-08-01','S0','S0','OPEN','', '', 'DELIVERY','DELIVERY',now,'',0,'',null,'{}','{}',now,'',now,now);
// 08-02 has one POD with no attempt/signing and one completely unproven row.
insLedger.run('VN-1-1','SHOPEEVN','2026-08-02','2026-08-02','S1','S1','TERMINAL','POD',now,'POD','POD',now,'2026-08-02',0,'',null,'{}','{}',now,'',now,now);
insLedger.run('VN-1-2','SHOPEEVN','2026-08-02','2026-08-02','S1','S1','OPEN','', '', 'DELIVERY','DELIVERY',now,'',0,'',null,'{}','{}',now,'',now,now);
insLedger.run('VN-1-3','SHOPEEVN','2026-08-02','2026-08-02','S1','S1','OPEN','', '', 'OPEN','OPEN','', '',0,'',null,'{}','{}','', '',now,now);

const started=performance.now();
const result=readV308DeliveryDaily('SHOPEEVN','2026-08-01','2026-08-02',db);
const elapsed=performance.now()-started;
assert.equal(result.id,V308_DELIVERY_DAILY_FAST_ID);
assert.deepEqual(result.dates,dates);
assert.equal(result.daily[0].total,4);assert.equal(result.daily[0].pod,2);assert.equal(result.daily[0].ocCurrent,1);
assert.equal(result.daily[0].attemptEvidenceComplete,true);assert.equal(result.daily[0].attempt1,1);assert.equal(result.daily[0].attempt2,1);assert.equal(result.daily[0].avgSigningDays,1.5);
assert.equal(result.daily[1].total,4);assert.equal(result.daily[1].ready,false,'one untouched admission row must keep the day status-incomplete');
assert.equal(result.daily[1].pod,null,'partial status evidence must not publish a final POD count');
assert.equal(result.daily[1].attemptEvidenceComplete,false);assert.equal(result.daily[1].attempt1,null);assert.equal(result.daily[1].avgSigningDays,null);
assert.ok(elapsed<750,`type-scoped two-day fixture should be lightweight, got ${elapsed.toFixed(1)}ms`);

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log(`[V308] nonblocking dashboard smoke passed · type-scoped latest-VALID ledger read ${elapsed.toFixed(1)}ms · duplicate passive heavy reads bridged · Shopee CN/VN daily attempt/signing table coverage-safe`);
