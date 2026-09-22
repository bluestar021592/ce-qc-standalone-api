import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { analyzeSqliteStorage, compactSqliteStorage, STORAGE_COMPACTION_PATCH } from '../src/storageCompaction.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v576-storage-'));
const dbFile=path.join(root,'live.db');

function rowCount(){
  const db=new DatabaseSync(dbFile);
  try{return Number(db.prepare('SELECT COUNT(*) count FROM daily_reports').get()?.count||0);}
  finally{db.close();}
}
function payloadBytes(){
  const db=new DatabaseSync(dbFile);
  try{return Number(db.prepare('SELECT COALESCE(SUM(length(payload)),0) bytes FROM daily_reports').get()?.bytes||0);}
  finally{db.close();}
}

try{
  const db=new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF; CREATE TABLE daily_reports(id INTEGER PRIMARY KEY, reportDate TEXT, payload BLOB);');
  const insert=db.prepare('INSERT INTO daily_reports(reportDate,payload) VALUES(?,zeroblob(16384))');
  db.exec('BEGIN');
  for(let i=0;i<4096;i+=1) insert.run('2026-09-'+String((i%21)+1).padStart(2,'0'));
  db.exec('COMMIT');
  const beforeDelete=Number(fs.statSync(dbFile).size||0);

  db.exec('BEGIN');
  db.exec('DELETE FROM daily_reports WHERE id<=3072');
  db.exec('COMMIT');
  try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch{}
  db.close();

  const expectedCount=1024;
  const expectedPayload=expectedCount*16384;
  assert.equal(rowCount(),expectedCount,'fixture must retain live business rows before compaction');
  assert.equal(payloadBytes(),expectedPayload,'fixture payload bytes must be stable before compaction');

  const analysis=analyzeSqliteStorage(dbFile);
  assert.equal(analysis.ok,true,analysis.detail||analysis.reason);
  assert.ok(analysis.beforeBytes>40*1024*1024,'fixture DB should be large enough to prove disk reclaim');
  assert.ok(analysis.reclaimableBytes>20*1024*1024,'fixture must contain real SQLite freelist space');
  assert.ok(analysis.reclaimRatio>0.4,'fixture must have a meaningful reclaim ratio');


  const deferred=compactSqliteStorage(dbFile,{minReclaimBytes:1,minReclaimRatio:0,startupSafe:true,maxStartupVacuumBytes:1});
  assert.equal(deferred.compacted,false,'startup-safe mode must never VACUUM a live DB above the startup size cap');
  assert.equal(deferred.reason,'LARGE_DB_STARTUP_COMPACTION_DEFERRED');
  assert.equal(rowCount(),expectedCount,'startup defer must preserve live rows');

  const blocked=compactSqliteStorage(dbFile,{minReclaimBytes:1,minReclaimRatio:0, reserveBytes:Number.MAX_SAFE_INTEGER/4});
  assert.equal(blocked.compacted,false,'insufficient-free-space safety gate must refuse risky VACUUM');
  assert.equal(blocked.reason,'INSUFFICIENT_FREE_SPACE_FOR_SAFE_VACUUM');
  assert.equal(rowCount(),expectedCount,'safety-gate refusal must not alter live rows');

  const result=compactSqliteStorage(dbFile,{minReclaimBytes:1024*1024,minReclaimRatio:0.05,reserveBytes:16*1024*1024});
  assert.equal(result.compacted,true,result.detail||result.reason);
  assert.equal(result.reason,'VACUUM_COMPLETED');
  assert.ok(result.reclaimedBytes>20*1024*1024,'V576 must return meaningful physical disk space');
  assert.ok(result.afterBytes<result.beforeBytes*0.6,'compacted live DB should be materially smaller');
  assert.equal(rowCount(),expectedCount,'VACUUM must preserve every retained business row');
  assert.equal(payloadBytes(),expectedPayload,'VACUUM must preserve retained payload bytes');

  const after=analyzeSqliteStorage(dbFile);
  assert.equal(after.ok,true,after.detail||after.reason);
  assert.ok(after.reclaimableBytes<2*1024*1024,'freelist should be near-zero after V576 VACUUM');
  assert.ok(beforeDelete>result.afterBytes,'final live DB must be smaller than its pre-delete allocation');

  console.log('[V576/V577_STORAGE] fast startup mode defers oversized live DB before VACUUM · safety gate refuses VACUUM without enough free disk · real maintenance VACUUM preserved 1024 live rows/payload bytes · reclaimed '+(result.reclaimedBytes/(1024**2)).toFixed(1)+' MiB · '+STORAGE_COMPACTION_PATCH);
}finally{
  fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:100});
}
