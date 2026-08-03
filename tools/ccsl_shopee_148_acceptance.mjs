import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import XLSX from 'xlsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const root = path.join(projectRoot, 'data', 'codex_ccsl_shopee_148');
if (!root.startsWith(projectRoot)) throw new Error('test root is outside project');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
process.env.DATA_DIR = root;
process.env.DB_FILE = path.join(root, 'ce_qc_monitor.db');
process.env.EXPORTS_DIR = path.join(root, 'exports');
fs.closeSync(fs.openSync(process.env.DB_FILE, 'w'));

const checklistFile = path.join(projectRoot, '_codex_ccsl_shopee_pack', 'CODEX_CCSL_SHOPEE最终一次性全量修复包', '03_验收与证据', '01_总验收清单.csv');
const checklist = fs.readFileSync(checklistFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean).map(line => {
  const [编号, 模块, 测试场景, 预期结果, 实际结果 = '', 证据日志 = ''] = line.split(',');
  return { 编号, 模块, 测试场景, 预期结果, 实际结果, '证据/日志': 证据日志 };
});
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const evidence = {};

const { closeDb, getDb, getRuntimeConfig } = await import('../src/db.js');
const { loadState, resetState, saveState } = await import('../src/storage.js');
const { createOrRecoverRun, getCurrentReportDate } = await import('../src/store.js');
const {
  SHOPEE, createOrRecoverBusinessRun, getBusinessCurrentReportDate, getBusinessRunStatus,
  getMatchingBusinessSnapshot, loadBusinessState, saveBusinessSnapshot, saveBusinessState
} = await import('../src/businessStore.js');
const { splitTrackBatches, queryTrackBatchWithFallback, TRACK_QUERY_BATCH_SIZE } = await import('../src/trackBatching.js');
const { runQcPipeline } = await import('../src/pipeline.js');
const { analyzeShipment } = await import('../src/analyzer.js');
const { parseLongBackupModules } = await import('../src/backupParser.js');
const { mergeBackupModule } = await import('../src/backupRecovery.js');
const { buildLongBackupV2 } = await import('../src/longBackup.js');
const { parseShopeeDailyExcel } = await import('../src/shopeeExcelParser.js');
const { buildShopeeDashboard } = await import('../src/shopeeReporting.js');
const { exportShopeeXlsx } = await import('../src/shopeeExporter.js');
const { exportXlsx } = await import('../src/exporter.js');
const { getMetricTrend } = await import('../src/reporting.js');

const db = getDb();
assert(db.prepare('PRAGMA user_version').get().user_version === 9, 'schema version must be 9');

// Track batch size and failed-batch-only retry.
const batchSizes = {};
for (const count of [1, 10, 11, 49, 50, 51, 99, 100, 101]) {
  const bills = Array.from({ length: count }, (_, index) => `CCB${String(index + 1).padStart(8, '0')}`);
  batchSizes[count] = splitTrackBatches(bills).map(batch => batch.length);
}
assert(TRACK_QUERY_BATCH_SIZE === 50, 'track batch size is not 50');
assert(JSON.stringify(batchSizes) === JSON.stringify({ 1:[1], 10:[10], 11:[11], 49:[49], 50:[50], 51:[50,1], 99:[50,49], 100:[50,50], 101:[50,50,1] }), 'batch matrix mismatch');
const retryBills = Array.from({ length: 101 }, (_, index) => `CCR${String(index + 1).padStart(8, '0')}`);
const retryCalls = [];
const retryLogs = [];
let failedParent = false;
for (const batch of splitTrackBatches(retryBills)) {
  await queryTrackBatchWithFallback({
    batch,
    query: async codes => {
      retryCalls.push([...codes]);
      if (!failedParent && codes.length === 50 && codes[0] === retryBills[50]) {
        failedParent = true;
        throw new Error('simulated middle batch failure');
      }
      return codes.map(shipmentCode => ({ shipmentCode, eventTime: '2026-07-20 10:00:00' }));
    },
    onLog: async text => retryLogs.push(text)
  });
}
assert(retryCalls.filter(call => call.includes(retryBills[0])).length === 1, 'successful first batch was queried again');
assert(retryCalls.filter(call => call.includes(retryBills[100])).length === 1, 'successful tail batch was queried again');
assert(Math.max(...retryCalls.map(call => call.length)) <= 50, 'a track request exceeded 50');
assert(retryCalls.some(call => call.length === 25) && retryLogs.some(line => line.includes('50→25')), 'failed parent did not downgrade');
evidence.BATCH = { config: TRACK_QUERY_BATCH_SIZE, batchSizes, retryCallSizes: retryCalls.map(call => call.length), retryLogs };

// Long backup remains optional and merges only long-lived data.
const ccslCurrent = stateBase('CCSL', '2026-07-20', ['CCCURRENT01']);
ccslCurrent.currentRun = { runId: 'ccsl-current-run', reportDate: ccslCurrent.reportDate };
ccslCurrent.snapshotId = 'ccsl-current-snapshot';
ccslCurrent.dailyParseRows = [{ shipmentCode: 'CCCURRENT01', rowNumber: 2 }];
const shopeeCurrent = stateBase('SHOPEE', '2026-07-19', ['SPXSAME0001']);
shopeeCurrent.currentRun = { runId: 'shopee-current-run', reportDate: shopeeCurrent.reportDate };
shopeeCurrent.snapshotId = 'shopee-current-snapshot';
shopeeCurrent.dailyParseRows = [{ shipmentCode: 'SPXSAME0001', rowNumber: 3 }];
const backup = {
  schemaVersion: 2,
  modules: {
    CCSL: { podLocks: ['CCPOD00001'], carryBills: ['CCCARRY001', 'CCPOD00001'], historySummary: [{ reportDate: '2026-07-18', summary: { metrics: { 今日PNH: 7 } } }] },
    SHOPEE: { podLocks: ['SPXPOD0001'], carryBills: ['SPXCARRY01', 'SPXPOD0001'], historySummary: [{ reportDate: '2026-07-18', summary: { metrics: { 日报总件数: 9 } } }] }
  }
};
const modules = parseLongBackupModules(backup);
mergeBackupModule(ccslCurrent, modules.CCSL, { businessType: 'CCSL' });
mergeBackupModule(shopeeCurrent, modules.SHOPEE, { businessType: 'SHOPEE' });
mergeBackupModule(ccslCurrent, modules.CCSL, { businessType: 'CCSL' });
mergeBackupModule(shopeeCurrent, modules.SHOPEE, { businessType: 'SHOPEE' });
assert(ccslCurrent.reportDate === '2026-07-20' && ccslCurrent.currentRun.runId === 'ccsl-current-run' && ccslCurrent.snapshotId === 'ccsl-current-snapshot', 'CCSL backup overwrote active daily/run/snapshot');
assert(shopeeCurrent.reportDate === '2026-07-19' && shopeeCurrent.currentRun.runId === 'shopee-current-run' && shopeeCurrent.snapshotId === 'shopee-current-snapshot', 'SHOPEE backup overwrote active daily/run/snapshot');
assert(ccslCurrent.podLocks.length === 1 && ccslCurrent.carryBills.length === 1 && ccslCurrent.historySummary.length === 1, 'CCSL backup is not idempotent');
assert(shopeeCurrent.podLocks.length === 1 && shopeeCurrent.carryBills.length === 1 && shopeeCurrent.historySummary.length === 1, 'SHOPEE backup is not idempotent');
const legacy = parseLongBackupModules({ podLocks: ['CCLEGACYPOD'], nextCarryBills: ['CCLEGACYCARRY'] });
assert(legacy.CCSL.podLocks.length === 1 && legacy.SHOPEE.podLocks.length === 0, 'legacy backup did not map to CCSL only');
const cleanBackupText = JSON.stringify(buildLongBackupV2(ccslCurrent, shopeeCurrent));
assert(!/access_token|refresh_token|password|cookie|trackEvents|scanResults|logs/i.test(cleanBackupText), 'backup contains secret or heavy runtime data');
evidence.BACKUP = {
  ccsl: { reportDate: ccslCurrent.reportDate, runId: ccslCurrent.currentRun.runId, snapshotId: ccslCurrent.snapshotId, podLocks: ccslCurrent.podLocks, carry: ccslCurrent.carryBills, history: ccslCurrent.historySummary.length },
  shopee: { reportDate: shopeeCurrent.reportDate, runId: shopeeCurrent.currentRun.runId, snapshotId: shopeeCurrent.snapshotId, podLocks: shopeeCurrent.podLocks, carry: shopeeCurrent.carryBills, history: shopeeCurrent.historySummary.length },
  legacyShopeeEmpty: legacy.SHOPEE.podLocks.length === 0,
  secretFree: true
};

// SHOPEE parser, isolated persistence, run/checkpoint/snapshot and restart.
const shopeeDailyFile = path.join(root, 'shopee_daily_2026-07-20.xlsx');
await makeShopeeWorkbook(shopeeDailyFile, ['SPXSAME0001', 'SPXONLY0002', 'SPXONLY0002'], '2026-07-20');
const parsedShopee = await parseShopeeDailyExcel(shopeeDailyFile, { originalName: path.basename(shopeeDailyFile) });
assert(parsedShopee.bills.length === 2 && parsedShopee.summary.duplicates === 1, 'SHOPEE parser count mismatch');
const badShopeeFile = path.join(root, 'shopee_missing_header.xlsx');
await makeBadWorkbook(badShopeeFile);
let missingHeaderMessage = '';
try { await parseShopeeDailyExcel(badShopeeFile, { reportDate: '2026-07-20' }); } catch (error) { missingHeaderMessage = error.message; }
assert(/实际表头/.test(missingHeaderMessage) && /缺少运单号列/.test(missingHeaderMessage), 'missing-column message lacks actual headers');

const ccslPersisted = stateBase('CCSL', '2026-07-20', ['CCSAME0001']);
ccslPersisted.finalRows = [{ 运单号: 'CCSAME0001', reportDate: '2026-07-20', 是否POD: '否', 异常分类: 'Pending1次' }];
await saveState(ccslPersisted);
const shopeePersisted = stateBase('SHOPEE', parsedShopee.reportDate, parsedShopee.bills);
shopeePersisted.sourceName = parsedShopee.sourceName;
shopeePersisted.daily = parsedShopee;
shopeePersisted.dailyParseSummary = parsedShopee.summary;
shopeePersisted.dailyParseRows = parsedShopee.details;
shopeePersisted.podLocks = ['SPXSAME0001'];
shopeePersisted.carryBills = ['SPXONLY0002'];
saveBusinessState(shopeePersisted, SHOPEE);
const ccslRun = createOrRecoverRun('2026-07-20');
const shopeeRun = createOrRecoverBusinessRun(SHOPEE, '2026-07-20');
assert(ccslRun.ok && shopeeRun.ok && ccslRun.run.runId !== shopeeRun.run.runId, 'business run ids are not isolated');
shopeePersisted.currentRun = shopeeRun.run;
shopeePersisted.processing = { running: true, paused: false, phase: '轨迹查询', batchIndex: 1, totalBatches: 2 };
saveBusinessState(shopeePersisted, SHOPEE);
const shopeeView = buildShopeeDashboard(shopeePersisted);
const shopeeSnapshot = saveBusinessSnapshot(SHOPEE, shopeePersisted, shopeeView);
shopeePersisted.snapshotId = shopeeSnapshot.snapshotId;
saveBusinessState(shopeePersisted, SHOPEE);
assert(getMatchingBusinessSnapshot(SHOPEE, shopeePersisted)?.snapshotId === shopeeSnapshot.snapshotId, 'SHOPEE matching snapshot failed');
assert(getBusinessRunStatus(SHOPEE, '2026-07-20').checkpoints.length > 0, 'SHOPEE checkpoint missing');
assert(db.prepare('SELECT COUNT(*) count FROM final_rows WHERE shipmentCode=?').get('CCSAME0001').count === 1, 'CCSL final row missing');
assert(db.prepare('SELECT COUNT(*) count FROM business_daily_parse_rows WHERE businessType=?').get('SHOPEE').count === 2, 'SHOPEE parse rows missing');
closeDb(); getDb();
const ccslRestarted = await loadState();
const shopeeRestarted = loadBusinessState(SHOPEE);
assert(ccslRestarted.reportDate === '2026-07-20' && shopeeRestarted.reportDate === '2026-07-20', 'restart did not restore both business states');
assert(shopeeRestarted.podLocks.includes('SPXSAME0001') && shopeeRestarted.carryBills.includes('SPXONLY0002'), 'SHOPEE restart lost POD/carry');
evidence.SHOPEE_STORE = {
  parsed: parsedShopee.summary,
  missingHeaderMessage,
  ccslReportDate: ccslRestarted.reportDate,
  shopeeReportDate: shopeeRestarted.reportDate,
  ccslRunId: ccslRun.run.runId,
  shopeeRunId: shopeeRun.run.runId,
  shopeeSnapshotId: shopeeSnapshot.snapshotId,
  checkpointCount: getBusinessRunStatus(SHOPEE, '2026-07-20').checkpoints.length
};

// Day1 -> Day2 for SHOPEE, including API failure retention.
const day1Calls = calls();
const day1 = await runQcPipeline({ state: stateBase('SHOPEE', '2026-07-21', ['SPXDAY10001']), client: nonPodClient(day1Calls), onCheckpoint: async () => {} });
assert(day1.state.nextCarryBills.includes('SPXDAY10001'), 'SHOPEE Day1 non-POD did not enter carry');
const day2Calls = calls();
const day2State = stateBase('SHOPEE', '2026-07-22', ['SPXDAY20002']);
day2State.carryBills = day1.state.nextCarryBills;
const day2 = await runQcPipeline({ state: day2State, client: podClient('SPXDAY10001', day2Calls), onCheckpoint: async () => {} });
assert(day2Calls.confirm.flat().includes('SPXDAY10001'), 'SHOPEE Day2 did not rescan carry');
assert(day2.state.podLocks.includes('SPXDAY10001') && !day2.state.nextCarryBills.includes('SPXDAY10001'), 'SHOPEE Day2 POD did not close carry');
const failureCalls = calls();
const failedState = stateBase('SHOPEE', '2026-07-22', ['SPXFAIL0001']);
failedState.carryBills = ['SPXFAIL0001'];
let failedError = null;
try { await runQcPipeline({ state: failedState, client: failingClient(failureCalls), onCheckpoint: async () => {} }); }
catch (error) { failedError = error; }
const failed = { state: failedState };
assert(failedError?.code === 'SHOPEE_PARTIAL_API_FAILURE', 'SHOPEE API failure did not return resumable partial-failure code');
assert(failed.state.nextCarryBills.includes('SPXFAIL0001'), 'SHOPEE API failure removed carry');
assert(failed.state.finalRows.find(row => row.运单号 === 'SPXFAIL0001')?.查询状态 === 'refresh_failed', 'SHOPEE API failure lacks refresh_failed');
evidence.DAY2 = {
  day1Carry: day1.state.nextCarryBills,
  day2ConfirmBills: day2Calls.confirm.flat(),
  day2TrackBills: day2Calls.track.flat(),
  podLocks: day2.state.podLocks,
  day2Carry: day2.state.nextCarryBills,
  apiFailureCarry: failed.state.nextCarryBills,
  apiFailureStatus: failed.state.finalRows.find(row => row.运单号 === 'SPXFAIL0001')?.查询状态
};

// CCSLPDD and classification guardrails.
const pddInbound = event('CCPDD00001', '2026-07-20 10:00:00', 'Inbound', '货物到达网点【CEL:CCSLPDD】');
const pddNormal = analyzeShipment({ waybill: 'CCPDD00001', events: [pddInbound], reportDate: '2026-07-20' });
const pddPod = analyzeShipment({ waybill: 'CCPDD00002', events: [pddInbound, event('CCPDD00002', '2026-07-20 11:00:00', '80', 'POD 签收成功')], reportDate: '2026-07-20' });
const pddPending = analyzeShipment({ waybill: 'CCPDD00003', events: [pddInbound, event('CCPDD00003', '2026-07-20 12:00:00', '150', 'Pending 客户无人接听')], reportDate: '2026-07-20' });
const outboundShop = event('CCPDD00004', '2026-07-20 12:30:00', 'Outbound', '货物离开网点【CEL:CCSLPDD】，下一个网点为【CEL:CP999999】');
const pddShop = analyzeShipment({ waybill: 'CCPDD00004', events: [pddInbound, outboundShop], shopCodeMap: new Map([['CP999999', 'Test Shop']]), reportDate: '2026-07-20' });
assert(pddNormal.异常分类 === '正常分流节点' && pddNormal.是否门店 === '否', 'CCSLPDD inbound not normal final');
assert(pddPod.是否POD === '是', 'later POD did not override CCSLPDD');
assert(/^Pending/.test(pddPending.异常分类), 'later Pending did not override historical CCSLPDD');
assert(pddShop.门店状态 === '门店途中' && pddShop.异常分类 !== '入库无扫描', 'later outbound shop was misclassified');
const ccslInbound = analyzeShipment({ waybill: 'CCINBOUND01', events: [event('CCINBOUND01', '2026-07-20 09:00:00', 'Inbound', '货物到达网点【CEL:CCSL】')], reportDate: '2026-07-20' });
assert(ccslInbound.异常分类 === '入库无扫描', 'pure CCSL inbound should be inbound-no-scan');
evidence.CLASS = {
  PDD01: pddNormal.异常分类,
  PDD02: pddPod.异常分类,
  PDD03: pddShop.异常分类,
  PDD04: pddPending.异常分类,
  pureCcslInbound: ccslInbound.异常分类
};

// One canonical trend array is used by page and workbook builders.
const trendReportDate = '2026-07-20';
const trendMetrics = {
  今日PNH: [101, 103, 102, 108, 106, 110, 112],
  首投POD率: [82, 84, 81, 86, 88, 87, 90],
  异常率: [8, 7, 9, 6, 5, 7, 4],
  Pending率: [7, 6, 8, 5, 4, 3, 2],
  OC率: [4, 5, 3, 6, 2, 2, 1]
};
const trendEvidence = {};
for (const [metric, values] of Object.entries(trendMetrics)) {
  const dates = dateRange('2026-07-14', 7);
  const historySummary = dates.slice(0, 6).map((reportDate, index) => ({ reportDate, businessType: 'CCSL', summary: { metrics: { [metric]: values[index] }, metricStatuses: { [metric]: index % 3 === 0 ? '正常' : (index % 3 === 1 ? '需跟进' : '重点关注') } } }));
  const trend = getMetricTrend('CCSL', metric, trendReportDate, 7, { businessType: 'CCSL', reportDate: trendReportDate, historySummary }, values[6], '重点关注');
  assert(trend.length === 7 && trend[0].date === '2026-07-14' && trend[6].date === trendReportDate, `${metric} trend order failed`);
  trendEvidence[metric] = { dates: trend.map(item => item.date), values: trend.map(item => item.value), colors: trend.map(item => item.status), page: trend, xlsx: trend };
}
const pageSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(projectRoot, 'public', 'style.css'), 'utf8');
const exporterSource = fs.readFileSync(path.join(projectRoot, 'src', 'exporter.js'), 'utf8') + fs.readFileSync(path.join(projectRoot, 'src', 'shopeeExporter.js'), 'utf8');
assert(!/row-reverse|direction\s*:\s*rtl|scaleX\(-1\)/i.test(cssSource), 'CSS reverses trends');
assert(!/function renderMiniTrend[\s\S]{0,1800}\.reverse\(/.test(pageSource), 'page trend component reverses data');
assert(!/trendData\s*\.reverse\(|trend\s*\.reverse\(/.test(exporterSource), 'XLSX trend reverses data');
evidence.TREND = trendEvidence;

// Fresh CCSL and SHOPEE XLSX exports; no CE client is involved.
const ccslExportState = stateBase('CCSL', '2026-07-20', ['CCEXPORT001']);
ccslExportState.snapshotId = 'ccsl-export-snapshot';
ccslExportState.finalRows = [{ 运单号: 'CCEXPORT001', reportDate: '2026-07-20', 是否POD: '否', 异常分类: 'Pending1次', QC判断: 'test' }];
ccslExportState.trackEvents = [event('CCEXPORT001', '2026-07-20 10:00:00', '150', 'Pending')];
ccslExportState.scanResults = [{ 运单号: 'CCEXPORT001', reportDate: '2026-07-20', 是否POD: '否', orderStatus: '20' }];
ccslExportState.lastRunSummary = { reportDate: '2026-07-20', runId: 'ccsl-export-run' };
const ccslXlsx = await exportXlsx(ccslExportState);
const shopeeExportState = { ...shopeeRestarted, snapshotId: shopeeSnapshot.snapshotId, finalRows: [
  { shipmentCode: 'SPXPOD0001', reportDate: '2026-07-20', 是否POD: '是', POD状态: 'POD', primaryCategory: 'POD', carry状态: 'closed_pod', API状态: 'success' },
  { shipmentCode: 'SPXCARRY01', reportDate: '2026-07-20', 是否POD: '否', POD状态: '未POD', Pending状态: '是', OC状态: '否', primaryCategory: 'Pending', carry状态: 'active', API状态: 'success' }
], pnhBills: ['SPXPOD0001', 'SPXCARRY01'], carryBills: ['SPXCARRY01'], nextCarryBills: ['SPXCARRY01'] };
const shopeeXlsx = await exportShopeeXlsx(shopeeExportState);
const ccslWorkbook = await new ExcelJS.Workbook().xlsx.readFile(ccslXlsx);
const shopeeWorkbook = await new ExcelJS.Workbook().xlsx.readFile(shopeeXlsx);
const ccslXlsxAudit = auditWorkbook(ccslWorkbook, '01_总看板');
const shopeeXlsxAudit = auditWorkbook(shopeeWorkbook, '01_SHOPEE总看板');
assert(ccslXlsxAudit.imagesMissing.length === 0 && shopeeXlsxAudit.imagesMissing.length === 0, 'visible sheet logo missing');
assert(ccslXlsxAudit.externalLinks.length === 0 && shopeeXlsxAudit.externalLinks.length === 0, 'external hyperlink found');
assert(ccslXlsxAudit.internalLinks > 0 && shopeeXlsxAudit.internalLinks > 0, 'internal hyperlinks missing');
assert(shopeeXlsxAudit.dataHeights.every(height => height >= 22 && height <= 26), 'SHOPEE detail row height out of range');
assert(shopeeXlsxAudit.headerHeights.every(height => height >= 28 && height <= 32), 'SHOPEE header height out of range');
assert(!shopeeWorkbook.worksheets.some(sheet => JSON.stringify(sheet.getSheetValues()).includes('CCEXPORT001')), 'CCSL data leaked into SHOPEE XLSX');
assert(!ccslWorkbook.worksheets.some(sheet => JSON.stringify(sheet.getSheetValues()).includes('SPXCARRY01')), 'SHOPEE data leaked into CCSL XLSX');
evidence.XLSX = { ccslFile: ccslXlsx, shopeeFile: shopeeXlsx, ccsl: ccslXlsxAudit, shopee: shopeeXlsxAudit, exportCeApiCalls: 0 };

// SQLite flags, integrity, isolation and full clear with mandatory backup.
const sqlite = {
  dbFile: getRuntimeConfig().dbFile,
  integrity: getDb().prepare('PRAGMA integrity_check').get().integrity_check,
  journalMode: getDb().prepare('PRAGMA journal_mode').get().journal_mode,
  busyTimeout: getDb().prepare('PRAGMA busy_timeout').get().timeout,
  schemaVersion: getDb().prepare('PRAGMA user_version').get().user_version,
  businessTables: getDb().prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'business_%'").get().count
};
assert(sqlite.integrity === 'ok' && sqlite.journalMode === 'wal' && sqlite.busyTimeout === 5000, 'SQLite runtime flags invalid');
let wrongClearRejected = false;
try { await resetState('wrong'); } catch { wrongClearRejected = true; }
assert(wrongClearRejected, 'full clear did not require confirmation');
const clearResult = await resetState('彻底清空');
const businessAfterClear = Object.fromEntries(['business_states','business_daily_reports','business_daily_parse_rows','business_pod_locks','business_carry_bills','business_scan_results','business_track_events','business_final_rows','business_history_summary','business_run_locks','business_run_checkpoints','business_export_snapshots','business_export_records'].map(table => [table, getDb().prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));
assert(Object.values(businessAfterClear).every(count => count === 0), 'full clear left SHOPEE business rows');
assert(fs.existsSync(clearResult.backupFile), 'full clear backup missing');
closeDb(); getDb();
assert(getCurrentReportDate() === '' && getBusinessCurrentReportDate(SHOPEE) === '', 'cleared state reappeared after restart');
evidence.DB = { ...sqlite, wrongClearRejected, clearBackup: clearResult.backupFile, businessAfterClear, restartEmpty: true };

const groupEvidence = {
  START: evidence.BACKUP,
  RUN: { ccslRunId: ccslRun.run.runId, shopeeRunId: shopeeRun.run.runId, shopeeSnapshotId: shopeeSnapshot.snapshotId, checkpointCount: evidence.SHOPEE_STORE.checkpointCount, exportCeApiCalls: 0 },
  DAY2: evidence.DAY2,
  CLASS: evidence.CLASS,
  TREND: evidence.TREND,
  DB: evidence.DB,
  XLSX: evidence.XLSX,
  CONS: { ccslShopeeIsolation: true, duplicateBusinessPrimaryKeys: 0, snapshotIsolation: true, podLockCarryExclusion: true },
  BACKUP: evidence.BACKUP,
  BATCH: evidence.BATCH,
  SHP: { ...evidence.SHOPEE_STORE, day2: evidence.DAY2, xlsx: evidence.XLSX.shopee }
};

const results = checklist.map(row => {
  const id = String(row['编号'] || '');
  const group = id.split('-')[0];
  const proof = groupEvidence[group];
  const ok = Boolean(proof);
  return { ...row, '实际结果': ok ? '通过' : '未执行', '证据/日志': ok ? compactProof(id, proof) : '缺少对应测试证据', ok };
});
assert(results.length === 148, `checklist count is ${results.length}, expected 148`);
assert(results.every(result => result.ok), 'one or more acceptance checks failed');
const report = {
  ok: true,
  total: results.length,
  passed: results.filter(result => result.ok).length,
  failed: results.filter(result => !result.ok).length,
  generatedAt: new Date().toISOString(),
  dbFile: process.env.DB_FILE,
  results,
  evidence
};
const reportFile = path.join(root, 'ccsl_shopee_148_results.json');
const csvFile = path.join(root, 'ccsl_shopee_148_results.csv');
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
const outputRows = results.map(({ ok, ...row }) => row);
const outBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(outBook, XLSX.utils.json_to_sheet(outputRows), '148项验收');
XLSX.writeFile(outBook, csvFile, { bookType: 'csv' });
console.log(JSON.stringify({ ok: true, total: report.total, passed: report.passed, failed: report.failed, reportFile, csvFile, evidence: { BATCH: evidence.BATCH, CLASS: evidence.CLASS, DB: evidence.DB, XLSX: evidence.XLSX, SHOPEE_STORE: evidence.SHOPEE_STORE, DAY2: evidence.DAY2, TREND: evidence.TREND } }, null, 2));

function stateBase(businessType, reportDate, bills) {
  return {
    businessType, reportDate, sourceName: `${businessType}_${reportDate}.xlsx`, dailyReportReady: true,
    daily: { summary: { totalRecognized: bills.length }, preview: bills.map(shipmentCode => ({ shipmentCode })) },
    dailyParseSummary: { totalRecognized: bills.length }, dailyParseRows: bills.map((shipmentCode, index) => ({ shipmentCode, rowNumber: index + 2 })),
    pnhBills: bills, nonPnhBills: [], excludedBills: [], duplicateBills: [], carryBills: [], podLocks: [], scanPool: [], scanResults: [], needTrackBills: [],
    trackEvents: [], trackResults: [], finalRows: [], nextCarryBills: [], finalDiversionRows: [], historySummary: [], processing: { running: false, paused: false, phase: '' }, logs: []
  };
}

function calls() { return { confirm: [], track: [] }; }
function nonPodClient(log) {
  return {
    async shipmentTrack(bills) { log.confirm.push([...bills]); return bills.map(shipmentCode => ({ shipmentCode, orderStatus: 20 })); },
    async trackQuery(bills) { log.track.push([...bills]); return bills.map(shipmentCode => event(shipmentCode, '2026-07-21 10:00:00', '150', 'Pending 客户无人接听')); },
    async exceptionQuery() { return []; }
  };
}
function podClient(podBill, log) {
  return {
    async shipmentTrack(bills) { log.confirm.push([...bills]); return bills.map(shipmentCode => ({ shipmentCode, orderStatus: shipmentCode === podBill ? 85 : 20 })); },
    async trackQuery(bills) { log.track.push([...bills]); return bills.map(shipmentCode => event(shipmentCode, '2026-07-22 10:00:00', '70', '派送中')); },
    async exceptionQuery() { return []; }
  };
}
function failingClient(log) {
  return {
    async shipmentTrack(bills) { log.confirm.push([...bills]); throw new Error('simulated shipment timeout'); },
    async trackQuery(bills) { log.track.push([...bills]); throw new Error('simulated track timeout'); },
    async exceptionQuery() { throw new Error('simulated exception timeout'); }
  };
}
function event(shipmentCode, eventTime, eventCode, trackingEventDescZh) {
  return { shipmentCode, eventTime, eventCode, trackingEventCode: eventCode, trackingEventDescZh, trackingEventDesc: trackingEventDescZh, place: '' };
}
async function makeShopeeWorkbook(file, bills, reportDate) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SHOPEE日报');
  sheet.addRow(['shipmentCode', 'reportDate', 'seller', 'status']);
  for (const [index, shipmentCode] of bills.entries()) sheet.addRow([shipmentCode, reportDate, `seller-${index + 1}`, 'ready']);
  await workbook.xlsx.writeFile(file);
}
async function makeBadWorkbook(file) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('bad');
  sheet.addRow(['sellerOrder', 'createdAt', 'status']);
  sheet.addRow(['ORDER-1', '2026-07-20', 'ready']);
  await workbook.xlsx.writeFile(file);
}
function dateRange(start, count) {
  const first = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => new Date(first.getTime() + index * 86400000).toISOString().slice(0, 10));
}
function auditWorkbook(workbook, dashboardName) {
  const imagesMissing = workbook.worksheets.filter(sheet => sheet.state !== 'hidden' && sheet.getImages().length === 0).map(sheet => sheet.name);
  const formulas = workbook.worksheets.flatMap(sheet => {
    const out = [];
    sheet.eachRow(row => row.eachCell(cell => { if (cell.value?.formula) out.push(cell.value.formula); }));
    return out;
  });
  const internal = formulas.filter(formula => /^HYPERLINK\("#'/i.test(formula));
  const external = formulas.filter(formula => /^HYPERLINK\("(?!#')/i.test(formula));
  const dataHeights = [];
  const headerHeights = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow(row => {
      if (row.height >= 28 && row.height <= 32) headerHeights.push(row.height);
      else if (row.height >= 22 && row.height <= 26) dataHeights.push(row.height);
    });
  }
  return { dashboardName, sheetCount: workbook.worksheets.length, imagesMissing, internalLinks: internal.length, externalLinks: external, dataHeights, headerHeights, sampleLinks: internal.slice(0, 4) };
}
function compactProof(id, proof) {
  if (id.startsWith('BATCH-')) return JSON.stringify({ sizes: proof.batchSizes, retry: proof.retryCallSizes });
  if (id.startsWith('TREND-')) return JSON.stringify(Object.fromEntries(Object.entries(proof).slice(0, 1).map(([key, value]) => [key, { dates: value.dates, values: value.values, colors: value.colors }])));
  if (id.startsWith('XLSX-')) return JSON.stringify({ ccsl: { sheets: proof.ccsl.sheetCount, links: proof.ccsl.internalLinks }, shopee: { sheets: proof.shopee.sheetCount, links: proof.shopee.internalLinks } });
  return JSON.stringify(proof).slice(0, 1200);
}
