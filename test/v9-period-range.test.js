import assert from 'node:assert/strict';
import test from 'node:test';

import { periodRange } from '../src/periodExporter.js';

test('V9 daily, Monday-Sunday weekly and natural month ranges use Phnom Penh dates', () => {
  assert.deepEqual(periodRange('daily', '2026-08-04'), { from: '2026-08-04', to: '2026-08-04', key: '2026-08-04' });
  assert.deepEqual(periodRange('weekly', '2026-08-04'), { from: '2026-08-03', to: '2026-08-09', key: '2026-08-03_2026-08-09' });
  assert.deepEqual(periodRange('monthly', '2026-08-04'), { from: '2026-08-01', to: '2026-08-31', key: '2026-08' });
});
