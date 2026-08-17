import express from 'express';
import { periodRange } from './periodExporter.js';

const VERSION = '2026-08-17-v175-period-export-contract-async-safe-v1';
const originalJson = express.response.json;

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function fallbackRange(req) {
  const body = req?.body || {};
  const periodType = String(body.periodType || 'daily');
  if (periodType === 'custom') {
    const from = String(body.fromDate || '');
    const to = String(body.toDate || '');
    if (validDate(from) && validDate(to) && from <= to) return { from, to, key: `${from}_${to}` };
    return null;
  }
  const date = String(body.date || '');
  if (!validDate(date)) return null;
  return periodRange(periodType, date);
}

express.response.json = function v175PeriodExportContractJson(body) {
  try {
    const req = this.req;
    if (req?.path === '/api/export-period/prepare' && body?.ok === true) {
      // Large seven-business exports are intentionally asynchronous. Their prepare
      // response is { async:true, jobId } and files arrive later from the V84 job
      // status endpoint. Preserve that contract exactly instead of manufacturing
      // files:[], which makes clients mistake a queued job for an empty result.
      if (body.async === true && body.jobId) return originalJson.call(this, body);

      const current = body.range;
      const hasRange = validDate(current?.from) && validDate(current?.to);
      if (!hasRange) {
        const range = fallbackRange(req);
        if (range) body = { ...body, range };
      }
      if (body.files !== undefined && !Array.isArray(body.files)) body = { ...body, files: [] };
    }
  } catch {}
  return originalJson.call(this, body);
};

export const V174_PERIOD_EXPORT_CONTRACT_VERSION = VERSION;
