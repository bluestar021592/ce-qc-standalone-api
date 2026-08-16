import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const patch = fs.readFileSync(new URL('../src/v162ShopeeLiveProgressPatch.js', import.meta.url), 'utf8');
const boot = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src/businessStore.js', import.meta.url), 'utf8');

test('V162 derives live Shopee event and exception progress from persisted API batches', () => {
  assert.match(patch, /business_api_batches/);
  assert.match(patch, /tms-shipment-event-query/);
  assert.match(patch, /exception-item-query/);
  assert.match(patch, /SUM\(COALESCE\(shipmentCount,0\)\)/);
  assert.match(patch, /V162_SHOPEE_API_BATCH_LIVE/);
});

test('V162 wraps run-progress before V33 registers its route', () => {
  const v162 = boot.indexOf('v162ShopeeLiveProgressPatch');
  const v33 = boot.indexOf('v33RunProgressPatch');
  assert.ok(v162 >= 0, 'V162 must be loaded');
  assert.ok(v33 > v162, 'V162 must load before V33 route registration');
});

test('Shopee pipeline checkpoints API batches while final trackResults are produced later', () => {
  assert.match(pipeline, /state\[statusKey\] = \[\.\.\.statusByBill\.values\(\)\]/);
  assert.match(pipeline, /await checkpoint\(state, onCheckpoint\)/);
  assert.match(store, /business_api_batches/);
  assert.match(store, /trackDone: state\.trackResults\.length/);
});
