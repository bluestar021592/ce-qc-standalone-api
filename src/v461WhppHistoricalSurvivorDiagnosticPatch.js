import express from 'express';
import { getDb } from './db.js';

export const V461_WHPP_SURVIVOR_DIAGNOSTIC_ID='2026-09-08-v461-whpp-historical-survivor-evidence-v1';
export const V461_AUTH_ROUTE_ID='2026-09-08-v461-after-access-identity-authenticated-readonly-route-v1';
const ROUTE='/api/v461/whpp-history-survivor';
const WRAPPED=Symbol.for('ce-qc.v461-whpp-history-survivor-diagnostic');

function text(value=''){return String(value??'').trim();}
function dateOnly(value=''){const match=text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?`${match[1]}-${match[2]}-${match[3]}`:'';}
function tableExists(db,name){try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function n(value){return Number(value||0);}
function one(db,sql,...params){return db.prepare(sql).get(...params)||{};}
function rows(db,sql,...params){return db.prepare(sql).all(...params);}

export function inspectV461WhppHistoricalSurvivors(reportDate='',db=getDb()){
  const date=dateOnly(reportDate);
  if(!date){const error=new Error('V461需要有效YYYY-MM-DD日期。');error.code='V461_REPORT_DATE_INVALID';throw error;}
  const started=Date.now();
  const readErrors=[];
  const present=name=>tableExists(db,name);
  const exists={
    daily:present('business_daily_parse_rows'),current:present('shipment_current_state'),carry:present('carryover_open_items'),
    ledger:present('qc_tracking_ledger'),pod:present('business_pod_locks'),runLocks:present('business_run_locks'),
    checkpoints:present('business_run_checkpoints'),state:present('business_states')
  };
  if(!exists.daily){const error=new Error('business_daily_parse_rows不存在，无法做WHPP幸存证据盘点。');error.code='V461_DAILY_TABLE_MISSING';throw error;}

  const members=n(one(db,`SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) count
    FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''`,date).count);
  const baseCte=`WITH members AS (
    SELECT DISTINCT UPPER(TRIM(shipmentCode)) shipmentCode
    FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''
  )`;

  let current={rows:0,terminal:0,pendingScan:0,checkedNonterminal:0,unknown:0};
  if(exists.current){try{
    const r=one(db,`${baseCte}
      SELECT COUNT(c.shipmentCode) rows,
        SUM(CASE WHEN UPPER(COALESCE(c.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') THEN 1 ELSE 0 END) terminal,
        SUM(CASE WHEN UPPER(COALESCE(c.state,''))='PENDING_SCAN' OR UPPER(COALESCE(c.apiStatus,''))='PENDING_SCAN' THEN 1 ELSE 0 END) pendingScan,
        SUM(CASE WHEN UPPER(COALESCE(c.state,'')) NOT IN ('','PENDING_SCAN','POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') AND UPPER(COALESCE(c.apiStatus,'')) NOT IN ('','PENDING_SCAN') THEN 1 ELSE 0 END) checkedNonterminal,
        SUM(CASE WHEN c.shipmentCode IS NULL OR (TRIM(COALESCE(c.state,''))='' AND TRIM(COALESCE(c.apiStatus,''))='') THEN 1 ELSE 0 END) unknown
      FROM members m LEFT JOIN shipment_current_state c ON UPPER(TRIM(c.shipmentCode))=m.shipmentCode AND UPPER(COALESCE(c.businessType,''))='WHPP'`,date);
    current={rows:n(r.rows),terminal:n(r.terminal),pendingScan:n(r.pendingScan),checkedNonterminal:n(r.checkedNonterminal),unknown:n(r.unknown)};
  }catch(error){readErrors.push(`shipment_current_state:${error?.message||error}`);}}

  let carry={rows:0,open:0,closedTerminal:0,otherClosed:0};
  if(exists.carry){try{
    const r=one(db,`${baseCte}
      SELECT COUNT(c.shipmentCode) rows,
        SUM(CASE WHEN UPPER(COALESCE(c.status,''))='OPEN' THEN 1 ELSE 0 END) open,
        SUM(CASE WHEN UPPER(COALESCE(c.status,''))='CLOSED' AND UPPER(COALESCE(c.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP','NORMAL_FINAL') THEN 1 ELSE 0 END) closedTerminal,
        SUM(CASE WHEN UPPER(COALESCE(c.status,''))='CLOSED' AND UPPER(COALESCE(c.closeReason,'')) NOT IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP','NORMAL_FINAL') THEN 1 ELSE 0 END) otherClosed
      FROM members m LEFT JOIN carryover_open_items c ON UPPER(TRIM(c.shipmentCode))=m.shipmentCode AND UPPER(COALESCE(c.businessType,''))='WHPP'`,date);
    carry={rows:n(r.rows),open:n(r.open),closedTerminal:n(r.closedTerminal),otherClosed:n(r.otherClosed)};
  }catch(error){readErrors.push(`carryover_open_items:${error?.message||error}`);}}

  let ledger={rows:0,firstDateMatch:0,terminal:0,open:0,checkedOpen:0,placeholderOrUnverified:0,lastChecked:0};
  if(exists.ledger){try{
    const r=one(db,`${baseCte}
      SELECT COUNT(q.shipmentCode) rows,
        SUM(CASE WHEN q.firstReportDate=? THEN 1 ELSE 0 END) firstDateMatch,
        SUM(CASE WHEN UPPER(COALESCE(q.trackingStatus,''))='TERMINAL' THEN 1 ELSE 0 END) terminal,
        SUM(CASE WHEN UPPER(COALESCE(q.trackingStatus,''))='OPEN' THEN 1 ELSE 0 END) open,
        SUM(CASE WHEN UPPER(COALESCE(q.trackingStatus,''))='OPEN' AND TRIM(COALESCE(q.lastCheckedAt,''))<>'' AND UPPER(COALESCE(q.currentState,'')) NOT IN ('','PENDING_SCAN') THEN 1 ELSE 0 END) checkedOpen,
        SUM(CASE WHEN q.shipmentCode IS NULL OR TRIM(COALESCE(q.lastCheckedAt,''))='' OR UPPER(COALESCE(q.currentState,'')) IN ('','PENDING_SCAN') THEN 1 ELSE 0 END) placeholderOrUnverified,
        SUM(CASE WHEN TRIM(COALESCE(q.lastCheckedAt,''))<>'' THEN 1 ELSE 0 END) lastChecked
      FROM members m LEFT JOIN qc_tracking_ledger q ON UPPER(TRIM(q.shipmentCode))=m.shipmentCode AND UPPER(COALESCE(q.businessType,''))='WHPP'`,date,date);
    ledger={rows:n(r.rows),firstDateMatch:n(r.firstDateMatch),terminal:n(r.terminal),open:n(r.open),checkedOpen:n(r.checkedOpen),placeholderOrUnverified:n(r.placeholderOrUnverified),lastChecked:n(r.lastChecked)};
  }catch(error){readErrors.push(`qc_tracking_ledger:${error?.message||error}`);}}

  let podLocks=0;
  if(exists.pod){try{podLocks=n(one(db,`${baseCte} SELECT COUNT(p.shipmentCode) count FROM members m LEFT JOIN business_pod_locks p ON UPPER(TRIM(p.shipmentCode))=m.shipmentCode AND UPPER(COALESCE(p.businessType,''))='WHPP' WHERE p.shipmentCode IS NOT NULL`,date).count);}catch(error){readErrors.push(`business_pod_locks:${error?.message||error}`);}}

  let runLocks=[];
  if(exists.runLocks){try{runLocks=rows(db,`SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedAt,completedAt,updatedAt
      FROM business_run_locks WHERE businessType='WHPP' AND reportDate=? ORDER BY updatedAt DESC LIMIT 10`,date).map(row=>({
        runId:text(row.runId),status:text(row.status),currentStage:text(row.currentStage),batchIndex:n(row.batchIndex),totalBatches:n(row.totalBatches),
        hasError:Boolean(text(row.errorMessage)),lockedAt:text(row.lockedAt),completedAt:text(row.completedAt),updatedAt:text(row.updatedAt)
      }));}catch(error){readErrors.push(`business_run_locks:${error?.message||error}`);}}

  let checkpoints={rows:0,saved:0,running:0,failed:0,lastStage:'',lastUpdatedAt:''};
  if(exists.checkpoints){try{
    const r=one(db,`SELECT COUNT(*) rows,
      SUM(CASE WHEN LOWER(COALESCE(status,''))='saved' THEN 1 ELSE 0 END) saved,
      SUM(CASE WHEN LOWER(COALESCE(status,''))='running' THEN 1 ELSE 0 END) running,
      SUM(CASE WHEN LOWER(COALESCE(status,''))='failed' OR TRIM(COALESCE(errorMessage,''))<>'' THEN 1 ELSE 0 END) failed
      FROM business_run_checkpoints WHERE businessType='WHPP' AND reportDate=?`,date);
    const last=one(db,`SELECT stage,updatedAt FROM business_run_checkpoints WHERE businessType='WHPP' AND reportDate=? ORDER BY updatedAt DESC,id DESC LIMIT 1`,date);
    checkpoints={rows:n(r.rows),saved:n(r.saved),running:n(r.running),failed:n(r.failed),lastStage:text(last.stage),lastUpdatedAt:text(last.updatedAt)};
  }catch(error){readErrors.push(`business_run_checkpoints:${error?.message||error}`);}}

  let persistedState={reportDate:'',runId:'',phase:'',running:false,dailyMembers:0,scanStatuses:0,eventStatuses:0,exceptionStatuses:0,finalRows:0,lastRunCompletedAt:''};
  if(exists.state){try{
    const raw=one(db,"SELECT valueJson FROM business_states WHERE businessType='WHPP' LIMIT 1");const state=safeJson(raw.valueJson,{});
    persistedState={reportDate:text(state.reportDate),runId:text(state?.processing?.runId||state?.lastRunSummary?.runId||state?.lastRun?.runId),phase:text(state?.processing?.phase),running:state?.processing?.running===true,
      dailyMembers:Array.isArray(state.pnhBills)?state.pnhBills.length:0,scanStatuses:Array.isArray(state.scanQueryStatus)?state.scanQueryStatus.length:0,
      eventStatuses:Array.isArray(state.eventQueryStatus)?state.eventQueryStatus.length:0,exceptionStatuses:Array.isArray(state.exceptionQueryStatus)?state.exceptionQueryStatus.length:0,
      finalRows:Array.isArray(state.finalRows)?state.finalRows.length:0,lastRunCompletedAt:text(state?.lastRunSummary?.completedAt||state?.lastRun?.completedAt)};
  }catch(error){readErrors.push(`business_states:${error?.message||error}`);}}

  const currentKnown=current.terminal+current.checkedNonterminal;
  const ledgerKnown=ledger.terminal+ledger.checkedOpen;
  const survivorCoverageCandidate=members>0&&readErrors.length===0&&ledger.rows===members&&ledgerKnown===members&&ledger.placeholderOrUnverified===0;
  return{
    ok:true,readOnly:true,version:V461_WHPP_SURVIVOR_DIAGNOSTIC_ID,authRouteVersion:V461_AUTH_ROUTE_ID,reportDate:date,members,
    current:{...current,known:currentKnown},carry,ledger:{...ledger,known:ledgerKnown},podLocks,runLocks,checkpoints,persistedState,
    survivorCoverageCandidate,requiresArchiveProof:!survivorCoverageCandidate,readErrors,
    conclusion:survivorCoverageCandidate?'SURVIVOR_LEDGER_FULL_CURRENT_EVIDENCE_CANDIDATE':'SURVIVOR_EVIDENCE_INCOMPLETE_NEEDS_ARCHIVE_PROOF',
    note:'本接口只盘点幸存证据，不恢复快照、不生成最终明细、不修改数据库。ledger全覆盖也只代表可进入下一步离线证明，不等于自动判定历史已完成。',
    elapsedMs:Date.now()-started
  };
}

function handler(req,res){
  if(!req.user)return res.status(401).json({ok:false,readOnly:true,version:V461_WHPP_SURVIVOR_DIAGNOSTIC_ID,code:'AUTH_REQUIRED',error:'Authentication required.'});
  try{return res.json(inspectV461WhppHistoricalSurvivors(req.query?.reportDate||''));}
  catch(error){return res.status(400).json({ok:false,readOnly:true,version:V461_WHPP_SURVIVOR_DIAGNOSTIC_ID,code:error?.code||'V461_DIAGNOSTIC_FAILED',error:error?.message||String(error)});}
}

const previousUse=express.application.use;
let installed=false;
if(typeof previousUse==='function'&&!previousUse[WRAPPED]){
  const wrapped=function v461WhppHistoricalSurvivorUse(...args){
    const candidates=args.flat().filter(value=>typeof value==='function');
    const result=previousUse.apply(this,args);
    if(!installed&&candidates.some(fn=>fn.name==='accessIdentity')){
      installed=true;
      previousUse.call(this,(req,res,next)=>{if(req.method==='GET'&&req.path===ROUTE)return handler(req,res);return next();});
    }
    return result;
  };
  Object.defineProperty(wrapped,WRAPPED,{value:true});
  express.application.use=wrapped;
}

console.info('[CE-QC][V461_WHPP_SURVIVOR_DIAGNOSTIC]',V461_WHPP_SURVIVOR_DIAGNOSTIC_ID,V461_AUTH_ROUTE_ID,'authenticated read-only exact-member survivor evidence census installed after accessIdentity; no scan/track/API call and no database mutation.');
