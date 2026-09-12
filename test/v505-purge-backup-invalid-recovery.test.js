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
    await wait(100);
  }
  return status;
}

test('V505 missing verified backup invalidates stale challenge and starts one fresh safe prepare job',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-backup-recovery-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  process.env.PURGE_PREPARE_START_DELAY_MS='750';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {createPurgeChallenge}=await import('../src/dataPurge.js');
  const db=getDb();
  const user={email:'backup-recovery-admin@example.test',username:'backup-recovery-admin',role:'ADMIN'};
  let firstStatusFile='';
  let secondStatusFile='';
  try{
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-11');

    const first=await createPurgeChallenge(user,{activeRunIds:new Set()});
    assert.ok(['QUEUED','RUNNING'].includes(String(first.status||'').toUpperCase()));
    firstStatusFile=path.join(getRuntimeConfig().projectRoot,'public',String(first.statusUrl||'').replace(/^\//,''));
    const firstDone=await waitForStatus(firstStatusFile,first.jobId);
    assert.equal(firstDone?.status,'SUCCEEDED',firstDone?.error||'first prepare worker did not finish');

    const sealed=await createPurgeChallenge(user,{activeRunIds:new Set()});
    assert.equal(sealed.status,'SUCCEEDED');
    assert.ok(sealed.challengeId);
    assert.ok(sealed.backup?.path&&fs.existsSync(sealed.backup.path),'first verified backup must exist before the recovery scenario');
    const oldJobId=sealed.jobId;
    const oldChallengeId=sealed.challengeId;
    const oldBackupPath=sealed.backup.path;

    fs.rmSync(oldBackupPath,{force:true});
    assert.equal(fs.existsSync(oldBackupPath),false,'test must remove the previously verified backup file');

    const replacement=await createPurgeChallenge(user,{activeRunIds:new Set()});
    assert.ok(['QUEUED','RUNNING'].includes(String(replacement.status||'').toUpperCase()),'missing backup must transition directly to one fresh prepare job instead of trapping the stale SUCCEEDED challenge');
    assert.notEqual(replacement.jobId,oldJobId,'fresh prepare must receive a new job id');
    assert.notEqual(String(replacement.jobId||''),String(oldChallengeId||''));
    assert.equal(fs.existsSync(firstStatusFile),false,'stale public status token must be removed when its verified backup becomes invalid');

    secondStatusFile=path.join(getRuntimeConfig().projectRoot,'public',String(replacement.statusUrl||'').replace(/^\//,''));
    const replacementDone=await waitForStatus(secondStatusFile,replacement.jobId);
    assert.equal(replacementDone?.status,'SUCCEEDED',replacementDone?.error||'replacement prepare worker did not finish');

    const resealed=await createPurgeChallenge(user,{activeRunIds:new Set()});
    assert.equal(resealed.status,'SUCCEEDED');
    assert.equal(resealed.jobId,replacement.jobId,'completed replacement prepare must be reused rather than spawning a third backup');
    assert.notEqual(resealed.challengeId,oldChallengeId,'stale challenge must not survive backup invalidation');
    assert.ok(resealed.backup?.path&&fs.existsSync(resealed.backup.path),'replacement verified backup must exist');
    assert.notEqual(path.resolve(resealed.backup.path),path.resolve(oldBackupPath),'replacement prepare must create a distinct backup artifact');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,1,'backup recovery must never delete business data');
  }finally{
    try{closeDb();}catch{}
    for(const file of [firstStatusFile,secondStatusFile])if(file){try{fs.rmSync(file,{force:true});}catch{}}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
