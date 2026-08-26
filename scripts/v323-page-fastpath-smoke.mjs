import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v319TrendCacheFastPatch.js','src/v308DeliveryDailyFastPath.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const trendSource=fs.readFileSync('src/v319TrendCacheFastPatch.js','utf8');
const dailySource=fs.readFileSync('src/v308DeliveryDailyFastPath.js','utf8');
assert.match(trendSource,/v323-real-app-trend-route-v4/);
assert.match(trendSource,/registeredApps=new WeakSet\(\)/,'trend route registration must be per concrete Express app');
assert.match(trendSource,/isRealApp\(app\)/,'prototype-time Express getters must not consume registration');
assert.doesNotMatch(trendSource,/let registered=false/,'one global registration flag caused production 404 and must stay retired');
assert.match(dailySource,/v323-single-day-cache-strict-ledger-v2/);
assert.match(dailySource,/readV236CurrentSummary\(date,\{cacheOnly:true\}\)/,'single-day delivery card must start from completed dashboard cache');
assert.match(dailySource,/attemptSource LIKE 'V246_STRICT_TRACK%'/,'1/2/3 attempts must remain strict START-cycle evidence');
assert.match(dailySource,/json_extract\(l\.evidenceJson,'\$\.starts\[0\]\.time'\)/,'average dispatch days must use real first strict START');
assert.ok(dailySource.indexOf('if(from===to)return singleDay(type,to,db)')<dailySource.indexOf('const data=readV320HistoricalDailyWithDispatch'),'single-day delivery must return before historical big-table reader');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v323-'));
process.env.DATA_DIR=root;process.env.DB_FILE=path.join(root,'v323.db');process.env.ACCESS_MODE='LOCAL';process.env.SQLITE_MMAP_BYTES='0';process.env.SQLITE_CACHE_KIB='8192';process.env.NODE_ENV='test';process.env.CE_QC_DISABLE_V246_TRACKING='1';
const {getDb,closeDb}=await import('../src/db.js');
const db=getDb(),date='2026-08-06',snapshotId='V323-S',batchId='V323-B',now=`${date}T23:00:00.000Z`;
db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache(reportDate TEXT NOT NULL,businessType TEXT NOT NULL,regionCode TEXT NOT NULL DEFAULT '',metricsJson TEXT NOT NULL,snapshotId TEXT NOT NULL DEFAULT '',snapshotStatus TEXT NOT NULL DEFAULT '',sourceFingerprint TEXT NOT NULL DEFAULT '',refreshedAt TEXT NOT NULL,PRIMARY KEY(reportDate,businessType,regionCode));
CREATE TABLE IF NOT EXISTS qc_tracking_ledger(shipmentCode TEXT PRIMARY KEY,businessType TEXT NOT NULL,terminalReason TEXT NOT NULL DEFAULT '',attemptNo INTEGER NOT NULL DEFAULT 0,attemptSource TEXT NOT NULL DEFAULT '',podDate TEXT NOT NULL DEFAULT '',evidenceJson TEXT NOT NULL DEFAULT '{}');`);
db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(snapshotId,batchId,date,'COMPLETED','{}',now);
db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(batchId,snapshotId,date,'v323.xlsx','v323-hash','VALID','{}','[]',now);
const types=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const ins=db.prepare('INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
const cache=db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)');
for(let i=0;i<types.length;i++){const type=types[i],bill=`V323-${type}`;ins.run(batchId,snapshotId,date,type,bill,'PP',type,type,'日报',i+1,'V323','{}',now);cache.run(date,type,'',JSON.stringify({total:1,pod:1,returned:0,cancelled:0,sameDayPod:1,ocCurrent:0,pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,provinceOpen:0}),snapshotId,'COMPLETED','V323',now);}
cache.run(date,'WHPP','',JSON.stringify({total:0,pod:0}),snapshotId,'COMPLETED','V323',now);
db.prepare('INSERT INTO qc_tracking_ledger(shipmentCode,businessType,terminalReason,attemptNo,attemptSource,podDate,evidenceJson) VALUES(?,?,?,?,?,?,?)').run('V323-SHOPEECN','SHOPEECN','POD',1,'V246_STRICT_TRACK:START_FAILURE_CYCLE',date,JSON.stringify({starts:[{time:'2026-08-05 09:00:00'}]}));

const {readV308DeliveryDaily}=await import('../src/v308DeliveryDailyFastPath.js');
const {readV319TrendCacheFast}=await import('../src/v319TrendCacheFastPatch.js');
let started=performance.now();const daily=readV308DeliveryDaily('SHOPEECN',date,date,db),dailyMs=performance.now()-started;
assert.equal(daily.daily.length,1);assert.equal(daily.daily[0].attempt1,1);assert.equal(daily.daily[0].avgDispatchSigningDays,2);assert.equal(daily.daily[0].signingSampleCount,1);assert.match(daily.source,/V323_SINGLE_DAY/);assert.ok(dailyMs<500,`V323 single-day delivery fixture must stay <500ms, got ${dailyMs.toFixed(1)}ms`);
started=performance.now();const trend=readV319TrendCacheFast('ALL',date,date,db),trendMs=performance.now()-started;
assert.equal(trend.dates.length,1);assert.equal(trend.ticket[0],6);assert.match(trend.source,/V323_SINGLE_DAY_DASHBOARD_CACHE_ONLY/);assert.ok(trendMs<300,`V323 single-day trend fixture must stay <300ms, got ${trendMs.toFixed(1)}ms`);
closeDb();fs.rmSync(root,{recursive:true,force:true});
console.log(`[V323] page fast-path smoke passed · trend=${trendMs.toFixed(1)}ms · delivery=${dailyMs.toFixed(1)}ms · real-app route registration · strict START→POD average`);
