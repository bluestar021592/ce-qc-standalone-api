import assert from 'node:assert/strict';
import test from 'node:test';

import { partitionUnifiedRows } from '../src/unifiedImportStore.js';

test('daily membership always follows imported source business type', () => {
  const partitioned = partitionUnifiedRows([
    { shipmentCode: 'CC100001', businessType: 'SHOPEEVN' }
  ], new Map([['CC100001', 'CE']]));

  assert.equal(partitioned.dailyRows.length, 1);
  assert.equal(partitioned.dailyRows[0].businessType, 'CE');
  assert.equal(partitioned.historicalCarryRows.length, 0);
});

test('historical carry preserves an existing valid business type', () => {
  const partitioned = partitionUnifiedRows([
    { shipmentCode: 'SPX200001', businessType: 'SHOPEEVN' }
  ], new Map());

  assert.equal(partitioned.dailyRows.length, 0);
  assert.equal(partitioned.historicalCarryRows.length, 1);
  assert.equal(partitioned.historicalCarryRows[0].businessType, 'SHOPEEVN');
});

test('historical carry with missing or invalid business type is explicit and never silently defaults to CE', () => {
  const partitioned = partitionUnifiedRows([
    { shipmentCode: 'UNKNOWN300001' },
    { shipmentCode: 'UNKNOWN300002', businessType: 'LEGACY_UNKNOWN' }
  ], new Map());

  assert.equal(partitioned.dailyRows.length, 0);
  assert.equal(partitioned.historicalCarryRows.length, 2);
  for (const row of partitioned.historicalCarryRows) {
    assert.equal(row.businessType, 'UNCLASSIFIED');
    assert.notEqual(row.businessType, 'CE');
    assert.match(String(row.classificationWarning || ''), /未兜底到CE/);
  }
});
