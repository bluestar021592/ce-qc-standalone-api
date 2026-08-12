import { CEClient } from './ceClient.js';

const PATCH_ID = '2026-08-12-v70-confirm-query-resilience-v1';
const ORIGINAL = CEClient.prototype.confirmQuery;
const MAX_BATCH = Math.max(10, Math.min(350, Number(process.env.CONFIRM_QUERY_BATCH_SIZE || 100)));
const MIN_SPLIT = Math.max(1, Math.min(25, Number(process.env.CONFIRM_QUERY_MIN_SPLIT || 10)));

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
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const message = String(error?.message || error?.cause?.message || '');
  return ['ECONNRESET','ECONNABORTED','ETIMEDOUT','EPIPE','EAI_AGAIN','ENETRESET','ENETUNREACH'].includes(code)
    || /socket hang up|connection reset|network error|timed?\s*out|timeout|premature close|read ECONNRESET/i.test(message);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

async function queryAdaptive(client, codes, depth = 0) {
  try {
    return await ORIGINAL.call(client, codes);
  } catch (error) {
    if (isAuthError(error) || !isTransient(error)) throw error;

    if (codes.length <= MIN_SPLIT) {
      // Small transient failures get one final retry instead of immediately
      // poisoning the whole parent batch.
      await wait(350 + depth * 150);
      return ORIGINAL.call(client, codes);
    }

    const half = Math.max(MIN_SPLIT, Math.ceil(codes.length / 2));
    const parts = split(codes, half);
    const rows = [];
    for (const part of parts) {
      rows.push(...await queryAdaptive(client, part, depth + 1));
      if (parts.length > 1) await wait(80);
    }
    return rows;
  }
}

CEClient.prototype.confirmQuery = async function v70ConfirmQuery(shipmentCodes) {
  const codes = cleanCodes(shipmentCodes);
  if (!codes.length) return [];

  const rows = [];
  const batches = split(codes, MAX_BATCH);
  for (let i = 0; i < batches.length; i += 1) {
    rows.push(...await queryAdaptive(this, batches[i], 0));
    if (i < batches.length - 1) await wait(80);
  }
  return rows;
};

export const V70_CONFIRM_QUERY_RESILIENCE_PATCH_ID = PATCH_ID;
