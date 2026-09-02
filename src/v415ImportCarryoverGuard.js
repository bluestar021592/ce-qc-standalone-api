import express from 'express';
import { getDb } from './db.js';
import { readV415CurrentProcessingProof, V415_RETROACTIVE_COMPLETION_GUARD_ID, V416_FAST_FAILCLOSED_PROOF_ID } from './v415RetroactiveCompletionGuard.js';

export const V415_IMPORT_OPEN_GUARD_ID='2026-09-02-v415-stale-completion-open-fallback-v1';
export const V416_OPEN_CLOSURE_SEPARATION_ID='2026-09-02-v416-processing-complete-does-not-close-open-v1';
const ROUTES=new Set(['/api/import/unified-latest','/api/bootstrap']);
const previousGet=express.application.get;
const WRAPPED=Symbol.for('ce-qc.v415-import-open-get');
const HARD_TERMINALS=new Set(['POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION']);
const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const text=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;

function classificationTotal(imported={}){
  const counts=imported.classificationCounts&&typeof imported.classificationCounts==='object'?imported.classificationCounts:{};
  return TYPES.reduce((sum,type)=>sum+n(counts[type]),0);
}

function hardTerminalCount(db,scope){
  const snapshotId=text(scope?.batch?.snapshotId||scope?.snapshotId),date=text(scope?.reportDate);
  if(!snapshotId||!date)return{ok:false,count:0,reason:'MISSING_SCOPE'};
  const terminals=[...HARD_TERMINALS];
  const placeholders=terminals.map(()=>'?').join(',');
  try{
    const count=n(db.prepare(`SELECT COUNT(DISTINCT u.shipmentCode) count
      FROM unified_import_rows u
      LEFT JOIN shipment_current_state s ON s.shipmentCode=u.shipmentCode
      LEFT JOIN carryover_open_items c ON c.shipmentCode=u.shipmentCode
      WHERE u.snapshotId=? AND u.reportDate=?
        AND (
          UPPER(COALESCE(s.state,'')) IN (${placeholders})
          OR (UPPER(COALESCE(c.status,''))='CLOSED' AND UPPER(COALESCE(c.closeReason,'')) IN (${placeholders}))
        )`).get(snapshotId,date,...terminals,...terminals)?.count);
    return{ok:true,count,reason:'CURRENT_MEMBERSHIP_HARD_TERMINALS'};
  }catch(error){return{ok:false,count:0,reason:`TERMINAL_COUNT_FAILED:${text(error?.message||error)}`};}
}

export function applyV415ImportOpenGuard(imported={},proof=null,{db=getDb(),hardClosed=null}={}){
  if(!imported||typeof imported!=='object')return imported;
  const resolved=proof||readV415CurrentProcessingProof({db,reportDate:imported.reportDate});
  const carry=imported.carryover&&typeof imported.carryover==='object'?imported.carryover:{};
  const persistedToday=n(carry.todayOpen);
  const proofTotal=resolved?.ok?n(resolved.counts?.TOTAL):0;
  const importedTotal=classificationTotal(imported);
  const total=Math.max(proofTotal,importedTotal,n(imported?.summary?.validUniqueWaybills));
  if(persistedToday>0||total<=0)return imported;
  const scope=resolved?.ok?resolved:{reportDate:text(imported.reportDate),snapshotId:text(imported.snapshotId),batch:{snapshotId:text(imported.snapshotId)}};
  const terminal=hardClosed===null?hardTerminalCount(db,scope):{ok:true,count:Math.max(0,n(hardClosed)),reason:'TEST_OVERRIDE'};
  const closed=Math.min(total,Math.max(0,n(terminal.count)));
  const fallbackToday=Math.max(0,total-closed);
  if(fallbackToday<=persistedToday)return imported;
  const historical=n(carry.historicalOpen);
  return{
    ...imported,
    carryover:{
      ...carry,
      todayOpen:fallbackToday,
      currentOpen:fallbackToday+historical,
      historicalOpen:historical,
      historicalSeparate:true,
      source:terminal.ok?'V416_CURRENT_MEMBERSHIP_MINUS_HARD_TERMINALS':'V416_CONSERVATIVE_CURRENT_MEMBERSHIP_OPEN',
      persistedTodayOpen:persistedToday,
      hardTerminalClosed:closed,
      hardTerminalReadOk:terminal.ok,
      hardTerminalReadReason:terminal.reason,
      processingCompleteDoesNotCloseOpen:true,
      completionProofId:V415_RETROACTIVE_COMPLETION_GUARD_ID,
      fastProofId:V416_FAST_FAILCLOSED_PROOF_ID,
      openGuardId:V415_IMPORT_OPEN_GUARD_ID,
      closureSeparationId:V416_OPEN_CLOSURE_SEPARATION_ID
    }
  };
}

function guardPayload(payload={}){
  if(!payload||typeof payload!=='object')return payload;
  let next=payload;
  if(payload.import&&typeof payload.import==='object'){
    let proof=null;
    try{proof=readV415CurrentProcessingProof({reportDate:payload.import.reportDate});}catch{}
    next={...next,import:applyV415ImportOpenGuard(payload.import,proof)};
  }
  if(payload.unifiedImport&&typeof payload.unifiedImport==='object'){
    let proof=null;
    try{proof=readV415CurrentProcessingProof({reportDate:payload.unifiedImport.reportDate});}catch{}
    next={...next,unifiedImport:applyV415ImportOpenGuard(payload.unifiedImport,proof)};
  }
  return next;
}

function responseGuard(req,res,next){
  const previousJson=res.json;
  res.json=function v415ImportOpenJson(payload){
    try{
      res.json=previousJson;
      return previousJson.call(this,guardPayload(payload));
    }catch(error){
      console.warn('[CE-QC][V416_IMPORT_OPEN_GUARD] conservative fallback skipped:',error?.message||error);
      res.json=previousJson;
      return previousJson.call(this,payload);
    }
  };
  return next();
}

if(typeof previousGet==='function'&&!previousGet[WRAPPED]){
  const wrapped=function v415ImportCarryoverGet(pathValue,...handlers){
    if(ROUTES.has(String(pathValue||'')))return previousGet.call(this,pathValue,responseGuard,...handlers);
    return previousGet.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrapped,WRAPPED,{value:true});
  express.application.get=wrapped;
}

console.info('[CE-QC][V415_IMPORT_OPEN_GUARD]',V415_IMPORT_OPEN_GUARD_ID,V416_OPEN_CLOSURE_SEPARATION_ID,'OPEN is business-closure truth, not processing-stage truth: persisted zero OPEN is reconciled against exact current membership and hard terminal facts even after a processing cycle is complete; read-only, no business fact mutation.');
