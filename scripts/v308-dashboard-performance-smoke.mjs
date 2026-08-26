import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v308DeliveryDailyFastPath.js','src/v308DashboardReadBridgeInjection.js','public/v308-dashboard-read-bridge.js','src/v320HistoricalDailyTruth.js','src/v320DispatchMetricOverlay.js','src/v320EvidenceAutoBackfill.js','src/v147TrackTimeoutConfig.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}
const ui=fs.readFileSync('public/v308-dashboard-read-bridge.js','utf8');
const inject=fs.readFileSync('src/v308DashboardReadBridgeInjection.js','utf8');
const runtime=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
const backend=fs.readFileSync('src/v308DeliveryDailyFastPath.js','utf8');
assert.match(ui,/\/api\/v263\/delivery-trends/,'bridge must still intercept old heavy special-board reader');
assert.match(ui,/\/api\/v308\/delivery-daily/,'TBKH/CN/VN must use the persisted daily reader');
assert.match(ui,/inFlight=new Map\(\)/,'duplicate trend GETs must remain coalesced');
assert.match(ui,/6500/,'UI reads must retain a finite timeout');
for(const label of ['平均派件→签收天数','1派','2派','3派+','未识别POD','派次样本','签收天数样本'])assert.ok(ui.includes(label),`V320 Shopee daily table missing ${label}`);
assert.doesNotMatch(ui,/signingReady&&row\.avgSigningDays/,'average days must no longer be hidden behind 100% signing coverage');
assert.doesNotMatch(ui,/attemptReady\)/,'known attempt counts must no longer be globally hidden by an all-POD gate');
assert.match(ui,/setInterval\(\(\)=>\{if\(activeShopeeType\(\)\)loadTable\(true\);\},10000\)/,'visible Shopee table must refresh automatically while evidence backfills');
assert.match(inject,/v308-dashboard-read-bridge\.js\?v=20260826-v320-2/,'corrected auto-refresh bridge must be cache-busted');
assert.match(runtime,/import '\.\/v308DeliveryDailyFastPath\.js';/,'daily backend path must activate in normal runtime');
assert.match(runtime,/import '\.\/v308DashboardReadBridgeInjection\.js';/,'UI bridge injection must activate in normal runtime');
assert.match(backend,/readV320HistoricalDailyWithDispatch/,'V308 daily table must use persisted history plus saved strict dispatch evidence');

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v320-v308-'));
process.env.DATA_DIR=tempRoot;
process.env.DB_FILE=path.join(tempRoot,'v320-v308.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.CE_QC_DISABLE_V246_TRACKING='1';
process.env.NODE_ENV='test';

const {getDb,closeDb}=await import('../src/db.js');
const {readV308DeliveryDaily,V308_DELIVERY_DAILY_FAST_ID}=await import('../src/v308DeliveryDailyFastPath.js');
const db=getDb();
const insBatch=db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)');
const insSnap=db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)');
const insRow=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insFinal=db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt,firstAttemptAt,podAttemptNo,currentAttemptNo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const dates=['2026-08-01','2026-08-02'];
for(let di=0;di<dates.length;di++){
  const d=dates[di],snap=`S${di}`,batch=`B${di}`,now=`${d}T23:00:00.000Z`;
  insSnap.run(snap,batch,d,'COMPLETED','{}',now);insBatch.run(batch,snap,d,'v320.xls',`h${di}`,'VALID','{}','[]',now);
  for(let j=1;j<=4;j++)insRow.run(batch,snap,d,'SHOPEEVN',`VN-${di}-${j}`,j%2?'PP':'PV','SHOPEEVN','SHOPEEVN','日报',j,'V320','{}',now);
}
function final(date,bill,{pod=false,podDate='',start='',attempt=0,category='' }={}){
  const latest=podDate?`${podDate} 18:00:00`:`${date} 18:00:00`;
  const raw=JSON.stringify({POD时间:podDate?`${podDate} 18:00:00`:'',currentState:pod?'POD':category||'DELIVERY'});
  insFinal.run('SHOPEE',bill,date,pod?1:0,category|| (pod?'POD':'DELIVERY'),'success','',latest,pod?'POD':'DELIVERY','', '', '', 'VN','',0,raw,`${date}T20:00:00Z`,`${date}T20:00:00Z`,start,attempt,attempt);
}
final('2026-08-01','VN-0-1',{pod:true,podDate:'2026-08-01',start:'2026-08-01 09:00:00',attempt:1});
final('2026-08-01','VN-0-2',{pod:true,podDate:'2026-08-01',start:'2026-08-01 10:00:00',attempt:2});
final('2026-08-01','VN-0-3',{category:'OC'});final('2026-08-01','VN-0-4',{});
// Three PODs on 08-02: two have real dispatch starts (2 days and 1 day), one is missing the start.
final('2026-08-02','VN-1-1',{pod:true,podDate:'2026-08-02',start:'2026-08-01 09:00:00',attempt:1});
final('2026-08-02','VN-1-2',{pod:true,podDate:'2026-08-02',start:'2026-08-02 09:00:00',attempt:2});
final('2026-08-02','VN-1-3',{pod:true,podDate:'2026-08-02',start:'',attempt:0});
final('2026-08-02','VN-1-4',{});

const started=performance.now();
const result=readV308DeliveryDaily('SHOPEEVN','2026-08-01','2026-08-02',db);
const elapsed=performance.now()-started;
assert.equal(result.id,V308_DELIVERY_DAILY_FAST_ID);
assert.deepEqual(result.dates,dates);
assert.equal(result.daily[0].total,4);assert.equal(result.daily[0].pod,2);assert.equal(result.daily[0].ocCurrent,1);
assert.equal(result.daily[0].avgDispatchSigningDays,1,'same-day real dispatch→POD samples must average to 1 day');
assert.equal(result.daily[1].total,4);assert.equal(result.daily[1].pod,3);assert.equal(result.daily[1].attempt1,1);assert.equal(result.daily[1].attempt2,1);assert.equal(result.daily[1].attemptUnknown,1);
assert.equal(result.daily[1].signingSampleCount,2,'missing start evidence must remain a diagnostic sample gap');
assert.equal(result.daily[1].avgDispatchSigningDays,1.5,'valid 2-day and 1-day samples must publish 1.5 even though only 2/3 PODs have signing-day evidence');
assert.equal(result.daily[1].signingEvidenceComplete,false,'coverage diagnostic may be incomplete without blanking the sample average');
assert.ok(elapsed<1000,`two-day persisted-history fixture should remain lightweight, got ${elapsed.toFixed(1)}ms`);

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log(`[V320/V308] persisted-history daily smoke passed · real dispatch→POD sample average publishes under partial coverage · auto-refresh enabled · ${elapsed.toFixed(1)}ms`);
