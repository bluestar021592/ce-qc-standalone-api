import { CEClient, normalizeLoginToken } from './ceClient.js';
import { clearTokenSync, loadTokenSync, saveTokenSync } from './authStore.js';

export const V217_CE_AUTH_RETENTION_PATCH_ID = '2026-08-22-v217-ce-auth-retention-v1';

const INSTALLED = Symbol.for('ce-qc.v217.ce-auth-retention');

function isDefinitiveAuthFailure(error) {
  const status = Number(error?.ceStatus || error?.response?.status || 0);
  const code = String(error?.ceCode || '').trim().toLowerCase();
  const message = String(error?.ceMsg || error?.message || '').toLowerCase();
  if (status === 401 || code === '401') return true;
  if (/(invalid_grant|invalid refresh|refresh token.*invalid|refresh token.*expired|token.*已过期|登录已过期|未授权|unauthorized)/i.test(message)) return true;
  return false;
}

function isTransientFailure(error) {
  const status = Number(error?.ceStatus || error?.response?.status || 0);
  const cause = String(error?.causeCode || error?.code || '').toUpperCase();
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
  return ['ENOTFOUND','EAI_AGAIN','ETIMEOUT','ETIMEDOUT','ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','ERR_NETWORK'].includes(cause);
}

if (!CEClient.prototype[INSTALLED]) {
  CEClient.prototype.refreshTokenIfNeeded = async function v217RefreshTokenIfNeeded({ force = false } = {}) {
    const token = loadTokenSync();
    if (!token?.refresh_token) return false;
    if (!force && token.expires_at && token.expires_at - Date.now() > 60_000) return true;

    try {
      const refreshed = await this.refreshToken(token);
      const normalized = normalizeLoginToken(refreshed, {
        tenantId: token.tenantId || token.tenant_id || '000000',
        username: token.username || token.account || ''
      });
      if (!normalized.refresh_token) normalized.refresh_token = token.refresh_token;
      saveTokenSync(normalized);
      return true;
    } catch (error) {
      const definitive = isDefinitiveAuthFailure(error);
      if (definitive) {
        clearTokenSync();
      } else {
        // A temporary DNS/network/CE-server failure must never erase the saved
        // login token. Keeping it lets the next request retry automatically once
        // connectivity returns instead of forcing the operator to sign in again.
        console.warn(`[CE-QC][V217] CE token refresh failed transiently; saved login retained. status=${error?.ceStatus || ''} code=${error?.causeCode || error?.ceCode || ''}`);
      }

      const err = new Error(definitive
        ? 'CE系统登录已真正过期，请重新登录一次'
        : 'CE系统暂时无法刷新登录状态，已保留现有登录凭证，请稍后重试');
      err.ceStatus = error?.ceStatus || error?.response?.status || '';
      err.ceCode = error?.ceCode || '';
      err.ceMsg = error?.ceMsg || error?.message || '';
      err.causeCode = error?.causeCode || error?.code || '';
      err.ceAuthExpired = definitive;
      err.ceAuthRetained = !definitive;
      err.ceAuthTransient = !definitive && isTransientFailure(error);
      throw err;
    }
  };
  Object.defineProperty(CEClient.prototype, INSTALLED, { value: true, configurable: false });
  console.log(`[CE-QC][V217] ${V217_CE_AUTH_RETENTION_PATCH_ID} installed; transient refresh failures will no longer delete CE login tokens.`);
}
