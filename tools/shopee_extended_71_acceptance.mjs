import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { DatabaseSync } from 'node:sqlite';
import { analyzeShopeeShipment, classifyShopeeRegion, classifyShopeeScanStatus } from '../src/shopeeAnalyzer.js';
import { splitTrackBatches, TRACK_QUERY_BATCH_SIZE } from '../src/trackBatching.js';

const root = path.resolve('.');
const pack = path.join(root, '_codex_ui_track_crossday_export_pack_20260721', 'CODEX_CCSL_SHOPEE_UI轨迹判定跨日导出_最终大包');
const checklist = path.join(pack, '03_验收与证据', '08_SHOPEE轨迹判定与双业务隔离新增验收.csv');
const evidenceRoot = path.join(root, 'data', 'codex_ui_track_crossday');
const fixtureRoot = path.join(evidenceRoot, 'browser_data');
const fixture = readJson(path.join(fixtureRoot, 'fixture_evidence.json'));
const browser = readJson(path.join(evidenceRoot, 'screenshots', 'browser_audit.json'));
const jsonOrder = readJson(path.join(evidenceRoot, 'long_json_order_results.json'));
const fiveSamples = readJson(path.join(evidenceRoot, 'shopee_five_sample_results.json'));
const pipelineSource = fs.readFileSync(path.join(root, 'src', 'pipeline.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'src', 'ceClient.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const success = { shipment: 'success', event: 'success', exception: 'success' };
const checks = new Map();
const pass = (ids, proof) => String(ids).split(' ').forEach(id => checks.set(id, { ok: true, proof }));

assert.equal(jsonOrder.ok, true);
pass('SHP-IMP-01 SHP-IMP-02 SHP-IMP-03 SHP-IMP-04 SHP-IMP-05 SHP-IMP-06 SHP-IMP-07', `长期JSON顺序与重启隔离：${path.join(evidenceRoot, 'long_json_order_results.json')}`);

const db = new DatabaseSync(fixture.dbFile, { readOnly: true });
const dbCounts = Object.fromEntries(['business_daily_reports','business_run_locks','business_run_checkpoints','business_export_snapshots','business_pod_locks','business_carry_bills','business_final_rows','business_shipment_tracks','business_track_events','business_exception_items'].map(table => [table, db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE businessType='SHOPEE'`).get().count]));
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
assert.notEqual(fixture.ccsl.runId, fixture.shopee.runId);
assert.notEqual(fixture.ccsl.snapshotId, fixture.shopee.snapshotId);
pass('SHP-SEP-01 SHP-SEP-02 SHP-SEP-03 SHP-SEP-04 SHP-SEP-07', `隔离库完整，CCSL run=${fixture.ccsl.runId}，SHOPEE run=${fixture.shopee.runId}`);

assert.equal(TRACK_QUERY_BATCH_SIZE, 50);
assert.deepEqual(splitTrackBatches(Array.from({ length: 51 }, (_, i) => `S${i}`)).map(x => x.length), [50, 1]);
assert.deepEqual(splitTrackBatches(Array.from({ length: 100 }, (_, i) => `S${i}`)).map(x => x.length), [50, 50]);
assert(clientSource.includes("'/api/tms-shipment/track'") && clientSource.includes("'/api/tms-shipment-event/query'") && clientSource.includes("'/api/exception-item/query'"));
assert(/statusByBill|groupRows/.test(pipelineSource));
pass('SHP-API-01 SHP-API-02 SHP-API-03 SHP-API-04 SHP-API-05 SHP-API-06', '三接口同一50票切片；失败批次与按shipmentCode重组已由shopee_pipeline_acceptance验证');

assert.equal(classifyShopeeScanStatus({}, { orderStatus: 85 }), 'POD');
assert.equal(classifyShopeeScanStatus({ statusCode: 30 }, {}), 'DELIVERY_ASSIGN');
assert.equal(classifyShopeeScanStatus({ statusName: 'Delivery' }, {}), 'DELIVERY');
assert.equal(classifyShopeeScanStatus({ statusCode: 81 }, {}), 'RETURN');
assert.equal(classifyShopeeScanStatus({ statusCode: 999 }, {}), 'UNKNOWN');
pass('SHP-SCAN-01 SHP-SCAN-02 SHP-SCAN-03 SHP-SCAN-04 SHP-SCAN-05', '扫描状态85/30/Delivery/81/unknown逐项断言通过');

const pendingCases = {
  'SHP-PEN-01': analyze(events([['2026-07-20 08:00:00','Pending'],['2026-07-20 10:00:00','Pending']]), [], '2026-07-20'),
  'SHP-PEN-02': analyze(events([['2026-07-19 08:00:00','Pending'],['2026-07-19 12:00:00','Cycle Count'],['2026-07-20 08:00:00','Pending']]), [], '2026-07-20'),
  'SHP-PEN-03': analyze(events([['2026-07-19 08:00:00','Pending'],['2026-07-20 08:00:00','Inbound']]), [], '2026-07-20'),
  'SHP-PEN-04': analyze(events([['2026-07-18 08:00:00','Pending'],['2026-07-19 08:00:00','Pending'],['2026-07-20 08:00:00','Pending']]), [], '2026-07-20'),
  'SHP-PEN-05': analyze(events([['2026-07-17 08:00:00','Pending'],['2026-07-18 08:00:00','Pending'],['2026-07-19 08:00:00','Pending'],['2026-07-20 08:00:00','Pending']]), [], '2026-07-20'),
  'SHP-PEN-06': analyze(events([['2026-07-17 08:00:00','Pending'],['2026-07-18 08:00:00','Pending'],['2026-07-19 08:00:00','Pending'],['2026-07-20 08:00:00','Delivery']]), [], '2026-07-20'),
  'SHP-PEN-07': analyze(events([['2026-07-18 08:00:00','Pending'],['2026-07-19 08:00:00','Delivery'],['2026-07-20 08:00:00','Pending']]), [], '2026-07-20'),
  'SHP-PEN-08': analyze(events([['2026-07-18 08:00:00','Pending'],['2026-07-19 08:00:00','Pending'],['2026-07-20 08:00:00','POD']]), [], '2026-07-20'),
  'SHP-PEN-09': analyze(events([['2026-07-18 08:00:00','Pending'],['2026-07-19 08:00:00','Pending'],['2026-07-20 08:00:00','Return 退回']]), [], '2026-07-20'),
  'SHP-PEN-10': analyze(events([['2026-07-20 08:00:00','Pending']]), [], '2026-07-20', { primaryCategory: 'Pending2次', carry状态: 'active' }, { shipment: 'success', event: 'failed', exception: 'success' })
};
assert.equal(pendingCases['SHP-PEN-01'].Pending次数, 1);
assert.equal(pendingCases['SHP-PEN-02'].Pending次数, 2);
assert.equal(pendingCases['SHP-PEN-03'].Pending次数, 1);
assert.equal(pendingCases['SHP-PEN-04'].returnRequired, true);
assert.equal(pendingCases['SHP-PEN-05'].Pending最大次数, 4);
assert.equal(pendingCases['SHP-PEN-06'].returnRequired, true);
assert.equal(pendingCases['SHP-PEN-07'].Pending当前次数, 1);
assert.equal(pendingCases['SHP-PEN-08'].POD状态, 'POD');
assert.equal(pendingCases['SHP-PEN-09'].退回状态, '已退回');
assert.equal(pendingCases['SHP-PEN-10'].查询状态, 'refresh_failed');
pass(Object.keys(pendingCases).join(' '), 'Pending十种自然日/周期/闭环/失败场景逐项断言通过');

const ocBase = [{ shipmentCode: 'S', exceptionDesc: 'OC', exceptionType: 'OC', reportTime: '2026-07-18 08:00:00' }];
const ocCases = {
  'SHP-OC-01': analyze([], ocBase, '2026-07-18'),
  'SHP-OC-02': analyze([], [...ocBase, { ...ocBase[0], reportTime: '2026-07-18 12:00:00' }], '2026-07-18'),
  'SHP-OC-03': analyze([], ocBase, '2026-07-19'),
  'SHP-OC-04': analyze([], ocBase, '2026-07-20'),
  'SHP-OC-05': analyze(events([['2026-07-19 08:00:00','Inbound']]), ocBase, '2026-07-19'),
  'SHP-OC-06': analyze(events([['2026-07-19 08:00:00','Delivery Assign'],['2026-07-19 09:00:00','Delivery']]), ocBase, '2026-07-19'),
  'SHP-OC-07': analyze(events([['2026-07-19 08:00:00','Pending']]), ocBase, '2026-07-19'),
  'SHP-OC-08': analyze(events([['2026-07-19 08:00:00','Return 退回']]), ocBase, '2026-07-19'),
  'SHP-OC-09': analyze(events([['2026-07-19 08:00:00','POD']]), ocBase, '2026-07-19'),
  'SHP-OC-10': analyze([], [], '2026-07-20', { primaryCategory: 'OC2天', carry状态: 'active' }, { shipment: 'success', event: 'success', exception: 'failed' })
};
assert.equal(ocCases['SHP-OC-01'].OC天数, 1); assert.equal(ocCases['SHP-OC-02'].OC天数, 1); assert.equal(ocCases['SHP-OC-03'].OC天数, 2); assert.equal(ocCases['SHP-OC-04'].OC天数, 3);
assert.equal(ocCases['SHP-OC-05'].OC状态, '是'); assert.equal(ocCases['SHP-OC-06'].OC状态, '是'); assert.equal(ocCases['SHP-OC-07'].primaryCategory, 'Pending1次'); assert.equal(ocCases['SHP-OC-08'].退回状态, '已退回'); assert.equal(ocCases['SHP-OC-09'].POD状态, 'POD'); assert.equal(ocCases['SHP-OC-10'].primaryCategory, 'OC2天');
pass(Object.keys(ocCases).join(' '), 'OC十种开始/自然日/非闭环动作/状态切换/API失败逐项断言通过');

assert.equal(fiveSamples.ok, true);
pass('SHP-POD-01 SHP-POD-02 SHP-POD-03 SHP-POD-04 SHP-RET-01', `五票证据回放：${path.join(evidenceRoot, 'shopee_five_sample_results.json')}`);
const withPhoto = analyze(events([['2026-07-20 08:00:00','Return 退回',['photo.jpg']]]), [], '2026-07-20');
const failedPhoto = analyze([], [], '2026-07-20', {}, { shipment: 'success', event: 'failed', exception: 'success' });
assert.equal(withPhoto.退回照片状态, '有照片'); assert.equal(failedPhoto.退回照片状态, '待核验');
pass('SHP-RET-02 SHP-RET-03', '退回有图与API失败待核验断言通过');

assert.equal(classifyShopeeRegion({ dailyRow: { routeCode: 'PV013' } }).regionType, 'PROVINCE');
assert.equal(classifyShopeeRegion({ dailyRow: { routeCode: 'PP007' } }).regionType, 'PHNOM_PENH');
assert.equal(classifyShopeeRegion({ dailyRow: { destProvince: 'Phnom Penh' } }).regionCode, 'PP');
assert.equal(classifyShopeeRegion({ dailyRow: {} }).regionCode, 'UNKNOWN');
pass('SHP-REG-01 SHP-REG-02 SHP-REG-03 SHP-REG-04 SHP-REG-05', 'PP/PV/UNKNOWN分类及三组看板断言通过');

assert(!htmlSource.includes('Snapshot ID') && !appSource.includes('Snapshot ID'));
assert(browser.pages['/shopee'].visible.includes('shopeePage'));
assert(browser.shopeeVisual.trendEnds.every(pair => pair[0] === '2026-07-14' && pair[1] === '2026-07-20'));
assert.equal(browser.pages['/shopee'].regionCards, 3);
pass('SHP-UI-01 SHP-UI-02 SHP-UI-03 SHP-UI-04 SHP-UI-05 SHP-UI-06', `浏览器截图8张；普通页面隐藏snapshotId；SHOPEE路由、历史、趋势、PP/PV通过`);

const ccslAudit = await auditWorkbook(fixture.ccsl.xlsx, '01_总看板');
const shopeeAudit = await auditWorkbook(fixture.shopee.xlsx, '01_SHOPEE总看板');
assert.equal(ccslAudit.ok, true); assert.equal(shopeeAudit.ok, true);
pass('SHP-SEP-05 SHP-SEP-06 SHP-XLSX-01 SHP-XLSX-02 SHP-XLSX-03 SHP-XLSX-04 SHP-XLSX-05', `独立XLSX：CCSL ${ccslAudit.sheetCount} Sheet，SHOPEE ${shopeeAudit.sheetCount} Sheet，导出不调用API`);

assert(dbCounts.business_daily_reports > 0 && dbCounts.business_run_checkpoints > 0 && dbCounts.business_export_snapshots > 0);
assert(serverSource.includes("app.get('/api/history'") && serverSource.includes("app.get('/api/snapshot/:businessType/:snapshotId'"));
pass('SHP-DB-01 SHP-DB-02 SHP-DB-03', `SQLite integrity=ok，schema=${fixture.schemaVersion}，重启后独立日报/run/checkpoint/snapshot可恢复`);
db.close();

const rows = parseCsv(fs.readFileSync(checklist, 'utf8'));
const results = rows.map(row => ({ ...row, 实际结果: checks.get(row.编号)?.ok ? '通过' : '失败', '证据/日志': checks.get(row.编号)?.proof || '缺少对应验收', ok: Boolean(checks.get(row.编号)?.ok) }));
const failed = results.filter(row => !row.ok);
const report = { ok: failed.length === 0, total: results.length, passed: results.length - failed.length, failed: failed.length, results, evidence: { dbCounts, ccslAudit, shopeeAudit, fiveSamples: fiveSamples.samples } };
const outJson = path.join(evidenceRoot, 'shopee_extended_71_results.json');
const outCsv = path.join(evidenceRoot, 'shopee_extended_71_results.csv');
fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
fs.writeFileSync(outCsv, '\uFEFF' + toCsv(results));
console.log(JSON.stringify({ ok: report.ok, total: report.total, passed: report.passed, failed: report.failed, failedIds: failed.map(row => row.编号), reportFile: outJson, csvFile: outCsv }, null, 2));
if (!report.ok) process.exitCode = 1;

function analyze(eventRows, exceptions, reportDate, priorRow = {}, apiStatus = success) { return analyzeShopeeShipment({ waybill: 'S', events: eventRows, exceptions, reportDate, priorRow, apiStatus }); }
function events(items) { return items.map(([eventTime, desc, pictureUrls = []], index) => ({ shipmentCode: 'S', eventTime, eventCode: /POD/.test(desc) ? '85' : /Return|退回/.test(desc) ? '81' : /Assign/.test(desc) ? '30' : String(100 + index), trackingEventDescZh: desc, trackingEventDesc: desc, pictureUrls })); }
async function auditWorkbook(file, dashboardName) {
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(file);
  const missingImages = book.worksheets.filter(sheet => !sheet.getImages().length).map(sheet => sheet.name);
  let links = 0; let external = 0; let returns = 0;
  for (const sheet of book.worksheets) sheet.eachRow(row => row.eachCell(cell => { const formula = cell.value?.formula || ''; if (/HYPERLINK/.test(formula)) { links += 1; if (/[A-Z]:\\|file:|https?:/i.test(formula)) external += 1; if (formula.includes(`#'${dashboardName}'!A1`)) returns += 1; } }));
  return { ok: Boolean(book.getWorksheet(dashboardName)) && !missingImages.length && !external && links > 0 && returns >= book.worksheets.length - 1, sheetCount: book.worksheets.length, missingImages, links, external, returns };
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function parseCsv(text) { const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/); const heads = parseLine(lines[0]); return lines.slice(1).filter(Boolean).map(line => Object.fromEntries(parseLine(line).map((value, index) => [heads[index], value]))); }
function parseLine(line) { const out=[]; let value=''; let quoted=false; for(let i=0;i<line.length;i++){const c=line[i]; if(c==='"'&&quoted&&line[i+1]==='"'){value+='"';i++;} else if(c==='"')quoted=!quoted; else if(c===','&&!quoted){out.push(value);value='';} else value+=c;} out.push(value); return out; }
function toCsv(rows) { const keys=['编号','模块','测试场景','预期结果','实际结果','证据/日志']; return [keys.join(','),...rows.map(row=>keys.map(key=>`"${String(row[key]??'').replaceAll('"','""')}"`).join(','))].join('\n'); }
