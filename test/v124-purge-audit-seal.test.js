import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('managed bootstrap installs purge patch before server registers purge routes',()=>{
  const bootstrap=read('bootstrap.js');
  const v44=bootstrap.indexOf("importPhase('v44WhppUiPatch'");
  const server=bootstrap.indexOf('importServerInteractiveFirst()');
  assert.ok(v44>=0&&server>v44,'v44/v105 purge patch must load before server route registration');
});

test('prepare route audit is sealed before V131 stores worker challenge fingerprint',()=>{
  const server=read('server.js');
  const create=server.indexOf('const challenge = await createPurgeChallenge');
  const audit=server.indexOf("auditAction(req, 'DATA_PURGE_BACKUP_VERIFIED'",create);
  const response=server.indexOf('res.json({ ok: true, ...challenge',audit);
  assert.ok(create>=0&&audit>create&&response>audit,'verified-backup audit must remain between challenge creation and response');

  const patch=read('src/v105AsyncPurgePatch.js');
  assert.match(patch,/v131-isolated-purge-worker-v1/);
  assert.match(patch,/result=await runLegacyHandler\(legacyHandler,req\)/);
  assert.match(patch,/resealPurgeChallenge\(result\.challengeId,req\.user\);rememberPreparedChallenge\(result,req\)/);
  assert.match(patch,/sourceFingerprint:databaseFingerprint\(dbFile\)/);
  assert.match(patch,/verifyPreparedForWorker/);
});

test('backup guard still covers backup and SHA verification windows before worker eligibility',()=>{
  const purge=read('src/dataPurge.js');
  const patch=read('src/v105AsyncPurgePatch.js');
  assert.match(purge,/sourceFingerprintBeforeBackup/);
  assert.match(purge,/sourceFingerprintAfterBackup/);
  assert.match(purge,/sourceFingerprintAfterVerification/);
  assert.match(purge,/数据库在安全备份期间发生变化，已停止清除/);
  assert.match(purge,/数据库在备份校验期间发生变化，已停止清除/);
  assert.match(purge,/export function resealPurgeChallenge/);
  assert.match(purge,/sourceSeal='POST_PREPARE_AUDIT'/);
  assert.match(patch,/清空前安全备份不存在，已停止清除/);
  assert.match(patch,/数据库在安全备份后发生变化，已停止清除/);
  assert.match(patch,/DATABASE_CHANGED_BEFORE_PURGE_WORKER_LOCK/);
});
