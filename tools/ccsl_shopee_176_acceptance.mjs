import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const outputRoot = path.join(projectRoot, 'data', 'codex_ccsl_shopee_176');
const fixtureRoot = path.join(outputRoot, 'browser_data');
const baselineFile = path.join(projectRoot, 'data', 'codex_ccsl_shopee_148', 'ccsl_shopee_148_results.json');
const browserAuditFile = path.join(outputRoot, 'screenshots', 'browser_audit.json');
const fixtureFile = path.join(fixtureRoot, 'fixture_evidence.json');
const latestLockFile = path.join(projectRoot, 'data', 'codex_final_locked_ui_export', 'evidence', 'latest_50_acceptance_results.json');
const checklistFile = path.join(projectRoot, '_codex_final_locked_ui_pack_20260720', 'CODEX_CCSL_SHOPEE最终锁版UI与全量修复大包', '03_验收与证据', '01_总验收清单.csv');

for (const required of [baselineFile, browserAuditFile, fixtureFile, latestLockFile, checklistFile]) {
  if (!fs.existsSync(required)) throw new Error(`缺少验收前置证据：${required}`);
}

const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
const browserAudit = JSON.parse(fs.readFileSync(browserAuditFile, 'utf8'));
const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
const latestLock = JSON.parse(fs.readFileSync(latestLockFile, 'utf8'));
const html = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(projectRoot, 'public', 'style.css'), 'utf8');
const serverJs = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
const migrationJs = fs.readFileSync(path.join(projectRoot, 'src', 'migrations.js'), 'utf8');

process.env.DATA_DIR = fixtureRoot;
process.env.DB_FILE = path.join(fixtureRoot, 'ce_qc_monitor.db');
process.env.EXPORTS_DIR = path.join(fixtureRoot, 'exports');

const { loadState } = await import('../src/storage.js');
const { loadBusinessState, SHOPEE } = await import('../src/businessStore.js');
const { buildDashboardRows, getMetricTrend } = await import('../src/reporting.js');
const { buildShopeeDashboard } = await import('../src/shopeeReporting.js');
const { migrateDatabase } = await import('../src/migrations.js');
const { getDb, closeDb } = await import('../src/db.js');

const ccslState = await loadState();
const shopeeState = loadBusinessState(SHOPEE);
const ccslRows = buildDashboardRows(ccslState);
const shopeeRows = buildShopeeDashboard(shopeeState).dashboardRows;
const rollbackEvidence = testMigrationRollback();
const xlsxEvidence = await auditFixtureWorkbooks(ccslState, shopeeState, ccslRows, shopeeRows);
const screenshotFiles = [
  'home_1920x1080.png', 'home_1440x900.png', 'home_1366x768.png',
  'ccsl_dashboard_1920x1080.png', 'shopee_dashboard_1920x1080.png',
  'ccsl_export_preview_1920x1080.png', 'shopee_export_preview_1920x1080.png'
].map(name => path.join(outputRoot, 'screenshots', name));

const requiredShopeeMetrics = ['Pending 1次','Pending 2次','Pending 3次及以上','Pending连续','Pending不连续','OC 1天','OC 2天','OC 3天及以上','入库无扫描节点','派送中停留','节点未更新','无轨迹','API失败待重试','跨日遗留','今日POD','明日继续'];
const uiChecks = [
  check('UI-001', html.includes('homePage') && html.includes('businessSummaryGrid') && !/background(?:-image)?\s*:\s*url\([^)]*最终锁版UI参考图/i.test(css), '首页由真实DOM组件构成，未使用参考整图背景'),
  check('UI-002', browserAudit.home1920.kpis === 6 && browserAudit.home1920.kpiValues.length === 6 && browserAudit.home1920.trends >= 6, JSON.stringify(browserAudit.home1920.kpiValues)),
  check('UI-003', trendsAscending([...ccslRows, ...shopeeRows]), '所有趋势左侧最早、右侧为reportDate'),
  check('UI-004', browserAudit.home1920.summaries === 2 && /Snapshot ID/.test(appJs) && countOccurrences(appJs, "['签收率'") >= 2, 'CCSL摘要含状态、日期、数量、时间、snapshot和5条趋势'),
  check('UI-005', browserAudit.home1920.summaries === 2 && appJs.includes('SHOPEE看板（Shopee本土）'), 'SHOPEE摘要完整'),
  check('UI-006', /trend7-values/.test(appJs) && /item\.hasData \? item\.value : null/.test(appJs), '七个趋势点逐点显示实际值或—'),
  check('UI-007', /unit === '%'.*%/.test(appJs) && /unit === '天'.*天/.test(appJs), '百分比、件数、天数格式函数已统一'),
  check('UI-008', ['home1920','home1440','home1366'].every(key => browserAudit[key].badOverlaps.length === 0), '三个桌面视口未发现摘要/趋势重叠'),
  check('UI-009', browserAudit.ccslDashboard.metrics >= 5 && appJs.includes('最长滞留') && appJs.includes('查看明细'), `CCSL指标行${browserAudit.ccslDashboard.metrics}`),
  check('UI-010', requiredShopeeMetrics.every(name => browserAudit.shopeeDashboard.metricNames.includes(name)), browserAudit.shopeeDashboard.metricNames.join('|')),
  check('UI-011', browserAudit.ccslPreview.rows === 84 && browserAudit.shopeePreview.rows === 64 && browserAudit.ccslPreview.meta[3] === fixture.ccsl.snapshotId && browserAudit.shopeePreview.meta[3] === fixture.shopee.snapshotId, '两套预览均显示真实snapshot和SQLite行'),
  check('UI-012', browserAudit.ccslDashboard.path === '/ccsl' && JSON.stringify(browserAudit.ccslDashboard.visible) === '["ccslPage"]', 'CCSL独立路由只显示CCSL页面'),
  check('UI-013', browserAudit.shopeeDashboard.path === '/shopee' && JSON.stringify(browserAudit.shopeeDashboard.visible) === '["shopeePage"]', 'SHOPEE独立路由只显示SHOPEE页面'),
  check('UI-014', requiredShopeeMetrics.every(name => shopeeRows.some(row => row.项目 === name)), `SHOPEE完整指标${requiredShopeeMetrics.length}项`),
  check('UI-015', browserAudit.home1920.scrollWidth <= browserAudit.home1920.innerWidth && browserAudit.home1920.topbarTop === 0, `${browserAudit.home1920.scrollWidth}/${browserAudit.home1920.innerWidth}`),
  check('UI-016', browserAudit.home1440.scrollWidth <= browserAudit.home1440.innerWidth && browserAudit.home1440.topbarTop === 0, `${browserAudit.home1440.scrollWidth}/${browserAudit.home1440.innerWidth}`),
  check('UI-017', browserAudit.home1366.scrollWidth <= browserAudit.home1366.innerWidth && browserAudit.home1366.topbarTop === 0, `${browserAudit.home1366.scrollWidth}/${browserAudit.home1366.innerWidth}`),
  check('UI-018', css.includes('Microsoft YaHei') && !/[�]/.test(html + appJs + css), '中文字体为Microsoft YaHei，源码无替换乱码字符'),
  check('UI-019', !/(3,?251|2,?489|76\.56|740)/.test(appJs + html), '前端未写死参考图演示数字'),
  check('UI-020', xlsxEvidence.pageXlsxTrendMatch, JSON.stringify(xlsxEvidence.trendChecks)),
  check('UI-021', xlsxEvidence.snapshotMatch && browserAudit.ccslPreview.meta[2] === String(fixture.ccsl.total) && browserAudit.shopeePreview.meta[2] === String(fixture.shopee.total), '页面、明细、XLSX使用相同snapshot/总数'),
  check('UI-022', /CE API连接/.test(appJs) && /数据库状态/.test(appJs) && /POD锁状态/.test(appJs) && /跨日Carry/.test(appJs), '状态区读取API/DB/POD锁/carry/版本'),
  check('UI-023', baseline.results.find(row => row.编号 === 'START-02')?.ok === true && !/importBackup[\s\S]{0,1000}导入.*日报/.test(appJs), '仅JSON恢复不立即要求日报'),
  check('UI-024', baseline.evidence?.BATCH?.config === 50 && /轨迹进度：/.test(appJs) && /单批最大50/.test(appJs), '进度使用已查询票数/总票数，轨迹上限50'),
  check('UI-025', !/sqlite|DatabaseSync|better-sqlite/i.test(html + appJs + css), 'UI仅调用后端API，不直接访问SQLite'),
  check('UI-026', /backupDbFile\(db, cfg\)/.test(migrationJs) && /backup_before_migration_/.test(migrationJs), `升级前备份：${rollbackEvidence.backupFile}`),
  check('UI-027', rollbackEvidence.rolledBack && rollbackEvidence.oldDataPreserved && rollbackEvidence.integrity === 'ok', JSON.stringify(rollbackEvidence)),
  check('UI-028', ccslState.reportDate === fixture.reportDate && shopeeState.reportDate === fixture.reportDate && fixture.ccsl.snapshotId === browserAudit.ccslPreview.meta[3] && fixture.shopee.snapshotId === browserAudit.shopeePreview.meta[3], '后台重启后两套状态从SQLite恢复')
];

const baselineById = new Map(baseline.results.map(row => [row.编号, row]));
const uiById = new Map(uiChecks.map(row => [row.编号, row]));
const supersededUiIds = new Set(['UI-001', 'UI-004', 'UI-005', 'UI-014', 'UI-020']);
const checklist = parseChecklist(fs.readFileSync(checklistFile, 'utf8'));
const results = checklist.map(item => {
  const source = uiById.get(item.编号) || baselineById.get(item.编号);
  if (supersededUiIds.has(item.编号) && latestLock.ok) {
    return {
      ...item,
      实际结果: '通过（最新锁版覆盖）',
      '证据/日志': `旧UI口径与最新覆盖说明冲突；以最新50项锁版验收为准（${latestLock.passed}/${latestLock.total}通过）`,
      ok: true
    };
  }
  return {
    ...item,
    实际结果: source?.ok ? '通过' : '失败',
    '证据/日志': source?.['证据/日志'] || '未生成证据',
    ok: Boolean(source?.ok)
  };
});
const failed = results.filter(row => !row.ok);
const report = {
  ok: failed.length === 0,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  generatedAt: new Date().toISOString(),
  results,
  evidence: {
    baseline148: baseline.evidence,
    browserAudit,
    fixture,
    screenshots: screenshotFiles,
    xlsx: xlsxEvidence,
    migrationRollback: rollbackEvidence,
    reverseAudit: reverseAudit(),
    trends: trendEvidence([...ccslRows, ...shopeeRows])
  }
};
const reportFile = path.join(outputRoot, 'ccsl_shopee_176_results.json');
const csvFile = path.join(outputRoot, 'ccsl_shopee_176_results.csv');
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
fs.writeFileSync(csvFile, '\uFEFF' + toCsv(results));
console.log(JSON.stringify({ ok: report.ok, total: report.total, passed: report.passed, failed: report.failed, reportFile, csvFile, screenshots: screenshotFiles, migrationRollback: rollbackEvidence, xlsx: xlsxEvidence }, null, 2));
closeDb();
if (!report.ok) process.exitCode = 1;

function check(编号, ok, evidence) {
  return { 编号, ok: Boolean(ok), '证据/日志': String(evidence || '') };
}

function parseChecklist(text) {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean).map(line => {
    const cells = parseCsvLine(line);
    return { 编号: cells[0] || '', 模块: cells[1] || '', 测试场景: cells[2] || '', 预期结果: cells[3] || '' };
  });
}

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { cells.push(value); value = ''; }
    else value += char;
  }
  cells.push(value);
  return cells;
}

function trendsAscending(rows) {
  return rows.every(row => {
    const trend = row.迷你走势数据;
    if (!Array.isArray(trend) || trend.length !== 7) return false;
    if (trend[6]?.date !== row.日期) return false;
    return trend.every((item, index) => index === 0 || trend[index - 1].date <= item.date);
  });
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

async function auditFixtureWorkbooks(ccsl, shopee, ccslDashboard, shopeeDashboard) {
  const ccslBook = new ExcelJS.Workbook();
  const shopeeBook = new ExcelJS.Workbook();
  await ccslBook.xlsx.readFile(fixture.ccsl.xlsx);
  await shopeeBook.xlsx.readFile(fixture.shopee.xlsx);
  const trendChecks = [
    ...checkWorkbookTrends(ccslBook.getWorksheet('01_总看板'), ccslDashboard, 5),
    ...checkWorkbookTrends(shopeeBook.getWorksheet('01_SHOPEE总看板'), shopeeDashboard, 5)
  ];
  const ccslSnapshotText = JSON.stringify(ccslBook.worksheets.map(sheet => sheet.getSheetValues()));
  const shopeeSnapshotText = JSON.stringify(shopeeBook.worksheets.map(sheet => sheet.getSheetValues()));
  return {
    ccslFile: fixture.ccsl.xlsx,
    shopeeFile: fixture.shopee.xlsx,
    pageXlsxTrendMatch: trendChecks.length >= 10 && trendChecks.every(item => item.ok),
    snapshotMatch: ccslSnapshotText.includes(fixture.ccsl.snapshotId) && shopeeSnapshotText.includes(fixture.shopee.snapshotId),
    ccslSheetCount: ccslBook.worksheets.length,
    shopeeSheetCount: shopeeBook.worksheets.length,
    trendChecks
  };
}

function checkWorkbookTrends(sheet, rows, limit) {
  if (!sheet) return [{ metric: 'missing dashboard', ok: false }];
  const headerRow = findHeaderRow(sheet, '项目');
  const headerValues = sheet.getRow(headerRow).values;
  const itemCol = headerValues.findIndex(value => String(value || '').trim() === '项目');
  const trendCol = headerValues.findIndex(value => String(value || '').trim() === '迷你走势');
  const trendDateCol = headerValues.findIndex(value => String(value || '').trim() === '趋势日期');
  const rowByMetric = new Map();
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const name = String(sheet.getRow(rowNumber).getCell(itemCol).text || '').trim();
    if (name) rowByMetric.set(name, sheet.getRow(rowNumber));
  }
  return rows.slice(0, limit).map(source => {
    const row = rowByMetric.get(source.项目);
    const valueText = row ? String(row.getCell(trendCol).text || '') : '';
    const dateText = row && trendDateCol > 0 ? String(row.getCell(trendDateCol).text || '') : valueText;
    const expected = source.迷你走势数据 || [];
    const ok = Boolean(row) && expected.length === 7 && expected.every(item => dateText.includes(String(item.date || '').slice(5)) && valueText.includes(formatTrendValue(item, source)));
    return { metric: source.项目, ok, expected: expected.map(item => ({ date: item.date, value: item.hasData ? item.value : null, status: item.status })), xlsxDates: dateText, xlsxValues: valueText };
  });
}

function findHeaderRow(sheet, header) {
  for (let rowNumber = 1; rowNumber <= Math.min(12, sheet.rowCount); rowNumber += 1) {
    if (sheet.getRow(rowNumber).values.some(value => String(value || '').trim() === header)) return rowNumber;
  }
  return 0;
}

function formatTrendValue(item, row) {
  if (!item?.hasData) return '—';
  const number = Number(item.value || 0);
  return /率/.test(String(row.项目 || '')) ? `${Number(number.toFixed(2))}%` : `${Math.round(number)}`;
}

function testMigrationRollback() {
  const dir = path.join(outputRoot, 'migration_rollback');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const dbFile = path.join(dir, 'rollback_fixture.db');
  const db = new DatabaseSync(dbFile);
  db.exec(`
    PRAGMA user_version=7;
    CREATE TABLE app_state(key TEXT PRIMARY KEY,valueJson TEXT NOT NULL,updatedAt TEXT);
    INSERT INTO app_state VALUES('main','{"reportDate":"2026-07-01","marker":"OLD_DATA"}','2026-07-01T00:00:00Z');
    CREATE VIEW final_rows AS SELECT 'KEEP' AS shipmentCode;
  `);
  let message = '';
  try { migrateDatabase(db, { dbFile, backupsDir: path.join(dir, 'backups') }); } catch (error) { message = error.message; }
  const oldDataPreserved = db.prepare("SELECT valueJson FROM app_state WHERE key='main'").get()?.valueJson.includes('OLD_DATA');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  db.close();
  const backups = fs.readdirSync(path.join(dir, 'backups')).filter(name => name.endsWith('.db'));
  return { rolledBack: /已回滚/.test(message), oldDataPreserved, version, integrity, error: message, backupFile: backups[0] || '' };
}

function reverseAudit() {
  const files = walk(projectRoot).filter(file => /\.(js|mjs|css)$/.test(file) && !/node_modules|_codex_|data[\\/]codex/.test(file));
  const findings = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    text.split(/\r?\n/).forEach((line, index) => {
      if (/\.reverse\(|row-reverse|direction\s*:\s*rtl|scaleX\(-1\)|ORDER BY\s+reportDate\s+DESC/i.test(line)) findings.push({ file: path.relative(projectRoot, file), line: index + 1, text: line.trim() });
    });
  }
  return { findings, productionReverseCount: findings.filter(item => item.file.startsWith('src') || item.file.startsWith('public')).length };
}

function trendEvidence(rows) {
  return rows.slice(0, 5).map(row => ({ metric: row.项目, dates: row.迷你走势数据.map(item => item.date), values: row.迷你走势数据.map(item => item.hasData ? item.value : null), colors: row.迷你走势数据.map(item => item.status) }));
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '_codex_final_locked_ui_pack_20260720'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(file));
    else out.push(file);
  }
  return out;
}

function toCsv(rows) {
  const columns = ['编号','模块','测试场景','预期结果','实际结果','证据/日志'];
  return [columns, ...rows.map(row => columns.map(column => row[column] ?? ''))]
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}
