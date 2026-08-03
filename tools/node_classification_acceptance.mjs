import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { analyzeShipment } from '../src/analyzer.js';
import { DEFAULT_SHOP_CP_ROWS } from '../src/shopCodeDefaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvFile = process.argv[2] || path.join(__dirname, '..', '_codex_ui_excel_node_pack', 'CODEX_最终UI_EXCEL_节点逻辑一次性执行包', '03_执行说明', '节点分类验收用例.csv');
const csvRows = fs.readFileSync(csvFile, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1);
const ids = csvRows.map(line => line.split(',')[0]);
const requiredIds = Array.from({ length: 10 }, (_, index) => `T${String(index + 1).padStart(2, '0')}`);
assert(JSON.stringify(ids) === JSON.stringify(requiredIds), `验收CSV用例不完整：${ids.join(', ')}`);

const shopCodeMap = new Map(DEFAULT_SHOP_CP_ROWS.map(row => [row.code, row.name]));
assert(shopCodeMap.size === 69, `门店白名单应为69个，实际${shopCodeMap.size}`);
assert(!['CCSLCN', 'CCSL580', 'CEZT'].some(code => shopCodeMap.has(code)), '正常中心节点误入门店白名单');
const results = [];

run('T01', () => expectNormal([inbound('2026-07-01 10:00:00', 'CCSLCN')]));
run('T02', () => expectNormal([inbound('2026-07-01 10:00:00', 'CCSL580')]));
run('T03', () => expectNormal([inbound('2026-07-01 10:00:00', 'CEZT')]));
run('T04', () => {
  const result = analyze([
    inbound('2026-07-01 09:00:00', 'CEZT'),
    outbound('2026-07-01 10:00:00', 'CEZT', 'Piphub Thmey Chamkar Doung II')
  ], '2026-07-02');
  expectShop(result, '门店途中', 'CP000520');
  assert(result.门店滞留天数 === 2, 'T04 停留天数应为2天');
});
run('T05', () => {
  const result = analyze([outbound('2026-07-01 10:00:00', 'CEZT', 'CP000520')], '2026-07-03');
  expectShop(result, '门店途中', 'CP000520');
  assert(result.门店滞留天数 >= 2, 'T05 未达到严重异常天数');
});
run('T06', () => {
  const result = analyze([inbound('2026-07-01 10:00:00', 'CP000520')], '2026-07-01');
  expectShop(result, '门店入库', 'CP000520');
});
run('T07', () => {
  const result = analyze([inbound('2026-07-01 10:00:00', 'Unknown Piphub co-shop')]);
  assert(result.是否门店 === '否', 'T07 泛关键词被误判为门店');
  assert(!/^门店/.test(result.异常分类), 'T07 进入门店分类');
});
run('T08', () => {
  const result = analyze([inbound('2026-07-01 10:00:00', 'CCSLCN')], '2026-07-01', { deliveryShop: 'CP000520' });
  expectNormalResult(result);
});
run('T09', () => {
  const result = analyze([
    inbound('2026-07-01 09:00:00', 'CP000520'),
    event('2026-07-01 12:00:00', '80', '包裹已经被签收 POD')
  ]);
  assert(result.异常分类 === 'POD闭环' && result.是否POD === '是', 'T09 POD未优先闭环');
  assert(result.matchedRule === 'POD_PRIORITY', 'T09 POD证据规则错误');
});
run('T10', () => {
  const normalThenShop = analyze([
    inbound('2026-07-01 10:00:00', 'CEZT'),
    outbound('2026-07-01 10:00:00', 'CEZT', 'CP000520')
  ]);
  expectShop(normalThenShop, '门店途中', 'CP000520');
  const shopThenNormal = analyze([
    outbound('2026-07-01 10:00:00', 'CEZT', 'CP000520'),
    inbound('2026-07-01 10:00:00', 'CEZT')
  ]);
  expectNormalResult(shopThenNormal);
});

const output = {
  ok: results.every(row => row.ok),
  csvFile,
  total: results.length,
  passed: results.filter(row => row.ok).length,
  failed: results.filter(row => !row.ok).length,
  results
};
const reportDir = path.resolve(__dirname, '..', 'data', 'codex_final_lock');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'node_classification_results.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));

function run(id, fn) {
  try {
    fn();
    results.push({ id, ok: true });
  } catch (error) {
    results.push({ id, ok: false, error: error.message });
  }
}

function analyze(events, reportDate = '2026-07-01', scanRow = {}) {
  return analyzeShipment({ waybill: 'TBKH000000001', scanRow, events, shopCodeMap, reportDate });
}

function expectNormal(events) {
  expectNormalResult(analyze(events));
}

function expectNormalResult(result) {
  assert(result.异常分类 === '正常分流节点', `应为正常分流节点，实际${result.异常分类}`);
  assert(result.是否门店 === '否', '正常分流节点被判为门店');
  assert(result.matchedRule === 'NORMAL_FINAL_HUB', '正常分流节点规则证据错误');
}

function expectShop(result, category, code) {
  assert(result.异常分类 === category, `应为${category}，实际${result.异常分类}`);
  assert(result.是否门店 === '是', '白名单目标未判为门店');
  assert(result.门店编码 === code, `门店编码错误：${result.门店编码}`);
}

function inbound(time, node) {
  return event(time, 'INBOUND', `货物到达网点【CEL:${node}】`);
}

function outbound(time, from, target) {
  return event(time, 'OUTBOUND', `货物离开网点【CEL:${from}】，下一个网点为【CEL:${target}】`);
}

function event(eventTime, eventCode, trackingEventDescZh) {
  return { shipmentCode: 'TBKH000000001', eventTime, eventCode, trackingEventCode: eventCode, trackingEventDescZh };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
