import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}
function responseHarness(){
  const res=new EventEmitter();res.statusCode=200;res.body=null;
  res.status=function(code){this.statusCode=code;return this;};
  res.json=function(body){this.body=body;return this;};
  return res;
}
function requestFor(user,route='/api/admin/data-purge/prepare'){
  return {user,method:'POST',path:route,originalUrl:route,url:route};
}

test('V505 unreadable/structurally invalid purge sidecars and commit receipts stay fail-closed',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-unreadable-sidecar-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {inspectPurgeWriteFreezeState,reconcilePurgeQueryOnlyNow}=await import('../src/v505PurgeWriteFreezeGuard.js');
  const {inspectGlobalPurgeOwnership,v505PurgeGlobalOwnerGuard}=await import('../src/v505PurgeGlobalGuard.js');
  const db=getDb();const cfg=getRuntimeConfig();
  const executeDir=path.join(cfg.backupsDir,'.purge_execute_jobs');
  fs.mkdirSync(executeDir,{recursive:true});
  const adminA={email:'unreadable-owner@example.test',username:'unreadable-owner',role:'ADMIN'};
  const adminB={email:'other-admin@example.test',username:'other-admin',role:'ADMIN'};
  const executeFile=path.join(executeDir,`${identityKey(adminA)}.job.json`);
  const setExpiredBlock=()=>db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_block_until',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(String(Date.now()-60_000),new Date().toISOString());
  const assertUnknownExecuteState=async(label)=>{
    const freeze=inspectPurgeWriteFreezeState();
    assert.equal(freeze.sqliteActive,false,`${label}: regression must prove sidecar authority after the SQLite deadline is already expired`);
    assert.equal(freeze.active,true,`${label}: existing unreadable execute sidecar must remain active unknown state`);
    assert.equal(freeze.sealed,true,`${label}: unknown execute state must keep the destructive lifecycle sealed`);
    assert.equal(freeze.external?.kind,'EXECUTE');
    assert.equal(freeze.external?.status,'UNKNOWN');
    assert.equal(freeze.external?.workerState,'SIDECAR_UNREADABLE');

    const reconciled=reconcilePurgeQueryOnlyNow();
    assert.equal(reconciled.queryOnly.active,true,`${label}: unknown detached execute state must keep the shared web DB query-only`);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1);

    const own=inspectGlobalPurgeOwnership(adminA);
    assert.equal(own.ownProtected,true);
    assert.equal(own.own[0]?.workerState,'SIDECAR_UNREADABLE');
    let ownNext=false;const ownRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(requestFor(adminA),ownRes,()=>{ownNext=true;});
    assert.equal(ownNext,false,`${label}: same owner must not overwrite an unreadable task state`);
    assert.equal(ownRes.statusCode,423);
    assert.equal(ownRes.body?.code,'DATA_PURGE_OWNER_STATE_UNREADABLE');

    const foreign=inspectGlobalPurgeOwnership(adminB);
    assert.equal(foreign.foreign?.workerState,'SIDECAR_UNREADABLE');
    let foreignNext=false;const foreignRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(requestFor(adminB),foreignRes,()=>{foreignNext=true;});
    assert.equal(foreignNext,false,`${label}: another admin must also be blocked by the unreadable execute sidecar`);
    assert.equal(foreignRes.body?.code,'DATA_PURGE_OWNED_BY_ANOTHER_ADMIN');
    assert.equal(foreignRes.body?.workerState,'SIDECAR_UNREADABLE');
  };
  try{
    setExpiredBlock();

    fs.writeFileSync(executeFile,'{malformed-sidecar','utf8');
    await assertUnknownExecuteState('malformed JSON');

    db.exec('PRAGMA query_only=OFF');
    fs.writeFileSync(executeFile,'{}','utf8');
    await assertUnknownExecuteState('structurally invalid JSON object');

    db.exec('PRAGMA query_only=OFF');
    fs.writeFileSync(executeFile,JSON.stringify({jobId:crypto.randomUUID(),status:'NOT_A_REAL_PURGE_STATE'}),'utf8');
    await assertUnknownExecuteState('unknown sidecar status');

    db.exec('PRAGMA query_only=OFF');
    fs.rmSync(executeFile,{force:true});
    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_last_commit_receipt',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run('{malformed-commit-receipt',new Date().toISOString());
    const receiptFreeze=inspectPurgeWriteFreezeState();
    assert.equal(receiptFreeze.sqliteActive,false,'malformed receipt regression must not rely on a live SQLite purge block');
    assert.equal(receiptFreeze.active,true,'malformed commit receipt must remain protected because prior COMMIT truth is unknown');
    assert.equal(receiptFreeze.sealed,true);
    assert.equal(receiptFreeze.external?.workerState,'COMMIT_RECEIPT_UNREADABLE');
    const receiptReconcile=reconcilePurgeQueryOnlyNow();
    assert.equal(receiptReconcile.queryOnly.active,true,'malformed commit receipt must keep shared web DB query-only');

    const receiptOwnership=inspectGlobalPurgeOwnership(adminA);
    assert.equal(receiptOwnership.commitReceiptUnreadable,true);
    let receiptNext=false;const receiptRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(requestFor(adminA),receiptRes,()=>{receiptNext=true;});
    assert.equal(receiptNext,false,'no purge owner may proceed while durable commit truth is unreadable');
    assert.equal(receiptRes.statusCode,423);
    assert.equal(receiptRes.body?.code,'DATA_PURGE_COMMIT_RECEIPT_UNREADABLE');
    assert.equal(receiptRes.body?.workerState,'COMMIT_RECEIPT_UNREADABLE');

    // A structurally valid but unfinalized receipt is also active destructive
    // truth. If its filesystem sidecar is gone, no administrator may create a
    // replacement DELETE job: manual/recovery tooling must resolve the orphan.
    db.exec('PRAGMA query_only=OFF');
    setExpiredBlock();
    const orphanChallenge=crypto.randomUUID();
    const orphanJob=crypto.randomUUID();
    const committedAt=new Date().toISOString();
    db.prepare("UPDATE app_meta SET value=?,updatedAt=? WHERE key='data_purge_last_commit_receipt'").run(JSON.stringify({version:2,challengeId:orphanChallenge,executeJobId:orphanJob,committedAt,recoveryBlockUntil:Date.now()+24*60*60_000}),committedAt);
    const orphanFreeze=inspectPurgeWriteFreezeState();
    assert.equal(orphanFreeze.active,true);
    assert.equal(orphanFreeze.external?.workerState,'COMMIT_RECEIPT_ORPHANED');
    const orphanOwnership=inspectGlobalPurgeOwnership(adminA);
    assert.equal(orphanOwnership.commitReceiptPending,true);
    assert.equal(orphanOwnership.commitReceiptOrphaned,true);
    let orphanNext=false;const orphanRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(requestFor(adminA),orphanRes,()=>{orphanNext=true;});
    assert.equal(orphanNext,false,'orphaned unfinalized commit receipt must block a replacement purge submission');
    assert.equal(orphanRes.body?.code,'DATA_PURGE_COMMIT_RECEIPT_PENDING_RECOVERY');
    assert.equal(orphanRes.body?.workerState,'COMMIT_RECEIPT_ORPHANED');

    // finalizedAt itself is part of durable truth; a malformed value is unsafe.
    db.exec('PRAGMA query_only=OFF');
    db.prepare("UPDATE app_meta SET value=?,updatedAt=? WHERE key='data_purge_last_commit_receipt'").run(JSON.stringify({version:2,challengeId:orphanChallenge,executeJobId:orphanJob,committedAt,finalizedAt:'not-a-date'}),new Date().toISOString());
    const badFinalized=inspectPurgeWriteFreezeState();
    assert.equal(badFinalized.external?.workerState,'COMMIT_RECEIPT_UNREADABLE');
  }finally{
    try{db.exec('PRAGMA query_only=OFF');}catch{}
    try{db.prepare("DELETE FROM app_meta WHERE key='data_purge_last_commit_receipt'").run();}catch{}
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
