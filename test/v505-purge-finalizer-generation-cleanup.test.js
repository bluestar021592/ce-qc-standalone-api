import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('V505 core finalizer fails closed on partial marker and cannot delete a newer PREPARE generation',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-finalizer-generation-cleanup-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  process.env.VACUUM_AFTER_PURGE='false';

  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {finalizeCommittedPurge}=await import('../src/dataPurge.js');
  const db=getDb();
  const cfg=getRuntimeConfig();
  const user={email:'finalizer-generation@example.test',username:'finalizer-generation',role:'ADMIN'};
  const oldChallenge='00000000-0000-4000-8000-000000000541';
  const oldExecute='00000000-0000-4000-8000-000000000542';
  const newChallenge='00000000-0000-4000-8000-000000000551';
  const newPrepare='00000000-0000-4000-8000-000000000550';

  try{
    const backupPath=path.join(dir,'old-authoritative-backup.db');
    fs.writeFileSync(backupPath,'old-finalizer-backup-evidence','utf8');
    const backupStat=fs.statSync(backupPath);
    const committedAt='2026-09-12T10:50:00.000Z';
    const receipt={
      version:2,
      challengeId:oldChallenge,
      executeJobId:oldExecute,
      administrator:user.email,
      committedAt,
      recoveryBlockUntil:Date.now()+60*60_000,
      sourceFingerprintMatched:true,
      sourceFingerprintGate:'BEGIN_IMMEDIATE_LOCKED_BEFORE_DELETE',
      backup:{
        filePath:backupPath,
        sha256:'d'.repeat(64),
        size:backupStat.size,
        mtimeMs:backupStat.mtimeMs,
        integrity:'ok',
        method:'test-authoritative-backup'
      },
      before:{},
      after:{}
    };

    const meta=db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    const partial={...receipt,finalizedAt:'2026-09-12T10:51:00.000Z',finalizationState:'BROKEN_PARTIAL_STATE'};
    meta.run('data_purge_last_commit_receipt',JSON.stringify(partial),committedAt);
    meta.run('data_purge_block_until',String(receipt.recoveryBlockUntil),committedAt);
    fs.mkdirSync(cfg.importsDir,{recursive:true});
    const partialSentinel=path.join(cfg.importsDir,'partial-finalization-must-survive.txt');
    fs.writeFileSync(partialSentinel,'must-not-be-cleaned','utf8');

    await assert.rejects(
      ()=>finalizeCommittedPurge({challengeId:oldChallenge,executeJobId:oldExecute,user,recoveredAfterCommit:true}),
      error=>String(error?.code||'')==='V505_PURGE_COMMIT_RECEIPT_INVALID'
    );
    assert.equal(fs.existsSync(partialSentinel),true,'core finalizer must reject a partial finalization marker before any regenerable file cleanup');
    assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0),receipt.recoveryBlockUntil,'partial marker must not release the existing safety block');

    meta.run('data_purge_last_commit_receipt',JSON.stringify(receipt),committedAt);
    meta.run('data_purge_block_until',String(receipt.recoveryBlockUntil),committedAt);

    // Simulate a later PREPARE generation appearing at the old finalizer's
    // filesystem cleanup boundary. The old finalizer may only retire artifacts
    // that still belong to oldChallenge.
    const key=crypto.createHash('sha256').update(user.email.toLowerCase()).digest('hex').slice(0,24);
    const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
    fs.mkdirSync(prepareDir,{recursive:true});
    const prepareFile=path.join(prepareDir,`${key}.job.json`);
    const challengeFile=path.join(prepareDir,`${key}.challenge.json`);
    const statusToken='e'.repeat(48);
    const statusFile=path.join(cfg.projectRoot,'public','purge-status',`${statusToken}.json`);
    fs.mkdirSync(path.dirname(statusFile),{recursive:true});
    const expiresAt=Date.now()+10*60_000;
    fs.writeFileSync(prepareFile,JSON.stringify({
      patchId:'newer-prepare-during-old-finalizer-tail',kind:'PREPARE',jobId:newPrepare,status:'SUCCEEDED',email:user.email,
      statusToken,statusFile,submittedAt:Date.now()-20_000,completedAt:Date.now()-10_000,
      payload:{challengeId:newChallenge,expiresAt:new Date(expiresAt).toISOString()}
    },null,2),'utf8');
    fs.writeFileSync(challengeFile,JSON.stringify({
      challengeId:newChallenge,
      challenge:{email:user.email,createdAt:Date.now()-20_000,expiresAt},
      payload:{challengeId:newChallenge,expiresAt:new Date(expiresAt).toISOString()}
    },null,2),'utf8');
    fs.writeFileSync(statusFile,JSON.stringify({ok:true,jobId:newPrepare,status:'SUCCEEDED'}),'utf8');

    const result=await finalizeCommittedPurge({
      challengeId:oldChallenge,
      executeJobId:oldExecute,
      user,
      recoveredAfterCommit:true
    });

    assert.equal(result.challengeId,oldChallenge);
    assert.equal(result.executeJobId,oldExecute);
    assert.ok(result.finalizedAt,'old receipt must still finish durable finalization');
    assert.equal(result.recoveredAfterFinalize,false);
    assert.equal(fs.existsSync(prepareFile),true,'old finalizer must preserve the newer PREPARE sidecar');
    assert.equal(fs.existsSync(challengeFile),true,'old finalizer must preserve the newer persisted challenge');
    assert.equal(fs.existsSync(statusFile),true,'old finalizer must preserve the newer PREPARE public status token');
    assert.equal(JSON.parse(fs.readFileSync(prepareFile,'utf8')).payload.challengeId,newChallenge);
    assert.equal(JSON.parse(fs.readFileSync(challengeFile,'utf8')).challengeId,newChallenge);

    const durable=JSON.parse(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_last_commit_receipt'").get().value);
    assert.equal(durable.challengeId,oldChallenge);
    assert.equal(durable.executeJobId,oldExecute);
    assert.equal(durable.finalizationState,'SAFE_POSTCHECK_PASSED');
    assert.ok(durable.finalizedAt);
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get(),undefined,'old finalization must still atomically release its SQLite safety block');
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
