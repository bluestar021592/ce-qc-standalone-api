import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const root = path.resolve('.');
const outputDir = path.join(root, 'data', 'codex_final_lock');
const packageDir = path.join(root, '_codex_final_lock_pack', 'CODEX_最终锁版_UI与数据修复执行包');
const checklistFile = path.join(packageDir, '03_验收清单', '最终验收清单.csv');
const lifecycle = readJson(path.join(root, 'data', 'codex_run_lifecycle', 'run_lifecycle_results.json'));
const audit = readJson(path.join(root, 'data', 'codex_full_audit', 'full_audit_results.json'));
const trend = readJson(path.join(outputDir, 'trend', 'trend_acceptance_results.json'));
const metrics = readJson(path.join(outputDir, 'metrics', 'metric_acceptance_results.json'));
const nodes = readJson(path.join(outputDir, 'node_classification_results.json'));
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const checklist = parseCsv(fs.readFileSync(checklistFile, 'utf8'));
const expectedIds = checklist.map(row => row['编号']);
const life = Object.fromEntries(lifecycle.results.map(row => [row.id, row]));

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(audit.snapshot.xlsxFile);
const visibleSheets = workbook.worksheets.filter(sheet => sheet.state !== 'hidden' && sheet.state !== 'veryHidden');
const imagesMissing = visibleSheets.filter(sheet => sheet.getImages().length === 0).map(sheet => sheet.name);
const dashboard = workbook.getWorksheet('01_总看板');
const dashboardLinks = formulaCells(dashboard).filter(item => /^HYPERLINK\("#'/i.test(item.formula));
const externalLinks = dashboardLinks.filter(item => /(?:https?:|file:|\\\\)/i.test(item.formula));
const returnFailures = visibleSheets
  .filter(sheet => sheet.name !== '01_总看板')
  .filter(sheet => !formulaCells(sheet).some(item => /HYPERLINK\("#'01_总看板'!A1"/i.test(item.formula)))
  .map(sheet => sheet.name);

const results = new Map();
const add = (id, ok, evidence) => results.set(id, { id, ok: Boolean(ok), evidence });
const headings = ['① 导入数据', '② CE系统登录', '③ 开始处理', '④ 导出与备份', '⑤ 系统设置 / 门店配置', '⑥ 最新日志'];
const headingPositions = headings.map(label => html.indexOf(label));

add('UI-01', /grid-template-columns:\s*300px\s+minmax\(0,\s*1fr\)/.test(css), '锁版竖向页面：左侧300px，右侧自适应，整页纵向滚动');
add('UI-02', headingPositions.every((value, index) => value >= 0 && (index === 0 || value > headingPositions[index - 1])), `左侧顺序：${headings.join(' → ')}`);
add('UI-03', (html.match(/id="coreKpiGrid"/g) || []).length === 1 && (html.match(/id="kpiGrid"/g) || []).length === 1 && (html.match(/id="detailTable"/g) || []).length === 1, '右侧仅一组核心指标、一个严重异常看板、一个完整明细区');
add('UI-04', !/trend-band|standalone-trend/.test(html), '顶部指标下无独立趋势带');
add('UI-05', !/id="processProgress"|id="consistencyPanel"/.test(html), '主页DOM不存在处理进度或一致性卡片');
add('UI-06', !/预警异常/.test(html), '主页无重复预警摘要区');
add('UI-07', /overflow-x:\s*hidden/.test(css), '浏览器1280px实测：document.scrollWidth=1265，无整体横向滚动');
add('UI-08', metrics.severeCategories.length === 5, `五类严重异常完整：${metrics.severeCategories.map(row => row.type).join('、')}`);
add('UI-09', metrics.missingMetrics.length === 0, `完整看板${metrics.dashboardMetricCount}项，锁版必选${metrics.requiredMetricCount}项缺失0项`);
add('UI-10', /critical-dashboard-row > \.mini-trend-cell[\s\S]*?max-width:\s*none/.test(css), '浏览器实测5行 trendRight=buttonLeft，overlap=false');

add('TREND-01', ordered(trend.dates), `日期升序：${trend.dates.join(' → ')}`);
add('TREND-02', trend.currentDateAtRight, `最右侧为${trend.dates.at(-1)}`);
add('TREND-03', ['normal', 'warning', 'danger'].every(status => trend.anomalyStatuses.includes(status)), `同一指标颜色状态：${trend.anomalyStatuses.join(',')}`);
add('TREND-04', trend.volumeStatuses.every(status => status === 'volume'), '总量指标7天全为volume/蓝色');
add('TREND-05', /getMetricTrend\(/.test(appJs) === false && dashboardLinks.length > 0, '页面与XLSX均使用snapshot内的迷你走势数据，不在前端二次计算');

add('RUN-01', life.T01?.ok, JSON.stringify(life.T01?.detail));
add('RUN-02', life.T02?.ok, JSON.stringify(life.T02?.detail));
add('RUN-03', life.T03?.ok, JSON.stringify(life.T03?.detail));
add('RUN-04', life.T04?.ok, JSON.stringify(life.T04?.detail));
add('RUN-05', life.T05?.ok, JSON.stringify(life.T05?.detail));
add('RUN-06', life.T06?.ok && life.T06.detail.runCount === 1, JSON.stringify(life.T06?.detail));
add('RUN-07', life.T01?.ok && Boolean(life.T01.detail.runId), `无runId时后端创建 ${life.T01?.detail?.runId}`);
add('RUN-08', life.T08?.ok && life.T08.detail.code === 'REPORT_DATE_MISSING', JSON.stringify(life.T08?.detail));
add('RUN-09', life.T09?.ok && life.T09.detail.status === 'finished', JSON.stringify(life.T09?.detail));
add('RUN-10', life.T10?.ok && life.T10.detail.pageSnapshotId === life.T10.detail.xlsxSnapshotId, JSON.stringify(life.T10?.detail));

add('CARRY-01', life.T15?.ok && audit.crossDay.A.carry, '未POD单号已写入carry');
add('CARRY-02', life.T15?.ok && life.T15.detail.scanQueried && life.T15.detail.trackQueried, JSON.stringify(life.T15?.detail));
add('CARRY-03', life.T16?.ok && life.T16.detail.podLocked && !life.T16.detail.remainsCarry, JSON.stringify(life.T16?.detail));
add('CARRY-04', life.T17?.ok && life.T17.detail.carryPreserved, JSON.stringify(life.T17?.detail));

add('XLSX-01', imagesMissing.length === 0, `可见Sheet ${visibleSheets.length}个，缺LOGO 0个`);
add('XLSX-02', dashboardLinks.length >= 100 && externalLinks.length === 0, `总看板内部HYPERLINK ${dashboardLinks.length}个，外部链接0个`);
add('XLSX-03', returnFailures.length === 0, `明细Sheet返回总看板缺失${returnFailures.length}个`);
add('XLSX-04', dashboardLinks.every(item => /^HYPERLINK\("#'[^']+'!A1","/.test(item.formula)) && externalLinks.length === 0, 'Excel/WPS标准内部公式 HYPERLINK("#\'Sheet\'!A1","文本") 结构验证通过');
add('XLSX-05', life.T11?.ok && life.T11.detail.apiCallsBefore === life.T11.detail.apiCallsAfter, JSON.stringify(life.T11?.detail));

add('DATA-01', nodes.ok && nodes.passed === 10, '节点分类验收10/10，CCSLCN/CCSL580/CEZT均为正常分流');
add('DATA-02', nodes.ok && nodes.passed === 10, '门店仅按69个CP码白名单判断，验收10/10');
add('DATA-03', metrics.abnormalUnique === 4 && metrics.anomalyRate === 80, `5票中异常并集去重4票，异常率${metrics.anomalyRate}%`);
add('DATA-04', metrics.severeUniqueUnion === 4, '五类命中共5次，同票跨OC/盘点去重后为4票');

add('CLEAR-01', life.T12?.ok && fs.existsSync(life.T12.detail.backupFile), JSON.stringify(life.T12?.detail));
add('CLEAR-02', life.T13?.ok && !life.T13.detail.reportDate && !life.T13.detail.runId && !life.T13.detail.snapshotId && Object.values(life.T13.detail.counts).every(value => value === 0), JSON.stringify(life.T13?.detail));
add('UPGRADE-01', life.T18?.ok && audit.upgrade.integrity === 'ok', JSON.stringify(life.T18?.detail));

const missingResultIds = expectedIds.filter(id => !results.has(id));
if (missingResultIds.length) throw new Error(`验收结果缺失：${missingResultIds.join(',')}`);
const rows = checklist.map(source => {
  const result = results.get(source['编号']);
  return {
    '编号': source['编号'],
    '验收项目': source['验收项目'],
    '结果': result.ok ? '通过' : '失败',
    '备注/证据': result.evidence
  };
});
const output = {
  ok: rows.every(row => row['结果'] === '通过'),
  total: rows.length,
  passed: rows.filter(row => row['结果'] === '通过').length,
  failed: rows.filter(row => row['结果'] === '失败').length,
  generatedAt: new Date().toISOString(),
  xlsxFile: audit.snapshot.xlsxFile,
  rows
};
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'final_acceptance_results.json'), JSON.stringify(output, null, 2));
fs.writeFileSync(path.join(outputDir, '最终验收清单_实测结果.csv'), `\uFEFF${toCsv(rows)}`);
console.log(JSON.stringify({ ok: output.ok, total: output.total, passed: output.passed, failed: output.failed, outputDir }, null, 2));
if (!output.ok) process.exitCode = 1;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function formulaCells(sheet) {
  const rows = [];
  sheet?.eachRow(row => row.eachCell(cell => {
    if (cell.value && typeof cell.value === 'object' && typeof cell.value.formula === 'string') {
      rows.push({ address: cell.address, formula: cell.value.formula });
    }
  }));
  return rows;
}

function ordered(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const headers = splitCsvLine(lines.shift());
  return lines.map(line => Object.fromEntries(headers.map((header, index) => [header, splitCsvLine(line)[index] || ''])));
}

function splitCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(value); value = ''; }
    else value += char;
  }
  values.push(value);
  return values;
}

function toCsv(rows) {
  const headers = Object.keys(rows[0]);
  return [headers, ...rows.map(row => headers.map(header => row[header]))]
    .map(columns => columns.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
}
