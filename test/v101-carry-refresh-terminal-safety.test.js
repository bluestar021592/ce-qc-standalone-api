import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('dynamic carry keeps return-in-progress OPEN until completed return evidence',()=>{
  const source=read('src/carryoverRefreshScheduler.js');
  assert.match(source,/RETURN_IN_PROGRESS/);
  assert.match(source,/退回处理中/);
  assert.match(source,/KEEP_OPEN_UNTIL_RETURN_86/);
  assert.match(source,/primaryCategory: '逆向处理中'/);
});

test('dynamic carry closes cancellation through the existing normal terminal path',()=>{
  const source=read('src/carryoverRefreshScheduler.js');
  assert.match(source,/ORDER_CANCELLED/);
  assert.match(source,/CLOSE_CANCELLED/);
  assert.match(source,/matchedRule: 'NORMAL_FINAL_HUB'/);
});

test('carry persistence preserves original CE/CN/VN business ownership',()=>{
  const source=read('src/unifiedImportStore.js');
  const start=source.indexOf('export function updateCarryoverResults');
  const end=source.indexOf('export function carryoverSummary',start);
  assert.ok(start>=0 && end>start);
  const fn=source.slice(start,end);
  assert.match(fn,/UPDATE carryover_open_items SET status=/);
  assert.match(fn,/UPDATE shipment_current_state SET state=/);
  assert.doesNotMatch(fn,/SET\s+businessType\s*=|businessType\s*=\?/i);
});

test('carry persistence closes only explicit POD, completed return, special destination or normal final',()=>{
  const source=read('src/unifiedImportStore.js');
  const start=source.indexOf('export function updateCarryoverResults');
  const end=source.indexOf('export function carryoverSummary',start);
  const fn=source.slice(start,end);
  assert.match(fn,/const pod =/);
  assert.match(fn,/const returned =/);
  assert.match(fn,/const specialClosed =/);
  assert.match(fn,/const normal =/);
  assert.match(fn,/const closed = pod \|\| returned \|\| specialClosed \|\| normal/);
});

test('full business-data purge and automatic carry refresh are mutually exclusive',()=>{
  const scheduler=read('src/carryoverRefreshScheduler.js');
  const purge=read('src/dataPurge.js');
  assert.match(scheduler,/data_purge_block_until/);
  assert.match(scheduler,/purgeBlockUntil > Date\.now\(\)/);
  assert.match(purge,/const PURGE_BLOCK_KEY = 'data_purge_block_until'/);
  assert.match(purge,/setPurgeBlock\(db, expiresAt\)/);
  assert.match(purge,/clearBusinessRuntimeMeta\(db\)/);
  assert.match(purge,/key LIKE 'carry_refresh_%' OR key=\?/);
});
