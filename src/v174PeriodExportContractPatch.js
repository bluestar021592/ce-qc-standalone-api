import express from 'express';
import { periodRange } from './periodExporter.js';

const VERSION = '2026-08-17-v174-period-export-contract-v1';
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

express.response.json = function v174PeriodExportContractJson(body) {
  try {
    const req = this.req;
    if (req?.path === '/api/export-period/prepare' && body?.ok === true) {
      const current = body.range;
      const hasRange = validDate(current?.from) && validDate(current?.to);
      if (!hasRange) {
        const range = fallbackRange(req);
        if (range) body = { ...body, range };
      }
      if (!Array.isArray(body.files)) body = { ...body, files: [] };
    }
  } catch {}
  return originalJson.call(this, body);
};

export const V174_PERIOD_EXPORT_CONTRACT_VERSION = VERSION;
