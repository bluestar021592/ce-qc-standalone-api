import crypto from 'crypto';
import fs from 'fs';
import express from 'express';
import XLSX from 'xlsx';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-13-v74-ceaf-duplicate-reimport-v1';
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

function repairStaleDuplicate(req) {
  const filePath = req?.file?.path;
  if (!filePath || !fs.existsSync(filePath)) return { repaired: false, reason: 'NO_FILE' };

  const airRows = countAirMarkerRows(filePath);
  if (airRows <= 0) return { repaired: false, reason: 'NO_AIR_MARKERS', airRows };

  const fileHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  const manualDate = String(req?.body?.reportDate || '').trim().slice(0, 10);
  const db = getDb();
  const existing = manualDate
    ? db.prepare("SELECT * FROM unified_import_batches WHERE reportDate=? AND fileHash=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1").get(manualDate, fileHash)
    : db.prepare("SELECT * FROM unified_import_batches WHERE fileHash=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1").get(fileHash);
  if (!existing) return { repaired: false, reason: 'NO_STALE_DUPLICATE', airRows };

  const existingCeaf = Number(db.prepare("SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=? AND businessType='CEAF'").get(existing.batchId)?.count || 0);
  if (existingCeaf >= airRows) return { repaired: false, reason: 'ALREADY_CORRECT', airRows, existingCeaf };

  const existingWhpp = Number(db.prepare("SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=? AND businessType='WHPP'").get(existing.batchId)?.count || 0);
  const changed = db.prepare("UPDATE unified_import_batches SET status='SUPERSEDED' WHERE batchId=? AND status='VALID'").run(existing.batchId);
  if (Number(changed?.changes || 0) !== 1) return { repaired: false, reason: 'STALE_BATCH_ALREADY_CHANGED', airRows, existingCeaf, existingWhpp };

  console.warn(`[CE-QC][V74_CEAF_REIMPORT] superseded stale duplicate batch=${existing.batchId} airMarkers=${airRows} existingCEAF=${existingCeaf} existingWHPP=${existingWhpp}`);
  return { repaired: true, batchId: existing.batchId, airRows, existingCeaf, existingWhpp };
}

const previousPost = express.application.post;
if (typeof previousPost === 'function' && !previousPost[WRAPPED]) {
  const wrappedPost = function v74CeafDuplicateReimportPost(path, ...handlers) {
    if (path !== '/api/import/unified-daily-report' || handlers.length === 0) {
      return previousPost.call(this, path, ...handlers);
    }

    const finalHandler = handlers.pop();
    if (typeof finalHandler !== 'function') {
      handlers.push(finalHandler);
      return previousPost.call(this, path, ...handlers);
    }

    const guardedFinalHandler = function v74CeafDuplicateGuard(req, res, next) {
      try {
        repairStaleDuplicate(req);
      } catch (error) {
        console.warn('[CE-QC][V74_CEAF_REIMPORT] repair skipped:', error?.message || error);
      }
      return finalHandler.call(this, req, res, next);
    };

    return previousPost.call(this, path, ...handlers, guardedFinalHandler);
  };
  Object.defineProperty(wrappedPost, WRAPPED, { value: true });
  express.application.post = wrappedPost;
}

export const V74_CEAF_DUPLICATE_REIMPORT_PATCH_ID = PATCH_ID;
export const __test = { countAirMarkerRows, isAirMarker };
