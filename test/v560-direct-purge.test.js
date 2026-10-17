import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import XLSX from 'xlsx';

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
    const staleTargets=['shopee_delivery_tracking','shopee_delivery_tracking_daily','v207_daily_ownership','v209_import_source_archive','v328_attempt_daily_cache'];
    const {BUSINESS_DATA_TABLES}=await import('../src/store.js');
    for(const name of staleTargets)assert.ok(BUSINESS_DATA_TABLES.includes(name),`missing direct purge target: ${name}`);
    // Protected configuration must survive a business-only reset. This
    // sentinel guards accidental expansion of BUSINESS_DATA_TABLES.
    db.exec('CREATE TABLE IF NOT EXISTS v788_cp_store_whitelist_guard(cpCode TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO v788_cp_store_whitelist_guard(cpCode) VALUES(?)').run('CP-VALID-PRESERVE');
    const preservedTables=['v788_cp_store_whitelist_guard','app_meta','audit_logs'];
    for(const name of preservedTables)assert.ok(!BUSINESS_DATA_TABLES.includes(name),`protected configuration table may not be purged: ${name}`);
    // V788: exercise the REAL 72-code activation path. A synthetic sentinel
    // table alone cannot prove the active-only CP list survives the reset.
    const {getActiveCompleteShopSet,getShopCodeMap}=await import('../src/shopCodes.js');
    const activeMembers=Array.from({length:72},(_,i)=>({
      code:'CP'+String(i+100001).padStart(6,'0'),name:'Active CP '+(i+1)
    }));
    const activeConfig={mode:'COMPLETE',members:activeMembers,sourceFile:'acceptance-fixture.xlsx'};
    const activeBefore=JSON.stringify(activeConfig);
    db.prepare("INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt")
      .run('shop_current_complete_codes_v780',activeBefore,new Date().toISOString());
    assert.equal(getActiveCompleteShopSet(db)?.members?.length,72,'pre-clear active CP list must validate as 72');
    assert.equal(getShopCodeMap().size,72,'current CP detector must use only activated 72 members');
    const {inspectDirectPurgeCp72Preflight}=await import('../src/directDataPurge.js');
    const cpReady=inspectDirectPurgeCp72Preflight();
    assert.equal(cpReady.cp72Ready,true,'CP preflight must be read-only and find the exact 72 codes');
    assert.equal(cpReady.activeCpCount,72);
    assert.equal(cpReady.backupCreated,false);
    assert.equal(cpReady.existingBackupsPreserved,true);
    assert.equal(cpReady.dataStorageReady,true,
      'a reachable configured primary data root is required before any clear');
    for(const name of ['shop_cp_codes','shop_cp_import_snapshots','shop_active_code_set_history']){
      assert.ok(!BUSINESS_DATA_TABLES.includes(name),`historical CP configuration may not be cleared: ${name}`);
    }
    const auditBefore=Number(db.prepare('SELECT COUNT(*) count FROM audit_logs').get()?.count||0);
    const preClearDir=path.join(cfg.backupsDir,'pre_clear');
    fs.mkdirSync(preClearDir,{recursive:true});
    fs.writeFileSync(path.join(preClearDir,'old-backup.db'),'legacy');
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
    assert.equal(result.deleteMode,'DIRECT_NO_BACKUP_TRANSACTION_PRESERVE_EXISTING_BACKUPS');
    assert.equal(result.existingBackupsPreserved,true,'direct business-data purge must preserve pre-existing backups');

    const verifyDb=(await import('node:sqlite')).DatabaseSync;
    const check=new verifyDb(cfg.dbFile);
    try{
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM daily_reports').get()?.count||0),0);
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM qc_tracking_ledger').get()?.count||0),0,'full purge must clear V246 tracking ledger');
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM qc_tracking_audit').get()?.count||0),0,'full purge must clear V246 tracking audit');
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM v329_three_business_daily_cache').get()?.count||0),0,'full purge must clear three-business derived history cache');
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM v334_generic_history_cache').get()?.count||0),0,'full purge must clear generic derived history cache');
      assert.equal(Number(check.prepare('SELECT COUNT(*) count FROM audit_logs').get()?.count||0),auditBefore,'audit history must be preserved');
      assert.equal(check.prepare('SELECT cpCode FROM v788_cp_store_whitelist_guard').get()?.cpCode,'CP-VALID-PRESERVE','protected CP configuration sentinel must survive direct business purge');
      assert.equal(check.prepare("SELECT value FROM app_meta WHERE key='shop_current_complete_codes_v780'").get()?.value,activeBefore,'exact 72-code CP activation record must survive direct purge');
      assert.equal(getActiveCompleteShopSet(check)?.members?.length,72,'post-clear CP list must remain structurally valid');
      assert.equal(getShopCodeMap().size,72,'post-clear CP detection must not fall back to historical 95 codes');

      for(const table of staleTargets){
        const exists=check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if(exists)assert.equal(Number(check.prepare(`SELECT COUNT(*) count FROM "${table}"`).get()?.count||0),0,`full direct purge must leave ${table} empty`);
      }
      assert.equal(check.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get(),undefined,'direct purge must not leave a V505 safety block');
      assert.equal(check.prepare("SELECT value FROM app_meta WHERE key='data_purge_last_commit_receipt'").get(),undefined,'direct purge must not leave a V505 commit receipt');
      assert.equal(String(check.prepare("SELECT value FROM app_meta WHERE key='last_processed_report_date'").get()?.value||''),'');
      assert.ok(String(check.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get()?.value||''));
      assert.equal(check.prepare("SELECT value FROM app_meta WHERE key='v499_fresh_start_tracking_ready'").get()?.value,'1',
        'direct no-backup reset must arm automatic tracking on the NEXT managed launch');
    }finally{check.close();}

    // A database flag alone is not enough: the real V499 policy is evaluated
    // once on NEXT startup. Prove a new Node process removes the inherited
    // recovery disable only after this reset has committed its ready marker.
    const restarted=spawnSync(process.execPath,['--input-type=module','--eval',
      "const m=await import('./src/v499FreshStartTrackingPolicy.js');"+
      "process.stdout.write('V788_POST_PURGE_POLICY='+"+
      "JSON.stringify(m.inspectV499FreshStartTrackingPolicy())+'\\n');"
    ],{cwd:process.cwd(),encoding:'utf8',timeout:30000,env:{
      ...process.env,DATA_DIR:dir,DB_FILE:cfg.dbFile,
      CE_QC_DISABLE_V246_TRACKING:'1',
      CE_QC_HARD_DISABLE_V246_TRACKING:'0',
      CE_QC_V499_FRESH_START_READY_OVERRIDE:''
    }});
    assert.equal(restarted.status,0,
      'managed post-purge launch must load from persisted data: '+String(restarted.stderr||''));
    const marker=String(restarted.stdout||'').match(/V788_POST_PURGE_POLICY=(\{[^\r\n]*\})/);
    assert.ok(marker,'new managed launch must report evaluated tracking guard');
    const startupPolicy=JSON.parse(marker[1]);
    assert.equal(startupPolicy.freshStartReady,true);
    assert.equal(startupPolicy.v246Enabled,true,
      'post-clear managed restart must enable automatic V246 tracking');
    assert.equal(startupPolicy.waitingForFreshStart,false);

    // V788: exercising the actual import store after the direct reset proves
    // the 7/1 workflow starts from empty membership (not old 8/17 caches).
    // WHPP has a separate daily-source route; test the six unified types here.
    const {saveUnifiedImport}=await import('../src/unifiedImportStore.js');
    const {parseUnifiedDailyExcel}=await import('../src/unifiedExcelParser.js');
    const reimportTypes=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
    // Exercise the SAME BIFF8 Excel parser as a user-uploaded legacy XLS,
    // after destructive reset in an isolated temporary DB. A handcrafted
    // rows[] object could miss actual spreadsheet classification defects.
    const realBiff8=path.join(dir,'V788-post-reset-0701.xls');
    const rowsFromWorkbook=[
      ['运单号','日报日期','收件人','省份标识','客户名称'],
      ['CC260701373001','2026-07-01','GENERAL','PP','GENERAL'],
      ['CC260701373002','2026-07-01','GENERAL','PP','CCAF'],
      ['TBKH260701373003','2026-07-01','GENERAL','PV','GENERAL'],
      ['CC260701373004','2026-07-01','ALI1688','PV','GENERAL'],
      ['CC260701373005','2026-07-01','SHOPEECN','PP','GENERAL'],
      ['CC260701373006','2026-07-01','SHOPEEVN','PV','GENERAL']
    ];
    const worksheet=XLSX.utils.aoa_to_sheet(rowsFromWorkbook);
    worksheet['!ref']='A1:AZ5000';
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,worksheet,'日报');
    XLSX.writeFile(workbook,realBiff8,{bookType:'biff8'});
    assert.equal(fs.readFileSync(realBiff8).subarray(0,4).toString('hex').toUpperCase(),'D0CF11E0',
      'post-reset import must consume a real OLE BIFF8 xls, not an XLSX renamed to .xls');
    const parsed=parseUnifiedDailyExcel(realBiff8,{reportDate:'2026-07-01',originalName:'7-1.xls'});
    assert.equal(parsed.containerFormat,'OLE_XLS');
    assert.equal(parsed.sourceReconciliation?.balanced,true);
    assert.equal(parsed.summary?.validUniqueWaybills,6);
    assert.equal(parsed.classificationCounts?.WHPP,0,
      'WHPP members remain on their separate daily-source route');
    for(const type of reimportTypes)
      assert.equal(parsed.classificationCounts?.[type],1,
        'each of the six unified boards must classify exactly one BIFF8 member: '+type);
    assert.equal(parsed.sheetDiagnostics?.[0]?.rangeClamped,true,
      'inflated legacy workbook UsedRange cannot hang fresh upload');
    const freshRows=parsed.rows;
    const classificationCounts=parsed.classificationCounts;
    const staged=saveUnifiedImport(parsed,'V788_REAL_BIFF8_AFTER_PURGE');
    assert.equal(staged.reportDate,'2026-07-01');
    assert.equal(staged.sameDateOverwrite,false,'first reimport after purge cannot reuse a stale July batch');
    assert.equal(staged.containerFormat,'OLE_XLS');
    // Explicit exact-file reuse must preserve the new batch and avoid
    // duplicating source members on an accidental immediate resubmission.
    const reused=saveUnifiedImport(parsed,'V788_REAL_BIFF8_DUPLICATE',{reuseExactDuplicate:true});
    assert.equal(reused.duplicateFile,true);
    assert.equal(reused.batchId,staged.batchId);
    assert.equal(reused.snapshotId,staged.snapshotId);
    const stageDb=getDb();
    assert.equal(Number(stageDb.prepare('SELECT COUNT(*) c FROM unified_import_rows').get()?.c||0),6,'first 7/1 import must contain only six fresh unified sample members');
    assert.equal(Number(stageDb.prepare('SELECT COUNT(*) c FROM shipment_daily_snapshots').get()?.c||0),6,'new snapshot membership must match fresh sample');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(*) c FROM shipment_current_state WHERE state='PENDING_SCAN'").get()?.c||0),6,'new members must not inherit stale POD/return terminals');
    // WHPP's daily membership is deliberately independent of unified intake.
    // Exercise the real WHPP source route as the seventh business board.
    const {saveWhppDailyImport}=await import('../src/whppStore.js');
    const whppFresh=saveWhppDailyImport({
      reportDate:'2026-07-01',sourceName:'V788_WHPP_SYNTHETIC',
      batchId:'V788-WHPP-FRESH',snapshotId:'V788-WHPP-FRESH',
      rows:[{shipmentCode:'CE01072690001',sheetName:'V788-FIXTURE',rowNumber:8,
        recipientRaw:'',recipientNormalized:''}]
    });
    assert.equal(whppFresh.reportDate,'2026-07-01','WHPP independent daily import must accept a fresh 7/1 source');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(*) c FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate='2026-07-01'").get()?.c||0),1,
      'WHPP fresh source must persist exactly one independent member');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(*) c FROM shipment_current_state WHERE businessType='WHPP' AND state='PENDING_SCAN'").get()?.c||0),1,
      'WHPP fresh member must not inherit stale terminal evidence');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(*) c FROM shipment_current_state WHERE state='PENDING_SCAN'").get()?.c||0),7,
      'seven business sources must start only with fresh unprocessed members');
    assert.equal(getActiveCompleteShopSet(stageDb)?.members?.length,72,'new import must retain all 72 current CP names');
    assert.equal(getShopCodeMap().size,72,'new import must not merge the retired historical whitelist');
    for(const table of staleTargets) {
      const exists=stageDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if(exists)assert.equal(Number(stageDb.prepare(`SELECT COUNT(*) c FROM "${table}"`).get()?.c||0),0,`new import must not revive old cache: ${table}`);
    }

    // Fail closed: an incomplete CP whitelist must never permit a second
    // destructive clear and must not remove freshly imported July members.
    stageDb.prepare("UPDATE app_meta SET value=? WHERE key='shop_current_complete_codes_v780'")
      .run(JSON.stringify({...activeConfig,members:activeMembers.slice(0,71)}));
    // Refused reset must not even retire legacy purge status artifacts.
    const legacyJobDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
    fs.mkdirSync(legacyJobDir,{recursive:true});
    const legacyJob=path.join(legacyJobDir,'preserve-when-invalid.job.json');
    fs.writeFileSync(legacyJob,JSON.stringify({status:'FAILED',jobId:'SAFE-LEGACY'}));
    assert.equal(inspectDirectPurgeCp72Preflight().cp72Ready,false,
      'preflight must refuse 71 codes before opening the destructive dialog');
    await assert.rejects(
      ()=>executeDirectDataPurge({phrase:DIRECT_PURGE_PHRASE,user:{email:'admin@example.test',role:'ADMIN'}}),
      /V788_PURGE_CP72_INVALID/,
      'incomplete active 72-code CP list must block irreversible purge');
    assert.equal(Number(stageDb.prepare('SELECT COUNT(*) c FROM unified_import_rows').get()?.c||0),6,
      'rejected purge must preserve fresh unified members');
    assert.equal(fs.existsSync(legacyJob),true,
      'invalid CP72 must not retire legacy files before rejecting destructive action');
    const {queueDirectDataPurge}=await import('../src/directDataPurge.js');
    assert.throws(()=>queueDirectDataPurge({
      phrase:DIRECT_PURGE_PHRASE,user:{email:'admin@example.test',role:'ADMIN'}
    }),/V788_PURGE_CP72_INVALID/,'invalid CP72 must block even detached purge queue');
    assert.equal(fs.existsSync(legacyJob),true,
      'rejected queue must leave legacy task ownership intact');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(*) c FROM business_daily_parse_rows WHERE businessType='WHPP'").get()?.c||0),1,
      'rejected purge must preserve fresh WHPP source');
    stageDb.prepare("UPDATE app_meta SET value=? WHERE key='shop_current_complete_codes_v780'").run(activeBefore);
    // Absent active CP72 activation must also fail closed. Otherwise the
    // subsequent import could silently revive the retired 95-code whitelist.
    stageDb.prepare("DELETE FROM app_meta WHERE key='shop_current_complete_codes_v780'").run();
    assert.equal(inspectDirectPurgeCp72Preflight().cp72Ready,false,
      'preflight must refuse missing CP activation before deleting anything');
    await assert.rejects(
      ()=>executeDirectDataPurge({phrase:DIRECT_PURGE_PHRASE,user:{email:'admin@example.test',role:'ADMIN'}}),
      /V788_PURGE_CP72_MISSING/,
      'missing activated 72-code set must block irreversible purge');
    assert.equal(Number(stageDb.prepare('SELECT COUNT(*) c FROM unified_import_rows').get()?.c||0),6,
      'rejected missing-CP purge must leave July reimport intact');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(*) c FROM business_daily_parse_rows WHERE businessType='WHPP'").get()?.c||0),1,
      'rejected missing-CP purge must leave WHPP reimport intact');
    stageDb.prepare("INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?)")
      .run('shop_current_complete_codes_v780',activeBefore,new Date().toISOString());
    assert.equal(inspectDirectPurgeCp72Preflight().cp72Ready,true,
      'restored complete activation is eligible again for a separate deliberate reset');
    // Cleanup fixture deliberately after a rejected request: no delete action
    // should have modified it, whether invoked directly or through the queue.
    fs.rmSync(legacyJob,{force:true});



    // V788: a second distinct reporting day must ADD only new membership.
    // Daily WHPP uses its own import path, unlike the six unified groups.
    const nextRows=freshRows.map((row,i)=>({
      ...row,shipmentCode:'V788020726'+String(i+1).padStart(5,'0'),rowNumber:i+2
    }));
    const nextBatch=saveUnifiedImport({
      reportDate:'2026-07-02',fileHash:'v788-post-purge-synthetic-day2',
      dateDetectionSource:'SYNTHETIC_TEST',dateCandidates:['2026-07-02'],
      dateWasManuallyCorrected:false,containerFormat:'TEST',
      classificationCounts,
      sourceReconciliation:{balanced:true,validUniqueWaybills:6,classifiedWaybills:6},
      regionCounts:{},summary:{validUniqueWaybills:6},
      sheetDiagnostics:[],warnings:[],rows:nextRows
    },'V788_SYNTHETIC_DAY2');
    assert.equal(nextBatch.sameDateOverwrite,false,'July 2 must be a new batch, not an overwrite of July 1');
    assert.notEqual(nextBatch.snapshotId,staged.snapshotId,'two source days must have different snapshot identity');
    const secondWhpp=saveWhppDailyImport({
      reportDate:'2026-07-02',sourceName:'V788_WHPP_SYNTHETIC_DAY2',
      batchId:'V788-WHPP-DAY2',snapshotId:'V788-WHPP-DAY2',
      rows:[{shipmentCode:'CE02072690001',sheetName:'V788-FIXTURE',rowNumber:8,
        recipientRaw:'',recipientNormalized:''}]
    });
    assert.equal(secondWhpp.reportDate,'2026-07-02');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(*) c FROM unified_import_rows WHERE reportDate='2026-07-01'").get()?.c||0),6,
      'July 1 unified members must remain immutable after July 2');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(*) c FROM unified_import_rows WHERE reportDate='2026-07-02'").get()?.c||0),6,
      'July 2 unified members must include only their own source');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(*) c FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate='2026-07-01'").get()?.c||0),1,
      'July 1 WHPP members must survive July 2 independent source');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(*) c FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate='2026-07-02'").get()?.c||0),1,
      'July 2 WHPP must remain independently owned');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(*) c FROM shipment_current_state WHERE state='PENDING_SCAN'").get()?.c||0),14,
      'two-day seven-business import must not reintroduce old POD/return statuses');
    assert.equal(Number(stageDb.prepare("SELECT COUNT(DISTINCT businessType) c FROM shipment_current_state").get()?.c||0),7,
      'fresh two-day data must cover exactly seven business groups');
    assert.equal(getActiveCompleteShopSet(stageDb)?.members?.length,72,
      'activated current CP whitelist must remain valid through consecutive daily uploads');

    // Source-truth endpoint must include separately imported WHPP exactly
    // once per selected day without carrying forward the other day's rows.
    const {readSelectedDateBusinessSourceTruth}=await import('../src/v783SevenBusinessSourceTruth.js');
    for(const [day,snapshot] of [['2026-07-01',staged.snapshotId],['2026-07-02',nextBatch.snapshotId]]){
      const truth=readSelectedDateBusinessSourceTruth(stageDb,{reportDate:day,snapshotId:snapshot});
      assert.equal(truth.source.validUniqueWaybills,6,`unified source total mismatch for ${day}`);
      assert.equal(truth.source.classifiedTotal,6,`unified six-group conservation mismatch for ${day}`);
      assert.equal(truth.whppIndependent.total,1,`separate WHPP membership mismatch for ${day}`);
      assert.equal(truth.whppIndependent.crossBusinessOverlap,0,`WHPP must not overlap other groups on ${day}`);
      assert.equal(truth.display.distinctUnion,7,`seven-group displayed total must include independent WHPP once on ${day}`);
      assert.equal(truth.display.hasUnresolvedConflict,false,`valid selected-day membership must not be marked conflicting on ${day}`);
    }


    const preClearAfter=fs.existsSync(preClearDir)?fs.readdirSync(preClearDir).length:0;
    assert.ok(preClearBefore>0,'fixture must contain one legacy backup');
    assert.equal(preClearAfter,preClearBefore,'direct purge must preserve existing CE QC backups; clearing business data is independent from backup retention');
    assert.equal(result.backupCleanup?.preserved,true,'direct purge must report that existing backups were preserved');
    assert.equal(result.compactResult?.skipped,false,'purged database should be compacted to release SQLite free pages');
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
  assert.match(html,/v560-direct-data-purge\.js\?v=20261017-v788-cp72-1/);
  assert.match(js,/\/api\/admin\/data-purge\/direct/);
  assert.match(js,/\/api\/admin\/data-purge\/direct\/preflight/,
    'clear dialog must check 72 active store codes BEFORE the destructive action');
  assert.match(js,/!cp72PreflightReady/,
    'no CP72 match disables irreversible clear');
  assert.match(js,/installedOnLocalMain!==true/,
    'candidate branch must not expose official clear dialog');
  assert.match(js,/cachedMainMatchesInstalled!==true/,
    'official clear dialog must show the exact locally installed main commit');
  assert.match(js,/formalUpdateVerified!==true/,
    'candidate or old main without post-install proof must not show purge dialog');
  assert.match(fs.readFileSync('server.js','utf8'),/code:'V788_MANAGED_RELEASE_REQUIRED'/,
    'ADMIN API must independently block callers bypassing the protected UI');
  assert.match(js,/原有备份已保留/,
    'success message must match real non-backup-creating, preserve-existing-backups behavior');
  assert.doesNotMatch(js,/未创建或保留 CE QC 业务备份/,
    'false claim that old backups were deleted must never return');
  assert.doesNotMatch(html,/现有 CE QC 备份、业务证据归档和可再生成文件会.*删除/,
    'preflight explanation must not promise to delete backups that backend preserves');
  assert.match(js,/\/api\/admin\/data-purge\/direct\/status\?jobId=/,'UI must poll detached worker status instead of waiting on the destructive request');
  assert.match(js,/\/api\/session/,'direct purge must verify a fresh authenticated session before exposing destructive controls');
  assert.match(js,/encodeURIComponent\(RETURN_TO\)/,'expired sessions must redirect through login and return to the purge console');
  assert.match(js,/INTERNAL_AUTH_REQUIRED/,'direct purge must recognize the explicit session-expired API code');
  assert.match(js,/独立后台线程/,'UI must expose detached execution progress');
  assert.match(js,/永久清除全部业务数据/);
  assert.match(js,/最终确认：永久清空全部业务数据及可再生成业务文件/);
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
    // V788: the detached-worker test needs a valid activated CP72 config.
    // No-backup purge MUST refuse missing activation in actual deployments.
    const cpMembers=Array.from({length:72},(_,i)=>({
      code:'CP'+String(200001+i).padStart(6,'0'),name:'Async CP '+(i+1)
    }));
    db.prepare("INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?)")
      .run('shop_current_complete_codes_v780',JSON.stringify({mode:'COMPLETE',members:cpMembers}),new Date().toISOString());
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
      const active=check.prepare("SELECT value FROM app_meta WHERE key='shop_current_complete_codes_v780'").get();
      assert.equal(JSON.parse(active?.value||'{}')?.members?.length,72,'detached direct purge must retain 72 active CP members');
      assert.equal(check.prepare("SELECT value FROM app_meta WHERE key='v499_fresh_start_tracking_ready'").get()?.value,'1',
        'detached direct purge worker must arm managed auto tracking after restart');
    }finally{check.close();}
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
});


test('V788 full reset cleans historical sources but never deletes protected data folders',()=>{
  const store=fs.readFileSync('src/store.js','utf8');
  const purge=fs.readFileSync('src/directDataPurge.js','utf8');
  const tables=['shopee_delivery_tracking','shopee_delivery_tracking_daily',
    'v207_daily_ownership','v209_import_source_archive','v328_attempt_daily_cache',
    'v329_three_business_daily_cache','v334_generic_history_cache',
    'qc_tracking_ledger','shipment_current_state','unified_import_rows'];
  for(const table of tables)assert.match(store,new RegExp(`['"]${table}['"]`),`missing historical purge table: ${table}`);
  const fileCleanup=purge.slice(purge.indexOf('async function clearRegenerableFiles()'),purge.indexOf('function directResetTransaction('));
  assert.ok(fileCleanup.includes('for(const dir of [cfg.exportsDir,cfg.importsDir,cfg.longJsonExportsDir,cfg.evidenceArchiveDir])'),
    'file cleanup must stay limited to regenerable artifact folders');
  assert.ok(!fileCleanup.includes('cfg.tokenDir')&&!fileCleanup.includes('cfg.backupsDir'),
    'file cleanup must not include token or backup folders');
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
  assert.match(html,/app\.js\?v=20261003-v623-1/,'business routes must receive the V623 application runtime after update');
  assert.match(html,/dashboard-fixture-v18\.js\?v=20261003-v623-1/,'business routes must receive the current V623 bounded startup diagnostics after update');
  assert.doesNotMatch(html,/dashboard-fixture-v18\.js\?v=20260929-v598-1/,'retired V598 cache URL must not return after update');
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


test('V564/V597 post-purge startup stays no-reload while legacy click repair stays retired',()=>{
  const app=fs.readFileSync('public/app.js','utf8');
  const startup=fs.readFileSync('public/dashboard-fixture-v18.js','utf8');
  const sourceTruth=fs.readFileSync('public/v81-startup-source-truth.js','utf8');
  assert.doesNotMatch(startup,/系统界面已可操作，本地数据继续后台读取/);
  assert.doesNotMatch(startup,/typeof global\.refresh === 'function'/);
  assert.doesNotMatch(startup,/typeof global\.renderAll === 'function'/);
  assert.match(startup,/2026-09-21-v565-interaction-surface-self-heal-v1/,'historical V565 marker may remain for compatibility');
  assert.match(startup,/ceQcV597LegacyInteractionRetired/,'V597 must publish that legacy interaction ownership is retired');
  assert.doesNotMatch(startup,/repairInteractionSurface|repairBlockedPointer|ceQcRetiredClickBlocker|document\.elementsFromPoint/,'startup fixture must no longer own hit-testing or pointer\/click repair');
  assert.match(sourceTruth,/location\.replace\('\/\?returnTo='/);
  assert.doesNotMatch(sourceTruth,/location\.reload\(\)/);
  const resetListener=app.match(/events\.addEventListener\('DATA_RESET',[\s\S]*?\n  \}\);/);
  assert.ok(resetListener,'DATA_RESET listener must exist');
  assert.doesNotMatch(resetListener[0],/location\.reload\(\)/,'post-purge refresh failure must not reload the whole application');
  assert.match(resetListener[0],/post-purge refresh deferred/);
});


test('V568 no-backup cleanup script is syntax-valid and launcher wires it before backend startup',()=>{
  const cleanup='scripts/CE_QC_NoBackup_Cleanup.mjs';
  const syntax=spawnSync(process.execPath,['--check',path.join(process.cwd(),cleanup)],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  const source=fs.readFileSync(cleanup,'utf8');
  const start=fs.readFileSync('Start_CE_QC.ps1','utf8');
  const server=fs.readFileSync('server.js','utf8');
  assert.match(source,/CE_QC_UPDATE_VERIFY_/);
  assert.match(source,/EVIDENCE_ARCHIVE/);
  assert.match(source,/compactSqliteStorage/);
  assert.match(fs.readFileSync('src/storageCompaction.js','utf8'),/db\.exec\('VACUUM'\)/);
  assert.match(start,/CE_QC_NoBackup_Cleanup\.mjs/);
  assert.match(start,/CE_QC_NO_BACKUP_MODE = '1'/);
  assert.match(start,/local-login\.html\?v=20260922-v581-1/,'launcher must cache-bust the installed V581 stable login shell');
  assert.match(server,/local-login\.html/);
});


test('V788 managed release proof never trusts stale or wrong-branch Git metadata',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v788-release-proof-'));
  const git=(...args)=>{
    const p=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:15000});
    assert.equal(p.status,0,'isolated Git fixture error: '+args.join(' ')+' '+p.stderr);
    return String(p.stdout||'').trim();
  };
  try{
    const init=spawnSync('git',['init','-q',root],{encoding:'utf8',timeout:15000});
    assert.equal(init.status,0,'Git unavailable for exact-install witness test');
    git('config','user.email','release-fixture@example.test');
    git('config','user.name','Release Fixture');
    fs.writeFileSync(path.join(root,'fixture.txt'),'one');
    git('add','fixture.txt');git('commit','-q','-m','isolated-release');
    git('checkout','-q','-B','main');
    const sha=git('rev-parse','HEAD');
    git('update-ref','refs/remotes/origin/main',sha);
    const {inspectV788InstalledVersionEvidence}=await import('../src/v788InstalledVersionEvidence.js');
    let read=()=>inspectV788InstalledVersionEvidence({projectRoot:root});
    assert.equal(read().formalUpdateVerified,false,'main == cached remote is NOT update proof');
    fs.mkdirSync(path.join(root,'logs'),{recursive:true});
    const receiptPath=path.join(root,'logs','v788_managed_install_receipt.json');
    const receipt={schemaVersion:1,mode:'INSTALLED',installedCommit:sha,
      remoteCommit:sha,candidateGatePassed:true,verifiedAt:new Date().toISOString()};
    fs.writeFileSync(receiptPath,'\uFEFF'+JSON.stringify(receipt));
    assert.equal(read().formalUpdateVerified,true,'exact installation receipt may validate a verified main checkout');
    assert.equal(read().liveRemoteVersionVerified,false,'cached branch SHA never proves live internet freshness');
    fs.writeFileSync(receiptPath,JSON.stringify({...receipt,remoteCommit:'0'.repeat(40)}));
    assert.equal(read().formalUpdateVerified,false,'mismatched receipt remote SHA must fail closed');
    fs.writeFileSync(receiptPath,JSON.stringify({...receipt,candidateGatePassed:false}));
    assert.equal(read().formalUpdateVerified,false,'receipt without candidate tests must be refused');
    fs.writeFileSync(receiptPath,JSON.stringify(receipt));
    git('checkout','-q','-b','candidate');
    assert.equal(read().formalUpdateVerified,false,'working candidate branch must never authorize a destructive clear');
    git('checkout','-q','main');
    fs.writeFileSync(path.join(root,'fixture.txt'),'two');
    git('add','fixture.txt');git('commit','-q','-m','later');
    git('update-ref','refs/remotes/origin/main',git('rev-parse','HEAD'));
    assert.equal(read().formalUpdateVerified,false,'old receipt expires when installed SHA changes');
  }finally{
    fs.rmSync(root,{recursive:true,force:true,maxRetries:15,retryDelay:100});
  }
});
