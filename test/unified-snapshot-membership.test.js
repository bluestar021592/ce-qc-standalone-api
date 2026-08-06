import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionUnifiedRows } from '../src/unifiedImportStore.js';

test('unified daily snapshot excludes historical carry without deleting it', () => {
  const typeByBill = new Map([
    ['CE-TODAY', 'CE'],
    ['CN-TODAY', 'SHOPEECN'],
    ['VN-TODAY', 'SHOPEEVN']
  ]);
  const result = partitionUnifiedRows([
    { shipmentCode: 'CE-TODAY', businessType: 'CCSL' },
    { shipmentCode: 'CN-TODAY', businessType: 'SHOPEE' },
    { shipmentCode: 'VN-TODAY', businessType: 'SHOPEE' },
    { shipmentCode: 'OLD-CCSL', businessType: 'CCSL' },
    { shipmentCode: 'OLD-SHOPEE', businessType: 'SHOPEE' }
  ], typeByBill);

  assert.deepEqual(result.dailyRows.map(row => [row.shipmentCode, row.businessType]), [
    ['CE-TODAY', 'CE'],
    ['CN-TODAY', 'SHOPEECN'],
    ['VN-TODAY', 'SHOPEEVN']
  ]);
  assert.deepEqual(result.historicalCarryRows.map(row => row.shipmentCode), ['OLD-CCSL', 'OLD-SHOPEE']);
});
