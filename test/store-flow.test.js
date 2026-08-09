import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStoreFlow } from '../src/storeFlow.js';
import { splitTrackBatches } from '../src/trackBatching.js';

const event = (eventTime, trackingEventDescZh, locationCode = '') => ({ eventTime, trackingEventDescZh, locationCode });
const TEST_SHOP = 'CP000512'; // committed default code; production also loads the full persisted SQLite whitelist.

test('track batching keeps maximum 50', () => {
  for (const [count, sizes] of [[1,[1]],[10,[10]],[11,[11]],[49,[49]],[50,[50]],[51,[50,1]],[99,[50,49]],[100,[50,50]],[101,[50,50,1]]]) {
    assert.deepEqual(splitTrackBatches(Array.from({ length: count }, (_, index) => `X${index}`)).map(batch => batch.length), sizes);
  }
});

test('outbound to exact whitelist store is in transit', () => {
  const result = analyzeStoreFlow({ shipmentCode: 'T1', reportDate: '2026-08-04', events: [
    event('2026-08-03 10:00:00', `货物离开网点【CEL:CEZT】，下一个网点为【CEL:${TEST_SHOP}】`)
  ] });
  assert.equal(result.shopState, 'SHOP_TRANSFER_IN_PROGRESS');
  assert.equal(result.targetShopCode, TEST_SHOP);
});

test('arrival changes transit to current store and calculates natural days', () => {
  const result = analyzeStoreFlow({ shipmentCode: 'T2', reportDate: '2026-08-04', events: [
    event('2026-08-02 10:00:00', `货物离开网点【CEL:CEZT】，下一个网点为【CEL:${TEST_SHOP}】`),
    event('2026-08-03 11:00:00', `货物到达网点【CEL:${TEST_SHOP}】`)
  ] });
  assert.equal(result.shopState, 'SHOP_ARRIVED_CURRENT');
  assert.equal(result.currentShopCode, TEST_SHOP);
  assert.equal(result.shopAgeNaturalDays, 2);
  assert.equal(result.shopRetentionNaturalDays, 2);
});

test('fresh Pending at current store resets no-update retention but preserves total shop age', () => {
  const result = analyzeStoreFlow({ shipmentCode: 'T3', reportDate: '2026-08-04', events: [
    event('2026-07-25 10:00:00', `Outbound next node CEL:${TEST_SHOP}`),
    event('2026-07-26 11:00:00', `Inbound CEL:${TEST_SHOP}`),
    event('2026-08-04 12:00:00', 'Pending 无法联系客户', TEST_SHOP)
  ] });
  assert.equal(result.shopState, 'SHOP_ARRIVED_CURRENT');
  assert.ok(result.storeTags.includes('SHOP_PENDING'));
  assert.ok(result.shopAgeNaturalDays > 5);
  assert.equal(result.shopRetentionNaturalDays, 1);
  assert.equal(result.storeTags.includes('SHOP_RETENTION_2_PLUS'), false);
});

test('normal hubs and fuzzy store names never become stores', () => {
  for (const node of ['CCSLCN', 'CCSLPDD', 'CCSL580', 'CEZT', 'Piphub Thmey Chamkar Doung II']) {
    const result = analyzeStoreFlow({ shipmentCode: node, reportDate: '2026-08-04', events: [event('2026-08-04 10:00:00', `Outbound next node CEL:${node}`)] });
    assert.equal(result.shopState, '');
  }
});

test('POD and return close a store cycle', () => {
  const events = [event('2026-08-03 10:00:00', `Outbound next node CEL:${TEST_SHOP}`)];
  assert.equal(analyzeStoreFlow({ shipmentCode: 'P', reportDate: '2026-08-04', events, isPod: true }).shopState, 'CLOSED');
  assert.equal(analyzeStoreFlow({ shipmentCode: 'R', reportDate: '2026-08-04', events, isReturned: true }).shopState, 'CLOSED');
});
