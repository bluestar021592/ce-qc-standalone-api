import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileSevenBusinessSnapshotCounts } from '../src/v142SevenBusinessPeriodExporter.js';

const audit = {
  coreCounts: {
    CE: 2,
    CEAF: 1,
    TBKH: 1,
    ALI1688: 1,
    SHOPEECN: 1,
    SHOPEEVN: 1
  },
  whpp: { reported: 2 }
};

function rowsFromCounts(counts) {
  const rows = [];
  let index = 1;
  for (const [businessType, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i += 1) rows.push({ shipmentCode: `WB${String(index++).padStart(6, '0')}`, businessType });
  }
  return rows;
}

test('seven-business export source counts reconcile per business and in total', () => {
  const rows = rowsFromCounts({ CE: 2, CEAF: 1, TBKH: 1, ALI1688: 1, SHOPEECN: 1, SHOPEEVN: 1, WHPP: 2 });
  const result = reconcileSevenBusinessSnapshotCounts(rows, audit);
  assert.equal(result.passed, true);
  assert.equal(result.expectedTotal, 9);
  assert.equal(result.rows, 9);
  assert.equal(result.uniqueBills, 9);
  assert.deepEqual(result.mismatchedTypes, []);
  assert.deepEqual(result.actualCounts, result.expectedCounts);
});

test('offsetting cross-business misclassification fails even when grand total is unchanged', () => {
  const rows = rowsFromCounts({ CE: 1, CEAF: 2, TBKH: 1, ALI1688: 1, SHOPEECN: 1, SHOPEEVN: 1, WHPP: 2 });
  const result = reconcileSevenBusinessSnapshotCounts(rows, audit);
  assert.equal(result.rows, result.expectedTotal);
  assert.equal(result.uniqueBills, result.expectedTotal);
  assert.equal(result.passed, false);
  assert.deepEqual(result.mismatchedTypes, ['CE', 'CEAF']);
  assert.equal(result.actualCounts.CE, 1);
  assert.equal(result.expectedCounts.CE, 2);
  assert.equal(result.actualCounts.CEAF, 2);
  assert.equal(result.expectedCounts.CEAF, 1);
});

test('duplicate and unknown business rows fail final export conservation', () => {
  const rows = rowsFromCounts({ CE: 2, CEAF: 1, TBKH: 1, ALI1688: 1, SHOPEECN: 1, SHOPEEVN: 1, WHPP: 1 });
  rows.push({ shipmentCode: rows[0].shipmentCode, businessType: 'WHPP' });
  rows.push({ shipmentCode: 'UNKNOWN999', businessType: 'UNCLASSIFIED' });
  const result = reconcileSevenBusinessSnapshotCounts(rows, audit);
  assert.equal(result.passed, false);
  assert.ok(result.duplicateRows >= 1);
  assert.equal(result.unknownRows.length, 1);
  assert.equal(result.unknownRows[0].businessType, 'UNCLASSIFIED');
});
