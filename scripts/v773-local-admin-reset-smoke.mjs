import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const script=path.join(ROOT,'scripts','reset-local-admin-password.mjs');
const ps=fs.readFileSync(path.join(ROOT,'tools','CE_QC_Reset_Admin_Password.ps1'),'utf8');
assert.ok([...ps].every(ch=>ch.charCodeAt(0)<128),'PowerShell 5 script must stay ASCII-only to avoid ANSI mis-decoding');
if (process.platform === 'win32') {
  const file=path.join(ROOT,'tools','CE_QC_Reset_Admin_Password.ps1').replaceAll("'","''");
  const command="$tokens=$null;$issues=$null;[System.Management.Automation.Language.Parser]::ParseFile('"+file+"',[ref]$tokens,[ref]$issues)|Out-Null;if($issues.Count -gt 0){exit 1}";
  const probe=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{cwd:ROOT,timeout:20000,windowsHide:true,encoding:'utf8'});
  assert.equal(probe.status,0,'Windows PowerShell parser rejected password recovery script: '+String(probe.stderr||probe.error||''));
}

for(const required of ['WindowsBuiltInRole','Administrator','Read-Host','-AsSecureString','Get-NetTCPConnection','YES','reset-local-admin-password.mjs']) {
  assert.ok(ps.includes(required),'Windows recovery must require '+required);
}
assert.doesNotMatch(ps,/Start-Process\s+[^\r\n]*-ArgumentList[^\r\n]*password/i,
  'password must never be placed on the command line');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-admin-reset-test-'));
try {
  const dbFile=path.join(tmp,'fixture.sqlite');
  const db=new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE,role TEXT,
      status TEXT,enabled INTEGER,passwordHash TEXT,failedLoginCount INTEGER,
      lockedUntil TEXT,mustChangePassword INTEGER,updatedAt TEXT);
    CREATE TABLE user_sessions(id INTEGER PRIMARY KEY,userId INTEGER,revokedAt TEXT);
    CREATE TABLE business_final_rows(shipmentCode TEXT PRIMARY KEY,isPod INTEGER,primaryCategory TEXT);
  `);
  const originalHash=bcrypt.hashSync('FixtureOldPassword123',4);
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(1,'fixture.admin','ADMIN','ACTIVE',1,originalHash,6,'2099-01-01T00:00:00Z',1,'2026-10-01');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(2,'fixture.viewer','VIEWER','ACTIVE',1,originalHash,0,null,0,'2026-10-01');
  db.prepare('INSERT INTO user_sessions VALUES(?,?,?)').run(1,1,null);
  db.prepare('INSERT INTO user_sessions VALUES(?,?,?)').run(2,2,null);
  db.prepare('INSERT INTO business_final_rows VALUES(?,?,?)').run('CE04072600013',0,'订单取消');
  db.close();
  const tokens=path.join(tmp,'token');
  fs.mkdirSync(tokens,{recursive:true});
  const secretFile=path.join(tokens,'v431_local_auth.secret');
  fs.writeFileSync(secretFile,'fixture-old-signing-secret');

  function run(username,password) {
    const res=spawnSync(process.execPath,[script],{
      cwd:ROOT,encoding:'utf8',input:JSON.stringify({username,password}),timeout:20000,
      env:{...process.env,DB_FILE:dbFile,DATA_DIR:tmp,NODE_NO_WARNINGS:'1'}
    });
    return res;
  }
  const prohibited=run('fixture.viewer','FixtureNewPassword123');
  assert.notEqual(prohibited.status,0,'non-admin cannot reset');
  assert.match(prohibited.stderr,/仅允许重置已启用的现有ADMIN账号/);
  const tooShort=run('fixture.admin','short');
  assert.notEqual(tooShort.status,0,'weak password cannot reset');
  const missing=run('missing.account','FixtureNewPassword123');
  assert.notEqual(missing.status,0,'unknown admin cannot reset');
  const beforeDb=new DatabaseSync(dbFile,{readOnly:true});
  assert.equal(beforeDb.prepare('SELECT passwordHash FROM users WHERE id=1').get().passwordHash,originalHash);
  assert.equal(beforeDb.prepare('SELECT COUNT(*) AS n FROM business_final_rows').get().n,1);
  beforeDb.close();
  const chosen='FixtureNewPassword123';
  const good=run('fixture.admin',chosen);
  assert.equal(good.status,0,'local admin reset must succeed: '+good.stderr);
  assert.match(good.stdout,/SUCCESS \| ADMIN=fixture.admin/);
  assert.ok(!good.stdout.includes(chosen)&&!good.stderr.includes(chosen),'password must not leak');
  const verified=new DatabaseSync(dbFile,{readOnly:true});
  const admin=verified.prepare('SELECT * FROM users WHERE id=1').get();
  const viewer=verified.prepare('SELECT * FROM users WHERE id=2').get();
  assert.equal(admin.failedLoginCount,0);
  assert.equal(admin.lockedUntil,null);
  assert.equal(admin.mustChangePassword,0);
  assert.ok(bcrypt.compareSync(chosen,admin.passwordHash));
  assert.ok(!bcrypt.compareSync('FixtureOldPassword123',admin.passwordHash));
  assert.equal(viewer.passwordHash,originalHash,'another account must remain unchanged');
  assert.ok(verified.prepare('SELECT revokedAt FROM user_sessions WHERE id=1').get().revokedAt);
  assert.equal(verified.prepare('SELECT revokedAt FROM user_sessions WHERE id=2').get().revokedAt,null);
  // node:sqlite get() intentionally returns null-prototype row objects.
  // Compare their actual fields without depending on the JS object prototype.
  assert.deepEqual({...verified.prepare('SELECT * FROM business_final_rows').get()},{
    shipmentCode:'CE04072600013',isPod:0,primaryCategory:'订单取消'
  });
  verified.close();
  assert.notEqual(fs.readFileSync(secretFile,'utf8'),'fixture-old-signing-secret','old local auth cookies must be invalidated on next restart');
  console.log('[V773 LOCAL ADMIN RESET] credential-only atomic update, active ADMIN authorization, lockedUntil reset, session revocation, local secret rotation and unchanged business data PASS');
}finally {
  // Windows Defender/indexers may briefly hold a freshly closed SQLite test
  // directory open. Retry first. Do not allow a cleanup EPERM to mask real
  // test failures or reject a correct credential-only recovery candidate.
  try {
    fs.rmSync(tmp,{recursive:true,force:true,maxRetries:10,retryDelay:250});
  } catch (error) {
    const windowsTransient=process.platform==='win32'
      && ['EPERM','EACCES','EBUSY','ENOTEMPTY'].includes(String(error?.code||''));
    if (!windowsTransient) throw error;
    console.warn('[V773 LOCAL ADMIN RESET] Windows temp cleanup deferred: '+String(error.code)+'; test assertions remain authoritative.');
  }
}
