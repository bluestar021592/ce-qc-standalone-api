import express from 'express';
import { getDb } from './db.js';
import { loadRangeDashboard, getDashboardCacheStatus } from './rangeDashboardStore.js';
import { loadToken, summarizeToken } from './authStore.js';
import { publicUser } from './accessControl.js';

const PATCH_ID = '2026-08-08-v27-dashboard-interaction-performance-carry';
const BUSINESS_TYPES = ['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const CCSL_TYPES = new Set(['CE','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);

function isoDate(value='') {
  const text = String(value || '').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function dayShift(date, delta) {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0,10);
}

function safeJson(value, fallback={}) {
  try { return JSON.parse(String(value || '')) || fallback; }
  catch { return fallback; }
}

function latestBatch({ completedOnly=false }={}) {
  const db = getDb();
  const completedClause = completedOnly ? "AND COALESCE(s.status,'')='COMPLETED'" : '';
  return db.prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.sourceName,b.fileHash,b.status,b.summaryJson,b.warningsJson,b.createdAt,
           COALESCE(s.status,'') AS snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' ${completedClause}
    ORDER BY b.reportDate DESC,b.createdAt DESC
    LIMIT 1
  `).get() || null;
}

function unifiedImportView(batch) {
  if (!batch) return null;
  const counts = Object.fromEntries(BUSINESS_TYPES.map(type => [type,0]));
  for (const row of getDb().prepare(`SELECT businessType,COUNT(*) AS count FROM unified_import_rows WHERE snapshotId=? GROUP BY businessType`).all(batch.snapshotId)) {
    if (counts[row.businessType] !== undefined) counts[row.businessType] = Number(row.count || 0);
  }
  const summary = safeJson(batch.summaryJson, {});
  const warnings = safeJson(batch.warningsJson, []);
  return {
    batchId: batch.batchId,
    snapshotId: batch.snapshotId,
    reportDate: batch.reportDate,
    sourceName: batch.sourceName || '',
    fileHash: batch.fileHash || '',
    status: batch.status,
    snapshotStatus: batch.snapshotStatus || '',
    summary: { ...summary, validUniqueWaybills: Number(summary.validUniqueWaybills || Object.values(counts).reduce((a,b)=>a+b,0)) },
    warnings: Array.isArray(warnings) ? warnings : [],
    classificationCounts: counts,
    createdAt: batch.createdAt || ''
  };
}

function unifiedHistory(limit=120) {
  const max = Math.max(1, Math.min(180, Number(limit) || 120));
  return getDb().prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.sourceName,b.status,b.createdAt,COALESCE(s.status,'') AS snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID'
    ORDER BY b.reportDate DESC,b.createdAt DESC
    LIMIT ?
  `).all(max);
}

function latestAttemptHistory(fromDate, toDate) {
  const db = getDb();
  const rows = db.prepare(`
    WITH latest AS (
      SELECT b.reportDate,b.snapshotId
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1 FROM unified_import_batches newer
          INNER JOIN unified_snapshots ns ON ns.snapshotId=newer.snapshotId AND ns.status='COMPLETED'
          WHERE newer.status='VALID' AND newer.reportDate=b.reportDate AND newer.createdAt>b.createdAt
        )
    )
    SELECT u.reportDate,u.businessType,
           COUNT(*) AS total,
           SUM(CASE WHEN COALESCE(f.isPod,0)=1 AND COALESCE(f.podAttemptNo,CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0)=1 THEN 1 ELSE 0 END) AS attempt1,
           SUM(CASE WHEN COALESCE(f.isPod,0)=1 AND COALESCE(f.podAttemptNo,CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0)=2 THEN 1 ELSE 0 END) AS attempt2,
           SUM(CASE WHEN COALESCE(f.isPod,0)=1 AND COALESCE(f.podAttemptNo,CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0)>=3 THEN 1 ELSE 0 END) AS attempt3
    FROM latest l
    INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate AND u.businessType IN ('SHOPEECN','SHOPEEVN')
    LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    GROUP BY u.reportDate,u.businessType
    ORDER BY u.reportDate,u.businessType
  `).all(fromDate,toDate);
  const byDate = new Map();
  for (const row of rows) {
    const key = row.reportDate;
    if (!byDate.has(key)) byDate.set(key, { reportDate:key, metrics:{} });
    const group = row.businessType === 'SHOPEECN' ? 'CN' : 'VN';
    const total = Number(row.total || 0);
    const a1 = Number(row.attempt1 || 0), a2 = Number(row.attempt2 || 0), a3 = Number(row.attempt3 || 0);
    Object.assign(byDate.get(key).metrics, {
      [`${group}_1派件数`]:a1,[`${group}_2派件数`]:a2,[`${group}_3派件数`]:a3,
      [`${group}_1派成功率`]: total ? Number((a1*100/total).toFixed(2)) : 0,
      [`${group}_2派成功率`]: total ? Number((a2*100/total).toFixed(2)) : 0,
      [`${group}_3派成功率`]: total ? Number((a3*100/total).toFixed(2)) : 0,
      [`${group}_派次分母`]: total
    });
  }
  return [...byDate.values()].sort((a,b)=>a.reportDate.localeCompare(b.reportDate));
}

function decorateFastState(state, snapshotId, trendState, attemptHistory=[]) {
  const result = { ...(state || {}) };
  result.snapshotId = snapshotId || result.snapshotId || '';
  result.snapshotStatus = result.snapshotStatus || (snapshotId ? 'COMPLETED' : 'EMPTY');
  result.periodStart = '';
  result.periodEnd = '';
  result.periodMode = '';
  result._v27Fast = true;
  result._compact = true;
  result.historySummary = Array.isArray(trendState?.historySummary) ? trendState.historySummary.map(item => ({ ...item, summary:{ ...(item.summary || {}) } })) : [];
  if (/^SHOPEE/.test(String(result.businessType || result.viewBusinessType || '')) || result.businessType === 'SHOPEE') {
    const byDate = new Map(attemptHistory.map(item => [item.reportDate,item.metrics]));
    for (const item of result.historySummary) {
      item.summary ||= {};
      item.summary.metrics = { ...(item.summary.metrics || {}), ...(byDate.get(item.reportDate) || {}) };
    }
  }
  return result;
}

export async function v27BootstrapHandler(req,res) {
  const started = Date.now();
  try {
    const latest = latestBatch();
    const completed = latestBatch({ completedOnly:true });
    const viewBatch = completed || latest;
    const date = isoDate(viewBatch?.reportDate);
    let single = { states:{}, aggregates:{ CCSL:{}, SHOPEE:{} }, dates:[] };
    let trendRange = single;
    let attemptHistory = [];
    if (date && completed) {
      single = loadRangeDashboard(date,date);
      const trendFrom = dayShift(date,-6);
      trendRange = loadRangeDashboard(trendFrom,date);
      attemptHistory = latestAttemptHistory(trendFrom,date);
    }
    const businesses = {};
    for (const type of BUSINESS_TYPES) {
      businesses[type] = decorateFastState(single.states?.[type] || { businessType:type,viewBusinessType:type,reportDate:date }, completed?.snapshotId || '', trendRange.states?.[type], attemptHistory);
    }
    const ccsl = decorateFastState(single.aggregates?.CCSL || {businessType:'CCSL',reportDate:date}, completed?.snapshotId || '', trendRange.aggregates?.CCSL, attemptHistory);
    const shopee = decorateFastState(single.aggregates?.SHOPEE || {businessType:'SHOPEE',reportDate:date}, completed?.snapshotId || '', trendRange.aggregates?.SHOPEE, attemptHistory);
    const history = unifiedHistory(120);
    const generatedAt = new Date().toISOString();
    res.setHeader('Cache-Control','private, max-age=3, stale-while-revalidate=30');
    res.setHeader('Server-Timing',`v27-bootstrap;dur=${Date.now()-started}`);
    res.json({
      ok:true,
      patchId:PATCH_ID,
      state:ccsl,
      shopeeState:shopee,
      authStatus:summarizeToken(await loadToken()),
      session:{ ok:true,user:publicUser(req.user),unreadNotifications:0 },
      history:{ CCSL:[],SHOPEE:[],UNIFIED:history },
      unifiedImport:unifiedImportView(latest),
      businessStates:businesses,
      v27:{ generatedAt,bootstrapMs:Date.now()-started,dashboardCache:getDashboardCacheStatus(),attemptHistory }
    });
  } catch (error) {
    console.error('[V27][BOOTSTRAP]',error);
    res.status(500).json({ok:false,code:'V27_BOOTSTRAP_FAILED',error:error.message||String(error)});
  }
}

function normalizeBusinessScope(rawType) {
  const type = String(rawType || '').toUpperCase();
  if (BUSINESS_TYPES.includes(type)) return { type, shopee:SHOPEE_TYPES.has(type), exact:true };
  if (type === 'SHOPEE') return { type:'SHOPEE',shopee:true,exact:false };
  return { type:'CCSL',shopee:false,exact:false };
}

function latestCte() {
  return `WITH latest AS (
    SELECT b.reportDate,b.snapshotId
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
    WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
      AND NOT EXISTS (
        SELECT 1 FROM unified_import_batches newer
        INNER JOIN unified_snapshots ns ON ns.snapshotId=newer.snapshotId AND ns.status='COMPLETED'
        WHERE newer.status='VALID' AND newer.reportDate=b.reportDate AND newer.createdAt>b.createdAt
      )
  )`;
}

function ccslCondition(tab) {
  const map = {
    allData:'1=1',
    podClosed:'COALESCE(isPod,0)=1',
    accountingReturned:"COALESCE(isPod,0)=0 AND (returnState='已退回' OR UPPER(COALESCE(primaryCategory,'')) LIKE '%RETURN%' OR primaryCategory LIKE '%退回%')",
    accountingOpen:"COALESCE(isPod,0)=0 AND NOT (returnState='已退回' OR primaryCategory LIKE '%退回%')",
    pendingAll:'COALESCE(pendingDays,0)>=1', pending1:'COALESCE(pendingDays,0)>=1', pending2plus:'COALESCE(pendingDays,0)>=2', pending3:'COALESCE(pendingDays,0)>=3',
    ocAll:'COALESCE(ocDays,0)>=1', oc1:'COALESCE(ocDays,0)>=1', oc2plus:'COALESCE(ocDays,0)>=2', oc3:'COALESCE(ocDays,0)>=3',
    inboundNoScan:"primaryCategory LIKE '%入库无扫描%'", workOrderAbnormal:"primaryCategory LIKE '%工单%'", cycle2:'COALESCE(cycleCountDays,0)>=2',
    provinceOpen:"UPPER(COALESCE(regionCode,''))='PV' AND COALESCE(isPod,0)=0",
    severeAbnormal:"COALESCE(pendingDays,0)>=3 OR COALESCE(ocDays,0)>=3 OR primaryCategory LIKE '%严重%'",
    cecnRetention:"UPPER(COALESCE(primaryCategory,''))='CECN_RETENTION'", ceztRetention:"UPPER(COALESCE(primaryCategory,''))='CEZT_RETENTION'",
    ccsl580Retention:"UPPER(COALESCE(primaryCategory,''))='CCSL580_RETENTION'",
    shopTransit:"COALESCE(shopState,'')='SHOP_TRANSFER_IN_PROGRESS'", shopArrived:"COALESCE(shopState,'')='SHOP_ARRIVED_CURRENT'",
    shopStuck:"COALESCE(shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(shopRetentionNaturalDays,0)>=2"
  };
  return map[tab] || '1=1';
}

function shopeeCondition(tab, attempt=0) {
  const clean = String(tab || 'all').replace(/^(ALL|CN|VN|OTHER)_/,'');
  if (attempt === 1 || clean === 'firstAttempt') return 'COALESCE(isPod,0)=1 AND COALESCE(podAttemptNo,0)=1';
  if (attempt === 2 || clean === 'secondAttempt') return 'COALESCE(isPod,0)=1 AND COALESCE(podAttemptNo,0)=2';
  if (attempt === 3 || clean === 'thirdAttempt') return 'COALESCE(isPod,0)=1 AND COALESCE(podAttemptNo,0)>=3';
  const map = {
    all:'1=1', pod:'COALESCE(isPod,0)=1',
    returned:"returnState='已退回' OR primaryCategory LIKE '%退回%'",
    unresolved:"COALESCE(isPod,0)=0 AND NOT (returnState='已退回' OR primaryCategory LIKE '%退回%')",
    pending1:'COALESCE(pendingDays,0)>=1', pending2:'COALESCE(pendingDays,0)>=2', pending3:'COALESCE(pendingDays,0)>=3',
    pendingNonContinuous:"pendingContinuity='不连续'", oc1:'COALESCE(ocDays,0)>=1', oc2:'COALESCE(ocDays,0)>=2', oc3:'COALESCE(ocDays,0)>=3',
    cycle2:'COALESCE(cycleDays,0)>=2', inboundNoScan:"inboundNoScan='是' OR primaryCategory LIKE '%入库无扫描%'",
    returnRequired:"returnRequired='是' OR primaryCategory IN ('三次Pending后未退回','三次Pending后继续派送')",
    deliveryStay:"COALESCE(deliveryDays,0)>0 OR primaryCategory='派送中停留'",
    pvDelivery:"pvDisposition='PV_DELIVERY_IN_PROGRESS'", pvStoreRetention:"pvDisposition='PV_STORE_RETENTION'",
    pvStoreInboundNoScan:"pvDisposition='PV_STORE_INBOUND_NO_SCAN'", pvOtherUnresolved:"pvDisposition='PV_OTHER_UNRESOLVED'"
  };
  return map[clean] || '1=1';
}

function queryMetricRows({businessType,fromDate,toDate,tab,page=1,pageSize=200,region='',attempt=0}) {
  const scope = normalizeBusinessScope(businessType);
  const db = getDb();
  const offset = (page-1)*pageSize;
  const typeFilter = scope.exact ? 'u.businessType=?' : (scope.shopee ? "u.businessType IN ('SHOPEECN','SHOPEEVN')" : "u.businessType IN ('CE','TBKH','ALI1688')");
  const typeParams = scope.exact ? [scope.type] : [];
  const regionClause = ['PP','PV'].includes(region) ? 'AND UPPER(COALESCE(regionCode,\'\'))=?' : '';
  const regionParams = ['PP','PV'].includes(region) ? [region] : [];
  let sqlBase;
  let condition;
  if (!scope.shopee) {
    condition = ccslCondition(tab);
    sqlBase = `${latestCte()}, base AS (
      SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,
             f.isPod,f.primaryCategory,f.pendingDays,f.ocDays,f.cycleCountDays,f.deliveringDays,f.lastEventDesc,f.lastEventTime,
             f.customerName,f.pickupShop,f.deliveryShop,f.shopState,f.shopRetentionNaturalDays,f.rawJson,
             COALESCE(json_extract(f.rawJson,'$."退回状态"'),'') AS returnState
      FROM latest l
      INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      WHERE ${typeFilter}
    )`;
  } else {
    condition = shopeeCondition(tab,attempt);
    sqlBase = `${latestCte()}, base AS (
      SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,
             f.isPod,f.primaryCategory,f.latestEventDesc AS lastEventDesc,f.latestEventTime AS lastEventTime,
             f.recipient_raw,f.recipient_normalized,f.currentMainCategory,f.shopState,f.shopRetentionNaturalDays,f.podAttemptNo,f.currentAttemptNo,f.rawJson,
             COALESCE(json_extract(f.rawJson,'$."退回状态"'),'') AS returnState,
             COALESCE(CAST(json_extract(f.rawJson,'$."Pending次数"') AS INTEGER),CAST(json_extract(f.rawJson,'$."Pending当前次数"') AS INTEGER),0) AS pendingDays,
             COALESCE(json_extract(f.rawJson,'$."Pending连续性"'),'') AS pendingContinuity,
             COALESCE(CAST(json_extract(f.rawJson,'$."OC天数"') AS INTEGER),0) AS ocDays,
             COALESCE(CAST(json_extract(f.rawJson,'$."盘点天数"') AS INTEGER),0) AS cycleDays,
             COALESCE(CAST(json_extract(f.rawJson,'$."派送中停留天数"') AS INTEGER),0) AS deliveryDays,
             COALESCE(json_extract(f.rawJson,'$."入库无扫描节点"'),'') AS inboundNoScan,
             COALESCE(json_extract(f.rawJson,'$."退回待处理"'),'') AS returnRequired,
             COALESCE(json_extract(f.rawJson,'$.pvOpenDisposition'),'') AS pvDisposition
      FROM latest l
      INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      WHERE ${typeFilter}
    )`;
  }
  const params = [fromDate,toDate,...typeParams];
  const count = Number(db.prepare(`${sqlBase} SELECT COUNT(*) AS count FROM base WHERE (${condition}) ${regionClause}`).get(...params,...regionParams)?.count || 0);
  const rows = db.prepare(`${sqlBase} SELECT * FROM base WHERE (${condition}) ${regionClause} ORDER BY reportDate DESC,lastEventTime DESC,shipmentCode LIMIT ? OFFSET ?`).all(...params,...regionParams,pageSize,offset);
  return { count, rows: rows.map(row => decorateDetailRow(row,scope.type)) };
}

function decorateDetailRow(row,type) {
  const raw = safeJson(row.rawJson,{});
  const result = { ...raw, ...row, businessType:row.businessType || type, 运单号:row.shipmentCode, shipmentCode:row.shipmentCode, 区域:row.regionCode || raw.区域 || '', 最新节点:row.lastEventDesc || raw.最新节点 || raw.最后节点 || '', 最新时间:row.lastEventTime || raw.最新时间 || raw.最后节点时间 || '', 当前分类:row.primaryCategory || raw.当前分类 || raw.异常分类 || '', POD状态:Number(row.isPod||0)===1?'POD':'未POD' };
  delete result.rawJson;
  return result;
}

export function v27MetricDetailHandler(req,res) {
  try {
    const businessType = String(req.query.businessType || 'CCSL').toUpperCase();
    const toDate = isoDate(req.query.to || req.query.reportDate) || isoDate(latestBatch({completedOnly:true})?.reportDate);
    const fromDate = isoDate(req.query.from) || toDate;
    if (!fromDate || !toDate || fromDate>toDate) return res.status(400).json({ok:false,error:'日期范围无效'});
    const tab = String(req.query.tab || 'allData');
    const page = Math.max(1,Number(req.query.page||1));
    const pageSize = Math.max(1,Math.min(200,Number(req.query.pageSize||200)));
    const region = String(req.query.region||'').toUpperCase();
    const attempt = [1,2,3].includes(Number(req.query.attempt)) ? Number(req.query.attempt) : 0;
    const result = queryMetricRows({businessType,fromDate,toDate,tab,page,pageSize,region,attempt});
    res.setHeader('Cache-Control','private, max-age=15');
    res.json({ok:true,businessType,fromDate,toDate,tab,region,attempt,page,pageSize,total:result.count,rows:result.rows});
  } catch (error) {
    console.error('[V27][METRIC_DETAIL]',error);
    res.status(500).json({ok:false,error:error.message||String(error)});
  }
}

function carryMonitorRows(status='OPEN',limit=500) {
  const db = getDb();
  const max = Math.max(1,Math.min(1000,Number(limit)||500));
  const where = status === 'ALL' ? '' : 'WHERE UPPER(COALESCE(o.status,\'\'))=?';
  const params = status === 'ALL' ? [] : [status];
  const rows = db.prepare(`
    SELECT o.shipmentCode,o.businessType,o.sourceReportDate,o.lastReportDate,o.status,o.apiStatus,o.closeReason,o.stateJson AS carryStateJson,o.createdAt,o.updatedAt,
           c.state AS currentState,c.apiStatus AS currentApiStatus,c.lastEventTime AS currentLastEventTime,c.stateJson AS currentStateJson,c.updatedAt AS currentUpdatedAt
    FROM carryover_open_items o
    LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode
    ${where}
    ORDER BY COALESCE(c.updatedAt,o.updatedAt) DESC,o.sourceReportDate
    LIMIT ?
  `).all(...params,max);
  const now = Date.now();
  return rows.map(row => {
    const before = safeJson(row.carryStateJson,{}), current = safeJson(row.currentStateJson,{});
    const previousTime = String(before.lastEventTime || before.最新时间 || before.最后节点时间 || '');
    const latestTime = String(row.currentLastEventTime || current.lastEventTime || current.最新时间 || current.最后节点时间 || previousTime || '');
    const latestNode = current.latestEventDesc || current.lastEventDesc || current.最新节点 || current.最后节点 || before.latestEventDesc || before.lastEventDesc || before.最新节点 || before.最后节点 || '';
    const changed = Boolean(latestTime && (!previousTime || latestTime>previousTime));
    const sourceMs = Date.parse(`${row.sourceReportDate}T00:00:00+07:00`);
    const daysOpen = Number.isFinite(sourceMs) ? Math.max(0,Math.floor((now-sourceMs)/86400000)) : 0;
    return {
      shipmentCode:row.shipmentCode,businessType:row.businessType,sourceReportDate:row.sourceReportDate,lastReportDate:row.lastReportDate,
      status:row.status,currentState:row.currentState||before.currentState||'',apiStatus:row.currentApiStatus||row.apiStatus||'',
      latestNode,latestEventTime:latestTime,previousEventTime:previousTime,hasNewNode:changed,daysOpen,
      category:current.primaryCategory||current.当前分类||before.primaryCategory||before.当前分类||'',
      pendingDays:Number(current.pendingDistinctDayCount||current.Pending次数||before.pendingDistinctDayCount||before.Pending次数||0),
      ocDays:Number(current.OC天数||before.OC天数||0),closeReason:row.closeReason||'',updatedAt:row.currentUpdatedAt||row.updatedAt||''
    };
  });
}

export function v27CarryMonitorHandler(req,res) {
  try {
    const status = ['OPEN','CLOSED','ALL'].includes(String(req.query.status||'OPEN').toUpperCase()) ? String(req.query.status||'OPEN').toUpperCase() : 'OPEN';
    const rows = carryMonitorRows(status,req.query.limit);
    const summary = { total:rows.length,newNode:rows.filter(r=>r.hasNewNode).length,stale3:rows.filter(r=>r.daysOpen>=3&&!r.hasNewNode).length,closed:rows.filter(r=>String(r.status).toUpperCase()==='CLOSED').length };
    res.setHeader('Cache-Control','private, max-age=20');
    res.json({ok:true,status,summary,rows,generatedAt:new Date().toISOString()});
  } catch (error) {
    console.error('[V27][CARRY_MONITOR]',error);
    res.status(500).json({ok:false,error:error.message||String(error)});
  }
}

let installed = false;
const originalGet = express.application.get;
express.application.get = function v27Get(path,...handlers) {
  if (path === '/api/bootstrap' && handlers.length) return originalGet.call(this,path,v27BootstrapHandler);
  return originalGet.call(this,path,...handlers);
};

const originalListen = express.application.listen;
express.application.listen = function v27Listen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v27/metric-detail',v27MetricDetailHandler);
    this.get('/api/v27/carry-monitor',v27CarryMonitorHandler);
  }
  return originalListen.apply(this,args);
};

export const V27_PATCH_ID = PATCH_ID;
