import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';
import { runQcPipeline } from './pipeline.js';
import { runWhppPipeline } from './whppPipeline.js';
import { updateCarryoverResults } from './unifiedImportStore.js';
import { classifyV246Terminal } from './v246TrackingLedgerCore.js';

export const CARRY_REFRESH_TIMEZONE = 'Asia/Phnom_Penh';
export const CARRY_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const CARRY_REFRESH_POLL_MS = 60 * 1000;
export const CARRY_REFRESH_STARTUP_DELAY_MS = Math.max(30_000, Math.min(10 * 60 * 1000, Number(process.env.CARRY_REFRESH_STARTUP_DELAY_MS || 120_000)));
const ACTIVE_RUN_HEARTBEAT_MS = Math.max(2 * 60_000, Math.min(30 * 60_000, Number(process.env.ACTIVE_RUN_HEARTBEAT_MS || 10 * 60_000)));
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);

let schedulerTimer = null;
let startupTimer = null;
let startupNotBefore = 0;
let inFlight = false;
let lastFailureAt = 0;

function getMeta(db, key) {
  try { return String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value || ''); }
  catch { return ''; }
}
function setMeta(db, key, value) {
  db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(key, String(value ?? ''), nowIso());
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function billOf(row = {}) { return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase(); }
function terminalFlags(row = {}) {
  const classified = classifyV246Terminal({
    state: row.currentState || row.scanNormalizedState || '',
    stateJson: row
  });
  return { pod: Boolean(classified.pod), returned: Boolean(classified.returned), cancelled: Boolean(classified.cancelled) };
}
function normalizeDynamicCarryRow(row = {}) {
  const terminal = terminalFlags(row);
  if (terminal.pod) {
    return {
      ...row,
      currentState: 'POD',
      scanNormalizedState: 'POD',
      是否POD: '是',
      isPod: 1,
      是否退回: '否',
      退回状态: '',
      primaryCategory: 'POD闭环',
      主分类: 'POD闭环',
      异常分类: '',
      dynamicCarryRule: 'CLOSE_POD'
    };
  }
  if (terminal.returned) {
    return {
      ...row,
      currentState: 'RETURN_COMPLETED',
      scanNormalizedState: 'RETURN_COMPLETED',
      是否POD: '否',
      isPod: 0,
      是否退回: '是',
      退回状态: '已退回',
      primaryCategory: '已退回',
      主分类: '已退回',
      异常分类: '',
      dynamicCarryRule: 'CLOSE_RETURNED'
    };
  }
  const state = String(row.currentState || row.scanNormalizedState || '').toUpperCase();
  const category = String(row.primaryCategory || row.主分类 || row.异常分类 || '');
  const returnInProgress = state === 'RETURN_IN_PROGRESS' || row.退回状态 === '退回处理中' || /退回处理中/.test(category);
  if (returnInProgress) {
    return {
      ...row,
      dynamicOriginalCategory: category,
      primaryCategory: '逆向处理中',
      主分类: '逆向处理中',
      异常分类: '逆向处理中',
      currentState: 'RETURN_IN_PROGRESS',
      退回状态: '退回处理中',
      matchedRule: 'V294_KEEP_OPEN_RETURN_IN_PROGRESS',
      dynamicCarryRule: 'KEEP_OPEN_UNTIL_RETURN_86'
    };
  }
  const cancelled = terminal.cancelled || state === 'ORDER_CANCELLED' || row.订单取消 === '是' || row.取消状态 === '已取消' || String(row.orderStatus || '') === '10' || /订单取消/.test(category);
  if (cancelled) {
    return { ...row, currentState: 'ORDER_CANCELLED', scanNormalizedState: 'ORDER_CANCELLED', matchedRule: 'NORMAL_FINAL_HUB', dynamicTerminalReason: 'ORDER_CANCELLED', dynamicCarryRule: 'CLOSE_CANCELLED' };
  }
  const normalTransit = row.matchedRule === 'NORMAL_FINAL_HUB' || category === '正常分流节点' || state === 'NORMAL_FINAL';
  if (normalTransit) {
    return {
      ...row,
      dynamicOriginalCategory: category,
      primaryCategory: category === '正常分流节点' ? '正常运输中' : (row.primaryCategory || '正常运输中'),
      主分类: row.主分类 === '正常分流节点' ? '正常运输中' : (row.主分类 || '正常运输中'),
      异常分类: row.异常分类 === '正常分流节点' ? '' : row.异常分类,
      matchedRule: 'V294_KEEP_OPEN_NORMAL_TRANSIT',
      dynamicCarryRule: 'KEEP_OPEN_NORMAL_TRANSIT_UNTIL_TRUE_TERMINAL'
    };
  }
  return row;
}

export function cambodiaClock(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: CARRY_REFRESH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const minuteOfDay = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
  return { date: localDate, hour: Number(parts.hour || 0), minute: Number(parts.minute || 0), second: Number(parts.second || 0), minuteOfDay };
}

export function dueCarryRefreshReason() { return ''; }

function freshRunningLock(row = {}, now = Date.now()) {
  if (String(row.status || '').toLowerCase() !== 'running') return false;
  const touchedAt = Date.parse(String(row.updatedAt || row.lockedAt || ''));
  if (!Number.isFinite(touchedAt)) return false;
  return now - touchedAt <= ACTIVE_RUN_HEARTBEAT_MS;
}

export function activeBusinessProcessingDetails(db = getDb()) {
  const now = Date.now();
  const blockers = [];
  const purgeBlockUntil = Number(getMeta(db, 'data_purge_block_until') || 0);
  if (Number.isFinite(purgeBlockUntil) && purgeBlockUntil > now) blockers.push({ family: 'DATA_PURGE', status: 'running', reportDate: '', businessType: '', currentStage: '数据维护', updatedAt: new Date(purgeBlockUntil).toISOString() });
  if (inFlight) blockers.push({ family: 'MANUAL_CARRY_REFRESH', status: 'running', reportDate: '', businessType: '', currentStage: '手动更新未完成POD', updatedAt: nowIso() });
  try {
    for (const row of db.prepare("SELECT reportDate,runId,status,currentStage,batchIndex,totalBatches,lockedAt,updatedAt FROM run_locks WHERE status='running' ORDER BY updatedAt DESC").all()) if (freshRunningLock(row, now)) blockers.push({ family: 'CCSL', ...row });
  } catch {}
  try {
    for (const row of db.prepare("SELECT businessType,reportDate,runId,status,currentStage,batchIndex,totalBatches,lockedAt,updatedAt FROM business_run_locks WHERE status='running' ORDER BY updatedAt DESC").all()) if (freshRunningLock(row, now)) blockers.push({ family: 'BUSINESS', ...row });
  } catch {}
  return { active: blockers.length > 0, heartbeatMs: ACTIVE_RUN_HEARTBEAT_MS, blockers };
}

export function hasActiveBusinessProcessing(db = getDb()) { return activeBusinessProcessingDetails(db).active; }
export function loadOpenCarryRows(db = getDb()) {
  return db.prepare(`SELECT shipmentCode,UPPER(COALESCE(businessType,'')) businessType,sourceReportDate,lastReportDate,status,apiStatus,stateJson FROM carryover_open_items WHERE status='OPEN' ORDER BY sourceReportDate,shipmentCode`).all();
}

export function buildCarryRefreshState(family, rows, reportDate, refreshId) {
  const prior = rows.map(row => ({ ...safeJson(row.stateJson, {}), shipmentCode: row.shipmentCode, 运单号: row.shipmentCode, businessType: row.businessType }));
  const bills = prior.map(billOf).filter(Boolean);
  return {
    businessType: family, reportDate, sourceName: 'MANUAL_OPEN_CARRY_REFRESH', dailyReportReady: true,
    pnhBills: [], carryBills: bills, nextCarryBills: bills, podLocks: [], dailyParseRows: prior, priorCarryRows: prior,
    scanResults: [], scanQueryStatus: [], trackResults: [], trackQueryStatus: [], trackEvents: [], shipmentTracks: [], shipmentQueryStatus: [], exceptionItems: [], exceptionQueryStatus: [], eventQueryStatus: [], finalRows: [],
    currentRun: { runId: refreshId, reportDate, status: 'running' }, lastRunSummary: { runId: refreshId, reportDate, runStatus: 'running' },
    processing: { running: true, paused: false, phase: 'MANUAL_OPEN_CARRY_REFRESH', runId: refreshId }
  };
}

export async function processCarryFamilyForRefresh(family, rows, { client = new CEClient(), reportDate, refreshId } = {}) {
  if (!rows.length) return { successfulRows: [], failedBills: [] };
  const state = buildCarryRefreshState(family, rows, reportDate, refreshId);
  let outputState = state;
  try {
    const result = family === 'WHPP'
      ? await runWhppPipeline({ state, client, onProgress: async () => {}, onCheckpoint: async () => {}, isPaused: async () => false })
      : await runQcPipeline({ state, client, onProgress: async () => {}, onCheckpoint: async () => {}, isPaused: async () => false });
    outputState = result?.state || state;
  } catch (error) { outputState = error?.state || state; }
  const sourceByBill = new Map(rows.map(row => [String(row.shipmentCode || '').trim().toUpperCase(), row]));
  const allowed = new Set(sourceByBill.keys());
  const successfulRows = [], success = new Set(), failed = new Set();
  const candidateRows = Array.isArray(outputState.finalRows) ? outputState.finalRows : [];
  for (const row of candidateRows) {
    const bill = billOf(row);
    if (!bill || !allowed.has(bill)) continue;
    if (/失败|REFRESH_FAILED|API_PENDING_RETRY|RETRY/i.test(`${row.API状态 || ''} ${row.查询状态 || ''} ${row.apiStatus || ''}`)) failed.add(bill);
    else {
      const source = sourceByBill.get(bill) || {};
      successfulRows.push({ ...normalizeDynamicCarryRow(row), shipmentCode: bill, 运单号: bill,
        businessType: String(source.businessType || row.businessType || family).toUpperCase(),
        sourceReportDate: String(source.sourceReportDate || row.sourceReportDate || row.reportDate || reportDate || '').slice(0, 10),
        previousLastReportDate: String(source.lastReportDate || '') });
      success.add(bill);
    }
  }
  for (const row of rows) if (!success.has(String(row.shipmentCode || '').trim().toUpperCase())) failed.add(String(row.shipmentCode || '').trim().toUpperCase());
  return { successfulRows, failedBills: [...failed].filter(Boolean) };
}

function persistManualRefreshFinalTruth(rows, db = getDb()) {
  if (!rows?.length) return { persisted: 0 };
  const now = nowIso();
  const upsertCcsl = db.prepare(`INSERT INTO final_rows(shipmentCode,reportDate,sourceType,isPod,category,qcConclusion,lastEvent,lastEventTime,lastEventCode,lastEventDesc,lastEventTargetNode,lastEventActionType,matchedRule,matchedShopCode,matchedShopName,primaryCategory,tagsJson,pendingDays,ocDays,cycleCountDays,assignDays,deliveringDays,trackNodeCount,eventCourier,pickupShop,deliveryShop,productCode,customerName,rawSummary,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(shipmentCode,reportDate) DO UPDATE SET sourceType=excluded.sourceType,isPod=excluded.isPod,category=excluded.category,qcConclusion=excluded.qcConclusion,lastEvent=excluded.lastEvent,lastEventTime=excluded.lastEventTime,lastEventCode=excluded.lastEventCode,lastEventDesc=excluded.lastEventDesc,lastEventTargetNode=excluded.lastEventTargetNode,lastEventActionType=excluded.lastEventActionType,matchedRule=excluded.matchedRule,matchedShopCode=excluded.matchedShopCode,matchedShopName=excluded.matchedShopName,primaryCategory=excluded.primaryCategory,tagsJson=excluded.tagsJson,pendingDays=excluded.pendingDays,ocDays=excluded.ocDays,cycleCountDays=excluded.cycleCountDays,assignDays=excluded.assignDays,deliveringDays=excluded.deliveringDays,trackNodeCount=excluded.trackNodeCount,eventCourier=excluded.eventCourier,pickupShop=excluded.pickupShop,deliveryShop=excluded.deliveryShop,productCode=excluded.productCode,customerName=excluded.customerName,rawSummary=excluded.rawSummary,rawJson=excluded.rawJson,updatedAt=excluded.updatedAt`);
  const updateCcslExtended = db.prepare(`UPDATE final_rows SET targetShopCode=?,currentShopCode=?,shopName=?,shopCycleId=?,shopTransferStartedAt=?,shopArrivedAt=?,shopPendingAt=?,shopRetentionNaturalDays=?,shopState=?,shopStateReason=?,whitelistVersion=? WHERE shipmentCode=? AND reportDate=?`);
  const upsertBusiness = db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(businessType,shipmentCode,reportDate) DO UPDATE SET isPod=excluded.isPod,primaryCategory=excluded.primaryCategory,apiStatus=excluded.apiStatus,carryStatus=excluded.carryStatus,latestEventTime=excluded.latestEventTime,latestEventDesc=excluded.latestEventDesc,latestNode=excluded.latestNode,recipient_raw=CASE WHEN excluded.recipient_raw<>'' THEN excluded.recipient_raw ELSE business_final_rows.recipient_raw END,recipient_normalized=CASE WHEN excluded.recipient_normalized<>'' THEN excluded.recipient_normalized ELSE business_final_rows.recipient_normalized END,recipient_group=CASE WHEN excluded.recipient_group<>'' THEN excluded.recipient_group ELSE business_final_rows.recipient_group END,recipient_group_reason=CASE WHEN excluded.recipient_group_reason<>'' THEN excluded.recipient_group_reason ELSE business_final_rows.recipient_group_reason END,source_row_number=CASE WHEN excluded.source_row_number>0 THEN excluded.source_row_number ELSE business_final_rows.source_row_number END,rawJson=excluded.rawJson,updatedAt=excluded.updatedAt`);
  const updateBusinessExtended = db.prepare(`UPDATE business_final_rows SET currentMainCategory=?,auxiliaryFlagsJson=?,targetShopCode=?,currentShopCode=?,shopName=?,shopCycleId=?,shopTransferStartedAt=?,shopArrivedAt=?,shopLastEventAt=?,shopPendingAt=?,shopPendingReason=?,shopRetentionNaturalDays=?,shopState=?,shopStateReason=?,whitelistVersion=?,firstAttemptAt=?,currentAttemptNo=?,podAttemptNo=?,attemptStatus=?,attemptConfidence=?,attemptUnknownReason=?,attemptHistoryJson=?,attemptCalculatedAt=? WHERE businessType=? AND shipmentCode=? AND reportDate=?`);
  let persisted = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const bill = billOf(row), sourceDate = String(row.sourceReportDate || row.reportDate || '').slice(0, 10), type = String(row.businessType || '').toUpperCase();
      if (!bill || !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) throw new Error(`MANUAL_REFRESH_SOURCE_BINDING_MISSING:${bill || 'UNKNOWN'}`);
      const { pod, returned } = terminalFlags(row), terminal = pod || returned;
      const category = pod ? 'POD闭环' : returned ? '已退回' : String(row.primaryCategory || row.主分类 || row.异常分类 || row.currentState || '');
      const normalized = { ...row, shipmentCode: bill, 运单号: bill, reportDate: sourceDate, businessType: type, isPod: pod ? 1 : 0, 是否POD: pod ? '是' : '否', 是否退回: returned ? '是' : (row.是否退回 || '否'), 退回状态: returned ? '已退回' : (row.退回状态 || ''), currentState: pod ? 'POD' : returned ? 'RETURN_COMPLETED' : (row.currentState || row.scanNormalizedState || ''), scanNormalizedState: pod ? 'POD' : returned ? 'RETURN_COMPLETED' : (row.scanNormalizedState || row.currentState || ''), primaryCategory: category, 主分类: category, latestManualRefreshAt: now };
      const rawJson = JSON.stringify(normalized);
      const targetShopCode = terminal ? '' : (row.targetShopCode || ''), currentShopCode = terminal ? '' : (row.currentShopCode || row.门店编码 || ''), shopName = terminal ? '' : (row.shopName || row.门店名称 || ''), shopCycleId = terminal ? '' : (row.shopCycleId || ''), shopTransferStartedAt = terminal ? '' : (row.shopTransferStartedAt || ''), shopArrivedAt = terminal ? '' : (row.shopArrivedAt || row.门店入库时间 || ''), shopLastEventAt = terminal ? '' : (row.shopLastEventAt || row.latestEventTime || row.最后节点时间 || ''), shopPendingAt = terminal ? '' : (row.shopPendingAt || ''), shopPendingReason = terminal ? '' : (row.shopPendingReason || ''), shopRetentionNaturalDays = terminal ? 0 : Number(row.shopRetentionNaturalDays || row.门店滞留天数 || 0), shopState = terminal ? '' : (row.shopState || ''), shopStateReason = terminal ? '' : (row.shopStateReason || '');
      if (CCSL_TYPES.has(type)) {
        upsertCcsl.run(bill, sourceDate, row.sourceType || type, pod ? 1 : 0, category, row.qcConclusion || row.QC判断 || '', row.lastEvent || row.lastEventDesc || row.latestEventDesc || row.最后节点 || '', row.lastEventTime || row.latestEventTime || row.最后节点时间 || '', row.lastEventCode || '', row.lastEventDesc || row.latestEventDesc || row.最后节点 || '', row.lastEventTargetNode || '', row.lastEventActionType || '', row.matchedRule || '', row.matchedShopCode || '', row.matchedShopName || '', category, JSON.stringify(row.tags || []), Number(row.pendingDistinctDayCount ?? row.Pending天数 ?? row.pendingDays ?? 0), Number(row.OC天数 ?? row.ocDays ?? 0), Number(row.盘点天数 ?? row.cycleCountDays ?? 0), Number(row.派件分配天数 ?? row.assignDays ?? 0), Number(row.派送中天数 ?? row.deliveringDays ?? 0), Number(row.轨迹节点数 ?? row.trackNodeCount ?? 0), row.eventCourier || '', row.pickupShop || '', row.deliveryShop || '', row.productCode || '', row.customerName || '', row.rawSummary || '', rawJson, now, now);
        updateCcslExtended.run(targetShopCode,currentShopCode,shopName,shopCycleId,shopTransferStartedAt,shopArrivedAt,shopPendingAt,shopRetentionNaturalDays,shopState,shopStateReason,row.whitelistVersion || '',bill,sourceDate); persisted++;
      } else if (SHOPEE_TYPES.has(type) || type === 'WHPP') {
        const storageType = SHOPEE_TYPES.has(type) ? 'SHOPEE' : 'WHPP', recipientGroup = type === 'SHOPEECN' ? 'CN' : type === 'SHOPEEVN' ? 'VN' : (row.recipient_group || row.recipientGroup || '');
        upsertBusiness.run(storageType, bill, sourceDate, pod ? 1 : 0, category, row.apiStatus || row.API状态 || row.查询状态 || '', row.carryStatus || row.carry状态 || '', row.latestEventTime || row.最后节点时间 || '', row.latestEventDesc || row.最后节点 || '', row.latestNode || row.最后节点 || '', row.recipient_raw || row.recipientRaw || '', row.recipient_normalized || row.recipientNormalized || '', recipientGroup, row.recipient_group_reason || row.recipientGroupReason || '', Number(row.source_row_number || row.rowNumber || 0), rawJson, now, now);
        updateBusinessExtended.run(category,row.auxiliaryFlagsJson || JSON.stringify(row.auxiliaryFlags || []),targetShopCode,currentShopCode,shopName,shopCycleId,shopTransferStartedAt,shopArrivedAt,shopLastEventAt,shopPendingAt,shopPendingReason,shopRetentionNaturalDays,shopState,shopStateReason,row.whitelistVersion || '',row.firstAttemptAt || '',Number(row.currentAttemptNo || 0),Number(row.podAttemptNo || 0),row.attemptStatus || '',row.attemptConfidence || '',row.attemptUnknownReason || '',row.attemptHistoryJson || JSON.stringify(row.attemptHistory || []),row.attemptCalculatedAt || '',storageType,bill,sourceDate); persisted++;
      } else throw new Error(`MANUAL_REFRESH_UNKNOWN_BUSINESS:${type || 'EMPTY'}:${bill}`);
    }
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  return { persisted };
}

export function applySuccessfulCarryRefresh(rows, { snapshotId, reportDate, db = getDb() } = {}) {
  if (!rows?.length) return null;
  const finalSync = persistManualRefreshFinalTruth(rows, db);
  const carry = updateCarryoverResults({ snapshotId, reportDate, rows });
  return { ...carry, finalSync };
}
export function recordCarryRefreshSuccess(db = getDb(), { date, openCount = 0, refreshed = 0, failed = 0, closed = 0, reason = '' } = {}) {
  setMeta(db, 'carry_refresh_last_success_at', nowIso()); setMeta(db, 'carry_refresh_last_rollover_date', date || cambodiaClock().date); setMeta(db, 'carry_refresh_last_open_count', String(openCount)); setMeta(db, 'carry_refresh_last_refreshed_count', String(refreshed)); setMeta(db, 'carry_refresh_last_failed_count', String(failed)); setMeta(db, 'carry_refresh_last_closed_count', String(closed)); setMeta(db, 'carry_refresh_last_reason', reason);
}
export async function refreshOpenCarryNow({ reason = 'MANUAL_USER_REFRESH', client = new CEClient(), date = new Date(), db = getDb() } = {}) {
  if (inFlight) return { ok: true, skipped: true, reason: 'ALREADY_RUNNING' };
  if (hasActiveBusinessProcessing(db)) return { ok: true, skipped: true, reason: 'FOREGROUND_PROCESSING_ACTIVE' };
  inFlight = true; const clock = cambodiaClock(date), refreshId = `MANUAL-CARRY-${clock.date}-${Date.now()}`;
  try {
    const open = loadOpenCarryRows(db);
    if (!open.length) { recordCarryRefreshSuccess(db, { date: clock.date, reason, openCount: 0 }); return { ok: true, refreshId, reason, openBefore: 0, openAfter: 0, refreshed: 0, failed: 0, closed: 0 }; }
    const ccslRows = open.filter(row => CCSL_TYPES.has(row.businessType)), shopeeRows = open.filter(row => SHOPEE_TYPES.has(row.businessType)), whppRows = open.filter(row => row.businessType === 'WHPP');
    const outcomes = [await processCarryFamilyForRefresh('CCSL', ccslRows, { client, reportDate: clock.date, refreshId: `${refreshId}-CCSL` }), await processCarryFamilyForRefresh('SHOPEE', shopeeRows, { client, reportDate: clock.date, refreshId: `${refreshId}-SHOPEE` }), await processCarryFamilyForRefresh('WHPP', whppRows, { client, reportDate: clock.date, refreshId: `${refreshId}-WHPP` })];
    const successfulRows = outcomes.flatMap(item => item.successfulRows), failedBills = new Set(outcomes.flatMap(item => item.failedBills));
    for (const row of open) if (!CCSL_TYPES.has(row.businessType) && !SHOPEE_TYPES.has(row.businessType) && row.businessType !== 'WHPP') failedBills.add(row.shipmentCode);
    if (successfulRows.length) applySuccessfulCarryRefresh(successfulRows, { snapshotId: refreshId, reportDate: clock.date, db });
    const openAfter = Number(db.prepare("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN'").get()?.count || 0), closed = Math.max(0, open.length - openAfter);
    if (!successfulRows.length && failedBills.size) throw new Error(`OPEN_CARRY_REFRESH_ALL_FAILED:${failedBills.size}`);
    recordCarryRefreshSuccess(db, { date: clock.date, reason, openCount: openAfter, refreshed: successfulRows.length, failed: failedBills.size, closed });
    return { ok: true, refreshId, reason, openBefore: open.length, openAfter, refreshed: successfulRows.length, failed: failedBills.size, closed };
  } catch (error) { lastFailureAt = Date.now(); try { setMeta(db, 'carry_refresh_last_error_at', nowIso()); setMeta(db, 'carry_refresh_last_error', String(error?.message || error).slice(0, 1000)); } catch {} throw error; }
  finally { inFlight = false; }
}
export function startCarryoverRefreshScheduler() {
  if (schedulerTimer || startupTimer) stopCarryoverRefreshSchedulerForTests();
  console.log('[CE-QC][CARRY_REFRESH] automatic refresh disabled; unfinished POD data updates only by explicit manual request.');
  return { started: false, reason: 'MANUAL_ONLY', refreshMs: 0, pollMs: 0, timezone: CARRY_REFRESH_TIMEZONE };
}
export function schedulerStateForTests() { return { started: false, inFlight, startupNotBefore: 0, startupDelayMs: 0, activeRunHeartbeatMs: ACTIVE_RUN_HEARTBEAT_MS, manualOnly: true, ccslTypes: [...CCSL_TYPES], shopeeTypes: [...SHOPEE_TYPES] }; }
export function stopCarryoverRefreshSchedulerForTests() { if (schedulerTimer) clearInterval(schedulerTimer); if (startupTimer) clearTimeout(startupTimer); schedulerTimer = null; startupTimer = null; startupNotBefore = 0; inFlight = false; lastFailureAt = 0; }