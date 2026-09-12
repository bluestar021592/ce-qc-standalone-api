import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const PUBLIC_STATUS_PRIVATE_KEYS=['email','user','payload','backup','databasePath','sealedDatabasePath','challengeId','statusToken','statusFile','request','result'];

function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}
async function waitForStatus(statusFile,jobId,timeoutMs=30_000){
  const deadline=Date.now()+timeoutMs;let status=null;
  while(Date.now()<deadline){
    try{status=JSON.parse(fs.readFileSync(statusFile,'utf8'));}catch{}
    if(status?.jobId===jobId&&['SUCCEEDED','FAILED'].includes(String(status.status||'').toUpperCase()))return status;
    await wait(150);
  }
  return status;
}

test('V505 keeps stale-heartbeat PREPARE and EXECUTE jobs locked while their worker PID is still alive',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-live-worker-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {inspectLivePrepareJob,inspectExecutionRecovery}=await import('../src/v505PurgeCoordinator.js');
  const user={email:'stale-alive-admin'};
  const cfg=getRuntimeConfig();const key=identityKey(user);
  try{
    const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');fs.mkdirSync(prepareDir,{recursive:true});
    const prepareFile=path.join(prepareDir,`${key}.job.json`);
    const prepareToken=crypto.randomBytes(24).toString('hex');
    const fakePrepare={jobId:crypto.randomUUID(),statusToken:prepareToken,statusFile:path.join(cfg.projectRoot,'public','purge-status',`${prepareToken}.json`),status:'RUNNING',email:user.email,submittedAt:Date.now()-180_000,startedAt:Date.now()-170_000,heartbeatAt:Date.now()-120_000,workerPid:process.pid,updatedAt:Date.now()-120_000};
    fs.writeFileSync(prepareFile,JSON.stringify(fakePrepare),'utf8');
    const prepared=inspectLivePrepareJob(user);
    assert.equal(prepared?.dead,false);assert.equal(prepared?.job?.jobId,fakePrepare.jobId);assert.equal(prepared?.payload?.jobId,fakePrepare.jobId);assert.equal(prepared?.payload?.workerState,'ALIVE');assert.equal(prepared?.payload?.heartbeatStale,true);assert.match(prepared?.payload?.message||'',/保持锁定/);assert.match(prepared?.payload?.message||'',/不会启动第二份备份/);
    fs.rmSync(prepareFile,{force:true});

    const executeDir=path.join(cfg.backupsDir,'.purge_execute_jobs');fs.mkdirSync(executeDir,{recursive:true});
    const executeFile=path.join(executeDir,`${key}.job.json`);
    const executeToken=crypto.randomBytes(24).toString('hex');
    const challengeId=crypto.randomUUID();
    const fakeExecute={kind:'EXECUTE',jobId:crypto.randomUUID(),challengeId,request:{challengeId},statusToken:executeToken,statusFile:path.join(cfg.projectRoot,'public','purge-status',`${executeToken}.json`),status:'RUNNING',submittedAt:Date.now()-180_000,startedAt:Date.now()-170_000,heartbeatAt:Date.now()-120_000,workerPid:process.pid,updatedAt:Date.now()-120_000};
    fs.writeFileSync(executeFile,JSON.stringify(fakeExecute),'utf8');
    const executing=inspectExecutionRecovery(user);
    assert.equal(executing?.jobId,fakeExecute.jobId);assert.equal(executing?.status,'RUNNING');assert.equal(executing?.workerState,'ALIVE');assert.equal(executing?.heartbeatStale,true);assert.match(executing?.message||'',/保持锁定/);assert.match(executing?.message||'',/不会启动第二个清空任务/);
    fs.rmSync(executeFile,{force:true});
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('V505 detached execute returns quickly, durably binds the sealed DB path, reuses one live job, and finishes transactional purge out of the HTTP process',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-execute-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {createPurgeChallenge,PURGE_PHRASE,readPurgeCommitReceipt}=await import('../src/dataPurge.js');
  const {queuePurgeExecution,inspectExecutionRecovery,V505_PURGE_COORDINATOR_ID}=await import('../src/v505PurgeCoordinator.js');
  const db=getDb();const user={email:'execute-admin',username:'execute-admin',role:'ADMIN'};
  let prepareStatusFile='';let executeStatusFile='';
  try{
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-09');
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,fileHash,status,summaryJson,warningsJson,createdAt) VALUES('batch-v505','snapshot-v505','2026-09-09','hash','IMPORTED','{}','[]','2026-09-09T00:00:00Z')`).run();
    db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,rowJson,createdAt) VALUES('batch-v505','snapshot-v505','2026-09-09','CE','CC-V505-1','{}','2026-09-09T00:00:00Z')`).run();
    db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,stateJson,updatedAt) VALUES('CC-V505-1','CE','2026-09-09','snapshot-v505','PENDING','{}','2026-09-09T00:00:00Z')`).run();

    const prepared=await createPurgeChallenge(user);assert.equal(prepared.status,'QUEUED');
    prepareStatusFile=path.join(getRuntimeConfig().projectRoot,'public',prepared.statusUrl.replace(/^\//,''));
    const prepareStatus=await waitForStatus(prepareStatusFile,prepared.jobId);assert.equal(prepareStatus?.status,'SUCCEEDED',prepareStatus?.error||'prepare worker did not finish');
    const challenge=await createPurgeChallenge(user);assert.equal(challenge.status,'SUCCEEDED');assert.ok(challenge.challengeId);
    const delay=Math.max(0,new Date(challenge.notBefore).getTime()-Date.now());if(delay)await wait(delay+100);

    const request={challengeId:challenge.challengeId,phrase:PURGE_PHRASE,backupConfirmed:true};
    const submittedAt=Date.now();const first=await queuePurgeExecution(user,request);const submitElapsedMs=Date.now()-submittedAt;
    assert.ok(submitElapsedMs<5000,`execute submission blocked for ${submitElapsedMs}ms`);assert.equal(first.async,true);assert.equal(first.kind,'EXECUTE');assert.match(first.jobId,/^[0-9a-f-]{36}$/i);assert.match(first.statusUrl,/^\/purge-status\/[a-f0-9]{48}\.json$/i);assert.equal(first.coordinatorPatch,V505_PURGE_COORDINATOR_ID);
    const executeJobFile=path.join(getRuntimeConfig().backupsDir,'.purge_execute_jobs',`${identityKey(user)}.job.json`);
    const durableExecute=JSON.parse(fs.readFileSync(executeJobFile,'utf8'));
    assert.equal(durableExecute.jobId,first.jobId);
    assert.equal(path.resolve(durableExecute.sealedDatabasePath),path.resolve(getRuntimeConfig().dbFile),'fresh destructive job must durably bind the exact database path sealed by PREPARE');
    const second=await queuePurgeExecution(user,request);assert.equal(second.jobId,first.jobId,'duplicate execute submission must reuse the live worker');

    executeStatusFile=path.join(getRuntimeConfig().projectRoot,'public',first.statusUrl.replace(/^\//,''));
    const executeStatus=await waitForStatus(executeStatusFile,first.jobId);assert.equal(executeStatus?.status,'SUCCEEDED',executeStatus?.error||'execute worker did not finish');
    for(const key of PUBLIC_STATUS_PRIVATE_KEYS)assert.equal(Object.hasOwn(executeStatus||{},key),false,`public execute status must not expose ${key}`);

    const recovered=inspectExecutionRecovery(user);assert.equal(recovered?.status,'SUCCEEDED');assert.equal(recovered?.jobId,first.jobId);assert.equal(recovered?.completed,true);assert.equal(recovered?.result?.countSource,'DELETE_CHANGESET_EXACT');assert.equal(recovered?.result?.backupSourceFingerprint,'MATCHED_UNDER_BEGIN_IMMEDIATE');assert.ok(['ok','committed-with-warnings'].includes(recovered?.result?.integrity));assert.equal(recovered?.result?.committedReceipt,true);assert.equal(recovered?.result?.executeJobId,first.jobId);
    const receipt=readPurgeCommitReceipt({challengeId:challenge.challengeId,executeJobId:first.jobId});assert.ok(receipt,'normal execute must leave an exact durable commit receipt');assert.equal(receipt.executeJobId,first.jobId);

    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,0);assert.equal(db.prepare('SELECT COUNT(*) count FROM unified_import_batches').get().count,0);assert.equal(db.prepare('SELECT COUNT(*) count FROM unified_import_rows').get().count,0);assert.equal(db.prepare('SELECT COUNT(*) count FROM shipment_current_state').get().count,0);assert.ok(db.prepare('SELECT COUNT(*) count FROM backup_records').get().count>=1);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get()?.value||0),18);
  }finally{
    try{closeDb();}catch{}
    for(const file of [prepareStatusFile,executeStatusFile])if(file){try{fs.rmSync(file,{force:true});}catch{}}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('V505 coordinator restarts only post-commit finalization for an exact receipt and does not re-enter destructive reset',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-commit-resume-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {inspectExecutionRecovery}=await import('../src/v505PurgeCoordinator.js');
  const db=getDb();const cfg=getRuntimeConfig();const user={email:'commit-resume@example.test',role:'ADMIN'};const key=identityKey(user);
  const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');fs.mkdirSync(prepareDir,{recursive:true});
  const executeDir=path.join(cfg.backupsDir,'.purge_execute_jobs');fs.mkdirSync(executeDir,{recursive:true});
  const executeFile=path.join(executeDir,`${key}.job.json`);
  const token=crypto.randomBytes(24).toString('hex');const statusFile=path.join(cfg.projectRoot,'public','purge-status',`${token}.json`);fs.mkdirSync(path.dirname(statusFile),{recursive:true});
  const challengeId=crypto.randomUUID();const jobId=crypto.randomUUID();let spawnedPid=0;
  const backupFile=path.join(dir,'already-backed-up.db');
  const manifestFile=path.join(dir,'already-backed-up.manifest.json');
  try{
    fs.writeFileSync(backupFile,'sealed-backup-copy','utf8');
    const backupStat=fs.statSync(backupFile);
    fs.writeFileSync(manifestFile,JSON.stringify({databasePath:cfg.dbFile}),'utf8');
    const future=Date.now()+10*60_000;
    fs.writeFileSync(path.join(prepareDir,`${key}.job.json`),JSON.stringify({
      jobId:crypto.randomUUID(),status:'SUCCEEDED',email:user.email,
      payload:{challengeId,expiresAt:new Date(future).toISOString(),databasePath:cfg.dbFile}
    }),'utf8');
    fs.writeFileSync(path.join(prepareDir,`${key}.challenge.json`),JSON.stringify({
      challengeId,payload:{databasePath:cfg.dbFile},challenge:{expiresAt:future,backup:{manifestPath:manifestFile}}
    }),'utf8');

    const receipt={
      version:2,challengeId,executeJobId:jobId,administrator:user.email,committedAt:new Date().toISOString(),
      recoveryBlockUntil:Date.now()+5*60_000,
      backup:{filePath:backupFile,sha256:'a'.repeat(64),size:backupStat.size,mtimeMs:backupStat.mtimeMs,integrity:'ok',method:'test',manifestPath:manifestFile},
      before:{daily_reports:5},after:{daily_reports:0}
    };
    const meta=db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    meta.run('data_purge_last_commit_receipt',JSON.stringify(receipt),new Date().toISOString());meta.run('data_purge_block_until',String(receipt.recoveryBlockUntil),new Date().toISOString());
    const fake={kind:'EXECUTE',jobId,challengeId,statusToken:token,statusFile,status:'RUNNING',submittedAt:Date.now()-120_000,startedAt:Date.now()-119_000,heartbeatAt:Date.now()-118_000,workerPid:2147483647,updatedAt:Date.now()-118_000,user,request:{challengeId,phrase:'永久清除全部业务数据',backupConfirmed:true}};
    fs.writeFileSync(executeFile,JSON.stringify(fake),'utf8');
    fs.writeFileSync(statusFile,JSON.stringify({ok:true,kind:'EXECUTE',jobId,status:'RUNNING',heartbeatAt:fake.heartbeatAt}),'utf8');

    const recovered=inspectExecutionRecovery(user);
    assert.equal(recovered?.jobId,jobId);assert.equal(recovered?.status,'COMMITTED','exact receipt must promote dead RUNNING sidecar to committed recovery instead of failed/retry-delete');
    spawnedPid=Number(JSON.parse(fs.readFileSync(executeFile,'utf8')).workerPid||0);assert.ok(spawnedPid>0,'coordinator must start a finalizer worker for the same execute job id');
    const finalStatus=await waitForStatus(statusFile,jobId,20_000);assert.equal(finalStatus?.status,'SUCCEEDED',finalStatus?.error||'post-commit finalizer did not finish');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,0,'post-commit recovery must preserve the committed zero-state without executing a second DELETE');
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get(),undefined,'synthetic committed receipt recovery must not re-enter the destructive reset transaction');
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get(),undefined,'finalizer must release the old purge block');
  }finally{
    if(spawnedPid>0){try{process.kill(spawnedPid);}catch{}}
    try{closeDb();}catch{}
    try{fs.rmSync(statusFile,{force:true});}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
