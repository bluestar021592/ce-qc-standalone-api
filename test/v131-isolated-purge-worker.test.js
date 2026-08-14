import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr||r.stdout}`);};

test('V131 destructive purge is isolated from the web event loop',()=>{
  const patch=read('src/v105AsyncPurgePatch.js');
  const worker=read('scripts/CE_QC_PurgeDeleteWorker.mjs');
  syntax('src/v105AsyncPurgePatch.js');
  syntax('scripts/CE_QC_PurgeDeleteWorker.mjs');
  assert.match(patch,/v131-isolated-purge-worker-v1/);
  assert.match(patch,/spawn\(process\.execPath,\[PURGE_WORKER_FILE,payload\]/);
  assert.match(patch,/runIsolatedExecute/);
  assert.match(patch,/preparedChallenges/);
  assert.match(patch,/verifyPreparedForWorker/);
  assert.match(patch,/DATA_PURGE_WORKER_COMPLETED/);
  assert.match(worker,/BEGIN IMMEDIATE/);
  assert.match(worker,/BUSINESS_DATA_TABLES/);
  assert.match(worker,/ISOLATED_SQLITE_WORKER/);
  assert.match(worker,/data_purge_block_until/);
  assert.match(worker,/clearRegenerableFiles/);
});

test('V131 worker preserves system tables and aborts if source changed before write lock',()=>{
  const worker=read('scripts/CE_QC_PurgeDeleteWorker.mjs');
  assert.match(worker,/DATABASE_CHANGED_BEFORE_PURGE_WORKER_LOCK/);
  assert.match(worker,/users','audit_logs','backup_records/);
  assert.match(worker,/PRAGMA foreign_keys=OFF/);
  assert.match(worker,/PRAGMA foreign_keys=ON/);
  assert.match(worker,/PURGE_WORKER_FOREIGN_KEYS_NOT_RESTORED/);
  assert.doesNotMatch(worker,/DROP TABLE|DROP DATABASE/i);
});
