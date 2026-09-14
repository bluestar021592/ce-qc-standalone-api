import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForStatus(file,jobId,timeoutMs=30_000){
  const deadline=Date.now()+timeoutMs;
  let status=null;
  while(Date.now()<deadline){
    try{status=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    if(status?.jobId===jobId&&['SUCCEEDED','FAILED'].includes(String(status.status||'').toUpperCase()))return status;
    await wait(150);
  }
  return status;
}

test('V505 detached execute fails closed when SQLite changes after the verified backup fingerprint',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-fingerprint-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {createPurgeChallenge,PURGE_PHRASE}=await import('../src/dataPurge.js');
  const {queuePurgeExecution}=await import('../src/v505PurgeCoordinator.js');
  const db=getDb();
  const user={email:'fingerprint-admin@example.test',username:'fingerprint-admin',role:'ADMIN'};

  try{
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-10');
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,fileHash,status,summaryJson,warningsJson,createdAt)
      VALUES('batch-fingerprint','snapshot-fingerprint','2026-09-10','hash','IMPORTED','{}','[]','2026-09-10T00:00:00Z')`).run();
    db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,rowJson,createdAt)
      VALUES('batch-fingerprint','snapshot-fingerprint','2026-09-10','CE','CC-FINGERPRINT-1','{}','2026-09-10T00:00:00Z')`).run();

    const prepared=await createPurgeChallenge(user);
    assert.equal(prepared.status,'QUEUED');
    const prepareStatusFile=path.join(getRuntimeConfig().projectRoot,'public',prepared.statusUrl.replace(/^\//,''));
    const prepareStatus=await waitForStatus(prepareStatusFile,prepared.jobId);
    assert.equal(prepareStatus?.status,'SUCCEEDED',prepareStatus?.error||'prepare worker did not finish');
    const challenge=await createPurgeChallenge(user);
    assert.equal(challenge.status,'SUCCEEDED');
    assert.ok(challenge.challengeId);

    const waitMs=Math.max(0,new Date(challenge.notBefore).getTime()-Date.now());
    if(waitMs)await wait(waitMs+100);

    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('v505_post_backup_mutation','changed-after-backup',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(new Date().toISOString());

    const queued=await queuePurgeExecution(user,{challengeId:challenge.challengeId,phrase:PURGE_PHRASE,backupConfirmed:true});
    assert.equal(queued.async,true);
    assert.equal(queued.kind,'EXECUTE');
    const executeStatusFile=path.join(getRuntimeConfig().projectRoot,'public',queued.statusUrl.replace(/^\//,''));
    const executeStatus=await waitForStatus(executeStatusFile,queued.jobId);
    assert.equal(executeStatus?.status,'FAILED','post-backup SQLite mutation must never be accepted by detached execute');
    assert.match(String(executeStatus?.error||''),/数据库在安全备份后发生变化|安全备份后发生变化/);

    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,1,'business rows must remain after fingerprint rejection');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM unified_import_rows').get().count,1,'import membership must remain after fingerprint rejection');
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='v505_post_backup_mutation'").get()?.value,'changed-after-backup');
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get(),undefined,'destructive reset must not have committed');
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
