import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('managed bootstrap installs purge reseal patch before server registers purge routes',()=>{
  const bootstrap=read('bootstrap.js');
  const v44=bootstrap.indexOf("importPhase('v44WhppUiPatch'");
  const server=bootstrap.indexOf("importPhase('server', './server.js')");
  assert.ok(v44>=0&&server>v44,'v44/v105 purge patch must load before server route registration');
});

test('prepare route audit is resealed only after verified backup response completes',()=>{
  const server=read('server.js');
  const create=server.indexOf('const challenge = await createPurgeChallenge');
  const audit=server.indexOf("auditAction(req, 'DATA_PURGE_BACKUP_VERIFIED'",create);
  const response=server.indexOf('res.json({ ok: true, ...challenge',audit);
  assert.ok(create>=0&&audit>create&&response>audit,'verified-backup audit must remain between challenge creation and response');

  const patch=read('src/v105AsyncPurgePatch.js');
  assert.match(patch,/v124-post-audit-purge-seal-v1/);
  assert.match(patch,/const result = await runLegacyHandler\(legacyHandler, req\)/);
  assert.match(patch,/kind === 'PREPARE' && result\?\.challengeId\) resealPurgeChallenge\(result\.challengeId, req\.user\)/);
});

test('backup guard covers backup and SHA verification windows before audit reseal',()=>{
  const purge=read('src/dataPurge.js');
  assert.match(purge,/sourceFingerprintBeforeBackup/);
  assert.match(purge,/sourceFingerprintAfterBackup/);
  assert.match(purge,/sourceFingerprintAfterVerification/);
  assert.match(purge,/数据库在安全备份期间发生变化，已停止清除/);
  assert.match(purge,/数据库在备份校验期间发生变化，已停止清除/);
  assert.match(purge,/export function resealPurgeChallenge/);
  assert.match(purge,/sourceSeal='POST_PREPARE_AUDIT'/);
  assert.match(purge,/数据库在安全备份后发生变化，已停止清除/);
});
