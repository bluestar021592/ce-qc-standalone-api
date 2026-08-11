import express from 'express';
import { getDb } from './db.js';
import { loadWhppState } from './whppStore.js';
import { buildWhppDashboard } from './whppReporting.js';

const PATCH_ID = '2026-08-11-v51-whpp-legacy-evidence-v1';

function safeJson(value, fallback = {}) {
  try {
    if (value && typeof value === 'object') return value;
    return JSON.parse(String(value || '')) || fallback;
  } catch {
    return fallback;
  }
}

function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}

function isoDate(value = '') {
  const text = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function mapRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const bill = billOf(row);
    if (bill) map.set(bill, row);
  }
  return map;
}

function inflate(table, reportDate, jsonColumn = 'rawJson', where = '', params = []) {
  const db = getDb();
  const sql = `SELECT * FROM ${table} WHERE reportDate=? ${where}`;
  try {
    return db.prepare(sql).all(reportDate, ...params).map(row => ({
      ...safeJson(row?.[jsonColumn], {}),
      ...row
    }));
  } catch {
    return [];
  }
}

function loadBaseState(reportDate) {
  const current = loadWhppState();
  if (!reportDate || reportDate === current.reportDate) return { ...current, reportDate: reportDate || current.reportDate || '' };
  const row = getDb().prepare("SELECT payloadJson FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? ORDER BY createdAt DESC LIMIT 1").get(reportDate);
  if (!row) return { businessType: 'WHPP', reportDate, pnhBills: [], dailyParseRows: [], scanResults: [], finalRows: [] };
  const payload = safeJson(row.payloadJson, {});
  return { ...(payload.state || {}), businessType: 'WHPP', reportDate };
}

function terminalFromCurrent(row = {}) {
  const state = String(row.persistedCurrentState || row.state || row.currentState || '').trim().toUpperCase();
  if (state === 'POD') return 'POD';
  if (['RETURNED', 'RETURN_COMPLETED'].includes(state)) return 'RETURNED';
  if (state === 'ORDER_CANCELLED') return 'ORDER_CANCELLED';
  return '';
}

function terminalFromScan(row = {}) {
  const status = String(row.orderStatus ?? row.scanOrderStatus ?? '').trim();
  if (status === '85' || Number(row.isPod || 0) === 1 || row.是否POD === '是' || row.POD状态 === 'POD') return 'POD';
  if (status === '100') return 'RETURNED';
  if (status === '10') return 'ORDER_CANCELLED';
  return '';
}

function terminalFromFinal(row = {}) {
  if (Number(row.isPod || 0) === 1 || row.是否POD === '是' || row.POD状态 === 'POD') return 'POD';
  const state = String(row.currentState || row.state || '').trim().toUpperCase();
  if (state === 'POD') return 'POD';
  if (['RETURNED', 'RETURN_COMPLETED'].includes(state)) return 'RETURNED';
  if (state === 'ORDER_CANCELLED') return 'ORDER_CANCELLED';
  const category = String(row.primaryCategory || row.category || row.主分类 || row.异常分类 || '').trim();
  if (category === '退回') return 'RETURNED';
  if (category === '订单取消') return 'ORDER_CANCELLED';
  return '';
}

function normalizeTerminal(row, terminal) {
  if (terminal === 'POD') {
    return {
      ...row,
      isPod: 1,
      是否POD: '是',
      POD状态: 'POD',
      currentState: 'POD',
      primaryCategory: 'POD',
      主分类: 'POD',
      异常分类: 'POD',
      退回状态: '未退回',
      订单取消: '否',
      carry状态: 'closed_pod',
      跨日状态: '已闭环',
      trackRequired: false,
      Pending次数: 0,
      Pending当前次数: 0,
      pendingDistinctDayCount: 0,
      Pending不连续: '否',
      OC天数: 0,
      盘点天数: 0,
      派送中停留天数: 0,
      入库无扫描节点: '否',
      shopState: '',
      shopRetentionNaturalDays: 0
    };
  }
  if (terminal === 'RETURNED') {
    return {
      ...row,
      isPod: 0,
      是否POD: '否',
      POD状态: '未POD',
      currentState: 'RETURN_COMPLETED',
      primaryCategory: '退回',
      主分类: '退回',
      异常分类: '退回',
      退回状态: '已退回',
      订单取消: '否',
      carry状态: 'closed_return',
      跨日状态: '已闭环',
      trackRequired: false,
      Pending次数: 0,
      Pending当前次数: 0,
      pendingDistinctDayCount: 0,
      Pending不连续: '否',
      OC天数: 0,
      盘点天数: 0,
      派送中停留天数: 0,
      入库无扫描节点: '否',
      shopState: '',
      shopRetentionNaturalDays: 0
    };
  }
  if (terminal === 'ORDER_CANCELLED') {
    return {
      ...row,
      isPod: 0,
      是否POD: '否',
      POD状态: '未POD',
      currentState: 'ORDER_CANCELLED',
      primaryCategory: '订单取消',
      主分类: '订单取消',
      异常分类: '订单取消',
      退回状态: '未退回',
      订单取消: '是',
      取消状态: '已取消',
      carry状态: 'closed_cancelled',
      跨日状态: '已闭环',
      trackRequired: false,
      Pending次数: 0,
      Pending当前次数: 0,
      pendingDistinctDayCount: 0,
      Pending不连续: '否',
      OC天数: 0,
      盘点天数: 0,
      派送中停留天数: 0,
      入库无扫描节点: '否',
      shopState: '',
      shopRetentionNaturalDays: 0
    };
  }
  return row;
}

function buildSourceTruth(reportDate = '') {
  const base = loadBaseState(reportDate);
  const date = base.reportDate || reportDate || '';
  if (!date) return { state: base, dashboard: buildWhppDashboard(base), diagnostics: { patchId: PATCH_ID } };

  const nativeDaily = inflate('business_daily_parse_rows', date, 'rowJson', "AND businessType='WHPP'");
  const nativeScan = inflate('business_scan_results', date, 'rawJson', "AND businessType='WHPP'");
  const nativeFinal = inflate('business_final_rows', date, 'rawJson', "AND businessType='WHPP'");

  // Before WHPP became its own board, CE-prefix bills were processed through the
  // legacy CCSL tables. Keep those exact waybill facts as read-only fallback so
  // an already-POD/returned/cancelled parcel is never reopened as PENDING_SCAN.
  const legacyScan = inflate('scan_results', date, 'rawJson');
  const legacyFinal = inflate('final_rows', date, 'rawJson');
  const currentRows = inflate('shipment_current_state', date, 'stateJson');

  const dailyBy = mapRows([...(base.dailyParseRows || []), ...nativeDaily]);
  const nativeScanBy = mapRows([...(base.scanResults || []), ...nativeScan]);
  const nativeFinalBy = mapRows([...(base.finalRows || []), ...nativeFinal]);
  const legacyScanBy = mapRows(legacyScan);
  const legacyFinalBy = mapRows(legacyFinal);
  const currentBy = mapRows(currentRows.map(row => ({ ...row, persistedCurrentState: row.state || '' })));

  const bills = [...new Set([
    ...(base.pnhBills || []).map(code => String(code || '').trim().toUpperCase()),
    ...dailyBy.keys()
  ])].filter(Boolean);

  const merged = bills.map(bill => {
    const daily = dailyBy.get(bill) || {};
    const ls = legacyScanBy.get(bill) || {};
    const lf = legacyFinalBy.get(bill) || {};
    const ns = nativeScanBy.get(bill) || {};
    const nf = nativeFinalBy.get(bill) || {};
    const current = currentBy.get(bill) || {};

    const row = {
      ...daily,
      ...ls,
      ...lf,
      ...ns,
      ...nf,
      ...current,
      shipmentCode: bill,
      运单号: bill,
      businessType: 'WHPP',
      reportDate: date,
      regionCode: daily.regionCode || nf.regionCode || lf.regionCode || ''
    };

    // Evidence priority: persisted terminal state -> native WHPP scan/final ->
    // exact legacy scan/final. A non-terminal PENDING_SCAN row never overrides
    // older terminal evidence for the same shipment/date.
    const terminal = terminalFromCurrent(current)
      || terminalFromScan(ns)
      || terminalFromFinal(nf)
      || terminalFromScan(ls)
      || terminalFromFinal(lf);

    return normalizeTerminal(row, terminal);
  });

  const state = {
    ...base,
    businessType: 'WHPP',
    reportDate: date,
    pnhBills: bills,
    dailyParseRows: bills.map(bill => dailyBy.get(bill) || { shipmentCode: bill, 运单号: bill, businessType: 'WHPP', reportDate: date }),
    scanResults: nativeScan.length ? nativeScan : legacyScan.filter(row => bills.includes(billOf(row))),
    finalRows: merged
  };
  const dashboard = buildWhppDashboard(state);

  const diagnostics = {
    patchId: PATCH_ID,
    reportDate: date,
    bills: bills.length,
    nativeScanRows: nativeScanBy.size,
    nativeFinalRows: nativeFinalBy.size,
    legacyScanRowsMatched: bills.filter(bill => legacyScanBy.has(bill)).length,
    legacyFinalRowsMatched: bills.filter(bill => legacyFinalBy.has(bill)).length,
    persistedRowsMatched: bills.filter(bill => currentBy.has(bill)).length,
    terminalPod: merged.filter(row => row.currentState === 'POD').length,
    terminalReturned: merged.filter(row => row.currentState === 'RETURN_COMPLETED').length,
    terminalCancelled: merged.filter(row => row.currentState === 'ORDER_CANCELLED').length,
    unresolved: dashboard.metrics?.unresolved || 0
  };

  return { state, dashboard, snapshotStatus: base.snapshotStatus || 'SOURCE_TRUTH', diagnostics };
}

function stateHandler(req, res) {
  try {
    const payload = buildSourceTruth(isoDate(req.query.reportDate));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, patchId: PATCH_ID, ...payload });
  } catch (error) {
    console.error('[V51][WHPP_STATE]', error);
    res.status(500).json({ ok: false, patchId: PATCH_ID, error: error.message || String(error) });
  }
}

function detailHandler(req, res) {
  try {
    const payload = buildSourceTruth(isoDate(req.query.reportDate));
    const key = String(req.query.tab || 'all');
    const detail = payload.dashboard?.detailTabs?.[key] || payload.dashboard?.detailTabs?.all || { label: key, rows: [], total: 0 };
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(300, Number(req.query.pageSize || 200)));
    const start = (page - 1) * pageSize;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      patchId: PATCH_ID,
      businessType: 'WHPP',
      reportDate: payload.state?.reportDate || '',
      tab: key,
      label: detail.label || key,
      total: Number(detail.total || detail.rows?.length || 0),
      page,
      pageSize,
      rows: (detail.rows || []).slice(start, start + pageSize),
      diagnostics: payload.diagnostics
    });
  } catch (error) {
    console.error('[V51][WHPP_DETAIL]', error);
    res.status(500).json({ ok: false, patchId: PATCH_ID, error: error.message || String(error) });
  }
}

let installed = false;
const previousListen = express.application.listen;
express.application.listen = function v51Listen(...args) {
  if (!installed) {
    installed = true;
    // Register these routes before V50/V42 install their compatibility routes.
    // Express resolves the first matching route, so V51 becomes the canonical
    // reader without deleting any older route or touching production data.
    this.get('/api/whpp/state', stateHandler);
    this.get('/api/whpp/metric-detail', detailHandler);
    this.get('/api/v51/whpp-state', stateHandler);
  }
  return previousListen.apply(this, args);
};

export const V51_WHPP_LEGACY_EVIDENCE_PATCH_ID = PATCH_ID;
