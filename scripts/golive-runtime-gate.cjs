const fs = require('fs');

const read = p => fs.readFileSync(p, 'utf8');
const runner = read('public/v67-resilient-run-guard.js');
const pause = read('public/v164-unified-pause-router.js');
const shell = read('src/v44WhppUiPatch.js');
const storage = read('src/storage.js');
const bstore = read('src/businessStore.js');
const v108 = read('public/v108-route-lazy-features.js');
const tokenExportUi = read('public/v194-export-token-ui.js');
const exportSidecar = read('src/v193ExportSidecar.js');
const singleExportWorker = read('src/v183SingleBusinessExportJobWorker.js');
const allBusinessChild = read('src/v84ExportBusinessWorker.js');
const v200Metrics = read('src/v200Metrics.js');
const v200Workbook = read('src/v200ReferenceWorkbook.js');
const v200Exporter = read('src/v200TemplateDashboardExporter.js');
const v202Truth = read('src/v202DeliveryTruth.js');
const v202Carry = read('src/v202CarryTrackingCenterPatch.js');
const v202CarryUi = read('public/v202-carry-tracking-center.js');
const v202DisableLegacy = read('src/v202DisableLegacyTrackerPatch.js');
const v203ManualStore = read('src/v203ManualEvidenceStore.js');
const v203ManualPatch = read('src/v203ManualQueryPersistencePatch.js');
const v203Integrity = read('src/v203DashboardIntegrityPatch.js');
const v203Ui = read('public/v203-dashboard-integrity.js');
const shopeeAnalyzer = read('src/shopeeAnalyzer.js');
const shopeeAnalyzerV33 = read('src/shopeeAnalyzerV33.js');
const shopeeReporting = read('src/shopeeReporting.js');
const historyRefresh = read('src/v183HistoricalStatusRefreshPatch.js');
const asyncExportLauncher = read('src/v84AsyncExportPatch.js');

const must = (source, token) => { if (!source.includes(token)) throw new Error(`GOLIVE missing ${token}`); };
const forbid = (source, token) => { if (source.includes(token)) throw new Error(`GOLIVE retired token ${token}`); };

must(runner, '2026-08-17-v165-seven-business-stage-verification-v2');
must(runner, "{ key: 'CCSL'");
must(runner, "{ key: 'SHOPEE'");
must(runner, "{ key: 'WHPP'");
must(runner, '/api/run');
must(runner, '/api/shopee/run/start');
must(runner, '/api/whpp/run/start');
must(pause, 'global.pauseUnified=pauseUnified');
must(storage, 'compactStateForPersistence');
must(bstore, 'compactBusinessStatePayload');

must(v108, '/v194-export-token-ui.js?v=20260818-v195-1');
must(tokenExportUi, '/api/v194/export-period/prepare');
must(tokenExportUi, 'XMLHttpRequest');
must(exportSidecar, 'IPC_MEMORY_V195');
must(exportSidecar, "stdio: ['ignore', 'ignore', 'ignore', 'ipc']");
must(asyncExportLauncher, 'ONE_WORKBOOK_PER_BUSINESS_V185_ONE_PASS_STREAM');
must(singleExportWorker, 'createV200ReferenceDashboardWorkbook');
must(allBusinessChild, 'createV200ReferenceDashboardWorkbook');

// V203 real attempt and signing-day truth.
must(v202Truth, '2026-08-18-v203-real-delivery-cycle-manual-evidence-v3');
must(v202Truth, "code === '4003'");
must(v202Truth, "code === '70'");
must(v202Truth, "code === '150'");
must(v202Truth, "code === '80'");
must(v202Truth, 'Repeated START scans while the same attempt is still open never create a new attempt');
must(v202Truth, 'Only a NEW START after a failed attempt opens attempt 2/3+');
must(v202Truth, 'Elapsed calendar days, code60 assignment and raw Pending count NEVER manufacture an attempt');
must(v202Truth, "status === 'W' || status === 'Y'");
must(v202Truth, 'listV203ManualEvidence');
must(v202Truth, 'metricEligible:false');
must(v202Truth, "sourceOrigin:'MANUAL_QUERY'");
must(v202Truth, "signDaySource = row.deliveryDays ? '下单时间→真实POD时间（自然日，首尾计1天）'");

must(shopeeAnalyzer, "from './shopeeAnalyzerV33.js'");
must(shopeeAnalyzerV33, 'resolveV202AttemptCycle');
must(shopeeAnalyzerV33, "code==='4003'||code==='70'");
must(shopeeAnalyzerV33, 'Code 60 is assignment only and is excluded');
must(shopeeReporting, 'V202: no reportDate->POD elapsed-day fallback');
must(shopeeReporting, 'deliveryAttemptCurrent(row) >= 1');
must(shopeeReporting, 'dispatchAttemptDenominator: pod.length');
must(shopeeReporting, 'current.total - current.pod - current.returned - current.cancelled');
forbid(shopeeReporting, "Date.parse(`${start}T00:00:00+07:00`)");

// Export includes manual evidence rows in detail while keeping official daily KPI membership unchanged.
must(v200Metrics, 'if (row.metricEligible === false)');
must(v200Metrics, 'stat.evidenceOnly++');
must(v200Metrics, "'未POD明细': filter(openUnpod)");
must(v200Metrics, "else if (row.returned)");
must(v200Metrics, "else if (row.cancelled)");
must(v200Workbook, 'HYPERLINK');
must(v200Workbook, "workbook.addWorksheet('每日看板'");
must(v200Workbook, "'派次与平均签收天数'");
must(v200Workbook, '真实派送周期计算');
must(v200Workbook, '下单日期→实际POD签收日期');
must(v200Exporter, 'collectV202Rows');
must(v200Exporter, '_V203.xlsx');
must(v200Exporter, 'manualEvidenceOnly');
must(v200Exporter, 'exportedDetailRows');
must(v200Exporter, 'MANUAL_QUERY_ROWS_INCLUDED_IN_DETAILS_BUT_EXCLUDED_FROM_OFFICIAL_DAILY_KPI_DENOMINATOR_UNLESS_DAILY_MEMBER');
must(v200Exporter, 'ORDER_DATE_TO_ACTUAL_POD_DATE_INCLUSIVE');
must(v200Exporter, 'POD_RETURN_CANCELLED_EXCLUDED_FROM_ANOMALY_AND_UNPOD');

// Manual query is exact seven-business and persisted, not browser-only.
must(v203ManualStore, 'manual_query_evidence');
for (const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']) must(v203ManualStore, `'${type}'`);
must(v203ManualStore, "sourceOrigin:'MANUAL_QUERY'");
must(v203ManualStore, 'auditV203Waybills');
must(v203ManualPatch, "'/api/track-query'");
must(v203ManualPatch, 'persistV203ManualQuery');
must(v203ManualPatch, '/api/v203/waybill-audit');
must(v203ManualPatch, '/api/v203/manual-evidence/status');

// Total/Shopee dashboard must expose real 1/2/3 attempts and retire the low-value panels called out by QC.
must(v203Integrity, '/api/v203/attempt-summary');
must(v203Integrity, '/api/v203/network-access');
must(v203Integrity, '派次占比以POD票数为分母');
must(v203Ui, '真实1/2/3派 POD');
must(v203Ui, '派次证据不足');
must(v203Ui, '手动查询补录');
must(v203Ui, '实时状态分布');
must(v203Ui, '今日核心指标复核');
must(v203Ui, '盘点节点分布');
must(v203Ui, '收件省份 / 末端地点');
must(v203Ui, '精确业务板块');
for (const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']) must(v203Ui, `'${type}'`);

// One consolidated seven-business carry/anomaly center.
must(v202Carry, '2026-08-18-v202-seven-business-carry-tracking-center-v2');
for (const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']) must(v202Carry, `'${type}'`);
must(v202Carry, '/api/v202/carry/summary');
must(v202Carry, '/api/v202/carry/rows');
must(v202Carry, '/api/v202/carry/refresh');
must(v202Carry, '/api/v202/carry/export.xlsx');
must(v202Carry, 'if(cls.terminal) return false');
must(v202Carry, 'while(true)');
must(v202Carry, "status:'WAITING'");
must(v202CarryUi, '跨日遗留追踪中心');
must(v202CarryUi, '七业务当前异常明细');
must(v202CarryUi, 'POD、退回、取消订单不计异常');
must(v202CarryUi, '刷新所选业务最新状态');
must(v202CarryUi, '导出当前筛选Excel');

must(shell, 'v203ManualQueryPersistencePatch.js');
must(shell, 'v203DashboardIntegrityPatch.js');
must(shell, '/v203-dashboard-integrity.js?v=20260818-v203-1');
must(shell, 'v202CarryTrackingCenterPatch.js');
must(shell, '/v202-carry-tracking-center.js?v=20260818-v202-2');
forbid(shell, '<script src="/v139-carry-manual-window.js');
forbid(shell, '<script src="/v183-history-refresh.js');

must(v202DisableLegacy, "CE_QC_DISABLE_SHOPEE_DELIVERY_TRACKER='1'");
must(v202DisableLegacy, 'CE_QC_ENABLE_LEGACY_V201_TRACKER');
must(historyRefresh, '/api/v183/history-refresh/summary');
must(historyRefresh, '/api/v183/history-refresh/start');

for (const source of [runner, pause, shell, storage, bstore]) forbid(source, 'v148-direct-daily-runner-v1');

console.log('[GOLIVE] V203 gate passed: real delivery cycles own 1/2/3 attempt POD, manual query evidence is persistent and export-complete without altering official daily KPI denominators, terminal POD/return/cancel is excluded from anomalies/unPOD, and the UI exposes seven-business audit + useful attempt/network panels.');
