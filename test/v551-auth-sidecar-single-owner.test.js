import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const wrapperFile=path.join(root,'src','v193ExportSidecar.js');
const guardFile=path.join(root,'src','v551AuthSidecarOwnershipGuard.js');
const accessFile=path.join(root,'src','accessControl.js');
const sidecarFile=path.join(root,'src','v473ExportSidecar.js');
const read=file=>fs.readFileSync(file,'utf8');

test('V551 ownership guard sources remain syntax-valid',()=>{
  for(const file of [wrapperFile,guardFile]){
    const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    assert.equal(check.status,0,check.stderr||check.stdout);
  }
});

test('V551 marks the 5178 export process before V473 can import accessControl',()=>{
  const wrapper=read(wrapperFile);
  const guardAt=wrapper.indexOf("import './v551AuthSidecarOwnershipGuard.js'");
  const admissionAt=wrapper.indexOf("import './v505ExportAdmissionGuard.js'");
  const v473At=wrapper.indexOf("import './v473ExportSidecar.js'");
  assert.ok(guardAt>=0,'V551 guard import must be present');
  assert.ok(admissionAt>guardAt,'V551 guard must evaluate before V505 export admission imports');
  assert.ok(v473At>admissionAt,'V505 admission must still install before V473 authority');
});

test('V551 suppresses only local-auth child spawning while preserving export authentication',()=>{
  const guard=read(guardFile);
  const access=read(accessFile);
  const sidecar=read(sidecarFile);
  assert.match(guard,/2026-09-16-v551-export-child-no-auth-sidecar-v1/);
  assert.match(guard,/process\.env\.CE_QC_LOCAL_AUTH_CHILD='1'/);
  assert.match(guard,/\[CE-QC\]\[V551_AUTH_SINGLE_OWNER_GUARD\]/);
  assert.match(access,/String\(process\.env\.CE_QC_LOCAL_AUTH_CHILD \|\| ''\) === '1'[\s\S]{0,160}?return/,'accessControl must keep its no-spawn guard');
  assert.match(sidecar,/import \{ accessIdentity, requireRole \} from '\.\/accessControl\.js'/,'5178 still authenticates requests through accessControl');
  assert.match(sidecar,/env:\{\.\.\.process\.env,CE_QC_EXPORT_WORKER_MODE:/,'export workers must inherit the V551 no-spawn environment');
});
