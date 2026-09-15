import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function responseHarness(){
  const res=new EventEmitter();
  res.statusCode=200;res.body=null;res.headers=new Map();
  res.status=function(code){this.statusCode=code;return this;};
  res.json=function(body){this.body=body;return this;};
  res.type=function(){return this;};
  res.send=function(body){this.body=body;return this;};
  res.setHeader=function(name,value){this.headers.set(String(name).toLowerCase(),value);};
  res.getHeader=function(name){return this.headers.get(String(name).toLowerCase());};
  return res;
}
function request(cookie=''){
  const headers={host:'localhost:5177',cookie,'user-agent':'v505-test','accept':'application/json'};
  return {
    method:'GET',path:'/api/session',originalUrl:'/api/session',url:'/api/session',hostname:'localhost',
    socket:{remoteAddress:'127.0.0.1'},
    get(name){return headers[String(name||'').toLowerCase()]||'';}
  };
}

test('V546 completed PREPARE keeps auth metadata write-free without leaving the whole application query-only',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-auth-readonly-'));
  process.env.NODE_ENV='test';
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {v505PurgeWriteFreezeGuard}=await import('../src/v505PurgeWriteFreezeGuard.js');
  const {accessIdentity,auditAction}=await import('../src/accessControl.js');
  const db=getDb();
  const now=new Date().toISOString();
  const sessionToken=crypto.randomBytes(32).toString('base64url');
  const sessionHash=crypto.createHash('sha256').update(sessionToken).digest('hex');
  const originalExpiry=new Date(Date.now()+30*60_000).toISOString();
  try{
    const user=db.prepare(`INSERT INTO users(username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,mustChangePassword,createdAt,updatedAt,status)
      VALUES(?,?,?,?,?,'ADMIN','ALL',1,0,?,?,'ACTIVE') RETURNING id`).get('v505-admin','V505 Admin','QC','v505-admin@example.test','not-used',now,now);
    db.prepare(`INSERT INTO user_sessions(userId,sessionHash,accessChannel,cloudflareEmail,ipAddress,userAgent,expiresAt,createdAt)
      VALUES(?,?,?,?,?,?,?,?)`).run(user.id,sessionHash,'LOCAL',null,'127.0.0.1','v505-test',originalExpiry,now);

    const prepareDir=path.join(getRuntimeConfig().backupsDir,'.purge_prepare_jobs');
    fs.mkdirSync(prepareDir,{recursive:true});
    const prepareFile=path.join(prepareDir,'sealed-auth-test.job.json');
    fs.writeFileSync(prepareFile,JSON.stringify({jobId:crypto.randomUUID(),status:'SUCCEEDED',workerPid:0,payload:{expiresAt:new Date(Date.now()+5*60_000).toISOString()}}),'utf8');
    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_block_until',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(String(Date.now()+60*60_000),now);

    const req=request(`ce_internal_session=${sessionToken}`);const res=responseHarness();let freezeNext=false;
    v505PurgeWriteFreezeGuard(req,res,()=>{freezeNext=true;});
    assert.equal(freezeNext,true,'explicit /api/session read must remain reachable');
    assert.equal(req.v505PurgeReadOnlyAuth,true,'completed PREPARE still suppresses session-expiry/audit writes so reopening the page cannot invalidate its sealed fingerprint by itself');
    assert.equal(req.v505PurgeWriteFreezeState?.prepareBlockSuppressed,true);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,0,'completed PREPARE must not keep the whole application connection query-only while it waits for a separate explicit EXECUTE');

    let authNext=false;
    await accessIdentity(req,res,()=>{authNext=true;});
    assert.equal(authNext,true,'existing session should authenticate after PREPARE completion');
    assert.equal(req.user?.username,'v505-admin');
    assert.equal(req.user?.role,'ADMIN');
    assert.equal(db.prepare('SELECT expiresAt FROM user_sessions WHERE sessionHash=?').get(sessionHash)?.expiresAt,originalExpiry,'near-expiry session must not be refreshed merely because the browser reopened a prepared challenge');
    assert.equal(res.getHeader('set-cookie'),undefined,'read-only auth must not rewrite the session cookie');

    const beforeAudit=Number(db.prepare('SELECT COUNT(*) count FROM audit_logs').get()?.count||0);
    auditAction(req,'V505_SHOULD_NOT_WRITE_AUDIT',{phase:'sealed'});
    const afterAudit=Number(db.prepare('SELECT COUNT(*) count FROM audit_logs').get()?.count||0);
    assert.equal(afterAudit,beforeAudit,'access-control audit must remain write-free for the prepared-challenge auth request');

    fs.rmSync(prepareFile,{force:true});
    db.prepare("DELETE FROM app_meta WHERE key='data_purge_block_until'").run();
    const thawReq=request(`ce_internal_session=${sessionToken}`);thawReq.path='/api/health';thawReq.originalUrl='/api/health';thawReq.url='/api/health';
    v505PurgeWriteFreezeGuard(thawReq,responseHarness(),()=>{});
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,0,'main connection remains writable after prepared challenge truth disappears');
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});