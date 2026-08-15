import { getDb, nowIso } from './db.js';
import {
  completeUnifiedSnapshot,
  updateCarryoverResults as updateCarryoverResultsLegacy
} from './unifiedImportStore.js';

export { completeUnifiedSnapshot };
export const UNIFIED_STORE_V137_ID='2026-08-15-v137-special-terminal-persistence-v1';

const SPECIAL_TERMINALS=new Set([
  'SELF_PICKUP',
  'CCSLCN_DIVERSION','CECN_RETENTION',
  'CCSLZT_DIVERSION','CEZT_RETENTION',
  'CCSL580_RETENTION','CCSL580_DIVERSION','CE580_RETENTION','580_RETENTION'
]);

function billOf(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();}
function stateOf(row={}){return String(row.specialState||row.currentState||row.primaryCategory||row.主分类||'').trim().toUpperCase();}
function apiFailed(row={}){return /失败|RETRY|API_PENDING/i.test(`${row.API状态||''} ${row.查询状态||''} ${row.apiStatus||''}`);}

export function updateCarryoverResults(args={}){
  const result=updateCarryoverResultsLegacy(args);
  const rows=Array.isArray(args.rows)?args.rows:[];
  const special=rows.filter(row=>SPECIAL_TERMINALS.has(stateOf(row))&&!apiFailed(row));
  if(!special.length)return result;
  const db=getDb();const now=nowIso();
  const carry=db.prepare(`UPDATE carryover_open_items SET status='CLOSED',apiStatus='SUCCESS',closeReason=?,lastReportDate=?,lastSnapshotId=?,stateJson=?,updatedAt=? WHERE shipmentCode=?`);
  const current=db.prepare(`UPDATE shipment_current_state SET state=?,apiStatus='SUCCESS',reportDate=?,snapshotId=?,lastEventTime=?,stateJson=?,updatedAt=? WHERE shipmentCode=?`);
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of special){
      const bill=billOf(row);if(!bill)continue;const state=stateOf(row);const json=JSON.stringify({...row,dynamicCarryRule:'CLOSE_SPECIAL_NORMAL',matchedRule:row.matchedRule||'SPECIAL_NORMAL_FINAL'});
      carry.run(state,args.reportDate||row.reportDate||'',args.snapshotId||'',json,now,bill);
      current.run(state,args.reportDate||row.reportDate||'',args.snapshotId||'',row.latestEventTime||row.最后节点时间||'',json,now,bill);
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return result;
}

export const __test={SPECIAL_TERMINALS};
