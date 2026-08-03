import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const auditRoot = path.join(projectRoot, 'data', 'codex_full_audit');
if (!auditRoot.startsWith(projectRoot)) throw new Error('审计目录超出项目范围');
fs.rmSync(auditRoot, { recursive: true, force: true });
fs.mkdirSync(auditRoot, { recursive: true });
process.env.DATA_DIR = auditRoot;
process.env.DB_FILE = path.join(auditRoot, 'ce_qc_monitor.db');
process.env.EXPORTS_DIR = path.join(auditRoot, 'exports');
fs.closeSync(fs.openSync(process.env.DB_FILE, 'w'));

const { closeDb, getDb } = await import('../src/db.js');
const { loadState, resetState, saveState } = await import('../src/storage.js');
const { runQcPipeline } = await import('../src/pipeline.js');
const { getMetricTrend, buildDashboardRows, getXlsxSheetRows } = await import('../src/reporting.js');
const { createDashboardSnapshot, getMatchingSnapshot } = await import('../src/snapshots.js');
const { exportXlsx } = await import('../src/exporter.js');

const results = { trend: {}, crossDay: {}, snapshot: {}, clear: {}, upgrade: {}, audit: {} };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

getDb();

const trendState = {
  reportDate: '2026-06-28',
  historySummary: [
    history('2026-06-22', 3),
    history('2026-06-24', 9),
    history('2026-06-27', 6)
  ]
};
const trend = getMetricTrend('Pending1次', trendState.reportDate, 7, trendState, 12);
const normalized = normalizeHeights(trend);
const legacyCriticalTrend = getMetricTrend('criticalPending3', trendState.reportDate, 7, {
  ...trendState,
  historySummary: [
    { reportDate: '2026-06-22', summary: { metrics: { 'Pending 3次以上': 2 } } },
    { reportDate: '2026-06-27', summary: { metrics: { 'Pending 3次以上': 5 } } }
  ]
}, 7);
assert(JSON.stringify(trend.map(x => x.date)) === JSON.stringify(['2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28']), '趋势日期不是7个连续自然日');
assert(JSON.stringify(trend.map(x => x.value)) === JSON.stringify([3, null, 9, null, null, 6, 12]), '趋势原始值不正确');
assert(JSON.stringify(legacyCriticalTrend.map(x => x.value)) === JSON.stringify([2, null, null, null, null, 5, 7]), '旧版严重异常指标名未兼容到稳定metricKey');
results.trend = { metricKey: 'Pending1次', dates: trend.map(x => x.date), values: trend.map(x => x.value), normalized, legacyCriticalValues: legacyCriticalTrend.map(x => x.value) };

const day1Bill = 'CCDAY10001';
const day1 = baseState('2026-07-01', [day1Bill], []);
const day1Calls = [];
const day1Result = await runQcPipeline({ state: day1, client: nonPodClient(day1Calls), onCheckpoint: async () => {} });
assert(day1Result.state.nextCarryBills.includes(day1Bill), 'Day1未POD未进入carry');
await saveState(day1Result.state);
const restored = await loadState();
assert(restored.carryBills.includes(day1Bill), 'Day1 carry未从SQLite恢复');

const aCalls = [];
const caseA = await runQcPipeline({
  state: importedDay2(restored, '2026-07-02', ['CCDAY20002']),
  client: nonPodClient(aCalls), onCheckpoint: async () => {}
});
assert(aCalls.flat().includes(day1Bill), 'A: Day2日报无该票时未重新查询carry');
assert(countBill(aCalls.trackCalls || [], day1Bill) === 1, 'A: Day2 carry未重新进入trackPool');
results.crossDay.A = { scanQueried: countBill(aCalls, day1Bill), trackQueried: countBill(aCalls.trackCalls || [], day1Bill), carry: caseA.state.nextCarryBills.includes(day1Bill) };

const bCalls = [];
const caseB = await runQcPipeline({
  state: importedDay2(restored, '2026-07-02', [day1Bill, 'CCDAY20003']),
  client: nonPodClient(bCalls), onCheckpoint: async () => {}
});
assert(countBill(bCalls, day1Bill) === 1, 'B: 日报与carry重复票未去重');
assert(caseB.state.finalRows.filter(row => row.运单号 === day1Bill).length === 1, 'B: 重复票生成多条final_row');
results.crossDay.B = { queryCount: countBill(bCalls, day1Bill), finalRowCount: caseB.state.finalRows.filter(row => row.运单号 === day1Bill).length };

const cCalls = [];
const caseC = await runQcPipeline({
  state: importedDay2(restored, '2026-07-02', ['CCDAY20004']),
  client: podClient(day1Bill, cCalls), onCheckpoint: async () => {}
});
assert(caseC.state.podLocks.includes(day1Bill), 'C: Day2 POD未写入POD锁');
assert(!caseC.state.nextCarryBills.includes(day1Bill), 'C: Day2 POD仍在明日继续');
results.crossDay.C = { podLocked: true, remainsCarry: false, queryCount: countBill(cCalls, day1Bill) };

const dCalls = [];
const caseD = await runQcPipeline({
  state: importedDay2(restored, '2026-07-02', ['CCDAY20005']),
  client: failedClient(dCalls), onCheckpoint: async () => {}
});
assert(caseD.state.nextCarryBills.includes(day1Bill), 'D: API失败导致carry丢失');
assert(caseD.state.finalRows.some(row => row.运单号 === day1Bill && row.查询状态 === 'refresh_failed'), 'D: API失败未明确标记refresh_failed');
await saveState(caseD.state);
const failedCarryInSqlite = getDb().prepare("SELECT COUNT(*) AS count FROM carry_bills WHERE shipmentCode=? AND status='active'").get(day1Bill).count;
assert(failedCarryInSqlite === 1, 'D: API失败carry未写回SQLite');
results.crossDay.D = { carryPreserved: true, carryPersistedInSqlite: true, refreshFailed: true, queryCount: countBill(dCalls, day1Bill) };

const snapshotState = buildSnapshotState();
await saveState(snapshotState);
const snapshot = createDashboardSnapshot(snapshotState);
const matched = getMatchingSnapshot(snapshotState);
assert(matched?.snapshotId === snapshot.snapshotId, '页面快照未能按reportDate+runId读取');
const exportState = { ...snapshot.state, snapshotId: snapshot.snapshotId };
const xlsxFile = await exportXlsx(exportState, snapshot);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(xlsxFile);
const xlsxSnapshotIds = readColumn(workbook.getWorksheet('数据一致性检查'), 'snapshotId');
assert(xlsxSnapshotIds.length && xlsxSnapshotIds.every(value => value === snapshot.snapshotId), 'XLSX snapshotId与页面快照不一致');
const comparisons = compareWorkbookMetrics(workbook, [
  ['今日PNH', '明细_今日PNH'], ['今日POD', '明细_今日POD'],
  ['Pending1+', '明细_Pending1+'], ['Pending2+', '明细_Pending2+'],
  ['Pending3+', '明细_Pending3+'], ['OC1+', '明细_OC1+'],
  ['OC2+', '明细_OC2+'], ['盘点1天', '明细_盘点1天'],
  ['派送停留1天', '明细_派送停留1天'], ['入库无扫描节点', '明细_入库无扫描']
]);
assert(comparisons.every(row => row.dashboardValue === row.detailUnique), '10个随机指标存在看板/明细差异');
const pageRows = snapshot.dashboardRows;
const xlsxRows = readDashboard(workbook.getWorksheet('01_总看板'));
const pagePairs = pageRows.map(row => [row.项目, String(row.数值)]);
const xlsxPairs = xlsxRows.map(row => [row.项目, String(row.数值)]);
if (hashSimple(pagePairs) !== hashSimple(xlsxPairs)) {
  console.error('DASHBOARD_DIFF', JSON.stringify({ page: pagePairs, xlsx: xlsxPairs }, null, 2));
}
assert(hashSimple(pagePairs) === hashSimple(xlsxPairs), '页面与XLSX看板项目/数值不同源');
assert(pageRows.every(row => Array.isArray(row.迷你走势数据)
  && row.迷你走势数据.length === 7
  && row.迷你走势数据[6]?.date === snapshotState.reportDate), '页面趋势数组不是升序7天或最右侧不是reportDate');
results.snapshot = { pageSnapshotId: snapshot.snapshotId, xlsxSnapshotId: xlsxSnapshotIds[0], xlsxFile, comparisons };

const db = getDb();
results.audit.beforeClear = tableCounts(db, businessTables());
const duplicateFinal = db.prepare('SELECT shipmentCode, reportDate, COUNT(*) AS count FROM final_rows GROUP BY shipmentCode, reportDate HAVING COUNT(*)>1').all();
const podInAbnormal = db.prepare("SELECT COUNT(*) AS count FROM final_rows f JOIN pod_locks p ON p.shipmentCode=f.shipmentCode WHERE f.isPod=0").get().count;
assert(!duplicateFinal.length, 'SQLite final_rows存在重复运单');
assert(podInAbnormal === 0, 'POD锁误入异常final_rows');
results.audit.duplicateFinalRows = duplicateFinal.length;
results.audit.podLocksInAbnormal = podInAbnormal;

const tokenFile = path.join(auditRoot, 'token', 'token.json');
fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
fs.writeFileSync(tokenFile, '{"access_token":"audit-token-sentinel"}', 'utf8');
const beforeRejectedClear = tableCounts(getDb(), businessTables());
let rejectedClear = false;
try { await resetState('错误确认'); } catch { rejectedClear = true; }
assert(rejectedClear, '错误确认文字仍执行了清空');
assert(hashSimple(beforeRejectedClear) === hashSimple(tableCounts(getDb(), businessTables())), '错误确认文字改变了业务数据');
const clearResult = await resetState('彻底清空');
assert(fs.existsSync(clearResult.backupFile), '清空前备份文件不存在');
const afterClear = tableCounts(getDb(), businessTables());
assert(Object.values(afterClear).every(count => count === 0), '彻底清空后仍有业务表数据');
assert(getDb().prepare('SELECT COUNT(*) AS count FROM shop_cp_codes').get().count > 0, '彻底清空误删门店CP码');
assert(fs.readFileSync(tokenFile, 'utf8').includes('audit-token-sentinel'), '彻底清空误删登录token');
closeDb();
getDb();
const reopenedClear = tableCounts(getDb(), businessTables());
assert(Object.values(reopenedClear).every(count => count === 0), '重启数据库后清空数据重新出现');
const backupDb = new DatabaseSync(clearResult.backupFile);
const backupIntegrity = backupDb.prepare('PRAGMA integrity_check').get().integrity_check;
backupDb.close();
assert(backupIntegrity === 'ok', '清空前备份数据库完整性失败');
results.clear = { rejectedWrongConfirmation: rejectedClear, backupPath: clearResult.backupFile, backupIntegrity, afterClear, afterReopen: reopenedClear, tokenPreserved: true, shopCodesPreserved: clearResult.shopCodesPreserved };

closeDb();
const oldRoot = path.join(auditRoot, 'old_v3_upgrade');
fs.mkdirSync(oldRoot, { recursive: true });
process.env.DATA_DIR = oldRoot;
process.env.DB_FILE = path.join(oldRoot, 'ce_qc_monitor.db');
process.env.EXPORTS_DIR = path.join(oldRoot, 'exports');
fs.closeSync(fs.openSync(process.env.DB_FILE, 'w'));
getDb();
closeDb();
makeDatabaseV3Shaped(process.env.DB_FILE);
getDb();
const upgraded = getDb();
const upgradeCounts = tableCounts(upgraded, ['pod_locks', 'carry_bills', 'daily_reports', 'track_events', 'history_summary']);
assert(Object.values(upgradeCounts).every(count => count === 1), '旧数据库升级后历史业务数据丢失');
const snapshotColumns = upgraded.prepare('PRAGMA table_info(export_snapshots)').all().map(row => row.name);
assert(['snapshotId', 'runId', 'dataHashesJson', 'consistencyJson'].every(name => snapshotColumns.includes(name)), '旧数据库升级后缺少新快照字段');
const evidenceColumns = upgraded.prepare('PRAGMA table_info(final_rows)').all().map(row => row.name);
assert(['lastEventCode', 'lastEventDesc', 'lastEventTargetNode', 'lastEventActionType', 'matchedRule', 'matchedShopCode', 'matchedShopName', 'primaryCategory', 'tagsJson'].every(name => evidenceColumns.includes(name)), '旧数据库升级后缺少节点判定证据字段');
const runColumns = upgraded.prepare('PRAGMA table_info(run_locks)').all().map(row => row.name);
assert(['currentStage', 'batchIndex', 'totalBatches', 'errorMessage', 'completedAt'].every(name => runColumns.includes(name)), '旧数据库升级后缺少run生命周期字段');
const upgradeIntegrity = upgraded.prepare('PRAGMA integrity_check').get().integrity_check;
const backupsBeforeRestart = fs.readdirSync(path.join(oldRoot, 'backups')).filter(name => /^backup_before_migration_/.test(name));
closeDb();
getDb();
const backupsAfterRestart = fs.readdirSync(path.join(oldRoot, 'backups')).filter(name => /^backup_before_migration_/.test(name));
assert(backupsBeforeRestart.length === 1 && backupsAfterRestart.length === 1, '迁移不是幂等，重启重复生成迁移备份');
results.upgrade = { fromVersion: 3, toVersion: 9, counts: upgradeCounts, integrity: upgradeIntegrity, backup: path.join(oldRoot, 'backups', backupsBeforeRestart[0]), backupCountAfterRestart: backupsAfterRestart.length, newColumns: snapshotColumns.filter(name => ['snapshotId', 'runId', 'metricsJson', 'detailCountsJson', 'dataHashesJson', 'consistencyJson', 'generatedAt'].includes(name)), evidenceColumns: evidenceColumns.filter(name => ['lastEventCode', 'lastEventDesc', 'lastEventTargetNode', 'lastEventActionType', 'matchedRule', 'matchedShopCode', 'matchedShopName', 'primaryCategory', 'tagsJson'].includes(name)), runColumns: runColumns.filter(name => ['currentStage', 'batchIndex', 'totalBatches', 'errorMessage', 'completedAt'].includes(name)) };

closeDb();
const reportFile = path.join(auditRoot, 'full_audit_results.json');
fs.writeFileSync(reportFile, JSON.stringify(results, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, reportFile, results }, null, 2));

function history(reportDate, value) {
  return { reportDate, summary: { reportDate, metrics: { Pending1次: value } } };
}

function normalizeHeights(trendRows) {
  const values = trendRows.filter(row => row.hasData).map(row => Math.abs(Number(row.value || 0)));
  const max = Math.max(1, ...values);
  return trendRows.map(row => row.hasData ? Math.round((Math.abs(Number(row.value || 0)) / max) * 100) : 0);
}

function baseState(reportDate, pnhBills, carryBills) {
  return {
    reportDate, sourceName: `${reportDate}.xlsx`, pnhBills, nonPnhBills: [], excludedBills: [], duplicateBills: [],
    carryBills, podLocks: [], scanPool: [], scanResults: [], needTrackBills: [], trackEvents: [], trackResults: [],
    finalRows: [], nextCarryBills: [], finalDiversionRows: [], historySummary: [], processing: {}, logs: []
  };
}

function importedDay2(previous, reportDate, pnhBills) {
  return {
    ...baseState(reportDate, pnhBills, [...(previous.carryBills || previous.nextCarryBills || [])]),
    podLocks: [...(previous.podLocks || [])], historySummary: [...(previous.historySummary || [])]
  };
}

function nonPodClient(calls) {
  calls.trackCalls = [];
  return {
    async confirmQuery(bills) { calls.push([...bills]); return bills.map(shipmentCode => ({ shipmentCode, orderStatus: 40 })); },
    async trackQuery(bills) { calls.trackCalls.push([...bills]); return bills.map(shipmentCode => ({ shipmentCode, eventCode: 'INBOUND', trackingEventCode: 'INBOUND', trackingEventDescZh: '货物到达网点【CEL:CCSL】', eventTime: '2026-07-01 10:00:00', place: 'CEL:CCSL' })); }
  };
}

function podClient(podBill, calls) {
  return {
    async confirmQuery(bills) { calls.push([...bills]); return bills.map(shipmentCode => ({ shipmentCode, orderStatus: shipmentCode === podBill ? 85 : 40 })); },
    async trackQuery(bills) { return bills.map(shipmentCode => ({ shipmentCode, eventCode: 'INBOUND', trackingEventCode: 'INBOUND', trackingEventDescZh: '货物到达网点', eventTime: '2026-07-02 10:00:00' })); }
  };
}

function failedClient(calls) {
  return {
    async confirmQuery(bills) { calls.push([...bills]); throw new Error('mock confirm timeout'); },
    async trackQuery() { throw new Error('mock track timeout'); }
  };
}

function countBill(calls, bill) { return calls.flat().filter(value => value === bill).length; }

function buildSnapshotState() {
  const pnhBills = Array.from({ length: 20 }, (_, index) => `CCSNAP${String(index + 1).padStart(4, '0')}`);
  const finalRows = [
    podRow(pnhBills[0]), podRow(pnhBills[1]),
    riskRow(pnhBills[2], 'Pending1次', { Pending次数: 1, Pending有图片次数: 1, Pending图片状态: 'HAS_IMAGE' }),
    riskRow(pnhBills[3], 'Pending2次', { Pending次数: 2, Pending无图片次数: 1, Pending图片状态: 'NO_IMAGE' }),
    riskRow(pnhBills[4], 'Pending3次以上', { Pending次数: 3, Pending连续性: '连续', Pending日期: '2026-07-05,2026-07-06,2026-07-07', Pending连续3天以上: '是' }),
    riskRow(pnhBills[5], 'OC1天', { OC天数: 1 }),
    riskRow(pnhBills[6], 'OC2天', { OC天数: 2 }),
    riskRow(pnhBills[7], 'OC3天以上', { OC天数: 3 }),
    riskRow(pnhBills[8], '盘点1天', { 盘点天数: 1, 盘点次数: 1 }),
    riskRow(pnhBills[9], '盘点2天', { 盘点天数: 2, 盘点次数: 2 }),
    riskRow(pnhBills[10], '盘点3天以上', { 盘点天数: 3, 盘点次数: 3 }),
    riskRow(pnhBills[11], '派送停留1天', { 派送中天数: 1 }),
    riskRow(pnhBills[12], '派送停留2天', { 派送中天数: 2 }),
    riskRow(pnhBills[13], '派送停留3天以上', { 派送中天数: 3 }),
    riskRow(pnhBills[14], '入库无扫描'),
    riskRow(pnhBills[15], '需人工复核')
  ];
  const openBills = finalRows.filter(row => row.是否POD !== '是').map(row => row.运单号);
  const scanResults = pnhBills.map(wb => ({ 运单号: wb, orderStatus: [pnhBills[0], pnhBills[1]].includes(wb) ? '85' : '40', 是否POD: [pnhBills[0], pnhBills[1]].includes(wb) ? '是' : '否' }));
  const historySummary = Array.from({ length: 6 }, (_, index) => {
    const date = `2026-07-0${index + 1}`;
    const metrics = Object.fromEntries(buildDashboardRows({ ...baseState(date, pnhBills, []), scanResults, finalRows, trackResults: finalRows, nextCarryBills: openBills }).map(row => [row.metricKey || row.项目, row.数值]));
    metrics['Pending 3次以上'] = index + 1;
    return { reportDate: date, summary: { reportDate: date, metrics } };
  });
  return {
    ...baseState('2026-07-07', pnhBills, [pnhBills[16], pnhBills[17]]),
    scanPool: pnhBills, scanResults, needTrackBills: openBills, trackResults: finalRows.filter(row => row.是否POD !== '是'),
    trackEvents: finalRows.map((row, index) => ({ shipmentCode: row.运单号, eventCode: 'E', eventTime: `2026-07-07 10:${String(index).padStart(2, '0')}:00`, trackingEventDescZh: row.异常分类 })),
    finalRows, nextCarryBills: openBills, podLocks: [pnhBills[0], pnhBills[1]], historySummary,
    lastRunSummary: { runId: 'audit-run-20260707', reportDate: '2026-07-07', completedAt: '2026-07-07T12:00:00.000Z' },
    lastRun: { runId: 'audit-run-20260707', reportDate: '2026-07-07', completedAt: '2026-07-07T12:00:00.000Z' },
    dailyParseRows: pnhBills.map((shipmentCode, index) => ({ shipmentCode, result: 'PNH', sheetName: '日报', rowNumber: index + 2 })),
    dailyParseSummary: { pnh: pnhBills.length, totalRecognized: pnhBills.length }
  };
}

function podRow(运单号) { return { 运单号, 是否POD: '是', 异常分类: 'POD闭环', orderStatus: '85', QC判断: 'POD' }; }
function riskRow(运单号, 异常分类, extra = {}) { return { 运单号, 是否POD: '否', 异常分类, QC判断: 异常分类, 最后节点时间: '2026-07-07 10:00:00', ...extra }; }

function readDashboard(ws) {
  const out = [];
  const headerNumber = findHeaderRow(ws, '项目');
  ws.eachRow((row, number) => {
    if (number <= headerNumber) return;
    out.push({ 项目: valueOf(row.getCell(3)), 数值: valueOf(row.getCell(4)), 迷你走势: String(valueOf(row.getCell(6))).replace(/\s+/g, '') });
  });
  return out.filter(row => row.项目);
}

function compareWorkbookMetrics(workbook, pairs) {
  const dashboard = new Map(readDashboard(workbook.getWorksheet('01_总看板')).map(row => [row.项目, numberOf(row.数值)]));
  return pairs.map(([metric, sheet]) => ({ metric, sheet, dashboardValue: dashboard.get(metric), detailUnique: uniqueBills(workbook.getWorksheet(sheet)) }));
}

function uniqueBills(ws) {
  const headerNumber = findHeaderRow(ws, '运单号');
  const headerRow = ws.getRow(headerNumber);
  let col = 0;
  headerRow.eachCell((cell, number) => { if (String(valueOf(cell)).toLowerCase().includes('运单号')) col = number; });
  const set = new Set();
  if (!col) return 0;
  for (let row = headerNumber + 1; row <= ws.rowCount; row++) {
    const value = String(valueOf(ws.getRow(row).getCell(col)) || '').trim().toUpperCase();
    if (value) set.add(value);
  }
  return set.size;
}

function readColumn(ws, name) {
  const headerNumber = findHeaderRow(ws, name);
  let col = 0;
  ws.getRow(headerNumber).eachCell((cell, number) => { if (valueOf(cell) === name) col = number; });
  const out = [];
  for (let row = headerNumber + 1; col && row <= ws.rowCount; row++) {
    const value = valueOf(ws.getRow(row).getCell(col));
    if (value !== '') out.push(String(value));
  }
  return out;
}

function valueOf(cellOrValue) {
  const value = cellOrValue?.value !== undefined ? cellOrValue.value : cellOrValue;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(run => run.text || '').join('').trim();
    return value.result ?? value.text ?? '';
  }
  return value ?? '';
}

function findHeaderRow(ws, expected) {
  for (let row = 1; row <= Math.min(ws.rowCount, 12); row++) {
    let found = false;
    ws.getRow(row).eachCell(cell => {
      if (String(valueOf(cell)).includes(expected)) found = true;
    });
    if (found) return row;
  }
  return 1;
}
function numberOf(value) { const match = String(value ?? '').replace(/,/g, '').match(/^-?\d+(\.\d+)?/); return match ? Number(match[0]) : 0; }
function hashSimple(value) { return JSON.stringify(value); }

function businessTables() {
  return ['daily_reports', 'daily_parse_rows', 'scan_results', 'track_events', 'final_rows', 'pod_locks', 'carry_bills', 'history_summary', 'run_checkpoints', 'run_locks', 'export_snapshots', 'export_records'];
}
function tableCounts(db, tables) { return Object.fromEntries(tables.map(table => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)])); }

function makeDatabaseV3Shaped(dbFile) {
  const db = new DatabaseSync(dbFile);
  db.exec('DROP INDEX IF EXISTS idx_export_snapshots_snapshot_id');
  db.exec('DROP INDEX IF EXISTS idx_export_snapshots_report');
  db.exec('DROP TABLE IF EXISTS export_snapshots');
  db.exec('CREATE TABLE export_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, reportDate TEXT, snapshotType TEXT, payloadJson TEXT, createdAt TEXT)');
  db.prepare("UPDATE app_meta SET value='3' WHERE key='db_schema_version'").run();
  db.exec('PRAGMA user_version=3');
  const now = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO pod_locks(shipmentCode, source, createdAt, updatedAt) VALUES(?,?,?,?)').run('CCOLDPOD', 'old', now, now);
  db.prepare('INSERT OR REPLACE INTO carry_bills(shipmentCode, reportDate, sourceDate, sourceType, status, createdAt, updatedAt) VALUES(?,?,?,?,?,?,?)').run('CCOLDCARRY', '2026-06-30', '2026-06-30', 'old', 'active', now, now);
  db.prepare('INSERT OR REPLACE INTO daily_reports(reportDate, sourceFile, pnhCount, createdAt, updatedAt) VALUES(?,?,?,?,?)').run('2026-06-30', 'old.xlsx', 1, now, now);
  db.prepare('INSERT INTO track_events(shipmentCode, reportDate, eventCode, eventTime, createdAt) VALUES(?,?,?,?,?)').run('CCOLDTRACK', '2026-06-30', 'OLD', '2026-06-30 10:00:00', now);
  db.prepare('INSERT OR REPLACE INTO history_summary(reportDate, summaryJson, createdAt, updatedAt) VALUES(?,?,?,?)').run('2026-06-30', '{"metrics":{"今日PNH":1}}', now, now);
  db.close();
}
