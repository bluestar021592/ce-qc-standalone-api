import net from 'net';
import http from 'node:http';
import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getDb, nowIso, getRuntimeConfig } from './db.js';

const ROLE_LEVEL = Object.freeze({ VIEWER: 1, OPERATOR: 2, ADMIN: 3 });
const LOGIN_LIMIT = 5;
const SESSION_HOURS = 8;
const SESSION_REFRESH_THRESHOLD_MS = 2 * 60 * 60_000;
const LOCAL_AUTH_COOKIE = 'ce_qc_local_auth_v431';
const AUTH_SIDECAR_PORT = Math.max(1024, Math.min(65535, Number(process.env.CE_QC_AUTH_SIDECAR_PORT || 5179)));
const PURGE_STATUS_PATH=/^\/purge-status\/[a-f0-9]{48}\.json$/i;
const PURGE_PREPARE_AUDITS=new Set(['DATA_PURGE_REQUESTED','DATA_PURGE_BACKUP_VERIFIED']);
export const V430_INTERNAL_LOGIN_FALLBACK_ID = '2026-09-05-v430-native-form-login-fallback-v1';
export const V431_LOCAL_AUTH_SIDECAR_ID = '2026-09-05-v431-readonly-local-auth-sidecar-v1';
let jwks = null;
let authSidecarChild = null;
let authSidecarStopping = false;
let authSidecarRestartTimer = null;
let localAuthSecretCache = '';

function startLocalAuthSidecar() {
  if (String(process.env.CE_QC_LOCAL_AUTH_CHILD || '') === '1' || String(process.env.NODE_ENV || '').toLowerCase() === 'test' || authSidecarChild) return;
  const file = fileURLToPath(new URL('./localAuthSidecar.js', import.meta.url));
  try {
    authSidecarChild = spawn(process.execPath, [file], {
      cwd: process.cwd(),
      env: { ...process.env, CE_QC_LOCAL_AUTH_CHILD: '1', CE_QC_AUTH_SIDECAR_PORT: String(AUTH_SIDECAR_PORT) },
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'inherit', 'inherit']
    });
    console.log(`[CE-QC][V431_AUTH_SIDECAR] starting pid=${authSidecarChild.pid || '-'} port=${AUTH_SIDECAR_PORT}`);
    authSidecarChild.once('error', error => console.error('[CE-QC][V431_AUTH_SIDECAR] spawn failed:', error?.stack || error));
    authSidecarChild.once('exit', (code, signal) => {
      console.log(`[CE-QC][V431_AUTH_SIDECAR] exited code=${code ?? 'null'}${signal ? ` signal=${signal}` : ''}`);
      authSidecarChild = null;
      if (!authSidecarStopping) {
        clearTimeout(authSidecarRestartTimer);
        authSidecarRestartTimer = setTimeout(startLocalAuthSidecar, 1000);
        authSidecarRestartTimer.unref?.();
      }
    });
  } catch (error) {
    authSidecarChild = null;
    console.error('[CE-QC][V431_AUTH_SIDECAR] start failed:', error?.stack || error);
  }
}
function stopLocalAuthSidecar() {
  authSidecarStopping = true;
  clearTimeout(authSidecarRestartTimer);
  try { authSidecarChild?.kill(); } catch {}
  authSidecarChild = null;
}
process.once('exit', stopLocalAuthSidecar);
startLocalAuthSidecar();

export function validateAccessConfiguration() {
  const publicHost = normalizeHost(process.env.PUBLIC_HOSTNAME || 'ce-qc.cambodian.com');
  if (!publicHost || process.env.NODE_ENV !== 'production') return;
  const missing = ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD'].filter(name => !String(process.env[name] || '').trim());
  if (missing.length) throw new Error(`Missing Cloudflare Access configuration: ${missing.join(', ')}`);
}

function probeLocalAuthHealth(timeoutMs = 2500) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (settled) return; settled = true; resolve(value); };
    const request = http.get({
      host: '127.0.0.1',
      port: AUTH_SIDECAR_PORT,
      path: '/api/local-auth/health',
      headers: { host: `127.0.0.1:${AUTH_SIDECAR_PORT}`, accept: 'application/json' }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          finish({
            ok: response.statusCode === 200 && payload?.ok === true,
            activeUserCount: Number(payload?.activeUserCount),
            dbReady: payload?.dbReady === true
          });
        } catch {
          finish({ ok: false, activeUserCount: NaN, dbReady: false });
        }
      });
    });
    request.setTimeout(timeoutMs, () => { request.destroy(); finish({ ok: false, activeUserCount: NaN, dbReady: false }); });
    request.on('error', () => finish({ ok: false, activeUserCount: NaN, dbReady: false }));
  });
}

export async function accessIdentity(req, res, next) {
  if(String(req.method||'').toUpperCase()==='GET'&&PURGE_STATUS_PATH.test(String(req.path||''))){
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
    res.setHeader('Pragma','no-cache');
    return next();
  }
  const host = normalizeHost(req.hostname || req.get('host'));
  const remote = normalizeIp(req.socket?.remoteAddress);
  const publicHost = normalizeHost(process.env.PUBLIC_HOSTNAME || 'ce-qc.cambodian.com');
  try {
    if (isInternalAuthPath(req.path)) return await handleInternalAuth(req, res, host, remote);
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
    let user = readLocalAuthSession(req, channel);
    if (user) {
      req.user = user;
      req.accessMode = channel;
      req.cloudflareEmail = cloudflareEmail;
      return next();
    }

    // Local/LAN first paint must never synchronously open the multi-GB main SQLite DB.
    // The read-only auth sidecar owns credential/bootstrap discovery with a bounded
    // health probe. Legacy main-DB sessions remain available for PUBLIC access only.
    if (channel === 'LOCAL' || channel === 'LAN') {
      // V505 sealed PREPARE explicitly marks this one auth read as write-free.
      // Preserve that recovery contract; ordinary local first paint never enters it.
      if (req.v505PurgeReadOnlyAuth && cookieValue(req, 'ce_internal_session')) {
        user = readSession(req, channel, cloudflareEmail);
        if (user) {
          req.user = user;
          req.accessMode = channel;
          req.cloudflareEmail = cloudflareEmail;
          return next();
        }
      }
      const health = await probeLocalAuthHealth();
      const bootstrap = channel === 'LOCAL' && health.ok && health.dbReady && health.activeUserCount === 0;
      return loginPage(req, res, { channel, cloudflareEmail, bootstrap });
    }

    user = readSession(req, channel, cloudflareEmail);
    if (user) user = refreshSessionIfNeeded(req, res, user, channel);
    if (user) {
      req.user = user;
      req.accessMode = channel;
      req.cloudflareEmail = cloudflareEmail;
      return next();
    }
    return loginPage(req, res, { channel, cloudflareEmail, bootstrap: false });
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

  await ensureInternalAuthBody(req);

  if (req.path.endsWith('/logout')) {
    revokeCookieSession(req);
    clearSessionCookie(res, channel);
    return res.json({ ok: true });
  }
  if (req.path.endsWith('/bootstrap')) {
    if (channel !== 'LOCAL' || userCount() !== 0) return authError(req, res, 403, 'Bootstrap is unavailable.', channel, true);
    return createFirstAdmin(req, res, channel);
  }
  if (req.path.endsWith('/change-password')) {
    const user = readLocalAuthSession(req, channel) || readSession(req, channel, cloudflareEmail);
    if (!user) return authError(req, res, 401, 'Please sign in first.', channel, false);
    return changePassword(req, res, user);
  }
  return loginInternalUser(req, res, channel, cloudflareEmail);
}

function createFirstAdmin(req, res, channel) {
  const username = cleanUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const displayName = String(req.body?.displayName || username).trim().slice(0, 80);
  const email = cleanEmail(req.body?.email);
  if (!username || !validPassword(password)) return authError(req, res, 400, 'Username and a password of at least 10 characters are required.', channel, true);
  const now = nowIso();
  try {
    const hash = bcrypt.hashSync(password, 12);
    const row = getDb().prepare(`INSERT INTO users(username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,mustChangePassword,createdAt,updatedAt) VALUES(?,?,?,?,?,'ADMIN','ALL',1,0,?,?) RETURNING *`)
      .get(username, displayName, String(req.body?.departmentCompany || '').trim().slice(0, 120), email || null, hash, now, now);
    auditAction(req, 'USER_BOOTSTRAP_ADMIN_CREATED', { username });
    return issueSession(res, row, req, channel, '', false);
  } catch (error) { return authError(req, res, 409, 'Username or email is already in use.', channel, true); }
}

function loginInternalUser(req, res, channel, cloudflareEmail) {
  const username = cleanUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const row = getDb().prepare("SELECT * FROM users WHERE username=? AND status='ACTIVE'").get(username);
  const now = new Date();
  if (!row || !bcrypt.compareSync(password, row.passwordHash || '')) return loginFailure(req, res, row, '用户名或密码错误。', channel);
  if (!Number(row.enabled)) return authError(req, res, 403, '此账号已被停用。', channel, false);
  if (row.expiresAt && new Date(row.expiresAt) <= now) return authError(req, res, 403, '此账号已过期。', channel, false);
  if (row.lockedUntil && new Date(row.lockedUntil) > now) return authError(req, res, 423, '账号暂时锁定，请稍后再试。', channel, false);
  if (channel === 'PUBLIC' && cloudflareEmail && (!row.email || row.email.toLowerCase() !== cloudflareEmail.toLowerCase())) return authError(req, res, 403, '内部账号邮箱与 Cloudflare Access 身份不一致。', channel, false);
  getDb().prepare('UPDATE users SET failedLoginCount=0,lockedUntil=NULL,lastLoginAt=?,updatedAt=? WHERE id=?').run(nowIso(), nowIso(), row.id);
  const user = getDb().prepare("SELECT * FROM users WHERE id=? AND status='ACTIVE'").get(row.id);
  auditAction(req, 'LOGIN_SUCCESS', { username, accessChannel: channel });
  return issueSession(res, user, req, channel, cloudflareEmail, Boolean(user.mustChangePassword));
}

function loginFailure(req, res, row, message, channel) {
  let lockedUntil = null;
  if (row) {
    const attempts = Number(row.failedLoginCount || 0) + 1;
    lockedUntil = attempts >= LOGIN_LIMIT ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    getDb().prepare('UPDATE users SET failedLoginCount=?,lockedUntil=?,updatedAt=? WHERE id=?').run(attempts, lockedUntil, nowIso(), row.id);
    auditAction(req, lockedUntil ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', { username: row.username });
  } else auditAction(req, 'LOGIN_FAILED', { username: cleanUsername(req.body?.username) });
  return authError(req, res, lockedUntil ? 423 : 401, lockedUntil ? '账号已暂时锁定，请15分钟后再试。' : message, channel, false);
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
  clearLocalAuthCookie(res);
  return res.json({ ok: true, reloginRequired: true });
}

function issueSession(res, row, req, channel, cloudflareEmail, mustChangePassword) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60_000).toISOString();
  getDb().prepare('INSERT INTO user_sessions(userId,sessionHash,accessChannel,cloudflareEmail,ipAddress,userAgent,expiresAt,createdAt) VALUES(?,?,?,?,?,?,?,?)')
    .run(row.id, sha256(raw), channel, cloudflareEmail || null, normalizeIp(req.socket?.remoteAddress), String(req.get('user-agent') || '').slice(0, 300), expiresAt, nowIso());
  res.setHeader('Set-Cookie', `ce_internal_session=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${channel === 'PUBLIC' ? '; Secure' : ''}`);
  if (isNativeAuthForm(req)) return res.redirect(303, '/');
  return res.json({ ok: true, user: publicUser(row), mustChangePassword, expiresAt });
}

async function ensureInternalAuthBody(req) {
  const type = String(req.get?.('content-type') || '');
  if (/application\/x-www-form-urlencoded/i.test(type) && ['POST', 'PUT', 'PATCH'].includes(String(req.method || '').toUpperCase())) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 64 * 1024) throw new Error('Internal authentication form is too large.');
      chunks.push(chunk);
    }
    const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const body = {};
    for (const [key, value] of params.entries()) body[key] = value;
    req.body = body;
    return body;
  }
  if (req.body && typeof req.body === 'object') return req.body;
  req.body = {};
  return req.body;
}

function isNativeAuthForm(req) {
  const type = String(req.get?.('content-type') || '');
  const accept = String(req.get?.('accept') || '');
  return /application\/x-www-form-urlencoded/i.test(type) && /text\/html/i.test(accept);
}

function authError(req, res, status, message, channel, bootstrap) {
  if (isNativeAuthForm(req)) return loginPage(req, res, { channel, bootstrap, error: message, forceHtml: true, status });
  return res.status(status).json({ ok: false, error: message });
}

function localAuthSecret() {
  if (localAuthSecretCache) return localAuthSecretCache;
  const env = String(process.env.CE_QC_LOCAL_SESSION_SECRET || '').trim();
  if (env.length >= 32) { localAuthSecretCache = env; return localAuthSecretCache; }
  try {
    const file = path.join(getRuntimeConfig().tokenDir, 'v431_local_auth.secret');
    const secret = fs.readFileSync(file, 'utf8').trim();
    if (secret.length >= 43) { localAuthSecretCache = secret; return localAuthSecretCache; }
  } catch {}
  return '';
}

function readLocalAuthSession(req, channel) {
  if (!['LOCAL', 'LAN'].includes(channel)) return null;
  const token = cookieValue(req, LOCAL_AUTH_COOKIE);
  const secret = localAuthSecret();
  if (!token || !secret) return null;
  try {
    const [body, sig, extra] = String(token).split('.');
    if (!body || !sig || extra) return null;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload?.v !== 431 || Number(payload?.exp || 0) <= Date.now() || payload?.channel !== channel) return null;
    const user = payload?.user || {};
    if (!user.username || !['VIEWER', 'OPERATOR', 'ADMIN'].includes(String(user.role || '').toUpperCase())) return null;
    return { ...user, role: String(user.role).toUpperCase(), businessScope: String(user.businessScope || 'ALL').toUpperCase(), department: user.department || '', devMode: channel === 'LOCAL', localAuth: true };
  } catch { return null; }
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
  if (req.v505PurgeReadOnlyAuth) return user;
  const token = cookieValue(req, 'ce_internal_session');
  if (!token) return user;
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60_000).toISOString();
  getDb().prepare('UPDATE user_sessions SET expiresAt=? WHERE id=? AND sessionHash=? AND revokedAt IS NULL')
    .run(expiresAt, user.sessionId, sha256(token));
  res.setHeader('Set-Cookie', `ce_internal_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${channel === 'PUBLIC' ? '; Secure' : ''}`);
  return { ...user, sessionExpiresAt: expiresAt };
}

function revokeCookieSession(req) { const token = cookieValue(req, 'ce_internal_session'); if (token) getDb().prepare('UPDATE user_sessions SET revokedAt=? WHERE sessionHash=?').run(nowIso(), sha256(token)); }
function clearLocalAuthCookie(res) {
  const existing = res.getHeader?.('Set-Cookie');
  const rows = Array.isArray(existing) ? existing.slice() : (existing ? [String(existing)] : []);
  rows.push(`${LOCAL_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.setHeader('Set-Cookie', rows);
}
function clearSessionCookie(res, channel) {
  res.setHeader('Set-Cookie', [
    `ce_internal_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${channel === 'PUBLIC' ? '; Secure' : ''}`,
    `${LOCAL_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
  ]);
}
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
  if(req.v505PurgeReadOnlyAuth)return;
  if(String(req.path||'')==='/api/admin/data-purge/prepare'&&PURGE_PREPARE_AUDITS.has(String(action||'')))return;
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

function loginPage(req, res, { channel, bootstrap, error = '', forceHtml = false, status = 401 }) {
  if (req.path.startsWith('/api/') && !forceHtml) return res.status(401).json({
    ok: false,
    code: bootstrap ? 'INTERNAL_BOOTSTRAP_REQUIRED' : 'INTERNAL_AUTH_REQUIRED',
    reloginRequired: !bootstrap,
    error: bootstrap ? '需要先创建系统管理员。' : '系统登录已过期，请重新登录后继续处理。'
  });
  const endpoint = bootstrap ? '/api/internal-auth/bootstrap' : '/api/internal-auth/login';
  const title = bootstrap ? 'Initialize administrator' : 'CE QC internal sign-in';
  const safeError = escapeHtml(error);
  const useSidecar = !bootstrap && (channel === 'LOCAL' || channel === 'LAN');
  const requestHost = normalizeHost(req.hostname || req.get('host')) || '127.0.0.1';
  const formattedHost = requestHost.includes(':') ? `[${requestHost}]` : requestHost;
  const primaryEndpoint = useSidecar ? `http://${formattedHost}:${AUTH_SIDECAR_PORT}/api/local-auth/login` : endpoint;
  const statusText = useSidecar ? '独立登录通道 5179，不占用质控主数据库写入锁。' : '';
  const rawReturnTo = String(req.query?.returnTo || '').trim();
  const safeReturnTo = /^\/(?!\/)/.test(rawReturnTo) && !rawReturnTo.includes('\\\\') && !/[\r\n]/.test(rawReturnTo) ? rawReturnTo : '/';
  const safeReturnToJson = JSON.stringify(safeReturnTo).replace(/</g, '\\u003c');
  return res.status(status).type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f3f6fa;color:#17324d;font:15px/1.6 system-ui,'Microsoft YaHei',sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(400px,calc(100% - 40px));background:#fff;border:1px solid #dce5ef;border-radius:8px;padding:28px;box-shadow:0 12px 36px #16395b18}h1{font-size:22px;margin:0 0 18px}label{display:block;margin:12px 0 4px}input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #cbd8e5;border-radius:5px}button{width:100%;margin-top:18px;border:0;border-radius:5px;background:#126ee8;color:#fff;padding:11px;font-weight:700;cursor:pointer}button:disabled{opacity:.65;cursor:wait}#error{color:#b42318;margin-top:10px;min-height:24px}#channel{color:#667085;margin-top:8px;font-size:12px}</style><main class="box"><h1>${bootstrap ? '创建首个管理员' : 'CE质控系统内部登录'}</h1><form id="login" method="post" action="${primaryEndpoint}">${bootstrap ? '<label>姓名</label><input name="displayName" required><label>邮箱</label><input name="email" type="email">' : ''}<label>用户名</label><input name="username" autocomplete="username" required><label>密码</label><input name="password" type="password" autocomplete="current-password" required><button type="submit">${bootstrap ? '创建管理员' : '登录'}</button><div id="error" role="alert">${safeError}</div>${statusText ? `<div id="channel">${statusText}</div>` : ''}<noscript><div style="margin-top:10px;color:#667085">浏览器脚本不可用时，登录按钮仍会使用独立表单通道提交。</div></noscript></form></main><script>(function(){var form=document.getElementById('login');if(!form||!window.fetch||!window.FormData)return;form.addEventListener('submit',function(e){e.preventDefault();var btn=form.querySelector('button[type="submit"]');var err=document.getElementById('error');if(btn)btn.disabled=true;if(err)err.textContent='${useSidecar ? '正在通过独立认证通道登录...' : '正在登录...'}';var fd=new FormData(form);var body={};fd.forEach(function(v,k){body[k]=v;});var controller=window.AbortController?new AbortController():null;var timer=setTimeout(function(){if(controller)controller.abort();},8000);fetch('${primaryEndpoint}',{method:'POST',credentials:'include',cache:'no-store',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body),signal:controller?controller.signal:undefined}).then(function(r){return r.text().then(function(t){var j={};try{j=t?JSON.parse(t):{};}catch(_){j={error:t||('HTTP '+r.status)};}return {r:r,j:j};});}).then(function(x){clearTimeout(timer);if(x.r.ok){var target=${safeReturnToJson};var join=target.indexOf('?')>=0?'&':'?';location.replace(target+join+'auth=v431&t='+Date.now());return;}if(err)err.textContent=x.j.error||'登录失败';if(btn)btn.disabled=false;}).catch(function(ex){clearTimeout(timer);if(err)err.textContent=ex&&ex.name==='AbortError'?'登录认证8秒内未完成，独立认证服务没有响应。':'登录认证连接失败，请保持启动器窗口开启后重试。';if(btn)btn.disabled=false;});});})();</script>`);
}

function cleanUsername(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 60); }
function cleanEmail(value) { const email = String(value || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''; }
function validPassword(value) { return String(value || '').length >= 10; }
function cookieValue(req, name) { return String(req.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
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
