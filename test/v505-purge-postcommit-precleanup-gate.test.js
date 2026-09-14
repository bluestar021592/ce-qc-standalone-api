import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitForTerminalStatus(file,jobId,timeoutMs=30_000){
  const deadline=Date.now()+timeoutMs;
  let status=null;
  while(Date.now()<deadline){
    try{status=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    if(status?.jobId===jobId&&['SUCCEEDED','FAILED'].includes(String(status.status||'').toUpperCase()))return status;
    await wait(100);
  }
  return status;
}

test('V505 post-COMMIT backup loss fails before deleting import/export recovery evidence',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-precleanup-gate-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  process.env.PURGE_PREPARE_START_DELAY_MS='750';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {createPurgeChallenge,executePurge,finalizeCommittedPurge,readPurgeCommitReceipt,PURGE_PHRASE}=await import('../src/dataPurge.js');
  const db=getDb();
  const cfg=getRuntimeConfig();
  const user={email:'postcommit-precleanup@example.test',role:'ADMIN'};
  const executeJobId='00000000-0000-4000-8000-000000000506';
  let statusFile='';
  let parkedBackup='';
  try{
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-12');

    const queued=await createPurgeChallenge(user,{activeRunIds:new Set()});
    assert.ok(['QUEUED','RUNNING'].includes(String(queued.status||'').toUpperCase()));
    statusFile=path.join(cfg.projectRoot,'public',String(queued.statusUrl||'').replace(/^\//,''));
    const done=await waitForTerminalStatus(statusFile,queued.jobId);
    assert.equal(done?.status,'SUCCEEDED',done?.error||'prepare worker did not finish');

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
        onCommitted:()=>{throw new Error('SIMULATED_CRASH_AFTER_COMMIT_PRE_CLEANUP');}
      }),
      /SIMULATED_CRASH_AFTER_COMMIT_PRE_CLEANUP/
    );

    const receipt=readPurgeCommitReceipt({challengeId:challenge.challengeId,executeJobId});
    assert.ok(receipt,'exact durable receipt must exist after the simulated post-COMMIT crash');
    assert.equal(String(receipt.finalizedAt||''),'');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,0,'business DELETE must already be committed exactly once');

    fs.mkdirSync(cfg.importsDir,{recursive:true});
    fs.mkdirSync(cfg.exportsDir,{recursive:true});
    const importSentinel=path.join(cfg.importsDir,'postcommit-recovery-sentinel-import.xlsx');
    const exportSentinel=path.join(cfg.exportsDir,'postcommit-recovery-sentinel-export.xlsx');
    fs.writeFileSync(importSentinel,'KEEP-UNTIL-SAFE-FINALIZE','utf8');
    fs.writeFileSync(exportSentinel,'KEEP-UNTIL-SAFE-FINALIZE','utf8');

    parkedBackup=`${receipt.backup.filePath}.temporarily-missing`;
    fs.renameSync(receipt.backup.filePath,parkedBackup);
    assert.equal(fs.existsSync(receipt.backup.filePath),false,'test must make the authoritative pre-clear backup unavailable');

    await assert.rejects(
      finalizeCommittedPurge({challengeId:challenge.challengeId,executeJobId,user,recoveredAfterCommit:true}),
      error=>String(error?.code||'')==='V505_PURGE_POST_COMMIT_FINALIZE_BLOCKED'&&/自动备份不存在/.test(String(error?.message||''))
    );

    assert.equal(fs.existsSync(importSentinel),true,'failed post-COMMIT safety preflight must not delete import recovery evidence');
    assert.equal(fs.existsSync(exportSentinel),true,'failed post-COMMIT safety preflight must not delete export recovery evidence');
    assert.ok(Number(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0)>Date.now(),'failed pre-cleanup gate must keep the long safety block');
    assert.equal(String(readPurgeCommitReceipt({challengeId:challenge.challengeId,executeJobId})?.finalizedAt||''),'','failed pre-cleanup gate must not mark the durable receipt finalized');

    fs.renameSync(parkedBackup,receipt.backup.filePath);
    parkedBackup='';
    const recovered=await finalizeCommittedPurge({challengeId:challenge.challengeId,executeJobId,user,recoveredAfterCommit:true});
    assert.equal(recovered.committedReceipt,true);
    assert.equal(recovered.recoveredAfterCommit,true);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,0,'successful recovery must not execute business DELETE again');
    assert.equal(fs.existsSync(importSentinel),false,'regenerable import file cleanup may proceed only after the safety preflight passes');
    assert.equal(fs.existsSync(exportSentinel),false,'regenerable export file cleanup may proceed only after the safety preflight passes');
  }finally{
    if(parkedBackup&&fs.existsSync(parkedBackup)){
      try{fs.renameSync(parkedBackup,parkedBackup.replace(/\.temporarily-missing$/,''));}catch{}
    }
    try{closeDb();}catch{}
    if(statusFile){try{fs.rmSync(statusFile,{force:true});}catch{}}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
