import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const syntax=file=>{const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(result.status,0,`${file}: ${result.stderr||result.stdout}`);};

const patch=read('src/v153RangeZeroRecoveryPatch.js');
const injector=read('src/v44WhppUiPatch.js');

test('V153 zero recovery is syntax valid and loaded before V152 response rewriting',()=>{
  syntax('src/v153RangeZeroRecoveryPatch.js');
  syntax('src/v44WhppUiPatch.js');
  const recovery=injector.indexOf("import './v153RangeZeroRecoveryPatch.js'");
  const v152=injector.indexOf("import './v152FactTruthPatch.js'");
  assert.ok(recovery>=0&&v152>recovery,'V153 must be imported before V152 so its response repair runs last');
  assert.match(injector,/v153-range-zero-recovery-v1/);
});

test('V153 uses latest VALID daily imports as membership truth without requiring COMPLETED snapshots',()=>{
  assert.match(patch,/FROM unified_import_batches b/);
  assert.match(patch,/WHERE b\.status='VALID' AND b\.reportDate BETWEEN \? AND \?/);
  assert.match(patch,/INNER JOIN unified_import_rows u ON u\.snapshotId=l\.snapshotId/);
  assert.doesNotMatch(patch,/s\.status='COMPLETED'/);
  assert.match(patch,/LATEST_VALID_IMPORT_PER_DATE/);
});

test('V153 repairs both custom range dashboards and trend payloads',()=>{
  assert.match(patch,/pathValue==='\/api\/period-dashboard'/);
  assert.match(patch,/pathValue==='\/api\/v27\/trends'/);
  assert.match(patch,/function periodBody/);
  assert.match(patch,/function trendBody/);
  assert.match(patch,/historySource:'V153_LATEST_VALID_IMPORT_FACTS'/);
});

test('V153 restores Shopee 1 2 3 attempt counts and rates from persisted final evidence',()=>{
  assert.match(patch,/podAttemptNo/);
  assert.match(patch,/currentAttemptNo/);
  assert.match(patch,/dispatchAttempt1Rate/);
  assert.match(patch,/dispatchAttempt2Rate/);
  assert.match(patch,/dispatchAttempt3Rate/);
  assert.match(patch,/attempt1Count/);
  assert.match(patch,/attempt2Count/);
  assert.match(patch,/attempt3Count/);
});

test('V153 exposes a read-only fact audit endpoint for zero diagnostics',()=>{
  assert.match(patch,/\/api\/v153\/fact-audit/);
  assert.match(patch,/byType/);
  assert.doesNotMatch(patch,/\b(?:DELETE|DROP|UPDATE|INSERT)\b\s+(?:FROM|INTO|unified_import|final_rows|business_final_rows)/i);
});
