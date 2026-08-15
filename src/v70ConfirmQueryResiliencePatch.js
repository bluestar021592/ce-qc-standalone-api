import { CEClient } from './ceClient.js';
import './v138StartupRunRecoveryPatch.js';

const PATCH_ID = '2026-08-15-v138-confirm-query-bounded-progress-v1';
const ORIGINAL = CEClient.prototype.confirmQuery;
const MAX_BATCH = Math.max(10, Math.min(50, Number(process.env.CONFIRM_QUERY_BATCH_SIZE || 50)));
const MIN_SPLIT = Math.max(1, Math.min(10, Number(process.env.CONFIRM_QUERY_MIN_SPLIT || 5)));
const CONFIRM_TIMEOUT_MS = Math.max(8000, Math.min(45000, Number(process.env.CONFIRM_QUERY_TIMEOUT_MS || 25000)));
const CONFIRM_BATCH_BUDGET_MS = Math.max(20_000, Math.min(120_000, Number(process.env.CONFIRM_QUERY_BATCH_BUDGET_MS || 45_000)));

// V70 already sends confirm-query to CE in chunks no larger than 50. Keep the
// pipeline checkpoint size aligned with the real network request size so progress
// advances after every real CE batch instead of appearing frozen inside a 350-row
// logical batch. This changes only checkpoint granularity, not business rules.
const configuredPipelineBatch = Number(process.env.ORDER_BATCH_SIZE || MAX_BATCH);
process.env.ORDER_BATCH_SIZE = String(Math.max(1, Math.min(MAX_BATCH, Number.isFinite(configuredPipelineBatch) ? configuredPipelineBatch : MAX_BATCH)));

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
  const code = String(error?.ceCode || '').toUpperCase();
  const message = String(error?.ceMsg || error?.message || '');
  return status === '401' || status === '403' || code === '401' || code === '403'
    || /未授权|unauthorized|token|过期|expired/i.test(message);
}

function isTransient(error) {
  const status = Number(error?.ceStatus || error?.response?.status || 0);
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const message = String(error?.message || error?.cause?.message || '');
  return [408, 425, 429, 500, 502, 503, 504].includes(status)
    || ['ECONNRESET','ECONNABORTED','ETIMEDOUT','EPIPE','EAI_AGAIN','ENETRESET','ENETUNREACH'].includes(code)
    || /socket hang up|connection reset|network error|timed?\s*out|timeout|premature close|read ECONNRESET/i.test(message);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function remainingMs(deadline) {
  return Math.max(0, Number(deadline || 0) - Date.now());
}

async function originalWithConfirmTimeout(client, codes, deadline) {
  const remaining = remainingMs(deadline);
  if (remaining <= 0) return [];
  const http = client?.http;
  const previousTimeout = http?.defaults?.timeout;
  const effectiveTimeout = Math.max(1000, Math.min(CONFIRM_TIMEOUT_MS, remaining));
  if (http?.defaults) http.defaults.timeout = effectiveTimeout;
  try {
    return await ORIGINAL.call(client, codes);
  } finally {
    if (http?.defaults && previousTimeout !== undefined) http.defaults.timeout = previousTimeout;
  }
}

async function queryAdaptive(client, codes, depth = 0, deadline = Date.now() + CONFIRM_BATCH_BUDGET_MS) {
  if (!codes.length || remainingMs(deadline) <= 0) return [];
  try {
    return await originalWithConfirmTimeout(client, codes, deadline);
  } catch (error) {
    if (isAuthError(error) || !isTransient(error)) throw error;
    if (remainingMs(deadline) <= 0) {
      console.warn(`[CE-QC][V138] confirm-query batch budget exhausted: ${codes.length} waybills deferred`);
      return [];
    }

    if (codes.length <= MIN_SPLIT) {
      const delay = Math.min(500 + depth * 120, Math.max(0, remainingMs(deadline) - 1000));
      if (delay > 0) await wait(delay);
      if (remainingMs(deadline) <= 0) return [];
      try {
        return await originalWithConfirmTimeout(client, codes, deadline);
      } catch (retryError) {
        if (isAuthError(retryError) || !isTransient(retryError)) throw retryError;
        console.warn(`[CE-QC][V138] confirm-query child deferred: ${codes.length} waybills; ${retryError?.message || retryError}`);
        return [];
      }
    }

    const nextSize = Math.max(MIN_SPLIT, Math.ceil(codes.length / 2));
    const parts = split(codes, nextSize);
    const rows = [];
    for (const part of parts) {
      if (remainingMs(deadline) <= 0) break;
      rows.push(...await queryAdaptive(client, part, depth + 1, deadline));
      if (parts.length > 1 && remainingMs(deadline) > 1000) await wait(Math.min(60, remainingMs(deadline) - 1000));
    }
    return rows;
  }
}

CEClient.prototype.confirmQuery = async function v138ConfirmQuery(shipmentCodes) {
  const codes = cleanCodes(shipmentCodes);
  if (!codes.length) return [];

  const rows = [];
  const batches = split(codes, MAX_BATCH);
  for (let i = 0; i < batches.length; i += 1) {
    const deadline = Date.now() + CONFIRM_BATCH_BUDGET_MS;
    rows.push(...await queryAdaptive(this, batches[i], 0, deadline));
    if (i < batches.length - 1) await wait(60);
  }
  return rows;
};

export const V70_CONFIRM_QUERY_RESILIENCE_PATCH_ID = PATCH_ID;
