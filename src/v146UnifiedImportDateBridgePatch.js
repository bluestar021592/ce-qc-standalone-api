import express from 'express';
import './v209RawImportArchivePatch.js';

export const V146_UNIFIED_IMPORT_DATE_BRIDGE_ID = '2026-08-19-v209-unified-import-date-and-source-archive-bridge-v2';
const ROUTE = '/api/import/unified-daily-report';

function validDate(year, month, day) {
  const y = Number(year), m = Number(month), d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 2020 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function normalizeUnifiedReportDate(value) {
  const text = String(value || '').normalize('NFKC').trim()
    .replace(/[年/.]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/\s+/g, '');
  let match = text.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (match) return validDate(match[1], match[2], match[3]);
  match = text.match(/^(\d{1,2})-(\d{1,2})$/);
  if (match) return validDate(new Date().getFullYear(), match[1], match[2]);
  return '';
}

export function dateFromUnifiedFilename(filename = '') {
  const base = String(filename || '').normalize('NFKC').replace(/\.(xlsx|xls)$/i, '');
  const full = base.match(/(?:^|[^0-9])(20\d{2})[年._\-/](\d{1,2})[月._\-/](\d{1,2})(?:日|[^0-9]|$)/);
  if (full) return validDate(full[1], full[2], full[3]);
  const short = base.match(/(?:^|[^0-9])(\d{1,2})[._\-/](\d{1,2})(?:[^0-9]|$)/);
  if (short) return validDate(new Date().getFullYear(), short[1], short[2]);
  return '';
}

function normalizeImportDate(req, res, next) {
  try {
    const requestDate = normalizeUnifiedReportDate(req.body?.reportDate || '');
    const filenameDate = dateFromUnifiedFilename(req.file?.originalname || '');
    const reportDate = requestDate || filenameDate;
    if (reportDate) {
      if (!req.body || typeof req.body !== 'object') req.body = {};
      req.body.reportDate = reportDate;
      req.ceQcUnifiedImportDate = {
        reportDate,
        source: requestDate ? 'REQUEST_DATE_NORMALIZED' : 'FILENAME_NORMALIZED',
        originalName: String(req.file?.originalname || '')
      };
      res.setHeader('X-CE-QC-Import-Date', reportDate);
      res.setHeader('X-CE-QC-Import-Date-Bridge', V146_UNIFIED_IMPORT_DATE_BRIDGE_ID);
    }
    next();
  } catch (error) {
    next(error);
  }
}

const previousPost = express.application.post;
express.application.post = function v209UnifiedImportDateBridgePost(pathValue, ...handlers) {
  if (String(pathValue || '') === ROUTE && handlers.length) {
    return previousPost.call(this, pathValue, ...handlers.slice(0, -1), normalizeImportDate, handlers.at(-1));
  }
  return previousPost.call(this, pathValue, ...handlers);
};

export const __test = { validDate, normalizeUnifiedReportDate, dateFromUnifiedFilename };
