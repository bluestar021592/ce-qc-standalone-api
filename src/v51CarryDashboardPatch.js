import express from 'express';
import { getDb } from './db.js';
import { classifyFinalRoutingDestination, ROUTING_DESTINATIONS } from './routingDestinationV48.js';

const PATCH_ID = '2026-08-11-v51-carry-dashboard-v1';
const BUSINESS_TYPES = ['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
const ROUTING_NORMAL = new Set([
  ROUTING_DESTINATIONS.CCSLCN,
  ROUTING_DESTINATIONS.CCSLZT,
  ROUTING_DESTINATIONS.CCSL580
]);
const LEGACY_NORMAL = new Set([
  'SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION',
  'CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION',
  '仓库自提','自提','580滞留包裹','CECN滞留包裹','CEZT滞留包裹','正常分流节点'
]);

function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function n(value) { const parsed = Number(value || 0); return Number.isFinite(parsed) ? parsed : 0; }
function upper(value) { return String(value || '').trim().toUpperCase(); }
function dateOnly(value = '') {
  const m = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
function naturalDays(value = '') {
  const d = dateOnly(value); if (!d) return 0;
  const now = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Phnom_Penh', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  return Math.max(0, Math.floor((Date.parse(`${now}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000));
}
function stateName(state = {}, persisted = '') {
  return upper(persisted || state.persistedCurrentState || state.currentState || state.state || state.scanNormalizedState);
}
function categoryOf(state = {}) {
  return String(state.primaryCategory || state.主分类 || state.当前分类 || state.异常分类 || '').trim();
}
function isPod(state = {}, persisted = '') {
  const name = stateName(state, persisted);
  return state.是否POD === '是' || state.POD状态 === 'POD' || n(state.isPod) === 1 || name === 'POD' || String(state.orderStatus ?? state.scanOrderStatus ?? '') === '85' || ['POD','POD闭环'].includes(categoryOf(state));
}
function isReturned(state = {}, persisted = '') {
  const name = stateName(state, persisted);
  return state.退回状态 === '已退回' || ['RETURNED','RETURN_COMPLETED'].includes(name) || String(state.orderStatus ?? state.scanOrderStatus ?? '') === '100' || categoryOf(state) === '退回';
}
function isCancelled(state = {}, persisted = '') {
  const name = stateName(state, persisted);
  return state.订单取消 === '是' || state.取消状态 === '已取消' || name === 'ORDER_CANCELLED' || String(state.orderStatus ?? state.scanOrderStatus ?? '') === '10' || categoryOf(state) === '订单取消';
}
function isReturnInProgress(state = {}, persisted = '') {
  const name = stateName(state, persisted);
  const category = categoryOf(state);
  return name === 'RETURN_IN_PROGRESS' || state.退回状态 === '退回处理中' || category === '退回处理中';
}
function finalDestination(state = {}) {
  try { return classifyFinalRoutingDestination(state).destination; }
  catch { return ROUTING_DESTINATIONS.NONE; }
}
function isNormalOperationalDestination(state = {}, persisted = '') {
  if (isPod(state, persisted) || isReturned(state, persisted) || isCancelled(state, persisted)) return true;
  const destination = finalDestination(state);
  if (ROUTING_NORMAL.has(destination)) return true;
  const category = categoryOf(state);
  const special = upper(state.specialState || category);
  if (LEGACY_NORMAL.has(special) || LEGACY_NORMAL.has(category)) return true;
  if (state.matchedRule === 'NORMAL_FINAL_HUB') return true;
  if (['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(String(state.shopState || ''))) return true;
  return false;
}
function abnormalReason(state = {}, latestEventTime = '', persisted = '') {
  // POD / returned / cancelled / self pickup / CCSLCN / CCSLZT / CCSL580 /
  // Phnom Penh shop are operational outcomes, never inherited anomalies.
  if (isNormalOperationalDestination(state, persisted)) return '';
  if (isReturnInProgress(state, persisted)) return '';

  const apiText = `${state.API状态 || ''} ${state.查询状态 || ''} ${state.apiStatus || ''}`;
  if (/失败|retry|pending_retry/i.test(apiText)) return '';

  const category = categoryOf(state);
  const name = stateName(state, persisted);
  const region = upper(state.regionCode || state.区域);
  const shopState = String(state.shopState || '');
  const stale = naturalDays(latestEventTime || state.latestEventTime || state.最后节点时间 || state.lastEventTime);

  // Provincial-shop operational flow is tracked by dedicated shop KPIs, not carry anomaly.
  if (region === 'PV' && shopState) return '';
  if (['SHOP_PENDING','SHOP_OC'].includes(name) || ['门店Pending','门店OC'].includes(category)) return '';

  const pending = n(state.Pending当前次数 ?? state.Pending次数 ?? state.pendingDistinctDayCount);
  const continuity = String(state.Pending连续性 || state.pendingContinuity || state.Pending事实连续性 || '');
  const nonContinuous = state.Pending不连续 === '是' || continuity.includes('不连续');
  const oc = n(state.OC天数 ?? state.ocDays);
  const cycle = n(state.盘点天数 ?? state.cycleCountDays);
  const delivery = n(state.派送中停留天数 ?? state.派送中天数 ?? state.deliveryDays);
  const returnRequired = state.退回待处理 === '是' || state.returnRequired === true || /三次Pending后/.test(category);

  if (returnRequired) return '三次Pending后未正常闭环';
  if (pending >= 2 && nonContinuous) return 'Pending不连续';
  if (pending >= 3) return 'Pending3天+';
  if (oc >= 2) return 'OC2天+';
  if (cycle >= 2) return '盘点2天+';
  if (state.入库无扫描节点 === '是' || /入库无扫描/.test(category)) return '入库无扫描';
  if (/工单/.test(category)) return '工单未处理';
  if (delivery >= 2 && stale >= 1) return '派送停留2天+';
  if (/无轨迹/.test(category)) return '无轨迹';
  if (stale >= 3) return '3天+无新节点';
  return '';
}

function loadRows(status = 'OPEN', businessType = 'ALL') {
  const db = getDb();
  const clauses = [];
  const params = [];
  if (status !== 'ALL') { clauses.push("UPPER(COALESCE(o.status,''))=?"); params.push(status); }
  if (businessType !== 'ALL') { clauses.push("UPPER(COALESCE(o.businessType,''))=?"); params.push(businessType); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const source = db.prepare(`SELECT
      o.shipmentCode,UPPER(COALESCE(o.businessType,'')) AS businessType,o.sourceReportDate,o.lastReportDate,
      o.status,o.apiStatus,o.closeReason,o.stateJson AS oldJson,o.updatedAt,
      c.state AS persistedState,c.apiStatus AS currentApiStatus,c.lastEventTime AS currentLastEventTime,
      c.stateJson AS currentJson,c.updatedAt AS currentUpdatedAt
    FROM carryover_open_items o
    LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode
    ${where}
    ORDER BY COALESCE(c.updatedAt,o.updatedAt) DESC,o.sourceReportDate,o.shipmentCode`).all(...params);

  const rows = [];
  for (const row of source) {
    const oldState = safeJson(row.oldJson, {});
    const state = { ...oldState, ...safeJson(row.currentJson, {}) };
    const latestEventTime = String(row.currentLastEventTime || state.latestEventTime || state.lastEventTime || state.最后节点时间 || '');
    const reason = abnormalReason(state, latestEventTime, row.persistedState);
    // "遗留异常动态" is an anomaly-only workspace. Normal final destinations are
    // excluded even from the ALL tab; they remain visible in dedicated business KPIs.
    if (!reason) continue;
    const previousEventTime = String(oldState.latestEventTime || oldState.lastEventTime || oldState.最后节点时间 || '');
    const latestNode = String(state.latestEventDesc || state.lastEventDesc || state.最新节点 || state.最后节点 || '');
    rows.push({
      shipmentCode: row.shipmentCode,
      businessType: row.businessType,
      sourceReportDate: row.sourceReportDate,
      lastReportDate: row.lastReportDate,
      status: row.status,
      currentState: categoryOf(state) || stateName(state, row.persistedState) || reason,
      currentStateCode: stateName(state, row.persistedState),
      category: categoryOf(state) || reason,
      monitorReason: reason,
      abnormalReason: reason,
      apiStatus: row.currentApiStatus || row.apiStatus || '',
      latestNode,
      latestEventTime,
      previousEventTime,
      hasNewNode: Boolean(latestEventTime && latestEventTime !== previousEventTime),
      daysOpen: naturalDays(row.sourceReportDate || latestEventTime),
      pendingDays: n(state.Pending当前次数 ?? state.Pending次数 ?? state.pendingDistinctDayCount),
      ocDays: n(state.OC天数 ?? state.ocDays),
      closeReason: row.closeReason || '',
      updatedAt: row.currentUpdatedAt || row.updatedAt || ''
    });
  }
  return rows;
}

function handler(req, res) {
  try {
    const requestedStatus = upper(req.query.status || 'OPEN');
    const status = ['OPEN','CLOSED','ALL'].includes(requestedStatus) ? requestedStatus : 'OPEN';
    const requestedBusiness = upper(req.query.businessType || 'ALL');
    const businessType = BUSINESS_TYPES.includes(requestedBusiness) ? requestedBusiness : 'ALL';
    const allFiltered = loadRows(status, 'ALL');
    const scoped = businessType === 'ALL' ? allFiltered : allFiltered.filter(row => row.businessType === businessType);
    const limit = Math.max(1, Math.min(500, n(req.query.limit || req.query.pageSize) || 50));
    const counts = Object.fromEntries(BUSINESS_TYPES.map(type => [type, allFiltered.filter(row => row.businessType === type).length]));
    const summary = {
      total: scoped.length,
      newNode: scoped.filter(row => row.hasNewNode).length,
      stale3: scoped.filter(row => row.daysOpen >= 3 && !row.hasNewNode).length,
      closed: scoped.filter(row => upper(row.status) === 'CLOSED').length
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok:true, patchId:PATCH_ID, semantics:'ANOMALY_ONLY_EXCLUDES_NORMAL_DESTINATIONS',
      status,businessType,businessSummary:{ ALL:allFiltered.length, ...counts },summary,
      rows:scoped.slice(0,limit),pageSize:limit,generatedAt:new Date().toISOString()
    });
  } catch (error) {
    console.error('[V51][CARRY_MONITOR]', error);
    res.status(500).json({ ok:false, patchId:PATCH_ID, error:error.message || String(error) });
  }
}

let installed = false;
const previousListen = express.application.listen;
express.application.listen = function v51CarryDashboardListen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v51/carry-monitor', handler);
    this.get('/api/v51/status', (req,res) => res.json({ ok:true, patchId:PATCH_ID, businessTypes:BUSINESS_TYPES }));
  }
  return previousListen.apply(this, args);
};

export const V51_CARRY_DASHBOARD_PATCH_ID = PATCH_ID;
