import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('V505 finalized receipt is terminal across admins and purge generations without deleting newer PREPARE evidence',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-finalized-cross-generation-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';

  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {inspectExternalPurgeWriteFreeze}=await import('../src/v505PurgeWriteFreezeGuard.js');
  const {inspectGlobalPurgeOwnership}=await import('../src/v505PurgeGlobalGuard.js');
  const {inspectExecutionRecovery}=await import('../src/v505PurgeCoordinator.js');
  const {inspectPurgeExecuteAdmission}=await import('../src/v505PurgeExecuteAdmissionGuard.js');

  const db=getDb();
  const cfg=getRuntimeConfig();
  const adminA={email:'finalized-old-owner@example.test',username:'finalized-old-owner',role:'ADMIN'};
  const adminB={email:'next-admin@example.test',username:'next-admin',role:'ADMIN'};
  const oldChallenge='00000000-0000-4000-8000-000000000521';
  const oldExecute='00000000-0000-4000-8000-000000000522';
  const oldPrepare='00000000-0000-4000-8000-000000000520';
  const newChallenge='00000000-0000-4000-8000-000000000531';
  const newPrepare='00000000-0000-4000-8000-000000000530';
  const finalizedAt='2026-09-12T10:40:00.000Z';

  const identityKey=user=>crypto.createHash('sha256').update(String(user.email).toLowerCase()).digest('hex').slice(0,24);
  const executeDir=path.join(cfg.backupsDir,'.purge_execute_jobs');
  const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
  fs.mkdirSync(executeDir,{recursive:true});
  fs.mkdirSync(prepareDir,{recursive:true});
  const aKey=identityKey(adminA);
  const oldExecuteFile=path.join(executeDir,`${aKey}.job.json`);
  const prepareFile=path.join(prepareDir,`${aKey}.job.json`);
  const challengeFile=path.join(prepareDir,`${aKey}.challenge.json`);
  const oldStatusToken='c'.repeat(48);
  const oldStatusFile=path.join(cfg.projectRoot,'public','purge-status',`${oldStatusToken}.json`);
  fs.mkdirSync(path.dirname(oldStatusFile),{recursive:true});

  try{
    const receipt={
      version:2,
      challengeId:oldChallenge,
      executeJobId:oldExecute,
      administrator:adminA.email,
      committedAt:'2026-09-12T10:39:00.000Z',
      finalizedAt,
      finalizationState:'SAFE_POSTCHECK_PASSED',
      fileCleanupWarnings:['historical warning must remain durable'],
      recoveryBlockUntil:Date.now()-60_000,
      sourceFingerprintMatched:true,
      sourceFingerprintGate:'BEGIN_IMMEDIATE_LOCKED_BEFORE_DELETE',
      backup:{filePath:path.join(dir,'historical-backup.db'),sha256:'a'.repeat(64),size:1,mtimeMs:1,integrity:'ok',method:'test'},
      before:{daily_reports:1},
      after:{daily_reports:0}
    };

    // A timestamp that looks finalized is not sufficient by itself. If the
    // atomic finalization marker is partial/corrupt, both guards must fail
    // closed even when every filesystem sidecar is absent.
    const partialFinalization={...receipt,finalizationState:'BROKEN_PARTIAL_STATE'};
    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_last_commit_receipt',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(JSON.stringify(partialFinalization),finalizedAt);
    db.prepare("DELETE FROM app_meta WHERE key='data_purge_block_until'").run();
    const malformedFreeze=inspectExternalPurgeWriteFreeze();
    assert.equal(malformedFreeze.active,true,'partial finalized receipt must keep normal writes frozen');
    assert.equal(malformedFreeze.workerState,'COMMIT_RECEIPT_UNREADABLE');
    const malformedOwnership=inspectGlobalPurgeOwnership(adminB);
    assert.equal(malformedOwnership.commitReceiptUnreadable,true,'partial finalized receipt must block new purge ownership as unknown committed state');

    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_last_commit_receipt',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(JSON.stringify(receipt),finalizedAt);
    db.prepare("DELETE FROM app_meta WHERE key='data_purge_block_until'").run();

    // A finalized receipt releases the SQLite block, but the original worker may
    // still be alive for a very short filesystem cleanup tail. That live worker
    // remains the owner until it exits so a new PREPARE cannot replace files the
    // old worker is still challenge-bound to inspect/remove.
    fs.writeFileSync(oldExecuteFile,JSON.stringify({
      patchId:'live-finalized-execute-tail',kind:'EXECUTE',jobId:oldExecute,challengeId:oldChallenge,status:'COMMITTED',
      submittedAt:Date.now()-180_000,startedAt:Date.now()-170_000,heartbeatAt:Date.now(),updatedAt:Date.now(),
      workerPid:process.pid,user:adminA,request:{challengeId:oldChallenge,phrase:'永久清除全部业务数据',backupConfirmed:true}
    },null,2),'utf8');
    const liveTailFreeze=inspectExternalPurgeWriteFreeze();
    assert.equal(liveTailFreeze.active,true,'a still-live finalized worker must hold the short cleanup tail against next-generation writes');
    assert.equal(liveTailFreeze.workerState,'FINALIZER_TAIL_ACTIVE');
    const liveTailOwnership=inspectGlobalPurgeOwnership(adminB);
    assert.equal(liveTailOwnership.foreign?.workerState,'FINALIZER_TAIL_ACTIVE','another admin must wait until the live finalized worker exits its cleanup tail');
    const liveTailRecovery=inspectExecutionRecovery(adminA);
    assert.equal(liveTailRecovery?.status,'COMMITTED');
    assert.equal(liveTailRecovery?.workerState,'FINALIZER_TAIL_ACTIVE','the web process must not rewrite a still-live finalizer sidecar to SUCCEEDED');

    fs.writeFileSync(oldExecuteFile,JSON.stringify({
      patchId:'stale-finalized-execute',kind:'EXECUTE',jobId:oldExecute,challengeId:oldChallenge,status:'COMMITTED',
      submittedAt:Date.now()-180_000,startedAt:Date.now()-170_000,heartbeatAt:Date.now()-160_000,updatedAt:Date.now()-160_000,
      workerPid:0,user:adminA,request:{challengeId:oldChallenge,phrase:'永久清除全部业务数据',backupConfirmed:true}
    },null,2),'utf8');
    fs.writeFileSync(prepareFile,JSON.stringify({
      patchId:'stale-finalized-prepare',kind:'PREPARE',jobId:oldPrepare,status:'SUCCEEDED',email:adminA.email,
      statusToken:oldStatusToken,statusFile:oldStatusFile,submittedAt:Date.now()-240_000,completedAt:Date.now()-190_000,
      payload:{challengeId:oldChallenge,expiresAt:new Date(Date.now()+8*60_000).toISOString()}
    },null,2),'utf8');
    fs.writeFileSync(challengeFile,JSON.stringify({challengeId:oldChallenge,challenge:{expiresAt:Date.now()+8*60_000}},null,2),'utf8');
    fs.writeFileSync(oldStatusFile,JSON.stringify({ok:true,jobId:oldPrepare,status:'SUCCEEDED'}),'utf8');

    const freeze=inspectExternalPurgeWriteFreeze();
    assert.equal(freeze.active,false,'an exact finalized receipt must make dead/stale execute/PREPARE sidecars historical rather than re-freezing normal writes');

    const otherAdminOwnership=inspectGlobalPurgeOwnership(adminB);
    assert.equal(otherAdminOwnership.foreign,null,'another admin must not be blocked forever by dead/stale sidecars from a purge already durably finalized');
    assert.equal(otherAdminOwnership.orphanedLock,false);
    assert.equal(otherAdminOwnership.commitReceiptPending,false);

    const recovered=inspectExecutionRecovery(adminA);
    assert.equal(recovered?.status,'SUCCEEDED','the original admin must still receive one durable terminal recovery result for the finalized purge');
    assert.equal(recovered?.workerState,'FINALIZED_RECEIPT');
    assert.equal(fs.existsSync(prepareFile),false,'matching historical PREPARE sidecar should be retired during finalized recovery');
    assert.equal(fs.existsSync(challengeFile),false,'matching historical challenge should be retired during finalized recovery');
    assert.equal(fs.existsSync(oldStatusFile),false,'matching historical PREPARE public status should be retired during finalized recovery');

    const secondRecovery=inspectExecutionRecovery(adminA);
    assert.equal(secondRecovery,null,'after terminal recovery has been delivered once, the stale execute sidecar must stop hijacking later PREPARE requests');
    assert.equal(fs.existsSync(oldExecuteFile),false,'terminal finalized execute sidecar should be retired before a later purge generation begins');

    // Recreate only the old finalized execute debris, then seed a newer PREPARE
    // generation for the same administrator. Recovery of the old receipt must
    // never delete or replace the newer PREPARE evidence.
    fs.writeFileSync(oldExecuteFile,JSON.stringify({
      patchId:'stale-finalized-execute-again',kind:'EXECUTE',jobId:oldExecute,challengeId:oldChallenge,status:'COMMITTED',
      submittedAt:Date.now()-120_000,startedAt:Date.now()-110_000,heartbeatAt:Date.now()-100_000,updatedAt:Date.now()-100_000,
      workerPid:0,user:adminA,request:{challengeId:oldChallenge,phrase:'永久清除全部业务数据',backupConfirmed:true}
    },null,2),'utf8');

    const futureIso=new Date(Date.now()+10*60_000).toISOString();
    const fakeBackup=path.join(dir,'new-generation-backup.db');
    const fakeManifest=path.join(dir,'new-generation-backup.manifest.json');
    fs.writeFileSync(fakeBackup,'new-generation-backup','utf8');
    const fakeBackupStat=fs.statSync(fakeBackup);
    fs.writeFileSync(fakeManifest,JSON.stringify({databasePath:cfg.dbFile}),'utf8');
    fs.writeFileSync(prepareFile,JSON.stringify({
      patchId:'new-prepare-generation',kind:'PREPARE',jobId:newPrepare,status:'SUCCEEDED',email:adminA.email,
      submittedAt:Date.now()-20_000,completedAt:Date.now()-10_000,
      payload:{challengeId:newChallenge,expiresAt:futureIso,databasePath:cfg.dbFile}
    },null,2),'utf8');
    fs.writeFileSync(challengeFile,JSON.stringify({
      challengeId:newChallenge,
      challenge:{
        email:adminA.email,createdAt:Date.now()-20_000,expiresAt:Date.now()+10*60_000,
        backup:{filePath:fakeBackup,sha256:'b'.repeat(64),size:fakeBackupStat.size,mtimeMs:fakeBackupStat.mtimeMs,integrity:'ok',method:'test',manifestPath:fakeManifest},
        sourceFingerprint:{db:{exists:true,size:1,mtimeMs:1},wal:{exists:false,size:0,mtimeMs:0}}
      },
      payload:{challengeId:newChallenge,expiresAt:futureIso,databasePath:cfg.dbFile}
    },null,2),'utf8');

    const oldRecoveryBesideNewPrepare=inspectExecutionRecovery(adminA);
    assert.equal(oldRecoveryBesideNewPrepare,null,'historical finalized recovery must not replace the response for a newer PREPARE generation');
    assert.equal(fs.existsSync(prepareFile),true,'historical finalized recovery must preserve the newer PREPARE sidecar');
    assert.equal(fs.existsSync(challengeFile),true,'historical finalized recovery must preserve the newer persisted challenge');
    assert.equal(JSON.parse(fs.readFileSync(prepareFile,'utf8')).payload.challengeId,newChallenge);
    assert.equal(JSON.parse(fs.readFileSync(challengeFile,'utf8')).challengeId,newChallenge);

    const admission=inspectPurgeExecuteAdmission(adminA,{challengeId:newChallenge});
    assert.equal(admission.ok,true,'a newer verified PREPARE must remain executable even when historical finalized receipt data still exists');
    assert.equal(admission.recovery,false);
    assert.equal(admission.challengeId,newChallenge);
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
