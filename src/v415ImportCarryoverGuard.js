import express from 'express';
import { getDb } from './db.js';
import { readV415CurrentProcessingProof, V415_RETROACTIVE_COMPLETION_GUARD_ID } from './v415RetroactiveCompletionGuard.js';

export const V415_IMPORT_OPEN_GUARD_ID='2026-09-02-v415-stale-completion-open-fallback-v1';
const ROUTES=new Set(['/api/import/unified-latest','/api/bootstrap']);
const previousGet=express.application.get;
const WRAPPED=Symbol.for('ce-qc.v415-import-open-get');
const HARD_TERMINALS=new Set(['POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION']);
const text=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;

function hardTerminalCount(db,proof){
  const snapshotId=text(proof?.batch?.snapshotId),date=text(proof?.reportDate);
  if(!snapshotId||!date)return 0;
  const terminals=[...HARD_TERMINALS];
  const placeholders=terminals.map(()=>'?').join(',');
  try{
    return n(db.prepare(`SELECT COUNT(DISTINCT u.shipmentCode) count
      FROM unified_import_rows u
      LEFT JOIN shipment_current_state s ON s.shipmentCode=u.shipmentCode
      LEFT JOIN carryover_open_items c ON c.shipmentCode=u.shipmentCode
      WHERE u.snapshotId=? AND u.reportDate=?
        AND (
          UPPER(COALESCE(s.state,'')) IN (${placeholders})
          OR (UPPER(COALESCE(c.status,''))='CLOSED' AND UPPER(COALESCE(c.closeReason,'')) IN (${placeholders}))
        )`).get(snapshotId,date,...terminals,...terminals)?.count);
  }catch{return 0;}
}

export function applyV415ImportOpenGuard(imported={},proof=null,{db=getDb(),hardClosed=null}={}){
  if(!imported||typeof imported!=='object')return imported;
  const resolved=proof||readV415CurrentProcessingProof({db,reportDate:imported.reportDate});
  if(!resolved?.ok)return imported;
  const incomplete=Object.values(resolved.stages||{}).some(stage=>stage?.complete!==true);
  const carry=imported.carryover&&typeof imported.carryover==='object'?imported.carryover:{};
  const persistedToday=n(carry.todayOpen),total=n(resolved.counts?.TOTAL);
  if(!incomplete||persistedToday>0||total<=0)return imported;
  const closed=hardClosed===null?hardTerminalCount(db,resolved):Math.max(0,n(hardClosed));
  const fallbackToday=Math.max(0,total-Math.min(total,closed));
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
      source:'V415_CURRENT_MEMBERSHIP_OPEN_FALLBACK',
      persistedTodayOpen,
      hardTerminalClosed:Math.min(total,closed),
      completionProofId:V415_RETROACTIVE_COMPLETION_GUARD_ID,
      openGuardId:V415_IMPORT_OPEN_GUARD_ID
    }
  };
}

function guardPayload(payload={}){
  if(!payload||typeof payload!=='object')return payload;
  let next=payload;
  if(payload.import&&typeof payload.import==='object'){
    const proof=readV415CurrentProcessingProof({reportDate:payload.import.reportDate});
    next={...next,import:applyV415ImportOpenGuard(payload.import,proof)};
  }
  if(payload.unifiedImport&&typeof payload.unifiedImport==='object'){
    const proof=readV415CurrentProcessingProof({reportDate:payload.unifiedImport.reportDate});
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
      console.warn('[CE-QC][V415_IMPORT_OPEN_GUARD] fallback skipped:',error?.message||error);
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

console.info('[CE-QC][V415_IMPORT_OPEN_GUARD]',V415_IMPORT_OPEN_GUARD_ID,'when stale completion is rejected and persisted todayOpen is zero, import/bootstrap display falls back to current VALID membership minus hard terminal facts; read-only, no business fact mutation.');
