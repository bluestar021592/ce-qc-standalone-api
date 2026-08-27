import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

for (const file of [
  'src/v328ThreeBusinessHistoryFast.js','src/v328EvidenceRepairCoordinator.js',
  'scripts/v328-three-business-evidence-worker-v2.mjs','src/v308DeliveryDailyFastPath.js',
  'src/v319TrendCacheFastPatch.js','public/v308-dashboard-read-bridge.js',
  'public/v320-history-trend-owner.js','public/v328-three-business-attempt-owner.js'
]) execFileSync(process.execPath,['--check',file],{stdio:'pipe'});

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v328-'));
process.env.DATA_DIR=root;
process.env.DB_FILE=path.join(root,'v328.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.NODE_ENV='test';
process.env.CE_QC_DISABLE_V246_TRACKING='1';

const {getDb,closeDb}=await import('../src/db.js');
const db=getDb();
db.exec(`CREATE TABLE IF NOT EXISTS qc_tracking_ledger(
  shipmentCode TEXT PRIMARY KEY,businessType TEXT NOT NULL,firstReportDate TEXT NOT NULL DEFAULT '',
  lastImportedDate TEXT NOT NULL DEFAULT '',sourceSnapshotId TEXT NOT NULL DEFAULT '',lastSnapshotId TEXT NOT NULL DEFAULT '',
  trackingStatus TEXT NOT NULL DEFAULT 'OPEN',terminalReason TEXT NOT NULL DEFAULT '',terminalAt TEXT NOT NULL DEFAULT '',
  currentState TEXT NOT NULL DEFAULT '',currentCategory TEXT NOT NULL DEFAULT '',lastEventTime TEXT NOT NULL DEFAULT '',
  podDate TEXT NOT NULL DEFAULT '',attemptNo INTEGER NOT NULL DEFAULT 0,attemptSource TEXT NOT NULL DEFAULT '',
  signingDays REAL,evidenceJson TEXT NOT NULL DEFAULT '{}',currentStateJson TEXT NOT NULL DEFAULT '{}',
  lastCheckedAt TEXT NOT NULL DEFAULT '',lastRepairReason TEXT NOT NULL DEFAULT '',createdAt TEXT NOT NULL DEFAULT '',updatedAt TEXT NOT NULL DEFAULT ''
);`);

const now='2026-08-06T20:00:00Z';
const batch=db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)');
const snap=db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)');
const urow=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
function addUnified(date,type,bills){
  const b=`B-${type}-${date}`,s=`S-${type}-${date}`;
  snap.run(s,b,date,'COMPLETED','{}',now);
  batch.run(b,s,date,'x.xlsx',`${type}-${date}`,'VALID','{}','[]',now);
  let i=0;
  for(const bill of bills)urow.run(b,s,date,type,bill,'PP',type,type,'日报',++i,'V328','{}',now);
}
addUnified('2026-07-01','TBKH',['T-1','T-2']);
addUnified('2026-07-02','TBKH',['T-3','T-4']);
addUnified('2026-07-13','SHOPEECN',['CN-1','CN-2']);
addUnified('2026-07-01','SHOPEEVN',['VN-1','VN-2']);
addUnified('2026-07-02','SHOPEEVN',['VN-3','VN-4']);

const finalCore=db.prepare(`INSERT INTO final_rows(shipmentCode,reportDate,sourceType,isPod,category,lastEventTime,lastEventCode,primaryCategory,tagsJson,rawJson,createdAt,updatedAt)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
function coreFinal(bill,date,pod){
  const podTime=pod?`${date} 18:00:00`:'';
  finalCore.run(bill,date,'TBKH',pod?1:0,pod?'POD':'OC',podTime,pod?'80':'',pod?'POD':'OC','[]',JSON.stringify({POD时间:podTime}),now,now);
}
coreFinal('T-1','2026-07-01',1);coreFinal('T-2','2026-07-01',0);coreFinal('T-3','2026-07-02',1);coreFinal('T-4','2026-07-02',0);

const finalBiz=db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,latestEventTime,recipient_group,rawJson,createdAt,updatedAt,firstAttemptAt,currentAttemptNo,podAttemptNo,attemptStatus,attemptConfidence,attemptHistoryJson,attemptCalculatedAt)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
function bizFinal(type,bill,date,group,{pod=false,start='',attempt=0}={}){
  const podTime=pod?`${date} 18:00:00`:'';
  finalBiz.run('SHOPEE',bill,date,pod?1:0,pod?'POD':'OC','success',podTime,group,JSON.stringify({POD时间:podTime}),now,now,start,attempt,attempt,attempt?'V328_STRICT_TRACK_BACKFILL':'',attempt?'HIGH':'',start?JSON.stringify([{time:start}]):'[]',now);
}
bizFinal('SHOPEECN','CN-1','2026-07-13','CN',{pod:true,start:'2026-07-13 09:00:00',attempt:1});
bizFinal('SHOPEECN','CN-2','2026-07-13','CN',{pod:false});
bizFinal('SHOPEEVN','VN-1','2026-07-01','VN',{pod:true,start:'2026-07-01 09:00:00',attempt:1});
bizFinal('SHOPEEVN','VN-2','2026-07-01','VN',{pod:false});
bizFinal('SHOPEEVN','VN-3','2026-07-02','VN',{pod:true,start:'2026-07-01 09:00:00',attempt:2});
bizFinal('SHOPEEVN','VN-4','2026-07-02','VN',{pod:false});

const led=db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,trackingStatus,terminalReason,currentState,podDate,attemptNo,attemptSource,evidenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
led.run('T-1','TBKH','2026-07-01','2026-07-01','FINAL','POD','POD','2026-07-01',1,'V246_STRICT_TRACK:TEST',JSON.stringify({starts:[{time:'2026-07-01 08:00:00'}]}),now,now);
led.run('T-3','TBKH','2026-07-02','2026-07-02','FINAL','POD','POD','2026-07-02',2,'V246_STRICT_TRACK:TEST',JSON.stringify({starts:[{time:'2026-07-01 08:00:00'}]}),now,now);

const {readV328ThreeBusinessHistory}=await import('../src/v328ThreeBusinessHistoryFast.js');
const {readV308DeliveryDaily}=await import('../src/v308DeliveryDailyFastPath.js');
let started=performance.now();
const tbkh=readV328ThreeBusinessHistory('TBKH','2026-08-06',db);
const ms=performance.now()-started;
assert.deepEqual(tbkh.dates,['2026-07-01','2026-07-02']);
assert.equal(tbkh.daily[0].total,2);assert.equal(tbkh.daily[0].pod,1);assert.equal(tbkh.daily[0].attempt1,1);assert.equal(tbkh.daily[0].avgDispatchSigningDays,1);
assert.equal(tbkh.daily[1].attempt2,1);assert.equal(tbkh.daily[1].avgDispatchSigningDays,2);assert.ok(ms<500);

const vn=readV328ThreeBusinessHistory('SHOPEEVN','2026-08-06',db);
assert.deepEqual(vn.dates,['2026-07-01','2026-07-02']);assert.equal(vn.daily[0].attempt1,1);assert.equal(vn.daily[0].avgDispatchSigningDays,1);assert.equal(vn.daily[1].attempt2,1);assert.equal(vn.daily[1].avgDispatchSigningDays,2);
const cn=readV328ThreeBusinessHistory('SHOPEECN','2026-08-06',db);
assert.deepEqual(cn.dates,['2026-07-13']);assert.equal(cn.daily[0].total,2);assert.equal(cn.daily[0].pod,1);assert.equal(cn.daily[0].attempt1,1);
const auto=readV308DeliveryDaily('TBKH','2026-08-06','2026-08-06',db,{historyAll:true});
assert.deepEqual(auto.dates,['2026-07-01','2026-07-02']);assert.equal(auto.historyExpanded,true);

closeDb();fs.rmSync(root,{recursive:true,force:true});
console.log(`[V328.4] TBKH + SHOPEE CN/VN unified history smoke passed · real START→real POD days · exact persisted history · ${ms.toFixed(1)}ms`);
