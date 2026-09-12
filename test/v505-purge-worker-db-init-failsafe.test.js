import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}
function runPurgeWorkerOpen(dbFile,dataDir,sealedDbFile=dbFile){
  const source=`
    process.env.CE_QC_PURGE_EXECUTE_CHILD='1';
    process.env.CE_QC_PURGE_SEALED_DB_FILE=${JSON.stringify(sealedDbFile)};
    process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
    process.env.DATA_DIR=${JSON.stringify(dataDir)};
    process.env.DB_FILE=${JSON.stringify(dbFile)};
    const {getDb}=await import('./src/db.js');
    getDb();
    console.log('UNEXPECTED_DB_OPEN_SUCCESS');
  `;
  return spawnSync(process.execPath,['--input-type=module','-e',source],{
    cwd:root,
    encoding:'utf8',
    env:{...process.env,CE_QC_PURGE_EXECUTE_CHILD:'1',CE_QC_PURGE_SEALED_DB_FILE:sealedDbFile,CE_QC_DISABLE_CARRY_REFRESH:'1',DATA_DIR:dataDir,DB_FILE:dbFile}
  });
}
function runSealedPathGuard({dbFile,dataDir,jobFile,jobId,user}){
  const payload={jobFile,jobId,user,request:{}};
  const source=`
    process.env.CE_QC_PURGE_EXECUTE_CHILD='1';
    process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
    process.env.DATA_DIR=${JSON.stringify(dataDir)};
    process.env.DB_FILE=${JSON.stringify(dbFile)};
    const {assertPurgeExecuteSealedDatabasePath}=await import('./src/v505PurgeExecuteReadOnlyPreflight.js');
    assertPurgeExecuteSealedDatabasePath(${JSON.stringify(payload)});
    console.log('UNEXPECTED_PATH_GUARD_SUCCESS');
  `;
  return spawnSync(process.execPath,['--input-type=module','-e',source],{
    cwd:root,
    encoding:'utf8',
    env:{...process.env,CE_QC_PURGE_EXECUTE_CHILD:'1',CE_QC_DISABLE_CARRY_REFRESH:'1',DATA_DIR:dataDir,DB_FILE:dbFile}
  });
}

test('V505 destructive worker never creates or restores a missing sealed source database',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-worker-missing-'));
  const dbFile=path.join(dir,'missing.db');
  try{
    assert.equal(fs.existsSync(dbFile),false);
    const result=runPurgeWorkerOpen(dbFile,dir);
    assert.notEqual(result.status,0);
    assert.match(`${result.stderr}\n${result.stdout}`,/V505_PURGE_EXECUTE_SOURCE_MISSING/);
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`,/UNEXPECTED_DB_OPEN_SUCCESS/);
    assert.equal(fs.existsSync(dbFile),false,'destructive worker must not let DatabaseSync create a replacement source DB');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('V505 destructive DB layer rejects a runtime path that differs from its validated sealed path before SQLite open',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-worker-db-binding-'));
  const dbFile=path.join(dir,'runtime.db');
  const sealedDbFile=path.join(dir,'sealed.db');
  try{
    fs.writeFileSync(dbFile,'must-not-be-opened-or-rewritten','utf8');
    const before=fs.readFileSync(dbFile,'utf8');
    const result=runPurgeWorkerOpen(dbFile,dir,sealedDbFile);
    assert.notEqual(result.status,0);
    assert.match(`${result.stderr}\n${result.stdout}`,/V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED/);
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`,/UNEXPECTED_DB_OPEN_SUCCESS/);
    assert.equal(fs.readFileSync(dbFile,'utf8'),before,'DB-layer path mismatch must fail before DatabaseSync touches the runtime candidate');
    assert.equal(fs.existsSync(sealedDbFile),false,'DB layer must not create the missing sealed path either');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('V505 destructive worker never changes journal mode before source fingerprint validation',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-worker-mode-'));
  const dbFile=path.join(dir,'unsafe-mode.db');
  try{
    const setup=new DatabaseSync(dbFile);
    setup.exec('CREATE TABLE sentinel(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sentinel(value) VALUES(\'keep\');');
    assert.equal(String(setup.prepare('PRAGMA journal_mode').get()?.journal_mode||'').toLowerCase(),'delete');
    setup.close();

    const result=runPurgeWorkerOpen(dbFile,dir);
    assert.notEqual(result.status,0,'purge worker must refuse a non-WAL sealed source instead of switching journal mode');
    assert.match(`${result.stderr}\n${result.stdout}`,/V505_PURGE_EXECUTE_DB_MODE_UNSAFE/);
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`,/UNEXPECTED_DB_OPEN_SUCCESS/);

    const verify=new DatabaseSync(dbFile,{readOnly:true});
    assert.equal(String(verify.prepare('PRAGMA journal_mode').get()?.journal_mode||'').toLowerCase(),'delete','worker must not rewrite journal mode');
    assert.equal(verify.prepare('SELECT value FROM sentinel').get()?.value,'keep');
    verify.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('V505 destructive worker never runs migrations when sealed DB schema differs from current code',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-worker-schema-'));
  const dbFile=path.join(dir,'old-schema.db');
  try{
    const setup=new DatabaseSync(dbFile);
    setup.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT,updatedAt TEXT);
      INSERT INTO app_meta(key,value,updatedAt) VALUES('db_schema_version','1','2026-09-11T00:00:00.000Z');
      CREATE TABLE sentinel(id INTEGER PRIMARY KEY,value TEXT);
      INSERT INTO sentinel(value) VALUES('sealed');
      PRAGMA user_version=1;
    `);
    setup.close();

    const result=runPurgeWorkerOpen(dbFile,dir);
    assert.notEqual(result.status,0,'purge worker must refuse schema drift instead of migrating the sealed source');
    assert.match(`${result.stderr}\n${result.stdout}`,/V505_PURGE_EXECUTE_SCHEMA_MISMATCH/);
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`,/UNEXPECTED_DB_OPEN_SUCCESS/);

    const verify=new DatabaseSync(dbFile,{readOnly:true});
    assert.equal(String(verify.prepare('PRAGMA journal_mode').get()?.journal_mode||'').toLowerCase(),'wal');
    assert.equal(verify.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get()?.value,'1','sealed schema version must remain untouched');
    assert.equal(Number(verify.prepare('PRAGMA user_version').get()?.user_version||0),1);
    assert.equal(verify.prepare('SELECT value FROM sentinel').get()?.value,'sealed');
    assert.equal(verify.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='users'").get()?.count,0,'migration tables must not be created by destructive worker startup');
    verify.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('V505 destructive worker rejects runtime fallback DB path before SQLite is opened or created',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-worker-sealed-path-'));
  const sealedDb=path.join(dir,'sealed-source.db');
  const fallbackDb=path.join(dir,'fallback.db');
  const user={email:'sealed-path@example.test',username:'sealed-path',role:'ADMIN'};
  const key=identityKey(user);
  const prepareDir=path.join(dir,'backups','.purge_prepare_jobs');
  const jobFile=path.join(dir,'execute.job.json');
  const manifestFile=path.join(dir,'sealed-manifest.json');
  const challengeId=crypto.randomUUID();
  const jobId=crypto.randomUUID();
  const future=Date.now()+10*60_000;
  try{
    fs.mkdirSync(prepareDir,{recursive:true});
    fs.writeFileSync(manifestFile,JSON.stringify({databasePath:sealedDb}),'utf8');
    fs.writeFileSync(path.join(prepareDir,`${key}.job.json`),JSON.stringify({
      jobId:crypto.randomUUID(),status:'SUCCEEDED',payload:{challengeId,expiresAt:new Date(future).toISOString(),databasePath:sealedDb}
    }),'utf8');
    fs.writeFileSync(path.join(prepareDir,`${key}.challenge.json`),JSON.stringify({
      challengeId,payload:{databasePath:sealedDb},challenge:{expiresAt:future,backup:{manifestPath:manifestFile}}
    }),'utf8');
    fs.writeFileSync(jobFile,JSON.stringify({kind:'EXECUTE',jobId,challengeId,status:'QUEUED',user,request:{challengeId}}),'utf8');

    assert.equal(fs.existsSync(fallbackDb),false);
    const result=runSealedPathGuard({dbFile:fallbackDb,dataDir:dir,jobFile,jobId,user});
    assert.notEqual(result.status,0);
    assert.match(`${result.stderr}\n${result.stdout}`,/V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED/);
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`,/UNEXPECTED_PATH_GUARD_SUCCESS/);
    assert.equal(fs.existsSync(fallbackDb),false,'sealed-path guard must stop before DatabaseSync can create a fallback DB');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
