import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('V28 runtime patch loads before server start',()=>{
  const bootstrap=fs.readFileSync('bootstrap.js','utf8');
  assert.match(bootstrap,/v28RuntimePatch\.js/);
  assert.ok(bootstrap.indexOf('v28RuntimePatch.js') < bootstrap.indexOf("import('./server.js')"));
});

test('V28 metric detail reads latest VALID import even before unified completion',()=>{
  const source=fs.readFileSync('src/v28RuntimePatch.js','utf8');
  assert.match(source,/b\.status='VALID'/);
  assert.doesNotMatch(source,/unified_snapshots s ON s\.snapshotId=b\.snapshotId AND s\.status='COMPLETED'/);
  assert.match(source,/V28_LATEST_VALID_IMPORT_PLUS_FINAL_STATE/);
});

test('V28 resume removes persisted batch hash collisions and restores per-waybill scan checkpoints',()=>{
  const source=fs.readFileSync('src/v28RuntimePatch.js','utf8');
  assert.match(source,/DELETE FROM business_api_batches/);
  assert.match(source,/scanQueryStatus=statuses/);
  assert.match(source,/business_scan_results/);
});

test('V28 carry monitor excludes normal terminal states from anomaly monitoring',()=>{
  const source=fs.readFileSync('src/v28RuntimePatch.js','utf8');
  for(const token of ['POD','RETURN_COMPLETED','CEZT_RETENTION','CECN_RETENTION','CCSL580_RETENTION','SELF_PICKUP']) assert.match(source,new RegExp(token));
  assert.match(source,/if\(isNormalTerminal\(normalized\)\) continue/);
});

test('V28 manual SHOPEE tracking persists freshest terminal state back to carry/current state',()=>{
  const source=fs.readFileSync('src/v28RuntimePatch.js','utf8');
  assert.match(source,/updateCarryoverResults/);
  assert.match(source,/MANUAL_TRACK_/);
  assert.match(source,/path==='\/api\/track-query'/);
});
