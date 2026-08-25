import { getDb, nowIso } from './db.js';
import { ensureV246TrackingSchema } from './v246TrackingLedgerCore.js';

export const V294_CARRYOVER_LIFECYCLE_TRUTH_ID = '2026-08-25-v294-return-in-progress-stays-open-v1';

const text = value => String(value ?? '').trim();
const upper = value => text(value).toUpperCase();
function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; }
}
function firstValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && text(value)) return value;
  }
  return '';
}
function latestCode(payload = {}) {
  return text(firstValue(payload, ['latestTrackStatusCode','lastEventCode','eventCode','trackingEventCode','statusCode']));
}
function evidenceText(payload = {}) {
  return [
    payload.currentState,payload.scanNormalizedState,payload.primaryCategory,payload.currentMainCategory,payload.主分类,payload.异常分类,
    payload.退回状态,payload.latestEventDesc,payload.最后节点,payload.QC判断
  ].map(text).filter(Boolean).join(' ');
}
export function isV294ReturnInProgress(payload = {}) {
  const evidence = evidenceText(payload);
  return upper(payload.currentState) === 'RETURN_IN_PROGRESS'
    || upper(payload.scanNormalizedState) === 'RETURN_IN_PROGRESS'
    || payload.退回状态 === '退回处理中'
    || /RETURN_IN_PROGRESS|退回处理中|退回待处理|正在退回|返仓处理中/i.test(evidence);
}
export function hasV294ExactReturnCompletion(payload = {}) {
  const code = latestCode(payload);
  const orderStatus = text(payload.orderStatus);
  const evidence = evidenceText(payload);
  if (orderStatus === '100' || code === '86' || payload.退回状态 === '已退回') return true;
  if (/RETURN_COMPLETED|\bRETURNED\b|已退回|退回完成|退件完成|退货完成|返仓完成/i.test(evidence)
      && !/RETURN_IN_PROGRESS|退回处理中|退回待处理|正在退回|返仓处理中/i.test(evidence)) return true;
  return false;
}

export function repairV294CarryoverLifecycle({ reportDate = '', db = getDb(), reason = 'V294_POST_PROCESS' } = {}) {
  ensureV246TrackingSchema(db);
  const rows = db.prepare(`SELECT o.shipmentCode,o.businessType,o.status,o.closeReason,o.stateJson AS carryJson,
      c.state AS currentState,c.stateJson AS currentJson
    FROM carryover_open_items o
    LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode
    WHERE UPPER(COALESCE(o.status,''))='CLOSED' AND UPPER(COALESCE(o.closeReason,'')) IN ('RETURNED','RETURN_COMPLETED')`).all();
  if (!rows.length) return { ok: true, version: V294_CARRYOVER_LIFECYCLE_TRUTH_ID, reportDate, scanned: 0, reopened: 0, bills: [] };

  const now = nowIso();
  const reopenCarry = db.prepare(`UPDATE carryover_open_items SET status='OPEN',closeReason='',updatedAt=? WHERE shipmentCode=?`);
  const reopenCurrent = db.prepare(`UPDATE shipment_current_state SET state='RETURN_IN_PROGRESS',stateJson=?,updatedAt=? WHERE shipmentCode=?`);
  const ledgerGet = db.prepare(`SELECT shipmentCode,businessType,trackingStatus,terminalReason,currentState,currentCategory FROM qc_tracking_ledger WHERE shipmentCode=?`);
  const reopenLedger = db.prepare(`UPDATE qc_tracking_ledger SET trackingStatus='OPEN',terminalReason='',terminalAt='',currentState='RETURN_IN_PROGRESS',currentCategory='逆向处理中',lastRepairReason=?,updatedAt=? WHERE shipmentCode=? AND terminalReason IN ('RETURNED','RETURN_COMPLETED')`);
  const audit = db.prepare(`INSERT INTO qc_tracking_audit(shipmentCode,businessType,action,reason,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,?,?,?)`);
  const reopened = [];

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const payload = { ...safeJson(row.carryJson, {}), ...safeJson(row.currentJson, {}) };
      if (!isV294ReturnInProgress(payload) || hasV294ExactReturnCompletion(payload)) continue;
      const bill = upper(row.shipmentCode);
      if (!bill) continue;
      const repairedPayload = {
        ...payload,
        currentState: 'RETURN_IN_PROGRESS',
        scanNormalizedState: upper(payload.scanNormalizedState) === 'RETURNED' ? 'RETURN_IN_PROGRESS' : payload.scanNormalizedState,
        primaryCategory: /退回|RETURN/i.test(text(payload.primaryCategory)) ? '逆向处理中' : payload.primaryCategory,
        主分类: /退回|RETURN/i.test(text(payload.主分类)) ? '逆向处理中' : payload.主分类,
        退回状态: '退回处理中',
        v294CarryRepair: V294_CARRYOVER_LIFECYCLE_TRUTH_ID
      };
      reopenCarry.run(now, bill);
      reopenCurrent.run(JSON.stringify(repairedPayload), now, bill);
      const before = ledgerGet.get(bill) || null;
      const changed = Number(reopenLedger.run(`${reason}:RETURN_IN_PROGRESS_REOPEN`, now, bill)?.changes || 0);
      if (changed) {
        const after = ledgerGet.get(bill) || null;
        audit.run(bill, upper(row.businessType || before?.businessType), 'REOPEN_RETURN_IN_PROGRESS', `${reason}:RETURN_IN_PROGRESS_REOPEN`, JSON.stringify(before || {}), JSON.stringify(after || {}), now);
      }
      reopened.push(bill);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }

  return { ok: true, version: V294_CARRYOVER_LIFECYCLE_TRUTH_ID, reportDate, scanned: rows.length, reopened: reopened.length, bills: reopened.slice(0, 50) };
}

console.info('[CE-QC][V294_CARRYOVER_LIFECYCLE]', V294_CARRYOVER_LIFECYCLE_TRUTH_ID,
  'return-in-progress is never a completed return; falsely closed RETURNED carry rows are reopened until exact 100/86/已退回/退回完成 evidence exists.');
