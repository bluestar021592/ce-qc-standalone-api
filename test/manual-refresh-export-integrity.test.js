import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyUnifiedBusiness } from '../src/unifiedExcelParser.js';
import { classifyV246Terminal } from '../src/v246TrackingLedgerCore.js';
import { dueCarryRefreshReason, startCarryoverRefreshScheduler, schedulerStateForTests, stopCarryoverRefreshSchedulerForTests } from '../src/carryoverRefreshScheduler.js';
import { bucketRows, assertV200BucketConservation } from '../src/v200Metrics.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('automatic unfinished-POD refresh is disabled and scheduler stays manual-only',()=>{
  stopCarryoverRefreshSchedulerForTests();
  assert.equal(dueCarryRefreshReason(), '');
  const started=startCarryoverRefreshScheduler();
  assert.equal(started.started,false);
  assert.equal(started.reason,'MANUAL_ONLY');
  assert.equal(schedulerStateForTests().manualOnly,true);
  assert.equal(schedulerStateForTests().started,false);
});

test('seven business classification rules remain deterministic and priority-safe',()=>{
  assert.equal(classifyUnifiedBusiness('CC001','','CCAF CLIENT').businessType,'CEAF');
  assert.equal(classifyUnifiedBusiness('CC002','SHOPEEVN','').businessType,'SHOPEEVN');
  assert.equal(classifyUnifiedBusiness('CC003','SHOPEECN','').businessType,'SHOPEECN');
  assert.equal(classifyUnifiedBusiness('CC004','ALI1688','').businessType,'ALI1688');
  assert.equal(classifyUnifiedBusiness('TBKH0001','','').businessType,'TBKH');
  assert.equal(classifyUnifiedBusiness('CE0001','','').businessType,'WHPP');
  assert.equal(classifyUnifiedBusiness('CC0001','','').businessType,'CE');
  assert.equal(classifyUnifiedBusiness('ZZ0001','',''),null);
  assert.equal(classifyUnifiedBusiness('CE0002','SHOPEECN','').businessType,'SHOPEECN');
});

test('V246 terminal owner distinguishes POD completed return open return and cancellation',()=>{
  assert.deepEqual(
    Object.fromEntries(Object.entries(classifyV246Terminal({stateJson:{orderStatus:'85'}})).filter(([key])=>['terminal','pod','returned','cancelled','reason'].includes(key))),
    {terminal:true,pod:true,returned:false,cancelled:false,reason:'POD'}
  );
  assert.equal(classifyV246Terminal({stateJson:{latestTrackStatusCode:'86'}}).reason,'RETURNED');
  assert.equal(classifyV246Terminal({stateJson:{orderStatus:'100'}}).reason,'RETURNED');
  assert.equal(classifyV246Terminal({state:'RETURN_IN_PROGRESS',stateJson:{退回状态:'退回处理中'}}).terminal,false);
  assert.equal(classifyV246Terminal({stateJson:{orderStatus:'10'}}).reason,'ORDER_CANCELLED');
});

test('manual refresh endpoint is single-flight and uses OPEN carry worker only',()=>{
  const endpoint=read('src/v29EndpointAliasPatch.js');
  const scheduler=read('src/carryoverRefreshScheduler.js');
  assert.match(endpoint,/post\('\/api\/manual-open-refresh'/);
  assert.match(endpoint,/manualRefreshRequestInFlight/);
  assert.match(endpoint,/refreshOpenCarryNow\(\{reason:'MANUAL_USER_REFRESH'\}\)/);
  assert.match(scheduler,/carryover_open_items WHERE status='OPEN'/);
  assert.doesNotMatch(scheduler,/TWO_HOUR_OPEN_REFRESH/);
  assert.doesNotMatch(scheduler,/CAMBODIA_DAY_ROLLOVER_0005/);
});

test('manual refresh publication binds pseudo refresh state back to exact saved business membership',()=>{
  const endpoint=read('src/v29EndpointAliasPatch.js');
  const publication=read('src/manualRefreshPublication.js');
  assert.match(endpoint,/publishManualRefreshTruth\(result\.refreshId\)/);
  assert.match(endpoint,/MANUAL_REFRESH_PUBLICATION_UNBOUND/);
  assert.match(publication,/PARTITION BY UPPER\(COALESCE\(u\.businessType,''\)\),u\.shipmentCode/);
  assert.match(publication,/c\.businessType,''\)\)=UPPER\(COALESCE\(u\.businessType,''\)\)/);
  assert.match(publication,/UPDATE shipment_current_state SET snapshotId=\?,reportDate=\?,updatedAt=\?/);
  assert.match(publication,/sourceSnapshotId/);
  assert.match(publication,/sourceReportDate/);
  assert.match(publication,/__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__/);
});

test('manual terminal publication prevents already-closed parcels from remaining in scan retry pools',()=>{
  const publication=read('src/manualRefreshPublication.js');
  assert.match(publication,/UPDATE scan_results SET isPod=\?,needsTrackQuery=0,skipTrackReason=\?/);
  assert.match(publication,/UPDATE business_scan_results SET isPod=\?,needsTrackQuery=0,skipTrackReason=\?/);
  assert.match(publication,/MANUAL_TERMINAL_POD/);
  assert.match(publication,/MANUAL_TERMINAL_RETURNED/);
  assert.match(publication,/MANUAL_TERMINAL_CANCELLED/);
});

test('manual refresh canonicalizes exact V246 POD return and cancellation truth before carry closure',()=>{
  const scheduler=read('src/carryoverRefreshScheduler.js');
  assert.match(scheduler,/import \{ classifyV246Terminal \} from '\.\/v246TrackingLedgerCore\.js'/);
  assert.match(scheduler,/classifyV246Terminal\(\{/);
  assert.match(scheduler,/currentState: 'POD'/);
  assert.match(scheduler,/dynamicCarryRule: 'CLOSE_POD'/);
  assert.match(scheduler,/currentState: 'RETURN_COMPLETED'/);
  assert.match(scheduler,/退回状态: '已退回'/);
  assert.match(scheduler,/dynamicCarryRule: 'CLOSE_RETURNED'/);
  assert.match(scheduler,/currentState: 'ORDER_CANCELLED'/);
});

test('manual refresh persists only analyzed finalRows and fails closed on partial raw tracking state',()=>{
  const scheduler=read('src/carryoverRefreshScheduler.js');
  assert.match(scheduler,/const candidateRows = Array\.isArray\(outputState\.finalRows\) \? outputState\.finalRows : \[\];/);
  assert.doesNotMatch(scheduler,/candidateRows = .*trackResults/);
});

test('manual refresh persists refreshed truth before closing carry ledger so dashboard cannot stay stale',()=>{
  const scheduler=read('src/carryoverRefreshScheduler.js');
  assert.match(scheduler,/sourceReportDate:/);
  assert.match(scheduler,/persistManualRefreshFinalTruth/);
  assert.match(scheduler,/INSERT INTO final_rows/);
  assert.match(scheduler,/INSERT INTO business_final_rows/);
  assert.match(scheduler,/UPDATE final_rows SET/);
  assert.match(scheduler,/UPDATE business_final_rows SET/);
  assert.match(scheduler,/shopState=\?/);
  assert.match(scheduler,/podAttemptNo=\?/);
  assert.match(scheduler,/MANUAL_REFRESH_SOURCE_BINDING_MISSING/);
  const finalSync=scheduler.indexOf('persistManualRefreshFinalTruth(rows, db)');
  const carrySync=scheduler.indexOf('updateCarryoverResults({ snapshotId, reportDate, rows })');
  assert.ok(finalSync>=0&&carrySync>finalSync,'final dashboard truth must persist before carry ledger close');
});

test('live dashboard trend rendering is removed while export source remains intact',()=>{
  const dashboard=read('public/dashboard-v18.js');
  const v14=read('public/v14-geometry-fixture.js');
  const exporter=read('src/shopeeTemplateExporter.js');
  assert.doesNotMatch(dashboard,/RateTrendCardV18\.render/);
  assert.doesNotMatch(dashboard,/<section class=\\"v18-panel v18-trend-section\\">/);
  assert.match(v14,/manualLatestDataRefresh/);
  assert.match(v14,/\/api\/manual-open-refresh/);
  assert.match(v14,/suppressLegacyTrends/);
  assert.match(exporter,/fillDailySummary/);
  assert.match(exporter,/看板首页/);
});

test('repository spreadsheet template remains byte-for-byte pinned',()=>{
  const template=fs.readFileSync(path.join(root,'templates','shopee_daily_dashboard_template.xlsx'));
  const gitBlob=crypto.createHash('sha1').update(Buffer.from(`blob ${template.length}\0`)).update(template).digest('hex');
  assert.equal(gitBlob,'920efb8ae692dc6f3a6312351851e67be8c6dac0');
});

test('formal V200 workbook layout contract keeps exact ten sheets headers and dashboard drilldown targets',()=>{
  const workbook=read('src/v200ReferenceWorkbook.js');
  const expectedSheets=['全部明细','金边明细','外省明细','门店明细','POD明细','未POD明细','分配派送中明细','Pending明细','退回明细'];
  const expectedHeaders=['日期','运单编号','下单时间','状态标识','状态说明','收件省份','区域分类','当前门店','当前省份','收件人','收件人手机','收件地址','派件时间','派件门店','派件省份','派件快递员','异常编码','异常描述','备注'];
  assert.match(workbook,/addWorksheet\('每日看板'/);
  for(const name of expectedSheets)assert.match(workbook,new RegExp(`'${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}'`));
  for(const header of expectedHeaders)assert.match(workbook,new RegExp(`'${header.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}'`));
  const cardTargets=[['总票数','全部明细'],['金边票数','金边明细'],['外省票数','外省明细'],['门店票数','门店明细'],['POD票数','POD明细'],['未POD票数','未POD明细'],['分配派送中','分配派送中明细'],['退回票数','退回明细']];
  for(const [label,target] of cardTargets)assert.match(workbook,new RegExp(`'${label}'.*'${target}'`));
  assert.match(workbook,/for\(const name of DETAIL_SHEETS\)/);
});

test('seven-business import and direct export both have fail-closed conservation gates',()=>{
  const parser=read('src/unifiedExcelParser.js');
  const exporter=read('src/v142SevenBusinessPeriodExporter.js');
  assert.match(parser,/SOURCE_CLASSIFICATION_RECONCILIATION_FAILED/);
  assert.match(parser,/UNCLASSIFIED_WAYBILL_PREFIX/);
  assert.match(exporter,/导出前七板块守恒失败/);
  assert.match(exporter,/uniqueBills\.size!==expected/);
  assert.match(exporter,/latestManualStateApplied:true/);
  assert.match(exporter,/shipment_current_state/);
});

test('direct generated workbook is re-opened and sheet membership is reconciled before delivery',()=>{
  const exporter=read('src/v142SevenBusinessPeriodExporter.js');
  assert.match(exporter,/validateGeneratedWorkbook/);
  assert.match(exporter,/REQUIRED_DETAIL_SHEETS/);
  assert.match(exporter,/POD\/未POD守恒失败/);
  assert.match(exporter,/退回明细出现POD或非全部明细成员/);
  assert.match(exporter,/Excel PP\/PV守恒失败/);
  assert.match(exporter,/workbookChecks/);
});

test('actual async V200 export path consumes canonical V419 latest-state truth',()=>{
  const exporter=read('src/v225ExportReturnTruth.js');
  const ledger=read('src/v419CanonicalExportLedgerTruth.js');
  assert.match(exporter,/applyV419CanonicalExportLedgerTruth/);
  assert.match(exporter,/formal export now goes membership → canonical V419 ledger/);
  assert.match(ledger,/qc_tracking_ledger/);
  assert.match(ledger,/currentStateJson/);
  assert.match(ledger,/terminalReason/);
});

test('actual async V200 export path has mutually exclusive status and live-bucket conservation',()=>{
  const launcher=read('src/v84ExportBusinessWorker.js');
  const exporter=read('src/v200TemplateDashboardExporter.js');
  const metrics=read('src/v200Metrics.js');
  const truth=read('src/v225ExportReturnTruth.js');
  assert.match(launcher,/createV200ReferenceDashboardWorkbook/);
  assert.match(exporter,/assertV200BucketConservation/);
  assert.match(exporter,/workbookReconciliation/);
  assert.match(metrics,/V200_STATUS_BUCKET_RECONCILIATION_FAILED/);
  assert.match(metrics,/V200_LIVE_BUCKET_CONTAINS_TERMINAL/);
  assert.match(metrics,/'门店明细': filter\(row => !row\.pod && !row\.returned && row\.store\)/);
  assert.match(metrics,/'分配派送中明细': filter\(row => !row\.pod && !row\.returned && row\.delivering\)/);
  assert.match(metrics,/'Pending明细': filter\(row => !row\.pod && !row\.returned && row\.pending\)/);
  assert.match(truth,/row\.store=false/);
  assert.match(truth,/row\.currentShop=''/);
});

test('actual async V200 workbook is stream-validated after file write without loading the whole workbook',()=>{
  const exporter=read('src/v200TemplateDashboardExporter.js');
  assert.match(exporter,/ExcelJS\.stream\.xlsx\.WorkbookReader/);
  assert.match(exporter,/V200_REQUIRED_DETAIL_SHEETS/);
  assert.match(exporter,/V200_WRITTEN_WORKBOOK_SHEET_MISSING/);
  assert.match(exporter,/V200_WRITTEN_WORKBOOK_ROW_MISMATCH/);
  assert.match(exporter,/writtenWorkbookCheck=await validateWrittenV200Workbook\(file,bucket\)/);
});

test('formal export bucket conservation excludes terminal parcels from all live problem sheets',()=>{
  const rows=[
    {shipmentCode:'A',reportMembershipDate:'2026-09-12',dailyMembershipDates:['2026-09-12'],businessType:'SHOPEECN',area:'金边',pod:true,returned:false,store:true,pending:true,delivering:true},
    {shipmentCode:'B',reportMembershipDate:'2026-09-12',dailyMembershipDates:['2026-09-12'],businessType:'SHOPEECN',area:'外省',pod:false,returned:true,store:true,pending:true,delivering:true},
    {shipmentCode:'C',reportMembershipDate:'2026-09-12',dailyMembershipDates:['2026-09-12'],businessType:'SHOPEECN',area:'金边',pod:false,returned:false,store:true,pending:true,delivering:false}
  ];
  const bucket=bucketRows(rows);
  const result=assertV200BucketConservation(bucket,{businessType:'SHOPEECN'});
  assert.equal(result.status,'PASSED');
  assert.deepEqual({all:result.all,pod:result.pod,returned:result.returned,notPod:result.notPod,store:result.store,pending:result.pending},
    {all:3,pod:1,returned:1,notPod:1,store:1,pending:1});
  assert.equal(bucket['门店明细'][0].shipmentCode,'C');
  assert.equal(bucket['Pending明细'][0].shipmentCode,'C');
  assert.equal(bucket['分配派送中明细'].length,0);
});

test('Shopee formal export rejects any PP/PV region gap instead of silently dropping it',()=>{
  const rows=[
    {shipmentCode:'A',reportMembershipDate:'2026-09-12',dailyMembershipDates:['2026-09-12'],businessType:'SHOPEEVN',area:'金边',pod:false,returned:false},
    {shipmentCode:'B',reportMembershipDate:'2026-09-12',dailyMembershipDates:['2026-09-12'],businessType:'SHOPEEVN',area:'',pod:false,returned:false}
  ];
  assert.throws(()=>assertV200BucketConservation(bucketRows(rows),{businessType:'SHOPEEVN'}),/V200_REGION_BUCKET_RECONCILIATION_FAILED/);
});

test('terminal POD and returned parcels are removed from direct-export live Pending delivery and store buckets',()=>{
  const exporter=read('src/v142SevenBusinessPeriodExporter.js');
  assert.match(exporter,/RETURN_COMPLETED\|RETURNED/);
  assert.match(exporter,/out\.currentStore=''/);
  assert.match(exporter,/out\.pendingUniqueDayCount=0/);
  assert.match(exporter,/out\.pendingDays=0/);
  assert.match(exporter,/out\.Pending天数=0/);
});

test('classification summary exposes CEAF and WHPP so displayed totals cannot look short',()=>{
  const ui=read('public/v29-data-consistency-fix.js');
  assert.match(ui,/\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]/);
  assert.match(ui,/七板块合计/);
  assert.match(ui,/分类守恒/);
});
