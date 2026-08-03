import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const root = path.join(projectRoot, 'data', 'codex_run_lifecycle');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
process.env.DATA_DIR = root;
process.env.DB_FILE = path.join(root, 'ce_qc_monitor.db');
process.env.EXPORTS_DIR = path.join(root, 'exports');
fs.closeSync(fs.openSync(process.env.DB_FILE, 'w'));

const { closeDb, getDb } = await import('../src/db.js');
const { loadState, resetState, saveState } = await import('../src/storage.js');
const {
  createOrRecoverRun,
  getCurrentReportDate,
  getRunStatus,
  resetAppState,
  updateRunLock
} = await import('../src/store.js');
const { runQcPipeline } = await import('../src/pipeline.js');
const { createDashboardSnapshot, getMatchingSnapshot } = await import('../src/snapshots.js');
const { exportXlsx } = await import('../src/exporter.js');

const results = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
getDb();

await test('T01', '导入日报后直接开始', async () => {
  clean();
  await seedDaily('2026-07-01', ['CCT010001']);
  const run = createOrRecoverRun(getCurrentReportDate());
  assert(run.ok && run.created && run.run.runId, '未自动创建runId');
  const calls = callLog();
  const processed = await processRun(run.run, nonPodClient(calls));
  assert(processed.summary.runId === run.run.runId, 'pipeline丢失runId');
  return { reportDate: getCurrentReportDate(), runId: run.run.runId, confirmCalls: calls.confirm.length };
});

await test('T02', '导入日报后刷新页面再开始', async () => {
  clean();
  await seedDaily('2026-07-02', ['CCT020001']);
  const refreshed = await loadState();
  const run = createOrRecoverRun(getCurrentReportDate());
  assert(refreshed.reportDate === '2026-07-02' && run.ok, '刷新后未从SQLite恢复reportDate');
  return { reportDate: refreshed.reportDate, runId: run.run.runId };
});

await test('T03', '导入日报后重启后台再开始', async () => {
  clean();
  await seedDaily('2026-07-03', ['CCT030001']);
  closeDb(); getDb();
  const restarted = await loadState();
  const run = createOrRecoverRun(getCurrentReportDate());
  assert(restarted.reportDate === '2026-07-03' && run.ok, '后台重启后状态恢复失败');
  return { reportDate: restarted.reportDate, runId: run.run.runId };
});

await test('T04', '暂停后刷新页面再继续', async () => {
  clean();
  await seedDaily('2026-07-04', ['CCT040001', 'CCT040002']);
  const run = createOrRecoverRun('2026-07-04');
  await seedPausedCheckpoint(run.run, 'CCT040001');
  const refreshed = await loadState();
  const recovered = createOrRecoverRun('2026-07-04');
  const calls = callLog();
  await processRun(recovered.run, nonPodClient(calls), refreshed);
  assert(recovered.recovered && !calls.confirm.flat().includes('CCT040001'), '刷新恢复后重复扫描已完成票');
  return { runId: recovered.run.runId, duplicateCompletedBatch: false };
});

await test('T05', '暂停后重启后台再继续', async () => {
  clean();
  await seedDaily('2026-07-05', ['CCT050001', 'CCT050002']);
  const run = createOrRecoverRun('2026-07-05');
  await seedPausedCheckpoint(run.run, 'CCT050001');
  closeDb(); getDb();
  const restarted = await loadState();
  const recovered = createOrRecoverRun('2026-07-05');
  assert(restarted.currentRun?.runId === run.run.runId && recovered.run.runId === run.run.runId, '重启后未恢复原runId');
  return { originalRunId: run.run.runId, recoveredRunId: recovered.run.runId, stage: restarted.processing.phase };
});

await test('T06', '双击开始按钮', async () => {
  clean();
  await seedDaily('2026-07-06', ['CCT060001']);
  const first = createOrRecoverRun('2026-07-06');
  const second = createOrRecoverRun('2026-07-06', { rejectRunning: true });
  const count = getDb().prepare('SELECT COUNT(*) AS count FROM run_locks WHERE reportDate=?').get('2026-07-06').count;
  assert(first.ok && !second.ok && second.code === 'RUN_ALREADY_ACTIVE' && count === 1, '双击产生重复run');
  return { runCount: count, secondCode: second.code };
});

await test('T07', '同日报重复导入', async () => {
  clean();
  await seedDaily('2026-07-07', ['CCT070001', 'CCT070002']);
  await seedDaily('2026-07-07', ['CCT070001', 'CCT070002']);
  const db = getDb();
  const reports = db.prepare('SELECT COUNT(*) AS count FROM daily_reports WHERE reportDate=?').get('2026-07-07').count;
  const rows = db.prepare('SELECT COUNT(*) AS count FROM daily_parse_rows WHERE reportDate=?').get('2026-07-07').count;
  assert(reports === 1 && rows === 2, '重复导入产生重复数据');
  return { dailyReports: reports, parseRows: rows };
});

await test('T08', '只导入长期JSON后开始', async () => {
  clean();
  await saveState({ reportDate: '', carryBills: ['CCLONG001'], podLocks: ['CCLONGPOD'], backupImportedAt: new Date().toISOString() });
  const reportDate = getCurrentReportDate();
  const run = createOrRecoverRun(reportDate);
  assert(!run.ok && run.code === 'REPORT_DATE_MISSING', '无日报仍创建run');
  return { code: run.code, runCreated: false };
});

let completedContext;
await test('T09', '处理完成生成snapshot', async () => {
  clean();
  await seedDaily('2026-07-09', ['CCT090001', 'CCT090002']);
  const run = createOrRecoverRun('2026-07-09');
  const calls = callLog();
  const processed = await processRun(run.run, mixedClient('CCT090001', calls));
  const snapshot = createDashboardSnapshot(processed.state, { reportDate: '2026-07-09', runId: run.run.runId });
  const lock = getRunStatus('2026-07-09').lock;
  assert(snapshot.reportDate === '2026-07-09' && snapshot.runId === run.run.runId && lock.status === 'finished', 'snapshot未绑定run或run未完成');
  completedContext = { state: processed.state, snapshot, calls };
  return { snapshotId: snapshot.snapshotId, runId: snapshot.runId, status: lock.status };
});

await test('T10', '页面与XLSX使用同一snapshotId', async () => {
  const matched = getMatchingSnapshot(completedContext.state);
  const file = await exportXlsx({ ...matched.state, snapshotId: matched.snapshotId });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const ids = readColumn(workbook.getWorksheet('数据一致性检查'), 'snapshotId');
  assert(ids.length && ids.every(id => id === matched.snapshotId), '页面与XLSX snapshotId不一致');
  return { pageSnapshotId: matched.snapshotId, xlsxSnapshotId: ids[0] };
});

await test('T11', '导出XLSX不调用CE API', async () => {
  const before = completedContext.calls.confirm.length + completedContext.calls.track.length;
  const matched = getMatchingSnapshot(completedContext.state);
  await exportXlsx({ ...matched.state, snapshotId: matched.snapshotId });
  const after = completedContext.calls.confirm.length + completedContext.calls.track.length;
  assert(before === after, '导出阶段重新调用CE API');
  return { apiCallsBefore: before, apiCallsAfter: after };
});

let clearResult;
await test('T12', '彻底清空前生成备份', async () => {
  clearResult = await resetState('彻底清空');
  assert(fs.existsSync(clearResult.backupFile), '清空前备份不存在');
  return { backupFile: clearResult.backupFile };
});

await test('T13', '清空后状态与业务表归零', async () => {
  const state = await loadState();
  const db = getDb();
  const tables = ['daily_reports', 'daily_parse_rows', 'scan_results', 'track_events', 'final_rows', 'carry_bills', 'pod_locks', 'run_locks', 'run_checkpoints', 'export_snapshots'];
  const counts = Object.fromEntries(tables.map(table => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
  assert(!state.reportDate && !state.currentRun && !getMatchingSnapshot(state) && Object.values(counts).every(value => value === 0), '清空后状态未归零');
  return { reportDate: state.reportDate, runId: '', snapshotId: '', counts };
});

await test('T14', '清空后重新导入可创建新run', async () => {
  await seedDaily('2026-07-14', ['CCT140001']);
  const run = createOrRecoverRun('2026-07-14');
  assert(run.ok && run.created, '清空后无法创建新run');
  return { runId: run.run.runId };
});

await test('T15', 'Day1未POD，Day2继续扫描和轨迹', async () => {
  clean();
  await seedDaily('2026-07-15', ['CCCARRY001']);
  const day1Run = createOrRecoverRun('2026-07-15');
  const day1 = await processRun(day1Run.run, nonPodClient(callLog()));
  assert(day1.state.nextCarryBills.includes('CCCARRY001'), 'Day1未进入carry');
  await seedDaily('2026-07-16', ['CCDAY2NEW'], day1.state);
  const day2Run = createOrRecoverRun('2026-07-16');
  const calls = callLog();
  await processRun(day2Run.run, nonPodClient(calls));
  assert(calls.confirm.flat().includes('CCCARRY001') && calls.track.flat().includes('CCCARRY001'), 'Day2未查询旧carry');
  return { scanQueried: true, trackQueried: true };
});

await test('T16', 'Day2查到POD退出carry并写POD锁', async () => {
  clean();
  await seedDaily('2026-07-16', ['CCCARRYPOD']);
  const day1Run = createOrRecoverRun('2026-07-16');
  const day1 = await processRun(day1Run.run, nonPodClient(callLog()));
  await seedDaily('2026-07-17', ['CCDAY2POD'], day1.state);
  const day2Run = createOrRecoverRun('2026-07-17');
  const day2 = await processRun(day2Run.run, mixedClient('CCCARRYPOD', callLog()));
  assert(day2.state.podLocks.includes('CCCARRYPOD') && !day2.state.nextCarryBills.includes('CCCARRYPOD'), 'POD后未退出carry');
  return { podLocked: true, remainsCarry: false };
});

await test('T17', 'API失败保留carry和checkpoint', async () => {
  clean();
  await seedDaily('2026-07-17', ['CCFAILCARRY']);
  const run = createOrRecoverRun('2026-07-17');
  const failed = await processRun(run.run, failedTrackClient(callLog()));
  const checkpoints = getRunStatus('2026-07-17').checkpoints;
  assert(failed.state.nextCarryBills.includes('CCFAILCARRY') && checkpoints.length > 0, 'API失败丢失carry或checkpoint');
  return { carryPreserved: true, checkpointCount: checkpoints.length };
});

await test('T18', '旧数据库升级保留历史与CP码', async () => {
  closeDb();
  const oldRoot = path.join(root, 'old_upgrade');
  fs.mkdirSync(oldRoot, { recursive: true });
  process.env.DATA_DIR = oldRoot;
  process.env.DB_FILE = path.join(oldRoot, 'ce_qc_monitor.db');
  fs.closeSync(fs.openSync(process.env.DB_FILE, 'w'));
  getDb(); closeDb();
  const db = new DatabaseSync(process.env.DB_FILE);
  const now = new Date().toISOString();
  db.prepare("UPDATE app_meta SET value='5' WHERE key='db_schema_version'").run();
  db.exec('PRAGMA user_version=5');
  db.prepare('INSERT OR REPLACE INTO daily_reports(reportDate, sourceFile, pnhCount, createdAt, updatedAt) VALUES(?,?,?,?,?)').run('2026-06-30', 'old.xls', 1, now, now);
  db.prepare('INSERT OR REPLACE INTO pod_locks(shipmentCode, source, createdAt, updatedAt) VALUES(?,?,?,?)').run('CCOLDPOD', 'old', now, now);
  db.prepare('INSERT OR REPLACE INTO carry_bills(shipmentCode, reportDate, sourceDate, sourceType, status, createdAt, updatedAt) VALUES(?,?,?,?,?,?,?)').run('CCOLDCARRY', '2026-06-30', '2026-06-30', 'old', 'active', now, now);
  db.prepare('INSERT OR REPLACE INTO history_summary(reportDate, summaryJson, createdAt, updatedAt) VALUES(?,?,?,?)').run('2026-06-30', '{"metrics":{"今日PNH":1}}', now, now);
  const cpBefore = db.prepare('SELECT COUNT(*) AS count FROM shop_cp_codes').get().count;
  db.close();
  const upgraded = getDb();
  const preserved = {
    daily: upgraded.prepare('SELECT COUNT(*) AS count FROM daily_reports').get().count,
    pod: upgraded.prepare('SELECT COUNT(*) AS count FROM pod_locks').get().count,
    carry: upgraded.prepare('SELECT COUNT(*) AS count FROM carry_bills').get().count,
    history: upgraded.prepare('SELECT COUNT(*) AS count FROM history_summary').get().count,
    cp: upgraded.prepare('SELECT COUNT(*) AS count FROM shop_cp_codes').get().count
  };
  assert(preserved.daily && preserved.pod && preserved.carry && preserved.history && preserved.cp >= cpBefore, '升级后历史数据或CP码丢失');
  return { fromVersion: 5, toVersion: 9, preserved };
});

const output = { ok: results.every(row => row.ok), total: results.length, passed: results.filter(row => row.ok).length, failed: results.filter(row => !row.ok).length, results };
const reportFile = path.join(root, 'run_lifecycle_results.json');
fs.writeFileSync(reportFile, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ ...output, reportFile }, null, 2));
if (!output.ok) process.exitCode = 1;

async function test(id, scene, fn) {
  try { results.push({ id, scene, ok: true, detail: await fn() }); }
  catch (error) { results.push({ id, scene, ok: false, error: error.message }); }
}

function clean() { resetAppState({}); }

async function seedDaily(reportDate, bills, previous = {}) {
  const rows = bills.map((shipmentCode, index) => ({ sheetName: '日报', rowNumber: index + 2, shipmentCode, result: 'PNH', reason: '测试日报' }));
  const carry = previous.nextCarryBills || previous.carryBills || [];
  await saveState({
    reportDate, sourceName: `${reportDate}.xlsx`, dailyParseSummary: { pnh: bills.length, totalRecognized: bills.length, totalAppearances: bills.length },
    dailyParseRows: rows, pnhBills: bills, nonPnhBills: [], excludedBills: [], duplicateBills: [],
    carryBills: carry, nextCarryBills: carry, podLocks: previous.podLocks || [], historySummary: previous.historySummary || [],
    scanPool: [], scanResults: [], needTrackBills: [], trackEvents: [], trackResults: [], finalRows: [], processing: { running: false, paused: false, phase: '' }
  });
}

async function seedPausedCheckpoint(run, completedBill) {
  const state = await loadState();
  state.currentRun = run;
  state.lastRunSummary = { runId: run.runId, reportDate: run.reportDate };
  state.scanResults = [{ 运单号: completedBill, orderStatus: '40', 是否POD: '否', 扫描分类: '已完成扫描' }];
  state.processing = { running: false, paused: true, phase: '订单扫描', batchIndex: 1, totalBatches: 2, runId: run.runId };
  updateRunLock(run.reportDate, 'paused');
  await saveState(state);
}

async function processRun(run, client, inputState = null) {
  const state = inputState || await loadState();
  state.currentRun = run;
  state.lastRunSummary = { ...(state.lastRunSummary || {}), runId: run.runId, reportDate: run.reportDate };
  const result = await runQcPipeline({ state, client, onCheckpoint: saveState, isPaused: async () => false });
  await saveState(result.state);
  return result;
}

function callLog() { return { confirm: [], track: [] }; }

function nonPodClient(calls) {
  return {
    async confirmQuery(bills) { calls.confirm.push([...bills]); return bills.map(shipmentCode => ({ shipmentCode, orderStatus: 40 })); },
    async trackQuery(bills) { calls.track.push([...bills]); return bills.map(shipmentCode => pendingEvent(shipmentCode)); }
  };
}

function mixedClient(podBill, calls) {
  return {
    async confirmQuery(bills) { calls.confirm.push([...bills]); return bills.map(shipmentCode => ({ shipmentCode, orderStatus: shipmentCode === podBill ? 85 : 40 })); },
    async trackQuery(bills) { calls.track.push([...bills]); return bills.map(shipmentCode => pendingEvent(shipmentCode)); }
  };
}

function failedTrackClient(calls) {
  return {
    async confirmQuery(bills) { calls.confirm.push([...bills]); return bills.map(shipmentCode => ({ shipmentCode, orderStatus: 40 })); },
    async trackQuery(bills) { calls.track.push([...bills]); throw new Error('mock track timeout'); }
  };
}

function pendingEvent(shipmentCode) {
  return { shipmentCode, eventCode: '150', trackingEventCode: '150', trackingEventDescZh: 'Pending 客户无人接听', eventTime: '2026-07-01 10:00:00' };
}

function readColumn(ws, name) {
  let header = 1;
  let column = 0;
  for (let row = 1; row <= Math.min(12, ws.rowCount); row++) {
    ws.getRow(row).eachCell((cell, number) => { if (cellText(cell) === name) { header = row; column = number; } });
    if (column) break;
  }
  const values = [];
  for (let row = header + 1; column && row <= ws.rowCount; row++) {
    const value = cellText(ws.getRow(row).getCell(column));
    if (value) values.push(value);
  }
  return values;
}

function cellText(cell) {
  const value = cell?.value ?? cell;
  if (value && typeof value === 'object') return String(value.result ?? value.text ?? '');
  return String(value ?? '');
}
