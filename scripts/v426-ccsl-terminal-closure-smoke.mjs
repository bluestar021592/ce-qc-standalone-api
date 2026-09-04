import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v426-terminal-'));
const dbFile=path.join(root,'v426.db');
const ENV_KEYS=['NODE_ENV','ACCESS_MODE','DATA_DIR','DB_FILE','SQLITE_MMAP_BYTES','SQLITE_CACHE_KIB','CE_QC_DISABLE_V246_TRACKING'];
const oldEnv=Object.fromEntries(ENV_KEYS.map(key=>[key,process.env[key]]));
Object.assign(process.env,{
  NODE_ENV:'test',
  ACCESS_MODE:'LOCAL',
  DATA_DIR:root,
  DB_FILE:dbFile,
  SQLITE_MMAP_BYTES:'0',
  SQLITE_CACHE_KIB:'8192',
  CE_QC_DISABLE_V246_TRACKING:'1'
});

const { getDb, closeDb }=await import('../src/db.js');
const { readV418CcslTerminalClosureProof, V426_CCSL_TERMINAL_CLOSURE_PROOF_ID }=await import('../src/v418StatusProofFastPath.js');
const { inspectV317CcslRecovery, prepareV317CcslRecovery, V426_CCSL_TERMINAL_RECOVERY_ID }=await import('../src/v317CcslIncompleteRecoveryPatch.js');
const { readV322SevenBusinessStatus, V426_CCSL_TERMINAL_STATUS_ID }=await import('../src/v322WebAvailabilityPatch.js');
const { readV415CurrentProcessingProof, V426_TERMINAL_COMPLETION_GUARD_ID }=await import('../src/v415RetroactiveCompletionGuard.js');

const db=getDb();

function fillValue(column,value){
  if(value!==undefined)return value;
  if(column.pk)return undefined;
  if(column.dflt_value!==null&&column.dflt_value!==undefined)return undefined;
  if(!column.notnull)return undefined;
  return /INT|REAL|NUM|BOOL/i.test(String(column.type||''))?0:'';
}
function insertRow(table,data={}){
  const info=db.prepare(`PRAGMA table_info(${table})`).all();
  assert.ok(info.length,`fixture table ${table} must exist`);
  const cols=[],vals=[];
  for(const column of info){
    const value=fillValue(column,data[column.name]);
    if(value===undefined)continue;
    cols.push(column.name);vals.push(value);
  }
  const marks=cols.map(()=>'?').join(',');
  db.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${marks})`).run(...vals);
}

function addBatch({batchId,snapshotId,date,createdAt,members=[]}){
  insertRow('unified_import_batches',{batchId,snapshotId,reportDate:date,status:'VALID',createdAt});
  for(const [businessType,shipmentCode] of members){
    insertRow('unified_import_rows',{snapshotId,reportDate:date,businessType,shipmentCode,rowJson:'{}'});
  }
}
function addPodLock(shipmentCode,date,at){
  insertRow('pod_locks',{shipmentCode,source:'V426_FIXTURE',podTime:at,evidenceType:'POD_LOCK',evidenceText:'fixture terminal POD',lastSeenReportDate:date,createdAt:at,updatedAt:at});
}
function setCcslLock({date,runId,status='failed',stage='订单扫描',error='PROCESS_RESTART_INTERRUPTED',at}){
  db.prepare('DELETE FROM run_locks WHERE reportDate=?').run(date);
  insertRow('run_locks',{reportDate:date,runId,status,currentStage:stage,batchIndex:1,totalBatches:1,errorMessage:error,lockedBy:'V426_FIXTURE',lockedAt:at,completedAt:'',updatedAt:at});
}

try{
  const date='2026-09-01';
  const boundary1='2026-09-01T01:00:00.000Z';
  const interruptedAt='2026-09-01T03:00:00.000Z';
  addBatch({
    batchId:'B1',snapshotId:'S1',date,createdAt:boundary1,
    members:[['CE','CE1'],['CEAF','CE2'],['TBKH','CE3'],['ALI1688','CE4']]
  });
  setCcslLock({date,runId:'R_INTERRUPTED',status:'failed',at:interruptedAt});
  for(const bill of ['CE1','CE2','CE3','CE4'])addPodLock(bill,date,'2026-09-01T00:30:00.000Z');

  // There is deliberately NO export_snapshots completion row. This reproduces the
  // production 0/0 + historical POD-lock closure + PROCESS_RESTART_INTERRUPTED state.
  const terminal=readV418CcslTerminalClosureProof(db,{reportDate:date,snapshotId:'S1',force:true});
  assert.equal(terminal.id,V426_CCSL_TERMINAL_CLOSURE_PROOF_ID);
  assert.equal(terminal.source,4);
  assert.equal(terminal.covered,4);
  assert.equal(terminal.missing,0);
  assert.equal(terminal.complete,true,'all exact current members with immutable POD locks must form a complete terminal proof');

  const v317=inspectV317CcslRecovery({db,reportDate:date});
  assert.equal(v317.v426TerminalRecovery,V426_CCSL_TERMINAL_RECOVERY_ID);
  assert.equal(v317.complete,true,'V317 must not keep a fully terminal current cohort in CCSL retry solely because completion snapshot is absent');
  assert.equal(v317.needsResume,false);
  assert.equal(v317.action,'COMPLETE');
  assert.equal(v317.reason,'V426_EXACT_CURRENT_MEMBERS_ALL_POD_LOCKED');
  assert.equal(v317.snapshotId,'','terminal closure must not fabricate an export completion snapshot');

  const prepared=prepareV317CcslRecovery({db,reportDate:date,actor:'V426_SMOKE'});
  assert.equal(prepared.prepared,false,'terminal closure must not create or reopen a CCSL run');
  const lockAfter=db.prepare('SELECT runId,status,errorMessage FROM run_locks WHERE reportDate=?').get(date);
  assert.equal(lockAfter.runId,'R_INTERRUPTED','V426 is read-only truth repair; audit/run pointer is preserved');
  assert.equal(lockAfter.status,'failed');
  assert.match(String(lockAfter.errorMessage||''),/PROCESS_RESTART_INTERRUPTED/);

  const v322=readV322SevenBusinessStatus({db,reportDate:date,force:true});
  assert.equal(v322.v426CcslTerminalStatusId,V426_CCSL_TERMINAL_STATUS_ID);
  assert.equal(v322.stages.CCSL.complete,true,'V322 seven-business status must publish the same terminal closure');
  assert.equal(v322.stages.CCSL.running,false,'stale interrupted/running pointer cannot override terminal current-member truth');
  assert.equal(v322.stages.CCSL.completionClaimSource,'V426_EXACT_CURRENT_MEMBERS_ALL_POD_LOCKED');
  assert.equal(v322.stages.CCSL.terminalClosureProof.covered,4);

  const v415=readV415CurrentProcessingProof({db,reportDate:date,force:true});
  assert.equal(v415.v426TerminalCompletionId,V426_TERMINAL_COMPLETION_GUARD_ID);
  assert.equal(v415.stages.CCSL.complete,true,'V415 guard must accept the exact same terminal proof instead of downgrading V322');
  assert.equal(v415.stages.CCSL.completionClaimSource,'V426_EXACT_CURRENT_MEMBERS_ALL_POD_LOCKED');
  assert.equal(v415.stages.CCSL.covered,4);
  assert.equal(v415.stages.CCSL.missing,0);

  // Hard negative: a newer VALID lifecycle adds one current CCSL member without a
  // POD lock. The old terminal set cannot leak across the new snapshot, even though
  // all four old members remain POD-locked and the stale run pointer still exists.
  const boundary2='2026-09-01T04:00:00.000Z';
  addBatch({
    batchId:'B2',snapshotId:'S2',date,createdAt:boundary2,
    members:[['CE','CE1'],['CEAF','CE2'],['TBKH','CE3'],['ALI1688','CE4'],['CE','CE5']]
  });
  setCcslLock({date,runId:'R_NEW_LIFECYCLE',status:'failed',at:'2026-09-01T05:00:00.000Z'});

  const terminal2=readV418CcslTerminalClosureProof(db,{reportDate:date,snapshotId:'S2',force:true});
  assert.equal(terminal2.source,5);
  assert.equal(terminal2.covered,4);
  assert.equal(terminal2.missing,1);
  assert.equal(terminal2.complete,false,'one uncovered current member must keep CCSL open');

  const v317b=inspectV317CcslRecovery({db,reportDate:date});
  assert.equal(v317b.complete,false,'V317 must remain fail-closed for partial terminal coverage');
  assert.equal(v317b.needsResume,true);
  const v322b=readV322SevenBusinessStatus({db,reportDate:date,force:true});
  assert.equal(v322b.sourceSnapshotId,'S2');
  assert.equal(v322b.stages.CCSL.complete,false,'V322 must not reuse old POD closure across a newer VALID membership');
  assert.equal(v322b.stages.CCSL.terminalClosureProof.missing,1);
  const v415b=readV415CurrentProcessingProof({db,reportDate:date,force:true});
  assert.equal(v415b.batch.snapshotId,'S2');
  assert.equal(v415b.stages.CCSL.complete,false,'V415 must also keep the new partial cohort open');
  assert.equal(v415b.stages.CCSL.missing,5,'without a completion snapshot, partial POD coverage is diagnostic only and cannot become generic processing proof');

  console.log('[V426] CCSL terminal-closure smoke passed · no completion snapshot + exact current VALID membership fully POD-locked closes CCSL without reopening run · V317/V322/V415 agree · interrupted run pointer remains audit-only · UI 0/0 is never proof · one new uncovered member keeps the newer lifecycle incomplete');
} finally {
  try{closeDb();}catch{}
  for(const key of ENV_KEYS){
    if(oldEnv[key]===undefined)delete process.env[key];
    else process.env[key]=oldEnv[key];
  }
  fs.rmSync(root,{recursive:true,force:true});
}
