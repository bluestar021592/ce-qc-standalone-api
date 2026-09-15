import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function responseHarness(){
  const res=new EventEmitter();
  res.statusCode=200;res.body=null;
  res.status=function(code){this.statusCode=code;return this;};
  res.json=function json(body){this.body=body;return this;};
  return res;
}
function request(method,pathValue){return {method,path:pathValue,originalUrl:pathValue,url:pathValue};}
function identityFile(dir,label){
  const key=crypto.createHash('sha256').update(label).digest('hex').slice(0,24);
  return path.join(dir,`${key}.job.json`);
}

test('V546 keeps destructive writes frozen while PREPARE read-only UI stays reachable and completed backup no longer whitescreens normal startup',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-write-freeze-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  process.env.V505_PURGE_STARTUP_ORPHAN_STALE_MS='60000';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {v505PurgeWriteFreezeGuard,reconcilePurgeQueryOnlyNow,reconcileHistoricalPurgeStartupDebrisNow,V505_PURGE_WRITE_FREEZE_ID}=await import('../src/v505PurgeWriteFreezeGuard.js');
  assert.match(V505_PURGE_WRITE_FREEZE_ID,/v546-purge-freeze-readonly-ui-recovery/);
  const db=getDb();
  const cfg=getRuntimeConfig();
  const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
  const executeDir=path.join(cfg.backupsDir,'.purge_execute_jobs');
  const submissionFile=path.join(cfg.backupsDir,'.purge_global_submission.lock.json');
  fs.mkdirSync(prepareDir,{recursive:true});fs.mkdirSync(executeDir,{recursive:true});
  const prepareFile=identityFile(prepareDir,'prepare-owner');
  const executeFile=identityFile(executeDir,'execute-owner');
  const setSqliteBlock=(when)=>db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_block_until',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(String(when),new Date().toISOString());
  const setExpiredSqliteBlock=()=>setSqliteBlock(Date.now()-60_000);
  const setLiveSqliteBlock=()=>setSqliteBlock(Date.now()+60*60_000);
  const runGuard=(req)=>{
    let nextCalled=false;const res=responseHarness();
    v505PurgeWriteFreezeGuard(req,res,()=>{nextCalled=true;});
    return {nextCalled,res,req};
  };
  try{
    setExpiredSqliteBlock();

    fs.writeFileSync(submissionFile,JSON.stringify({pid:process.pid,requestToken:'submission-window',acquiredAt:Date.now()}),'utf8');
    const submissionRace=runGuard(request('POST','/api/unified-import'));
    assert.equal(submissionRace.nextCalled,false,'a racing request must be rejected while the first PREPARE owns the atomic submission mutex');
    assert.equal(submissionRace.res.statusCode,423);
    assert.equal(submissionRace.res.body?.protectedBy,'SUBMISSION:LOCKED');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,0,'bare submission mutex must not switch the process-global DB read-only before the owning PREPARE writes its safety block');
    fs.rmSync(submissionFile,{force:true});

    fs.writeFileSync(prepareFile,JSON.stringify({jobId:crypto.randomUUID(),status:'RUNNING',workerPid:process.pid,workerClaimedAt:Date.now(),heartbeatAt:Date.now()-120_000}),'utf8');
    const livePrepareWrite=runGuard(request('POST','/api/unified-import'));
    assert.equal(livePrepareWrite.nextCalled,false);
    assert.equal(livePrepareWrite.res.statusCode,423);
    assert.equal(livePrepareWrite.res.body?.code,'DATA_PURGE_IN_PROGRESS');
    assert.equal(livePrepareWrite.res.body?.protectedBy,'PREPARE:RUNNING');
    assert.equal(livePrepareWrite.res.body?.fingerprintSealed,false);
    assert.equal(livePrepareWrite.req.v505PurgeReadOnlyAuth,true);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1,'running PREPARE must freeze the shared web DB before the backup fingerprint is sealed');

    const dashboardRead=runGuard(request('GET','/api/state?compact=1'));
    assert.equal(dashboardRead.nextCalled,true,'read-only dashboard APIs must remain reachable during PREPARE so the SPA cannot white-screen');
    assert.equal(dashboardRead.req.v505PurgeReadOnlyAuth,true);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1,'read-only UI access must not reopen a writable DB window');
    const historyRead=runGuard(request('GET','/api/unified-history'));
    assert.equal(historyRead.nextCalled,true,'history reads required by first paint remain available during PREPARE');
    const health=runGuard(request('GET','/api/health'));
    assert.equal(health.nextCalled,true,'explicit health read stays available');
    const session=runGuard(request('GET','/api/session'));
    assert.equal(session.nextCalled,true,'session identity may be read without refreshing the DB session');

    const purgeControl=runGuard(request('POST','/api/admin/data-purge/prepare'));
    assert.equal(purgeControl.nextCalled,true,'purge coordinator endpoints must remain reachable');
    assert.equal(purgeControl.req.v505PurgeReadOnlyAuth,true,'purge control authentication remains read-only');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1,'trusted purge control must never create a shared writable window');
    assert.throws(()=>db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('v505_concurrent_write_probe','1',?)`).run(new Date().toISOString()),/readonly|read-only/i,'a concurrent main-process write must remain impossible during active PREPARE');

    fs.rmSync(prepareFile,{force:true});
    fs.writeFileSync(executeFile,JSON.stringify({jobId:crypto.randomUUID(),status:'RUNNING',workerPid:process.pid,workerClaimedAt:Date.now(),heartbeatAt:Date.now()-120_000}),'utf8');
    const liveExecute=runGuard(request('DELETE','/api/admin/backups/all'));
    assert.equal(liveExecute.nextCalled,false);
    assert.equal(liveExecute.res.body?.protectedBy,'EXECUTE:RUNNING');
    assert.equal(liveExecute.res.body?.fingerprintSealed,true);
    assert.equal(liveExecute.res.body?.mainProcessQueryOnly,true);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1,'EXECUTE must keep the main web DB connection query-only');
    const executeDashboardRead=runGuard(request('GET','/api/state?compact=1'));
    assert.equal(executeDashboardRead.nextCalled,false,'destructive EXECUTE keeps nonessential dashboard reads blocked');
    assert.equal(executeDashboardRead.res.statusCode,423);

    fs.rmSync(executeFile,{force:true});
    fs.writeFileSync(prepareFile,JSON.stringify({jobId:crypto.randomUUID(),status:'SUCCEEDED',workerPid:0,payload:{expiresAt:new Date(Date.now()+5*60_000).toISOString()}}),'utf8');
    setLiveSqliteBlock();
    const waitingExecuteWrite=runGuard(request('PATCH','/api/settings'));
    assert.equal(waitingExecuteWrite.nextCalled,true,'a completed PREPARE waiting for explicit V545 step two must no longer keep the whole application frozen');
    assert.equal(waitingExecuteWrite.req.v505PurgeReadOnlyAuth,undefined);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,0,'the old one-hour PREPARE block is suppressed once the backup worker is complete');
    const reconciledCompleted=reconcilePurgeQueryOnlyNow();
    assert.equal(reconciledCompleted.state.active,false);
    assert.equal(reconciledCompleted.state.prepareBlockSuppressed,true);
    assert.equal(reconciledCompleted.state.external?.workerState,'COMPLETED_WAITING_EXPLICIT_EXECUTE');

    const sealedControl=runGuard(request('POST','/api/admin/data-purge/execute'));
    assert.equal(sealedControl.nextCalled,true,'explicit execute control stays reachable after completed PREPARE');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,0,'completed PREPARE itself does not silently refreeze the shared DB');

    fs.rmSync(prepareFile,{force:true});
    setExpiredSqliteBlock();
    const reconciled=reconcilePurgeQueryOnlyNow();
    assert.equal(reconciled.state.active,false,'no persisted purge truth remains after detached task cleanup');
    assert.equal(reconciled.queryOnly.active,false,'periodic reconciler must restore the shared web DB writable even when no browser request arrives');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,0);

    const committedChallengeId=crypto.randomUUID();
    const committedJobId=crypto.randomUUID();
    const committedAt=new Date().toISOString();
    fs.writeFileSync(executeFile,JSON.stringify({jobId:committedJobId,challengeId:committedChallengeId,request:{challengeId:committedChallengeId},status:'RUNNING',workerPid:2147483647,heartbeatAt:Date.now()-120_000}),'utf8');
    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_last_commit_receipt',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(JSON.stringify({version:2,challengeId:committedChallengeId,executeJobId:committedJobId,committedAt,recoveryBlockUntil:Date.now()+24*60*60_000}),committedAt);
    const receiptFreeze=runGuard(request('POST','/api/unified-import'));
    assert.equal(receiptFreeze.nextCalled,false,'exact commit receipt must freeze writes even if the worker died before promoting its sidecar to COMMITTED');
    assert.equal(receiptFreeze.res.body?.protectedBy,'EXECUTE:COMMITTED');
    assert.equal(receiptFreeze.res.body?.fingerprintSealed,true);
    assert.equal(receiptFreeze.res.body?.mainProcessQueryOnly,true);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1);

    db.exec('PRAGMA query_only=OFF');
    fs.rmSync(executeFile,{force:true});
    setExpiredSqliteBlock();
    const orphanReceipt=runGuard(request('POST','/api/unified-import'));
    assert.equal(orphanReceipt.nextCalled,false,'orphaned unfinalized commit receipt must remain authoritative without any sidecar');
    assert.equal(orphanReceipt.res.body?.protectedBy,'EXECUTE:COMMITTED');
    assert.equal(orphanReceipt.res.body?.workerState,'COMMIT_RECEIPT_ORPHANED');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1);

    db.exec('PRAGMA query_only=OFF');
    const finalizedAt=new Date().toISOString();
    db.prepare("UPDATE app_meta SET value=?,updatedAt=? WHERE key='data_purge_last_commit_receipt'").run(JSON.stringify({version:2,challengeId:committedChallengeId,executeJobId:committedJobId,committedAt,finalizedAt,finalizationState:'SAFE_POSTCHECK_PASSED',recoveryBlockUntil:Date.now()+24*60*60_000}),finalizedAt);
    setExpiredSqliteBlock();
    const finalizedReceipt=runGuard(request('POST','/api/unified-import'));
    assert.equal(finalizedReceipt.nextCalled,true,'a valid finalized receipt with no active sidecar is historical and must not block ordinary writes');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,0);

    const oldHistoricalAt=Date.parse(finalizedAt)-120_000;
    fs.writeFileSync(prepareFile,JSON.stringify({
      jobId:crypto.randomUUID(),status:'RUNNING',workerPid:0,
      submittedAt:oldHistoricalAt,heartbeatAt:oldHistoricalAt,updatedAt:oldHistoricalAt
    }),'utf8');
    const historicalFreeze=runGuard(request('POST','/api/unified-import'));
    assert.equal(historicalFreeze.nextCalled,false);
    assert.equal(historicalFreeze.res.body?.protectedBy,'PREPARE:RUNNING');
    assert.equal(historicalFreeze.res.body?.workerState,'UNKNOWN');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1);
    const historicalReconcile=reconcileHistoricalPurgeStartupDebrisNow();
    assert.equal(historicalReconcile.retiredCount,1,'periodic system reconciliation must retire terminal-receipt-era startup debris without launching a worker');
    assert.equal(fs.existsSync(prepareFile),false);
    const afterHistoricalReconcile=reconcilePurgeQueryOnlyNow();
    assert.equal(afterHistoricalReconcile.state.active,false);
    assert.equal(afterHistoricalReconcile.queryOnly.active,false);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,0);

    db.prepare("DELETE FROM app_meta WHERE key='data_purge_last_commit_receipt'").run();
    setExpiredSqliteBlock();
    fs.writeFileSync(prepareFile,JSON.stringify({jobId:crypto.randomUUID(),status:'RUNNING',workerPid:2147483647,heartbeatAt:Date.now()-120_000}),'utf8');
    const confirmedDead=runGuard(request('POST','/api/unified-import'));
    assert.equal(confirmedDead.nextCalled,true,'confirmed-dead worker must not create an endless external write freeze once SQLite block is expired');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,0,'main DB returns to writable mode only after no sealed/active purge truth remains');
    fs.rmSync(prepareFile,{force:true});

    if(process.platform==='win32'){
      const recycledAt=Date.now()-120_000;
      fs.writeFileSync(prepareFile,JSON.stringify({
        jobId:crypto.randomUUID(),status:'RUNNING',workerPid:process.pid,
        submittedAt:recycledAt,startedAt:recycledAt,workerClaimedAt:recycledAt,heartbeatAt:recycledAt,updatedAt:recycledAt
      }),'utf8');
      const recycledPrepare=runGuard(request('POST','/api/unified-import'));
      assert.equal(recycledPrepare.nextCalled,true,'Windows PID reuse must not leave an old PREPARE sidecar freezing APIs forever');
      assert.equal(db.prepare('PRAGMA query_only').get().query_only,0);
      fs.rmSync(prepareFile,{force:true});

      fs.writeFileSync(executeFile,JSON.stringify({
        jobId:crypto.randomUUID(),status:'RUNNING',workerPid:process.pid,
        submittedAt:recycledAt,startedAt:recycledAt,workerClaimedAt:recycledAt,heartbeatAt:recycledAt,updatedAt:recycledAt
      }),'utf8');
      const recycledExecute=runGuard(request('POST','/api/unified-import'));
      assert.equal(recycledExecute.nextCalled,true,'Windows PID reuse must not leave an old EXECUTE sidecar freezing APIs forever after its SQLite safety block expires');
      assert.equal(db.prepare('PRAGMA query_only').get().query_only,0);
      fs.rmSync(executeFile,{force:true});

      fs.writeFileSync(submissionFile,JSON.stringify({pid:process.pid,requestToken:'recycled-submission-window',acquiredAt:recycledAt}),'utf8');
      const recycledSubmission=runGuard(request('POST','/api/unified-import'));
      assert.equal(recycledSubmission.nextCalled,true,'Windows PID reuse must not leave an old global submission mutex freezing admissions forever');
      assert.equal(db.prepare('PRAGMA query_only').get().query_only,0);
      fs.rmSync(submissionFile,{force:true});
    }
  }finally{
    try{db.exec('PRAGMA query_only=OFF');}catch{}
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});