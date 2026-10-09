// Local, OS-console-only recovery for an existing CE QC ADMIN.
// No HTTP route. No CLI password arguments. Only the selected account's
// credential/lock and its sessions are changed; business tables are untouched.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { getRuntimeConfig } from '../src/db.js';

function fail(message) {
  process.stderr.write('[CE QC PASSWORD RESET] '+message+'\n');
  process.exitCode=1;
}
function reset(payload) {
  const username=String(payload?.username||'').trim().toLowerCase();
  const password=String(payload?.password||'');
  if(!/^[a-z0-9_.-]{1,60}$/.test(username))throw Error('管理员用户名格式不正确。');
  if(password.length<10||Buffer.byteLength(password,'utf8')>72||/[\r\n\0]/.test(password))
    throw Error('新密码至少10位、不超过72个UTF-8字节，且不能包含换行。');
  const cfg=getRuntimeConfig();
  if(!fs.existsSync(cfg.dbFile)||!fs.statSync(cfg.dbFile).isFile()||fs.statSync(cfg.dbFile).size<4096)
    throw Error('未找到现有CE QC数据库，已停止；不会创建新数据库。');
  const db=new DatabaseSync(cfg.dbFile);
  let committed=false;
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if(!db.prepare("SELECT 1 AS yes FROM sqlite_master WHERE type='table' AND name='users'").get())
      throw Error('数据库缺少users账号表；已停止。');
    if(!db.prepare("SELECT 1 AS yes FROM sqlite_master WHERE type='table' AND name='user_sessions'").get())
      throw Error('数据库缺少user_sessions会话表；已停止。');
    const user=db.prepare('SELECT id,username,role,status,enabled FROM users WHERE username=? LIMIT 1').get(username);
    if(!user)throw Error('未找到该管理员账号，请核对用户名。');
    if(String(user.role||'').toUpperCase()!=='ADMIN'||String(user.status||'').toUpperCase()!=='ACTIVE'||Number(user.enabled)!==1)
      throw Error('仅允许重置已启用的现有ADMIN账号；不会改变账号角色或启用状态。');
    const hashed=bcrypt.hashSync(password,12);
    const now=new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const update=db.prepare("UPDATE users SET passwordHash=?,failedLoginCount=0,lockedUntil=NULL,mustChangePassword=0,updatedAt=? WHERE id=? AND role='ADMIN' AND status='ACTIVE' AND enabled=1")
        .run(hashed,now,user.id);
      if(Number(update.changes)!==1)throw Error('管理员账号状态发生变化；未执行重置。');
      const revoked=db.prepare('UPDATE user_sessions SET revokedAt=? WHERE userId=? AND revokedAt IS NULL').run(now,user.id);
      db.exec('COMMIT');
      committed=true;
      // All old local-auth cookies are invalidated at the next app restart.
      // This secret is NOT a business record; local auth recreates it if missing.
      const secretFile=path.join(cfg.tokenDir,'v431_local_auth.secret');
      let secretRotated=false;
      try {
        if(fs.existsSync(secretFile)){
          const tmp=secretFile+'.reset-'+crypto.randomBytes(6).toString('hex');
          try {
            fs.writeFileSync(tmp,crypto.randomBytes(48).toString('base64url'),{encoding:'utf8',mode:0o600,flag:'wx'});
            fs.renameSync(tmp,secretFile);
            secretRotated=true;
          } finally {
            if(fs.existsSync(tmp))fs.unlinkSync(tmp);
          }
        }else{
          secretRotated=true; // next start makes a fresh session secret
        }
      }catch(error){
        process.stderr.write('[CE QC PASSWORD RESET] 注意：本地登录签名密钥轮换失败，请将系统保持关闭并联系管理员检查会话安全。\n');
      }
      return {ok:true,username:user.username,revokedSessions:Number(revoked.changes||0),localSessionSecretRotated:secretRotated};
    }catch(error){db.exec('ROLLBACK');throw error}
  }finally{db.close()}
}
try {
  const raw=fs.readFileSync(0,'utf8');
  if(Buffer.byteLength(raw,'utf8')>4096)throw Error('提交数据过大，已停止。');
  const payload=JSON.parse(raw);
  const result=reset(payload);
  process.stdout.write('[CE QC PASSWORD RESET] '+(result.ok?'SUCCESS':'FAILED')+' | ADMIN='+result.username+
    ' | historical business data unchanged | expired sessions='+result.revokedSessions+
    ' | local cookies invalidated='+result.localSessionSecretRotated+'\n');
}catch(error){fail(error?.message||'本机密码重置失败。')}
