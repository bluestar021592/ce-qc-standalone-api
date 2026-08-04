import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getDb, nowIso } from './db.js';

const ROLE_LEVEL = Object.freeze({ VIEWER: 1, OPERATOR: 2, ADMIN: 3 });
let jwks = null;

export function validateAccessConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;
  const missing = ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD'].filter(name => !String(process.env[name] || '').trim());
  if (missing.length) throw new Error(`生产模式缺少 Cloudflare Access 配置：${missing.join(', ')}`);
}

export async function accessIdentity(req, res, next) {
  try {
    if (isLocalDevelopment(req)) {
      req.user = { email: 'local-dev@localhost', displayName: '本地开发', department: '质控部', role: 'ADMIN', devMode: true };
      return next();
    }
    const assertion = String(req.get('Cf-Access-Jwt-Assertion') || '').trim();
    if (!assertion) return res.status(401).json({ ok: false, error: '请通过 Cloudflare Access 登录后访问。' });
    const teamDomain = normalizeTeamDomain(process.env.CF_ACCESS_TEAM_DOMAIN);
    jwks ||= createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(assertion, jwks, {
      issuer: teamDomain,
      audience: String(process.env.CF_ACCESS_AUD || '').trim()
    });
    const email = String(payload.email || payload.sub || '').trim().toLowerCase();
    if (!email) return res.status(401).json({ ok: false, error: 'Cloudflare Access 身份中缺少邮箱。' });
    req.user = resolveUser(email, payload.name || email);
    if (!req.user.enabled) return res.status(403).json({ ok: false, error: '当前账号已被停用。' });
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'Cloudflare Access 登录无效或已过期，请重新登录。' });
  }
}

export function requireRole(minimumRole) {
  return (req, res, next) => {
    if ((ROLE_LEVEL[req.user?.role] || 0) < (ROLE_LEVEL[minimumRole] || 99)) {
      return res.status(403).json({ ok: false, error: '当前账号没有执行此操作的权限。' });
    }
    next();
  };
}

export function sameOriginWriteGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.user?.devMode) return next();
  const origin = String(req.get('origin') || '');
  const expected = String(process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
  if (!expected || origin !== expected) return res.status(403).json({ ok: false, error: '请求来源校验失败。' });
  next();
}

export function auditAction(req, action, detail = {}) {
  const body = JSON.stringify(detail, (key, value) => /password|token|cookie|authorization/i.test(key) ? '[REDACTED]' : value);
  getDb().prepare(`INSERT INTO audit_logs(userEmail,userRole,action,businessType,reportDate,runId,detailJson,ipAddress,createdAt)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(
    req.user?.email || '', req.user?.role || '', action,
    String(detail.businessType || ''), String(detail.reportDate || ''), String(detail.runId || ''),
    body, String(req.ip || ''), nowIso()
  );
}

export function publicUser(user = {}) {
  return { email: user.email || '', displayName: user.displayName || '', department: user.department || '质控部', role: user.role || 'VIEWER', devMode: Boolean(user.devMode) };
}

function resolveUser(email, displayName) {
  const db = getDb();
  const now = nowIso();
  let row = db.prepare('SELECT * FROM user_roles WHERE email=?').get(email);
  if (!row) {
    const configuredRole = roleFromEnvironment(email);
    db.prepare(`INSERT INTO user_roles(email,displayName,department,role,enabled,createdAt,updatedAt,lastLoginAt)
      VALUES(?,?,?, ?,1,?,?,?)`).run(email, String(displayName || email), '质控部', configuredRole, now, now, now);
    row = db.prepare('SELECT * FROM user_roles WHERE email=?').get(email);
  } else {
    db.prepare('UPDATE user_roles SET lastLoginAt=?,updatedAt=? WHERE email=?').run(now, now, email);
  }
  return { ...row, enabled: Number(row.enabled) === 1 };
}

function roleFromEnvironment(email) {
  for (const role of ['ADMIN', 'OPERATOR', 'VIEWER']) {
    const emails = String(process.env[`ACCESS_${role}_EMAILS`] || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (emails.includes(email)) return role;
  }
  return 'VIEWER';
}

function isLocalDevelopment(req) {
  if (process.env.NODE_ENV === 'production') return false;
  const host = String(req.hostname || '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function normalizeTeamDomain(value) {
  const domain = String(value || '').trim().replace(/\/$/, '');
  return /^https:\/\//i.test(domain) ? domain : `https://${domain}`;
}
