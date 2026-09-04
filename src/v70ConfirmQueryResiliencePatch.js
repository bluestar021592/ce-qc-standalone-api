import { CEClient } from './ceClient.js';
import './v138StartupRunRecoveryPatch.js';
import './v140ShopeeCheckpointRecoveryPatch.js';
import './v139DailyCarryIsolationPatch.js';

const PATCH_ID = '2026-08-16-v140-confirm-track-final-retry-v2';
export const V392_CONFIRM_TRANSPORT_BOUNDARY_ID = '2026-08-31-v392-confirm-transport-boundary-single-completeness-owner-v2';
const ORIGINAL_CONFIRM = CEClient.prototype.confirmQuery;
const MAX_BATCH = Math.max(10, Math.min(100, Number(process.env.CONFIRM_QUERY_BATCH_SIZE || 100)));
const MIN_SPLIT = Math.max(1, Math.min(10, Number(process.env.CONFIRM_QUERY_MIN_SPLIT || 5)));
const CONFIRM_TIMEOUT_MS = Math.max(8000, Math.min(45000, Number(process.env.CONFIRM_QUERY_TIMEOUT_MS || 25000)));
const CONFIRM_BATCH_BUDGET_MS = Math.max(20_000, Math.min(120_000, Number(process.env.CONFIRM_QUERY_BATCH_BUDGET_MS || 45_000)));

// Consolidation rule:
// - V70 is transport safety for confirm-query only.
// - V349 owns successful-response completeness recovery.
// - trackBatching.js owns trajectory/exception retry budgets and fixed 50-ticket batches.
// V70 must never wrap trackQuery/exceptionQuery again; doing so multiplied retry loops
// and made one slow 50-ticket batch occupy the pipeline several times before the
// canonical retry center could take over.

function cleanCodes(values = []) {
  return [...new Set((values || [])
    .map(value => String(value || '').trim().toUpperCase())
    .filter(Boolean))];
}

function split(values, size) {
  const rows = [];
  for (let i = 0; i < values.length; i += size) rows.push(values.slice(i, i + size));
  return rows;
}

function isAuthError(error) {
  const status = String(error?.ceStatus || error?.response?.status || '');
  const code = String(error?.ceCode || error?.code || '').toUpperCase();
  const message = String(error?.ceMsg || error?.message || '');
  return status === '401' || status === '403' || code === '401' || code === '403' || code === 'AUTH_REQUIRED'
    || /未授权|unauthorized|token|过期|expired/i.test(message);
}

function isPermanentRequestError(error) {
  const status = Number(error?.ceStatus || error?.response?.status || 0);
  const code = String(error?.ceCode || error?.code || '').toUpperCase();
  return [400, 401, 403, 404, 422].includes(status)
    || ['400', '401', '403', '404', '422', 'REQUEST_SCHEMA_INVALID', 'ENDPOINT_INVALID', 'AUTH_REQUIRED'].includes(code);
}

function isTransient(error) {
  const status = Number(error?.ceStatus || error?.response?.status || 0);
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const message = String(error?.message || error?.cause?.message || '');
  return [408, 425, 429, 500, 502, 503, 504].includes(status)
    || ['ECONNRESET','ECONNABORTED','ETIMEDOUT','EPIPE','EAI_AGAIN','ENETRESET','ENETUNREACH','CE_CONFIRM_BATCH_BUDGET_EXHAUSTED'].includes(code)
    || /socket hang up|connection reset|network error|timed?\s*out|timeout|premature close|read ECONNRESET|transport budget exhausted/i.test(message);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function remainingMs(deadline) {
  return Math.max(0, Number(deadline || 0) - Date.now());
}

function budgetError(codes = []) {
  const error = new Error(`confirm-query transport budget exhausted for ${codes.length} waybills`);
  error.code = 'CE_CONFIRM_BATCH_BUDGET_EXHAUSTED';
  return error;
}

async function originalWithConfirmTimeout(client, codes, deadline) {
  const remaining = remainingMs(deadline);
  if (remaining <= 0) throw budgetError(codes);
  const http = client?.http;
  const previousTimeout = http?.defaults?.timeout;
  const effectiveTimeout = Math.max(1000, Math.min(CONFIRM_TIMEOUT_MS, remaining));
  if (http?.defaults) http.defaults.timeout = effectiveTimeout;
  try {
    return await ORIGINAL_CONFIRM.call(client, codes);
  } finally {
    if (http?.defaults && previousTimeout !== undefined) http.defaults.timeout = previousTimeout;
  }
}

async function queryAdaptive(client, codes, depth = 0, deadline = Date.now() + CONFIRM_BATCH_BUDGET_MS) {
  if (!codes.length) return [];
  if (remainingMs(deadline) <= 0) throw budgetError(codes);
  try {
    return await originalWithConfirmTimeout(client, codes, deadline);
  } catch (error) {
    if (isAuthError(error) || !isTransient(error)) throw error;
    if (remainingMs(deadline) <= 0) {
      console.warn(`[CE-QC][V392] confirm-query transport budget exhausted: ${codes.length} waybills`);
      throw error;
    }

    if (codes.length <= MIN_SPLIT) {
      const delay = Math.min(500 + depth * 120, Math.max(0, remainingMs(deadline) - 1000));
      if (delay > 0) await wait(delay);
      if (remainingMs(deadline) <= 0) throw error;
      try {
        return await originalWithConfirmTimeout(client, codes, deadline);
      } catch (retryError) {
        if (isAuthError(retryError) || !isTransient(retryError)) throw retryError;
        console.warn(`[CE-QC][V392] confirm-query transport child failed: ${codes.length} waybills; ${retryError?.message || retryError}`);
        throw retryError;
      }
    }

    const nextSize = Math.max(MIN_SPLIT, Math.ceil(codes.length / 2));
    const parts = split(codes, nextSize);
    const rows = [];
    for (const part of parts) {
      if (remainingMs(deadline) <= 0) throw budgetError(part);
      rows.push(...await queryAdaptive(client, part, depth + 1, deadline));
      if (parts.length > 1 && remainingMs(deadline) > 1000) await wait(Math.min(60, remainingMs(deadline) - 1000));
    }
    return rows;
  }
}

async function queryConfirmBatches(client, codes) {
  const rows = [];
  let successfulTransportBatches = 0;
  let lastTransportError = null;
  const batches = split(codes, MAX_BATCH);
  for (const batch of batches) {
    const deadline = Date.now() + CONFIRM_BATCH_BUDGET_MS;
    try {
      rows.push(...await queryAdaptive(client, batch, 0, deadline));
      successfulTransportBatches += 1;
    } catch (error) {
      if (isAuthError(error) || isPermanentRequestError(error) || !isTransient(error)) throw error;
      lastTransportError = error;
      console.warn(`[CE-QC][V392] confirm-query safe transport chunk deferred to V349/V345 owner: ${batch.length} waybills; ${error?.message || error}`);
    }
  }
  if (successfulTransportBatches === 0 && lastTransportError) throw lastTransportError;
  return rows;
}

CEClient.prototype.confirmQuery = async function v140ConfirmQuery(shipmentCodes) {
  const codes = cleanCodes(shipmentCodes);
  if (!codes.length) return [];
  return queryConfirmBatches(this, codes);
};

export const V70_CONFIRM_QUERY_RESILIENCE_PATCH_ID = PATCH_ID;
// Compatibility export only. Track/exception retry ownership was consolidated into
// trackBatching.js, so the legacy V139/V140 nested final-retry count is now zero.
export const V139_FINAL_RETRY_ROUNDS = 0;

console.info('[CE-QC][V392_CONFIRM_TRANSPORT_BOUNDARY]', JSON.stringify({
  id: V392_CONFIRM_TRANSPORT_BOUNDARY_ID,
  logicalScanBatch: Number(process.env.ORDER_BATCH_SIZE || 350),
  safeTransportBatch: MAX_BATCH,
  completenessOwner: 'V349',
  logicalBatchOwner: 'V338+V314/V345',
  trackRetryOwner: 'trackBatching',
  exceptionRetryOwner: 'trackBatching',
  trackQueryWrappedHere: false,
  exceptionQueryWrappedHere: false,
  transportFailurePolicy: 'PRESERVE_SUCCESSFUL_SAFE_CHUNKS_THEN_RETRY_ONLY_MISSING',
  duplicateMissingRetry: false,
  duplicateTrackRetry: false
}));
