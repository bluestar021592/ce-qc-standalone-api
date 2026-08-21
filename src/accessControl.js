import net from 'net';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getDb, nowIso } from './db.js';

const ROLE_LEVEL = Object.freeze({ VIEWER: 1, OPERATOR: 2, ADMIN: 3 });
const LOGIN_LIMIT = 5;
const SESSION_HOURS = 8;
const SESSION_REFRESH_THRESHOLD_MS = 2 * 60 * 60_000;
let jwks = null;

export function validateAccessConfiguration() {
  const publicHost = normalizeHost(process.env.PUBLIC_HOSTNAME || 'ce-qc.cambodian.com');
  if (!publicHost || process.env.NODE_ENV !== 'production') return;
  const missing = ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD'].filter(name => !String(process.env[name] || '').trim());
  if (missing.length) throw new Error(`Missing Cloudflare Access configuration: ${missing.join(', ')}`);
}

export async function accessIdentity(req, res, next) {
  const host = normalizeHost(req.hostname || req.get('host'));
  const remote = normalizeIp(req.socket?.remoteAddress);
  const publicHost = normalizeHost(process.env.PUBLIC_HOSTNAME || 'ce-qc.cambodian.com');
  try {
    if (isInternalAuthPath(req.path)) return handleInternalAuth(req, res, host, remote);
    let channel = '';
    let cloudflareEmail = '';
    if (publicHost && host === publicHost) {
      channel = 'PUBLIC';
      cloudflareEmail = envEnabled('PUBLIC_DIRECT_ENABLED', false) ? '' : await verifyCloudflareIdentity(req);
    } else if (isLoopbackHost(host) && isLoopbackIp(remote)) {
      channel = 'LOCAL';
    } else if (isPrivateHost(host) && String(process.env.ACCESS_MODE || 'DUAL').toUpperCase() === 'DUAL' && envEnabled('LAN_DIRECT_ENABLED', true) && isAllowedLan(remote, process.env.LAN_ALLOWED_CIDRS || '192.168.0.0/16,10.0.0.0/8,172.16.0.0/12')) {
      channel = 'LAN';
    } else {
      return denyPageOrApi(req, res, 403, 'Access denied', publicHost ? `Please use https://${publicHost}` : 'Contact the system administrator.');
    }
    let user = readSession(req, channel, cloudflareEmail);
    if (user) {
      user = refreshSessionIfNeeded(req, res, user, channel);
      req.user = user;
      req.accessMode = channel;
      req.cloudflareEmail = cloudflareEmail;
      return next();
    }
    return loginPage(req, res, { channel, cloudflareEmail, bootstrap: channel === 'LOCAL' && userCount() === 0 });
  } catch (error) {
    return denyPageOrApi(req, res, 401, 'Authentication required', error?.message || 'Please sign in again.');
  }
}

function isInternalAuthPath(pathname) {
  return /^\/api\/(?:internal-auth\/(?:bootstrap|login|logout|change-password)|local-auth\/login)$/.test(pathname);
}

async function handleInternalAuth(req, res, host, remote) {
  const publicHost = normalizeHost(process.env.PUBLIC_HOSTNAME || 'ce-qc.cambodian.com');
  let channel = '';
  let cloudflareEmail = '';
  try {
    if (publicHost && host === publicHost) { channel = 'PUBLIC'; cloudflareEmail = envEnabled('PUBLIC_DIRECT_ENABLED', false) ? '' : await verifyCloudflareIdentity(req); }
    else if (isLoopbackHost(host) && isLoopbackIp(remote)) channel = 'LOCAL';
    else if (isPrivateHost(host) && String(process.env.ACCESS_MODE || 'DUAL').toUpperCase() === 'DUAL' && isAllowedLan(remote, process.env.LAN_ALLOWED_CIDRS || '192.168.0.0/16,10.0.0.0/8,172.16.0.0/12')) channel = 'LAN';
    else return res.status(403).json({ ok: false, error: 'Access channel is not allowed.' });
  } catch (error) { return res.status(401).json({ ok: false, error: error.message || 'Cloudflare Access authentication failed.' }); }

  if (req.path.endsWith('/logout')) {
    revokeCookieSession(req);
    clearSessionCookie(res, channel);
    return res.json({ ok: true });
  }
  if (req.path.endsWith('/bootstrap')) {
    if (channel !== 'LOCAL' || userCount() !== 0) return res.status(403).json({ ok: false, error: 'Bootstrap is unavailable.' });
    return createFirstAdmin(req, res, channel);
  }
  if (req.path.endsWith('/change-password')) {
    const user = readSession(req, channel, cloudflareEmail);
    if (!user) return res.status(401).json({ ok: false, error: 'Please sign in first.' });
    return changePassword(req, res, user);
  }
  return loginInternalUser(req, res, channel, cloudflareEmail);
}

function createFirstAdmin(req, res, channel) {
  const username = cleanUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const displayName = String(req.body?.displayName || username).trim().slice(0, 80);
  const email = cleanEmail(req.body?.email);
  if (!username || !validPassword(password)) return res.status(400).json({ ok: false, error: 'Username and a password of at least 10 characters are required.' });
  const now = nowIso();
  try {
    const hash = bcrypt.hashSync(password, 12);
    const row = getDb().prepare(`INSERT INTO users(username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,mustChangePassword,createdAt,updatedAt) VALUES(?,?,?,?,?,'ADMIN','ALL',1,0,?,?) RETURNING *`)
      .get(username, displayName, String(req.body?.departmentCompany || '').trim().slice(0, 120), email || null, hash, now, now);
    auditAction(req, 'USER_BOOTSTRAP_ADMIN_CREATED', { username });
    return issueSession(res, row, req, channel, '', false);
  } catch (error) { return res.status(409).json({ ok: false, error: 'Username or email is already in use.' }); }
}

function loginInternalUser(req, res, channel, cloudflareEmail) {
  const username = cleanUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const row = getDb().prepare("SELECT * FROM users WHERE username=? AND status='ACTIVE'").get(username);
  const now = new Date();
  if (row?.lockedUntil && new Date(row.lockedUntil) > now) return res.status(423).json({ ok: false, error: 'This account is temporarily locked. Please try again later.' });
  if (!row || !bcrypt.compareSync(password, row.passwordHash || '')) return loginFailure(req, res, row, 'Invalid username or password.');
  if (!Number(row.enabled)) return res.status(403).json({ ok: false, error: 'This account is disabled.' });
  if (row.expiresAt && new Date(row.expiresAt) <= now) return res.status(403).json({ ok: false, error: 'This account has expired.' });
  if (channel === 'PUBLIC' && cloudflareEmail && (!row.email || row.email.toLowerCase() !== cloudflareEmail.toLowerCase())) return res.status(403).json({ ok: false, error: 'Internal account email does not match Cloudflare Access identity.' });
  getDb().prepare('UPDATE users SET failedLoginCount=0,lockedUntil=NULL,lastLoginAt=?,updatedAt=? WHERE id=?').run(nowIso(), nowIso(), row.id);
  const user = getDb().prepare("SELECT * FROM users WHERE id=? AND status='ACTIVE'").get(row.id);
  auditAction(req, 'LOGIN_SUCCESS', { username, accessChannel: channel });
  return issueSession(res, user, req, channel, cloudflareEmail, Boolean(user.mustChangePassword));
}

function loginFailure(req, res, row, message) {
  let lockedNow = false;
  if (row) {
    const attempts = Number(row.failedLoginCount || 0) + 1;
    const lockedUntil = attempts >= LOGIN_LIMIT ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    lockedNow = Boolean(lockedUntil);
    getDb().prepare('UPDATE users SET failedLoginCount=?,lockedUntil=?,updatedAt=? WHERE id=?').run(attempts, lockedUntil, nowIso(), row.id);
    auditAction(req, lockedNow ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', { username: row.username, attempts });
  } else auditAction(req, 'LOGIN_FAILED', { username: cleanUsername(req.body?.username) });
  return res.status(lockedNow ? 423 : 401).json({ ok: false, error: lockedNow ? 'This account is temporarily locked. Please try again later.' : message });
}

function changePassword(req, res, user) {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const row = getDb().prepare("SELECT * FROM users WHERE id=? AND status='ACTIVE'").get(user.id);
  if (!row || !bcrypt.compareSync(currentPassword, row.passwordHash)) return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
  if (!validPassword(newPassword)) return res.status(400).json({ ok: false, error: 'New password must contain at least 10 characters.' });
  getDb().prepare('UPDATE users SET passwordHash=?,mustChangePassword=0,updatedAt=? WHERE id=?').run(bcrypt.hashSync(newPassword, 12), nowIso(), row.id);
  getDb().prepare('UPDATE user_sessions SET revokedAt=? WHERE userId=? AND revokedAt IS NULL').run(nowIso(), row.id);
  auditAction(req, 'PASSWORD_CHANGED', { username: row.username });
  return res.json({ ok: true, reloginRequired: true });
}

function issueSession(res, row, req, channel, cloudflareEmail, mustChangePassword) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60_000).toISOString();
  getDb().prepare('INSERT INTO user_sessions(userId,sessionHash,accessChannel,cloudflareEmail,ipAddress,userAgent,expiresAt,createdAt) VALUES(?,?,?,?,?,?,?,?)')
    .run(row.id, sha256(raw), channel, cloudflareEmail || null, normalizeIp(req.socket?.remoteAddress), String(req.get('user-agent') || '').slice(0, 300), expiresAt, nowIso());
  res.setHeader('Set-Cookie', `ce_internal_session=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${channel === 'PUBLIC' ? '; Secure' : ''}`);
  return res.json({ ok: true, user: publicUser(row), mustChangePassword, expiresAt });
}

function readSession(req, channel, cloudflareEmail) {
  const token = cookieValue(req, 'ce_internal_session');
  if (!token) return null;
  const row = getDb().prepare(`SELECT s.id AS sessionId,s.expiresAt AS sessionExpiresAt,u.* FROM user_sessions s JOIN users u ON u.id=s.userId WHERE s.sessionHash=? AND s.revokedAt IS NULL AND s.expiresAt>?`).get(sha256(token), nowIso());
  if (!row || !Number(row.enabled) || (row.sessionExpiresAt && new Date(row.sessionExpiresAt) <= new Date())) return null;
  if (channel === 'PUBLIC' && cloudflareEmail && (!row.email || row.email.toLowerCase() !== cloudflareEmail.toLowerCase())) return null;
  return { ...row, department: row.departmentCompany || '', devMode: channel === 'LOCAL' };
}

function refreshSessionIfNeeded(req, res, user, channel) {
  const expiresAtMs = Date.parse(user.sessionExpiresAt || '');
  if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > SESSION_REFRESH_THRESHOLD_MS) return user;
  const token = cookieValue(req, 'ce_internal_session');
  if (!token) return user;
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60_000).toISOString();
  getDb().prepare('UPDATE user_sessions SET expiresAt=? WHERE id=? AND sessionHash=? AND revokedAt IS NULL')
    .run(expiresAt, user.sessionId, sha256(token));
  res.setHeader('Set-Cookie', `ce_internal_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${channel === 'PUBLIC' ? '; Secure' : ''}`);
  return { ...user, sessionExpiresAt: expiresAt };
}

function revokeCookieSession(req) { const token = cookieValue(req, 'ce_internal_session'); if (token) getDb().prepare('UPDATE user_sessions SET revokedAt=? WHERE sessionHash=?').run(nowIso(), sha256(token)); }
function clearSessionCookie(res, channel) { res.setHeader('Set-Cookie', `ce_internal_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${channel === 'PUBLIC' ? '; Secure' : ''}`); }
function userCount() { return Number(getDb().prepare("SELECT COUNT(*) AS count FROM users WHERE status='ACTIVE'").get()?.count || 0); }

export function requireRole(minimumRole) {
  return (req, res, next) => {
    if ((ROLE_LEVEL[req.user?.role] || 0) < (ROLE_LEVEL[minimumRole] || 99)) { auditAction(req, 'PERMISSION_DENIED', { requiredRole: minimumRole }); return res.status(403).json({ ok: false, error: 'Permission denied.' }); }
    next();
  };
}

export function requireBusinessScope(businessType) {
  return (req, res, next) => {
    const requested = String(businessType || req.body?.businessType || req.query?.businessType || '').toUpperCase();
    const scope = String(req.user?.businessScope || 'ALL').toUpperCase();
    if (requested && requested !== 'ALL' && scope !== 'ALL' && scope !== requested) { auditAction(req, 'PERMISSION_DENIED', { requestedBusiness: requested }); return res.status(403).json({ ok: false, error: 'Business scope denied.' }); }
    next();
  };
}

export function sameOriginWriteGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || req.accessMode !== 'PUBLIC') return next();
  const origin = String(req.get('origin') || '').replace(/\/$/, '');
  const expected = String(process.env.PUBLIC_ORIGIN || `https://${process.env.PUBLIC_HOSTNAME || 'ce-qc.cambodian.com'}`).replace(/\/$/, '');
  if (origin && origin !== expected) return res.status(403).json({ ok: false, error: 'Request origin verification failed.' });
  next();
}

export function auditAction(req, action, detail = {}) {
  const body = JSON.stringify(detail, (key, value) => /password|token|cookie|authorization/i.test(key) ? '[REDACTED]' : value);
  getDb().prepare('INSERT INTO audit_logs(userEmail,userRole,action,businessType,reportDate,runId,detailJson,ipAddress,createdAt) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(req.user?.email || req.user?.username || '', req.user?.role || '', action, String(detail.businessType || ''), String(detail.reportDate || ''), String(detail.runId || ''), body, normalizeIp(req.socket?.remoteAddress), nowIso());
}

export function publicUser(user = {}) { return { id: user.id || '', username: user.username || '', email: user.email || '', displayName: user.displayName || '', department: user.departmentCompany || user.department || '', role: user.role || 'VIEWER', businessScope: user.businessScope || 'ALL', mustChangePassword: Boolean(user.mustChangePassword), devMode: Boolean(user.devMode) }; }

async function verifyCloudflareIdentity(req) {
  const assertion = String(req.get('Cf-Access-Jwt-Assertion') || '').trim();
  if (!assertion) throw new Error('Cloudflare Access sign-in is required.');
  const teamDomain = normalizeTeamDomain(process.env.CF_ACCESS_TEAM_DOMAIN);
  const audience = String(process.env.CF_ACCESS_AUD || '').trim();
  if (!teamDomain || !audience) throw new Error('Cloudflare Access is not configured.');
  jwks ||= createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(assertion, jwks, { issuer: teamDomain, audience });
  const email = String(payload.email || payload.sub || '').trim().toLowerCase();
  if (!email) throw new Error('Cloudflare Access identity is incomplete.');
  return email;
}

function loginPage(req, res, { channel, bootstrap }) {
  if (req.path.startsWith('/api/')) return res.status(401).json({
    ok: false,
    code: bootstrap ? 'INTERNAL_BOOTSTRAP_REQUIRED' : 'INTERNAL_AUTH_REQUIRED',
    reloginRequired: !bootstrap,
    error: bootstrap ? '需要先创建系统管理员。' : '系统登录已过期，请重新登录后继续处理。'
  });
  const endpoint = bootstrap ? '/api/internal-auth/bootstrap' : '/api/internal-auth/login';
  const title = bootstrap ? 'Initialize administrator' : 'CE QC internal sign-in';
  return res.status(401).type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f3f6fa;color:#17324d;font:15px/1.6 system-ui,'Microsoft YaHei',sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(400px,calc(100% - 40px));background:#fff;border:1px solid #dce5ef;border-radius:8px;padding:28px;box-shadow:0 12px 36px #16395b18}h1{font-size:22px;margin:0 0 18px}label{display:block;margin:12px 0 4px}input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #cbd8e5;border-radius:5px}button{width:100%;margin-top:18px;border:0;border-radius:5px;background:#126ee8;color:#fff;padding:11px;font-weight:700}#error{color:#b42318;margin-top:10px}</style><main class="box"><h1>${bootstrap ? '创建首个管理员' : 'CE质控系统内部登录'}</h1><form id="login">${bootstrap ? '<label>姓名</label><input name="displayName" required><label>邮箱</label><input name="email" type="email">' : ''}<label>用户名</label><input name="username" autocomplete="username" required><label>密码</label><input name="password" type="password" autocomplete="current-password" required><button>${bootstrap ? '创建管理员' : '登录'}</button><div id="error"></div></form></main><script>document.getElementById('login').addEventListener('submit',async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.target));const r=await fetch('${endpoint}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(r.ok)location.href='/';else document.getElementById('error').textContent=j.error||'登录失败';});</script>`);
}

function cleanUsername(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 60); }
function cleanEmail(value) { const email = String(value || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''; }
function validPassword(value) { return String(value || '').length >= 10; }
function cookieValue(req, name) { return String(req.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function envEnabled(name, fallback) { const value = process.env[name]; return value == null || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value); }
function normalizeTeamDomain(value) { const domain = String(value || '').trim().replace(/\/$/, ''); return !domain ? '' : (/^https:\/\//i.test(domain) ? domain : `https://${domain}`); }
function normalizeHost(value) { return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split(':')[0]; }
function normalizeIp(value) { return String(value || '').replace(/^::ffff:/, ''); }
function isLoopbackHost(host) { return ['localhost', '127.0.0.1', '::1'].includes(host); }
function isLoopbackIp(ip) { return ip === '127.0.0.1' || ip === '::1'; }
function isPrivateHost(host) { return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host); }
function isAllowedLan(ip, cidrs) { return String(cidrs || '').split(',').map(v => v.trim()).filter(Boolean).some(cidr => inCidr(ip, cidr)); }
function inCidr(ip, cidr) { if (net.isIP(ip) !== 4) return false; const [base, bitsText] = cidr.split('/'); if (net.isIP(base) !== 4) return false; const bits = Number(bitsText ?? 32); const toInt = v => v.split('.').reduce((n, p) => ((n << 8) + Number(p)) >>> 0, 0); const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0; return (toInt(ip) & mask) === (toInt(base) & mask); }
function denyPageOrApi(req, res, status, title, message) { if (req.path.startsWith('/api/') || !String(req.get('accept') || '').includes('text/html')) return res.status(status).json({ ok: false, error: title, message }); return res.status(status).type('html').send(`<!doctype html><meta charset="utf-8"><title>${title}</title><main><h1>${title}</h1><p>${message}</p></main>`); }
