import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { getRuntimeConfig } from './db.js';

export function getTokenFile() {
  return getRuntimeConfig().tokenFile;
}

export function loadTokenSync() {
  try {
    return normalizeToken(JSON.parse(fs.readFileSync(getTokenFile(), 'utf8')));
  } catch {
    return null;
  }
}

export async function loadToken() {
  try {
    return normalizeToken(JSON.parse(await fsp.readFile(getTokenFile(), 'utf8')));
  } catch {
    return null;
  }
}

export async function saveToken(token) {
  const tokenFile = getTokenFile();
  await fsp.mkdir(path.dirname(tokenFile), { recursive: true });
  await fsp.writeFile(tokenFile, JSON.stringify(normalizeToken(token), null, 2), 'utf8');
}

export function saveTokenSync(token) {
  const tokenFile = getTokenFile();
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, JSON.stringify(normalizeToken(token), null, 2), 'utf8');
}

export async function clearToken() {
  await fsp.unlink(getTokenFile()).catch(() => {});
}

export function clearTokenSync() {
  try {
    fs.unlinkSync(getTokenFile());
  } catch {}
}

export function normalizeToken(token = {}) {
  return {
    access_token: String(token.access_token || ''),
    refresh_token: String(token.refresh_token || ''),
    token_type: String(token.token_type || 'bearer'),
    expires_in: Number(token.expires_in || 0),
    expires_at: Number(token.expires_at || 0),
    tenantId: String(token.tenantId || token.tenant_id || '000000'),
    tenant_id: String(token.tenant_id || token.tenantId || '000000'),
    userId: String(token.userId || token.user_id || ''),
    user_id: String(token.user_id || token.userId || ''),
    account: String(token.account || token.username || ''),
    username: String(token.username || token.account || ''),
    saved_at: token.saved_at || new Date().toISOString()
  };
}

export function summarizeToken(token) {
  const t = token ? normalizeToken(token) : null;
  if (!t || !t.access_token) {
    return {
      loggedIn: false,
      hasAccessToken: false,
      hasRefreshToken: false,
      tokenType: '',
      tenantId: '',
      account: '',
      userId: '',
      expiresAt: '',
      expiresInSeconds: 0,
      expired: true
    };
  }

  const expiresInSeconds = t.expires_at ? Math.floor((t.expires_at - Date.now()) / 1000) : 0;
  return {
    loggedIn: true,
    hasAccessToken: t.access_token.length > 0,
    hasRefreshToken: t.refresh_token.length > 0,
    tokenType: t.token_type || 'bearer',
    tenantId: t.tenantId || t.tenant_id || '',
    account: t.account || t.username || '',
    userId: t.userId || t.user_id || '',
    expiresAt: t.expires_at ? new Date(t.expires_at).toISOString() : '',
    expiresInSeconds,
    expired: t.expires_at ? expiresInSeconds <= 0 : false
  };
}
