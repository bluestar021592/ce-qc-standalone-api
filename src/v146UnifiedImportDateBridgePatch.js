import express from 'express';

export const V146_UNIFIED_IMPORT_DATE_BRIDGE_ID = '2026-08-16-v146-unified-import-date-bridge-v1';
export const V146_UNIFIED_IMPORT_DATE_CONFLICT_GUARD_ID = '2026-08-30-v379-request-file-date-conflict-guard-v1';
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
  let match = base.match(/(?:^|[^0-9])(20\d{2})\s*(?:年|[._\-/])\s*(\d{1,2})\s*(?:月|[._\-/])\s*(\d{1,2})(?:\s*日|[^0-9]|$)/);
  if (match) return validDate(match[1], match[2], match[3]);
  match = base.match(/(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/);
  if (match) return validDate(match[1], match[2], match[3]);
  match = base.match(/(?:^|[^0-9])(\d{1,2})\s*(?:月|[._\-/])\s*(\d{1,2})(?:\s*日|[^0-9]|$)/);
  if (match) return validDate(new Date().getFullYear(), match[1], match[2]);
  return '';
}

export function resolveUnifiedImportDate({ requestDateValue = '', filename = '', requestSource = '' } = {}) {
  const requestDate = normalizeUnifiedReportDate(requestDateValue);
  const filenameDate = dateFromUnifiedFilename(filename);
  const source = String(requestSource || '').trim().toLowerCase();
  const explicitManual = source === 'manual';
  if (requestDate && filenameDate && requestDate !== filenameDate && !explicitManual) {
    return {
      ok: false,
      code: 'UNIFIED_IMPORT_DATE_CONFLICT',
      requestDate,
      filenameDate,
      reportDate: '',
      source: 'REQUEST_FILENAME_CONFLICT'
    };
  }
  const reportDate = explicitManual && requestDate ? requestDate : (requestDate || filenameDate);
  return {
    ok: true,
    code: '',
    requestDate,
    filenameDate,
    reportDate,
    source: explicitManual && requestDate ? 'MANUAL_REQUEST_DATE' : requestDate ? 'REQUEST_DATE_NORMALIZED' : filenameDate ? 'FILENAME_NORMALIZED' : 'WORKBOOK_DATE_PENDING'
  };
}

function normalizeImportDate(req, res, next) {
  try {
    const resolved = resolveUnifiedImportDate({
      requestDateValue: req.body?.reportDate || '',
      filename: req.file?.originalname || '',
      requestSource: req.body?.reportDateSource || ''
    });
    if (!resolved.ok) {
      res.setHeader('X-CE-QC-Import-Date-Bridge', V146_UNIFIED_IMPORT_DATE_BRIDGE_ID);
      res.setHeader('X-CE-QC-Import-Date-Conflict-Guard', V146_UNIFIED_IMPORT_DATE_CONFLICT_GUARD_ID);
      return res.status(400).json({
        ok: false,
        code: resolved.code,
        error: `日报日期冲突：请求日期 ${resolved.requestDate} 与文件名日期 ${resolved.filenameDate} 不一致。系统已阻止写入；如确需覆盖，请使用“修改日期”明确手动修正。`,
        requestDate: resolved.requestDate,
        filenameDate: resolved.filenameDate,
        importCommitted: false
      });
    }
    const reportDate = resolved.reportDate;
    if (reportDate) {
      if (!req.body || typeof req.body !== 'object') req.body = {};
      req.body.reportDate = reportDate;
      req.ceQcUnifiedImportDate = {
        reportDate,
        source: resolved.source,
        originalName: String(req.file?.originalname || '')
      };
      res.setHeader('X-CE-QC-Import-Date', reportDate);
      res.setHeader('X-CE-QC-Import-Date-Bridge', V146_UNIFIED_IMPORT_DATE_BRIDGE_ID);
      res.setHeader('X-CE-QC-Import-Date-Conflict-Guard', V146_UNIFIED_IMPORT_DATE_CONFLICT_GUARD_ID);
    }
    next();
  } catch (error) {
    next(error);
  }
}

const previousPost = express.application.post;
express.application.post = function v146UnifiedImportDateBridgePost(pathValue, ...handlers) {
  if (String(pathValue || '') === ROUTE && handlers.length) {
    return previousPost.call(this, pathValue, ...handlers.slice(0, -1), normalizeImportDate, handlers.at(-1));
  }
  return previousPost.call(this, pathValue, ...handlers);
};

export const __test = { validDate, normalizeUnifiedReportDate, dateFromUnifiedFilename, resolveUnifiedImportDate };
