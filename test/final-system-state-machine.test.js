import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-final-system-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'final-system.db');

const { BUILTIN_SHOP_STORES } = await import('../src/shopWhitelistBuiltin.js');
const { getLatestShopByCode } = await import('../src/shopWhitelist.js');
const { detectShopInfo } = await import('../src/shopCodes.js');
const { analyzeStoreFlow } = await import('../src/storeFlow.js');
const { buildTrajectoryFacts } = await import('../src/trajectoryFacts.js');
const { analyzeShipment } = await import('../src/analyzerV30.js');
const { analyzeShopeeShipment } = await import('../src/shopeeAnalyzerV31.js');
const { latestEffectiveStatusLabel } = await import('../src/currentStatus.js');
const { getDb, closeDb } = await import('../src/db.js');
const { loadRangeDashboard } = await import('../src/rangeDashboardStore.js');
const { loadRangeDashboard: loadFinalRangeDashboard } = await import('../src/rangeDashboardStoreFinal.js');

function ev(code, time, text = '', extra = {}) {
  return {
    eventCode: String(code ?? ''),
    eventTime: time,
    trackingEventDesc: text,
    trackingEventDescZh: text,
    ...extra
  };
}

function outToShop(code, time = '2026-08-08 09:00:00') {
  return ev('', time, `货物离开网点，下一个网点为【${code}】`, { locationCode: code });
}

function inToShop(code, time = '2026-08-09 09:00:00') {
  return ev('', time, `货物到达网点【${code}】`, { locationCode: code });
}

test('locked builtin whitelist contains exactly 95 unique structured shop codes', () => {
  assert.equal(BUILTIN_SHOP_STORES.length, 95);
  assert.equal(new Set(BUILTIN_SHOP_STORES.map(row => row.shop_code)).size, 95);
  assert.equal(getLatestShopByCode('CP000540')?.name, 'CE Veng Sreng I');
  assert.ok(BUILTIN_SHOP_STORES.some(row => row.shop_code.startsWith('FS')));
  assert.ok(BUILTIN_SHOP_STORES.some(row => row.shop_code.startsWith('PV')));
  assert.ok(BUILTIN_SHOP_STORES.some(row => row.shop_code.startsWith('PNH')));
});

test('shop classification is structured-code exact, not name guessing', () => {
  const nameOnly = detectShopInfo({ events: [ev('', '2026-08-10 10:00:00', 'Kampot Co-Shop arrived')] });
  assert.equal(nameOnly.isShop, false);

  const unknown = detectShopInfo({ events: [inToShop('CP999999', '2026-08-10 10:00:00')] });
  assert.equal(unknown.isShop, false);
  assert.equal(unknown.unknownShopCode, 'CP999999');
  assert.equal(unknown.matchedRule, 'UNKNOWN_SHOP_CODE');
});

test('store transfer has its own natural-day clock and reaches 2-day threshold', () => {
  const events = [outToShop('CP000548', '2026-08-08 08:00:00')];
  const store = analyzeStoreFlow({ shipmentCode: 'STORE-T2', events, reportDate: '2026-08-09' });
  assert.equal(store.shopState, 'SHOP_TRANSFER_IN_PROGRESS');
  assert.equal(store.shopTransferNaturalDays, 2);
  assert.equal(store.shopRetentionNaturalDays, 0);

  const result = analyzeShipment({ waybill: 'STORE-T2', scanRow: { orderStatus: '70' }, events, reportDate: '2026-08-09' });
  assert.equal(result.primaryCategory, '门店途中2天+');
});

test('actual store arrival is normal first, then retention only after 2 natural days without a newer shop-side node', () => {
  const events = [outToShop('CP000548', '2026-08-08 08:00:00'), inToShop('CP000548', '2026-08-09 08:00:00')];
  const day1 = analyzeShipment({ waybill: 'STORE-A1', scanRow: { orderStatus: '70' }, events, reportDate: '2026-08-09' });
  assert.equal(day1.currentState, 'SHOP_ARRIVED_CURRENT');
  assert.equal(day1.primaryCategory, '门店入库');

  const day2 = analyzeShipment({ waybill: 'STORE-A2', scanRow: { orderStatus: '70' }, events, reportDate: '2026-08-10' });
  assert.equal(day2.currentState, 'SHOP_RETENTION');
  assert.equal(day2.primaryCategory, '门店滞留');
});

test('store Pending and OC remain self-pickup context and never become store-out-for-delivery', () => {
  const pendingEvents = [
    outToShop('CP000548', '2026-08-07 08:00:00'),
    inToShop('CP000548', '2026-08-08 08:00:00'),
    ev('150', '2026-08-10 10:00:00', 'Pending: customer not pickup phone call', { locationCode: 'CP000548' })
  ];
  const pending = analyzeShipment({ waybill: 'STORE-P', scanRow: { orderStatus: '70' }, events: pendingEvents, reportDate: '2026-08-10' });
  assert.equal(pending.currentState, 'SHOP_PENDING');
  assert.equal(pending.primaryCategory, '门店Pending');
  assert.equal(pending.shopRetentionNaturalDays, 1);

  const deliveryTextEvents = [
    outToShop('CP000548', '2026-08-09 08:00:00'),
    inToShop('CP000548', '2026-08-09 10:00:00'),
    ev('', '2026-08-10 10:00:00', 'delivery information updated', { locationCode: 'CP000548' })
  ];
  const store = analyzeStoreFlow({ shipmentCode: 'STORE-D', events: deliveryTextEvents, reportDate: '2026-08-10' });
  assert.equal(store.shopState, 'SHOP_ARRIVED_CURRENT', 'generic delivery wording must not close a customer-pickup store cycle');

  const ocEvents = [
    outToShop('CP000548', '2026-08-09 08:00:00'),
    inToShop('CP000548', '2026-08-09 10:00:00'),
    ev('', '2026-08-10 10:00:00', 'OC overdue', { locationCode: 'CP000548' })
  ];
  const oc = analyzeShipment({ waybill: 'STORE-OC', scanRow: { orderStatus: '70' }, events: ocEvents, reportDate: '2026-08-10' });
  assert.equal(oc.currentState, 'SHOP_OC');
  assert.equal(oc.primaryCategory, '门店OC');
});

test('eventCode 26 is pickup success, never inbound-no-scan', () => {
  const events = [ev('26', '2026-08-10 10:00:00', 'Parcel pickup successfully, is collected by [CEL:CCSL]', { locationCode: 'CCSL' })];
  const facts = buildTrajectoryFacts({ shipmentCode: 'C26', scanRow: { orderStatus: '70' }, events, reportDate: '2026-08-10' });
  assert.equal(facts.pickupSuccess, true);
  assert.equal(facts.inboundNoScan, false);
  const result = analyzeShipment({ waybill: 'C26', scanRow: { orderStatus: '70' }, events, reportDate: '2026-08-10' });
  assert.equal(result.currentState, 'PICKUP_SUCCESS');
  assert.equal(result.入库无扫描节点, '否');
  assert.equal(latestEffectiveStatusLabel({ currentState: result.currentState, state: result }), '揽收成功');
});

test('inbound-no-scan requires an explicit latest CCSL inbound/arrival action', () => {
  const events = [ev('', '2026-08-10 10:00:00', '货物到达网点【CEL:CCSL】', { locationCode: 'CCSL' })];
  const facts = buildTrajectoryFacts({ shipmentCode: 'INBOUND', scanRow: { orderStatus: '70' }, events, reportDate: '2026-08-10' });
  assert.equal(facts.inboundNoScan, true);
  const result = analyzeShipment({ waybill: 'INBOUND', scanRow: { orderStatus: '70' }, events, reportDate: '2026-08-10' });
  assert.equal(result.currentState, 'INBOUND_NO_SCAN');
  assert.equal(result.入库无扫描节点, '是');
});

test('special node and work-order self pickup outrank ordinary work-order anomaly', () => {
  const selfPickup = analyzeShipment({
    waybill: 'SELF', scanRow: { orderStatus: '70' }, reportDate: '2026-08-10',
    events: [ev('99', '2026-08-10 10:00:00', 'Work order:仓库自提')]
  });
  assert.equal(selfPickup.specialState, 'SELF_PICKUP');
  assert.equal(selfPickup.currentState, 'SELF_PICKUP');

  for (const [node, expected] of [['580','CCSL580_RETENTION'], ['CCSL580','CCSL580_RETENTION'], ['CECN','CCSLCN_DIVERSION'], ['CEZT','CCSLZT_DIVERSION']]) {
    const result = analyzeShipment({ waybill: `S-${node}`, scanRow: { orderStatus: '70' }, reportDate: '2026-08-10', events: [ev('', '2026-08-10 10:00:00', `货物到达网点【CEL:${node}】`, { locationCode: node })] });
    assert.equal(result.currentState, expected);
  }
});

test('latest trajectory event controls terminal state; historical POD cannot override a newer Pending', () => {
  const closed = analyzeShipment({ waybill: 'POD', scanRow: { orderStatus: '70' }, reportDate: '2026-08-10', events: [ev('80', '2026-08-10 10:00:00', 'POD')] });
  assert.equal(closed.是否POD, '是');

  const reopenedEvidence = [ev('80', '2026-08-09 10:00:00', 'POD'), ev('150', '2026-08-10 10:00:00', 'Pending: retry')];
  const ccsl = analyzeShipment({ waybill: 'LATEST', scanRow: { orderStatus: '70' }, reportDate: '2026-08-10', events: reopenedEvidence });
  assert.equal(ccsl.是否POD, '否');
  assert.equal(ccsl.currentState, 'PENDING');

  const shopee = analyzeShopeeShipment({ waybill: 'S-LATEST', scanRow: { orderStatus: '70' }, shipmentTrackRow: {}, dailyRow: {}, reportDate: '2026-08-10', analysisDate: '2026-08-10', events: reopenedEvidence, exceptions: [] });
  assert.equal(shopee.是否POD, '否');
  assert.notEqual(shopee.currentState, 'POD');
});

test('Pending facts deduplicate same day and expose non-continuity independently of current Pending', () => {
  const events = [
    ev('150', '2026-08-01 09:00:00', 'Pending A'),
    ev('150', '2026-08-01 18:00:00', 'Pending B'),
    ev('32', '2026-08-02 09:00:00', 'Cycle Count'),
    ev('150', '2026-08-03 09:00:00', 'Pending C')
  ];
  const pending = analyzeShipment({ waybill: 'P-GAP', scanRow: { orderStatus: '70' }, reportDate: '2026-08-03', events });
  assert.equal(pending.Pending次数, 2);
  assert.equal(pending.Pending事实连续性, '不连续');
  assert.equal(pending.Pending不连续, '是');

  const laterCycle = analyzeShipment({ waybill: 'P-GAP2', scanRow: { orderStatus: '70' }, reportDate: '2026-08-04', events: [...events, ev('32', '2026-08-04 09:00:00', 'Cycle Count')] });
  assert.equal(laterCycle.Pending次数, 0);
  assert.equal(laterCycle.currentState, 'CYCLE_COUNT');
  assert.equal(laterCycle.Pending不连续, '是', 'open ordinary parcel keeps the independent Pending-gap QC fact');
});

function insertFlexible(db, table, values) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(item => item.name));
  const entries = Object.entries(values).filter(([key]) => columns.has(key));
  const sql = `INSERT INTO ${table}(${entries.map(([key]) => key).join(',')}) VALUES(${entries.map(() => '?').join(',')})`;
  db.prepare(sql).run(...entries.map(([, value]) => value));
}

test('final range layer excludes pickup-success normal flow and keeps store-transfer 2+ abnormal', () => {
  const db = getDb();
  const date = '2026-08-10';
  const snapshotId = 'final-range-snapshot';
  const batchId = 'final-range-batch';
  const now = '2026-08-10T02:00:00.000Z';

  insertFlexible(db, 'unified_import_batches', { batchId, snapshotId, reportDate: date, sourceName: 'final.xlsx', fileHash: 'final-hash', status: 'VALID', summaryJson: '{}', warningsJson: '[]', createdAt: now });
  insertFlexible(db, 'unified_snapshots', { snapshotId, batchId, reportDate: date, status: 'COMPLETED', payloadJson: '{}', createdAt: now });

  const fixtures = [
    ['PICKUP', { primaryCategory: '正常流转', rawJson: JSON.stringify({ currentState: 'PICKUP_SUCCESS' }) }],
    ['TRANSIT2', { primaryCategory: '门店途中2天+', shopState: 'SHOP_TRANSFER_IN_PROGRESS', rawJson: JSON.stringify({ currentState: 'SHOP_TRANSFER_IN_PROGRESS', shopTransferNaturalDays: 2 }) }],
    ['SHOPP', { primaryCategory: '门店Pending', shopState: 'SHOP_ARRIVED_CURRENT', shopRetentionNaturalDays: 3, rawJson: JSON.stringify({ currentState: 'SHOP_PENDING' }) }],
    ['PENDING1', { primaryCategory: 'Pending1次', pendingDays: 1, rawJson: JSON.stringify({ currentState: 'PENDING', Pending连续性: '连续' }) }],
    ['PENDING3', { primaryCategory: 'Pending3次', pendingDays: 3, rawJson: JSON.stringify({ currentState: 'PENDING', Pending连续性: '连续' }) }]
  ];

  for (const [code, final] of fixtures) {
    insertFlexible(db, 'unified_import_rows', { batchId, snapshotId, reportDate: date, businessType: 'CE', shipmentCode: code, regionCode: 'PV', rowJson: '{}', createdAt: now });
    insertFlexible(db, 'final_rows', {
      shipmentCode: code, reportDate: date, isPod: 0, category: final.primaryCategory, primaryCategory: final.primaryCategory,
      pendingDays: final.pendingDays || 0, ocDays: 0, cycleCountDays: 0, deliveringDays: 0,
      shopState: final.shopState || '', shopRetentionNaturalDays: final.shopRetentionNaturalDays || 0,
      rawJson: final.rawJson || '{}', createdAt: now, updatedAt: now
    });
  }

  // Business-rule unit test: exercise the final normalization owner directly.
  // The public single-day facade is intentionally cache-only for interactive speed,
  // so newly inserted synthetic final_rows are not rescanned by a page read.
  const range = loadFinalRangeDashboard(date, date);
  assert.equal(range.states.CE.dashboard.normalOperationalOpen, 1);
  assert.equal(range.states.CE.dashboard.shopTransit2, 1);
  assert.equal(range.states.CE.dashboard.shopRetention2, 0, 'store Pending must not double-count as store retention');
  assert.equal(range.states.CE.dashboard.abnormalCount, 2, 'V58 keeps store-transfer 2+ and Pending3+ abnormal while continuous Pending1 stays below threshold');
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});