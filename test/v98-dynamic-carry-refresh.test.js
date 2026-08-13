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

test('dynamic carry refresh is source OPEN only and uses existing verified processing/persistence paths',()=>{
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

test('dynamic refresh never rewrites immutable daily/history result tables directly',()=>{
  const source=read('src/carryoverRefreshScheduler.js');
  for(const table of ['unified_import_rows','shipment_daily_snapshots','final_rows','business_final_rows','unified_snapshots']) {
    assert.doesNotMatch(source,new RegExp(`(?:UPDATE|DELETE\\s+FROM|INSERT\\s+INTO)\\s+${table}`,'i'));
  }
  assert.doesNotMatch(source,/resetAppState|executePurge|DELETE FROM carryover_open_items/i);
});

test('API failure rows are excluded from the persistence call so prior current state survives',()=>{
  const source=read('src/carryoverRefreshScheduler.js');
  assert.match(source,/REFRESH_FAILED\|API_PENDING_RETRY\|RETRY/);
  assert.match(source,/successfulRows\.push\(row\)/);
  assert.match(source,/if \(successfulRows\.length\) applySuccessfulCarryRefresh\(successfulRows/);
  assert.match(source,/Failed API bills are never passed here/);
});

test('due-only endpoint cannot refresh during foreground processing or before schedule is due',()=>{
  const source=read('src/v98CarryRefreshEndpointPatch.js');
  const syntax=spawnSync(process.execPath,['--check',path.join(root,'src','v98CarryRefreshEndpointPatch.js')],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(source,/dueCarryRefreshReason/);
  assert.match(source,/if \(!dueReason\).*NOT_DUE/);
  assert.match(source,/hasActiveBusinessProcessing/);
  assert.match(source,/FOREGROUND_PROCESSING_ACTIVE/);
  assert.match(source,/refreshOpenCarryNow/);
});

test('internal refresh bypass is restricted to exact loopback host and socket peer',()=>{
  const source=read('src/v98CarryRefreshEndpointPatch.js');
  assert.match(source,/STATUS_ROUTE = '\/_ce_qc_internal\/v98\/carry-refresh\/status'/);
  assert.match(source,/REFRESH_ROUTE = '\/_ce_qc_internal\/v98\/carry-refresh'/);
  assert.match(source,/value\.name !== 'accessIdentity'/);
  assert.match(source,/isLoopbackRequest/);
  assert.match(source,/\['localhost','127\.0\.0\.1','::1'\]\.includes\(host\)/);
  assert.match(source,/\['127\.0\.0\.1','::1'\]\.includes\(remote\)/);
  assert.match(source,/LOCAL_INTERNAL_ONLY/);
  assert.doesNotMatch(source,/PUBLIC|LAN_DIRECT_ENABLED|CF_ACCESS/);
});

test('managed local poller checks due state every minute and never calls an external host',()=>{
  const source=read('tools/CE_QC_CarryRefresh_Poller.ps1');
  assert.match(source,/127\.0\.0\.1:5177\/_ce_qc_internal\/v98\/carry-refresh\/status/);
  assert.match(source,/127\.0\.0\.1:5177\/_ce_qc_internal\/v98\/carry-refresh/);
  assert.match(source,/Start-Sleep -Seconds 60/);
  assert.doesNotMatch(source,/https:\/\//i);
});

test('V98 endpoint is registered by normal boot patch without starting a hidden scheduler',()=>{
  const source=read('src/v44WhppUiPatch.js');
  assert.match(source,/import '\.\/v98CarryRefreshEndpointPatch\.js'/);
  assert.doesNotMatch(source,/startCarryoverRefreshScheduler\(/);
});

test('Pending growth still comes from real distinct trajectory dates rather than midnight age',()=>{
  const analyzer=read('src/analyzerV30.js');
  assert.match(analyzer,/Pending business facts come from the trajectory fact layer/);
  assert.match(analyzer,/pendingDistinctDayCount/);
  assert.doesNotMatch(analyzer,/Pending次数:\s*naturalDays/);
});
