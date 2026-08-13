import { CEClient, cleanAnyShipmentCodes } from './ceClient.js';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-13-v86-strict-track-status-gate-v1';
const OPEN_TRACK_STATUSES = new Set(['50', '60', '70']);
const GLOBAL_TERMINAL_STATUSES = new Set(['85', '100']);
const scanEvidence = new Map();

const originalConfirmQuery = CEClient.prototype.confirmQuery;
const originalTrackQuery = CEClient.prototype.trackQuery;
const originalShipmentTrack = CEClient.prototype.shipmentTrack;
const originalExceptionQuery = CEClient.prototype.exceptionQuery;

function billOf(row = {}) {
  return String(row.shipmentCode || row.waybill || row.运单号 || row.orderCode || row.code || '').trim().toUpperCase();
}

function statusOf(row = {}) {
  return String(row.orderStatus ?? row.scanOrderStatus ?? '').trim();
}

function rememberRows(rows = []) {
  for (const row of rows || []) {
    const bill = billOf(row);
    const status = statusOf(row);
    if (bill && status) scanEvidence.set(bill, { status, source: 'CONFIRM_QUERY', businessType: '' });
  }
}

function persistedEvidence(bill) {
  try {
    const db = getDb();
    const ccsl = db.prepare(`SELECT shipmentCode,orderStatus,reportDate,'CCSL' AS businessType FROM scan_results WHERE shipmentCode=? ORDER BY reportDate DESC LIMIT 1`).get(bill);
    const business = db.prepare(`SELECT shipmentCode,orderStatus,reportDate,businessType FROM business_scan_results WHERE shipmentCode=? ORDER BY reportDate DESC LIMIT 1`).get(bill);
    const candidates = [ccsl, business].filter(row => row && statusOf(row));
    candidates.sort((a, b) => String(b.reportDate || '').localeCompare(String(a.reportDate || '')));
    const row = candidates[0];
    if (!row) return null;
    return { status: statusOf(row), source: 'PERSISTED_SCAN', businessType: String(row.businessType || '').toUpperCase() };
  } catch {
    return null;
  }
}

function evidenceFor(bill) {
  const cached = scanEvidence.get(bill);
  if (cached?.status) return cached;
  const persisted = persistedEvidence(bill);
  if (persisted) scanEvidence.set(bill, persisted);
  return persisted;
}

function classifyBills(codes = []) {
  const allowed = [];
  const terminal = [];
  const hold = [];
  const unknownEvidence = [];
  for (const bill of cleanAnyShipmentCodes(codes)) {
    const evidence = evidenceFor(bill);
    if (!evidence?.status) {
      // Manual trajectory lookup or legacy evidence without a preceding scan is
      // still allowed. This gate only constrains automated scan→track pipelines.
      unknownEvidence.push(bill);
      continue;
    }
    if (OPEN_TRACK_STATUSES.has(evidence.status)) {
      allowed.push(bill);
      continue;
    }
    if (GLOBAL_TERMINAL_STATUSES.has(evidence.status) || (evidence.status === '10' && evidence.businessType === 'WHPP')) {
      terminal.push({ bill, ...evidence });
      continue;
    }
    hold.push({ bill, ...evidence });
  }
  return { allowed: [...allowed, ...unknownEvidence], terminal, hold };
}

function syntheticHoldEvent(item) {
  const text = `本地扫描状态门禁：orderStatus=${item.status || 'UNKNOWN'} 不属于50/60/70，未调用CE轨迹接口，保留扫描状态待识别`;
  return {
    shipmentCode: item.bill,
    eventCode: 'SCAN_STATUS_HOLD',
    trackingEventCode: 'SCAN_STATUS_HOLD',
    trackingEventDesc: text,
    trackingEventDescZh: text,
    eventTime: '',
    __ceQcSynthetic: 'SCAN_STATUS_HOLD',
    syntheticType: 'SCAN_STATUS_HOLD',
    scanOrderStatus: item.status || '',
    scanEvidenceSource: item.source || '',
    scanBusinessType: item.businessType || ''
  };
}

CEClient.prototype.confirmQuery = async function v86ConfirmQuery(shipmentCodes) {
  const rows = await originalConfirmQuery.call(this, shipmentCodes);
  rememberRows(rows);
  return rows;
};

CEClient.prototype.trackQuery = async function v86TrackQuery(shipmentCodes) {
  const requested = cleanAnyShipmentCodes(shipmentCodes);
  const { allowed, hold } = classifyBills(requested);
  const remote = allowed.length ? await originalTrackQuery.call(this, allowed) : [];
  // Terminal 85/100 (and WHPP 10) return no synthetic event: their scan evidence
  // remains the authoritative closure. Unknown/non-trackable statuses get one
  // local audit event so snapshot row reconciliation remains 1:1 without a CE call.
  return [...(remote || []), ...hold.map(syntheticHoldEvent)];
};

CEClient.prototype.shipmentTrack = async function v86ShipmentTrack(shipmentCodes) {
  const { allowed } = classifyBills(shipmentCodes);
  return allowed.length ? originalShipmentTrack.call(this, allowed) : [];
};

CEClient.prototype.exceptionQuery = async function v86ExceptionQuery(shipmentCodes) {
  const { allowed } = classifyBills(shipmentCodes);
  return allowed.length ? originalExceptionQuery.call(this, allowed) : [];
};

export function inspectStrictTrackGate(shipmentCodes = []) {
  return classifyBills(shipmentCodes);
}

export const V86_STRICT_TRACK_STATUS_GATE_ID = PATCH_ID;
export const V86_OPEN_TRACK_STATUSES = Object.freeze([...OPEN_TRACK_STATUSES]);
