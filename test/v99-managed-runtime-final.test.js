import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('V99 desktop entry has one managed backend launcher',()=>{
  const source=read('Start_CE_QC.cmd');
  assert.match(source,/CE_QC_Managed_Launcher\.ps1/);
  assert.doesNotMatch(source,/Fast_Start_CE_QC\.ps1/);
  assert.doesNotMatch(source,/start\s+""\s+\/b[\s\S]*CarryRefresh_Poller/i);
});

test('V99 managed launcher verifies candidate and database backup before fast-forward install',()=>{
  const source=read('tools/CE_QC_Managed_Launcher.ps1');
  const candidate=source.indexOf('Test-RemoteCandidate $remote');
  const backup=source.indexOf('CE_QC_PreUpdate_Backup.mjs');
  const install=source.indexOf("@('pull','--ff-only'");
  assert.ok(candidate>=0 && backup>candidate && install>backup);
  assert.match(source,/run','test:golive/);
  assert.match(source,/current known-good version will be kept/);
  assert.match(source,/update cancelled and current version retained/);
});

test('V99 managed launcher ties the backend tree to a close-on-owner Windows job',()=>{
  const source=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.match(source,/JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(source,/AssignProcessToJobObject/);
  assert.match(source,/CloseHandle/);
  assert.match(source,/release port 5177/);
});

test('V99 pre-update database backup is syntax-valid, online, progress-visible and independently verified',()=>{
  const relative='scripts/CE_QC_PreUpdate_Backup.mjs';
  const source=read(relative);
  const syntax=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(source,/import \{ backup, DatabaseSync \} from 'node:sqlite'/);
  assert.match(source,/PRAGMA quick_check\(1\)/);
  assert.match(source,/await backup\(source, copyFile/);
  assert.match(source,/progress:\s*\(\{ totalPages, remainingPages \}\)/);
  assert.match(source,/PRAGMA integrity_check/);
  assert.match(source,/sha256/);
  assert.match(source,/node-sqlite-online-backup/);
  assert.match(source,/pre_update/);
  assert.doesNotMatch(source,/wal_checkpoint\(FULL\)/);
});

test('V99 dynamic carry refresh has no HTTP route and is backend-owned',()=>{
  const relative='src/v98CarryRefreshEndpointPatch.js';
  const source=read(relative);
  const syntax=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(source,/startCarryoverRefreshScheduler/);
  assert.match(source,/express\.application\.listen/);
  assert.doesNotMatch(source,/this\.(?:get|post|put|patch|delete)\(/);
  assert.doesNotMatch(source,/accessIdentity|LOCAL_INTERNAL|carry-refresh\/status/);
});

test('V99 carry scheduler queries OPEN members only and never directly rewrites immutable history tables',()=>{
  const source=read('src/carryoverRefreshScheduler.js');
  assert.match(source,/Asia\/Phnom_Penh/);
  assert.match(source,/minuteOfDay >= 5/);
  assert.match(source,/2 \* 60 \* 60 \* 1000/);
  assert.match(source,/carryover_open_items WHERE status='OPEN'/);
  assert.match(source,/pnhBills:\s*\[\]/);
  assert.match(source,/updateCarryoverResults/);
  for(const table of ['unified_import_rows','shipment_daily_snapshots','final_rows','business_final_rows','unified_snapshots']) {
    assert.doesNotMatch(source,new RegExp(`(?:UPDATE|DELETE\\s+FROM|INSERT\\s+INTO)\\s+${table}`,'i'));
  }
});

test('V99 API refresh failure stays out of successful carry persistence',()=>{
  const source=read('src/carryoverRefreshScheduler.js');
  assert.match(source,/REFRESH_FAILED\|API_PENDING_RETRY\|RETRY/);
  assert.match(source,/successfulRows\.push\(row\)/);
  assert.match(source,/if \(successfulRows\.length\) applySuccessfulCarryRefresh\(successfulRows/);
});

test('V99 Pending count still comes from actual distinct Pending event dates',()=>{
  const source=read('src/analyzerV30.js');
  assert.match(source,/pendingDistinctDayCount/);
  assert.match(source,/Pending business facts come from the trajectory fact layer/);
});
