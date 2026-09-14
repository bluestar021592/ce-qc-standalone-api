import { getDb } from './db.js';

export const V514_CANONICAL_EXPORT_MEMBERSHIP_GUARD_ID = '2026-09-14-v514-canonical-export-membership-v1';
const BUSINESS_TYPES = new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);

const text = value => String(value ?? '').trim();
const billOf = value => text(value).toUpperCase();
const dateKey = value => {
  const match = text(value).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
};
const membershipDate = row => dateKey(row?.reportMembershipDate || row?.dailyMembershipDates?.[0] || row?.firstReportDate || row?.reportDate);

function fail(message, diagnostics = {}, code = 'V514_CANONICAL_EXPORT_MEMBERSHIP_MISMATCH') {
  const error = new Error(message);
  error.code = code;
  error.diagnostics = diagnostics;
  throw error;
}

function latestValidBatches(db, fromDate, toDate) {
  let rows;
  try {
    rows = db.prepare(`SELECT reportDate,snapshotId,batchId,createdAt
      FROM unified_import_batches
      WHERE status='VALID' AND reportDate BETWEEN ? AND ?
      ORDER BY reportDate ASC,createdAt DESC,batchId DESC`).all(fromDate, toDate);
  } catch (cause) {
    const error = new Error(`V514_CANONICAL_EXPORT_SOURCE_READ_FAILED: unified_import_batches: ${cause?.message || cause}`);
    error.code = 'V514_CANONICAL_EXPORT_SOURCE_READ_FAILED';
    error.cause = cause;
    throw error;
  }
  const selected = new Map();
  for (const row of rows || []) {
    const date = dateKey(row.reportDate);
    if (date && !selected.has(date)) selected.set(date, row);
  }
  return selected;
}

export function assertV514CanonicalExportMembership({ businessType, range, rows = [], db = getDb() } = {}) {
  const type = text(businessType).toUpperCase();
  const fromDate = dateKey(range?.from), toDate = dateKey(range?.to);
  if (!BUSINESS_TYPES.has(type)) fail(`V514不支持业务板块：${type || '空'}`, { businessType: type }, 'V514_BUSINESS_TYPE_UNSUPPORTED');
  if (!fromDate || !toDate || fromDate > toDate) fail('V514导出成员核对日期范围无效。', { businessType: type, fromDate, toDate }, 'V514_RANGE_INVALID');

  const batchesByDate = latestValidBatches(db, fromDate, toDate);
  const authoritativeDates = new Set(batchesByDate.keys());
  if (!authoritativeDates.size) {
    return {
      id: V514_CANONICAL_EXPORT_MEMBERSHIP_GUARD_ID,
      businessType: type,
      fromDate,
      toDate,
      authoritativeDays: 0,
      sourceMembers: 0,
      exportMembersOnAuthoritativeDays: 0,
      legacyOnly: true,
      passed: true
    };
  }

  let sourceStmt;
  try {
    sourceStmt = db.prepare(`SELECT shipmentCode
      FROM unified_import_rows
      WHERE snapshotId=? AND businessType=?
      ORDER BY shipmentCode`);
  } catch (cause) {
    const error = new Error(`V514_CANONICAL_EXPORT_SOURCE_READ_FAILED: unified_import_rows: ${cause?.message || cause}`);
    error.code = 'V514_CANONICAL_EXPORT_SOURCE_READ_FAILED';
    error.cause = cause;
    throw error;
  }

  const sourceKeys = new Set();
  const sourceDuplicateKeys = [];
  const sourceCountsByDate = {};
  for (const [date, batch] of batchesByDate) {
    let sourceRows;
    try { sourceRows = sourceStmt.all(batch.snapshotId, type); }
    catch (cause) {
      const error = new Error(`V514_CANONICAL_EXPORT_SOURCE_READ_FAILED:${type}:${date}:${cause?.message || cause}`);
      error.code = 'V514_CANONICAL_EXPORT_SOURCE_READ_FAILED';
      error.cause = cause;
      throw error;
    }
    const dayBills = new Set();
    for (const item of sourceRows || []) {
      const bill = billOf(item.shipmentCode);
      if (!bill) continue;
      const key = `${date}|${bill}`;
      if (sourceKeys.has(key)) sourceDuplicateKeys.push(key);
      sourceKeys.add(key);
      dayBills.add(bill);
    }
    sourceCountsByDate[date] = dayBills.size;
  }

  const exportKeys = new Set();
  const exportDuplicateKeys = [];
  const exportCountsByDate = {};
  for (const row of rows || []) {
    const date = membershipDate(row);
    if (!authoritativeDates.has(date)) continue;
    const bill = billOf(row?.shipmentCode || row?.运单号);
    if (!bill) continue;
    const key = `${date}|${bill}`;
    if (exportKeys.has(key)) exportDuplicateKeys.push(key);
    exportKeys.add(key);
    exportCountsByDate[date] = Number(exportCountsByDate[date] || 0) + 1;
  }

  const missingFromExport = [...sourceKeys].filter(key => !exportKeys.has(key));
  const unexpectedInExport = [...exportKeys].filter(key => !sourceKeys.has(key));
  const countMismatches = [...authoritativeDates].filter(date => Number(sourceCountsByDate[date] || 0) !== Number(exportCountsByDate[date] || 0));
  const diagnostics = {
    id: V514_CANONICAL_EXPORT_MEMBERSHIP_GUARD_ID,
    businessType: type,
    fromDate,
    toDate,
    authoritativeDays: authoritativeDates.size,
    authoritativeDates: [...authoritativeDates],
    sourceMembers: sourceKeys.size,
    exportMembersOnAuthoritativeDays: exportKeys.size,
    sourceCountsByDate,
    exportCountsByDate,
    sourceDuplicateKeys: sourceDuplicateKeys.slice(0, 20),
    exportDuplicateKeys: exportDuplicateKeys.slice(0, 20),
    missingFromExport: missingFromExport.slice(0, 20),
    unexpectedInExport: unexpectedInExport.slice(0, 20),
    countMismatches: countMismatches.slice(0, 20),
    passed: false
  };

  if (sourceDuplicateKeys.length || exportDuplicateKeys.length || missingFromExport.length || unexpectedInExport.length || countMismatches.length) {
    fail(
      `V514_CANONICAL_EXPORT_MEMBERSHIP_MISMATCH:${type}:source=${sourceKeys.size}:export=${exportKeys.size}:missing=${missingFromExport.length}:unexpected=${unexpectedInExport.length}:sourceDup=${sourceDuplicateKeys.length}:exportDup=${exportDuplicateKeys.length}:days=${countMismatches.join(',') || '-'}`,
      diagnostics
    );
  }

  return { ...diagnostics, passed: true };
}
