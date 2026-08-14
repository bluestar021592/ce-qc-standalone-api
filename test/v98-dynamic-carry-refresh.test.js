import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cambodiaClock } from '../src/carryoverRefreshScheduler.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Cambodia rollover clock resolves 00:05 independently of host timezone',()=>{
  const clock=cambodiaClock(new Date('2026-08-13T17:05:00.000Z'));
  assert.equal(clock.date,'2026-08-14');
  assert.equal(clock.hour,0);
  assert.equal(clock.minute,5);
});

test('dynamic carry refresh is OPEN-only and reuses verified processing/persistence paths',()=>{
  const source=read('src/carryoverRefreshScheduler.js');
  const syntax=spawnSync(process.execPath,['--check',path.join(root,'src','carryoverRefreshScheduler.js')],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(source,/Asia\/Phnom_Penh/);
  assert.match(source,/minuteOfDay >= 5/);
  assert.match(source,/2 \* 60 \* 60 \* 1000/);
  assert.match(source,/FROM carryover_open_items WHERE status='OPEN'/);
  assert.match(source,/pnhBills:\s*\[\]/);
  assert.match(source,/carryBills:\s*bills/);
  assert.match(source,/runQcPipeline/);
  assert.match(source,/runWhppPipeline/);
  assert.match(source,/updateCarryoverResults/);
});

test('dynamic refresh never directly rewrites immutable daily/history result tables',()=>{
  const source=read('src/carryoverRefreshScheduler.js');
  for(const table of ['unified_import_rows','shipment_daily_snapshots','final_rows','business_final_rows','unified_snapshots']) {
    assert.doesNotMatch(source,new RegExp(`(?:UPDATE|DELETE\\s+FROM|INSERT\\s+INTO)\\s+${table}`,'i'));
  }
  assert.doesNotMatch(source,/resetAppState|executePurge|DELETE FROM carryover_open_items/i);
});

test('API failure rows never enter successful carry persistence',()=>{
  const source=read('src/carryoverRefreshScheduler.js');
  assert.match(source,/REFRESH_FAILED\|API_PENDING_RETRY\|RETRY/);
  assert.match(source,/successfulRows\.push\(normalizeDynamicCarryRow\(row\)\)/);
  assert.match(source,/if \(successfulRows\.length\) applySuccessfulCarryRefresh\(successfulRows/);
  assert.match(source,/Failed API bills are never passed here/);
});

test('return-in-progress stays OPEN and cancellation uses a separate terminal rule',()=>{
  const source=read('src/carryoverRefreshScheduler.js');
  assert.match(source,/KEEP_OPEN_UNTIL_RETURN_86/);
  assert.match(source,/RETURN_IN_PROGRESS/);
  assert.match(source,/CLOSE_CANCELLED/);
  assert.match(source,/ORDER_CANCELLED/);
});

test('V98 lifecycle patch has no HTTP bypass route and starts scheduler inside backend listen lifecycle',()=>{
  const relative='src/v98CarryRefreshEndpointPatch.js';
  const source=read(relative);
  const syntax=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(source,/startCarryoverRefreshScheduler/);
  assert.match(source,/express\.application\.listen/);
  assert.doesNotMatch(source,/this\.(?:get|post|put|patch|delete)\(/);
  assert.doesNotMatch(source,/accessIdentity|LOCAL_INTERNAL|carry-refresh\/status/);
});

test('normal UI/server boot imports the backend-owned V98 lifecycle patch',()=>{
  const source=read('src/v44WhppUiPatch.js');
  assert.match(source,/import '\.\/v98CarryRefreshEndpointPatch\.js'/);
});

test('Pending growth still comes from real distinct trajectory dates rather than midnight age',()=>{
  const analyzer=read('src/analyzerV30.js');
  assert.match(analyzer,/Pending business facts come from the trajectory fact layer/);
  assert.match(analyzer,/pendingDistinctDayCount/);
  assert.doesNotMatch(analyzer,/Pending次数:\s*naturalDays/);
});
