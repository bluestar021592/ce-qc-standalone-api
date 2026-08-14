import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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

test('full business-data purge is exclusive with carry refresh and dashboard cache workers',()=>{
  const scheduler=read('src/carryoverRefreshScheduler.js');
  const purge=read('src/dataPurge.js');
  const cacheWorker=read('src/dashboardCacheWorker.js');
  assert.match(scheduler,/data_purge_block_until/);
  assert.match(scheduler,/purgeBlockUntil > Date\.now\(\)/);
  assert.match(purge,/const PURGE_BLOCK_KEY = 'data_purge_block_until'/);
  assert.match(purge,/setPurgeBlock\(db, Date\.now\(\) \+ 20 \* 60_000\)/);
  assert.match(purge,/await waitForBackgroundMaintenanceIdle\(db\)/);
  assert.match(purge,/schedulerStateForTests\(\)\.inFlight/);
  assert.match(purge,/cacheWorkerActive\(db\)/);
  assert.match(purge,/dashboard_cache_worker_active/);
  assert.match(purge,/dashboard_cache_worker_active_until/);
  assert.match(cacheWorker,/BEGIN IMMEDIATE/);
  assert.match(cacheWorker,/data_purge_block_until/);
  assert.match(cacheWorker,/FULL_DATA_PURGE_ACTIVE/);
  assert.match(cacheWorker,/dashboard_cache_worker_active_until/);
  assert.match(purge,/clearBusinessRuntimeMeta\(db\)/);
  assert.match(purge,/key LIKE 'carry_refresh_%' OR key IN/);
});

test('regenerable file cleanup cannot turn a completed database purge into a false failure',()=>{
  const purge=read('src/dataPurge.js');
  assert.match(purge,/const fileCleanupWarnings = clearRegenerableFiles\(\)/);
  assert.match(purge,/catch \(error\) \{ warnings\.push/);
  assert.match(purge,/fileCleanupWarnings/);
});

test('normal schema migration cannot delete business rows or drop tables',()=>{
  const source=read('src/migrations.js');
  assert.doesNotMatch(source,/\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(source,/\bDELETE\s+FROM\b/i);
  const backupAt=source.indexOf('backupDbFile(db, cfg)');
  const beginAt=source.indexOf("db.exec('BEGIN IMMEDIATE')");
  assert.ok(backupAt>=0 && beginAt>backupAt,'business-data migration must back up before transaction');
  assert.match(source,/ROLLBACK/);
});

test('managed launcher never uses PowerShell automatic args variable as an explicit parameter',()=>{
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.doesNotMatch(launcher,/\[string\[\]\]\s*\$Args\b/i);
  assert.doesNotMatch(launcher,/@Args\b/i);
  assert.match(launcher,/\[string\[\]\]\s*\$ArgumentList\b/);
  assert.match(launcher,/\[string\[\]\]\s*\$GitArguments\b/);
  assert.match(launcher,/Update check failed, but startup will continue with the current installed version/);
});

test('managed Windows runtime parses before a desktop candidate can be accepted', { skip: process.platform !== 'win32' }, () => {
  const validator=path.join(root,'tools','CE_QC_Validate_Managed_Runtime.ps1');
  assert.equal(fs.existsSync(validator),true,'managed runtime validator must exist');
  const powershell=path.join(process.env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  assert.equal(fs.existsSync(powershell),true,'Windows PowerShell must exist');
  const result=spawnSync(powershell,['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',validator],{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,`${result.stdout||''}\n${result.stderr||''}`);
  assert.match(result.stdout||'',/MANAGED_RUNTIME_VALIDATION: PASS/);
});
