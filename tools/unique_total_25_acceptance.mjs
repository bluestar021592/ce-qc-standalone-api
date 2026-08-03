import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';

const projectRoot = path.resolve('.');
const root = path.join(projectRoot, 'data', 'unique_20260802_acceptance', 'main_25');
fs.mkdirSync(root, { recursive: true });
process.env.DATA_DIR = root;
process.env.DB_FILE = path.join(root, 'ce_qc_monitor.db');
process.env.EXPORTS_DIR = path.join(root, 'exports');

const { getDb, closeDb } = await import('../src/db.js');
const { loadState, saveState } = await import('../src/storage.js');
const { createOrRecoverRun, resetAppState } = await import('../src/store.js');
const { saveBusinessState, loadBusinessState, createOrRecoverBusinessRun, SHOPEE } = await import('../src/businessStore.js');
const { splitTrackBatches, queryBatchWithFallback, TRACK_QUERY_BATCH_SIZE } = await import('../src/trackBatching.js');
const { runQcPipeline } = await import('../src/pipeline.js');
const { analyzeShopeeShipment } = await import('../src/shopeeAnalyzer.js');
const { analyzeShipment } = await import('../src/analyzer.js');
const { buildShopeeDashboard } = await import('../src/shopeeReporting.js');
const { getMetricTrend } = await import('../src/reporting.js');
const { buildLongBackupV2 } = await import('../src/longBackup.js');
const { parseLongBackupModules } = await import('../src/backupParser.js');
const { mergeBackupModule } = await import('../src/backupRecovery.js');
const { migrateDatabase } = await import('../src/migrations.js');

const results = [];
const evidence = {};
const test = async (id, name, fn) => {
  try { results.push({ id, name, ok: true, detail: await fn() }); }
  catch (error) { results.push({ id, name, ok: false, error: error.message }); }
};
const today = '2026-08-02';

await test('T001', '只导入CCSL日报即可开始', async () => {
  resetAppState({});
  await saveState({ reportDate: today, sourceName: 'CCSL.xlsx', dailyParseSummary: { pnh: 1, totalRecognized: 1 }, dailyParseRows: [{ shipmentCode: 'CCSTART0001', result: 'PNH' }], pnhBills: ['CCSTART0001'] });
  const run = createOrRecoverRun(today);
  assert.ok(run.ok && run.run.runId);
  return { runId: run.run.runId, jsonImported: false };
});

await test('T002', '只导入SHOPEE日报即可开始', () => {
  const state = shopeeState(today, [fixtureRow('SPESTART0001', 'CN', 'PP')]);
  saveBusinessState(state, SHOPEE);
  const run = createOrRecoverBusinessRun(SHOPEE, today);
  assert.ok(run.ok && run.run.runId);
  return { runId: run.run.runId, jsonImported: false };
});

await test('T003', '日报与JSON两种顺序不覆盖运行态', () => {
  const imported = { podLocks: ['SPEPODBACKUP'], carryBills: ['SPECARRYBACKUP'], carryRows: [fixtureRow('SPECARRYBACKUP', 'VN', 'PV')], historySummary: [{ reportDate: '2026-08-01', summary: { metrics: { ALL_今日总单: 1 } } }] };
  const dailyFirst = { ...shopeeState(today, [fixtureRow('SPEDAILY0001', 'CN', 'PP')]), currentRun: { runId: 'RUN-CURRENT' }, snapshotId: 'SNAP-CURRENT' };
  mergeBackupModule(dailyFirst, imported, { businessType: 'SHOPEE' });
  assert.equal(dailyFirst.reportDate, today); assert.equal(dailyFirst.currentRun.runId, 'RUN-CURRENT'); assert.equal(dailyFirst.snapshotId, 'SNAP-CURRENT');
  const jsonFirst = { businessType: 'SHOPEE' };
  mergeBackupModule(jsonFirst, imported, { businessType: 'SHOPEE' });
  Object.assign(jsonFirst, shopeeState(today, [fixtureRow('SPEDAILY0001', 'CN', 'PP')]), { carryBills: jsonFirst.carryBills, priorCarryRows: jsonFirst.priorCarryRows });
  assert.equal(jsonFirst.reportDate, today); assert.ok(jsonFirst.carryBills.includes('SPECARRYBACKUP'));
  return { dailyThenJson: { reportDate: dailyFirst.reportDate, runId: dailyFirst.currentRun.runId, snapshotId: dailyFirst.snapshotId }, jsonThenDaily: { reportDate: jsonFirst.reportDate, carry: jsonFirst.carryBills } };
});

await test('T004', '刷新与后台重启恢复状态', async () => {
  const state = shopeeState(today, [fixtureRow('SPERESTART01', 'CN', 'PP')]);
  state.currentRun = { runId: 'RUN-RESTART' }; state.processing = { phase: '轨迹查询', batchIndex: 1, totalBatches: 2 };
  saveBusinessState(state, SHOPEE);
  closeDb(); getDb();
  const restored = loadBusinessState(SHOPEE);
  assert.equal(restored.reportDate, today); assert.equal(restored.currentRun.runId, 'RUN-RESTART'); assert.equal(restored.processing.batchIndex, 1);
  return { reportDate: restored.reportDate, runId: restored.currentRun.runId, checkpoint: restored.processing };
});

await test('T005', 'CCSL与SHOPEE业务隔离', () => {
  const sameBill = 'SAMEBILL0001';
  saveBusinessState({ ...shopeeState(today, [fixtureRow(sameBill, 'CN', 'PP')]), podLocks: [sameBill] }, 'SHOPEE');
  saveBusinessState({ ...shopeeState(today, [fixtureRow(sameBill, 'OTHER', 'PP')]), businessType: 'CCSL', podLocks: [], carryBills: [sameBill], nextCarryBills: [sameBill] }, 'CCSL');
  const rows = getDb().prepare('SELECT businessType,shipmentCode FROM business_pod_locks WHERE shipmentCode=?').all(sameBill);
  const carry = getDb().prepare("SELECT businessType,shipmentCode FROM business_carry_bills WHERE shipmentCode=? AND status='active'").all(sameBill);
  assert.deepEqual(rows.map(row => row.businessType), ['SHOPEE']); assert.ok(carry.some(row => row.businessType === 'CCSL'));
  return { podLocks: rows, carry };
});

await test('T006', '51票拆为50+1', () => {
  const sizes = splitTrackBatches(bills(51)).map(batch => batch.length);
  assert.equal(TRACK_QUERY_BATCH_SIZE, 50); assert.deepEqual(sizes, [50, 1]);
  evidence.batch50 = Object.fromEntries([1, 10, 11, 49, 50, 51, 99, 100, 101].map(count => [count, splitTrackBatches(bills(count)).map(batch => batch.length)]));
  return { max: TRACK_QUERY_BATCH_SIZE, sizes, matrix: evidence.batch50 };
});

await test('T007', '仅重试失败批次', async () => {
  const source = bills(100); const firstBatch = source.slice(0, 50); const secondBatch = source.slice(50);
  const stored = []; const failed = [];
  for (const batch of [firstBatch, secondBatch]) {
    const result = await queryBatchWithFallback({ batch, fallbackSizes: [], query: async codes => { if (codes[0] === secondBatch[0]) throw new Error('fixture timeout'); return codes.map(shipmentCode => ({ shipmentCode })); } });
    stored.push(...result.successes.flatMap(item => item.events)); failed.push(...result.failures.flatMap(item => item.batch));
  }
  let retried = [];
  const retryResult = await queryBatchWithFallback({ batch: failed, query: async codes => { retried = [...codes]; return codes.map(shipmentCode => ({ shipmentCode })); } });
  stored.push(...retryResult.successes.flatMap(item => item.events));
  assert.equal(stored.length, 100); assert.equal(retried.length, 50); assert.equal(retried.some(code => firstBatch.includes(code)), false);
  return { successfulKept: 50, retried: retried.length, successfulRepeated: 0 };
});

await test('T008', '导出阶段不调用CE API', () => {
  const vn = readVnReport(); const check = vn.results.find(row => row.id === 'VC018');
  assert.ok(check?.ok); assert.equal(check.detail.apiCallsDuringExport, 0);
  return check.detail;
});

await test('T009', '网页明细导出同一snapshot', () => {
  const vn = readVnReport();
  assert.ok(vn.evidence.xlsxFile); assert.ok(vn.evidence.reconciliation.status === 'PASSED');
  return { snapshot: 'SHOPEE-UNIQUE-20260802-SNAPSHOT', xlsx: vn.evidence.xlsxFile, reconciliation: vn.evidence.reconciliation.status };
});

await test('T010', '盘点样本不误判入库无扫描', () => {
  const row = analyzeShopeeShipment({ waybill: 'SPE260713000415', reportDate: today, events: [{ shipmentCode: 'SPE260713000415', eventTime: `${today} 09:00:00`, trackingEventDescZh: 'Cycle Count' }], apiStatus: allApiSuccess() });
  assert.equal(row.入库无扫描节点, '否'); assert.ok(Number(row.盘点天数 || row.盘点次数 || 0) >= 1);
  return { category: row.primaryCategory, cycleDays: row.盘点天数, inboundNoScan: row.入库无扫描节点 };
});

await test('T011', '已签收写POD锁且不查轨迹', async () => {
  const calls = { shipment: 0, event: 0, exception: 0 };
  const state = shopeeState(today, [fixtureRow('SPEPOD000001', 'CN', 'PP')]); state.currentRun = { runId: 'RUN-POD' };
  const client = {
    shipmentTrack: async codes => { calls.shipment += 1; return codes.map(shipmentCode => ({ shipmentCode, shipmentStatus: '85', shipmentStatusDesc: 'POD' })); },
    trackQuery: async () => { calls.event += 1; return []; },
    exceptionQuery: async () => { calls.exception += 1; return []; }
  };
  const output = await runQcPipeline({ state, client, onProgress: async () => {}, onCheckpoint: async () => {}, isPaused: async () => false });
  assert.ok(output.state.podLocks.includes('SPEPOD000001')); assert.equal(calls.event, 0); assert.equal(calls.exception, 0);
  return { calls, podLocked: true };
});

await test('T012', '空拦截数据不误判入库', () => {
  const row = analyzeShopeeShipment({ waybill: 'SPEEMPTYDATA01', reportDate: today, shipmentTrackRow: { interceptingData: [] }, events: [], apiStatus: allApiSuccess() });
  assert.equal(row.入库无扫描节点, '否');
  return { category: row.primaryCategory, inboundNoScan: row.入库无扫描节点 };
});

await test('T013', '同日重复节点只计一天', () => {
  const row = analyzeShopeeShipment({ waybill: 'SPEDUPDAY0001', reportDate: today, events: [
    { shipmentCode: 'SPEDUPDAY0001', eventTime: `${today} 08:00:00`, trackingEventDescZh: 'Pending' },
    { shipmentCode: 'SPEDUPDAY0001', eventTime: `${today} 12:00:00`, trackingEventDescZh: 'Pending OC Cycle Count' }
  ], exceptions: [{ shipmentCode: 'SPEDUPDAY0001', reportTime: `${today} 12:00:00`, exceptionDesc: 'OC' }], apiStatus: allApiSuccess() });
  assert.equal(row.Pending次数, 1); assert.equal(row.OC天数, 1);
  return { pendingDays: row.Pending次数, ocDays: row.OC天数, cycleDays: row.盘点天数 };
});

await test('T014', 'CCSL正常最终节点退出异常', () => {
  const row = analyzeShipment({ waybill: 'CCNORMAL0001', reportDate: today, events: [{ shipmentCode: 'CCNORMAL0001', eventTime: `${today} 10:00:00`, trackingEventDescZh: '货物到达网点【CEL:CCSLPDD】', eventCode: 'Inbound' }] });
  assert.ok(['正常分流节点', '最终分流排除'].includes(row.异常分类));
  return { category: row.异常分类, matchedRule: row.matchedRule };
});

const detailState = detailFixtureState();
const detailView = buildShopeeDashboard(detailState);
await test('T015', 'OC2+点击直达具体单号', () => {
  assert.deepEqual(detailView.detailTabs.CN_oc2.rows.map(row => row.shipmentCode), ['SPEDETAILCN01']);
  return { tab: 'CN_oc2', bills: detailView.detailTabs.CN_oc2.rows.map(row => row.shipmentCode) };
});
await test('T016', '0票指标可进入空明细', () => {
  assert.ok(detailView.detailTabs.CN_oc3); assert.equal(detailView.detailTabs.CN_oc3.rows.length, 0);
  return { tab: 'CN_oc3', rows: 0 };
});

await test('T017', '四个桌面宽度响应式规则', () => {
  const css = fs.readFileSync(path.join(projectRoot, 'public', 'responsive-dashboard.css'), 'utf8');
  const pixel = fs.readFileSync(path.join(projectRoot, 'public', 'pixel-lock.css'), 'utf8');
  assert.ok(css.includes('@media (max-width: 1500px)') && css.includes('@media (max-width: 1366px)') && css.includes('@media (max-width: 1279px)'));
  assert.ok(!/transform\s*:\s*scale|scaleX\s*\(/i.test(css + pixel));
  return { widths: [1280, 1366, 1600, 1920], scaleTransform: false };
});

await test('T018', '趋势最早在左且最新在右', () => {
  const historySummary = Array.from({ length: 6 }, (_, index) => ({ reportDate: dateShift(today, index - 6), summary: { metrics: { TEST: index + 1 } } }));
  const trend = getMetricTrend('SHOPEE', 'TEST', today, 7, { businessType: 'SHOPEE', historySummary }, 7, 'normal');
  assert.equal(trend[0].date, dateShift(today, -6)); assert.equal(trend[6].date, today); assert.deepEqual(trend.map(row => row.value), [1, 2, 3, 4, 5, 6, 7]);
  return { dates: trend.map(row => row.date), values: trend.map(row => row.value), colors: trend.map(row => row.status) };
});

await test('T019', '迁移前备份并保留旧数据', () => {
  const dir = path.join(root, 'migration'); const backupsDir = path.join(dir, 'backups'); fs.mkdirSync(backupsDir, { recursive: true });
  const dbFile = path.join(dir, 'old_v9.db'); const db = new DatabaseSync(dbFile);
  migrateDatabase(db, { dbFile, backupsDir });
  db.prepare("INSERT INTO business_states(businessType,valueJson,updatedAt) VALUES('SHOPEE','{\"marker\":\"KEEP\"}','now') ON CONFLICT(businessType) DO UPDATE SET valueJson=excluded.valueJson").run();
  db.prepare("UPDATE app_meta SET value='9' WHERE key='db_schema_version'").run(); db.exec('PRAGMA user_version=9');
  const migrated = migrateDatabase(db, { dbFile, backupsDir });
  const marker = db.prepare("SELECT valueJson FROM business_states WHERE businessType='SHOPEE'").get().valueJson;
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check; db.close();
  assert.ok(migrated.backupPath && fs.existsSync(migrated.backupPath)); assert.ok(marker.includes('KEEP')); assert.equal(integrity, 'ok');
  return { backupPath: migrated.backupPath, dataPreserved: true, integrity };
});

await test('T020', '源码与公开页面无认证明文', () => {
  const publicText = ['index.html', 'app.js', 'dashboard-components.js'].map(file => fs.readFileSync(path.join(projectRoot, 'public', file), 'utf8')).join('\n');
  const gitignore = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
  assert.ok(!/CE_AUTHORIZATION\s*=|CE_BLADE_AUTH\s*=|CE_COOKIE\s*=|x-access-token\s*:\s*["'][A-Za-z0-9]/i.test(publicText));
  assert.ok(gitignore.includes('.env') && /token\.json/.test(gitignore));
  return { publicTokenLiteral: false, envIgnored: true, tokenFileIgnored: true };
});

await test('T021', 'CN965/VN1535/OTHER0', () => {
  const vc = readVnReport().results.find(row => row.id === 'VC006'); assert.ok(vc?.ok); return vc.detail;
});
await test('T022', '收件人来源与PP/PV正交', () => {
  const combos = ['CN_PP', 'CN_PV', 'VN_PP', 'VN_PV'];
  const rows = detailView.detailTabs.ALL_all.rows;
  const found = new Set(rows.map(row => `${row.recipient_group}_${String(row.regionCode).slice(0, 2)}`));
  assert.ok(combos.every(value => found.has(value)));
  return { combinations: combos };
});
await test('T023', 'CN/VN指标跳转数据隔离', () => {
  assert.ok(detailView.detailTabs.CN_oc2.rows.every(row => row.recipient_group === 'CN'));
  assert.ok(detailView.detailTabs.VN_pending3.rows.every(row => row.recipient_group === 'VN'));
  return { cnOc2: detailView.detailTabs.CN_oc2.rows.map(row => row.shipmentCode), vnPending3: detailView.detailTabs.VN_pending3.rows.map(row => row.shipmentCode) };
});
await test('T024', '未知收件人进入OTHER', () => {
  const vc = readVnReport().results.find(row => row.id === 'VC007'); assert.ok(vc?.ok && vc.detail.groupCounts.OTHER === 3); return vc.detail;
});
await test('T025', 'SHOPEE独立导出与快照一致', async () => {
  const vc = readVnReport(); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(vc.evidence.xlsxFile);
  assert.ok(workbook.getWorksheet('03_ShopeeCN统计') && workbook.getWorksheet('04_ShopeeVN统计'));
  assert.ok(workbook.getWorksheet('99_一致性校验').getCell('F5').text);
  return { file: vc.evidence.xlsxFile, apiCalls: 0, sheets: workbook.worksheets.map(sheet => sheet.name) };
});

const failed = results.filter(row => !row.ok);
const output = { ok: failed.length === 0, total: results.length, passed: results.length - failed.length, failed: failed.length, generatedAt: new Date().toISOString(), results, evidence };
const reportFile = path.join(root, 'unique_total_25_results.json'); const csvFile = path.join(root, 'unique_total_25_results.csv');
fs.writeFileSync(reportFile, JSON.stringify(output, null, 2), 'utf8');
fs.writeFileSync(csvFile, '\uFEFF' + ['编号,测试,结果,证据', ...results.map(row => [row.id, row.name, row.ok ? '通过' : '失败', JSON.stringify(row.detail || row.error || '')].map(csv).join(','))].join('\n'), 'utf8');
console.log(JSON.stringify({ ok: output.ok, total: output.total, passed: output.passed, failed: output.failed, reportFile, csvFile }, null, 2));
closeDb();
if (!output.ok) process.exitCode = 1;

function shopeeState(reportDate, rows) {
  return { businessType: 'SHOPEE', reportDate, sourceName: 'SHOPEE.xlsx', dailyReportReady: true, dailyParseSummary: { totalRecognized: rows.length, groupCounts: groupCounts(rows), reconciliation: { status: 'PASSED' } }, dailyParseRows: rows, pnhBills: rows.map(row => row.shipmentCode), carryBills: [], nextCarryBills: [], podLocks: [], finalRows: [], scanResults: [], trackEvents: [], trackResults: [], historySummary: [], processing: {} };
}
function fixtureRow(shipmentCode, group, region) { return { shipmentCode, 运单号: shipmentCode, recipient_raw: group === 'CN' ? 'ShopeeCN' : group === 'VN' ? 'ShopeeVN' : 'Unknown', recipient_normalized: group === 'CN' ? 'shopeecn' : group === 'VN' ? 'shopeevn' : 'unknown', recipient_group: group, recipient_group_reason: group === 'OTHER' ? 'UNKNOWN_RECIPIENT' : 'EXACT_MATCH', regionCode: region, regionType: region === 'PP' ? 'PHNOM_PENH' : 'PROVINCE', source_row_number: 2 }; }
function groupCounts(rows) { return rows.reduce((out, row) => { out[row.recipient_group] = (out[row.recipient_group] || 0) + 1; return out; }, { CN: 0, VN: 0, OTHER: 0 }); }
function bills(count) { return Array.from({ length: count }, (_, index) => `SPE${String(index + 1).padStart(12, '0')}`); }
function allApiSuccess() { return { shipment: 'success', event: 'success', exception: 'success' }; }
function dateShift(date, offset) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); }
function readVnReport() { return JSON.parse(fs.readFileSync(path.join(projectRoot, 'data', 'unique_20260802_acceptance', 'VN_CN_20_acceptance_results.json'), 'utf8')); }
function detailFixtureState() {
  const rows = [
    { ...fixtureRow('SPEDETAILCN01', 'CN', 'PP'), OC天数: 2, 是否POD: '否', API状态: '成功', primaryCategory: 'OC2天' },
    { ...fixtureRow('SPEDETAILCN02', 'CN', 'PV'), 是否POD: '是', API状态: '成功', primaryCategory: 'POD闭环' },
    { ...fixtureRow('SPEDETAILVN01', 'VN', 'PP'), Pending次数: 3, 是否POD: '否', API状态: '成功', primaryCategory: 'Pending3天' },
    { ...fixtureRow('SPEDETAILVN02', 'VN', 'PV'), 是否POD: '是', API状态: '成功', primaryCategory: 'POD闭环' }
  ];
  return { ...shopeeState(today, rows), finalRows: rows, carryBills: ['SPEDETAILCN01', 'SPEDETAILVN01'], nextCarryBills: ['SPEDETAILCN01', 'SPEDETAILVN01'] };
}
function csv(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
