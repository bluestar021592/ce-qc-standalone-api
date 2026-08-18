import { collectV200Rows } from './v200EvidenceData.js';
import {
  loadShopeeDeliveryTrackingMap,
  SHOPEE_DELIVERY_TRACKER_VERSION,
  syncShopeeDeliveryTrackingForRange
} from './shopeeDeliveryTracker.js';

export const V201_TRACKED_EXPORT_VERSION = '2026-08-18-v201-persistent-shopee-dispatch-export-v1';
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);

export async function collectV201TrackedRows(type, range, onProgress = () => {}) {
  const businessType = String(type || '').trim().toUpperCase();
  const rows = await collectV200Rows(businessType, range, onProgress);
  if (!SHOPEE_TYPES.has(businessType) || !rows.length) return rows;

  const sync = syncShopeeDeliveryTrackingForRange({
    fromDate: range.from,
    toDate: range.to,
    businessTypes: [businessType],
    analysisRows: rows,
    reason: 'V201_EXPORT_BACKFILL_AND_READ'
  });
  const facts = loadShopeeDeliveryTrackingMap({ businessType, bills: rows.map(row => row.shipmentCode) });
  let overlaid = 0;
  for (const row of rows) {
    const fact = facts.get(String(row.shipmentCode || '').trim().toUpperCase());
    if (!fact) continue;
    overlaid += 1;
    const trackedPod = Number(fact.podStatus || 0) === 1;
    if (trackedPod) {
      row.pod = true;
      row.podTime = fact.podTime || row.podTime || '';
      row.podDate = fact.podDate || row.podDate || '';
      row.podSource = `V201持久追踪:${fact.podSource || 'POD事实'}`;
      row.returned = false;
      row.pending = false;
      row.delivering = false;
    }
    row.firstReportDate = fact.firstReportDate || row.firstReportDate;
    row.lastReportDate = fact.lastReportDate || row.lastReportDate;
    row.regionCode = fact.regionCode || row.regionCode || '';
    row.recipientProvince = fact.recipientProvince || row.recipientProvince || '';
    row.area = fact.area || row.area || '未识别';
    row.firstDispatchDate = fact.firstDispatchDate || row.firstDispatchDate || '';
    row.attemptNo = trackedPod ? Number(fact.attemptNo || 0) : Number(row.attemptNo || fact.attemptNo || 0);
    row.trackAttemptNo = Number(fact.attemptNo || 0);
    row.attemptSource = `V201持久追踪:${fact.attemptSource || '无真实派次证据'}`;
    row.deliveryDays = trackedPod ? Number(fact.signNaturalDays || 0) : Number(row.deliveryDays || 0);
    row.dispatchToPodDays = Number(fact.dispatchToPodDays || 0);
    row.deliveryTrackingVersion = fact.trackerVersion || SHOPEE_DELIVERY_TRACKER_VERSION;
    row.deliveryTrackingEvidence = fact.evidenceJson || '';
  }
  onProgress({
    phase: 'persistentTracking',
    completed: overlaid,
    total: rows.length,
    tracked: sync.tracked || 0,
    pod: sync.pod || 0,
    a1: sync.a1 || 0,
    a2: sync.a2 || 0,
    a3: sync.a3 || 0,
    attemptUnknown: sync.attemptUnknown || 0,
    validSignDays: sync.validSignDays || 0,
    trackerVersion: SHOPEE_DELIVERY_TRACKER_VERSION
  });
  return rows;
}
