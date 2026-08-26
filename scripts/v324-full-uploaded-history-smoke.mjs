import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v324ShopeeHistoryFast.js','src/v308DeliveryDailyFastPath.js','src/v319TrendCacheFastPatch.js','public/v308-dashboard-read-bridge.js','public/v320-history-trend-owner.js','src/v308DashboardReadBridgeInjection.js','src/v295FirstAttemptUiInjectionPatch.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const helper=fs.readFileSync('src/v324ShopeeHistoryFast.js','utf8');
const dailySource=fs.readFileSync('src/v308DeliveryDailyFastPath.js','utf8');
const trendSource=fs.readFileSync('src/v319TrendCacheFastPatch.js','utf8');
const dailyUi=fs.readFileSync('public/v308-dashboard-read-bridge.js','utf8');
const trendUi=fs.readFileSync('public/v320-history-trend-owner.js','utf8');
assert.match(helper,/business_daily_parse_rows/);assert.match(helper,/business_final_rows/);assert.match(helper,/qc_tracking_ledger/);assert.doesNotMatch(helper,/trackQuery|confirmQuery|axios|fetch\(/);
assert.match(dailySource,/historyAll&&SHOPEE_TYPES\.has\(type\)/);assert.match(dailySource,/readV324ShopeeHistory/);assert.match(trendSource,/historyAll&&SHOPEE_SET\.has\(type\)/);assert.match(dailyUi,/history=all/);assert.match(trendUi,/history=all/);assert.doesNotMatch(dailyUi,/setInterval\(/);assert.doesNotMatch(trendUi,/setInterval\(/);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v324-'));
process.env.DATA_DIR=root;process.env.DB_FILE=path.join(root,'v324.db');process.env.ACCESS_MODE='LOCAL';process.env.SQLITE_MMAP_BYTES='0';process.env.SQLITE_CACHE_KIB='8192';process.env.NODE_ENV='test';process.env.CE_QC_DISABLE_V246_TRACKING='1';
const {getDb,closeDb}=await import('../src/db.js');const db=getDb();
db.exec(`CREATE TABLE IF NOT EXISTS qc_tracking_ledger(shipmentCode TEXT PRIMARY KEY,businessType TEXT NOT NULL,terminalReason TEXT NOT NULL DEFAULT '',attemptNo INTEGER NOT NULL DEFAULT 0,attemptSource TEXT NOT NULL DEFAULT '',podDate TEXT NOT NULL DEFAULT '',evidenceJson TEXT NOT NULL DEFAULT '{}');`);
const dates=['2026-07-01','2026-07-02','2026-08-06'];
const parse=db.prepare(`INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode,sheetName,rowNumber,source_row_number,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,rawText,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const final=db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for(let di=0;di<dates.length;di++){const d=dates[di];for(let j=1;j<=2;j++){const bill=`VN-${di}-${j}`,now=`${d}T20:00:00Z`;parse.run('SHOPEE',d,bill,'日报',j,j,'SHOPEEVN','SHOPEEVN','VN','V324','',JSON.stringify({shipmentCode:bill}),now);const pod=j===1?1:0,podTime=pod?`${d} 18:00:00`:'';final.run('SHOPEE',bill,d,pod,pod?'POD':'OC','success','',podTime,pod?'POD':'OC','', '', '', 'VN','',j,JSON.stringify({POD时间:podTime}),now,now);if(pod)db.prepare('INSERT INTO qc_tracking_ledger(shipmentCode,businessType,terminalReason,attemptNo,attemptSource,podDate,evidenceJson) VALUES(?,?,?,?,?,?,?)').run(bill,'SHOPEEVN','POD',1,'V246_STRICT_TRACK:START_FAILURE_CYCLE',d,JSON.stringify({starts:[{time:`${d} 09:00:00`}]}));}}
const {readV324ShopeeHistory}=await import('../src/v324ShopeeHistoryFast.js');
const {readV308DeliveryDaily}=await import('../src/v308DeliveryDailyFastPath.js');
const {readV319TrendCacheFast}=await import('../src/v319TrendCacheFastPatch.js');
let started=performance.now();const history=readV324ShopeeHistory('SHOPEEVN','2026-08-06',db),historyMs=performance.now()-started;
assert.deepEqual(history.dates,dates);assert.equal(history.daily.length,3);for(const row of history.daily){assert.equal(row.total,2);assert.equal(row.pod,1);assert.equal(row.attempt1,1);assert.equal(row.avgDispatchSigningDays,1);}
started=performance.now();const table=readV308DeliveryDaily('SHOPEEVN','2026-08-06','2026-08-06',db,{historyAll:true}),tableMs=performance.now()-started;assert.deepEqual(table.dates,dates);assert.equal(table.historyExpanded,true);
started=performance.now();const trend=readV319TrendCacheFast('SHOPEEVN','2026-08-06','2026-08-06',db,{historyAll:true}),trendMs=performance.now()-started;assert.deepEqual(trend.dates,dates);assert.deepEqual(trend.ticket,[2,2,2]);assert.equal(trend.historyExpanded,true);
assert.ok(historyMs<500,`V324 indexed history fixture should stay <500ms, got ${historyMs.toFixed(1)}ms`);assert.ok(tableMs<200);assert.ok(trendMs<200);
closeDb();fs.rmSync(root,{recursive:true,force:true});
console.log(`[V324] full uploaded Shopee history smoke passed · 07-01→08-06 auto history · indexed history=${historyMs.toFixed(1)}ms · table cache=${tableMs.toFixed(1)}ms · trend cache=${trendMs.toFixed(1)}ms`);
