import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const syntax=[
  'src/v320HistoricalDailyTruth.js','src/v320DispatchSigningTruth.js','src/v320HistoricalExportRows.js',
  'src/v319TrendCacheFastPatch.js','src/v308DeliveryDailyFastPath.js','src/v225ExportReturnTruth.js','src/v200Metrics.js',
  'public/v308-dashboard-read-bridge.js','public/v320-history-trend-owner.js','src/v308DashboardReadBridgeInjection.js','src/v295FirstAttemptUiInjectionPatch.js'
];
for(const file of syntax)execFileSync(process.execPath,['--check',file],{stdio:'pipe'});

const historySource=fs.readFileSync('src/v320HistoricalDailyTruth.js','utf8');
const dispatchSource=fs.readFileSync('src/v320DispatchSigningTruth.js','utf8');
const exportSource=fs.readFileSync('src/v225ExportReturnTruth.js','utf8');
const exportRowsSource=fs.readFileSync('src/v320HistoricalExportRows.js','utf8');
const metricsSource=fs.readFileSync('src/v200Metrics.js','utf8');
const tableUi=fs.readFileSync('public/v308-dashboard-read-bridge.js','utf8');
const trendUi=fs.readFileSync('public/v320-history-trend-owner.js','utf8');

for(const token of ['unified_import_batches','shipment_daily_snapshots','daily_reports','business_daily_reports','business_history_summary','history_summary','business_daily_parse_rows','business_final_rows','final_rows'])assert.ok(historySource.includes(token),`history union missing ${token}`);
assert.match(historySource,/historyExpanded:from===to/,'single-day selector must expand history panels through the selected day');
assert.match(historySource,/avgDispatchSigningDays/,'daily history must expose dispatch→POD average');
assert.match(dispatchSource,/strict\.starts\?\.\[0\]/,'dispatch duration must start from the first real START');
assert.match(dispatchSource,/v246InclusiveDays\(dispatch,pod\)/,'dispatch→POD must use inclusive natural days');
assert.doesNotMatch(dispatchSource,/firstReportDate/,'V320 dispatch duration must never use report membership date as the timing origin');
assert.match(exportRowsSource,/shipment_daily_snapshots/,'export rows must include preserved historical snapshots');
assert.match(exportRowsSource,/business_daily_parse_rows/,'export rows must include legacy Shopee daily memberships');
assert.match(exportSource,/collectV320HistoricalExportRows/,'runtime export must seed from full persisted history');
assert.match(exportSource,/applyV320DispatchSigningTruth/,'runtime export must apply corrected dispatch→POD truth');
assert.doesNotMatch(exportSource,/V294_EXPORT_EVIDENCE_INCOMPLETE/,'optional evidence gaps must not abort the workbook anymore');
assert.match(exportSource,/evidencePartial/,'partial evidence must remain an explicit diagnostic rather than a fatal error');
assert.match(metricsSource,/completeSigningAverage[\s\S]*usable\.length \? average\(usable\) : null/,'average must publish from available real samples');
assert.match(tableUi,/平均派件→签收天数/);assert.match(tableUi,/签收天数样本/);assert.doesNotMatch(tableUi,/signingEvidenceComplete===true/,'UI must not blank average just because some PODs lack timing evidence');
assert.match(trendUi,/\/api\/v319\/trends/);assert.doesNotMatch(trendUi,/\/api\/v273\/trends|\/api\/v263\/delivery-trends/,'final trend owner must remain local-history-only');

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v320-history-'));
process.env.DATA_DIR=tempRoot;process.env.DB_FILE=path.join(tempRoot,'v320.db');process.env.ACCESS_MODE='LOCAL';process.env.SQLITE_MMAP_BYTES='0';process.env.SQLITE_CACHE_KIB='8192';process.env.NODE_ENV='test';process.env.CE_QC_DISABLE_V246_TRACKING='1';
const {getDb,closeDb}=await import('../src/db.js');
const {readV320HistoricalDaily}=await import('../src/v320HistoricalDailyTruth.js');
const {resolveV320DispatchSigningDays}=await import('../src/v320DispatchSigningTruth.js');
const {completeSigningAverage,referenceAverageDays}=await import('../src/v200Metrics.js');
const {collectV200Rows}=await import('../src/v225ExportReturnTruth.js');
const db=getDb();
const insDaily=db.prepare(`INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode,sheetName,rowNumber,source_row_number,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,rawText,rowJson,createdAt) VALUES('SHOPEE',?,?,?,?,?,'SHOPEEVN','SHOPEEVN','VN','V320','',?,?)`);
const start=Date.UTC(2026,6,1),end=Date.UTC(2026,7,6);let index=0;
for(let t=start;t<=end;t+=86400000){const d=new Date(t).toISOString().slice(0,10),bill=`VNHIST${String(++index).padStart(4,'0')}`;insDaily.run(d,bill,'日报',index,index,JSON.stringify({运单号:bill,收件人:'SHOPEEVN',状态标识:'W'}),`${d}T08:00:00Z`);}
assert.equal(index,37,'2026-07-01 through 2026-08-06 must contain 37 calendar dates');
// Add one terminal POD on 08-06 with no attempt/start evidence: export must still complete instead of V294_EXPORT_EVIDENCE_INCOMPLETE.
const lastBill=`VNHIST${String(index).padStart(4,'0')}`;
db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt,firstAttemptAt,podAttemptNo,currentAttemptNo) VALUES('SHOPEE',?,'2026-08-06',1,'POD','success','','2026-08-06 18:00:00','POD','','','','VN','',0,?,?,?,'',0,0)`).run(lastBill,JSON.stringify({POD时间:'2026-08-06 18:00:00',currentState:'POD'}),'2026-08-06T20:00:00Z','2026-08-06T20:00:00Z');

const history=readV320HistoricalDaily('SHOPEEVN','2026-08-06','2026-08-06',{db,expandSingle:true});
assert.equal(history.dates.length,37,'single selected day must recover all 37 persisted historical report dates through 08-06');
assert.equal(history.dates[0],'2026-07-01');assert.equal(history.dates.at(-1),'2026-08-06');
assert.equal(history.daily.length,37);assert.equal(history.daily.at(-1).total,1);

const ev=(eventCode,eventTime,desc='')=>({eventCode,eventTime,rawJson:JSON.stringify({eventCode,eventTime,trackingEventDescZh:desc})});
let truth=resolveV320DispatchSigningDays({podDate:'2026-08-06',events:[ev('70','2026-08-05 09:00:00')]});
assert.equal(truth.days,2,'08-05 real dispatch START to 08-06 POD is two inclusive natural days');assert.equal(truth.strict.attemptNo,1);
truth=resolveV320DispatchSigningDays({podDate:'2026-08-06',events:[ev('70','2026-08-04 09:00:00'),ev('70','2026-08-05 09:00:00')]});
assert.equal(truth.strict.attemptNo,1,'repeated START without failure stays attempt 1');
truth=resolveV320DispatchSigningDays({podDate:'2026-08-06',events:[ev('70','2026-08-04 09:00:00'),ev('150','2026-08-04 18:00:00','Pending'),ev('70','2026-08-05 09:00:00')]});
assert.equal(truth.strict.attemptNo,2,'failure followed by a new START becomes attempt 2');
assert.equal(completeSigningAverage([1,2],3),1.5,'two real signing samples out of three PODs must publish 1.5 instead of —');
assert.equal(referenceAverageDays('2026-08-05','2026-08-06'),2,'reference helper now means dispatch start→POD');

const exportRows=await collectV200Rows('SHOPEEVN',{from:'2026-07-01',to:'2026-08-06'});
assert.equal(exportRows.length,37,'full 37-day persisted history must be exportable even when only one current POD has incomplete attempt/signing evidence');
assert.equal(exportRows.filter(r=>r.reportMembershipDate==='2026-07-01').length,1);assert.equal(exportRows.filter(r=>r.reportMembershipDate==='2026-08-06').length,1);
assert.equal(exportRows.find(r=>r.shipmentCode===lastBill)?.attemptNo,0,'unknown attempt remains explicit rather than fabricated');

closeDb();fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V320] full-history + dispatch-signing + export smoke passed · 37 persisted dates restored · partial evidence average publishes · incomplete evidence no longer blocks export');
