import { getDb } from './db.js';

const BUSINESS_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);

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
  const carryBills = db.prepare(`
    SELECT shipmentCode FROM carryover_open_items
    WHERE businessType=? AND status='OPEN' AND lastReportDate<=?
    ORDER BY shipmentCode
  `).all(type, batch.reportDate).map(row => row.shipmentCode);
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

export function listLightweightCompletedUnifiedSnapshots(fromDate, toDate, businessTypes = BUSINESS_TYPES) {
  const range = validateDateRange(fromDate, toDate, 180);
  const types = [...new Set((businessTypes || BUSINESS_TYPES).map(normalizeBusinessType))];
  return listLatestValidRangeBatches(range.from, range.to, true).map(batch => ({
    snapshotId: batch.snapshotId,
    reportDate: batch.reportDate,
    createdAt: batch.createdAt,
    payload: {
      finalRows: types.flatMap(type => loadLightweightExportRows(batch.snapshotId, batch.reportDate, type))
    }
  }));
}

function loadLightweightExportRows(snapshotId, reportDate, type) {
  const db = getDb();
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
  return (state.finalRows || []).map(row => {
    const bill = billOf(row);
    return {
      ...(sourceByBill.get(bill) || {}),
      ...row,
      shipmentCode: bill,
      运单号: bill,
      businessType: type,
      reportDate: row.reportDate || reportDate
    };
  });
}

function listLatestValidRangeBatches(fromDate, toDate, completedOnly = false) {
  const db = getDb();
  const statusClause = completedOnly ? "AND s.status='COMPLETED'" : '';
  const rows = db.prepare(`
    SELECT b.snapshotId,b.batchId,b.reportDate,b.sourceName,b.createdAt,s.status AS snapshotStatus
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ? ${statusClause}
    ORDER BY b.reportDate ASC,b.createdAt DESC
  `).all(fromDate, toDate);
  const byDate = new Map();
  for (const row of rows) if (!byDate.has(row.reportDate)) byDate.set(row.reportDate, row);
  return [...byDate.values()];
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
