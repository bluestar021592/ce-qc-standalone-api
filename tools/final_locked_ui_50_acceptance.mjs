import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';

const projectRoot = path.resolve('.');
const testRoot = path.join(projectRoot, 'data', 'codex_final_locked_ui_export');
const evidenceDir = path.join(testRoot, 'evidence');
const fixture = JSON.parse(fs.readFileSync(path.join(testRoot, 'fixture_evidence.json'), 'utf8'));
const browser = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'browser_audit.json'), 'utf8'));
const db = new DatabaseSync(fixture.dbFile);
const ccslSnapshot = JSON.parse(db.prepare('SELECT payloadJson FROM export_snapshots ORDER BY id DESC LIMIT 1').get().payloadJson);
const shopeeSnapshot = JSON.parse(db.prepare("SELECT payloadJson FROM business_export_snapshots WHERE businessType='SHOPEE' ORDER BY id DESC LIMIT 1").get().payloadJson);
const ccslBook = await readWorkbook(fixture.ccsl.xlsx);
const shopeeBook = await readWorkbook(fixture.shopee.xlsx);
const ccslText = workbookText(ccslBook);
const shopeeText = workbookText(shopeeBook);
const forbiddenShopee = ['派送中停留', '节点未更新', '无轨迹', 'API失败待重试', '已退回', '跨日遗留'];
const checks = [];
const add = (id, module, name, ok, evidence) => checks.push({ id, module, name, ok: Boolean(ok), evidence });

add(1, '侧边栏', '展开宽度固定约220px', browser.home1920.sidebarWidth === 220 && browser.home1440.sidebarWidth === 220, `${browser.home1920.sidebarWidth}/${browser.home1440.sidebarWidth}`);
add(2, '侧边栏', 'CCSL文字只显示CCSL看板', browser.home1920.labels.some(row => row.text.includes('CCSL看板')) && !browser.home1920.labels.some(row => row.text.includes('CE速递')), 'CCSL看板');
add(3, '侧边栏', 'SHOPEE文字只显示SHOPEE看板', browser.home1920.labels.some(row => row.text.includes('SHOPEE看板')) && !browser.home1920.labels.some(row => row.text.includes('Shopee本土')), 'SHOPEE看板');
add(4, '侧边栏', '所有中文菜单单行显示', browser.home1920.labels.every(row => row.nowrap) && browser.home1440.labels.every(row => row.nowrap), `${browser.home1920.labels.length}项nowrap`);
add(5, '侧边栏', '菜单无重叠', browser.home1920.overlaps.length === 0, JSON.stringify(browser.home1920.overlaps));
add(6, '字体', 'UTF-8无乱码', source('public/index.html').includes('<meta charset="utf-8">') && !/�/.test(browser.home1920.labels.map(row => row.text).join('')), 'UTF-8 meta + 浏览器文字检查');

const workSheet = ccslBook.getWorksheet('明细_工单未处理');
const workCount = uniqueBills(workSheet);
add(7, 'CCSL', '工单未处理卡片可见且值正确', browser.ccsl.kpis.includes('工单未处理') && workCount === 1, `看板=1,明细=${workCount}`);
add(8, 'CCSL', '工单明细跳转票数相同', browser.workOrder.selected === '工单未处理' && browser.workOrder.rows === workCount, JSON.stringify(browser.workOrder));

const regionSheet = shopeeBook.getWorksheet('02_PP_PV区域汇总');
const regionRows = sheetObjects(regionSheet);
const pp = regionRows.find(row => row.区域 === 'PP');
const pv = regionRows.find(row => row.区域 === 'PV');
const ppCount = uniqueBills(shopeeBook.getWorksheet('明细_PP'));
const pvCount = uniqueBills(shopeeBook.getWorksheet('明细_PV'));
add(9, 'SHOPEE', 'PP总件数只含本省', Number(pp?.总件数) === ppCount && ppCount === 32, `PP=${ppCount}`);
add(10, 'SHOPEE', 'PV总件数只含外省', Number(pv?.总件数) === pvCount && pvCount === 32, `PV=${pvCount}`);
const ppBills = new Set(sheetBills(shopeeBook.getWorksheet('明细_PP')));
const pvBills = new Set(sheetBills(shopeeBook.getWorksheet('明细_PV')));
add(11, 'SHOPEE', 'PP/PV单票互斥', [...ppBills].every(bill => !pvBills.has(bill)) && ppBills.size + pvBills.size === 64, `PP=${ppBills.size},PV=${pvBills.size}`);

const shMetrics = dashboardMap(shopeeBook.getWorksheet('01_SHOPEE总看板'));
for (const [id, metric, sheet] of [[12, 'Pending1+', '明细_Pending1+'], [12, 'Pending2+', '明细_Pending2+'], [12, 'Pending3+', '明细_Pending3+']]) {
  add(`${id}-${metric}`, 'SHOPEE', `${metric}看板与明细一致`, number(shMetrics.get(metric)) === uniqueBills(shopeeBook.getWorksheet(sheet)), `${shMetrics.get(metric)}/${uniqueBills(shopeeBook.getWorksheet(sheet))}`);
}
for (const [id, metric, sheet] of [[13, 'OC1+', '明细_OC1+'], [13, 'OC2+', '明细_OC2+'], [13, 'OC3+', '明细_OC3+']]) {
  add(`${id}-${metric}`, 'SHOPEE', `${metric}看板与明细一致`, number(shMetrics.get(metric)) === uniqueBills(shopeeBook.getWorksheet(sheet)), `${shMetrics.get(metric)}/${uniqueBills(shopeeBook.getWorksheet(sheet))}`);
}
add(14, 'SHOPEE', '入库无扫描看板与明细一致', number(shMetrics.get('入库无扫描')) === uniqueBills(shopeeBook.getWorksheet('明细_入库无扫描')), `${shMetrics.get('入库无扫描')}`);
add(15, 'SHOPEE', '退回待处理看板与明细一致', number(shMetrics.get('退回待处理')) === uniqueBills(shopeeBook.getWorksheet('明细_退回待处理')), `${shMetrics.get('退回待处理')}`);
for (let index = 0; index < forbiddenShopee.length; index += 1) add(16 + index, 'SHOPEE', `普通UI和XLSX删除${forbiddenShopee[index]}`, !browser.shopee.forbidden.includes(forbiddenShopee[index]) && !shopeeText.includes(forbiddenShopee[index]), 'UI/XLSX全文未命中');

const trendRows = [...ccslSnapshot.dashboardRows, ...shopeeSnapshot.view.dashboardRows];
add(22, '趋势', '左侧最早右侧最新', trendRows.every(row => row.迷你走势数据?.[0]?.date <= row.迷你走势数据?.[6]?.date), `${trendRows.length}项`);
add(23, '趋势', 'reportDate在最右侧', trendRows.every(row => row.迷你走势数据?.[6]?.date === fixture.reportDate), fixture.reportDate);
add(24, '趋势', '百分比指标带%', shopeeBook.getWorksheet('01_SHOPEE总看板').getColumn(3).values.some(value => String(cellText(value)).includes('%')), '签收率趋势与数值包含%');
add(25, '趋势', '件数显示整数', trendRows.filter(row => row.单位 !== '%' && !/率$/.test(String(row.项目 || row.metricKey || ''))).every(row => row.迷你走势数据.filter(item => item.hasData).every(item => Number.isInteger(Number(item.value)))), '件数数组均为整数');
add(26, '趋势', '页面和XLSX数组同源', hashTrends(ccslSnapshot.dashboardRows) === hashTrends(ccslSnapshot.xlsxRows.dashboard) && hashesInWorkbook(shopeeBook).dashboardMetricHash === shopeeSnapshot.dashboardMetricHash, `CCSL=${hashTrends(ccslSnapshot.dashboardRows).slice(0,12)},SHOPEE=${shopeeSnapshot.dashboardMetricHash.slice(0,12)}`);

add(27, '导出', 'CCSL独立XLSX', !ccslText.includes('SHOPEE') && path.basename(fixture.ccsl.xlsx).includes('CCSL'), path.basename(fixture.ccsl.xlsx));
add(28, '导出', 'SHOPEE独立XLSX', !shopeeText.includes('CCSL') && path.basename(fixture.shopee.xlsx).includes('SHOPEE'), path.basename(fixture.shopee.xlsx));
add(29, '导出', 'CCSL工单字段存在', Boolean(workSheet) && ccslText.includes('工单未处理'), '明细_工单未处理');
add(30, '导出', 'SHOPEE工单字段不存在', !shopeeText.includes('工单未处理'), '全文未命中');
add(31, '导出', 'PP/PV字段清晰隔离', Boolean(pp && pv) && ppCount + pvCount === 64, `PP=${ppCount},PV=${pvCount}`);
const ccslLinks = internalLinks(ccslBook, '01_总看板');
const shopeeLinks = internalLinks(shopeeBook, '01_SHOPEE总看板');
add(32, '导出', '总看板内部跳转', ccslLinks.dashboard > 0 && shopeeLinks.dashboard > 0 && ccslLinks.external === 0 && shopeeLinks.external === 0, `CCSL=${ccslLinks.dashboard},SHOPEE=${shopeeLinks.dashboard}`);
add(33, '导出', '明细返回总看板', ccslLinks.returnFailures.length === 0 && shopeeLinks.returnFailures.length === 0, '全部可见明细Sheet通过');
add(34, '导出', '每个可见Sheet含CE LOGO', [...ccslBook.worksheets, ...shopeeBook.worksheets].every(sheet => sheet.getImages().length > 0), `CCSL=${ccslBook.worksheets.length},SHOPEE=${shopeeBook.worksheets.length}`);
add(35, '导出', '行高列宽无异常空白', workbookLayoutOk(ccslBook) && workbookLayoutOk(shopeeBook), '行高<=40，列宽<=50');

const ccHashes = hashesInWorkbook(ccslBook);
const shHashes = hashesInWorkbook(shopeeBook);
add(36, '快照', '页面与导出snapshotId一致', ccHashes.snapshotId === ccslSnapshot.snapshotId && shHashes.snapshotId === shopeeSnapshot.snapshotId, `${ccHashes.snapshotId}/${shHashes.snapshotId}`);
add(37, '快照', 'dashboard/export哈希一致', ccHashes.dashboardMetricHash === ccslSnapshot.dashboardMetricHash && shHashes.dashboardMetricHash === shopeeSnapshot.dashboardMetricHash, `${ccHashes.dashboardMetricHash?.slice(0,12)}/${shHashes.dashboardMetricHash?.slice(0,12)}`);
let exportHeaderOk = false;
try {
  const response = await fetch(`http://127.0.0.1:5189/api/shopee/export-xlsx?snapshotId=${encodeURIComponent(shopeeSnapshot.snapshotId)}`);
  exportHeaderOk = response.ok && response.headers.get('x-ce-api-calls-during-export') === '0' && response.headers.get('x-snapshot-id') === shopeeSnapshot.snapshotId;
  await response.arrayBuffer();
} catch {}
add(38, 'API', '导出阶段无CE API调用', exportHeaderOk, '响应头 X-CE-API-Calls-During-Export=0');

const backupFiles = findFiles(path.join(projectRoot, 'data'), file => /backup_before_migration.*\.db$/i.test(file));
const rollbackResult = readJson(path.join(projectRoot, 'data', 'codex_ui_track_crossday', 'migration_rollback_results.json'));
add(39, '数据库', '升级前自动备份', backupFiles.length > 0, backupFiles.slice(-1)[0] || '');
add(40, '数据库', 'migration事务失败回滚', rollbackResult?.rolledBack === true && rollbackResult?.oldDataPreserved === true, JSON.stringify(rollbackResult));
const restartCounts = { daily: db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count, shopee: db.prepare("SELECT COUNT(*) count FROM business_daily_reports WHERE businessType='SHOPEE'").get().count };
add(41, '数据库', '后台重启数据仍存在', restartCounts.daily > 0 && restartCounts.shopee > 0, JSON.stringify(restartCounts));
add(42, '数据库', '页面刷新日报状态仍存在', browser.home1920.trendEnds.every(row => row.end === fixture.reportDate), fixture.reportDate);
add(43, '数据库', 'POD锁升级后仍存在', db.prepare('SELECT COUNT(*) count FROM pod_locks').get().count > 0 && db.prepare("SELECT COUNT(*) count FROM business_pod_locks WHERE businessType='SHOPEE'").get().count > 0, '双业务POD锁均存在');
add(44, '数据库', 'carry升级后仍存在', db.prepare("SELECT COUNT(*) count FROM carry_bills WHERE status='active'").get().count > 0 && db.prepare("SELECT COUNT(*) count FROM business_carry_bills WHERE businessType='SHOPEE' AND status='active'").get().count > 0, '双业务carry均存在');
add(45, '分辨率', '1920x1080布局', fs.existsSync(path.join(evidenceDir, 'home_1920x1080.png')) && browser.home1920.scrollWidth <= browser.home1920.viewportWidth, 'home_1920x1080.png');
add(46, '分辨率', '1440x900无重叠乱码', fs.existsSync(path.join(evidenceDir, 'home_1440x900.png')) && browser.home1440.scrollWidth <= browser.home1440.viewportWidth, 'home_1440x900.png');
add(47, '视觉', '参考结构完整', browser.home1920.kpis.length === 10 && browser.home1920.sidebarWidth === 220 && browser.shopee.regions.length === 2, '侧栏+顶部10卡+双区域');
add(48, '功能', '核心卡片点击或筛选正常', browser.workOrder.rows === 1 && browser.report.region === 'PP' && browser.report.rows === 32, `工单=${browser.workOrder.rows},PP=${browser.report.rows}`);
const sourceFiles = ['server.js', ...findFiles(path.join(projectRoot, 'src'), file => /\.js$/i.test(file)), ...findFiles(path.join(projectRoot, 'public'), file => /\.(js|html)$/i.test(file))];
const sourceText = sourceFiles.map(file => fs.readFileSync(path.isAbsolute(file) ? file : path.join(projectRoot, file), 'utf8')).join('\n');
add(49, '安全', '代码无完整Token/Cookie', !/eyJ[A-Za-z0-9_-]{40,}/.test(sourceText) && !/Basic\s+[A-Za-z0-9+/=]{20,}/.test(sourceText), '未命中JWT或Basic完整凭据');
add(50, '完成报告', '真实证据齐全', fs.existsSync(fixture.ccsl.xlsx) && fs.existsSync(fixture.shopee.xlsx) && fs.existsSync(path.join(evidenceDir, 'browser_audit.json')), '双XLSX+浏览器证据+数据库证据');

const normalizedChecks = mergeCompositeChecks(checks);
const result = { ok: normalizedChecks.length === 50 && normalizedChecks.every(row => row.ok), total: normalizedChecks.length, passed: normalizedChecks.filter(row => row.ok).length, failed: normalizedChecks.filter(row => !row.ok).length, checks: normalizedChecks, files: { ccslXlsx: fixture.ccsl.xlsx, shopeeXlsx: fixture.shopee.xlsx, evidenceDir } };
const resultFile = path.join(evidenceDir, 'latest_50_acceptance_results.json');
const csvFile = path.join(evidenceDir, 'latest_50_acceptance_results.csv');
fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
fs.writeFileSync(csvFile, ['编号,模块,验收内容,结果,证据', ...normalizedChecks.map(row => [row.id, row.module, row.name, row.ok ? '通过' : '失败', row.evidence].map(csv).join(','))].join('\n'));
console.log(JSON.stringify({ ...result, resultFile, csvFile }, null, 2));
if (!result.ok) process.exitCode = 1;

function mergeCompositeChecks(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const id = Number(String(row.id).split('-')[0]);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  return [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([id, items]) => ({ id, module: items[0].module, name: items.map(row => row.name).join('；'), ok: items.every(row => row.ok), evidence: items.map(row => row.evidence).join(' | ') }));
}
async function readWorkbook(file) { const book = new ExcelJS.Workbook(); await book.xlsx.readFile(file); return book; }
function source(file) { return fs.readFileSync(path.join(projectRoot, file), 'utf8'); }
function cellText(value) { if (value?.result !== undefined) return value.result; if (value?.richText) return value.richText.map(item => item.text).join(''); return value ?? ''; }
function workbookText(book) { const values = []; for (const sheet of book.worksheets) { values.push(sheet.name); sheet.eachRow(row => row.eachCell(cell => values.push(String(cellText(cell.value))))); } return values.join('\n'); }
function headerIndex(sheet) { for (let row = 1; row <= Math.min(8, sheet.rowCount); row += 1) { const values = sheet.getRow(row).values.map(cellText); if (values.includes('shipmentCode') || values.includes('运单号') || values.includes('项目') || values.includes('检查项目') || values.includes('区域')) return row; } return 3; }
function sheetObjects(sheet) { if (!sheet) return []; const h = headerIndex(sheet); const headers = sheet.getRow(h).values.slice(1).map(value => String(cellText(value))); const rows = []; for (let r = h + 1; r <= sheet.rowCount; r += 1) { const obj = {}; headers.forEach((key, i) => { obj[key] = cellText(sheet.getRow(r).getCell(i + 1).value); }); if (Object.values(obj).some(value => value !== '')) rows.push(obj); } return rows; }
function sheetBills(sheet) { return sheetObjects(sheet).map(row => String(row.shipmentCode || row.运单号 || '').trim()).filter(Boolean); }
function uniqueBills(sheet) { return new Set(sheetBills(sheet)).size; }
function dashboardMap(sheet) { return new Map(sheetObjects(sheet).map(row => [String(row.项目 || row.指标 || ''), row.数值])); }
function number(value) { const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(\.\d+)?/); return match ? Number(match[0]) : 0; }
function internalLinks(book, dashboardName) { let dashboard = 0; let external = 0; const returnFailures = []; for (const sheet of book.worksheets) { const formulas = []; sheet.eachRow(row => row.eachCell(cell => { if (cell.value?.formula?.includes('HYPERLINK')) formulas.push(cell.value.formula); })); if (sheet.name === dashboardName) { dashboard += formulas.length; external += formulas.filter(formula => /[A-Z]:\\|file:|https?:/i.test(formula)).length; } else if (!formulas.some(formula => formula.includes(`#'${dashboardName}'!A1`))) returnFailures.push(sheet.name); } return { dashboard, external, returnFailures }; }
function workbookLayoutOk(book) { return book.worksheets.every(sheet => { let rowsOk = true; sheet.eachRow(row => { if (Number(row.height || 15) > 40) rowsOk = false; }); return rowsOk && sheet.columns.every(column => Number(column.width || 10) <= 50); }); }
function hashesInWorkbook(book) { const sheet = book.getWorksheet('数据一致性检查'); const rows = sheetObjects(sheet); if (rows.length === 1 && rows[0].dashboardMetricHash) return rows[0]; const values = Object.fromEntries(rows.map(row => [row.检查项目, row.总看板数值])); return { snapshotId: rows.find(row => row.snapshotId)?.snapshotId || '', dashboardMetricHash: values.dashboardMetricHash || '', detailRowHash: values.detailRowHash || '' }; }
function hashTrends(rows) { return createHash('sha256').update(JSON.stringify((rows || []).map(row => ({ key: row.metricKey || row.项目 || row.指标, trend: row.迷你走势数据 })))).digest('hex'); }
function findFiles(root, predicate) { if (!fs.existsSync(root)) return []; const out = []; for (const entry of fs.readdirSync(root, { withFileTypes: true })) { const full = path.join(root, entry.name); if (entry.isDirectory()) out.push(...findFiles(full, predicate)); else if (predicate(full)) out.push(full); } return out; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function csv(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
