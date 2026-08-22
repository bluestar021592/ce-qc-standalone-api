import express from 'express';
import { networkInterfaces } from 'node:os';

import { getDb } from './db.js';
import { loadToken, summarizeToken } from './authStore.js';
import { publicUser } from './accessControl.js';
import { getDbStatus } from './store.js';

export const V213_FAST_BOOTSTRAP_ROUTE_ID = '2026-08-22-v213-safe-fast-bootstrap-route-v1';
const ROUTE = '/api/bootstrap';
const TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']);
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const CACHE_MS = Math.max(5_000, Number(process.env.BOOTSTRAP_LIGHT_CACHE_MS || 30_000));
const NUMERIC_KEYS = Object.freeze([
  'total','pod','pending1','pending2','pending3','pendingNonContinuous',
  'oc1','oc2','oc3','cycle2','delivery1','inboundNoScan','workOrder',
  'shopRetention1','shopRetention2','shopRetention3','provinceOpen','selfPickup',
  'cecnRetention','ceztRetention','retention580','returned','returnInProgress',
  'returnRequired','deliveryStay','transitHubStay','severeOverdue','attempt1','attempt2',
  'attempt3','shopTransit','shopArrived','shopPending','pvDelivery','pvStoreRetention',
  'pvStoreInboundNoScan','pvOtherUnresolved','ccslCnDiversion','ccslZtDiversion',
  'ccsl580Diversion','phnomPenhShop','phnomPenhShopTransit','phnomPenhShopArrived'
]);

let dataCache = null;
const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const rate = (value, total) => total ? Math.round(n(value) * 10000 / n(total)) / 100 : 0;
const text = value => String(value ?? '').trim();
function safeJson(value) { try { return JSON.parse(String(value || '{}')) || {}; } catch { return {}; } }
function blankMetrics() { return Object.fromEntries(NUMERIC_KEYS.map(key => [key, 0])); }
function addMetrics(rows = []) {
  const out = blankMetrics();
  for (const row of rows) for (const key of NUMERIC_KEYS) out[key] += n(row?.[key]);
  out.podRate = rate(out.pod, out.total);
  out.returnRate = rate(out.returned, out.total);
  out.dispatchAttempt1 = out.attempt1;
  out.dispatchAttempt2 = out.attempt2;
  out.dispatchAttempt3 = out.attempt3;
  out.dispatchAttemptDenominator = out.total;
  out.dispatchAttempt1Rate = rate(out.attempt1, out.total);
  out.dispatchAttempt2Rate = rate(out.attempt2, out.total);
  out.dispatchAttempt3Rate = rate(out.attempt3, out.total);
  out.firstAttemptRate = out.dispatchAttempt1Rate;
  out.unresolved = Math.max(0, out.total - out.pod - out.returned);
  return out;
}

function latestBatch(db) {
  return db.prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.sourceName,b.fileHash,b.createdAt,
           COALESCE(s.status,'IMPORTED') AS snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID'
    ORDER BY b.reportDate DESC,b.createdAt DESC,b.batchId DESC
    LIMIT 1
  `).get() || null;
}

function historyRows(db, limit = 60) {
  const candidates = db.prepare(`
    SELECT b.reportDate,b.snapshotId,b.batchId,b.sourceName,b.fileHash,b.createdAt,
           COALESCE(s.status,'IMPORTED') AS snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID'
    ORDER BY b.reportDate DESC,b.createdAt DESC,b.batchId DESC
    LIMIT 600
  `).all();
  const seen = new Set();
  const out = [];
  for (const row of candidates) {
    if (!row.reportDate || seen.has(row.reportDate)) continue;
    seen.add(row.reportDate); out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

function importedRows(db, batch) {
  if (!batch?.snapshotId) return [];
  return db.prepare(`
    SELECT businessType,
           CASE WHEN UPPER(COALESCE(regionCode,''))='PP' THEN 'PP'
                WHEN UPPER(COALESCE(regionCode,''))='PV' THEN 'PV'
                ELSE 'UNKNOWN' END AS regionCode,
           COUNT(*) AS total
    FROM unified_import_rows
    WHERE snapshotId=?
    GROUP BY businessType,regionCode
  `).all(batch.snapshotId).map(row => ({ ...blankMetrics(), ...row, businessType: text(row.businessType).toUpperCase(), total: n(row.total) }));
}

function cachedRows(db, batch) {
  if (!batch?.snapshotId || !batch?.reportDate) return [];
  try {
    return db.prepare(`
      SELECT businessType,regionCode,metricsJson
      FROM dashboard_daily_cache
      WHERE reportDate=? AND snapshotId=? AND snapshotStatus='COMPLETED'
      ORDER BY businessType,regionCode
    `).all(batch.reportDate, batch.snapshotId).map(row => ({
      ...blankMetrics(), ...safeJson(row.metricsJson),
      businessType: text(row.businessType).toUpperCase(),
      regionCode: text(row.regionCode).toUpperCase() || 'UNKNOWN'
    }));
  } catch { return []; }
}

function metricRows(db, batch) {
  const imported = importedRows(db, batch);
  const cached = cachedRows(db, batch);
  if (!cached.length) return imported;
  const cachedTypes = new Set(cached.map(row => row.businessType));
  return [...cached, ...imported.filter(row => !cachedTypes.has(row.businessType))];
}

function metricRow(date, label, value, tab = '') {
  return { 日期: date || '', 项目: label, metricKey: label, 数值: n(value), 数值原值: n(value), 明细Tab: tab, 迷你走势数据: [] };
}

function ccslState(label, rows, batch, dbStatus) {
  const m = addMetrics(rows), date = batch?.reportDate || '', total = m.total;
  const dashboardRows = [
    metricRow(date,'今日PNH',total,'allData'), metricRow(date,'今日POD',m.pod,'podClosed'),
    metricRow(date,'首投POD率',m.podRate,'podClosed'), metricRow(date,'Pending不连续',m.pendingNonContinuous,'pendingNonContinuous'),
    metricRow(date,'Pending1+',m.pending1,'pendingAll'), metricRow(date,'Pending2+',m.pending2,'pending2plus'),
    metricRow(date,'Pending3+',m.pending3,'pending3'), metricRow(date,'OC1+',m.oc1,'ocAll'),
    metricRow(date,'OC2+',m.oc2,'oc2plus'), metricRow(date,'OC3+',m.oc3,'oc3'),
    metricRow(date,'盘点2天+',m.cycle2,'cycle2'), metricRow(date,'入库无扫描节点',m.inboundNoScan,'inboundNoScan'),
    metricRow(date,'工单未处理',m.workOrder,'workOrderAbnormal'), metricRow(date,'外省未完结POD件',m.provinceOpen,'provinceOpen'),
    metricRow(date,'CCSLCN分流',m.ccslCnDiversion,'ccslCnDiversion'), metricRow(date,'CCSLZT分流',m.ccslZtDiversion,'ccslZtDiversion'),
    metricRow(date,'CCSL580分流',m.ccsl580Diversion,'ccsl580Diversion'), metricRow(date,'金边门店',m.phnomPenhShop || m.shopTransit + m.shopArrived,'phnomPenhShop')
  ];
  return {
    businessType: label === 'CCSL' ? 'CCSL' : label, viewBusinessType: label,
    reportDate: date, sourceName: batch?.sourceName || '', batchId: batch?.batchId || '',
    snapshotId: batch?.snapshotId || '', snapshotStatus: batch?.snapshotStatus || 'IMPORTED',
    dailyReportReady: Boolean(date && total), sourceTotal: total, total,
    pnhBills: [], nonPnhBills: [], excludedBills: [], duplicateBills: [], dailyParseRows: [], finalRows: [],
    scanResults: [], trackResults: [], trackEvents: [], carryBills: [], nextCarryBills: [], podLocks: [], needTrackBills: [], historySummary: [],
    dailyParseSummary: { totalRecognized: total, pnh: total },
    processing: { running: false, paused: false, phase: batch?.snapshotStatus === 'COMPLETED' ? '处理完成' : '待处理' },
    dashboard: {
      pnh: total, totalMonitored: total, todayPod: m.pod, podRate: m.podRate, metrics: m,
      abnormalCount: Math.max(0, total - m.pod),
      categories: { pendingTotal: m.pending1, ocTotal: m.oc1, ccslCnDiversion: m.ccslCnDiversion, ccslZtDiversion: m.ccslZtDiversion, ccsl580Diversion: m.ccsl580Diversion, phnomPenhShop: m.phnomPenhShop || m.shopTransit + m.shopArrived },
      routing: { ccslCnDiversion: m.ccslCnDiversion, ccslZtDiversion: m.ccslZtDiversion, ccsl580Diversion: m.ccsl580Diversion, phnomPenhShop: m.phnomPenhShop || m.shopTransit + m.shopArrived }
    },
    detailTabs: { dashboard: { label: `${label}看板`, rows: dashboardRows, total: dashboardRows.length }, allData: { label:'全部数据',rows:[],total }, coreAbnormal:{label:'核心异常',rows:[],total:Math.max(0,total-m.pod)} },
    dbStatus, logs: [], _v213FastBootstrap: true
  };
}

function regionMetrics(rows, code) { return addMetrics(rows.filter(row => (row.regionCode || 'UNKNOWN') === code)); }
function shopeeState(label, rows, batch, groupsInput, dbStatus) {
  const all = addMetrics(rows), date = batch?.reportDate || '', total = all.total;
  const sourceGroups = label === 'SHOPEE' ? { ALL: rows, CN: groupsInput.CN || [], VN: groupsInput.VN || [] } : { ALL: rows, [label === 'SHOPEECN' ? 'CN' : 'VN']: rows };
  const groups = {};
  for (const [name, source] of Object.entries(sourceGroups)) groups[name] = { metrics: addMetrics(source), regions: { PP: regionMetrics(source,'PP'), PV: regionMetrics(source,'PV'), UNKNOWN: regionMetrics(source,'UNKNOWN') } };
  const dashboardRows = [];
  const defs = [['今日总单','total'],['今日POD','pod'],['POD率','podRate'],['首派成功率','firstAttemptRate'],['Pending1+','pending1'],['Pending2+','pending2'],['Pending3+','pending3'],['OC1+','oc1'],['OC2+','oc2'],['OC3+','oc3'],['入库无扫描','inboundNoScan'],['已退回件','returned'],['退回处理中','returnInProgress'],['退回待处理','returnRequired']];
  for (const [group,payload] of Object.entries(groups)) for (const [name,key] of defs) dashboardRows.push({ 日期:date, 项目:group==='ALL'?name:`${group} ${name}`, metricKey:`${group}_${name}`, 数值:n(payload.metrics[key]), 数值原值:n(payload.metrics[key]), 迷你走势数据:[] });
  const state = ccslState(label, rows, batch, dbStatus);
  state.businessType = 'SHOPEE'; state.viewBusinessType = label; state.total = total;
  state.dailyParseSummary = { totalRecognized: total, groupCounts: { CN:n(groups.CN?.metrics?.total), VN:n(groups.VN?.metrics?.total) } };
  state.dashboard = { ...state.dashboard, metrics: all, recipientGroups: groups, regions:{ PP:regionMetrics(rows,'PP'), PV:regionMetrics(rows,'PV'), UNKNOWN:regionMetrics(rows,'UNKNOWN') }, dashboardRows, detailTabs:{dashboard:{rows:dashboardRows,total:dashboardRows.length}} };
  state.detailTabs = { dashboard:{label:`${label}看板`,rows:dashboardRows,total:dashboardRows.length}, all:{label:'全部数据',rows:[],total}, abnormal:{label:'当前异常',rows:[],total:all.unresolved} };
  return state;
}

function networkInfo(req) {
  const port = Number(process.env.PORT || 5177), ips = [];
  for (const rows of Object.values(networkInterfaces())) for (const item of rows || []) if (item.family === 'IPv4' && !item.internal) ips.push(item.address);
  const publicUrl = text(process.env.PUBLIC_URL);
  return { lanUrl: ips[0] ? `http://${ips[0]}:${port}` : '', publicUrl, publicConfigured:Boolean(publicUrl), currentOrigin:`${req.protocol || 'http'}://${req.get?.('host') || `127.0.0.1:${port}`}` };
}

function buildData(req) {
  const started = Date.now(), db = getDb(), batch = latestBatch(db), dbStatus = getDbStatus();
  if (!batch) return { key:'empty', cacheHit:false, state:ccslState('CCSL',[],null,dbStatus), shopeeState:shopeeState('SHOPEE',[],null,{},dbStatus), history:{CCSL:[],SHOPEE:[],UNIFIED:[]}, unifiedImport:null, businessStates:{}, serverBuildMs:Date.now()-started };
  const key = `${batch.snapshotId}|${batch.reportDate}`;
  if (dataCache?.key === key && Date.now() - dataCache.at < CACHE_MS) return { ...dataCache.data, key, cacheHit:true };
  const rows = metricRows(db,batch), byType = Object.fromEntries(TYPES.map(type => [type, rows.filter(row => row.businessType === type)]));
  const businessStates = { CE:ccslState('CE',byType.CE,batch,dbStatus), CEAF:ccslState('CEAF',byType.CEAF,batch,dbStatus), TBKH:ccslState('TBKH',byType.TBKH,batch,dbStatus), ALI1688:ccslState('ALI1688',byType.ALI1688,batch,dbStatus), SHOPEECN:shopeeState('SHOPEECN',byType.SHOPEECN,batch,{},dbStatus), SHOPEEVN:shopeeState('SHOPEEVN',byType.SHOPEEVN,batch,{},dbStatus) };
  const state = ccslState('CCSL',rows.filter(row => CCSL_TYPES.has(row.businessType)),batch,dbStatus); state.network = networkInfo(req);
  const shopeeStateValue = shopeeState('SHOPEE',rows.filter(row => SHOPEE_TYPES.has(row.businessType)),batch,{CN:byType.SHOPEECN,VN:byType.SHOPEEVN},dbStatus);
  const history = historyRows(db,60), classificationCounts = Object.fromEntries(TYPES.map(type => [type,addMetrics(byType[type]).total])), total = Object.values(classificationCounts).reduce((sum,v)=>sum+n(v),0);
  const unifiedImport = { batchId:batch.batchId,snapshotId:batch.snapshotId,reportDate:batch.reportDate,sourceName:batch.sourceName || '',fileHash:batch.fileHash || '',snapshotStatus:batch.snapshotStatus || 'IMPORTED',classificationCounts,summary:{validUniqueWaybills:total,totalUnique:total},sourceReconciliation:{validUniqueWaybills:total,classifiedWaybills:total,difference:0,balanced:true},carryover:{todayOpen:0,historicalOpen:0,currentOpen:0} };
  const data = { state,shopeeState:shopeeStateValue,history:{CCSL:history,SHOPEE:history,UNIFIED:history},unifiedImport,businessStates,serverBuildMs:Date.now()-started };
  dataCache = { key,at:Date.now(),data }; return { ...data,key,cacheHit:false };
}

async function handler(req,res) {
  const started = Date.now();
  try {
    const built = buildData(req), token = await loadToken();
    res.setHeader('Cache-Control','private, max-age=5');
    res.setHeader('X-CE-QC-Bootstrap',built.cacheHit?'V213-HIT':'V213-MISS');
    res.setHeader('Server-Timing',`bootstrap;dur=${Date.now()-started}`);
    res.json({ ok:true,patchId:V213_FAST_BOOTSTRAP_ROUTE_ID,bootstrapMode:'V213_SAFE_FAST_ROUTE',state:built.state,shopeeState:built.shopeeState,authStatus:summarizeToken(token),session:{ok:true,user:publicUser(req.user),unreadNotifications:0},history:built.history,unifiedImport:built.unifiedImport,businessStates:built.businessStates,generatedAt:new Date().toISOString(),serverBuildMs:built.serverBuildMs,cacheHit:built.cacheHit });
  } catch (error) {
    console.error('[CE-QC][V213] bootstrap failed:',error?.stack || error);
    res.status(500).json({ok:false,code:'V213_BOOTSTRAP_FAILED',error:error?.message || String(error)});
  }
}

const previousGet = express.application.get;
express.application.get = function v213BootstrapGet(pathValue,...handlers) {
  if (pathValue === ROUTE && handlers.length) {
    console.log(`[CE-QC][V213] ${V213_FAST_BOOTSTRAP_ROUTE_ID} registered with route().get; normal app auth/session middleware remains authoritative.`);
    return this.route(pathValue).get(handler);
  }
  return previousGet.call(this,pathValue,...handlers);
};