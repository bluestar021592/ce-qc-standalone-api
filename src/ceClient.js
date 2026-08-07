import axios from 'axios';
import { clearTokenSync, loadTokenSync, normalizeToken, saveTokenSync } from './authStore.js';

export class CEClient {
  constructor() {
    this.baseURL = process.env.CE_BASE_URL || 'https://otwms.cambodianexpress.com';
    this.timeout = Number(process.env.REQUEST_TIMEOUT_MS || 45000);
    this.http = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: this.headers()
    });
  }

  headers() {
    const savedToken = loadTokenSync();
    const authorization = normalizeAuthorization(process.env.CE_AUTHORIZATION);
    const bladeAuth = normalizeBladeAuth(process.env.CE_BLADE_AUTH);
    const cookie = normalizeCookie(process.env.CE_COOKIE);
    const cookieParsed = parseCookieTokens(cookie);
    const accessToken = savedToken?.access_token || cookieParsed.accessToken;
    const refreshToken = savedToken?.refresh_token || cookieParsed.refreshToken;
    const tokenType = normalizeTokenType(savedToken?.token_type || 'bearer');
    const tenantId = savedToken?.tenantId || savedToken?.tenant_id || process.env.CE_TENANT_ID || '000000';
    const h = {
      'Content-Type': 'application/json;charset=UTF-8',
      'Accept': 'application/json, text/plain, */*',
      'language': 'zh',
      'Tenant-Id': tenantId,
      'Origin': 'https://otwms.cambodianexpress.com',
      'Referer': 'https://otwms.cambodianexpress.com/',
      'User-Agent': 'Mozilla/5.0'
    };
    if (authorization) h.Authorization = authorization;
    if (accessToken) h['Blade-Auth'] = `${tokenType} ${accessToken}`;
    else if (bladeAuth) h['Blade-Auth'] = bladeAuth;
    if (!savedToken && cookie) h.Cookie = cookie;
    if (accessToken) h['x-access-token'] = accessToken;
    if (refreshToken) h['x-refresh-token'] = refreshToken;
    return h;
  }

  headerDebug() {
    const h = this.headers();
    const savedToken = loadTokenSync();
    const cookieParsed = parseCookieTokens(process.env.CE_COOKIE);
    const authorization = safeHeaderDebug(h.Authorization, true);
    const bladeAuth = safeHeaderDebug(h['Blade-Auth'], true);
    const cookie = safeHeaderDebug(h.Cookie, false);
    const accessToken = String(h['x-access-token'] || '');
    const refreshToken = String(h['x-refresh-token'] || '');
    const debug = {
      Authorization: authorization,
      'Blade-Auth': bladeAuth,
      Cookie: cookie,
      loginToken: {
        configured: Boolean(savedToken?.access_token),
        length: savedToken?.access_token ? savedToken.access_token.length : 0,
        prefix10: savedToken?.access_token ? savedToken.access_token.slice(0, 10) : ''
      },
      cookieKeys: {
        configured: cookieParsed.keys.length > 0,
        length: cookieParsed.keys.length,
        prefix10: cookieParsed.keys.join(', ')
      },
      'x-access-token': {
        configured: accessToken.length > 0,
        extracted: accessToken.length > 0,
        length: accessToken.length,
        prefix10: accessToken.slice(0, 10)
      },
      'x-refresh-token': {
        configured: refreshToken.length > 0,
        extracted: refreshToken.length > 0,
        length: refreshToken.length,
        prefix10: refreshToken.slice(0, 10)
      }
    };
    if (!savedToken && cookie.configured && (!debug['x-access-token'].configured || !debug['x-refresh-token'].configured)) {
      debug.cookieTokenWarning = {
        configured: false,
        length: 0,
        prefix10: 'Cookie已读取，但未正确提取 x-access-token / x-refresh-token，请检查Cookie格式或重新复制Cookie。'
      };
    }
    return debug;
  }

  loginHeaders(tenantId = '000000') {
    const authorization = normalizeAuthorization(process.env.CE_AUTHORIZATION);
    const h = {
      'Language': 'zh',
      'Tenant-Id': tenantId,
      'Origin': 'https://otwms.cambodianexpress.com',
      'Referer': 'https://otwms.cambodianexpress.com/',
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json;charset=UTF-8'
    };
    if (authorization) h.Authorization = authorization;
    return h;
  }

  async login({ tenantId = '000000', username, password, grant_type = 'password', scope = 'all', type = 'account' }) {
    const res = await this.http.post('/api/blade-auth/oauth/token', undefined, {
      params: { tenantId, username, password, grant_type, scope, type },
      headers: this.loginHeaders(tenantId)
    });
    return res.data;
  }

  async refreshTokenIfNeeded({ force = false } = {}) {
    const token = loadTokenSync();
    if (!token?.refresh_token) return false;
    if (!force && token.expires_at && token.expires_at - Date.now() > 60000) return true;

    try {
      const refreshed = await this.refreshToken(token);
      const normalized = normalizeLoginToken(refreshed, {
        tenantId: token.tenantId || token.tenant_id || '000000',
        username: token.username || token.account || ''
      });
      if (!normalized.refresh_token) normalized.refresh_token = token.refresh_token;
      saveTokenSync(normalized);
      return true;
    } catch (e) {
      clearTokenSync();
      const err = new Error('登录已过期，请重新登录CE系统');
      err.ceStatus = e.ceStatus || e?.response?.status || '';
      err.ceCode = e.ceCode || '';
      err.ceMsg = e.ceMsg || e.message || '';
      throw err;
    }
  }

  async refreshToken(token) {
    const tenantId = token.tenantId || token.tenant_id || '000000';
    try {
      const res = await this.http.post('/api/blade-auth/oauth/token', undefined, {
        params: {
          tenantId,
          refresh_token: token.refresh_token,
          grant_type: 'refresh_token',
          scope: 'all',
          type: 'account'
        },
        headers: this.loginHeaders(tenantId)
      });
      return res.data;
    } catch (e) {
      throw normalizeCeError('refresh-token', e);
    }
  }

  async confirmQuery(shipmentCodes) {
    const clean = cleanAnyShipmentCodes(shipmentCodes);
    if (!clean.length) return [];
    const data = await this.postJson('/api/otwms/order/confirm-query', { shipmentCodes: clean }, 'confirm-query');
    return Array.isArray(data.data) ? data.data : [];
  }

  async trackQuery(shipmentCodes) {
    const clean = cleanAnyShipmentCodes(shipmentCodes);
    if (!clean.length) return [];
    const data = await this.postJson('/api/tms-shipment-event/query', clean, 'track query');
    return Array.isArray(data.data) ? data.data : [];
  }

  async shipmentTrack(shipmentCodes) {
    const clean = cleanAnyShipmentCodes(shipmentCodes);
    if (!clean.length) return [];
    const data = await this.postJson('/api/tms-shipment/track', clean, 'shipment track');
    return Array.isArray(data.data) ? data.data : [];
  }

  async exceptionQuery(shipmentCodes) {
    const clean = cleanAnyShipmentCodes(shipmentCodes);
    if (!clean.length) return [];
    const data = await this.postJson('/api/exception-item/query', clean, 'exception item query');
    return Array.isArray(data.data) ? data.data : [];
  }

  async postJson(path, body, label, canRetryAuth = true) {
    await this.refreshTokenIfNeeded();
    let res;
    try {
      res = await this.http.post(path, body, { headers: this.headers() });
    } catch (e) {
      const err = normalizeCeError(label, e);
      if (canRetryAuth && isAuthError(err)) {
        const refreshed = await this.refreshTokenIfNeeded({ force: true });
        if (refreshed) return this.postJson(path, body, label, false);
      }
      throw err;
    }

    const data = res.data;
    if (!data || data.success !== true) {
      const err = normalizeCeError(label, { response: { status: res.status, data } });
      if (canRetryAuth && isAuthError(err)) {
        const refreshed = await this.refreshTokenIfNeeded({ force: true });
        if (refreshed) return this.postJson(path, body, label, false);
      }
      throw err;
    }
    return data;
  }
}

export function normalizeLoginToken(raw, fallback = {}) {
  const src = pickTokenSource(raw);
  const expiresIn = Number(src.expires_in || src.expiresIn || 0);
  const token = normalizeToken({
    access_token: src.access_token || src.accessToken || '',
    refresh_token: src.refresh_token || src.refreshToken || '',
    token_type: src.token_type || src.tokenType || 'bearer',
    expires_in: expiresIn,
    expires_at: expiresIn ? Date.now() + expiresIn * 1000 : 0,
    tenantId: src.tenantId || src.tenant_id || fallback.tenantId || '000000',
    tenant_id: src.tenant_id || src.tenantId || fallback.tenantId || '000000',
    userId: src.userId || src.user_id || '',
    user_id: src.user_id || src.userId || '',
    account: src.account || src.username || fallback.username || '',
    username: src.username || src.account || fallback.username || ''
  });
  if (!token.access_token) throw new Error('CE登录响应中未找到 access_token');
  return token;
}

function pickTokenSource(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (raw.access_token || raw.accessToken) return raw;
  if (raw.data?.access_token || raw.data?.accessToken) return raw.data;
  if (raw.data?.oauth?.access_token || raw.data?.oauth?.accessToken) return raw.data.oauth;
  if (raw.oauth?.access_token || raw.oauth?.accessToken) return raw.oauth;
  return raw.data || raw;
}

function normalizeCeError(label, e) {
  const status = e?.response?.status || '';
  const data = e?.response?.data;
  const ceCode = data?.code ?? data?.errorCode ?? data?.status ?? '';
  const ceMsg = data?.msg ?? data?.message ?? data?.error ?? '';
  const detail = ceMsg || (data ? JSON.stringify(data).slice(0, 300) : e.message);
  const err = new Error(`${label}失败${status ? ` HTTP ${status}` : ''}${detail ? `：${detail}` : ''}`);
  err.ceStatus = status;
  err.ceCode = ceCode;
  err.ceMsg = ceMsg;
  return err;
}

function isAuthError(e) {
  return String(e?.ceStatus || '') === '401'
    || String(e?.ceCode || '') === '401'
    || /未授权|unauthorized|token|过期|expired/i.test(String(e?.ceMsg || e?.message || ''));
}

function normalizeTokenType(value) {
  const v = String(value || 'bearer').trim();
  return /^bearer$/i.test(v) ? 'bearer' : v;
}

function normalizeAuthorization(value) {
  const v = normalizeHeaderValue(value);
  if (!v) return '';
  if (/^Basic/i.test(v)) {
    const token = v.replace(/^Basic\s*/i, '').trim();
    return token ? `Basic ${token}` : '';
  }
  return v;
}

function normalizeBladeAuth(value) {
  const v = normalizeHeaderValue(value);
  if (!v) return '';
  if (/^bearer/i.test(v)) {
    const token = v.replace(/^bearer\s*/i, '').trim();
    return token ? `bearer ${token}` : '';
  }
  return v;
}

function normalizeCookie(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, '')
    .trim();
}

function normalizeHeaderValue(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .replace(/[ \t]{2,}/g, ' ');
}

export function parseCookieTokens(cookieString) {
  const repaired = String(cookieString || '')
    .replace(/[\r\n]+/g, '')
    .replace(/x-access\s*-\s*token/gi, 'x-access-token')
    .replace(/x-access\s+token/gi, 'x-access-token')
    .replace(/x-refresh\s*-\s*token/gi, 'x-refresh-token')
    .replace(/x-refresh\s+token/gi, 'x-refresh-token');

  const out = { accessToken: '', refreshToken: '', keys: [] };
  for (const part of repaired.split(';')) {
    const text = part.trim();
    const idx = text.indexOf('=');
    if (idx < 0) continue;
    const key = text.slice(0, idx).trim().toLowerCase();
    const value = text.slice(idx + 1).trim();
    if (key) out.keys.push(key);
    if (key === 'x-access-token') out.accessToken = value;
    if (key === 'x-refresh-token') out.refreshToken = value;
  }
  out.keys = [...new Set(out.keys)];
  return out;
}

function safeHeaderDebug(value, includePrefix) {
  const v = String(value || '');
  return {
    configured: Boolean(v.trim()),
    length: v.length,
    prefix10: includePrefix ? v.slice(0, 10) : ''
  };
}

export function cleanBills(list) {
  return [...new Set((list || [])
    .map(x => String(x || '').trim().toUpperCase())
    .filter(Boolean)
    .filter(x => !/^SPE/i.test(x)))];
}

export function cleanAnyShipmentCodes(list) {
  return [...new Set((list || [])
    .map(value => String(value || '').trim().toUpperCase())
    .filter(Boolean))];
}
