import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('V505 exact commit receipt recovers a crash after DELETE commit without executing destructive deletion twice',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-postcommit-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  process.env.PURGE_PREPARE_START_DELAY_MS='750';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {createPurgeChallenge,executePurge,finalizeCommittedPurge,readPurgeCommitReceipt,PURGE_PHRASE}=await import('../src/dataPurge.js');
  const db=getDb();
  const user={email:'postcommit-recovery@example.test',role:'ADMIN'};
  const executeJobId='00000000-0000-4000-8000-000000000505';
  let statusFile='';
  try{
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-11');
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,fileHash,status,summaryJson,warningsJson,createdAt)
      VALUES('postcommit-batch','postcommit-snapshot','2026-09-11','hash','IMPORTED','{}','[]','2026-09-11T00:00:00Z')`).run();

    const queued=await createPurgeChallenge(user,{activeRunIds:new Set()});
    assert.ok(['QUEUED','RUNNING'].includes(String(queued.status||'').toUpperCase()));
    statusFile=path.join(getRuntimeConfig().projectRoot,'public',String(queued.statusUrl||'').replace(/^\//,''));
    let status=null;
    // Local managed-updater validation can run on slower Windows disks / antivirus-heavy hosts.
    // Keep the same fail-closed assertion, but allow the detached PREPARE worker enough time
    // to finish instead of rejecting an otherwise valid candidate at an arbitrary 30s wall.
    const deadline=Date.now()+90_000;
    while(Date.now()<deadline){
      try{status=JSON.parse(fs.readFileSync(statusFile,'utf8'));}catch{}
      if(['SUCCEEDED','FAILED'].includes(String(status?.status||'').toUpperCase()))break;
      await wait(100);
    }
    assert.equal(status?.status,'SUCCEEDED',status?.error||`prepare worker did not finish within 90s (last=${String(status?.status||'UNKNOWN')})`);
    const challenge=await createPurgeChallenge(user,{activeRunIds:new Set()});
    assert.equal(challenge.status,'SUCCEEDED');
    const waitMs=Math.max(0,new Date(challenge.notBefore).getTime()-Date.now());
    if(waitMs)await wait(waitMs+50);

    await assert.rejects(
      executePurge({
        challengeId:challenge.challengeId,
        phrase:PURGE_PHRASE,
        backupConfirmed:true,
        user,
        executeJobId,
        onCommitted:()=>{throw new Error('SIMULATED_CRASH_AFTER_COMMIT');}
      }),
      /SIMULATED_CRASH_AFTER_COMMIT/
    );

    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,0,'business rows must already be gone because the SQLite transaction committed before the simulated crash');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM unified_import_batches').get().count,0);
    const receipt=readPurgeCommitReceipt({challengeId:challenge.challengeId,executeJobId});
    assert.ok(receipt,'exact challenge + execute job receipt must survive the crash window');
    assert.equal(receipt.version,2);
    assert.equal(receipt.challengeId,challenge.challengeId);
    assert.equal(receipt.executeJobId,executeJobId);
    assert.equal(String(receipt.finalizedAt||''),'','destructive COMMIT receipt must remain explicitly unfinalized until post-commit invariants pass');
    assert.ok(Number(receipt.before?.daily_reports||0)>=1);
    assert.equal(Number(receipt.after?.daily_reports||0),0);
    assert.match(String(receipt.backup?.sha256||''),/^[a-f0-9]{64}$/i);
    assert.ok(Number(receipt.recoveryBlockUntil||0)>Date.now()+55*60_000,'post-commit receipt must atomically extend the background-worker safety block for at least one hour');
    const safetyBlock=Number(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0);
    assert.equal(safetyBlock,Number(receipt.recoveryBlockUntil),'post-commit crash must retain the exact safety-block deadline recorded in the same commit receipt');

    // A writer outside the protected application is simulated after COMMIT. The
    // recovery path must never solve this by running DELETE again. Instead it
    // keeps the durable receipt unfinalized and the safety block intact.
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-12');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,1,'new data created after the committed delete is a sentinel against any second DELETE during recovery');
    await assert.rejects(
      finalizeCommittedPurge({challengeId:challenge.challengeId,executeJobId,user,recoveredAfterCommit:true}),
      error=>String(error?.code||'')==='V505_PURGE_POST_COMMIT_FINALIZE_BLOCKED'&&/提交后业务数据状态发生变化/.test(String(error?.message||''))
    );
    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,1,'unsafe recovery must preserve newly appeared data instead of deleting it again');
    assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0),Number(receipt.recoveryBlockUntil),'post-commit invariant failure must keep the long safety block');
    assert.equal(String(readPurgeCommitReceipt({challengeId:challenge.challengeId,executeJobId})?.finalizedAt||''),'','failed post-commit invariant must not write a false finalized marker');

    // Simulate explicit/manual resolution of the unexpected new row. Recovery
    // can then finalize metadata and release the lock, still without rerunning the
    // original destructive transaction.
    db.prepare('DELETE FROM daily_reports WHERE reportDate=?').run('2026-09-12');
    const recovered=await finalizeCommittedPurge({challengeId:challenge.challengeId,executeJobId,user,recoveredAfterCommit:true});
    assert.equal(recovered.committedReceipt,true);
    assert.equal(recovered.recoveredAfterCommit,true);
    assert.equal(recovered.executeJobId,executeJobId);
    assert.equal(recovered.challengeId,challenge.challengeId);
    assert.equal(recovered.recoveryBlockUntil,Number(receipt.recoveryBlockUntil));
    assert.match(String(recovered.finalizedAt||''),/^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Number(recovered.before?.daily_reports||0)>=1,'recovered result must come from the durable commit receipt, not a second DELETE');
    assert.equal(Number(recovered.after?.daily_reports||0),0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,0,'post-commit recovery must not execute business DELETE again');
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get(),undefined,'successful post-commit finalization must atomically release the safety block');
    const finalizedReceipt=readPurgeCommitReceipt({challengeId:challenge.challengeId,executeJobId});
    assert.equal(finalizedReceipt?.finalizationState,'SAFE_POSTCHECK_PASSED');
    assert.equal(finalizedReceipt?.finalizedAt,recovered.finalizedAt,'receipt finalization marker and released block must come from the same finalization transaction');
    assert.ok(db.prepare("SELECT COUNT(*) count FROM backup_records WHERE filePath=? AND fileHash=? AND reason='before-full-clear'").get(receipt.backup.filePath,receipt.backup.sha256).count>=1,'pre-clear backup DB catalog record is deferred until safe post-commit finalization so it cannot alter the backup-bound source fingerprint');
  }finally{
    try{closeDb();}catch{}
    if(statusFile){try{fs.rmSync(statusFile,{force:true});}catch{}}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('V505 coordinator never marks post-commit structural verification warnings as SUCCEEDED',()=>{
  const coordinator=fs.readFileSync(new URL('../src/v505PurgeCoordinator.js',import.meta.url),'utf8');
  const structuralCheckAt=coordinator.indexOf('const structuralWarning=postCommitStructuralWarning(result)');
  const successAt=coordinator.indexOf("status:'SUCCEEDED'",structuralCheckAt);
  assert.ok(structuralCheckAt>=0&&successAt>structuralCheckAt,'structural verification must be evaluated before any SUCCEEDED sidecar write');
  assert.match(coordinator,/V505_PURGE_POST_COMMIT_STRUCTURE_UNSAFE/);
  assert.match(coordinator,/status:'COMMITTED'[\s\S]*?数据库结构校验未通过/,'post-commit structural failures must remain COMMITTED so the web DB stays read-only');
  assert.match(coordinator,/绝不会再次删除业务数据/,'structural recovery must never rerun destructive DELETE');
});
