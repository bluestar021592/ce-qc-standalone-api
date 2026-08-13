import fs from 'fs';
import express from 'express';
import XLSX from 'xlsx';

const PATCH_ID = '2026-08-13-v75-ceaf-upload-normalizer-v1';
const WRAPPED = Symbol.for('ce-qc.v75-ceaf-upload-normalizer');

const SHIPMENT_HEADERS = new Set([
  '运单号', '运单编号', '单号', '面单号', '快递单号', '物流单号',
  'waybill', 'waybillno', 'waybillnumber', 'trackingno', 'trackingnumber', 'shipmentcode'
].map(normalizeHeader));

const CUSTOMER_HEADERS = new Set([
  '客户名称', '客户名', '客户', 'customername', 'customer', 'clientname'
].map(normalizeHeader));

function normalizeHeader(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

function normalizeMarker(value) {
  return String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/[\s_\-]+/g, '');
}

function isAirMarker(value) {
  const token = normalizeMarker(value);
  return token === 'CCAF' || token === 'CEAF';
}

function findHeaderIndex(matrix) {
  for (let index = 0; index < Math.min(matrix.length, 30); index += 1) {
    const row = Array.isArray(matrix[index]) ? matrix[index] : [];
    if (row.some(value => SHIPMENT_HEADERS.has(normalizeHeader(value)))) return index;
  }
  return -1;
}

function expandSheetRef(sheet, rowIndex, columnIndex) {
  const current = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  current.s.r = Math.min(current.s.r, rowIndex);
  current.s.c = Math.min(current.s.c, columnIndex);
  current.e.r = Math.max(current.e.r, rowIndex);
  current.e.c = Math.max(current.e.c, columnIndex);
  sheet['!ref'] = XLSX.utils.encode_range(current);
}

function setStringCell(sheet, rowIndex, columnIndex, value) {
  sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })] = { t: 's', v: String(value) };
  expandSheetRef(sheet, rowIndex, columnIndex);
}

function normalizeUploadedWorkbook(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { changed: false, airRows: 0, sheets: [] };

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  let airRows = 0;
  const sheets = [];

  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    const headerIndex = findHeaderIndex(matrix);
    if (headerIndex < 0) continue;

    const header = Array.isArray(matrix[headerIndex]) ? matrix[headerIndex] : [];
    let customerIndex = header.findIndex(value => CUSTOMER_HEADERS.has(normalizeHeader(value)));
    if (customerIndex < 0) {
      customerIndex = header.length;
      setStringCell(sheet, headerIndex, customerIndex, '客户名称');
    }

    let sheetAirRows = 0;
    for (let rowIndex = headerIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
      const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
      if (!row.some(value => String(value ?? '').trim())) continue;
      if (!row.some(isAirMarker)) continue;
      setStringCell(sheet, rowIndex, customerIndex, 'CCAF');
      sheetAirRows += 1;
    }

    if (sheetAirRows > 0) {
      airRows += sheetAirRows;
      sheets.push({ sheetName, headerRow: headerIndex + 1, customerColumn: customerIndex + 1, airRows: sheetAirRows });
    }
  }

  if (airRows <= 0) return { changed: false, airRows: 0, sheets };

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
  fs.writeFileSync(filePath, buffer);
  return { changed: true, airRows, sheets };
}

const previousPost = express.application.post;
if (typeof previousPost === 'function' && !previousPost[WRAPPED]) {
  const wrappedPost = function v75CeafUploadNormalizerPost(pathValue, ...handlers) {
    if (pathValue !== '/api/import/unified-daily-report' || handlers.length === 0) {
      return previousPost.call(this, pathValue, ...handlers);
    }

    const finalHandler = handlers.pop();
    if (typeof finalHandler !== 'function') {
      handlers.push(finalHandler);
      return previousPost.call(this, pathValue, ...handlers);
    }

    const guardedFinalHandler = function v75CeafUploadNormalizer(req, res, next) {
      try {
        const normalized = normalizeUploadedWorkbook(req?.file?.path || '');
        req.ceafSourceNormalization = normalized;
        if (normalized.airRows > 0) {
          console.log(`[CE-QC][V75_CEAF_SOURCE] normalized ${normalized.airRows} CCAF/CEAF rows before unified classification`);
        }
      } catch (error) {
        console.error('[CE-QC][V75_CEAF_SOURCE] failed:', error);
        return res.status(400).json({
          ok: false,
          code: 'CEAF_SOURCE_NORMALIZATION_FAILED',
          error: `空运源数据预处理失败：${error?.message || String(error)}`
        });
      }
      return finalHandler.call(this, req, res, next);
    };

    return previousPost.call(this, pathValue, ...handlers, guardedFinalHandler);
  };
  Object.defineProperty(wrappedPost, WRAPPED, { value: true });
  express.application.post = wrappedPost;
}

export const V75_CEAF_UPLOAD_NORMALIZER_PATCH_ID = PATCH_ID;
export const __test = { normalizeUploadedWorkbook, isAirMarker, findHeaderIndex };
