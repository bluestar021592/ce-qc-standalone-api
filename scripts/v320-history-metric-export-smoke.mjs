import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const syntax=[
  'src/v320HistoricalDailyTruth.js','src/v320DispatchSigningTruth.js','src/v320HistoricalExportRows.js',
  'src/v329ThreeBusinessDailyCache.js','src/v319TrendCacheFastPatch.js','src/v334GenericTrendRoutePatch.js',
  'src/v308DeliveryDailyFastPath.js','src/v225ExportReturnTruth.js','src/v200TemplateDashboardExporter.js',
  'src/v419CanonicalExportLedgerTruth.js','src/v484StrictExportEvidenceOwner.js','src/v200Metrics.js',
  'public/v308-dashboard-read-bridge.js','public/v320-history-trend-owner.js','src/v308DashboardReadBridgeInjection.js',
  'src/v295FirstAttemptUiInjectionPatch.js'
];
for(const file of syntax)execFileSync(process.execPath,['--check',file],{stdio:'pipe'});

const historySource=fs.readFileSync('src/v320HistoricalDailyTruth.js','utf8');
const dispatchSource=fs.readFileSync('src/v320DispatchSigningTruth.js','utf8');
const exportSource=fs.readFileSync('src/v225ExportReturnTruth.js','utf8');
const workbookSource=fs.readFileSync('src/v200TemplateDashboardExporter.js','utf8');
const ledgerSource=fs.readFileSync('src/v419CanonicalExportLedgerTruth.js','utf8');
const v484Source=fs.readFileSync('src/v484StrictExportEvidenceOwner.js','utf8');
const exportRowsSource=fs.readFileSync('src/v320HistoricalExportRows.js','utf8');
const metricsSource=fs.readFileSync('src/v200Metrics.js','utf8');
const tableUi=fs.readFileSync('public/v308-dashboard-read-bridge.js','utf8');
const trendUi=fs.readFileSync('public/v320-history-trend-owner.js','utf8');
const trendRoute=fs.readFileSync('src/v319TrendCacheFastPatch.js','utf8');
const genericRoute=fs.readFileSync('src/v334GenericTrendRoutePatch.js','utf8');

for(const token of ['unified_import_batches','shipment_daily_snapshots','daily_reports','business_daily_reports','business_history_summary','history_summary','business_daily_parse_rows','business_final_rows','final_rows'])assert.ok(historySource.includes(token),`history union missing ${token}`);
assert.match(dispatchSource,/strict\.starts\?\.\[0\]/,'compatibility V320 dispatch helper still uses real START cycles');
assert.match(exportRowsSource,/shipment_daily_snapshots/);
assert.match(exportRowsSource,/business_daily_parse_rows/);
assert.match(exportSource,/collectV320HistoricalExportRows/);
assert.match(exportSource,/V489_FORMAL_EXPORT_EVIDENCE_PATH_ID/,'formal collector must expose V489 canonical-ledger ownership');
assert.match(exportSource,/applyV419CanonicalExportLedgerTruth\(businessType,rows,\{db:getDb\(\),onProgress\}\)/,'formal collector must hydrate V419 canonical ledger by shipmentCode');
assert.doesNotMatch(exportSource,/applyV320DispatchSigningTruth\s*\(/,'formal collector must not restore V320 full-member event hydration');
assert.match(exportSource,/applyV329FirstReportSigning/,'final export signing policy gate remains active');
assert.match(exportSource,/strict=STRICT_DELIVERY_TYPES\.has\(type\)/,'TBKH/CN/VN must be separated from legacy non-strict first-report fallback');
assert.match(exportSource,/STRICT_START_TO_ACTUAL_POD/,'strict delivery exports must retain START-to-POD truth');
assert.match(ledgerSource,/function strictSigningDays\(ledger=\{\}\)/,'V419 must recover persisted strict START-to-POD truth');
assert.match(ledgerSource,/v246InclusiveDays\(first,pod\)/,'V419 strict signing days must use inclusive START-to-POD days');
assert.match(workbookSource,/repairV484StrictExportEvidence/,'formal workbook must repair only actual strict POD gaps after membership and V419 hydration');
assert.ok(workbookSource.indexOf('const rows = await collectV200Rows') < workbookSource.indexOf('await repairV484StrictExportEvidence'),'V484 actual-POD repair must happen after real export membership is built');
assert.ok(workbookSource.indexOf('await repairV484StrictExportEvidence') < workbookSource.indexOf('const stats = statsOf(rows, range)'),'V484 repair must complete before workbook metric publication');
assert.match(v484Source,/repairV483StrictExportRows/,'V484 must retain V483 bounded residual repair for unresolved actual POD gaps');
assert.match(metricsSource,/usable\.length !== expected/,'export average denominator must still require every completed POD ticket for final workbook parity');
assert.match(metricsSource,/STRICT_SIGNING_TYPES/);
assert.match(metricsSource,/signingDaysForMetric/,'workbook metrics must consume already-proven START-to-POD signing values for strict delivery businesses');
assert.match(tableUi,/平均签收天数/);
assert.doesNotMatch(trendUi,/fetch\(`\/api\/v308\/delivery-daily[^`]*history=all/,'TBKH/CN/VN trend must reuse shared V308 history payload instead of duplicate history reads');
assert.match(trendUi,/readGenericHistory[\s\S]*history=all/,'generic boards may request only the V334 cache-only V319 history wrapper');
assert.match(genericRoute,/V334_GENERIC_CACHE_ONLY/);
assert.doesNotMatch(genericRoute,/readV320HistoricalDaily|readV320HistoricalDailyWithDispatch/,'generic web history wrapper must never scan heavy history');
assert.match(trendRoute,/V329_EXPLICIT_THREE_BUSINESS_CACHE/);

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v329-history-'));
process.env.DATA_DIR=tempRoot;
process.env.DB_FILE=path.join(tempRoot,'v329.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';
process.env.NODE_ENV='test';
process.env.CE_QC_DISABLE_V246_TRACKING='1';
const {getDb,closeDb}=await import('../src/db.js');
const {readV320HistoricalDaily}=await import('../src/v320HistoricalDailyTruth.js');
const {resolveV320DispatchSigningDays}=await import('../src/v320DispatchSigningTruth.js');
const {completeSigningAverage,referenceAverageDays}=await import('../src/v200Metrics.js');
const {collectV200Rows}=await import('../src/v225ExportReturnTruth.js');
const db=getDb();
const insDaily=db.prepare(`INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode,sheetName,rowNumber,source_row_number,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,rawText,rowJson,createdAt) VALUES('SHOPEE',?,?,?,?,?,'SHOPEEVN','SHOPEEVN','VN','V329','',?,?)`);
const start=Date.UTC(2026,6,1),end=Date.UTC(2026,7,6);
let index=0;
for(let t=start;t<=end;t+=86400000){
  const d=new Date(t).toISOString().slice(0,10),bill=`VNHIST${String(++index).padStart(4,'0')}`;
  insDaily.run(d,bill,'日报',index,index,JSON.stringify({运单号:bill,收件人:'SHOPEEVN',状态标识:'W'}),`${d}T08:00:00Z`);
}
assert.equal(index,37);
const lastBill=`VNHIST${String(index).padStart(4,'0')}`;
db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt,firstAttemptAt,podAttemptNo,currentAttemptNo) VALUES('SHOPEE',?,'2026-08-06',1,'POD','success','','2026-08-06 18:00:00','POD','','','','VN','',0,?,?,?,'2026-08-05 09:00:00',0,0)`).run(lastBill,JSON.stringify({POD时间:'2026-08-06 18:00:00',currentState:'POD'}),'2026-08-06T20:00:00Z','2026-08-06T20:00:00Z');
const explicitHistory=readV320HistoricalDaily('SHOPEEVN','2026-07-01','2026-08-06',{db,expandSingle:false});
assert.equal(explicitHistory.dates.length,37);
assert.equal(explicitHistory.dates[0],'2026-07-01');
assert.equal(explicitHistory.dates.at(-1),'2026-08-06');
const ev=(eventCode,eventTime,desc='')=>({eventCode,eventTime,rawJson:JSON.stringify({eventCode,eventTime,trackingEventDescZh:desc})});
let truth=resolveV320DispatchSigningDays({podDate:'2026-08-06',events:[ev('70','2026-08-04 09:00:00'),ev('70','2026-08-05 09:00:00')]});
assert.equal(truth.strict.attemptNo,1);
truth=resolveV320DispatchSigningDays({podDate:'2026-08-06',events:[ev('70','2026-08-04 09:00:00'),ev('150','2026-08-04 18:00:00','Pending'),ev('70','2026-08-05 09:00:00')]});
assert.equal(truth.strict.attemptNo,2);
assert.equal(completeSigningAverage([1,2],3),null,'final export parity still rejects partial signing denominator');
assert.equal(completeSigningAverage([1,2,3],3),2);
assert.equal(referenceAverageDays('2026-08-04','2026-08-06'),3,'non-strict compatibility helper remains literal inclusive date math');

// V490: collector no longer fabricates strict timing from business_final_rows.firstAttemptAt.
// With no canonical V246 ledger/start evidence in this temp fixture, the strict POD row
// must remain unknown here; formal workbook V484/V483 owns actual-POD repair afterward.
const exportRows=await collectV200Rows('SHOPEEVN',{from:'2026-07-01',to:'2026-08-06'});
assert.equal(exportRows.length,37);
const last=exportRows.find(r=>r.shipmentCode===lastBill);
assert.equal(last?.attemptNo,0);
assert.equal(last?.signingDays,0,'collector must not restore retired full-member V320 timing from a legacy final-row firstAttemptAt');
assert.equal(last?.v329SigningTruth,'STRICT_START_TO_ACTUAL_POD_MISSING');
assert.equal(last?.exportEvidencePartial,true,'strict missing evidence must remain explicit for downstream V484/V483 repair');

closeDb();
fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V490/V489/V334/V329] persisted history membership + V419 canonical ledger + V484 actual-POD repair ownership + strict START-to-POD compatibility helpers + shared history cache ownership smoke passed');
