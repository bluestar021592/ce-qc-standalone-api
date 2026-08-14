import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{
  const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});
  assert.equal(r.status,0,`${p}: ${r.stderr||r.stdout}`);
};

test('managed desktop launcher remains safe and non-destructive',()=>{
  const cmd=read('Start_CE_QC.cmd');
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.match(cmd,/CE_QC_Managed_Launcher\.ps1/);
  assert.match(launcher,/JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(launcher,/CE_QC_PreUpdate_Backup\.mjs/);
  assert.match(launcher,/pull','--ff-only/);
  assert.doesNotMatch(launcher,/reset\s+--hard/i);
});

test('server bootstrap and core runtime files are syntax valid',()=>{
  for(const file of ['bootstrap.js','server.js','src/dataPurge.js','src/v105AsyncPurgePatch.js','src/v84AsyncExportPatch.js','src/v55DashboardReconciliationPatch.js','public/v104-fast-purge-ui.js','public/v105-fast-render.js','public/v103-home-whpp-card-guard.js','public/v65-request-coalescing.js']) syntax(file);
});

test('full purge stays backup first and asynchronous in the browser',()=>{
  const purge=read('src/dataPurge.js');
  const asyncPatch=read('src/v105AsyncPurgePatch.js');
  const ui=read('public/v104-fast-purge-ui.js');
  assert.match(purge,/createVerifiedPreClearBackup/);
  assert.match(purge,/verifyPreparedBackupStillPresent/);
  assert.match(purge,/node-sqlite-online-backup/);
  assert.match(asyncPatch,/setImmediate\(async \(\) =>/);
  assert.match(asyncPatch,/\/api\/v105\/data-purge\/prepare\//);
  assert.match(ui,/安全备份正在后台执行/);
  assert.match(ui,/自动清空业务数据，无需再次点击/);
});

test('page rendering, detail reads and exports keep fast paths',()=>{
  const render=read('public/v105-fast-render.js');
  const detail=read('src/v55DashboardReconciliationPatch.js');
  const exp=read('src/v84AsyncExportPatch.js');
  const req=read('public/v65-request-coalescing.js');
  assert.match(render,/v105VisiblePageRender/);
  assert.match(render,/requestIdleCallback/);
  assert.match(detail,/const rangeCache=new Map\(\)/);
  assert.match(exp,/detached: true/);
  assert.match(exp,/reusableJob/);
  assert.match(req,/const recent = new Map\(\)/);
});

test('WHPP total conservation guard remains enabled',()=>{
  const guard=read('public/v103-home-whpp-card-guard.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(guard,/WHPP本土/);
  assert.match(guard,/const residual=Math\.max\(0,total-sixTotal\)/);
  assert.ok(injector.indexOf('v105-fast-render.js')<injector.indexOf('v103-home-whpp-card-guard.js'));
});
