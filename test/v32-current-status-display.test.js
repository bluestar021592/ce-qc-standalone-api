import test from 'node:test';
import assert from 'node:assert/strict';

import { latestEffectiveStatusLabel, isHistoricalMonitorLabel } from '../src/currentStatus.js';

test('current status prefers latest structured state over historical QC category', () => {
  assert.equal(latestEffectiveStatusLabel({
    currentState: 'CEZT_RETENTION',
    state: { primaryCategory: '三次Pending后未退回', Pending次数: 3 }
  }), 'CEZT滞留包裹');

  assert.equal(latestEffectiveStatusLabel({
    currentState: 'RETURN_IN_PROGRESS',
    state: { primaryCategory: '派送中停留', 退回状态: '退回处理中' }
  }), '退回处理中');

  assert.equal(latestEffectiveStatusLabel({
    currentState: 'RETURN_COMPLETED',
    state: { primaryCategory: 'Pending3次以上', 退回状态: '已退回' }
  }), '已退回');
});

test('locked trajectory codes determine user-facing current status', () => {
  const cases = [
    ['26', '入库无扫描'],
    ['30', '盘点'],
    ['32', '盘点'],
    ['99', '工单'],
    ['150', 'Pending'],
    ['80', '已签收'],
    ['84', '退回处理中'],
    ['86', '已退回']
  ];
  for (const [latestTrackStatusCode, expected] of cases) {
    assert.equal(latestEffectiveStatusLabel({
      state: { latestTrackStatusCode, primaryCategory: '三次Pending后未退回' }
    }), expected);
  }
});

test('special destinations map to readable current status labels', () => {
  assert.equal(latestEffectiveStatusLabel({ state: { specialState: 'SELF_PICKUP' } }), '仓库自提');
  assert.equal(latestEffectiveStatusLabel({ state: { specialState: 'CECN_RETENTION' } }), 'CECN滞留包裹');
  assert.equal(latestEffectiveStatusLabel({ state: { specialState: 'CEZT_RETENTION' } }), 'CEZT滞留包裹');
  assert.equal(latestEffectiveStatusLabel({ state: { specialState: 'CCSL580_RETENTION' } }), '580滞留包裹');
});

test('historical anomaly buckets are never reused as current status fallback', () => {
  for (const label of ['三次Pending后未退回', 'Pending3次以上', 'Pending不连续', 'OC3天+', '盘点2天+', '派送中停留', '严重超时未更新']) {
    assert.equal(isHistoricalMonitorLabel(label), true, label);
    assert.equal(latestEffectiveStatusLabel({ state: { primaryCategory: label } }), '待更新', label);
  }
});

test('latest node can provide a safe current status when structured state is missing', () => {
  assert.equal(latestEffectiveStatusLabel({ latestNode: '货物到达网点【CEL:CEZT】' }), 'CEZT滞留包裹');
  assert.equal(latestEffectiveStatusLabel({ latestNode: '最新节点 Pending 客户改约' }), 'Pending');
  assert.equal(latestEffectiveStatusLabel({ latestNode: 'Delivery in progress' }), '派送中');
});
