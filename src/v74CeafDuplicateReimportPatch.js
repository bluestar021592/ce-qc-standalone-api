import crypto from 'crypto';
import fs from 'fs';
import express from 'express';
import XLSX from 'xlsx';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-16-v151-safe-same-file-reimport-v2';
const WRAPPED = Symbol.for('ce-qc.v74-ceaf-duplicate-reimport');

const SHIPMENT_HEADERS = new Set([
  '运单号', '运单编号', '单号', '面单号', '快递单号', '物流单号',
  'waybill', 'waybillno', 'waybillnumber', 'trackingno', 'trackingnumber', 'shipmentcode'
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

function countAirMarkerRows(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  let count = 0;
  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    let headerIndex = -1;
    for (let index = 0; index < Math.min(matrix.length, 30); index += 1) {
      const row = Array.isArray(matrix[index]) ? matrix[index] : [];
      if (row.some(value => SHIPMENT_HEADERS.has(normalizeHeader(value)))) {
        headerIndex = index;
        break;
      }
    }
    if (headerIndex < 0) continue;
    for (let index = headerIndex + 1; index < matrix.length; index += 1) {
      const row = Array.isArray(matrix[index]) ? matrix[index] : [];
      if (row.some(isAirMarker)) count += 1;
    }
  }
  return count;
}

function fileHashOf(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function prepareSameFileReplacement(req) {
  const filePath = req?.file?.path;
  if (!filePath || !fs.existsSync(filePath)) return { repaired: false, reason: 'NO_FILE' };

  const fileHash = fileHashOf(filePath);
  const manualDate = String(req?.body?.reportDate || '').trim().slice(0, 10);
  const db = getDb();
  const existing = manualDate
    ? db.prepare("SELECT * FROM unified_import_batches WHERE reportDate=? AND fileHash=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1").get(manualDate, fileHash)
    : db.prepare("SELECT * FROM unified_import_batches WHERE fileHash=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1").get(fileHash);
  if (!existing) return { repaired: false, reason: 'NO_EXISTING_SAME_FILE', fileHash };

  // Keep CEAF marker diagnostics because this patch originally repaired stale CEAF
  // classification. They are diagnostics only now: an intentional re-import of the
  // same daily workbook must be allowed for every business type.
  let airRows = 0;
  try { airRows = countAirMarkerRows(filePath); } catch {}
  const existingCeaf = Number(db.prepare("SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=? AND businessType='CEAF'").get(existing.batchId)?.count || 0);
  const existingWhpp = Number(db.prepare("SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=? AND businessType='WHPP'").get(existing.batchId)?.count || 0);
  const changed = db.prepare("UPDATE unified_import_batches SET status='SUPERSEDED' WHERE batchId=? AND status='VALID'").run(existing.batchId);
  if (Number(changed?.changes || 0) !== 1) {
    return { repaired: false, reason: 'SAME_FILE_BATCH_ALREADY_CHANGED', fileHash, reportDate: existing.reportDate, batchId: existing.batchId, airRows, existingCeaf, existingWhpp };
  }

  console.warn(`[CE-QC][V151_SAME_FILE_REIMPORT] prior VALID batch temporarily superseded batch=${existing.batchId} reportDate=${existing.reportDate}`);
  return {
    repaired: true,
    reason: 'SAME_FILE_REIMPORT_PREPARED',
    batchId: existing.batchId,
    reportDate: existing.reportDate,
    fileHash,
    airRows,
    existingCeaf,
    existingWhpp
  };
}

function restorePriorBatchIfReplacementFailed(prepared) {
  if (!prepared?.repaired || !prepared.batchId || !prepared.reportDate || !prepared.fileHash) return false;
  const db = getDb();
  const replacement = db.prepare(`
    SELECT batchId FROM unified_import_batches
    WHERE reportDate=? AND fileHash=? AND status='VALID' AND batchId<>?
    ORDER BY createdAt DESC LIMIT 1
  `).get(prepared.reportDate, prepared.fileHash, prepared.batchId);
  if (replacement?.batchId) return false;

  const activeSameDate = db.prepare(`
    SELECT batchId FROM unified_import_batches
    WHERE reportDate=? AND status='VALID' AND batchId<>?
    ORDER BY createdAt DESC LIMIT 1
  `).get(prepared.reportDate, prepared.batchId);
  if (activeSameDate?.batchId) return false;

  const restored = db.prepare("UPDATE unified_import_batches SET status='VALID' WHERE batchId=? AND status='SUPERSEDED'").run(prepared.batchId);
  if (Number(restored?.changes || 0) === 1) {
    console.warn(`[CE-QC][V151_SAME_FILE_REIMPORT] replacement failed; restored prior batch=${prepared.batchId} reportDate=${prepared.reportDate}`);
    return true;
  }
  return false;
}

const previousPost = express.application.post;
if (typeof previousPost === 'function' && !previousPost[WRAPPED]) {
  const wrappedPost = function v151SafeSameFileReimportPost(path, ...handlers) {
    if (path !== '/api/import/unified-daily-report' || handlers.length === 0) {
      return previousPost.call(this, path, ...handlers);
    }

    const finalHandler = handlers.pop();
    if (typeof finalHandler !== 'function') {
      handlers.push(finalHandler);
      return previousPost.call(this, path, ...handlers);
    }

    const guardedFinalHandler = function v151SafeSameFileReimportGuard(req, res, next) {
      let prepared = { repaired: false, reason: 'NOT_PREPARED' };
      try {
        prepared = prepareSameFileReplacement(req);
      } catch (error) {
        console.warn('[CE-QC][V151_SAME_FILE_REIMPORT] prepare skipped:', error?.message || error);
      }

      if (prepared.repaired && res && typeof res.json === 'function') {
        const originalJson = res.json.bind(res);
        res.json = function v151SafeReimportJson(body) {
          if (Number(res.statusCode || 200) >= 400 || body?.ok === false) {
            try { restorePriorBatchIfReplacementFailed(prepared); } catch (error) {
              console.warn('[CE-QC][V151_SAME_FILE_REIMPORT] restore after error failed:', error?.message || error);
            }
          }
          return originalJson(body);
        };
      }

      try {
        const result = finalHandler.call(this, req, res, next);
        if (result && typeof result.then === 'function') {
          return result.catch(error => {
            try { restorePriorBatchIfReplacementFailed(prepared); } catch {}
            throw error;
          });
        }
        return result;
      } catch (error) {
        try { restorePriorBatchIfReplacementFailed(prepared); } catch {}
        throw error;
      }
    };

    return previousPost.call(this, path, ...handlers, guardedFinalHandler);
  };
  Object.defineProperty(wrappedPost, WRAPPED, { value: true });
  express.application.post = wrappedPost;
}

export const V74_CEAF_DUPLICATE_REIMPORT_PATCH_ID = PATCH_ID;
export const __test = { countAirMarkerRows, isAirMarker, fileHashOf };
