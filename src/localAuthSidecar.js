import 'dotenv/config';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig } from './db.js';

export const V431_LOCAL_AUTH_SIDECAR_ID = '2026-09-05-v431-readonly-local-auth-sidecar-v1';
export const V431_LOCAL_AUTH_COOKIE = 'ce_qc_local_auth_v431';
const PORT = Math.max(1024, Math.min(65535, Number(process.env.CE_QC_AUTH_SIDECAR_PORT || 5179)));
const APP_PORT = Math.max(1024, Math.min(65535, Number(process.env.PORT || 5177)));
const HOST = String(process.env.CE_QC_AUTH_SIDECAR_HOST || '0.0.0.0');
const SESSION_HOURS = Math.max(1, Math.min(12, Number(process.env.CE_QC_LOCAL_AUTH_HOURS || 8)));
const LOGIN_LIMIT = 5;
const LOCK_MS = 15 * 60_000;
const attempts = new Map();
let authDb = null;
let authStmt = null;
let authDbFile = '';
let cachedSecret = '';

function hostOnly(value = '') { return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split(':')[0]; }
function ipOnly(value = '') { return String(value || '').replace(/^::ffff:/, ''); }
function privateV4(value = '') { return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(String(value || '')); }
function localChannel(req) {
  const host = hostOnly(req.headers.host || '');
  const ip = ipOnly(req.socket?.remoteAddress || '');
  if (['127.0.0.1', 'localhost', '::1'].includes(host) && (ip === '127.0.0.1' || ip === '::1')) return 'LOCAL';
  if (net.isIP(host) === 4 && privateV4(host) && privateV4(ip)) return 'LAN';
  return '';
}
function cleanUsername(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 60); }
function publicUser(row = {}, channel = 'LOCAL') {
  return {
    id: row.id || '', username: row.username || '', email: row.email || '', displayName: row.displayName || '',
    department: row.departmentCompany || '', role: row.role || 'VIEWER', businessScope: row.businessScope || 'ALL',
    mustChangePassword: Boolean(row.mustChangePassword), devMode: channel === 'LOCAL'
  };
}
function secretFile() {
  const cfg = getRuntimeConfig();
  fs.mkdirSync(cfg.tokenDir, { recursive: true });
  return path.join(cfg.tokenDir, 'v431_local_auth.secret');
}
function sessionSecret() {
  if (cachedSecret) return cachedSecret;
  const env = String(process.env.CE_QC_LOCAL_SESSION_SECRET || '').trim();
  if (env.length >= 32) { cachedSecret = env; return cachedSecret; }
  const file = secretFile();
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 43) { cachedSecret = existing; return cachedSecret; }
  } catch {}
  const created = crypto.randomBytes(48).toString('base64url');
  try { fs.writeFileSync(file, created, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); cachedSecret = created; }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    cachedSecret = fs.readFileSync(file, 'utf8').trim();
  }
  return cachedSecret;
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function closeAuthDb() { authStmt = null; if (authDb) { try { authDb.close(); } catch {} authDb = null; } }
function openAuthDb() {
  const file = getRuntimeConfig().dbFile;
  if (authDb && authStmt && authDbFile === file) return authDb;
  closeAuthDb();
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON');
    db.exec('PRAGMA busy_timeout=800');
    authStmt = db.prepare("SELECT id,username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,status,expiresAt,mustChangePassword,lockedUntil FROM users WHERE username=? AND status='ACTIVE' LIMIT 1");
    authDb = db; authDbFile = file; return authDb;
  } catch (error) { try { db.close(); } catch {} throw error; }
}
function readAuthRow(username) {
  try { openAuthDb(); return authStmt.get(username) || null; }
  catch (error) {
    if (!/SQLITE_SCHEMA|SQLITE_BUSY|database is locked|database connection is not open/i.test(String(error?.message || error))) throw error;
    closeAuthDb(); openAuthDb(); return authStmt.get(username) || null;
  }
}
function allowedOrigin(req) {
  const raw = String(req.headers.origin || '').trim();
  if (!raw) return { ok: true, origin: '' };
  try {
    const u = new URL(raw);
    const requestHost = hostOnly(req.headers.host || '');
    return { ok: u.hostname.toLowerCase() === requestHost && Number(u.port || (u.protocol === 'https:' ? 443 : 80)) === APP_PORT, origin: raw };
  } catch { return { ok: false, origin: raw }; }
}
function responseHeaders(req, extra = {}) {
  const allowed = allowedOrigin(req);
  const headers = {
    'cache-control': 'no-store',
    'x-ce-qc-auth-sidecar': V431_LOCAL_AUTH_SIDECAR_ID,
    'access-control-allow-headers': 'Content-Type, Accept',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    ...extra
  };
  if (allowed.origin) {
    headers['access-control-allow-origin'] = allowed.origin;
    headers['access-control-allow-credentials'] = 'true';
    headers.vary = 'Origin';
  }
  return { allowed, headers };
}
function json(req, res, status, payload, extra = {}) {
  const { allowed, headers } = responseHeaders(req, { 'content-type': 'application/json; charset=utf-8', ...extra });
  if (!allowed.ok) { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); return res.end(JSON.stringify({ ok: false, error: 'Origin denied.' })); }
  res.writeHead(status, headers); res.end(JSON.stringify(payload));
}
async function body(req) {
  let total = 0; const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const type = String(req.headers['content-type'] || '');
  if (/application\/json/i.test(type)) return JSON.parse(text || '{}');
  const params = new URLSearchParams(text);
  return Object.fromEntries(params.entries());
}
function formRequest(req) { return /application\/x-www-form-urlencoded/i.test(String(req.headers['content-type'] || '')); }
function appRedirect(req) {
  const host = hostOnly(req.headers.host || '127.0.0.1');
  return `http://${host}:${APP_PORT}/`;
}
function attemptKey(username, req) { return `${username}|${ipOnly(req.socket?.remoteAddress || '')}`; }
function failureState(username, req) {
  const key = attemptKey(username, req); const now = Date.now(); const current = attempts.get(key);
  if (!current || now - current.firstAt > LOCK_MS) return { key, count: 0, firstAt: now, lockedUntil: 0 };
  return { key, ...current };
}
function registerFailure(username, req) {
  const state = failureState(username, req); const count = state.count + 1;
  const lockedUntil = count >= LOGIN_LIMIT ? Date.now() + LOCK_MS : 0;
  attempts.set(state.key, { count, firstAt: state.firstAt, lockedUntil });
  return { count, lockedUntil };
}
function clearFailures(username, req) { attempts.delete(attemptKey(username, req)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (req.method === 'OPTIONS') {
    const { allowed, headers } = responseHeaders(req);
    res.writeHead(allowed.ok ? 204 : 403, headers); return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/api/local-auth/health') {
    try { openAuthDb(); return json(req, res, 200, { ok: true, id: V431_LOCAL_AUTH_SIDECAR_ID, dbReady: true, port: PORT, appPort: APP_PORT }); }
    catch (error) { return json(req, res, 503, { ok: false, id: V431_LOCAL_AUTH_SIDECAR_ID, dbReady: false, error: String(error?.message || error) }); }
  }
  if (req.method !== 'POST' || url.pathname !== '/api/local-auth/login') return json(req, res, 404, { ok: false, error: 'Not found.' });
  const channel = localChannel(req);
  if (!channel) return json(req, res, 403, { ok: false, error: '当前访问来源不允许本机/LAN登录。' });
  const startedAt = Date.now();
  try {
    const data = await body(req);
    const username = cleanUsername(data?.username); const password = String(data?.password || '');
    if (!username || !password) return json(req, res, 400, { ok: false, error: '请输入用户名和密码。' });
    const state = failureState(username, req);
    if (state.lockedUntil && state.lockedUntil > Date.now()) return json(req, res, 423, { ok: false, error: '登录失败次数过多，请15分钟后再试。' });
    const row = readAuthRow(username);
    if (!row || !bcrypt.compareSync(password, String(row.passwordHash || ''))) {
      const failed = registerFailure(username, req);
      return json(req, res, failed.lockedUntil ? 423 : 401, { ok: false, error: failed.lockedUntil ? '登录失败次数过多，请15分钟后再试。' : '用户名或密码错误。' });
    }
    if (!Number(row.enabled)) return json(req, res, 403, { ok: false, error: '此账号已被停用。' });
    if (row.expiresAt && Date.parse(row.expiresAt) <= Date.now()) return json(req, res, 403, { ok: false, error: '此账号已过期。' });
    if (row.lockedUntil && Date.parse(row.lockedUntil) > Date.now()) return json(req, res, 423, { ok: false, error: '账号暂时锁定，请稍后再试。' });
    clearFailures(username, req);
    const exp = Date.now() + SESSION_HOURS * 60 * 60_000;
    const payload = { v: 431, iat: Date.now(), exp, channel, user: publicUser(row, channel) };
    const token = sign(payload);
    const cookie = `${V431_LOCAL_AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
    console.log(`[CE-QC][V431_AUTH_OK] user=${username} channel=${channel} ms=${Date.now() - startedAt}`);
    if (formRequest(req)) {
      const { allowed, headers } = responseHeaders(req, { location: appRedirect(req), 'set-cookie': cookie });
      if (!allowed.ok) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Origin denied.'); }
      res.writeHead(303, headers); return res.end();
    }
    return json(req, res, 200, { ok: true, user: payload.user, expiresAt: new Date(exp).toISOString(), authMode: 'V431_READONLY_LOCAL_SIDECAR' }, { 'set-cookie': cookie });
  } catch (error) {
    console.error('[CE-QC][V431_AUTH_ERROR]', error?.stack || error);
    const busy = /SQLITE_BUSY|database is locked/i.test(String(error?.message || error));
    return json(req, res, busy ? 503 : 500, { ok: false, error: busy ? '登录认证数据库暂时繁忙，请重试。' : '独立登录服务异常。' });
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 11000;
server.keepAliveTimeout = 1000;
server.listen(PORT, HOST, () => console.log(`[CE-QC][V431_AUTH_SIDECAR] READY http://${HOST}:${PORT} · app=${APP_PORT} · readonly-users`));
server.on('error', error => { console.error('[CE-QC][V431_AUTH_SIDECAR] START FAILED', error?.stack || error); process.exitCode = 1; });
function shutdown() { try { server.close(); } catch {} closeAuthDb(); }
process.once('SIGINT', () => { shutdown(); process.exit(0); });
process.once('SIGTERM', () => { shutdown(); process.exit(0); });
process.once('exit', shutdown);

export const __test = { hostOnly, ipOnly, privateV4, localChannel, cleanUsername, allowedOrigin, failureState };
