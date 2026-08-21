import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getSystemDb, nowIso } from './db.js';

const COOKIE='ce_qc_next_session';
const SESSION_HOURS=8;
const ROLE_LEVEL={VIEWER:1,OPERATOR:2,ADMIN:3};
const hash=value=>crypto.createHash('sha256').update(String(value||'')).digest('hex');

export function authMiddleware(req,res,next){
  if(req.path==='/api/health'||req.path.startsWith('/assets/')||req.path==='/login')return next();
  if(req.path==='/api/auth/login'||req.path==='/api/auth/bootstrap')return next();
  const token=cookie(req,COOKIE);
  if(!token){if(req.path.startsWith('/api/'))return res.status(401).json({ok:false,code:'AUTH_REQUIRED',error:'请先登录CE质控系统。'});return res.redirect('/login');}
  const row=getSystemDb().prepare(`SELECT s.id sessionId,s.expiresAt,u.* FROM sessions s JOIN users u ON u.id=s.userId WHERE s.sessionHash=? AND s.revokedAt IS NULL AND s.expiresAt>? AND u.enabled=1 LIMIT 1`).get(hash(token),nowIso());
  if(!row){clearCookie(res);if(req.path.startsWith('/api/'))return res.status(401).json({ok:false,code:'AUTH_EXPIRED',error:'登录已过期，请重新登录。'});return res.redirect('/login');}
  req.user=row;
  next();
}

export function authRoutes(app){
  app.get('/api/auth/session',(req,res)=>res.json({ok:true,user:publicUser(req.user)}));
  app.post('/api/auth/login',(req,res)=>{
    const username=String(req.body?.username||'').trim().toLowerCase();
    const password=String(req.body?.password||'');
    const row=getSystemDb().prepare('SELECT * FROM users WHERE username=? AND enabled=1 LIMIT 1').get(username);
    if(!row||!bcrypt.compareSync(password,row.passwordHash||''))return res.status(401).json({ok:false,code:'INVALID_CREDENTIALS',error:'用户名或密码错误。'});
    const raw=crypto.randomBytes(32).toString('base64url');
    const expiresAt=new Date(Date.now()+SESSION_HOURS*3600_000).toISOString();
    const db=getSystemDb();
    db.prepare('INSERT INTO sessions(userId,sessionHash,expiresAt,createdAt) VALUES(?,?,?,?)').run(row.id,hash(raw),expiresAt,nowIso());
    db.prepare('UPDATE users SET lastLoginAt=?,updatedAt=? WHERE id=?').run(nowIso(),nowIso(),row.id);
    db.prepare('INSERT INTO audit_logs(userId,action,detailJson,createdAt) VALUES(?,?,?,?)').run(row.id,'LOGIN_SUCCESS',JSON.stringify({username:row.username}),nowIso());
    setCookie(res,raw);
    res.json({ok:true,user:publicUser(row),expiresAt});
  });
  app.post('/api/auth/logout',(req,res)=>{
    const token=cookie(req,COOKIE);if(token)getSystemDb().prepare('UPDATE sessions SET revokedAt=? WHERE sessionHash=? AND revokedAt IS NULL').run(nowIso(),hash(token));
    clearCookie(res);res.json({ok:true});
  });
  app.post('/api/auth/bootstrap',(req,res)=>{
    const count=Number(getSystemDb().prepare('SELECT COUNT(*) count FROM users').get()?.count||0);
    if(count>0)return res.status(409).json({ok:false,error:'系统账户已经存在。'});
    const username=String(req.body?.username||'').trim().toLowerCase();const password=String(req.body?.password||'');
    if(!/^[a-z0-9_.-]{2,60}$/.test(username)||password.length<10)return res.status(400).json({ok:false,error:'用户名无效或密码少于10位。'});
    const now=nowIso();getSystemDb().prepare(`INSERT INTO users(username,displayName,passwordHash,role,businessScope,enabled,mustChangePassword,createdAt,updatedAt) VALUES(?,?,?,'ADMIN','ALL',1,0,?,?)`).run(username,String(req.body?.displayName||username).slice(0,80),bcrypt.hashSync(password,12),now,now);
    res.json({ok:true});
  });
}

export function requireRole(role){return(req,res,next)=>{if((ROLE_LEVEL[req.user?.role]||0)<(ROLE_LEVEL[role]||99))return res.status(403).json({ok:false,error:'当前账号权限不足。'});next();};}
export function publicUser(row={}){return{id:row.id||'',username:row.username||'',displayName:row.displayName||row.username||'',department:row.departmentCompany||'',email:row.email||'',role:row.role||'VIEWER',businessScope:row.businessScope||'ALL'};}

function cookie(req,name){return String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||'';}
function setCookie(res,value){res.setHeader('Set-Cookie',`${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS*3600}`);}
function clearCookie(res){res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);}
