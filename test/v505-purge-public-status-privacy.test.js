import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { sanitizePurgePublicStatus, V505_PURGE_PUBLIC_STATUS_GUARD_ID } from '../src/v505PurgePublicStatusGuard.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('V505 public purge status is a strict capability-token allowlist with generic errors',()=>{
  const secretPath='D:\\CE CCSL金边数据库\\backups\\pre_clear\\secret.db';
  const raw={
    ok:false,patchId:'internal-patch',recoveryPatch:'recovery',externalActivityGate:'gate',kind:'EXECUTE',
    jobId:'job-1',status:'FAILED',submittedAt:1,startedAt:2,heartbeatAt:3,completedAt:4,failedAt:5,heartbeatStale:true,
    email:'admin@example.test',user:{email:'admin@example.test'},payload:{phrase:'永久清除全部业务数据'},request:{challengeId:'challenge-secret'},
    backup:{path:secretPath},databasePath:'D:\\CE CCSL金边数据库\\ce_qc_monitor.db',challengeId:'challenge-secret',statusToken:'token-secret',statusFile:'C:\\secret\\status.json',
    sourceFingerprint:{db:{size:123}},error:`ENOENT ${secretPath}`,message:`failed at ${secretPath}`
  };
  const clean=sanitizePurgePublicStatus(raw);
  assert.equal(clean.publicStatusGuard,V505_PURGE_PUBLIC_STATUS_GUARD_ID);
  assert.equal(clean.jobId,'job-1');
  assert.equal(clean.status,'FAILED');
  assert.match(clean.error,/详细原因仅通过管理员控制接口提供/);
  const serialized=JSON.stringify(clean);
  for(const forbidden of ['admin@example.test','challenge-secret','token-secret','CE CCSL金边数据库','secret.db','sourceFingerprint','backup','databasePath','statusFile','payload','request']){
    assert.equal(serialized.includes(forbidden),false,`public purge status must not expose ${forbidden}`);
  }
});

test('V505 public status guard is installed before auth/static continuation',()=>{
  const routeOwner=fs.readFileSync(path.join(root,'src','v29EndpointAliasPatch.js'),'utf8');
  const statusAt=routeOwner.indexOf('previousUse.call(this,v505PurgePublicStatusGuard)');
  const authAt=routeOwner.indexOf('const result=previousUse.apply(this,args)');
  assert.ok(statusAt>=0&&authAt>statusAt,'capability status sanitizer must run before accessIdentity and later static middleware');
  assert.match(routeOwner,/V505_PURGE_PUBLIC_STATUS_GUARD_ID/);
});
