import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('V560 direct purge clears business data without creating a backup or purge seal',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v560-direct-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';

  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {executeDirectDataPurge,DIRECT_PURGE_PHRASE}=await import('../src/directDataPurge.js');
  const db=getDb();
  const cfg=getRuntimeConfig();
  try{
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-20');
    db.prepare("INSERT INTO audit_logs(userEmail,userRole,action,businessType,reportDate,runId,detailJson,ipAddress,createdAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run('admin@example.test','ADMIN','TEST_PRESERVE','','','','{}','127.0.0.1','2026-09-20T00:00:00Z');
    db.prepare("INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt")
      .run('data_purge_block_until',String(Date.now()+60_000),new Date().toISOString());
    const auditBefore=Number(db.prepare('SELECT COUNT(*) count FROM audit_logs').get()?.count||0);
    const preClearDir=path.join(cfg.backupsDir,'pre_clear');
    const preClearBefore=fs.existsSync(preClearDir)?fs.readdirSync(preClearDir).length:0;

    await assert.rejects(
      ()=>executeDirectDataPurge({phrase:'wrong',user:{email:'admin@example.test',role:'ADMIN'}}),
      /请输入完整确认短语/
    );
    assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM daily_reports').get()?.count||0),1,'invalid phrase must not delete data');

    const result=await executeDirectDataPurge({phrase:DIRECT_PURGE_PHRASE,user:{email:'admin@example.test',role:'ADMIN'}});
    assert.equal(result.ok,true);
    assert.equal(result.direct,true);
    assert.equal(result.backupCreated,false);
    assert.equal(result.sealed,false);
    assert.equal(result.deleteMode,'DIRECT_NO_BACKUP_TRANSACTION');

    const verifyDb=(await import('node:sqlite')).DatabaseSync;
    const check=new verifyDb(cfg.dbFile);
    try{
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM daily_reports').get()?.count||0),0);
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM audit_logs').get()?.count||0),auditBefore,'audit history must be preserved');
      assert.equal(check.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get(),undefined,'direct purge must not leave a V505 safety block');
      assert.equal(check.prepare("SELECT value FROM app_meta WHERE key='data_purge_last_commit_receipt'").get(),undefined,'direct purge must not leave a V505 commit receipt');
      assert.equal(String(check.prepare("SELECT value FROM app_meta WHERE key='last_processed_report_date'").get()?.value||''),'');
      assert.ok(String(check.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get()?.value||''));
    }finally{check.close();}

    const preClearAfter=fs.existsSync(preClearDir)?fs.readdirSync(preClearDir).length:0;
    assert.equal(preClearAfter,preClearBefore,'direct purge must not create a pre_clear backup');
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
});

test('V560 direct recovery console has no backup step and posts only the direct admin endpoint',()=>{
  const html=fs.readFileSync('public/purge-console.html','utf8');
  const js=fs.readFileSync('public/v560-direct-data-purge.js','utf8');
  assert.match(html,/直接清空业务数据/);
  assert.match(html,/不创建新备份、不启用安全封锁/);
  assert.doesNotMatch(html,/备份并继续|purgeBackupConfirmed|v505-data-purge-recovery\.js/);
  assert.match(html,/v560-direct-data-purge\.js\?v=20260920-v561-1/);
  assert.match(js,/\/api\/admin\/data-purge\/direct/);
  assert.match(js,/\/api\/admin\/data-purge\/direct\/status\?jobId=/,'UI must poll detached worker status instead of waiting on the destructive request');
  assert.match(js,/独立后台线程/,'UI must expose detached execution progress');
  assert.match(js,/永久清除全部业务数据/);
  assert.match(js,/最终确认：现在将直接永久清空全部业务数据/);
  assert.doesNotMatch(js,/\/api\/admin\/data-purge\/(?:prepare|execute)/);
});


test('V561 queues direct purge immediately and reports detached worker progress without blocking 5177',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v561-direct-async-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';

  const {getDb,closeDb}=await import('../src/db.js');
  const {queueDirectDataPurge,getDirectDataPurgeStatus,DIRECT_PURGE_PHRASE}=await import('../src/directDataPurge.js');
  const user={email:'async-admin@example.test',role:'ADMIN'};
  try{
    const db=getDb();
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-20');
    closeDb();

    const started=Date.now();
    const queued=queueDirectDataPurge({phrase:DIRECT_PURGE_PHRASE,user});
    const ackMs=Date.now()-started;
    assert.equal(queued.async,true);
    assert.ok(ackMs<1000,`queue acknowledgement must be immediate, got ${ackMs}ms`);
    assert.ok(queued.jobId);

    let status=queued;
    const deadline=Date.now()+15_000;
    while(Date.now()<deadline){
      status=getDirectDataPurgeStatus({jobId:queued.jobId,user});
      if(['SUCCEEDED','FAILED'].includes(String(status.status||'').toUpperCase()))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(status.status,'SUCCEEDED',status.error||status.message||'detached direct purge did not finish');
    assert.ok(Number(status.deletedRows||0)>=1);

    const {DatabaseSync}=await import('node:sqlite');
    const check=new DatabaseSync(process.env.DB_FILE);
    try{
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM daily_reports').get()?.count||0),0);
    }finally{check.close();}
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
});
