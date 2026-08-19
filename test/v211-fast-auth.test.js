import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { __test, V209_LOGIN_RELIABILITY_VERSION } from '../src/v209LoginReliabilityPatch.js';

const secret='0123456789abcdef0123456789abcdef0123456789abcdef';

test('V212 fast auth token signs and verifies without QC database session writes',()=>{
  const payload={v:212,iat:Date.now(),exp:Date.now()+60_000,channel:'LOCAL',user:{username:'ce002784',role:'ADMIN',businessScope:'ALL'}};
  const token=__test.signFastPayload(payload,secret);
  const verified=__test.verifyFastToken(token,secret);
  assert.equal(verified.channel,'LOCAL');
  assert.equal(verified.user.username,'ce002784');
  assert.match(V209_LOGIN_RELIABILITY_VERSION,/v212-local-readonly-auth-v2/);
});

test('V212 rejects tampered or expired fast auth tokens',()=>{
  const payload={v:212,iat:Date.now()-120_000,exp:Date.now()-60_000,channel:'LOCAL',user:{username:'ce002784',role:'ADMIN'}};
  const expired=__test.signFastPayload(payload,secret);
  assert.equal(__test.verifyFastToken(expired,secret),null);
  const good=__test.signFastPayload({...payload,exp:Date.now()+60_000},secret);
  const tampered=`${good.slice(0,-1)}${good.endsWith('A')?'B':'A'}`;
  assert.equal(__test.verifyFastToken(tampered,secret),null);
});

test('V212 local channel only accepts matching loopback or private LAN endpoints',()=>{
  const req=(host,ip)=>({hostname:host,socket:{remoteAddress:ip},get:name=>name==='host'?host:''});
  assert.equal(__test.localChannel(req('127.0.0.1','127.0.0.1')),'LOCAL');
  assert.equal(__test.localChannel(req('192.168.88.68','192.168.88.20')),'LAN');
  assert.equal(__test.localChannel(req('192.168.88.68','8.8.8.8')),'');
});

test('V212 login source is isolated from runtime getDb initialization and auth writes',()=>{
  const source=fs.readFileSync(new URL('../src/v209LoginReliabilityPatch.js',import.meta.url),'utf8');
  assert.match(source,/new DatabaseSync\(file,\{readOnly:true\}\)/);
  assert.match(source,/PRAGMA query_only=ON/);
  assert.match(source,/PRAGMA busy_timeout=750/);
  assert.doesNotMatch(source,/import \{ getDb/);
  assert.doesNotMatch(source,/getDb\(\)\.prepare\(/);
  assert.doesNotMatch(source,/INSERT INTO user_sessions/);
  assert.doesNotMatch(source,/UPDATE users SET failedLoginCount/);
});

test('V212 read-only auth helper opens a real SQLite file and reads the indexed user row',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v212-auth-'));
  const file=path.join(dir,'auth.db');
  const db=new DatabaseSync(file);
  try{
    db.exec(`CREATE TABLE users(
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE,
      displayName TEXT,
      departmentCompany TEXT,
      email TEXT,
      passwordHash TEXT,
      role TEXT,
      businessScope TEXT,
      enabled INTEGER,
      status TEXT,
      expiresAt TEXT,
      mustChangePassword INTEGER,
      lockedUntil TEXT
    )`);
    db.prepare("INSERT INTO users(id,username,displayName,passwordHash,role,businessScope,enabled,status,mustChangePassword) VALUES(1,'ce002784','CE LEE','hash','ADMIN','ALL',1,'ACTIVE',0)").run();
  }finally{db.close();}
  try{
    const row=__test.readAuthRowFromFile(file,'ce002784');
    assert.equal(row.username,'ce002784');
    assert.equal(row.role,'ADMIN');
    assert.equal(row.enabled,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
