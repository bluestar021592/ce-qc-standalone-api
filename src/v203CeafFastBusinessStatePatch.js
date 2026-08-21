import express from 'express';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-21-v203-ceaf-fast-business-state-v1';
const BUSINESS_ROUTE = '/api/business-state/:businessType';
const CACHE_MS = Math.max(5_000, Number(process.env.V203_CEAF_CACHE_MS || 60_000));
const cache = new Map();

function text(value) { return String(value ?? '').trim(); }
function num(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function dateOnly(value) { const t = text(value).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : ''; }
function safeJson(value, fallback = {}) { try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); } catch { return fallback; } }
function rate(value, total) { return total ? Number((num(value) * 100 / num(total)).toFixed(2)) : 0; }

function batchForRequest(db, req) {
  const snapshotId = text(req.query?.snapshotId);
  if (snapshotId) {
    return db.prepare(`
      SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt,s.status AS snapshotStatus
      FROM unified_import_batches b
      LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.snapshotId=? AND b.status='VALID'
      ORDER BY b.createdAt DESC LIMIT 1
    `).get(snapshotId) || null;
  }
  const requestedDate = dateOnly(req.query?.reportDate || req.query?.date || '');
  if (requestedDate) {
    return db.prepare(`
      SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt,s.status AS snapshotStatus
      FROM unified_import_batches b
      LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.reportDate=? AND b.status='VALID'
      ORDER BY b.createdAt DESC LIMIT 1
    `).get(requestedDate) || null;
  }
  return db.prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt,s.status AS snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID'
    ORDER BY b.reportDate DESC,b.createdAt DESC LIMIT 1
  `).get() || null;
}

function mergedRow(record = {}) {
  const imported = safeJson(record.rowJson, {});
  const finalRaw = safeJson(record.finalRawJson, {});
  const bill = text(record.shipmentCode).toUpperCase();
  const isPod = num(record.isPod) === 1;
  const row = {
    ...imported,
    ...finalRaw,
    shipmentCode: bill,
    运单号: bill,
    businessType: 'CEAF',
    reportDate: record.reportDate || imported.reportDate || finalRaw.reportDate || '',
    regionCode: text(record.regionCode || finalRaw.regionCode || imported.regionCode),
    区域: text(record.regionCode || finalRaw.regionCode || imported.regionCode),
    primaryCategory: record.primaryCategory || finalRaw.primaryCategory || finalRaw.主分类 || imported.primaryCategory || imported.主分类 || '',
    主分类: record.primaryCategory || finalRaw.primaryCategory || finalRaw.主分类 || imported.primaryCategory || imported.主分类 || '',
    异常分类: record.primaryCategory || finalRaw.primaryCategory || finalRaw.异常分类 || imported.异常分类 || '',
    lastEventDesc: record.lastEventDesc || finalRaw.lastEventDesc || finalRaw.latestEventDesc || finalRaw.最后节点 || '',
    latestEventDesc: record.lastEventDesc || finalRaw.latestEventDesc || finalRaw.lastEventDesc || finalRaw.最后节点 || '',
    最后节点: record.lastEventDesc || finalRaw.最后节点 || finalRaw.latestEventDesc || finalRaw.lastEventDesc || '',
    lastEventTime: record.lastEventTime || finalRaw.lastEventTime || finalRaw.latestEventTime || finalRaw.最后节点时间 || '',
    latestEventTime: record.lastEventTime || finalRaw.latestEventTime || finalRaw.lastEventTime || finalRaw.最后节点时间 || '',
    最后节点时间: record.lastEventTime || finalRaw.最后节点时间 || finalRaw.latestEventTime || finalRaw.lastEventTime || '',
    pendingDistinctDayCount: Math.max(num(record.pendingDays), num(finalRaw.pendingDistinctDayCount), num(finalRaw.Pending当前次数), num(finalRaw.Pending次数)),
    Pending当前次数: Math.max(num(finalRaw.Pending当前次数), num(finalRaw.Pending次数), num(record.pendingDays)),
    Pending次数: Math.max(num(finalRaw.Pending当前次数), num(finalRaw.Pending次数), num(record.pendingDays)),
    OC天数: Math.max(num(finalRaw.OC天数), num(record.ocDays)),
    盘点天数: Math.max(num(finalRaw.盘点天数), num(record.cycleCountDays)),
    派送天数: Math.max(num(finalRaw.派送天数), num(record.deliveringDays)),
    isPod: isPod ? 1 : num(finalRaw.isPod),
    是否POD: isPod ? '是' : (finalRaw.是否POD || '否'),
    POD状态: isPod ? 'POD' : (finalRaw.POD状态 || '未POD')
  };
  if (isPod) {
    row.currentState = 'POD';
    row.scanNormalizedState = 'POD';
    if (!row.orderStatus) row.orderStatus = '85';
  }
  return row;
}

function isPod(row = {}) {
  return num(row.isPod) === 1 || row.是否POD === '是' || row.POD状态 === 'POD' || String(row.currentState || '').toUpperCase() === 'POD' || String(row.scanNormalizedState || '').toUpperCase() === 'POD' || String(row.orderStatus || '') === '85';
}
function isReturned(row = {}) {
  if (isPod(row)) return false;
  const state = String(row.currentState || row.scanNormalizedState || '').toUpperCase();
  return row.退回状态 === '已退回' || ['RETURNED','RETURN_COMPLETED'].includes(state) || /退回/.test(String(row.primaryCategory || row.主分类 || ''));
}
function categoryText(row = {}) { return [row.primaryCategory,row.主分类,row.异常分类,row.specialState,row.currentState].filter(Boolean).join(' '); }
function pendingCount(row = {}) { return Math.max(num(row.pendingDistinctDayCount), num(row.Pending当前次数), num(row.Pending次数)); }
function ocDays(row = {}) { return Math.max(num(row.OC天数), num(row.ocDays)); }
function cycleDays(row = {}) { return Math.max(num(row.盘点天数), num(row.cycleCountDays)); }
function inboundNoScan(row = {}) { return row.入库无扫描节点 === '是' || /入库无扫描/.test(categoryText(row)); }
function workOrder(row = {}) { return row.工单未处理 === '是' || /工单/.test(categoryText(row)); }

function dashboardRows(reportDate, summary) {
  const defs = [
    ['今日PNH', summary.total], ['今日POD', summary.pod], ['首投POD率', summary.podRate],
    ['Pending不连续', summary.pendingNonContinuous], ['Pending1+', summary.pending1], ['Pending2+', summary.pending2], ['Pending3+', summary.pending3],
    ['OC1+', summary.oc1], ['OC2+', summary.oc2], ['OC3+', summary.oc3], ['盘点2天+', summary.cycle2],
    ['入库无扫描节点', summary.inboundNoScan], ['工单未处理', summary.workOrder], ['外省未完结POD件', summary.provinceOpen]
  ];
  return defs.map(([name, value]) => ({ 日期: reportDate, 项目: name, metricKey: name, 数值: Number(value || 0), 数值原值: Number(value || 0), 迷你走势数据: [] }));
}

function buildState(req) {
  const db = getDb();
  const batch = batchForRequest(db, req);
  if (!batch) return null;
  const cacheKey = `${batch.snapshotId}|${batch.reportDate}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return { ...cached.state, cacheHit: true };

  const records = db.prepare(`
    SELECT u.shipmentCode,u.reportDate,u.regionCode,u.rowJson,
      f.isPod,f.primaryCategory,f.lastEventDesc,f.lastEventTime,f.rawJson AS finalRawJson,
      f.pendingDays,f.ocDays,f.cycleCountDays,f.deliveringDays
    FROM unified_import_rows u
    LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    WHERE u.snapshotId=? AND u.businessType='CEAF'
    ORDER BY u.shipmentCode
  `).all(batch.snapshotId);
  const rows = records.map(mergedRow);
  const total = rows.length;
  const podRows = rows.filter(isPod);
  const returnedRows = rows.filter(isReturned);
  const openRows = rows.filter(row => !isPod(row) && !isReturned(row));
  const actionable = openRows.filter(row => !/(?:CECN|CCSLCN|CEZT|CCSLZT|580|门店)/i.test(categoryText(row)));
  const pending1 = actionable.filter(row => pendingCount(row) >= 1).length;
  const pending2 = actionable.filter(row => pendingCount(row) >= 2).length;
  const pending3 = actionable.filter(row => pendingCount(row) >= 3).length;
  const oc1 = actionable.filter(row => ocDays(row) >= 1).length;
  const oc2 = actionable.filter(row => ocDays(row) >= 2).length;
  const oc3 = actionable.filter(row => ocDays(row) >= 3).length;
  const cycle2 = actionable.filter(row => cycleDays(row) >= 2).length;
  const summary = {
    total,
    pod: podRows.length,
    podRate: rate(podRows.length, total),
    returned: returnedRows.length,
    returnRate: rate(returnedRows.length, total),
    unresolved: openRows.length,
    open: openRows.length,
    pendingNonContinuous: actionable.filter(row => row.Pending不连续 === true || row.Pending连续性 === '不连续').length,
    pending1,pending2,pending3,pending3plus:pending3,
    oc1,oc2,oc3,oc3plus:oc3,
    cycle2,cycle2plus:cycle2,
    inboundNoScan: actionable.filter(inboundNoScan).length,
    workOrder: actionable.filter(workOrder).length,
    provinceOpen: openRows.filter(row => String(row.regionCode || '').toUpperCase() === 'PV').length
  };
  const metricsRows = dashboardRows(batch.reportDate, summary);
  const state = {
    businessType:'CEAF', viewBusinessType:'CEAF', reportDate:batch.reportDate,
    snapshotId:batch.snapshotId, snapshotStatus:String(batch.snapshotStatus || 'COMPLETED').toUpperCase(), dailyReportReady:total>0,
    sourceTotal:total, total,
    pnhBills:rows.map(row => row.shipmentCode),
    dailyParseRows:rows.map(row => ({ shipmentCode:row.shipmentCode, businessType:'CEAF', reportDate:batch.reportDate, regionCode:row.regionCode })),
    dailyParseSummary:{ totalRecognized:total, pnh:total, nonPnh:0, excluded:0, duplicate:0 },
    finalRows:rows,
    v55Summary:{ ...summary, __source:'V203_CEAF_DIRECT_INDEXED_FACTS' },
    dashboard:{
      pnh:total, totalMonitored:total, todayPod:summary.pod, podRate:summary.podRate, abnormalCount:actionable.length,
      categories:{ pendingTotal:pending1, ocTotal:oc1 },
      v55Summary:{ ...summary, __source:'V203_CEAF_DIRECT_INDEXED_FACTS' }
    },
    detailTabs:{
      dashboard:{ label:'CEAF总看板', rows:metricsRows, total:metricsRows.length },
      allData:{ label:'全部数据', rows, total },
      podClosed:{ label:'签收件数', rows:podRows, total:podRows.length },
      accountingReturned:{ label:'已退回件', rows:returnedRows, total:returnedRows.length },
      accountingOpen:{ label:'当前未闭环', rows:openRows, total:openRows.length },
      pendingAll:{ label:'Pending1+', rows:actionable.filter(row => pendingCount(row) >= 1), total:pending1 },
      pending2plus:{ label:'Pending2+', rows:actionable.filter(row => pendingCount(row) >= 2), total:pending2 },
      pending3:{ label:'Pending3+', rows:actionable.filter(row => pendingCount(row) >= 3), total:pending3 },
      ocAll:{ label:'OC1+', rows:actionable.filter(row => ocDays(row) >= 1), total:oc1 },
      oc2plus:{ label:'OC2+', rows:actionable.filter(row => ocDays(row) >= 2), total:oc2 },
      oc3:{ label:'OC3+', rows:actionable.filter(row => ocDays(row) >= 3), total:oc3 },
      cycle2:{ label:'盘点2天+', rows:actionable.filter(row => cycleDays(row) >= 2), total:cycle2 },
      inboundNoScan:{ label:'入库无扫描', rows:actionable.filter(inboundNoScan), total:summary.inboundNoScan },
      workOrderAbnormal:{ label:'工单未处理', rows:actionable.filter(workOrder), total:summary.workOrder },
      coreAbnormal:{ label:'遗留异常', rows:actionable, total:actionable.length },
      abnormal:{ label:'遗留异常', rows:actionable, total:actionable.length }
    },
    historySummary:[], processing:{running:false,paused:false,phase:''}, logs:[],
    patchId:PATCH_ID, sourceTruth:'DIRECT_INDEXED_CEAF_FACTS', cacheHit:false
  };
  cache.set(cacheKey, { at:Date.now(), state });
  return state;
}

function sendCeaf(req, res) {
  try {
    const state = buildState(req);
    if (!state) return res.status(404).json({ ok:false, error:'当前没有可用的CEAF日报快照', code:'CEAF_SNAPSHOT_NOT_FOUND' });
    res.setHeader('Cache-Control','private, max-age=10');
    res.setHeader('Server-Timing',`v203;desc=ceaf-fast-${state.cacheHit?'cache':'fresh'}`);
    return res.json({ ok:true, businessType:'CEAF', reportDate:state.reportDate, snapshotId:state.snapshotId, snapshotStatus:state.snapshotStatus, state });
  } catch (error) {
    return res.status(500).json({ ok:false, code:'CEAF_FAST_STATE_FAILED', error:error?.message || String(error), patchId:PATCH_ID });
  }
}

const previousGet = express.application.get;
express.application.get = function v203CeafFastBusinessStateGet(...args) {
  if (args.length < 2) return previousGet.apply(this, args);
  const route = args[0];
  if (route !== BUSINESS_ROUTE) return previousGet.apply(this, args);
  const handlers = args.slice(1);
  const original = handlers[0];
  const wrapped = function v203CeafFastBusinessStateHandler(req, res, next) {
    if (String(req.params?.businessType || '').toUpperCase() === 'CEAF' && String(req.query?.compact || '') === '1') return sendCeaf(req, res);
    return original(req, res, next);
  };
  return previousGet.call(this, route, wrapped, ...handlers.slice(1));
};

export function inspectV203CeafFastState(req = { query:{} }) { return buildState(req); }
export const V203_CEAF_FAST_BUSINESS_STATE_PATCH_ID = PATCH_ID;
