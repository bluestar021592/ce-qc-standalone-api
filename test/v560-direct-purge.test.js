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
    db.exec('CREATE TABLE IF NOT EXISTS qc_tracking_ledger(id INTEGER PRIMARY KEY, shipmentCode TEXT)');
    db.exec('CREATE TABLE IF NOT EXISTS qc_tracking_audit(id INTEGER PRIMARY KEY, shipmentCode TEXT)');
    db.exec('CREATE TABLE IF NOT EXISTS v329_three_business_daily_cache(id INTEGER PRIMARY KEY, reportDate TEXT)');
    db.exec('CREATE TABLE IF NOT EXISTS v334_generic_history_cache(id INTEGER PRIMARY KEY, reportDate TEXT)');
    db.prepare('INSERT INTO qc_tracking_ledger(shipmentCode) VALUES(?)').run('OLD-TRACK-1');
    db.prepare('INSERT INTO qc_tracking_audit(shipmentCode) VALUES(?)').run('OLD-TRACK-1');
    db.prepare('INSERT INTO v329_three_business_daily_cache(reportDate) VALUES(?)').run('2026-09-01');
    db.prepare('INSERT INTO v334_generic_history_cache(reportDate) VALUES(?)').run('2026-09-01');
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
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM qc_tracking_ledger').get()?.count||0),0,'full purge must clear V246 tracking ledger');
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM qc_tracking_audit').get()?.count||0),0,'full purge must clear V246 tracking audit');
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM v329_three_business_daily_cache').get()?.count||0),0,'full purge must clear three-business derived history cache');
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM v334_generic_history_cache').get()?.count||0),0,'full purge must clear generic derived history cache');
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
  const access=fs.readFileSync('src/accessControl.js','utf8');
  assert.match(html,/直接清空业务数据/);
  assert.match(html,/不创建新备份、不启用安全封锁/);
  assert.doesNotMatch(html,/备份并继续|purgeBackupConfirmed|v505-data-purge-recovery\.js/);
  assert.match(html,/v560-direct-data-purge\.js\?v=20260921-v562-1/);
  assert.match(js,/\/api\/admin\/data-purge\/direct/);
  assert.match(js,/\/api\/admin\/data-purge\/direct\/status\?jobId=/,'UI must poll detached worker status instead of waiting on the destructive request');
  assert.match(js,/\/api\/session/,'direct purge must verify a fresh authenticated session before exposing destructive controls');
  assert.match(js,/encodeURIComponent\(RETURN_TO\)/,'expired sessions must redirect through login and return to the purge console');
  assert.match(js,/INTERNAL_AUTH_REQUIRED/,'direct purge must recognize the explicit session-expired API code');
  assert.match(js,/独立后台线程/,'UI must expose detached execution progress');
  assert.match(js,/永久清除全部业务数据/);
  assert.match(js,/最终确认：现在将直接永久清空全部业务数据/);
  assert.doesNotMatch(js,/\/api\/admin\/data-purge\/(?:prepare|execute)/);
  assert.match(access,/const rawReturnTo = String\(req\.query\?\.returnTo/,'login page must accept a same-origin return target');
  assert.match(access,/safeReturnToJson/,'login return target must be JSON-escaped before inline script use');
  assert.match(access,/location\.replace\(target\+join\+'auth=v431&t='/,'successful login must return directly to the purge console when requested');
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


test('post-purge empty bootstrap clears stale browser business state instead of merging pre-clear snapshots',()=>{
  const app=fs.readFileSync('public/app.js','utf8');
  const html=fs.readFileSync('public/index.html','utf8');
  assert.match(app,/unifiedImportState = boot\?\.unifiedImport \|\| null/,'empty bootstrap must clear stale unified import state');
  assert.match(app,/businessStates = \{ \.\.\.\(boot\?\.businessStates \|\| \{\}\) \}/,'empty bootstrap must replace, not merge, stale business states');
  assert.match(app,/const serverHasBusinessData = Boolean/);
  assert.match(app,/historyModeDate = ''/);
  assert.match(app,/dashboardPeriodMode = ''/);
  assert.match(app,/\^ce_qc_/,'full purge must retire CE QC browser caches when server has no business data');
  assert.match(app,/sessionStorage\.removeItem\('trackingReturnContext'\)/);
  assert.match(html,/app\.js\?v=20260921-v564-1/,'browser must receive the corrected empty-state and interaction owner immediately after update');
  assert.match(html,/dashboard-fixture-v18\.js\?v=20260921-v564-1/,'browser must receive the toast-free first-paint owner immediately after update');
});


test('V246 hidden tracking panel never auto-reads the heavy ledger on normal page startup',()=>{
  const ui=fs.readFileSync('public/v246-qc-tracking.js','utf8');
  const store=fs.readFileSync('src/store.js','utf8');
  assert.doesNotMatch(ui,/queueMicrotask\(\(\)=>void read\(\)\)/,'normal page startup must not launch the V246 30-day ledger summary query');
  assert.match(ui,/点击“只读取账本”时才查询/,'tracking ledger read must be explicit/manual');
  for (const table of ['qc_tracking_ledger','qc_tracking_audit','v329_three_business_daily_cache','v334_generic_history_cache']) {
    assert.match(store,new RegExp(`['"]${table}['"]`),`BUSINESS_DATA_TABLES must include ${table}`);
  }
});


test('V564 post-purge/startup interaction path never reloads the page in a loop',()=>{
  const app=fs.readFileSync('public/app.js','utf8');
  const startup=fs.readFileSync('public/dashboard-fixture-v18.js','utf8');
  const sourceTruth=fs.readFileSync('public/v81-startup-source-truth.js','utf8');
  assert.doesNotMatch(startup,/系统界面已可操作，本地数据继续后台读取/);
  assert.doesNotMatch(startup,/typeof global\.refresh === 'function'/);
  assert.doesNotMatch(startup,/typeof global\.renderAll === 'function'/);
  assert.match(sourceTruth,/location\.replace\('\/\?returnTo='/);
  assert.doesNotMatch(sourceTruth,/location\.reload\(\)/);
  const resetListener=app.match(/events\.addEventListener\('DATA_RESET',[\s\S]*?\n  \}\);/);
  assert.ok(resetListener,'DATA_RESET listener must exist');
  assert.doesNotMatch(resetListener[0],/location\.reload\(\)/,'post-purge refresh failure must not reload the whole application');
  assert.match(resetListener[0],/post-purge refresh deferred/);
});
