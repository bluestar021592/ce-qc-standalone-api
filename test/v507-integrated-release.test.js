import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const count=(text,pattern)=>(text.match(pattern)||[]).length;

test('V507 integrated route owner contains V505 purge guards, manual refresh, and V506 auth bridge exactly once',()=>{
  const source=read('src/v29EndpointAliasPatch.js');
  assert.equal(count(source,/import '\.\/v506LocalAuthBridgePatch\.js';/g),1);
  assert.equal(count(source,/this\.post\('\/api\/manual-open-refresh',manualOpenRefresh\)/g),1);
  assert.equal(count(source,/route==='\/api\/admin\/data-purge\/prepare'/g),1);
  assert.equal(count(source,/route==='\/api\/admin\/data-purge\/execute'/g),1);
  assert.match(source,/v505PurgeWriteFreezeGuard/);
  assert.match(source,/v505PurgePublicStatusGuard/);
  assert.match(source,/refreshOpenCarryNow\(\{reason:'MANUAL_USER_REFRESH'\}\)/);
  const authImport=source.indexOf("import './v506LocalAuthBridgePatch.js';");
  const v505UseWrapper=source.indexOf('const previousUse=express.application.use;');
  assert.ok(authImport>=0&&v505UseWrapper>authImport,'V506 auth bridge must patch express.use before the V505 wrapper captures it');
});

test('V507 browser fixture keeps V505 purge owner and manual-refresh/no-trend mode together',()=>{
  const source=read('public/v14-geometry-fixture.js');
  const legacyTrendMount=read('public/v27-trend-mount-fix.js');
  assert.equal(count(source,/v505-data-purge-recovery\.js\?v=20260911-v505-8/g),1);
  assert.equal(count(source,/v502-multidrive-backup-ui\.js\?v=20260912-v502-3/g),1);
  assert.equal(count(source,/installManualRefreshAndNoTrendMode/g),1);
  assert.equal(count(source,/manualLatestDataRefresh/g),2);
  assert.match(source,/\/api\/manual-open-refresh/);
  assert.match(source,/renderHomeTrends = function\(\)\{ return ''; \}/);
  assert.match(source,/window\.__CE_QC_LIVE_TRENDS_DISABLED__ = true/);
  assert.doesNotMatch(source,/loadRuntimeScript\('\/v27-trend-mount-fix\.js/);
  assert.match(source,/#v27ForcedAttemptTrend/);
  assert.match(source,/#v27ForcedHomeAttemptTrends/);
  const disableGuard=legacyTrendMount.indexOf('if (global.__CE_QC_LIVE_TRENDS_DISABLED__ === true) return;');
  const typeMap=legacyTrendMount.indexOf('const TYPE_BY_PAGE=');
  assert.ok(disableGuard>=0&&typeMap>disableGuard,'legacy V27 trend owner must fail closed before it can schedule API work');
});

test('V509 removes residual live trend workers from the active shell while preserving WHPP click-through detail',()=>{
  const shell=read('src/v44WhppUiPatch.js');
  const detail=read('public/v509-whpp-detail-only.js');
  assert.doesNotMatch(shell,/v56-trend-truth\.js/,'V56 must not run background trend fetches on live dashboards');
  assert.doesNotMatch(shell,/v152-whpp-trend\.js/,'legacy WHPP trend renderer must not be live-mounted');
  assert.match(shell,/v509-whpp-detail-only\.js\?v=20260913-v509-1/);
  assert.match(shell,/2026-09-13-v509-no-live-trend-shell-v1/);
  assert.match(detail,/\/api\/v172\/whpp-metric-detail/);
  assert.match(detail,/global\.openWhppV132Detail/);
  assert.doesNotMatch(detail,/\/api\/v171\/whpp-trends/);
  assert.doesNotMatch(detail,/\/api\/v27\/trends/);
  assert.doesNotMatch(detail,/RateTrendCardV18/);
});

test('V510 fail-closes suspicious skipped sheets and gates seven-business source conservation',()=>{
  const parser=read('src/unifiedExcelParser.js');
  const workflow=read('.github/workflows/go-live-preflight.yml');
  const sourceWorkflow=read('.github/workflows/source-foundation-six-businesses.yml');
  assert.match(parser,/HEADER_SCAN_LIMIT = 120/);
  assert.match(parser,/UNRECOGNIZED_WAYBILL_SHEET/);
  assert.match(parser,/assertNoSuspiciousSkippedWaybills/);
  assert.match(parser,/suspectedWaybills/);
  assert.match(parser,/WHPP/);
  assert.match(workflow,/Seven-business source no-loss and classification regression/);
  assert.match(workflow,/test\/unified-import-no-silent-skip\.test\.js/);
  assert.match(sourceWorkflow,/Source foundation seven-business regression/);
  assert.match(sourceWorkflow,/test\/unified-import-no-silent-skip\.test\.js/);
});

test('V511 blocks duplicate cross-business classification, removes historical CE fallback, and reconciles export per business',()=>{
  const parser=read('src/unifiedExcelParser.js');
  const store=read('src/unifiedImportStore.js');
  const exporter=read('src/v142SevenBusinessPeriodExporter.js');
  const workflow=read('.github/workflows/go-live-preflight.yml');
  const sourceWorkflow=read('.github/workflows/source-foundation-six-businesses.yml');
  assert.match(parser,/DUPLICATE_BUSINESS_CLASSIFICATION_CONFLICT/);
  assert.match(parser,/自动分类错票/);
  assert.match(store,/businessType: resolvedType/);
  assert.match(store,/'UNCLASSIFIED'/);
  assert.match(store,/历史跨日件缺少可靠业务归属，未兜底到CE/);
  assert.doesNotMatch(store,/businessType: importedType \|\| item\.businessType \|\| 'CE'/);
  assert.match(exporter,/V511_SEVEN_BUSINESS_COUNT_RECONCILIATION_ID/);
  assert.match(exporter,/reconcileSevenBusinessSnapshotCounts/);
  assert.match(exporter,/mismatchedTypes/);
  assert.match(exporter,/导出前七板块逐板守恒失败/);
  assert.match(exporter,/导出交付前七板块最终守恒失败/);
  for(const file of ['unified-import-duplicate-classification','unified-partition-carry-business']){
    assert.match(sourceWorkflow,new RegExp(`test\\/${file}\\.test\\.js`));
    assert.match(workflow,new RegExp(`test\\/${file}\\.test\\.js`));
  }
  assert.match(workflow,/test\/seven-business-export-classification-reconciliation\.test\.js/);
  assert.match(workflow,/V511 seven-business export classification reconciliation/);
});

test('V512 protects exact WHPP source membership instead of count-only equality',()=>{
  const guard=read('src/v512WhppSourceMembershipGuard.js');
  const allWorker=read('src/v473AllBusinessExportWorker.js');
  const singleWorker=read('src/v183SingleBusinessExportJobWorker.js');
  const workflow=read('.github/workflows/go-live-preflight.yml');
  assert.match(guard,/WHPP_SOURCE_MEMBERSHIP_CONSERVATION_FAILED/);
  assert.match(guard,/missingFromProcessed/);
  assert.match(guard,/unexpectedProcessed/);
  assert.match(guard,/processedDuplicateRows/);
  assert.match(allWorker,/assertWhppSourceMembershipRange/);
  assert.match(singleWorker,/assertWhppSourceMembershipRange/);
  assert.match(workflow,/V512 WHPP source membership conservation/);
  assert.match(workflow,/test\/v512-whpp-source-membership-guard\.test\.js/);
});

test('V513 blocks hidden shipment sheets and protects duplicate PP/PV attribution',()=>{
  const parser=read('src/unifiedExcelParser.js');
  const workflow=read('.github/workflows/go-live-preflight.yml');
  const sourceWorkflow=read('.github/workflows/source-foundation-six-businesses.yml');
  assert.match(parser,/HIDDEN_WAYBILL_SHEET/);
  assert.match(parser,/assertNoHiddenWaybillData/);
  assert.match(parser,/DUPLICATE_REGION_CONFLICT/);
  assert.match(parser,/DUPLICATE_REGION_ENRICHED/);
  assert.match(parser,/duplicateRegionEnrichments/);
  assert.match(parser,/为防止PP\/PV统计错位/);
  assert.match(workflow,/test\/unified-import-hidden-region-integrity\.test\.js/);
  assert.match(sourceWorkflow,/test\/unified-import-hidden-region-integrity\.test\.js/);
});

test('V514 binds final V200 export rows to exact latest VALID source members per authoritative date',()=>{
  const guard=read('src/v514CanonicalExportMembershipGuard.js');
  const exporter=read('src/v200TemplateDashboardExporter.js');
  const workflow=read('.github/workflows/go-live-preflight.yml');
  assert.match(guard,/V514_CANONICAL_EXPORT_MEMBERSHIP_MISMATCH/);
  assert.match(guard,/latestValidBatches/);
  assert.match(guard,/missingFromExport/);
  assert.match(guard,/unexpectedInExport/);
  assert.match(guard,/authoritativeDays/);
  assert.match(exporter,/assertV514CanonicalExportMembership/);
  const collectAt=exporter.indexOf('await collectV200Rows');
  const guardAt=exporter.indexOf('const canonicalMembership = assertV514CanonicalExportMembership');
  const writeAt=exporter.indexOf('writeV200ReferenceWorkbook({ file');
  assert.ok(collectAt>=0&&guardAt>collectAt&&writeAt>guardAt,'V514 membership guard must run after row collection and before workbook write');
  assert.match(workflow,/V514 canonical V200 source membership conservation/);
  assert.match(workflow,/test\/v514-canonical-export-membership-guard\.test\.js/);
});

test('V507 disables startup and timed dashboard-cache refresh while preserving event-driven cache rebuilds',()=>{
  const routeOwner=read('src/v29EndpointAliasPatch.js');
  const timerGuard=read('src/v507ManualDashboardCacheMode.js');
  const server=read('server.js');
  assert.match(routeOwner,/wrapV507ManualOnlyListenCallback/);
  assert.match(routeOwner,/listenArgs\[callbackIndex\]=wrapV507ManualOnlyListenCallback/);
  assert.match(timerGuard,/STARTUP_WARM\|TEN_MINUTE_REFRESH/);
  assert.match(timerGuard,/launchDashboardCacheWorker/);
  assert.match(timerGuard,/globalThis\.setTimeout/);
  assert.match(timerGuard,/globalThis\.setInterval/);
  assert.match(timerGuard,/startup\/timed dashboard-cache refresh disabled/);
  assert.match(server,/launchDashboardCacheWorker\(\{ reportDate: parsed\.reportDate, reason: 'UNIFIED_IMPORT' \}\)/);
  assert.match(server,/launchDashboardCacheWorker\(\{ reportDate, reason: 'CCSL_RUN_COMPLETED' \}\)/);
  assert.match(server,/launchDashboardCacheWorker\(\{ reportDate, reason: 'SHOPEE_RUN_COMPLETED' \}\)/);
});

test('V507 manual refresh does not report success until derived dashboard truth is rebuilt and the fast read cache has expired',()=>{
  const routeOwner=read('src/v29EndpointAliasPatch.js');
  const publication=read('src/manualRefreshPublication.js');
  const rangeStore=read('src/rangeDashboardStore.js');
  const server=read('server.js');
  assert.match(publication,/__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__/);
  assert.match(rangeStore,/globalThis\.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__ = refreshLedgerDerivedDashboardDates/);
  assert.match(rangeStore,/refreshDashboardCacheDate\(date, \{ force: true \}\)/);
  assert.match(routeOwner,/MANUAL_REFRESH_FAST_READ_CACHE_TTL_MS=3000/);
  assert.match(routeOwner,/MANUAL_REFRESH_DASHBOARD_REFRESH_FAILED/);
  assert.match(routeOwner,/await waitUntilManualRefreshDashboardReadable\(publication\)/);
  assert.match(server,/Date\.now\(\) - cached\.at < 3000/);
  const publishAt=routeOwner.indexOf('publishManualRefreshTruth(result.refreshId)');
  const settleAt=routeOwner.indexOf('await waitUntilManualRefreshDashboardReadable(publication)');
  const successAt=routeOwner.indexOf('res.json({ok:true,manualOnly:true');
  assert.ok(publishAt>=0&&settleAt>publishAt&&successAt>settleAt,'manual refresh must rebuild/settle dashboard reads before reporting success');
});

test('V508 routes exact business export buttons through V473/V200 canonical latest-state export and blocks legacy aggregate snapshot export',()=>{
  const loader=read('public/v194-export-token-ui.js');
  const route=read('public/v508-canonical-business-export-route.js');
  assert.match(loader,/v508-canonical-business-export-route\.js\?v=20260913-v508-2/);
  assert.match(route,/global\.exportBusiness=async function v508ExportBusiness/);
  assert.match(route,/__CE_QC_V473_EXPORT_UI__/);
  assert.match(route,/return owner\.startExport\(button\)/);
  assert.match(route,/currentBusinessType\(\)/);
  assert.match(route,/global\.location\?\.pathname/);
  for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'])assert.match(route,new RegExp(`'${type}'`));
  assert.match(route,/\['ALL','管理汇总 \+ 七业务'\]/);
  assert.match(route,/legacy==='CCSL'\|\|legacy==='SHOPEE'/);
  assert.match(route,/综合旧版快照导出已停用/);
  assert.doesNotMatch(route,/\/api\/export-period\/prepare/,'V508 must never fall back to the legacy 5177 snapshot exporter');
});

test('go-live workflow gates the combined V505 through V514 candidate',()=>{
  const workflow=read('.github/workflows/go-live-preflight.yml');
  assert.match(workflow,/node --test test\/v507-integrated-release\.test\.js/);
  assert.match(workflow,/node --test test\/manual-refresh-export-integrity\.test\.js/);
  assert.match(workflow,/node --test test\/v506-local-auth-bridge\.test\.js/);
  assert.match(workflow,/node --check src\/unifiedExcelParser\.js/);
  assert.match(workflow,/node --check src\/unifiedImportStore\.js/);
  assert.match(workflow,/node --check src\/v142SevenBusinessPeriodExporter\.js/);
  assert.match(workflow,/node --check src\/v183SingleBusinessExportJobWorker\.js/);
  assert.match(workflow,/node --check src\/v512WhppSourceMembershipGuard\.js/);
  assert.match(workflow,/node --check src\/v514CanonicalExportMembershipGuard\.js/);
  assert.match(workflow,/node --check src\/v505PurgeExecuteReadOnlyPreflight\.js/);
  assert.match(workflow,/node --check src\/v506LocalAuthBridgePatch\.js/);
  assert.match(workflow,/node --check src\/v507ManualDashboardCacheMode\.js/);
  assert.match(workflow,/node --check public\/v27-trend-mount-fix\.js/);
  assert.match(workflow,/node --check public\/v508-canonical-business-export-route\.js/);
  assert.match(workflow,/node --check public\/v509-whpp-detail-only\.js/);
  assert.match(workflow,/npm run test:ci/);
  assert.match(workflow,/Final state-machine regression/);
});

test('integrated candidate retains the exact component regression sources',()=>{
  for(const file of [
    'test/unified-import-no-silent-skip.test.js',
    'test/unified-import-duplicate-classification.test.js',
    'test/unified-import-hidden-region-integrity.test.js',
    'test/unified-partition-carry-business.test.js',
    'test/seven-business-export-classification-reconciliation.test.js',
    'test/v512-whpp-source-membership-guard.test.js',
    'test/v514-canonical-export-membership-guard.test.js',
    'test/manual-refresh-export-integrity.test.js',
    'test/v506-local-auth-bridge.test.js',
    'test/v505-purge-execute-readonly-preflight.test.js',
    'test/v505-purge-worker-db-init-failsafe.test.js',
    'src/manualRefreshPublication.js',
    'src/v506LocalAuthBridgePatch.js',
    'src/v507ManualDashboardCacheMode.js',
    'src/v512WhppSourceMembershipGuard.js',
    'src/v514CanonicalExportMembershipGuard.js',
    'src/v505PurgeExecuteReadOnlyPreflight.js',
    'public/v27-trend-mount-fix.js',
    'public/v508-canonical-business-export-route.js',
    'public/v509-whpp-detail-only.js'
  ]) assert.equal(fs.existsSync(path.join(root,file)),true,`${file} missing`);
});
