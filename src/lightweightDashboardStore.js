import { getDb } from './db.js';
import { loadWhppCanonicalTruth } from './whppCanonicalTruth.js';

const BUSINESS_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const EXPORT_BUSINESS_TYPES = Object.freeze([...BUSINESS_TYPES,'WHPP']);

/**
 * Memory-safe dashboard reader.
 *
 * IMPORTANT: this module deliberately never reads these large JSON blobs:
 *   - app_state.valueJson
 *   - business_states.valueJson
 *   - unified_snapshots.payloadJson
 *   - export_snapshots.payloadJson
 *   - business_export_snapshots.payloadJson
 *   - track_events.rawJson collections
 *
 * Dashboard pages are rebuilt from normalized SQLite columns. Raw evidence remains
 * available through the existing per-waybill detail endpoint and is loaded only when
 * the user opens one shipment.
 */
export function loadLightweightUnifiedBusinessState(businessType, snapshotId = '', options = {}) {
  const type = normalizeBusinessType(businessType);
  const db = getDb();
  const batch = selectBatch(db, snapshotId);
  if (!batch) return emptyState(type);

  const dailyRows = loadDailyRows(db, batch.snapshotId, type);
  const bills = dailyRows.map(billOf).filter(Boolean);
  const finalRows = mergeBusinessRows(
    dailyRows,
    loadCurrentStateRows(db, batch.snapshotId, type),
    loadFinalRows(db, batch, type)
  );
  const scanResults = loadScanRows(db, batch, type);
  const carryBills = filterActiveCarryMembers(db.prepare(`
    SELECT shipmentCode FROM carryover_open_items
    WHERE businessType=? AND status='OPEN' AND lastReportDate<=?
    ORDER BY shipmentCode
  `).all(type, batch.reportDate).map(row => row.shipmentCode),type,batch.reportDate,db);
  const podLocks = db.prepare(`
    SELECT c.shipmentCode
    FROM shipment_current_state c
    INNER JOIN unified_import_rows u
      ON u.shipmentCode=c.shipmentCode AND u.snapshotId=? AND u.businessType=?
    WHERE UPPER(COALESCE(c.state,''))='POD'
    ORDER BY c.shipmentCode
  `).all(batch.snapshotId, type).map(row => row.shipmentCode);
  const run = loadRun(db, batch.reportDate, type);
  const historySummary = options.includeHistory === false ? [] : listLightweightBusinessHistory(type, batch.reportDate, 30);
  const needTrackBills = scanResults
    .filter(row => Number(row.needsTrackQuery || 0) === 1 && !isPodRow(row))
    .map(billOf)
    .filter(Boolean);

  return {
    businessType: type,
    reportDate: batch.reportDate,
    sourceName: batch.sourceName || '',
    batchId: batch.batchId,
    snapshotId: batch.snapshotId,
    snapshotStatus: batch.snapshotStatus || 'IMPORTED',
    dailyReportReady: true,
    pnhBills: bills,
    nonPnhBills: [],
    excludedBills: [],
    duplicateBills: [],
    dailyParseRows: dailyRows,
    dailyParseSummary: {
      totalRecognized: bills.length,
      pnh: bills.length,
      nonPnh: 0,
      excluded: 0,
      duplicates: 0,
      groupCounts: {
        CN: type === 'SHOPEECN' ? bills.length : 0,
        VN: type === 'SHOPEEVN' ? bills.length : 0
      }
    },
    finalRows,
    scanResults,
    scanPool: bills,
    needTrackBills,
    trackResults: finalRows,
    // Full event history is intentionally not loaded for a dashboard request.
    // /api/detail reads one shipment's events on demand.
    trackEvents: [],
    carryBills,
    nextCarryBills: carryBills,
    podLocks,
    historySummary,
    currentRun: run,
    lastRunSummary: run ? { runId: run.runId, reportDate: batch.reportDate, runStatus: run.status } : null,
    processing: run ? {
      running: run.status === 'running',
      paused: run.status === 'paused',
      phase: run.currentStage || '',
      batchIndex: Number(run.batchIndex || 0),
      totalBatches: Number(run.totalBatches || 0),
      error: run.errorMessage || ''
    } : { running: false, paused: false, phase: '' },
    logs: [],
    _normalizedSqliteRead: true,
    _rawEvidenceDeferred: true
  };
}

export function loadLightweightAggregateState(scope = 'CCSL', snapshotId = '') {
  const normalizedScope = String(scope || 'CCSL').toUpperCase();
  const types = normalizedScope === 'SHOPEE'
    ? ['SHOPEECN', 'SHOPEEVN']
    : ['CE', 'CEAF', 'TBKH', 'ALI1688'];
  const states = types.map(type => loadLightweightUnifiedBusinessState(type, snapshotId));
  const active = states.filter(state => state.snapshotId);
  if (!active.length) return emptyAggregate(normalizedScope);
  const reference = active[0];
  const historySummary = aggregateHistory(states);
  const unique = values => [...new Set(states.flatMap(state => state[values] || []).map(value => typeof value === 'string' ? value : billOf(value)).filter(Boolean))];
  return {
    businessType: normalizedScope,
    reportDate: reference.reportDate,
    sourceName: reference.sourceName,
    snapshotId: reference.snapshotId,
    snapshotStatus: active.every(state => state.snapshotStatus === 'COMPLETED') ? 'COMPLETED' : reference.snapshotStatus,
    dailyReportReady: true,
    pnhBills: unique('pnhBills'),
    nonPnhBills: [],
    excludedBills: [],
    duplicateBills: [],
    dailyParseRows: states.flatMap(state => state.dailyParseRows || []),
    dailyParseSummary: {
      totalRecognized: states.reduce((sum, state) => sum + Number(state.pnhBills?.length || 0), 0),
      pnh: states.reduce((sum, state) => sum + Number(state.pnhBills?.length || 0), 0),
      groupCounts: {
        CN: states.find(state => state.businessType === 'SHOPEECN')?.pnhBills?.length || 0,
        VN: states.find(state => state.businessType === 'SHOPEEVN')?.pnhBills?.length || 0
      }
    },
    finalRows: states.flatMap(state => state.finalRows || []),
    scanResults: states.flatMap(state => state.scanResults || []),
    scanPool: unique('pnhBills'),
    needTrackBills: unique('needTrackBills'),
    trackResults: states.flatMap(state => state.trackResults || []),
    trackEvents: [],
    carryBills: unique('carryBills'),
    nextCarryBills: unique('nextCarryBills'),
    podLocks: unique('podLocks'),
    historySummary,
    currentRun: reference.currentRun || null,
    lastRunSummary: reference.lastRunSummary || null,
    processing: reference.processing || { running: false, paused: false, phase: '' },
    logs: [],
    _normalizedSqliteRead: true,
    _rawEvidenceDeferred: true
  };
}

export function listLightweightBusinessHistory(businessType, throughDate = '9999-12-31', limit = 30) {
  const type = normalizeBusinessType(businessType);
  const db = getDb();
  const maxRows = Math.max(1, Math.min(120, Number(limit) || 30));
  const batches = db.prepare(`
    SELECT b.snapshotId,b.reportDate,b.createdAt,COUNT(r.id) AS total
    FROM unified_import_batches b
    INNER JOIN unified_import_rows r
      ON r.snapshotId=b.snapshotId AND r.businessType=?
    WHERE b.status='VALID' AND b.reportDate<=?
    GROUP BY b.snapshotId,b.reportDate,b.createdAt
    ORDER BY b.reportDate DESC,b.createdAt DESC
    LIMIT ?
  `).all(type, throughDate || '9999-12-31', maxRows);

  const results = [];
  const seen = new Set();
  for (const batch of batches) {
    if (!batch.reportDate || seen.has(batch.reportDate)) continue;
    seen.add(batch.reportDate);
    const total = Number(batch.total || 0);
    const counts = SHOPEE_TYPES.has(type)
      ? shopeeHistoryCounts(db, batch.snapshotId, batch.reportDate, type)
      : ccslHistoryCounts(db, batch.snapshotId, batch.reportDate, type);
    const pod = Number(counts.pod || 0);
    const oc = Number(counts.oc || 0);
    const firstPod = Number(counts.firstPod || pod);
    results.push({
      reportDate: batch.reportDate,
      businessType: type,
      summary: {
        reportDate: batch.reportDate,
        today: total,
        pnh: total,
        todayPnh: total,
        scanPod: pod,
        todayPod: pod,
        podRate: rate(pod, total),
        firstPodRate: rate(firstPod, total),
        ocRate: rate(oc, total)
      }
    });
  }
  return results.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

function selectBatch(db, snapshotId) {
  if (String(snapshotId || '').trim()) {
    return db.prepare(`
      SELECT b.*,s.status AS snapshotStatus
      FROM unified_import_batches b
      LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.snapshotId=?
      LIMIT 1
    `).get(String(snapshotId).trim());
  }
  return db.prepare(`
    SELECT b.*,s.status AS snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID'
    ORDER BY b.createdAt DESC
    LIMIT 1
  `).get();
}

function loadDailyRows(db, snapshotId, type) {
  return db.prepare(`
    SELECT shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,
           classificationReason,classificationSource,classificationMatchedValue,classificationWarning
    FROM unified_import_rows
    WHERE snapshotId=? AND businessType=?
    ORDER BY shipmentCode
  `).all(snapshotId, type).map(row => ({
    shipmentCode: row.shipmentCode,
    运单号: row.shipmentCode,
    businessType: type,
    regionCode: row.regionCode || '',
    region_code: row.regionCode || '',
    region_type: row.regionCode || '',
    recipientRaw: row.recipientRaw || '',
    recipient_raw: row.recipientRaw || '',
    recipientNormalized: row.recipientNormalized || '',
    recipient_normalized: row.recipientNormalized || '',
    recipient_group: type === 'SHOPEECN' ? 'CN' : type === 'SHOPEEVN' ? 'VN' : '',
    sheetName: row.sheetName || '',
    rowNumber: Number(row.rowNumber || 0),
    source_row_number: Number(row.rowNumber || 0),
    classificationReason: row.classificationReason || '',
    classificationSource: row.classificationSource || '',
    classificationMatchedValue: row.classificationMatchedValue || '',
    classificationWarning: row.classificationWarning || '',
    result: 'PNH'
  }));
}

function loadCurrentStateRows(db, snapshotId, type) {
  return db.prepare(`
    SELECT c.shipmentCode,c.state,c.apiStatus,c.lastEventTime,c.updatedAt
    FROM shipment_current_state c
    INNER JOIN unified_import_rows u
      ON u.shipmentCode=c.shipmentCode AND u.snapshotId=? AND u.businessType=?
    WHERE c.snapshotId=?
    ORDER BY c.shipmentCode
  `).all(snapshotId, type, snapshotId).map(row => ({
    shipmentCode: row.shipmentCode,
    运单号: row.shipmentCode,
    businessType: type,
    currentState: row.state || '',
    scanNormalizedState: row.state || '',
    apiStatus: row.apiStatus || '',
    API状态: row.apiStatus || '',
    lastEventTime: row.lastEventTime || '',
    最后节点时间: row.lastEventTime || '',
    是否POD: String(row.state || '').toUpperCase() === 'POD' ? '是' : '否'
  }));
}

function loadFinalRows(db, batch, type) {
  if (SHOPEE_TYPES.has(type)) {
    return db.prepare(`
      SELECT f.*
      FROM business_final_rows f
      INNER JOIN unified_import_rows u
        ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
      WHERE f.businessType='SHOPEE' AND f.reportDate=?
      ORDER BY f.shipmentCode
    `).all(batch.snapshotId, type, batch.reportDate).map(row => normalizeShopeeFinalRow(row, type));
  }
  return db.prepare(`
    SELECT f.*
    FROM final_rows f
    INNER JOIN unified_import_rows u
      ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
    WHERE f.reportDate=?
    ORDER BY f.shipmentCode
  `).all(batch.snapshotId, type, batch.reportDate).map(row => normalizeCcslFinalRow(row, type));
}

function loadScanRows(db, batch, type) {
  if (SHOPEE_TYPES.has(type)) {
    return db.prepare(`
      SELECT f.shipmentCode,f.isPod,f.orderStatus,f.needsTrackQuery,f.skipTrackReason,f.scanBucket,
             f.recipient_raw,f.recipient_normalized,f.recipient_group,f.recipient_group_reason,
             f.source_row_number,f.createdAt,f.updatedAt
      FROM business_scan_results f
      INNER JOIN unified_import_rows u
        ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
      WHERE f.businessType='SHOPEE' AND f.reportDate=?
      ORDER BY f.shipmentCode
    `).all(batch.snapshotId, type, batch.reportDate).map(row => ({
      ...row,
      businessType: type,
      运单号: row.shipmentCode,
      是否POD: Number(row.isPod || 0) === 1 || String(row.orderStatus || '') === '85' ? '是' : '否'
    }));
  }
  return db.prepare(`
    SELECT f.shipmentCode,f.sourceType,f.orderStatus,f.isPod,f.scanCategory,f.pickupShop,f.deliveryShop,
           f.productCode,f.customerName,f.needsTrackQuery,f.skipTrackReason,f.scanBucket,f.createdAt,f.updatedAt
    FROM scan_results f
    INNER JOIN unified_import_rows u
      ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
    WHERE f.reportDate=?
    ORDER BY f.shipmentCode
  `).all(batch.snapshotId, type, batch.reportDate).map(row => ({
    ...row,
    businessType: type,
    运单号: row.shipmentCode,
    是否POD: Number(row.isPod || 0) === 1 || String(row.orderStatus || '') === '85' ? '是' : '否'
  }));
}

function normalizeCcslFinalRow(row, type) {
  const raw = compactParsedFinalRow(row.rawJson);
  const category = row.primaryCategory || row.category || '';
  const pod = Number(row.isPod || 0) === 1;
  return {
    ...raw,
    shipmentCode: row.shipmentCode,
    运单号: row.shipmentCode,
    businessType: type,
    sourceType: row.sourceType || '',
    来源类型: row.sourceType || '',
    isPod: pod,
    是否POD: pod ? '是' : '否',
    category,
    primaryCategory: category,
    主分类: category,
    异常分类: pod ? 'POD闭环' : category,
    qcConclusion: row.qcConclusion || '',
    QC判断: row.qcConclusion || '',
    lastEvent: row.lastEvent || row.lastEventDesc || '',
    最后节点: row.lastEventDesc || row.lastEvent || '',
    lastEventTime: row.lastEventTime || '',
    最后节点时间: row.lastEventTime || '',
    lastEventCode: row.lastEventCode || '',
    lastEventDesc: row.lastEventDesc || '',
    lastEventTargetNode: row.lastEventTargetNode || '',
    lastEventActionType: row.lastEventActionType || '',
    matchedRule: row.matchedRule || '',
    matchedShopCode: row.matchedShopCode || '',
    matchedShopName: row.matchedShopName || '',
    specialState: ['SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION'].includes(category) ? category : '',
    Pending天数: Number(row.pendingDays || 0),
    Pending次数: Number(row.pendingDays || 0),
    pendingDays: Number(row.pendingDays || 0),
    OC天数: Number(row.ocDays || 0),
    ocDays: Number(row.ocDays || 0),
    盘点天数: Number(row.cycleCountDays || 0),
    cycleCountDays: Number(row.cycleCountDays || 0),
    派件分配天数: Number(row.assignDays || 0),
    assignDays: Number(row.assignDays || 0),
    派送中天数: Number(row.deliveringDays || 0),
    deliveringDays: Number(row.deliveringDays || 0),
    轨迹节点数: Number(row.trackNodeCount || 0),
    trackNodeCount: Number(row.trackNodeCount || 0),
    eventCourier: row.eventCourier || '',
    pickupShop: row.pickupShop || '',
    deliveryShop: row.deliveryShop || '',
    productCode: row.productCode || '',
    customerName: row.customerName || '',
    targetShopCode: row.targetShopCode || '',
    currentShopCode: row.currentShopCode || '',
    shopName: row.shopName || '',
    shopCycleId: row.shopCycleId || '',
    shopTransferStartedAt: row.shopTransferStartedAt || '',
    shopArrivedAt: row.shopArrivedAt || '',
    shopPendingAt: row.shopPendingAt || '',
    shopRetentionNaturalDays: Number(row.shopRetentionNaturalDays || 0),
    门店滞留天数: Number(row.shopRetentionNaturalDays || 0),
    shopState: row.shopState || '',
    shopStateReason: row.shopStateReason || '',
    门店编码: row.currentShopCode || row.targetShopCode || row.matchedShopCode || '',
    门店名称: row.shopName || row.matchedShopName || '',
    门店入库时间: row.shopArrivedAt || '',
    门店状态: shopStateLabel(row.shopState),
    whitelistVersion: row.whitelistVersion || '',
    rawSummary: row.rawSummary || ''
  };
}

function normalizeShopeeFinalRow(row, type) {
  const raw = compactParsedFinalRow(row.rawJson);
  const category = row.currentMainCategory || row.primaryCategory || '';
  const pod = Number(row.isPod || 0) === 1;
  const recipientGroup = type === 'SHOPEECN' ? 'CN' : 'VN';
  return {
    ...raw,
    shipmentCode: row.shipmentCode,
    运单号: row.shipmentCode,
    businessType: type,
    recipient_group: recipientGroup,
    recipientGroup,
    recipient_raw: row.recipient_raw || '',
    recipient_normalized: row.recipient_normalized || '',
    recipient_group_reason: row.recipient_group_reason || '',
    source_row_number: Number(row.source_row_number || 0),
    region_code: row.region_code || row.regionCode || '',
    regionCode: row.region_code || row.regionCode || '',
    是否POD: pod ? '是' : '否',
    isPod: pod,
    primaryCategory: category,
    currentMainCategory: category,
    主分类: category,
    异常分类: pod ? 'POD闭环' : category,
    API状态: row.apiStatus || '',
    apiStatus: row.apiStatus || '',
    carry状态: row.carryStatus || '',
    latestEventTime: row.latestEventTime || '',
    最后节点时间: row.latestEventTime || '',
    latestEventDesc: row.latestEventDesc || '',
    最后节点: row.latestEventDesc || row.latestNode || '',
    latestNode: row.latestNode || '',
    targetShopCode: row.targetShopCode || '',
    currentShopCode: row.currentShopCode || '',
    shopName: row.shopName || '',
    shopCycleId: row.shopCycleId || '',
    shopTransferStartedAt: row.shopTransferStartedAt || '',
    shopArrivedAt: row.shopArrivedAt || '',
    shopLastEventAt: row.shopLastEventAt || '',
    shopPendingAt: row.shopPendingAt || '',
    shopPendingReason: row.shopPendingReason || '',
    shopRetentionNaturalDays: Number(row.shopRetentionNaturalDays || 0),
    门店滞留天数: Number(row.shopRetentionNaturalDays || 0),
    shopState: row.shopState || '',
    shopStateReason: row.shopStateReason || '',
    门店编码: row.currentShopCode || row.targetShopCode || '',
    门店名称: row.shopName || '',
    门店入库时间: row.shopArrivedAt || '',
    门店状态: shopStateLabel(row.shopState),
    whitelistVersion: row.whitelistVersion || '',
    firstAttemptAt: row.firstAttemptAt || '',
    currentAttemptNo: Number(row.currentAttemptNo || 0),
    podAttemptNo: Number(row.podAttemptNo || 0),
    attemptStatus: row.attemptStatus || '',
    attemptConfidence: row.attemptConfidence || '',
    attemptUnknownReason: row.attemptUnknownReason || '',
    attemptCalculatedAt: row.attemptCalculatedAt || '',
    finalRowAvailable: true
  };
}

function mergeBusinessRows(dailyRows, currentRows, finalRows) {
  const map = new Map();
  for (const row of dailyRows || []) {
    const bill = billOf(row);
    if (bill) map.set(bill, { ...row, finalRowAvailable: false });
  }
  for (const row of currentRows || []) {
    const bill = billOf(row);
    if (bill) map.set(bill, { ...(map.get(bill) || {}), ...row });
  }
  for (const row of finalRows || []) {
    const bill = billOf(row);
    if (bill) map.set(bill, { ...(map.get(bill) || {}), ...row, finalRowAvailable: true });
  }
  return [...map.values()];
}

function loadRun(db, reportDate, type) {
  if (SHOPEE_TYPES.has(type)) {
    return db.prepare(`
      SELECT * FROM business_run_locks
      WHERE businessType='SHOPEE' AND reportDate=?
      ORDER BY updatedAt DESC LIMIT 1
    `).get(reportDate) || null;
  }
  return db.prepare('SELECT * FROM run_locks WHERE reportDate=? LIMIT 1').get(reportDate) || null;
}

function ccslHistoryCounts(db, snapshotId, reportDate, type) {
  return db.prepare(`
    SELECT
      SUM(CASE WHEN f.isPod=1 THEN 1 ELSE 0 END) AS pod,
      SUM(CASE WHEN COALESCE(f.ocDays,0)>0 THEN 1 ELSE 0 END) AS oc,
      SUM(CASE WHEN f.isPod=1 THEN 1 ELSE 0 END) AS firstPod
    FROM final_rows f
    INNER JOIN unified_import_rows u
      ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
    WHERE f.reportDate=?
  `).get(snapshotId, type, reportDate) || {};
}

function shopeeHistoryCounts(db, snapshotId, reportDate, type) {
  return db.prepare(`
    SELECT
      SUM(CASE WHEN f.isPod=1 THEN 1 ELSE 0 END) AS pod,
      SUM(CASE WHEN UPPER(COALESCE(f.currentMainCategory,f.primaryCategory,'')) LIKE '%OC%' THEN 1 ELSE 0 END) AS oc,
      SUM(CASE WHEN f.isPod=1 AND COALESCE(f.podAttemptNo,0)=1 THEN 1 ELSE 0 END) AS firstPod
    FROM business_final_rows f
    INNER JOIN unified_import_rows u
      ON u.shipmentCode=f.shipmentCode AND u.snapshotId=? AND u.businessType=?
    WHERE f.businessType='SHOPEE' AND f.reportDate=?
  `).get(snapshotId, type, reportDate) || {};
}

function aggregateHistory(states) {
  const byDate = new Map();
  for (const state of states || []) {
    for (const item of state.historySummary || []) {
      const summary = item.summary || item;
      const date = item.reportDate || summary.reportDate;
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { total: 0, pod: 0, firstPod: 0, oc: 0 });
      const target = byDate.get(date);
      const total = Number(summary.today ?? summary.pnh ?? summary.todayPnh ?? 0);
      target.total += total;
      target.pod += Number(summary.todayPod ?? summary.scanPod ?? 0);
      target.firstPod += total * Number(summary.firstPodRate || 0) / 100;
      target.oc += total * Number(summary.ocRate || 0) / 100;
    }
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([reportDate, value]) => ({
    reportDate,
    summary: {
      reportDate,
      today: value.total,
      pnh: value.total,
      todayPnh: value.total,
      todayPod: Math.round(value.pod),
      scanPod: Math.round(value.pod),
      podRate: rate(value.pod, value.total),
      firstPodRate: rate(value.firstPod, value.total),
      ocRate: rate(value.oc, value.total)
    }
  }));
}

function emptyState(type) {
  return {
    businessType: type,
    reportDate: '',
    sourceName: '',
    batchId: '',
    snapshotId: '',
    snapshotStatus: 'EMPTY',
    dailyReportReady: false,
    pnhBills: [],
    nonPnhBills: [],
    excludedBills: [],
    duplicateBills: [],
    dailyParseRows: [],
    dailyParseSummary: { totalRecognized: 0, pnh: 0, groupCounts: { CN: 0, VN: 0 } },
    finalRows: [],
    scanResults: [],
    scanPool: [],
    needTrackBills: [],
    trackResults: [],
    trackEvents: [],
    carryBills: [],
    nextCarryBills: [],
    podLocks: [],
    historySummary: [],
    processing: { running: false, paused: false, phase: '' },
    currentRun: null,
    lastRunSummary: null,
    logs: [],
    _normalizedSqliteRead: true,
    _rawEvidenceDeferred: true
  };
}

function emptyAggregate(scope) {
  return { ...emptyState(scope), businessType: scope };
}

function normalizeBusinessType(value) {
  const type = String(value || '').toUpperCase();
  if (!BUSINESS_TYPES.includes(type)) throw new Error('不支持的业务类型');
  return type;
}

function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || '').trim().toUpperCase();
}

function isPodRow(row = {}) {
  return row.是否POD === '是' || Number(row.isPod || 0) === 1 || String(row.orderStatus || '') === '85';
}

function rate(a, b) {
  const numerator = Number(a || 0);
  const denominator = Number(b || 0);
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function shopStateLabel(value) {
  switch (String(value || '')) {
    case 'SHOP_TRANSFER_IN_PROGRESS': return '门店途中';
    case 'SHOP_ARRIVED_CURRENT': return '门店入库';
    case 'SHOP_PENDING': return '门店Pending';
    default: return '';
  }
}


export function loadLightweightPeriodBusinessState(businessType, fromDate, toDate) {
  const type = normalizeBusinessType(businessType);
  const range = validateDateRange(fromDate, toDate, 180);
  const batches = listLatestValidRangeBatches(range.from, range.to, true);
  const states = batches.map(batch => loadLightweightUnifiedBusinessState(type, batch.snapshotId, { includeHistory: false }));
  const finalRows = states.flatMap(state => (state.finalRows || []).map(row => ({
    ...row,
    reportDate: row.reportDate || state.reportDate,
    businessType: type
  })));
  const dailyParseRows = states.flatMap(state => (state.dailyParseRows || []).map(row => ({
    ...row,
    reportDate: row.reportDate || state.reportDate,
    businessType: type
  })));
  const scanResults = states.flatMap(state => (state.scanResults || []).map(row => ({
    ...row,
    reportDate: row.reportDate || state.reportDate,
    businessType: type
  })));
  const pnhBills = states.flatMap(state => (state.pnhBills || []).map(code => `${state.reportDate}|${code}`));
  return {
    ...emptyState(type),
    businessType: type,
    reportDate: range.to,
    periodStart: range.from,
    periodEnd: range.to,
    periodDates: batches.map(item => item.reportDate),
    snapshotId: `PERIOD:${type}:${range.from}:${range.to}`,
    snapshotStatus: batches.length ? 'COMPLETED' : 'EMPTY',
    dailyReportReady: batches.length > 0,
    pnhBills,
    dailyParseRows,
    dailyParseSummary: { totalRecognized: pnhBills.length, pnh: pnhBills.length },
    finalRows,
    scanResults,
    scanPool: pnhBills,
    needTrackBills: [],
    trackResults: finalRows,
    trackEvents: [],
    carryBills: [],
    nextCarryBills: [],
    podLocks: [],
    historySummary: listLightweightBusinessHistory(type, range.to, 120),
    processing: { running: false, paused: false, phase: '范围汇总' },
    currentRun: null,
    lastRunSummary: null,
    logs: [],
    _normalizedSqliteRead: true,
    _rawEvidenceDeferred: true,
    _periodRead: true
  };
}

export function listLightweightCompletedUnifiedSnapshots(fromDate, toDate, businessTypes = EXPORT_BUSINESS_TYPES) {
  const range = validateDateRange(fromDate, toDate, 180);
  const types = [...new Set((businessTypes || EXPORT_BUSINESS_TYPES).map(value => {
    const type=String(value||'').trim().toUpperCase();
    if(!EXPORT_BUSINESS_TYPES.includes(type))throw new Error('不支持的报表业务类型');
    return type;
  }))];
  const unifiedRequested=types.some(type=>type!=='WHPP');
  const completedUnified=unifiedRequested
    ?listLatestValidRangeBatches(range.from,range.to,true,true):[];
  const byDate=new Map(completedUnified
    .map(batch=>[batch.reportDate,{...batch,unifiedCompleted:true}]));
  // WHPP is imported through business_daily_parse_rows, independently of
  // unified_import_batches. Its valid selected day must not disappear just
  // because the six other businesses had no unified batch that day.
  if(types.includes('WHPP')){
    const db=getDb();
    const hasSource=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_daily_parse_rows'").get());
    if(hasSource){
      const whppDates=db.prepare(`
        SELECT DISTINCT reportDate FROM business_daily_parse_rows
        WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ?
        ORDER BY reportDate
      `).all(range.from,range.to);
      for(const row of whppDates){
        const date=String(row.reportDate||'');
        if(!byDate.has(date))byDate.set(date,{
          snapshotId:'WHPP_INDEPENDENT_'+date,reportDate:date,
          createdAt:'',unifiedCompleted:false
        });
      }
    }
  }
  return [...byDate.values()].sort((a,b)=>a.reportDate.localeCompare(b.reportDate)).map(batch=>({
    snapshotId:batch.snapshotId,
    reportDate:batch.reportDate,
    createdAt:batch.createdAt,
    payload:{
      finalRows:types.flatMap(type=>
        type==='WHPP'||batch.unifiedCompleted
          ?loadLightweightExportRows(batch.snapshotId,batch.reportDate,type):[])
    }
  }));
}

function loadLightweightExportRows(snapshotId, reportDate, type) {
  const db = getDb();
  if(type==='WHPP'){
    const truth=loadWhppCanonicalTruth(reportDate,snapshotId,db);
    if(!truth?.total)return [];
    // Never export a falsely complete WHPP child based only on a 515-ticket
    // unified import snapshot. Every one of the 156 separate daily members
    // must have actually been scanned and finalized before reporting.
    const fullScanFinal=Number(truth.evidence?.scanRows||0)===truth.total
      &&Number(truth.evidence?.finalRows||0)===truth.total;
    // Alternate narrow acceptance: EVERY exact-day WHPP member has saved
    // current TMS shipmentStatus=60/81 consistent with its normalized state.
    // A historical OPEN ledger cannot override verified terminal evidence.
    // Mixed or missing evidence (including status 80) must fail closed.
    const fullStrictCurrentTerminals=truth.rows.length===truth.total
      &&truth.rows.every(row=>row.truthEvidence?.currentTerminalStrict===true);
    if(!fullScanFinal&&!fullStrictCurrentTerminals)
      throw new Error('WHPP '+reportDate+' 的 '+truth.total+' 票独立日报仍缺扫描或最终记录，且未全部取得TMS 60/81终态证据；请完成核验后再导出，不能生成漏票报表');
    const rows=truth.rows.map(row=>({
      ...row,shipmentCode:billOf(row),businessType:'WHPP',
      reportDate,regionCode:String(row.regionCode||'').toUpperCase(),
      isPod:row.truthEvidence?.pod===true?1:0,
      是否POD:row.truthEvidence?.pod===true?'是':'否',
      是否退回:row.truthEvidence?.returned===true?'是':'否',
      退回状态:row.truthEvidence?.returned===true?'已退回':row.退回状态||'',
      currentState:row.truthEvidence?.pod===true?'POD':
        row.truthEvidence?.returned===true?'RETURNED':String(row.currentState||''),
      finalRowAvailable:row.truthEvidence?.final===true
    }));
    return overlaySavedTerminalExportTruth(rows,db);
  }
  const sourceRows = db.prepare(`
    SELECT shipmentCode,rowJson,regionCode,recipientRaw,recipientNormalized
    FROM unified_import_rows
    WHERE snapshotId=? AND businessType=?
    ORDER BY shipmentCode
  `).all(snapshotId, type);
  const sourceByBill = new Map(sourceRows.map(row => {
    let parsed = {};
    try { parsed = JSON.parse(row.rowJson || '{}'); } catch {}
    return [String(row.shipmentCode || '').trim().toUpperCase(), {
      ...compactSourceRow(parsed),
      shipmentCode: row.shipmentCode,
      运单号: row.shipmentCode,
      regionCode: row.regionCode || parsed.regionCode || '',
      recipient_raw: row.recipientRaw || parsed.recipient_raw || parsed.recipientRaw || '',
      recipient_normalized: row.recipientNormalized || parsed.recipient_normalized || parsed.recipientNormalized || '',
      businessType: type,
      reportDate
    }];
  }));
  const state = loadLightweightUnifiedBusinessState(type, snapshotId, { includeHistory: false });
  // Validate before Map/Excel deduplication can conceal missing members. A
  // finalized six-business workbook must conserve the exact source set.
  const sourceBills=sourceRows.map(row=>String(row.shipmentCode||'').trim().toUpperCase());
  const finalRows=state.finalRows||[];
  const finalBills=finalRows.map(billOf);
  const sourceSet=new Set(sourceBills),finalSet=new Set(finalBills);
  const validBills=list=>list.every(Boolean)&&new Set(list).size===list.length;
  if(!validBills(sourceBills)||!validBills(finalBills)
      ||sourceSet.size!==finalSet.size
      ||[...sourceSet].some(bill=>!finalSet.has(bill))){
    throw new Error(type+' '+reportDate+
      ' 导出来源与最终明细运单不一致（来源'+sourceRows.length+
      '票，明细'+finalRows.length+'票），存在重复、缺失或多余成员；禁止生成漏票报表');
  }
  return overlaySavedTerminalExportTruth(finalRows.map(row => {
    const bill = billOf(row);
    return {
      ...(sourceByBill.get(bill) || {}),
      ...row,
      shipmentCode: bill,
      运单号: bill,
      businessType: type,
      reportDate: row.reportDate || reportDate
    };
  }),db);
}

// Reconcile stale persisted OPEN carry labels at *read time*. A late POD,
// completed return, or cancellation must disappear from unresolved dashboard
// counts and follow-up queues, without destructively rewriting historical
// carry evidence. The exact same terminal projection governs exports.
function filterActiveCarryMembers(bills=[],businessType='',reportDate='',db=getDb()){
  if(!bills.length)return [];
  const type=String(businessType||'').toUpperCase();
  return overlaySavedTerminalExportTruth(
    bills.map(shipmentCode=>({shipmentCode,businessType:type,reportDate})),db)
    .filter(row=>!['POD','RETURNED','ORDER_CANCELLED'].includes(
      String(row.currentState||'').toUpperCase()))
    .map(row=>String(row.shipmentCode||'').toUpperCase());
}

// Read-only export overlay. Current terminal evidence may arrive after the
// original report was processed. Preserve original date and business source
// membership, but never export an old "未POD" if a saved canonical terminal
// lock now proves POD or completed return. No remote calls or SQLite writes.
function overlaySavedTerminalExportTruth(rows=[],db=getDb()){
  const bills=[...new Set(rows.map(billOf).filter(Boolean))];
  if(!bills.length)return rows;
  const closed=new Map();
  for(let i=0;i<bills.length;i+=300){
    const chunk=bills.slice(i,i+300),marks=chunk.map(()=>'?').join(',');
    try{
      const ledger=db.prepare(`SELECT shipmentCode,businessType,trackingStatus,terminalReason,podDate,lastEventTime
        FROM qc_tracking_ledger WHERE shipmentCode IN (${marks})`).all(...chunk);
      for(const row of ledger){
        if(String(row.trackingStatus||'').toUpperCase()!=='TERMINAL')continue;
        const outcome=String(row.terminalReason||'').toUpperCase();
        if(!['POD','RETURNED','ORDER_CANCELLED'].includes(outcome))continue;
        closed.set(String(row.shipmentCode||'').toUpperCase(),{outcome,
          businessType:String(row.businessType||'').toUpperCase(),
          podTime:String(row.podDate||''),eventTime:String(row.lastEventTime||'')});
      }
    }catch{}
    try{
      const states=db.prepare(`SELECT shipmentCode,businessType,state,stateJson,lastEventTime
        FROM shipment_current_state WHERE shipmentCode IN (${marks})`).all(...chunk);
      for(const row of states){
        const bill=String(row.shipmentCode||'').toUpperCase();
        // Exact saved 60/80/81 statuses supersede stale ledger terminals.
        // Without a numeric TMS status, retain any verified ledger terminal.
        // 80 can never close POD or return, even if the old normalized label
        // or ledger still says RETURNED/POD.
        let raw={};try{raw=JSON.parse(String(row.stateJson||'{}'))||{}}catch{}
        const hasStrictStatus=['60','80','81'].includes(String(raw.shipmentStatus||raw?.shipmentTrack?.shipmentStatus||'').trim());
        if(closed.has(bill)&&!hasStrictStatus)continue;
        // ONLY shipmentStatus may use TMS numeric codes; eventCode must
        // never be confused with shipmentStatus 60/80/81.
        const status=String(raw.shipmentStatus||raw?.shipmentTrack?.shipmentStatus||'');
        const state=String(row.state||raw.currentState||'').toUpperCase();
        // shipmentStatus 80 is RETURNING and must not masquerade as a
        // completed return when older exported classifications say "退回".
        // Never use eventCode 80 as a shipment terminal fact.
        // A later exact 60/81 status may legitimately close a former
        // OPEN/PENDING/OC member. Conflict only with a contradictory
        // *explicit* terminal state, never with an unfinished state.
        const contradiction=(status==='80'&&['POD','RETURNED','RETURN_COMPLETED'].includes(state))
          ||(status==='60'&&['RETURNED','RETURN_COMPLETED','RETURN_IN_PROGRESS','RETURNING'].includes(state))
          ||(status==='81'&&['POD','RETURN_IN_PROGRESS','RETURNING'].includes(state));
        const outcome=contradiction?'CONFLICT':
          status==='80'?'RETURNING':
          status==='60'?'POD':
          status==='81'?'RETURNED':
          state==='POD'?'POD':
          ['RETURNED','RETURN_COMPLETED'].includes(state)?'RETURNED':
          state==='ORDER_CANCELLED'?'ORDER_CANCELLED':'';
        if(outcome)closed.set(bill,{outcome,businessType:String(row.businessType||'').toUpperCase(),
          podTime:String(raw.podTime||raw.POD时间||''),eventTime:String(row.lastEventTime||''),
          strictTms:!contradiction&&(status==='60'||status==='81'),contradiction});
      }
    }catch{}
  }
  return rows.map(row=>{
    const fact=closed.get(billOf(row));
    if(!fact||fact.businessType&&fact.businessType!==String(row.businessType||'').toUpperCase())return row;
    if(fact.outcome==='CONFLICT')return {...row,isPod:0,是否POD:'否',POD状态:'',是否退回:'否',
      currentState:'PENDING_VERIFICATION',primaryCategory:'终态矛盾待核验',
      退回状态:'待核验',podTime:'',podDate:'',POD时间:'',signingDays:null,签收天数:null,
      terminalEvidenceStatus:'CONFLICT',terminalEvidenceSource:'SAVED_TMS_STATUS_CONFLICT'};
    if(fact.outcome==='POD'){
      // A persisted WHPP POD lock backed by an accepted source is stronger
      // than a stale historical ledger date. Never calculate timing when a
      // verified timestamp is absent.
      const verifiedWhppTime=String(row.businessType||'').toUpperCase()==='WHPP'
        &&row.truthEvidence?.trustedSavedPodTime===true
        ?String(row.podTime||'').trim():'';
      const selectedTime=verifiedWhppTime||fact.podTime||row.podTime||row.podDate||'';
      let verifiedSigningDays=null;
      if(verifiedWhppTime){
        const first=Date.parse(String(row.reportDate||'').slice(0,10)+'T00:00:00Z');
        const signed=Date.parse(verifiedWhppTime.slice(0,10)+'T00:00:00Z');
        if(Number.isFinite(first)&&Number.isFinite(signed)&&signed>=first)
          verifiedSigningDays=Math.floor((signed-first)/86400000)+1;
      }
      return {...row,isPod:1,是否POD:'是',POD状态:'POD',currentState:'POD',
        primaryCategory:'POD闭环',退回状态:'',是否退回:'否',
        podTime:selectedTime,podDate:verifiedWhppTime?verifiedWhppTime.slice(0,10):String(selectedTime),
        ...(verifiedWhppTime?{
          POD时间:verifiedWhppTime,signingDays:verifiedSigningDays,签收天数:verifiedSigningDays,
          podTimeEvidenceSource:row.podTimeEvidenceSource
        }:{}),
        lastEventTime:fact.eventTime||row.lastEventTime||'',
        terminalEvidenceStatus:fact.strictTms?'STRICT_TMS':'NORMALIZED_LABEL_ONLY',
        terminalEvidenceSource:fact.strictTms?'SAVED_STRICT_POD':'SAVED_NORMALIZED_POD_LABEL'};
    }
    if(fact.outcome==='RETURNED')return {...row,isPod:0,是否POD:'否',POD状态:'',是否退回:'是',退回状态:'已退回',
      currentState:'RETURNED',primaryCategory:'已退回',podTime:'',podDate:'',POD时间:'',
      signingDays:null,签收天数:null,
      terminalEvidenceStatus:fact.strictTms?'STRICT_TMS':'NORMALIZED_LABEL_ONLY',
      terminalEvidenceSource:fact.strictTms?'SAVED_STRICT_RETURNED':'SAVED_NORMALIZED_RETURNED_LABEL'};
    if(fact.outcome==='RETURNING')return {...row,isPod:0,是否POD:'否',POD状态:'',是否退回:'否',
      退回状态:'退回中',订单取消:'否',currentState:'RETURNING',primaryCategory:'退回中',
      podTime:'',podDate:'',POD时间:'',signingDays:null,签收天数:null,
      terminalEvidenceStatus:'NONTERMINAL_80',terminalEvidenceSource:'SAVED_STATUS_80_NONTERMINAL'};
    return {...row,isPod:0,是否POD:'否',订单取消:'是',
      currentState:'ORDER_CANCELLED',primaryCategory:'订单取消',terminalEvidenceSource:'SAVED_STRICT_CANCELLED'};
  });
}

function listLatestValidRangeBatches(fromDate, toDate, completedOnly = false, strictLatest = false) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT b.snapshotId,b.batchId,b.reportDate,b.sourceName,b.createdAt,s.status AS snapshotStatus
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ORDER BY b.reportDate ASC,b.createdAt DESC,b.batchId DESC
  `).all(fromDate, toDate);
  // Select the NEWEST valid source for each date BEFORE checking completion.
  // Filtering completed snapshots first silently exported an older day after
  // a newer upload was still being processed.
  const byDate = new Map();
  for (const row of rows) if (!byDate.has(row.reportDate)) byDate.set(row.reportDate, row);
  const latest=[...byDate.values()];
  if(completedOnly){
    const incomplete=latest.filter(row=>String(row.snapshotStatus||'').toUpperCase()!=='COMPLETED');
    if(strictLatest&&incomplete.length){
      const dates=incomplete.map(row=>row.reportDate).slice(0,5).join('、');
      throw new Error('最新有效日报尚未处理完成（'+dates+
        '），不能使用旧完成快照代替当前上传数据导出；请完成处理后再导出');
    }
    // Historical range dashboards can still show other completed days while
    // a new day is processing. Do not fall back to that day's stale batch.
    return latest.filter(row=>String(row.snapshotStatus||'').toUpperCase()==='COMPLETED');
  }
  return latest;
}

function validateDateRange(fromDate, toDate, maxDays = 180) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  if (!valid(fromDate) || !valid(toDate)) throw new Error('请选择有效的开始日期和结束日期。');
  if (fromDate > toDate) throw new Error('开始日期不能晚于结束日期。');
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  const days = Math.floor((end - start) / 86400000) + 1;
  if (days > maxDays) throw new Error(`为保证系统流畅，单次日期范围最多${maxDays}天。`);
  return { from: fromDate, to: toDate, days };
}

function compactParsedFinalRow(text) {
  if (!text) return {};
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  const heavyKey = /(?:raw|json|payload|response|request|events?|picture|images?|photos?|attachments?|trace|history)/i;
  for (const [key, value] of Object.entries(parsed)) {
    if (heavyKey.test(key)) continue;
    if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = typeof value === 'string' && value.length > 32767 ? value.slice(0, 32767) : value;
      continue;
    }
    if (Array.isArray(value) && value.length <= 40 && value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item))) out[key] = value.slice();
  }
  return out;
}

function compactSourceRow(row = {}) {
  if (!row || typeof row !== 'object') return {};
  const out = {};
  const heavyKey = /(?:raw|json|payload|response|request|events?|picture|images?|photos?|attachments?|trace|history)/i;
  for (const [key, value] of Object.entries(row)) {
    if (heavyKey.test(key)) continue;
    if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
  }
  return out;
}
