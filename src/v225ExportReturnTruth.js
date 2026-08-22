import { getDb } from './db.js';
import { collectV200Rows as collectBaseRows, V200_EXPORT_VERSION as BASE_EXPORT_VERSION } from './v200EvidenceData.js';
import { isShopeePending1203ReturnEvent } from './shopeeReturnTruth.js';

// Keep the V200 exporter contract/version stable because the launcher go-live
// gate validates this exact identifier. V225 is an additive truth-normalization
// layer, not a replacement of the V200 workbook contract.
export const V200_EXPORT_VERSION = BASE_EXPORT_VERSION;
export const V225_EXPORT_RETURN_TRUTH_ID = '2026-08-22-v225-return-terminal-export-v1';

function normalizeBill(value = '') {
  return String(value || '').trim().toUpperCase();
}

function chunks(values = [], size = 220) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function markReturned(row, source = '退回终态') {
  if (!row || row.pod) return row;
  row.returned = true;
  row.pending = false;
  row.delivering = false;
  row.statusCode = row.statusCode || 'R';
  row.statusDesc = 'RETURNED';
  row.returnSource = source;
  if (row.evidence?.add) row.evidence.add(source);
  return row;
}

function applyShopee1203SavedTrackTruth(type, rows) {
  if (!['SHOPEECN', 'SHOPEEVN'].includes(type) || !rows.length) return rows;
  const db = getDb();
  const byBill = new Map(rows.map(row => [normalizeBill(row.shipmentCode), row]));
  const bills = [...byBill.keys()].filter(Boolean);
  for (const chunk of chunks(bills)) {
    const marks = chunk.map(() => '?').join(',');
    let events = [];
    try {
      events = db.prepare(`
        SELECT shipmentCode,eventTime,eventCode,rawJson
        FROM business_track_events
        WHERE businessType='SHOPEE' AND shipmentCode IN (${marks})
        ORDER BY shipmentCode,eventTime,id
      `).all(...chunk);
    } catch {
      continue;
    }
    for (const event of events) {
      const bill = normalizeBill(event.shipmentCode);
      const row = byBill.get(bill);
      if (!row || row.pod || !bill.startsWith('SPE')) continue;
      if (isShopeePending1203ReturnEvent(event)) {
        markReturned(row, '轨迹历史:Pending1203派送异常');
      }
    }
  }
  return rows;
}

function normalizeTerminalExclusion(rows) {
  for (const row of rows) {
    if (!row) continue;
    if (row.pod) {
      row.returned = false;
      row.pending = false;
      row.delivering = false;
      continue;
    }
    if (row.returned) {
      row.pending = false;
      row.delivering = false;
      row.statusCode = row.statusCode || 'R';
      row.statusDesc = row.statusDesc || 'RETURNED';
    }
  }
  return rows;
}

export async function collectV200Rows(type, range, onProgress = () => {}) {
  const businessType = String(type || '').trim().toUpperCase();
  const rows = await collectBaseRows(businessType, range, onProgress);
  applyShopee1203SavedTrackTruth(businessType, rows);
  normalizeTerminalExclusion(rows);
  onProgress({
    phase: 'returnTruth',
    completed: rows.length,
    total: rows.length,
    returned: rows.filter(row => row.returned && !row.pod).length,
    notPodActive: rows.filter(row => !row.pod && !row.returned).length,
    engine: V225_EXPORT_RETURN_TRUTH_ID
  });
  return rows;
}
