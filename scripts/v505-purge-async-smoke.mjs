import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const syntaxFiles=[
  'src/dataPurge.js',
  'src/accessControl.js',
  'src/accessControlCore.js',
  'scripts/CE_QC_PurgePrepareTaskWorker.mjs',
  'public/v505-data-purge-recovery.js'
];
for(const relative of syntaxFiles){
  const result=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
  assert.equal(result.status,0,`${relative} syntax check failed: ${result.stderr||result.stdout}`);
}

const purge=read('src/dataPurge.js');
assert.match(purge,/detached\s*:\s*true/);
assert.match(purge,/child\.unref\(\)/);
assert.match(purge,/PURGE_STATUS_PUBLIC_DIR='purge-status'/);
assert.match(purge,/runPurgePreparationWorker/);
assert.match(purge,/PENDING:\$\{String\(job\.jobId/);
assert.match(purge,/crypto\.randomBytes\(24\)\.toString\('hex'\)/);

const worker=read('scripts/CE_QC_PurgePrepareTaskWorker.mjs');
assert.match(worker,/runPurgePreparationWorker/);
assert.match(worker,/delayMs/);

const ui=read('public/v505-data-purge-recovery.js');
assert.match(ui,/pollBackgroundJob/);
assert.match(ui,/credentials:'omit'/);
assert.match(ui,/recoverJobId:job\.jobId/);
assert.match(ui,/后台任务独立执行/);
assert.equal((ui.match(/\/api\/admin\/data-purge\/prepare/g)||[]).length,2,'UI must POST prepare only for initial submission and final challenge recovery');

const access=read('src/accessControl.js');
assert.match(access,/PURGE_STATUS_PATH/);
assert.match(access,/recoverJobId/);
assert.match(access,/PENDING:/);
assert.match(access,/coreAuditAction/);
const core=read('src/accessControlCore.js');
assert.match(core,/export async function accessIdentity/);
assert.match(core,/export function auditAction/);

const loader=read('public/v502-multidrive-backup-ui.js');
assert.match(loader,/v505-data-purge-recovery\.js/);
console.log('[CE-QC][V505_PURGE_ASYNC_SMOKE] pass');
