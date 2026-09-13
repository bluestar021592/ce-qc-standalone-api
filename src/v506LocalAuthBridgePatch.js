import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { getRuntimeConfig } from './db.js';

export const V506_LOCAL_AUTH_BRIDGE_ID = '2026-09-13-v506-same-origin-auth-bridge-v2';
const AUTH_PORT = Math.max(1024, Math.min(65535, Number(process.env.CE_QC_AUTH_SIDECAR_PORT || 5179)));
const APP_PORT = Math.max(1024, Math.min(65535, Number(process.env.PORT || 5177)));
const AUTH_COOKIE = 'ce_qc_local_auth_v431';
const REQUEST_TIMEOUT_MS = Math.max(1500, Math.min(8000, Number(process.env.CE_QC_AUTH_BRIDGE_TIMEOUT_MS || 5000)));
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_FORM_BYTES = 64 * 1024;
let installed = false;
let cachedSecret = '';

function envEnabled(name, fallback) {
  const value = process.env[name];
  return value == null || value === '' ? fallback : /^(1|true|yes|on)$/i.test(String(value));
}
function hostOnly(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end) : raw;
  }
  if (net.isIP(raw)) return raw;
  const first = raw.indexOf(':');
  const last = raw.lastIndexOf(':');
  return first > 0 && first === last ? raw.slice(0, first) : raw;
}
function portOnly(value = '', fallback = APP_PORT) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    const port = end >= 0 && raw[end + 1] === ':' ? Number(raw.slice(end + 2)) : NaN;
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
  }
  const first = raw.indexOf(':');
  const last = raw.lastIndexOf(':');
  if (first > 0 && first === last) {
    const port = Number(raw.slice(last + 1));
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  }
  return fallback;
}
function ipOnly(value = '') { return String(value || '').replace(/^::ffff:/, ''); }
function privateV4(value = '') { return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(String(value || '')); }
function loopback(value = '') { return value === '127.0.0.1' || value === '::1'; }
function inCidr(ip, cidr) {
  if (net.isIP(ip) !== 4) return false;
  const [base, bitsText] = String(cidr || '').split('/');
  if (net.isIP(base) !== 4) return false;
  const bits = Number(bitsText ?? 32);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = value => value.split('.').reduce((n, part) => ((n << 8) + Number(part)) >>> 0, 0);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(base) & mask);
}
function allowedLan(ip) {
  return String(process.env.LAN_ALLOWED_CIDRS || '192.168.0.0/16,10.0.0.0/8,172.16.0.0/12')
    .split(',').map(value => value.trim()).filter(Boolean).some(cidr => inCidr(ip, cidr));
}
export function resolveV506BrowserChannel(req = {}) {
  const host = hostOnly(req.hostname || req.headers?.host || req.get?.('host'));
  const remote = ipOnly(req.socket?.remoteAddress || '');
  if (['localhost', '127.0.0.1', '::1'].includes(host) && loopback(remote)) return 'LOCAL';
  if (
    privateV4(host) && privateV4(remote) && allowedLan(remote)
    && String(process.env.ACCESS_MODE || 'DUAL').toUpperCase() === 'DUAL'
    && envEnabled('LAN_DIRECT_ENABLED', true)
  ) return 'LAN';
  return '';
}
export function isV506SameOriginRequest(req = {}) {
  const origin = String(req.headers?.origin || req.get?.('origin') || '').trim();
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const requestHostHeader = String(req.headers?.host || req.get?.('host') || '').trim();
    const requestHost = hostOnly(req.hostname || requestHostHeader);
    const requestProtocol = String(req.protocol || 'http').toLowerCase().replace(/:$/, '');
    const requestPort = portOnly(requestHostHeader, requestProtocol === 'https' ? 443 : APP_PORT);
    const originPort = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    return hostOnly(parsed.hostname) === requestHost
      && parsed.protocol.toLowerCase() === `${requestProtocol}:`
      && originPort === requestPort;
  } catch { return false; }
}

function sessionSecret() {
  if (cachedSecret) return cachedSecret;
  const env = String(process.env.CE_QC_LOCAL_SESSION_SECRET || '').trim();
  if (env.length >= 32) { cachedSecret = env; return cachedSecret; }
  try {
    const file = path.join(getRuntimeConfig().tokenDir, 'v431_local_auth.secret');
    const value = fs.readFileSync(file, 'utf8').trim();
    if (value.length >= 43) { cachedSecret = value; return cachedSecret; }
  } catch {}
  return '';
}
function validSignedPayload(token, secret) {
  try {
    const [body, sig, extra] = String(token || '').split('.');
    if (!body || !sig || extra) return null;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload?.v !== 431 || Number(payload?.exp || 0) <= Date.now()) return null;
    if (payload?.channel !== 'LOCAL') return null;
    return payload;
  } catch { return null; }
}
export function rebindV506AuthCookie(setCookie = '', channel = 'LOCAL') {
  const target = String(channel || '').toUpperCase();
  if (!['LOCAL', 'LAN'].includes(target)) return '';
  const secret = sessionSecret();
  if (!secret) return '';
  const match = String(setCookie || '').match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=([^;]+)`));
  if (!match) return '';
  const payload = validSignedPayload(match[1], secret);
  if (!payload) return '';
  payload.channel = target;
  if (payload.user && typeof payload.user === 'object') payload.user.devMode = target === 'LOCAL';
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const token = `${body}.${sig}`;
  return String(setCookie).replace(`${AUTH_COOKIE}=${match[1]}`, `${AUTH_COOKIE}=${token}`);
}

function sidecarRequest({ method = 'GET', pathName, body = '', timeoutMs = REQUEST_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(body || '', 'utf8');
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; error ? reject(error) : resolve(value); };
    const request = http.request({
      host: '127.0.0.1', port: AUTH_PORT, method, path: pathName,
      headers: {
        host: `127.0.0.1:${AUTH_PORT}`,
        accept: 'application/json',
        ...(payload.length ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {})
      }
    }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) { request.destroy(new Error('AUTH_SIDECAR_RESPONSE_TOO_LARGE')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, {
        status: Number(response.statusCode || 502),
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('AUTH_SIDECAR_TIMEOUT')));
    request.on('error', error => finish(error));
    if (payload.length) request.write(payload);
    request.end();
  });
}
function json(res, status, payload) {
  res.status(status).set('cache-control', 'no-store').set('x-ce-qc-auth-bridge', V506_LOCAL_AUTH_BRIDGE_ID).json(payload);
}
function nativeFormRequest(req) {
  const type = String(req.get?.('content-type') || req.headers?.['content-type'] || '');
  const accept = String(req.get?.('accept') || req.headers?.accept || '');
  return /application\/x-www-form-urlencoded/i.test(type) && /text\/html/i.test(accept);
}
async function bridgeBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const type = String(req.get?.('content-type') || req.headers?.['content-type'] || '');
  if (!/application\/x-www-form-urlencoded/i.test(type)) return {};
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_FORM_BYTES) throw new Error('AUTH_BRIDGE_FORM_TOO_LARGE');
    chunks.push(chunk);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')).entries());
}
async function proxyHealth(req, res) {
  const channel = resolveV506BrowserChannel(req);
  if (!channel) return json(res, 403, { ok: false, code: 'AUTH_BRIDGE_CHANNEL_DENIED', error: '当前访问来源不允许本机/LAN认证。' });
  if (!isV506SameOriginRequest(req)) return json(res, 403, { ok: false, code: 'AUTH_BRIDGE_ORIGIN_DENIED', error: '登录来源校验失败。' });
  try {
    const reply = await sidecarRequest({ pathName: '/api/local-auth/health', timeoutMs: 2500 });
    let payload = {}; try { payload = JSON.parse(reply.body || '{}'); } catch {}
    return json(res, reply.status, { ...payload, bridgeOk: reply.status === 200 && payload?.ok === true, bridgeId: V506_LOCAL_AUTH_BRIDGE_ID, browserChannel: channel });
  } catch (error) {
    return json(res, 503, { ok: false, code: 'AUTH_SIDECAR_UNAVAILABLE', bridgeId: V506_LOCAL_AUTH_BRIDGE_ID, error: '独立认证服务暂不可用，请保持启动器窗口开启后稍后重试。', detail: String(error?.message || error) });
  }
}
async function proxyLogin(req, res) {
  const channel = resolveV506BrowserChannel(req);
  if (!channel) return json(res, 403, { ok: false, code: 'AUTH_BRIDGE_CHANNEL_DENIED', error: '当前访问来源不允许本机/LAN登录。' });
  if (!isV506SameOriginRequest(req)) return json(res, 403, { ok: false, code: 'AUTH_BRIDGE_ORIGIN_DENIED', error: '登录来源校验失败。' });
  let data = {};
  try { data = await bridgeBody(req); }
  catch { return json(res, 400, { ok: false, code: 'AUTH_BRIDGE_BODY_INVALID', error: '登录请求格式无效。' }); }
  const username = String(data?.username || '').trim();
  const password = String(data?.password || '');
  if (!username || !password) return json(res, 400, { ok: false, error: '请输入用户名和密码。' });
  try {
    const reply = await sidecarRequest({ method: 'POST', pathName: '/api/local-auth/login', body: JSON.stringify({ username, password }) });
    let responseBody = reply.body || '{}';
    let parsed = {}; try { parsed = JSON.parse(responseBody); } catch { parsed = { ok: false, error: responseBody || `HTTP ${reply.status}` }; responseBody = JSON.stringify(parsed); }
    if (reply.status >= 200 && reply.status < 300 && parsed?.ok === true) {
      const rawCookie = Array.isArray(reply.headers['set-cookie']) ? reply.headers['set-cookie'][0] : String(reply.headers['set-cookie'] || '');
      const cookie = rebindV506AuthCookie(rawCookie, channel);
      if (!cookie) return json(res, 503, { ok: false, code: 'AUTH_SESSION_REBIND_FAILED', error: '认证已完成，但会话绑定失败，请稍后重试。' });
      res.setHeader('Set-Cookie', cookie);
      if (nativeFormRequest(req)) return res.redirect(303, '/');
      if (parsed.user && typeof parsed.user === 'object') parsed.user.devMode = channel === 'LOCAL';
      parsed.authMode = 'V506_SAME_ORIGIN_BRIDGE';
      responseBody = JSON.stringify(parsed);
      res.status(reply.status).set('cache-control', 'no-store').set('content-type', 'application/json; charset=utf-8').set('x-ce-qc-auth-bridge', V506_LOCAL_AUTH_BRIDGE_ID).send(responseBody);
      return;
    }
    res.status(reply.status).set('cache-control', 'no-store').set('content-type', 'application/json; charset=utf-8').set('x-ce-qc-auth-bridge', V506_LOCAL_AUTH_BRIDGE_ID).send(responseBody);
  } catch (error) {
    return json(res, 503, { ok: false, code: 'AUTH_SIDECAR_UNAVAILABLE', error: '独立认证服务没有响应，请保持启动器窗口开启后重试。', detail: String(error?.message || error) });
  }
}

export function rewriteV506LoginHtml(body) {
  if (typeof body !== 'string' || !body.includes('/api/local-auth/login') || !body.includes(`:${AUTH_PORT}`)) return body;
  const escapedPort = String(AUTH_PORT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const directEndpoint = new RegExp(`http:\\/\\/(?:\\[[^\\]]+\\]|[^\\"'\\s/]+):${escapedPort}\\/api\\/local-auth\\/login`, 'g');
  return body
    .replace(directEndpoint, '/api/local-auth-proxy/login')
    .replace(/独立登录通道\s+\d+，不占用质控主数据库写入锁。/g, '独立认证服务通过当前5177页面安全转发，不要求浏览器直连认证端口。');
}
export function v506LocalAuthBridgeMiddleware(req, res, next) {
  if (req.method === 'POST' && req.path === '/api/local-auth-proxy/login') return void proxyLogin(req, res);
  if (req.method === 'GET' && req.path === '/api/local-auth-proxy/health') return void proxyHealth(req, res);
  const originalSend = res.send.bind(res);
  res.send = function v506AuthBridgeSend(body) { return originalSend(rewriteV506LoginHtml(body)); };
  next();
}

const previousUse = express.application.use;
express.application.use = function v506AuthBridgeUse(...args) {
  if (!installed && args.length === 1 && typeof args[0] === 'function' && args[0].name === 'accessIdentity') {
    installed = true;
    previousUse.call(this, v506LocalAuthBridgeMiddleware);
    console.log(`[CE-QC][V506_AUTH_BRIDGE] installed before accessIdentity; browser login stays on 5177 and sidecar remains isolated on ${AUTH_PORT}.`);
  }
  return previousUse.apply(this, args);
};

export function v506AuthBridgeStateForTests() { return { installed, authPort: AUTH_PORT, appPort: APP_PORT, timeoutMs: REQUEST_TIMEOUT_MS, id: V506_LOCAL_AUTH_BRIDGE_ID }; }
