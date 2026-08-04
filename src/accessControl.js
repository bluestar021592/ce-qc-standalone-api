import net from 'net';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getDb, nowIso } from './db.js';

const ROLE_LEVEL = Object.freeze({ VIEWER: 1, OPERATOR: 2, ADMIN: 3 });
let jwks = null;

export function validateAccessConfiguration() {
  const publicHost = normalizeHost(process.env.PUBLIC_HOSTNAME);
  if (!publicHost || process.env.NODE_ENV !== 'production') return;
  const missing = ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD'].filter(name => !String(process.env[name] || '').trim());
  if (missing.length) throw new Error(`生产模式缺少 Cloudflare Access 配置：${missing.join(', ')}`);
}

export async function accessIdentity(req, res, next) {
  const host = normalizeHost(req.hostname || req.get('host'));
  const remote = normalizeIp(req.socket?.remoteAddress);
  const publicHost = normalizeHost(process.env.PUBLIC_HOSTNAME);

  try {
    if (isLoopbackHost(host) && isLoopbackIp(remote) && envEnabled('LOCAL_DEV_ENABLED', true)) {
      req.user = localAdmin('local-admin@localhost', '本机管理员');
      req.accessMode = 'LOCAL';
      return next();
    }

    if (publicHost && host === publicHost) {
      req.accessMode = 'PUBLIC';
      return await verifyCloudflareIdentity(req, res, next);
    }

    if (isPrivateHost(host)) {
      if (String(process.env.ACCESS_MODE || 'PUBLIC_ONLY').toUpperCase() !== 'DUAL' || !envEnabled('LAN_DIRECT_ENABLED', false)) {
        return denyPageOrApi(req, res, 403, '远程访问请使用正式HTTPS网址', publicHost
          ? `请打开 https://${publicHost}`
          : '正式公网网址尚未配置，请联系系统管理员。');
      }
      if (!isAllowedLan(remote, process.env.LAN_ALLOWED_CIDRS)) {
        return denyPageOrApi(req, res, 403, '当前局域网地址未获授权', '请联系系统管理员。');
      }
      return denyPageOrApi(req, res, 401, '局域网访问需要内部登录', '当前版本未启用局域网内部登录，请使用正式HTTPS网址。');
    }

    return denyPageOrApi(req, res, 421, '无法识别的访问地址', '请使用系统管理员提供的正式网址。');
  } catch {
    return denyPageOrApi(req, res, 401, '登录状态已失效', '请重新通过公司授权邮箱登录。');
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
  if (req.accessMode === 'LOCAL') return next();
  const origin = String(req.get('origin') || '').replace(/\/$/, '');
  const expected = String(process.env.PUBLIC_ORIGIN || (process.env.PUBLIC_HOSTNAME ? `https://${process.env.PUBLIC_HOSTNAME}` : '')).replace(/\/$/, '');
  if (!expected || origin !== expected) return res.status(403).json({ ok: false, error: '请求来源校验失败。' });
  next();
}

export function auditAction(req, action, detail = {}) {
  const body = JSON.stringify(detail, (key, value) => /password|token|cookie|authorization/i.test(key) ? '[REDACTED]' : value);
  getDb().prepare(`INSERT INTO audit_logs(userEmail,userRole,action,businessType,reportDate,runId,detailJson,ipAddress,createdAt)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(req.user?.email || '', req.user?.role || '', action,
    String(detail.businessType || ''), String(detail.reportDate || ''), String(detail.runId || ''), body,
    String(req.socket?.remoteAddress || ''), nowIso());
}

export function publicUser(user = {}) {
  return { email: user.email || '', displayName: user.displayName || '', department: user.department || '质控部', role: user.role || 'VIEWER', devMode: Boolean(user.devMode) };
}

async function verifyCloudflareIdentity(req, res, next) {
  const assertion = String(req.get('Cf-Access-Jwt-Assertion') || '').trim();
  if (!assertion) return denyPageOrApi(req, res, 401, '登录状态已失效', '请重新通过公司授权邮箱登录。');
  const teamDomain = normalizeTeamDomain(process.env.CF_ACCESS_TEAM_DOMAIN);
  const audience = String(process.env.CF_ACCESS_AUD || '').trim();
  if (!teamDomain || !audience) return denyPageOrApi(req, res, 503, '公网登录尚未完成配置', '请联系系统管理员。');
  jwks ||= createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(assertion, jwks, { issuer: teamDomain, audience });
  const email = String(payload.email || payload.sub || '').trim().toLowerCase();
  if (!email) return denyPageOrApi(req, res, 401, '登录信息不完整', '请重新登录。');
  req.user = resolveUser(email, payload.name || email);
  if (!req.user.enabled) return denyPageOrApi(req, res, 403, '当前账号已停用', '请联系系统管理员。');
  next();
}

function denyPageOrApi(req, res, status, title, message) {
  if (req.path.startsWith('/api/') || !String(req.get('accept') || '').includes('text/html')) {
    return res.status(status).json({ ok: false, error: title, message });
  }
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return res.status(status).type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{margin:0;background:#f3f6fa;color:#17324d;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif;display:grid;place-items:center;min-height:100vh}.box{width:min(520px,calc(100% - 40px));background:#fff;border:1px solid #dce5ef;border-radius:8px;padding:32px;box-shadow:0 12px 36px #16395b18}h1{font-size:24px;margin:0 0 12px}p{color:#5d7185;margin:0 0 22px}button{border:0;border-radius:6px;background:#165d9c;color:#fff;padding:10px 18px;font-weight:700;cursor:pointer}</style></head><body><main class="box"><h1>${safeTitle}</h1><p>${safeMessage}</p><button onclick="location.reload()">重新打开</button></main></body></html>`);
}

function resolveUser(email, displayName) {
  const db = getDb(); const now = nowIso();
  let row = db.prepare('SELECT * FROM user_roles WHERE email=?').get(email);
  if (!row) {
    db.prepare(`INSERT INTO user_roles(email,displayName,department,role,enabled,createdAt,updatedAt,lastLoginAt) VALUES(?,?,?,?,1,?,?,?)`)
      .run(email, String(displayName || email), '质控部', roleFromEnvironment(email), now, now, now);
    row = db.prepare('SELECT * FROM user_roles WHERE email=?').get(email);
  } else db.prepare('UPDATE user_roles SET lastLoginAt=?,updatedAt=? WHERE email=?').run(now, now, email);
  return { ...row, enabled: Number(row.enabled) === 1 };
}

function localAdmin(email, displayName) { return { email, displayName, department: '质控部', role: 'ADMIN', enabled: true, devMode: true }; }
function roleFromEnvironment(email) { for (const role of ['ADMIN', 'OPERATOR', 'VIEWER']) { if (String(process.env[`ACCESS_${role}_EMAILS`] || '').split(',').map(v => v.trim().toLowerCase()).includes(email)) return role; } return 'VIEWER'; }
function envEnabled(name, fallback) { const value = process.env[name]; return value == null || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value); }
function normalizeTeamDomain(value) { const domain = String(value || '').trim().replace(/\/$/, ''); return !domain ? '' : (/^https:\/\//i.test(domain) ? domain : `https://${domain}`); }
function normalizeHost(value) { return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split(':')[0]; }
function normalizeIp(value) { return String(value || '').replace(/^::ffff:/, ''); }
function isLoopbackHost(host) { return ['localhost', '127.0.0.1', '::1'].includes(host); }
function isLoopbackIp(ip) { return ip === '127.0.0.1' || ip === '::1'; }
function isPrivateHost(host) { return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host); }
function isAllowedLan(ip, cidrs) { return String(cidrs || '').split(',').map(v => v.trim()).filter(Boolean).some(cidr => inCidr(ip, cidr)); }
function inCidr(ip, cidr) { if (net.isIP(ip) !== 4) return false; const [base, bitsText] = cidr.split('/'); if (net.isIP(base) !== 4) return false; const bits = Number(bitsText ?? 32); const toInt = v => v.split('.').reduce((n, p) => ((n << 8) + Number(p)) >>> 0, 0); const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0; return (toInt(ip) & mask) === (toInt(base) & mask); }
function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
