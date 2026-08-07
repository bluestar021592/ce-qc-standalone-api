import fs from 'node:fs';

function replaceExact(file, before, after, expected = 1) {
  let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const count = text.split(before).length - 1;
  if (count !== expected) throw new Error(`${file}: expected ${expected} occurrence(s), found ${count}`);
  text = text.split(before).join(after);
  fs.writeFileSync(file, text, 'utf8');
}

// 1) Y/W/P are delivery/open statuses, not POD. Only orderStatus=85 is a scan POD lock.
replaceExact(
  'src/scanTerminal.js',
  "  if (orderStatus === '85' || statusCode === 'Y') {\n    return result('POD', false, 'POD_COMPLETED', orderStatus === '85' ? 'ORDER_STATUS_85' : `STATUS_${statusCode || 'TEXT'}`);\n  }",
  "  if (orderStatus === '85') {\n    return result('POD', false, 'POD_COMPLETED', 'ORDER_STATUS_85');\n  }"
);

// 2) Restore work-order classification that was disabled by a mojibake literal.
replaceExact(
  'src/analyzer.js',
  "  if (category === 'éœ€äººå·¥å¤æ ¸' && workOrder.unprocessed) {\n    category = '工单未处理';\n    judgment = '存在明确工单事件，且工单后没有更晚的有效业务处理节点';\n  }",
  "  if (category === '需人工复核' && workOrder.unprocessed) {\n    category = '工单未处理';\n    judgment = '存在明确工单事件，且工单后没有更晚的有效业务处理节点';\n  }"
);
replaceExact(
  'src/analyzer.js',
  "    '入库无扫描': 'INBOUND_WITHOUT_DELIVERY_SCAN'\n  };",
  "    '入库无扫描': 'INBOUND_WITHOUT_DELIVERY_SCAN',\n    '工单未处理': 'WORK_ORDER_UNPROCESSED'\n  };"
);

// 3) All approved latest-node special states are terminal for next-day carry.
replaceExact(
  'src/pipeline.js',
  "import { classifyScanTerminal } from './scanTerminal.js';",
  "import { classifyScanTerminal } from './scanTerminal.js';\nimport { isSpecialCategory } from './specialNode.js';"
);
replaceExact(
  'src/pipeline.js',
  "    .filter(row => row.specialState !== 'SELF_PICKUP' && row.primaryCategory !== '仓库自提')",
  "    .filter(row => !isSpecialCategory(row) && row.primaryCategory !== '仓库自提')",
  2
);

// 4) Shopee special latest nodes (self-pickup/CECN/CEZT/580) are closed, not carry-active.
replaceExact(
  'src/shopeeAnalyzer.js',
  "  const closed = isPod || isReturned || special?.specialState === 'SELF_PICKUP';",
  "  const closed = isPod || isReturned || Boolean(special);"
);
replaceExact(
  'src/shopeeAnalyzer.js',
  "    carry状态: closed ? (isPod ? 'closed_pod' : (isReturned ? 'closed_return' : 'closed_self_pickup')) : 'active',",
  "    carry状态: closed ? (isPod ? 'closed_pod' : (isReturned ? 'closed_return' : `closed_${String(special?.specialState || 'special').toLowerCase()}`)) : 'active',"
);

// 5) Special rows are informative counters, never abnormal-rate members or next-carry members.
replaceExact(
  'src/reporting.js',
  "function isAnyAbnormalRow(row = {}) {\n  return row?.是否POD !== '是'\n    && !isNormalFinalDiversionRow(row)\n    && !isRefreshFailedRow(row);\n}",
  "function isAnyAbnormalRow(row = {}) {\n  return row?.是否POD !== '是'\n    && !isNormalFinalDiversionRow(row)\n    && !isRefreshFailedRow(row)\n    && !isSpecialRetentionRow(row);\n}"
);
replaceExact(
  'src/reporting.js',
  "function nextCarryRows(state) {\n  const podSet = new Set(cleanMainBills(state.podLocks || []));\n  const finalDiversion = new Set((state.finalRows || [])\n    .filter(isNormalFinalDiversionRow)\n    .map(billOf)\n    .filter(Boolean));\n  return cleanMainBills(state.nextCarryBills || state.carryBills || [])\n    .filter(wb => !podSet.has(wb))\n    .filter(wb => !finalDiversion.has(wb))\n    .map(wb => ({ 运单号: wb, 来源类型: '明日继续' }));\n}",
  "function nextCarryRows(state) {\n  const podSet = new Set(cleanMainBills(state.podLocks || []));\n  const finalDiversion = new Set((state.finalRows || [])\n    .filter(isNormalFinalDiversionRow)\n    .map(billOf)\n    .filter(Boolean));\n  const specialClosed = new Set((state.finalRows || [])\n    .filter(isSpecialRetentionRow)\n    .map(billOf)\n    .filter(Boolean));\n  return cleanMainBills(state.nextCarryBills || state.carryBills || [])\n    .filter(wb => !podSet.has(wb))\n    .filter(wb => !finalDiversion.has(wb))\n    .filter(wb => !specialClosed.has(wb))\n    .map(wb => ({ 运单号: wb, 来源类型: '明日继续' }));\n}"
);

// 6) Unified cross-day state must close every approved special final node.
replaceExact(
  'src/unifiedImportStore.js',
  "      const selfPickup = row.primaryCategory === 'SELF_PICKUP' || row.主分类 === '仓库自提';\n      const normal = row.primaryCategory === '正常分流节点';\n      const apiFailed = /失败|retry/i.test(String(row.API状态 || row.查询状态 || ''));\n      const closed = pod || returned || selfPickup || normal;\n      const status = closed ? 'CLOSED' : 'OPEN';\n      const reason = pod ? 'POD' : returned ? 'RETURNED' : selfPickup ? 'SELF_PICKUP' : normal ? 'NORMAL_FINAL' : '';",
  "      const specialState = String(row.specialState || row.primaryCategory || row.主分类 || '').trim().toUpperCase();\n      const specialClosed = ['SELF_PICKUP', 'CECN_RETENTION', 'CEZT_RETENTION', 'CCSL580_RETENTION'].includes(specialState) || row.主分类 === '仓库自提';\n      const normal = row.primaryCategory === '正常分流节点' || row.matchedRule === 'NORMAL_FINAL_HUB';\n      const apiFailed = /失败|retry/i.test(String(row.API状态 || row.查询状态 || ''));\n      const closed = pod || returned || specialClosed || normal;\n      const status = closed ? 'CLOSED' : 'OPEN';\n      const reason = pod ? 'POD' : returned ? 'RETURNED' : specialClosed ? (specialState || 'SELF_PICKUP') : normal ? 'NORMAL_FINAL' : '';"
);

// 7) Batch tracking workspace should not ask users to re-query terminal special/normal nodes.
replaceExact(
  'server.js',
  "    const specialState = row.specialState || row.primaryCategory || row.主分类 || '';\n    const shopState = row.shopState || row.shopStatus || row.门店状态 || row.storeFlowState || '';\n    const category = row.primaryCategory || row.主分类 || row.异常分类 || '';\n    const isClosed = isPod || isReturn;\n    const isActionable = !isClosed;",
  "    const specialState = row.specialState || row.primaryCategory || row.主分类 || '';\n    const shopState = row.shopState || row.shopStatus || row.门店状态 || row.storeFlowState || '';\n    const category = row.primaryCategory || row.主分类 || row.异常分类 || '';\n    const specialClosed = ['SELF_PICKUP', 'CECN_RETENTION', 'CEZT_RETENTION', 'CCSL580_RETENTION'].includes(String(specialState || '').trim().toUpperCase());\n    const normalFinal = category === '正常分流节点' || row.matchedRule === 'NORMAL_FINAL_HUB';\n    const isClosed = isPod || isReturn || specialClosed || normalFinal;\n    const isActionable = !isClosed;"
);
replaceExact(
  'server.js',
  "      queryStatus: isPod ? 'POD跳过' : (isReturn ? '退回跳过' : (failed ? '待重试' : ((row.轨迹节点数 || row.轨迹节点数量 || 0) > 0 ? '成功' : '需查轨迹'))),",
  "      queryStatus: isPod ? 'POD跳过' : (isReturn ? '退回跳过' : (specialClosed ? '特殊节点跳过' : (normalFinal ? '正常分流跳过' : (failed ? '待重试' : ((row.轨迹节点数 || row.轨迹节点数量 || 0) > 0 ? '成功' : '需查轨迹'))))),"
);
replaceExact(
  'server.js',
  "    completed: allRows.filter(row => ['成功', 'POD跳过', '退回跳过'].includes(row.queryStatus)).length",
  "    completed: allRows.filter(row => ['成功', 'POD跳过', '退回跳过', '特殊节点跳过', '正常分流跳过'].includes(row.queryStatus)).length"
);

// 8) Add focused regression coverage for the exact production rules that previously regressed.
fs.writeFileSync('test/v12-business-rule-hardening.test.js', `import test from 'node:test';\nimport assert from 'node:assert/strict';\n\nimport { classifyScanTerminal } from '../src/scanTerminal.js';\nimport { analyzeShipment } from '../src/analyzer.js';\nimport { analyzeShopeeShipment } from '../src/shopeeAnalyzer.js';\nimport { buildDashboardData } from '../src/reporting.js';\nimport { runQcPipeline } from '../src/pipeline.js';\n\ntest('V12 W/Y/P remain open and require tracking while 85/P4008/P4007 keep terminal routing', () => {\n  for (const statusCode of ['W', 'Y', 'P']) {\n    const result = classifyScanTerminal({ shipmentCode: 'CCV12', statusCode }, 'success');\n    assert.equal(result.currentState, 'OPEN_TRACK_REQUIRED');\n    assert.equal(result.trackRequired, true);\n  }\n  assert.equal(classifyScanTerminal({ shipmentCode: 'POD85', orderStatus: 85 }, 'success').currentState, 'POD');\n  assert.equal(classifyScanTerminal({ shipmentCode: 'RET', statusCode: 'P4008' }, 'success').trackRequired, false);\n  assert.equal(classifyScanTerminal({ shipmentCode: 'PR', statusCode: 'P4007' }, 'success').trackRequired, true);\n});\n\ntest('V12 unresolved explicit work order is classified as 工单未处理', () => {\n  const row = analyzeShipment({ waybill: 'CCWORK12', reportDate: '2026-08-07', events: [\n    { shipmentCode: 'CCWORK12', eventCode: '99', eventTime: '2026-08-07 10:00:00', trackingEventDescZh: '备注:Work order:客户投诉待处理' }\n  ] });\n  assert.equal(row.primaryCategory, '工单未处理');\n  assert.equal(row.matchedRule, 'WORK_ORDER_UNPROCESSED');\n});\n\ntest('V12 special latest nodes are not abnormalities and are removed from dashboard next carry', () => {\n  const finalRows = [\n    { 运单号: 'SP1', 是否POD: '否', specialState: 'SELF_PICKUP', primaryCategory: 'SELF_PICKUP' },\n    { 运单号: 'SP2', 是否POD: '否', specialState: 'CECN_RETENTION', primaryCategory: 'CECN_RETENTION' },\n    { 运单号: 'SP3', 是否POD: '否', specialState: 'CEZT_RETENTION', primaryCategory: 'CEZT_RETENTION' },\n    { 运单号: 'SP4', 是否POD: '否', specialState: 'CCSL580_RETENTION', primaryCategory: 'CCSL580_RETENTION' }\n  ];\n  const dashboard = buildDashboardData({ pnhBills: ['SP1','SP2','SP3','SP4'], scanPool: ['SP1','SP2','SP3','SP4'], finalRows, nextCarryBills: ['SP1','SP2','SP3','SP4'] });\n  assert.equal(dashboard.abnormalCount, 0);\n  assert.equal(dashboard.nextCarry, 0);\n  assert.equal(dashboard.categories.selfPickup, 1);\n  assert.equal(dashboard.categories.cecnRetention, 1);\n  assert.equal(dashboard.categories.ceztRetention, 1);\n  assert.equal(dashboard.categories.ccsl580Retention, 1);\n});\n\ntest('V12 Shopee special latest nodes are closed instead of active carry', () => {\n  for (const place of ['CE:CECN', 'CEL:CEZT', 'CE:580']) {\n    const row = analyzeShopeeShipment({\n      waybill: 'SPEV12', reportDate: '2026-08-07', analysisDate: '2026-08-07',\n      scanRow: { shipmentCode: 'SPEV12', statusCode: 'P' },\n      events: [{ shipmentCode: 'SPEV12', eventTime: '2026-08-07 10:00:00', place }],\n      exceptions: [], apiStatus: { shipment: 'success', event: 'success', exception: 'success' }\n    });\n    assert.equal(row.跨日状态, '已闭环');\n    assert.match(String(row.carry状态), /^closed_/);\n  }\n});\n\ntest('V12 generic pipeline excludes CECN/CEZT/580/self-pickup from next-day carry', async () => {\n  const bills = ['CECN12', 'CEZT12', 'M58012', 'PICK12'];\n  const eventByBill = {\n    CECN12: { shipmentCode: 'CECN12', eventTime: '2026-08-07 10:00:00', place: 'CE:CECN' },\n    CEZT12: { shipmentCode: 'CEZT12', eventTime: '2026-08-07 10:00:00', place: 'CEL:CEZT' },\n    M58012: { shipmentCode: 'M58012', eventTime: '2026-08-07 10:00:00', place: 'CE:580' },\n    PICK12: { shipmentCode: 'PICK12', eventTime: '2026-08-07 10:00:00', trackingEventDescZh: '备注:Work order:仓库自提' }\n  };\n  const state = { businessType: 'CCSL', reportDate: '2026-08-07', pnhBills: bills, carryBills: [], podLocks: [], currentRun: { runId: 'v12-special' } };\n  await runQcPipeline({ state, client: {\n    confirmQuery: async codes => codes.map(shipmentCode => ({ shipmentCode, statusCode: 'P' })),\n    trackQuery: async codes => codes.map(code => eventByBill[code]).filter(Boolean)\n  }});\n  assert.deepEqual(state.nextCarryBills, []);\n});\n`, 'utf8');

// 9) Make the locked CI run the new regression file as part of the permanent gate.
replaceExact(
  '.github/workflows/restore-v18-smoke.yml',
  "            'test/v11-terminal-isolation-return.test.js',\n            'test/v9-period-range.test.js',",
  "            'test/v11-terminal-isolation-return.test.js',\n            'test/v12-business-rule-hardening.test.js',\n            'test/v9-period-range.test.js',"
);

console.log('V12 rule hardening patch applied successfully.');
