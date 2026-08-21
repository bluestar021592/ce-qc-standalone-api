import { getDb } from './db.js';
import { persistV203ManualQuery, V203_BUSINESS_TYPES } from './v203ManualEvidenceStore.js';

export const V204_LEGACY_MANUAL_BACKFILL_VERSION='2026-08-18-v204-legacy-orphan-manual-evidence-backfill-v1';
const EXACT=new Set(V203_BUSINESS_TYPES);
let lastResult={ok:true,scanned:0,backfilled:0,skippedAmbiguous:0,errors:0,ranAt:''};
let running=false;

function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function billOf(value=''){return String(value||'').trim().toUpperCase();}
function dateKey(value=''){const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function inferExactBusiness(row={}){
  const raw=String(row.businessType||'').trim().toUpperCase();
  if(EXACT.has(raw))return raw;
  const bill=billOf(row.shipmentCode);
  const state=safeJson(row.stateJson,{});
  const text=JSON.stringify(state).toUpperCase();
  if(/^TBKH/.test(bill)||/\bTBKH\b/.test(text))return 'TBKH';
  if(/\bSHOPEECN\b|SHOPEE\s*CN|RECIPIENT_GROUP[^A-Z0-9]*CN/.test(text))return 'SHOPEECN';
  if(/\bSHOPEEVN\b|SHOPEE\s*VN|RECIPIENT_GROUP[^A-Z0-9]*VN/.test(text))return 'SHOPEEVN';
  if(/\bALI1688\b/.test(text))return 'ALI1688';
  if(/\bCEAF\b/.test(text))return 'CEAF';
  if(/\bWHPP\b/.test(text))return 'WHPP';
  if(/\bBUSINESSTYPE[^A-Z0-9]*CE\b|\b业务板块[^A-Z0-9]*CE\b/.test(text))return 'CE';
  return '';
}
function queryTrackEvents(db,bill){
  try{return db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,createdAt FROM business_track_events WHERE shipmentCode=? ORDER BY eventTime,createdAt,id`).all(bill).map(row=>({...safeJson(row.rawJson,{}),shipmentCode:row.shipmentCode,eventTime:row.eventTime,eventCode:row.eventCode,createdAt:row.createdAt}));}catch{return[];}
}
function queryShipmentRows(db,bill){
  try{return db.prepare(`SELECT shipmentCode,shipmentStatus,statusText,rawJson,createdAt,updatedAt FROM business_shipment_tracks WHERE shipmentCode=? ORDER BY createdAt,updatedAt`).all(bill).map(row=>({...safeJson(row.rawJson,{}),shipmentCode:row.shipmentCode,shipmentStatus:row.shipmentStatus,statusText:row.statusText,createdAt:row.createdAt,updatedAt:row.updatedAt}));}catch{return[];}
}
function candidates(db,limit){
  try{return db.prepare(`SELECT sc.shipmentCode,sc.businessType,sc.reportDate,sc.state,sc.apiStatus,sc.lastEventTime,sc.stateJson,sc.updatedAt
    FROM shipment_current_state sc
    WHERE NOT EXISTS(SELECT 1 FROM unified_import_rows u WHERE u.shipmentCode=sc.shipmentCode)
      AND NOT EXISTS(SELECT 1 FROM manual_query_evidence m WHERE m.shipmentCode=sc.shipmentCode)
    ORDER BY sc.updatedAt DESC LIMIT ?`).all(limit);}catch{return[];}
}
export function backfillV204LegacyManualEvidence({limit=10000}={}){
  if(running)return{...lastResult,running:true};running=true;
  const db=getDb();let scanned=0,backfilled=0,skippedAmbiguous=0,errors=0;
  try{
    const rows=candidates(db,Math.max(100,Math.min(50000,Number(limit)||10000)));
    for(const row of rows){
      scanned++;
      const businessType=inferExactBusiness(row);
      if(!businessType){skippedAmbiguous++;continue;}
      const shipmentCode=billOf(row.shipmentCode);if(!shipmentCode)continue;
      try{
        const state=safeJson(row.stateJson,{});
        const trackEvents=queryTrackEvents(db,shipmentCode);
        const shipmentRows=queryShipmentRows(db,shipmentCode);
        const reportDate=dateKey(row.reportDate)||dateKey(row.updatedAt)||new Date().toISOString().slice(0,10);
        const result=persistV203ManualQuery({requestedBusinessType:businessType,reportDate,payload:{shipmentCodes:[shipmentCode],rows:[{...state,shipmentCode,businessType,currentState:row.state,API状态:row.apiStatus,latestEventTime:row.lastEventTime}],trackEvents,shipmentRows},requestMeta:{sourceOrigin:'LEGACY_DB_BACKFILL',backfillVersion:V204_LEGACY_MANUAL_BACKFILL_VERSION,previousBusinessType:row.businessType||''}});
        backfilled+=Number(result.persisted||0);
      }catch(error){errors++;console.error('[CE-QC][V204_LEGACY_MANUAL_BACKFILL_ROW_FAILED]',shipmentCode,error?.message||error);}
    }
    lastResult={ok:errors===0,version:V204_LEGACY_MANUAL_BACKFILL_VERSION,scanned,backfilled,skippedAmbiguous,errors,ranAt:new Date().toISOString()};
    console.log('[CE-QC][V204_LEGACY_MANUAL_BACKFILL]',JSON.stringify(lastResult));
    return lastResult;
  }finally{running=false;}
}
export function inspectV204LegacyManualBackfill(){return{...lastResult,version:V204_LEGACY_MANUAL_BACKFILL_VERSION,running};}
