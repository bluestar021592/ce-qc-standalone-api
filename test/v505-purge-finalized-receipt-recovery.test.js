import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('V505 finalized durable receipt repairs stale COMMITTED sidecar without rerunning cleanup or touching new data',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-finalized-receipt-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {inspectExecutionRecovery}=await import('../src/v505PurgeCoordinator.js');
  const db=getDb();
  const cfg=getRuntimeConfig();
  const user={email:'finalized-receipt-recovery@example.test',username:'finalized-receipt-recovery',role:'ADMIN'};
  const challengeId='00000000-0000-4000-8000-000000000511';
  const executeJobId='00000000-0000-4000-8000-000000000512';
  const committedAt='2026-09-12T10:00:00.000Z';
  const finalizedAt='2026-09-12T10:01:00.000Z';
  try{
    // This row and these files represent legitimate activity created after the
    // prior purge was already durably finalized and its safety block released.
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-12');
    fs.mkdirSync(cfg.importsDir,{recursive:true});
    fs.mkdirSync(cfg.exportsDir,{recursive:true});
    const importSentinel=path.join(cfg.importsDir,'post-finalize-import-sentinel.txt');
    const exportSentinel=path.join(cfg.exportsDir,'post-finalize-export-sentinel.txt');
    fs.writeFileSync(importSentinel,'must-survive-finalized-receipt-recovery','utf8');
    fs.writeFileSync(exportSentinel,'must-survive-finalized-receipt-recovery','utf8');

    const receipt={
      version:2,
      challengeId,
      executeJobId,
      administrator:user.email,
      committedAt,
      finalizedAt,
      finalizationState:'SAFE_POSTCHECK_PASSED',
      recoveryBlockUntil:Date.now()-60_000,
      sourceFingerprintMatched:true,
      sourceFingerprintGate:'BEGIN_IMMEDIATE_LOCKED_BEFORE_DELETE',
      backup:{filePath:path.join(dir,'already-finalized-backup.db'),sha256:'a'.repeat(64),size:1,mtimeMs:1,integrity:'ok',method:'test'},
      before:{daily_reports:1},
      after:{daily_reports:0}
    };
    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_last_commit_receipt',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(JSON.stringify(receipt),finalizedAt);
    db.prepare("DELETE FROM app_meta WHERE key='data_purge_block_until'").run();

    const key=crypto.createHash('sha256').update(user.email.toLowerCase()).digest('hex').slice(0,24);
    const executeDir=path.join(cfg.backupsDir,'.purge_execute_jobs');
    const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
    fs.mkdirSync(executeDir,{recursive:true});
    fs.mkdirSync(prepareDir,{recursive:true});
    const jobFile=path.join(executeDir,`${key}.job.json`);
    const prepareJobFile=path.join(prepareDir,`${key}.job.json`);
    const challengeFile=path.join(prepareDir,`${key}.challenge.json`);
    const prepareStatusToken='b'.repeat(48);
    const prepareStatusFile=path.join(cfg.projectRoot,'public','purge-status',`${prepareStatusToken}.json`);
    fs.mkdirSync(path.dirname(prepareStatusFile),{recursive:true});

    fs.writeFileSync(prepareJobFile,JSON.stringify({
      patchId:'stale-prepare-after-finalize',kind:'PREPARE',jobId:'00000000-0000-4000-8000-000000000510',
      status:'SUCCEEDED',email:user.email,statusToken:prepareStatusToken,statusFile:prepareStatusFile,
      submittedAt:Date.now()-180_000,completedAt:Date.now()-120_000,heartbeatAt:Date.now()-120_000,
      payload:{challengeId,expiresAt:new Date(Date.now()+10*60_000).toISOString()}
    },null,2),'utf8');
    fs.writeFileSync(challengeFile,JSON.stringify({challengeId,challenge:{expiresAt:Date.now()+10*60_000}},null,2),'utf8');
    fs.writeFileSync(prepareStatusFile,JSON.stringify({ok:true,jobId:'00000000-0000-4000-8000-000000000510',status:'SUCCEEDED'}),'utf8');

    // The finalized receipt is terminal authority only after the original
    // worker is no longer live. A live worker retains the short cleanup-tail
    // ownership so a next purge generation cannot race its filesystem cleanup.
    fs.writeFileSync(jobFile,JSON.stringify({
      patchId:'stale-sidecar-after-finalize',kind:'EXECUTE',jobId:executeJobId,challengeId,
      status:'COMMITTED',submittedAt:Date.now()-120_000,startedAt:Date.now()-110_000,
      heartbeatAt:Date.now()-100_000,updatedAt:Date.now()-100_000,workerPid:0,
      error:'',message:'stale committed sidecar after finalized receipt',
      user,request:{challengeId,phrase:'永久清除全部业务数据',backupConfirmed:true}
    },null,2),'utf8');

    const recovered=inspectExecutionRecovery(user);
    assert.equal(recovered?.status,'SUCCEEDED','finalized durable receipt must be authoritative over a stale COMMITTED sidecar once its worker is no longer live');
    assert.equal(recovered?.completed,true);
    assert.equal(recovered?.workerState,'FINALIZED_RECEIPT');
    assert.equal(recovered?.result?.recoveredAfterFinalize,true);
    assert.equal(recovered?.result?.finalizedAt,finalizedAt);

    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,1,'recovery after finalized receipt must never rerun post-COMMIT business-state checks against legitimate new data');
    assert.equal(fs.existsSync(importSentinel),true,'recovery after finalized receipt must not delete new import files');
    assert.equal(fs.existsSync(exportSentinel),true,'recovery after finalized receipt must not delete new export files');
    assert.equal(fs.existsSync(prepareJobFile),false,'finalized receipt recovery must retire the stale PREPARE sidecar so normal writes do not stay frozen');
    assert.equal(fs.existsSync(challengeFile),false,'finalized receipt recovery must retire the stale persisted PREPARE challenge');
    assert.equal(fs.existsSync(prepareStatusFile),false,'finalized receipt recovery must retire the stale PREPARE public status token');
    const persisted=JSON.parse(fs.readFileSync(jobFile,'utf8'));
    assert.equal(persisted.status,'SUCCEEDED','stale execute sidecar must be repaired from the finalized SQLite receipt');
    assert.equal(persisted.result?.recoveredAfterFinalize,true);

    const {inspectExternalPurgeWriteFreeze}=await import('../src/v505PurgeWriteFreezeGuard.js');
    assert.equal(inspectExternalPurgeWriteFreeze().active,false,'finalized receipt recovery must fully release stale filesystem write-freeze ownership');
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
