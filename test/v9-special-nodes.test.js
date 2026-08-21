import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyLatestSpecialNode } from '../src/specialNode.js';

test('V9 special node aliases classify from the latest effective tracking event only', () => {
  for (const place of ['CE:580', 'CEL:580', 'CE:CCSL580', 'CEL:CCSL580']) {
    assert.equal(classifyLatestSpecialNode([{ eventTime: '2026-08-04 10:00:00', place }])?.specialState, 'CCSL580_RETENTION');
  }
  assert.equal(classifyLatestSpecialNode([{ eventTime: '2026-08-04 10:00:00', place: 'CE:CECN' }])?.specialState, 'CECN_RETENTION');
  assert.equal(classifyLatestSpecialNode([{ eventTime: '2026-08-04 10:00:00', place: 'CEL:CEZT' }])?.specialState, 'CEZT_RETENTION');
});

test('V9 later POD or normal action removes prior 580 retention', () => {
  const afterPod = classifyLatestSpecialNode([
    { eventTime: '2026-08-04 10:00:00', place: 'CE:580' },
    { eventTime: '2026-08-05 10:00:00', trackingEventDescZh: 'POD:签收完成' }
  ]);
  assert.equal(afterPod, null);
  const dailyTextMustNotCount = classifyLatestSpecialNode([
    { eventTime: '2026-08-04 10:00:00', place: 'PP', trackingEventDescZh: '派送中' }
  ]);
  assert.equal(dailyTextMustNotCount, null);
});

test('V9 warehouse self pickup supports Chinese and English latest events', () => {
  assert.equal(classifyLatestSpecialNode([{ eventTime: '2026-08-04 10:00:00', trackingEventDescZh: '仓库自提完成' }])?.specialState, 'SELF_PICKUP');
  assert.equal(classifyLatestSpecialNode([{ eventTime: '2026-08-04 10:00:00', trackingEventDesc: 'Warehouse self pickup' }])?.specialState, 'SELF_PICKUP');
});
