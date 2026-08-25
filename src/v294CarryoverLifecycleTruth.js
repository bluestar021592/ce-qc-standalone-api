import { getDb, nowIso } from './db.js';
import { ensureV246TrackingSchema } from './v246TrackingLedgerCore.js';

export const V294_CARRYOVER_LIFECYCLE_TRUTH_ID = '2026-08-25-v294-nonterminal-carry-closure-guard-v3';

const text = value => String(value ?? '').trim();
const upper = value => text(value).toUpperCase();
const dateKey = value => { const match=text(value).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/); return match?`${match[1]}-${match[2]}-${match[3]}`:''; };
function safeJson(value, fallback = {}) { if (value && typeof value === 'object') return value; try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; } }
function firstValue(row = {}, keys = []) { for (const key of keys) { const value = row?.[key]; if (value !== undefined && value !== null && text(value)) return value; } return ''; }
function latestCode(payload = {}) { return text(firstValue(payload, ['latestTrackStatusCode','lastEventCode','eventCode','trackingEventCode','statusCode'])); }
function evidenceText(payload = {}) {
  return [payload.currentState,payload.scanNormalizedState,payload.primaryCategory,payload.currentMainCategory,payload.主分类,payload.异常分类,payload.退回状态,payload.latestEventDesc,payload.最后节点,payload.QC判断]
    .map(text).filter(Boolean).join(' ');
}
export function isV294ReturnInProgress(payload = {}) {
  const evidence = evidenceText(payload);
  return upper(payload.currentState) === 'RETURN_IN_PROGRESS'
    || upper(payload.scanNormalizedState) === 'RETURN_IN_PROGRESS'
    || payload.退回状态 === '退回处理中'
    || /RETURN_IN_PROGRESS|退回处理中|退回待处理|正在退回|返仓处理中/i.test(evidence);
}
export function hasV294ExactReturnCompletion(payload = {}) {
  const code = latestCode(payload), orderStatus = text(payload.orderStatus), evidence = evidenceText(payload);
  if (orderStatus === '100' || code === '86' || payload.退回状态 === '已退回') return true;
  if (/RETURN_COMPLETED|\bRETURNED\b|已退回|退回完成|退件完成|退货完成|返仓完成/i.test(evidence)
      && !/RETURN_IN_PROGRESS|退回处理中|退回待处理|正在退回|返仓处理中/i.test(evidence)) return true;
  return false;
}
function hasV294ExactPod(payload={}){
  const code=latestCode(payload),state=upper(payload.currentState||payload.scanNormalizedState),evidence=evidenceText(payload);
  return text(payload.orderStatus)==='85'||code==='80'||payload.是否POD==='是'||state==='POD'||(/\bPOD\b|Successfully delivered|已签收|已妥投|签收完成/i.test(evidence)&&!/未签收|未妥投|failed|失败/i.test(evidence));
}
function hasV294ExactCancel(payload={}){
  const state=upper(payload.currentState||payload.scanNormalizedState),evidence=evidenceText(payload);
  return text(payload.orderStatus)==='10'||state==='ORDER_CANCELLED'||payload.订单取消==='是'||payload.取消状态==='已取消'||/订单取消|ORDER_CANCELLED/i.test(evidence);
}
function hasV294SpecialClosedState(payload={}){
  const state=upper(payload.specialState||payload.currentState||payload.scanNormalizedState||payload.primaryCategory||payload.主分类);
  const evidence=evidenceText(payload);
  return ['SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION'].includes(state)||/仓库自提|CECN滞留包裹|CEZT滞留包裹|580滞留包裹/i.test(evidence);
}
function hasV294ExactTerminal(payload={}){return hasV294ExactPod(payload)||hasV294ExactReturnCompletion(payload)||hasV294ExactCancel(payload)||hasV294SpecialClosedState(payload);}

export function repairV294CarryoverLifecycle({ reportDate = '', businessTypes = [], db = getDb(), reason = 'V294_POST_PROCESS' } = {}) {
  ensureV246TrackingSchema(db);
  const date = dateKey(reportDate);
  const types = [...new Set((businessTypes || []).map(upper).filter(Boolean))];
  const params = [];
  let scopeSql = '';
  if (date) { scopeSql += ' AND (o.lastReportDate=? OR c.reportDate=?)'; params.push(date,date); }
  if (types.length) { scopeSql += ` AND UPPER(COALESCE(o.businessType,'')) IN (${types.map(()=>'?').join(',')})`; params.push(...types); }
  const rows = db.prepare(`SELECT o.shipmentCode,o.businessType,o.status,o.closeReason,o.stateJson AS carryJson,
      c.state AS currentState,c.reportDate AS currentReportDate,c.stateJson AS currentJson
    FROM carryover_open_items o
    LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode
    WHERE UPPER(COALESCE(o.status,''))='CLOSED' AND UPPER(COALESCE(o.closeReason,'')) IN ('RETURNED','RETURN_COMPLETED','NORMAL_FINAL')${scopeSql}`).all(...params);
  if (!rows.length) return { ok: true, version: V294_CARRYOVER_LIFECYCLE_TRUTH_ID, reportDate: date, businessTypes: types, scanned: 0, reopened: 0, returnInProgressReopened:0, normalTransitReopened:0, bills: [] };

  const now = nowIso();
  const reopenCarry = db.prepare(`UPDATE carryover_open_items SET status='OPEN',closeReason='',updatedAt=? WHERE shipmentCode=?`);
  const reopenCurrent = db.prepare(`UPDATE shipment_current_state SET state=?,stateJson=?,updatedAt=? WHERE shipmentCode=?`);
  const ledgerGet = db.prepare(`SELECT shipmentCode,businessType,trackingStatus,terminalReason,currentState,currentCategory FROM qc_tracking_ledger WHERE shipmentCode=?`);
  const reopenLedger = db.prepare(`UPDATE qc_tracking_ledger SET trackingStatus='OPEN',terminalReason='',terminalAt='',currentState=?,currentCategory=?,currentStateJson=?,lastRepairReason=?,updatedAt=? WHERE shipmentCode=? AND trackingStatus='TERMINAL' AND terminalReason IN ('RETURNED','RETURN_COMPLETED','NORMAL_FINAL')`);
  const audit = db.prepare(`INSERT INTO qc_tracking_audit(shipmentCode,businessType,action,reason,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,?,?,?)`);
  const reopened = []; let returnInProgressReopened=0,normalTransitReopened=0;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const payload = { ...safeJson(row.carryJson, {}), ...safeJson(row.currentJson, {}) };
      const closeReason=upper(row.closeReason);
      const returning=isV294ReturnInProgress(payload)&&!hasV294ExactReturnCompletion(payload);
      const falseNormal=closeReason==='NORMAL_FINAL'&&!hasV294ExactTerminal(payload);
      if (!returning && !falseNormal) continue;
      const bill = upper(row.shipmentCode); if (!bill) continue;
      const repairedPayload = returning ? {
        ...payload,
        currentState: 'RETURN_IN_PROGRESS',
        scanNormalizedState: upper(payload.scanNormalizedState) === 'RETURNED' ? 'RETURN_IN_PROGRESS' : payload.scanNormalizedState,
        primaryCategory: /退回|RETURN/i.test(text(payload.primaryCategory)) ? '逆向处理中' : payload.primaryCategory,
        主分类: /退回|RETURN/i.test(text(payload.主分类)) ? '逆向处理中' : payload.主分类,
        退回状态: '退回处理中',
        matchedRule:'V294_KEEP_OPEN_RETURN_IN_PROGRESS',
        v294CarryRepair: V294_CARRYOVER_LIFECYCLE_TRUTH_ID
      } : {
        ...payload,
        currentState: 'OPEN',
        scanNormalizedState: upper(payload.scanNormalizedState)==='NORMAL_FINAL'?'OPEN':payload.scanNormalizedState,
        primaryCategory: text(payload.primaryCategory)==='正常分流节点'?'正常运输中':(payload.primaryCategory||'正常运输中'),
        主分类: text(payload.主分类)==='正常分流节点'?'正常运输中':(payload.主分类||'正常运输中'),
        matchedRule:'V294_KEEP_OPEN_NORMAL_TRANSIT',
        dynamicCarryRule:'KEEP_OPEN_NORMAL_TRANSIT_UNTIL_TRUE_TERMINAL',
        v294CarryRepair: V294_CARRYOVER_LIFECYCLE_TRUTH_ID
      };
      const stateName=returning?'RETURN_IN_PROGRESS':'OPEN';
      const category=returning?'逆向处理中':'正常运输中';
      reopenCarry.run(now, bill);
      reopenCurrent.run(stateName,JSON.stringify(repairedPayload), now, bill);
      const before = ledgerGet.get(bill) || null;
      const action=returning?'REOPEN_RETURN_IN_PROGRESS':'REOPEN_NORMAL_TRANSIT';
      const repairReason=`${reason}:${action}`;
      const changed = Number(reopenLedger.run(stateName,category,JSON.stringify(repairedPayload),repairReason,now,bill)?.changes || 0);
      if (changed) {
        const after = ledgerGet.get(bill) || null;
        audit.run(bill, upper(row.businessType || before?.businessType), action, repairReason, JSON.stringify(before || {}), JSON.stringify(after || {}), now);
      }
      reopened.push(bill); if(returning)returnInProgressReopened+=1;else normalTransitReopened+=1;
    }
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }

  return { ok: true, version: V294_CARRYOVER_LIFECYCLE_TRUTH_ID, reportDate: date, businessTypes: types, scanned: rows.length, reopened: reopened.length, returnInProgressReopened, normalTransitReopened, bills: reopened.slice(0, 50) };
}

console.info('[CE-QC][V294_CARRYOVER_LIFECYCLE]', V294_CARRYOVER_LIFECYCLE_TRUTH_ID,
  'return-in-progress and normal transit/final-hub nodes are non-terminal; false closures are reopened until exact POD/return completion/cancel/special terminal evidence exists.');
