import crypto from 'node:crypto';
import { getDb, nowIso } from './db.js';
import { buildWhppDashboard } from './whppReporting.js';
import { inspectV461WhppHistoricalSurvivors } from './v461WhppHistoricalSurvivorDiagnosticPatch.js';
import { getV462WhppArchiveEvidence } from './v462WhppSurvivorFastPatch.js';
import { isWhppCancelledRow } from './whppAnalyzer.js';
import { isSpecialCategory } from './specialNode.js';
import { auditAction, requireRole, sameOriginWriteGuard } from './accessControl.js';

export const V464_WHPP_OFFLINE_RECOVERY_ID='2026-09-08-v464-proof-gated-member-locked-whpp-offline-history-recovery-v1';
export const V464_WHPP_OFFLINE_RECOVERY_ROUTE_ID='2026-09-08-v468-v462-lazy-exact-route-dispatch-v1';
export const V464_WHPP_OFFLINE_RECOVERY_ROUTE='/api/v464/whpp-history-offline-recovery';
const CONFIRMATION='V464_OFFLINE_RECOVERY';
const HEADER='x-ce-qc-history-recovery';
const requireOperator=requireRole('OPERATOR');

const text=value=>String(value??'').trim();
const bill=value=>text(value).normalize('NFKC').toUpperCase();
function dateOnly(value=''){const match=text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?`${match[1]}-${match[2]}-${match[3]}`:'';}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function uniq(values=[]){return [...new Set((values||[]).map(item=>bill(item)).filter(Boolean))].sort();}
function billOf(row={}){return bill(row.shipmentCode||row.运单号||row.waybill||'');}
function uniqueRows(rows=[]){const map=new Map();for(const row of rows||[]){const code=billOf(row);if(code)map.set(code,row);}return [...map.values()];}
function sameList(a=[],b=[]){return a.length===b.length&&a.every((value,index)=>value===b[index]);}
function categoryOf(row={}){return String(row.primaryCategory||row.主分类||row.异常分类||'');}
function isPod(row={}){return row.是否POD==='是'||row.POD状态==='POD'||String(row.currentState||'').toUpperCase()==='POD';}
function isReturned(row={}){return row.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(String(row.currentState||'').toUpperCase())||categoryOf(row)==='退回';}
function terminalReason(row={}){
  if(isPod(row))return 'POD';
  if(isReturned(row))return 'RETURNED';
  if(isWhppCancelledRow(row))return 'ORDER_CANCELLED';
  const special=String(row.specialState||row.primaryCategory||row.主分类||'').toUpperCase();
  if(['CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP'].includes(special))return special;
  if(['CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION'].includes(special))return special==='CCSL580_RETENTION'?'CCSL580_DIVERSION':special;
  if(isSpecialCategory(row))return special||'NORMAL_FINAL';
  if(row.primaryCategory==='正常分流节点'||row.matchedRule==='NORMAL_FINAL_HUB')return 'NORMAL_FINAL';
  return '';
}
function normalizedDailyRows(db,date){
  return db.prepare("SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY shipmentCode").all(date).map(row=>{
    const code=bill(row.shipmentCode),raw=safeJson(row.rowJson,{});
    return {...raw,shipmentCode:code,运单号:code,businessType:'WHPP',reportDate:date};
  });
}
function viableSnapshotRows(db,date){
  return db.prepare("SELECT snapshotId,status,reconciliationStatus FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? AND UPPER(COALESCE(status,'VALID'))<>'INVALID' AND UPPER(COALESCE(reconciliationStatus,'COMPLETED'))<>'FAILED' ORDER BY createdAt,id").all(date);
}
function modernDailyComplete(summary={}){
  const status=String(summary.snapshotStatus||summary.reconciliationStatus||'').toUpperCase();
  return summary.completed===true&&['COMPLETED','COMPLETED_WITH_RETRY'].includes(status)&&Boolean(text(summary.finalizedSnapshotId));
}
function publicProof(context={}){const {proof}=context;return proof?{...proof}:{};}

function buildRecoveryContext(reportDate='',db=getDb(),archiveJobOverride=null){
  const date=dateOnly(reportDate);if(!date){const error=new Error('V464需要有效YYYY-MM-DD日期。');error.code='V464_REPORT_DATE_INVALID';throw error;}
  const started=Date.now();
  const header=db.prepare("SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)||null;
  const dailyRows=normalizedDailyRows(db,date),members=uniq(dailyRows.map(row=>row.shipmentCode)),reported=Number(header?.totalCount||0),summary=safeJson(header?.summaryJson,{});
  const stateRow=db.prepare("SELECT valueJson FROM business_states WHERE businessType='WHPP' LIMIT 1").get()||{};
  const state=safeJson(stateRow.valueJson,{}),stateMembers=uniq(state.pnhBills||[]),stateCarry=uniq([...(state.carryBills||[]),...(state.nextCarryBills||[])]).filter(code=>!members.includes(code));
  const finalRowsAll=uniqueRows(Array.isArray(state.finalRows)?state.finalRows:[]),finalMap=new Map(finalRowsAll.map(row=>[billOf(row),row]));
  const finalDailyRows=members.map(code=>finalMap.get(code)).filter(Boolean),finalBills=uniq(finalRowsAll.map(billOf));
  const expectedWorkBills=uniq([...members,...stateCarry]),unexpectedFinalBills=finalBills.filter(code=>!expectedWorkBills.includes(code)),missingWorkBills=expectedWorkBills.filter(code=>!finalMap.has(code));
  const survivor=inspectV461WhppHistoricalSurvivors(date,db);
  const currentFinalCount=Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_final_rows WHERE businessType='WHPP' AND reportDate=?").get(date)?.count||0);
  const snapshots=viableSnapshotRows(db,date);
  const historyRow=db.prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)||null;
  const historySnapshotId=text(safeJson(historyRow?.summaryJson,{}).snapshotId);
  const archiveJob=archiveJobOverride||getV462WhppArchiveEvidence(date),archive=archiveJob?.state==='COMPLETED'?(archiveJob.result||{}):{};
  const confirm=archive?.endpoints?.confirm||{};
  const archiveConfirmExact=archiveJob?.state==='COMPLETED'&&!archiveJob?.truncated&&Number(confirm.requestedDaily||0)===members.length&&Number(confirm.responseDaily||0)===members.length;
  const recoveredAlready=Boolean(header&&modernDailyComplete(summary)&&currentFinalCount===members.length&&snapshots.some(row=>text(row.snapshotId)===text(summary.finalizedSnapshotId)));
  const stateReportExact=text(state.reportDate)===date;
  const stateMembershipExact=sameList(stateMembers,members);
  const stateDailyFinalCoverageExact=members.length>0&&finalDailyRows.length===members.length;
  const stateWorksetExact=expectedWorkBills.length>0&&sameList(finalBills,expectedWorkBills)&&unexpectedFinalBills.length===0&&missingWorkBills.length===0;
  const survivorExact=survivor.survivorCoverageCandidate===true&&Number(survivor.members||0)===members.length&&Number(survivor.current?.known||0)===members.length&&Number(survivor.ledger?.known||0)===members.length&&Number(survivor.ledger?.placeholderOrUnverified||0)===0;
  const carryLedgerConsistent=Number(survivor.carry?.rows||0)===members.length&&Number(survivor.carry?.open||0)===Number(survivor.ledger?.checkedOpen||0)&&Number(survivor.carry?.closedTerminal||0)===Number(survivor.ledger?.terminal||0)&&Number(survivor.carry?.otherClosed||0)===0;
  const noCurrentHistoricalRows=currentFinalCount===0;
  const noViableSnapshot=snapshots.length===0;
  const noHistoryAttestation=!historySnapshotId;
  const dailyUnfinalized=!modernDailyComplete(summary)&&!text(summary.finalizedSnapshotId);
  const stateIdle=state?.processing?.running!==true;
  const headerExact=Boolean(header)&&reported===members.length&&members.length>0;
  const recoveredState={...state,reportDate:date,pnhBills:members,dailyParseRows:dailyRows};
  const dashboard=buildWhppDashboard(recoveredState);
  const dashboardExact=dashboard?.accounting?.balanced===true&&Number(dashboard?.metrics?.total||0)===members.length;
  const checks={headerExact,stateReportExact,stateMembershipExact,stateDailyFinalCoverageExact,stateWorksetExact,survivorExact,carryLedgerConsistent,archiveConfirmExact,noCurrentHistoricalRows,noViableSnapshot,noHistoryAttestation,dailyUnfinalized,stateIdle,dashboardExact};
  const failedChecks=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
  const repairable=!recoveredAlready&&failedChecks.length===0;
  const proof={
    ok:true,version:V464_WHPP_OFFLINE_RECOVERY_ID,routeVersion:V464_WHPP_OFFLINE_RECOVERY_ROUTE_ID,reportDate:date,readOnly:true,repairable,recoveredAlready,failedChecks,
    reported,members:members.length,stateMembers:stateMembers.length,stateCarry:stateCarry.length,stateFinalRows:finalRowsAll.length,stateDailyFinalCoverage:finalDailyRows.length,expectedWorkset:expectedWorkBills.length,
    currentHistoricalFinalRows:currentFinalCount,viableSnapshots:snapshots.length,historySnapshotIdPresent:Boolean(historySnapshotId),
    survivor:{candidate:Boolean(survivor.survivorCoverageCandidate),currentKnown:Number(survivor.current?.known||0),ledgerKnown:Number(survivor.ledger?.known||0),ledgerTerminal:Number(survivor.ledger?.terminal||0),ledgerCheckedOpen:Number(survivor.ledger?.checkedOpen||0),carryOpen:Number(survivor.carry?.open||0),carryClosedTerminal:Number(survivor.carry?.closedTerminal||0)},
    archive:{state:text(archiveJob?.state||'NOT_STARTED'),truncated:Boolean(archiveJob?.truncated),readErrors:Number(archiveJob?.readErrors||0),confirmRequestedDaily:Number(confirm.requestedDaily||0),confirmResponseDaily:Number(confirm.responseDaily||0),trackRequestedDaily:Number(archive?.endpoints?.track?.requestedDaily||0),exceptionRequestedDaily:Number(archive?.endpoints?.exception?.requestedDaily||0)},
    checks,networkCalls:0,databaseWrites:0,repairScope:'HISTORICAL_FINAL_ROWS+FINAL_SNAPSHOT+HISTORY_SUMMARY+DAILY_COMPLETION+WHPP_CONTROL_METADATA_ONLY',
    protectedFacts:['shipment_current_state','carryover_open_items','qc_tracking_ledger','business_pod_locks','business_track_events','business_scan_results','business_exception_items'],
    note:'V464只在保存的WHPP state工作集、V246逐票真实检查、carry闭环和V266 confirm成员证据全部精确闭合时允许一次显式离线恢复。track/exception归档不是必要条件，因为不会从归档重算轨迹；恢复使用已保存finalRows并保持V246/current/carry事实不变。',elapsedMs:Date.now()-started
  };
  return{proof,internal:{date,header,summary,dailyRows,members,state,stateMembers,stateCarry,finalRowsAll,finalDailyRows,expectedWorkBills,survivor,archiveJob,dashboard,recoveredState}};
}

export function inspectV464WhppOfflineRecovery(reportDate='',db=getDb(),archiveJobOverride=null){return publicProof(buildRecoveryContext(reportDate,db,archiveJobOverride));}

function insertRecoveredFinalRows(db,date,rows,now){
  const insert=db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for(const row of rows){
    const terminal=terminalReason(row),apiStatus=/失败|retry/i.test(String(row.API状态||row.查询状态||''))?'API_PENDING_RETRY':'SUCCESS',rawJson=JSON.stringify(row);
    insert.run('WHPP',billOf(row),date,isPod(row)?1:0,categoryOf(row),apiStatus,terminal?'CLOSED':'OPEN',row.latestEventTime||row.最后节点时间||'',row.latestEventDesc||row.最后节点||'',row.latestNode||row.latestNodeCode||'',row.recipient_raw||row.recipientRaw||'',row.recipient_normalized||row.recipientNormalized||'','WHPP','SHIPMENT_PREFIX_CE',Number(row.source_row_number||row.rowNumber||0),rawJson,now,now);
  }
}

export function repairV464WhppOfflineHistory({reportDate='',db=getDb(),archiveJobOverride=null}={}){
  const date=dateOnly(reportDate);if(!date){const error=new Error('V464需要有效YYYY-MM-DD日期。');error.code='V464_REPORT_DATE_INVALID';throw error;}
  db.exec('BEGIN IMMEDIATE');
  try{
    const context=buildRecoveryContext(date,db,archiveJobOverride),proof=context.proof,inside=context.internal;
    if(proof.recoveredAlready){db.exec('COMMIT');return{ok:true,version:V464_WHPP_OFFLINE_RECOVERY_ID,reportDate:date,alreadyRecovered:true,repairable:false,databaseWrites:0,networkCalls:0};}
    if(!proof.repairable){const error=new Error(`V464离线恢复证明未闭合：${proof.failedChecks.join(',')||'UNKNOWN'}`);error.code='V464_RECOVERY_PROOF_INCOMPLETE';error.proof=proof;throw error;}
    const now=nowIso(),snapshotId=`WHPP-${date}-V464-${crypto.randomUUID()}`;
    const memberSet=new Set(inside.members),memberFinalRows=inside.finalRowsAll.filter(row=>memberSet.has(billOf(row)));
    const recoveredState={...inside.state,reportDate:date,pnhBills:inside.members,dailyParseRows:inside.dailyRows,snapshotId,snapshotStatus:'COMPLETED',finalSnapshotAuthority:V464_WHPP_OFFLINE_RECOVERY_ID,
      processing:{...(inside.state.processing||{}),running:false,paused:false,phase:'完成'},
      offlineHistoryRecovery:{version:V464_WHPP_OFFLINE_RECOVERY_ID,recoveredAt:now,source:'PERSISTED_STATE+V246_LEDGER+V266_CONFIRM',memberLocked:true,originalPhase:text(inside.state?.processing?.phase),originalRunId:text(inside.state?.processing?.runId||inside.state?.lastRunSummary?.runId||inside.state?.lastRun?.runId),stateFinalRows:inside.finalRowsAll.length,dailyMembers:inside.members.length,expectedWorkset:inside.expectedWorkBills.length}
    };
    const dashboard=buildWhppDashboard(recoveredState);
    if(!dashboard?.accounting?.balanced||Number(dashboard?.metrics?.total||0)!==inside.members.length){const error=new Error('V464恢复前最终dashboard对账未闭合。');error.code='V464_DASHBOARD_NOT_BALANCED';throw error;}
    insertRecoveredFinalRows(db,date,memberFinalRows,now);
    const recoveryProof={version:V464_WHPP_OFFLINE_RECOVERY_ID,recoveredAt:now,memberCount:inside.members.length,stateFinalRows:inside.finalRowsAll.length,expectedWorkset:inside.expectedWorkBills.length,v246Known:Number(inside.survivor.ledger?.known||0),carryOpen:Number(inside.survivor.carry?.open||0),carryClosedTerminal:Number(inside.survivor.carry?.closedTerminal||0),confirmRequestedDaily:Number(inside.archiveJob?.result?.endpoints?.confirm?.requestedDaily||0),confirmResponseDaily:Number(inside.archiveJob?.result?.endpoints?.confirm?.responseDaily||0),archiveReadErrors:Number(inside.archiveJob?.readErrors||0),networkCalls:0};
    const payload={state:recoveredState,dashboard,status:'VALID',reconciliationStatus:'COMPLETED',finalSnapshotAuthority:V464_WHPP_OFFLINE_RECOVERY_ID,recoveryProof};
    db.prepare(`INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,payloadJson,generatedAt,createdAt,status,reconciliationStatus,invalidReason)
      VALUES(?,?,?,?,?,?,?,'VALID','COMPLETED','')`).run(snapshotId,'WHPP',date,text(inside.state?.processing?.runId||inside.state?.lastRunSummary?.runId||inside.state?.lastRun?.runId||'V464-OFFLINE-RECOVERY'),JSON.stringify(payload),now,now);
    db.prepare(`INSERT INTO business_history_summary(businessType,reportDate,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?)
      ON CONFLICT(businessType,reportDate) DO UPDATE SET summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt`).run('WHPP',date,JSON.stringify({...dashboard.metrics,accounting:dashboard.accounting,snapshotId,offlineHistoryRecovery:recoveryProof}),now,now);
    const dailyMeta=safeJson(inside.header?.summaryJson,{});
    db.prepare("UPDATE business_daily_reports SET summaryJson=?,updatedAt=? WHERE businessType='WHPP' AND reportDate=?").run(JSON.stringify({...dailyMeta,total:inside.members.length,completed:true,snapshotStatus:'COMPLETED',reconciliationStatus:'COMPLETED',finalizedSnapshotId:snapshotId,finalizedAt:now,finalSnapshotAuthority:V464_WHPP_OFFLINE_RECOVERY_ID,offlineHistoryRecovery:recoveryProof}),now,date);
    db.prepare("UPDATE business_states SET valueJson=?,updatedAt=? WHERE businessType='WHPP'").run(JSON.stringify(recoveredState),now);
    const verify=db.prepare(`SELECT COUNT(DISTINCT d.shipmentCode) covered FROM business_daily_parse_rows d JOIN business_final_rows f ON f.businessType='WHPP' AND f.reportDate=d.reportDate AND f.shipmentCode=d.shipmentCode WHERE d.businessType='WHPP' AND d.reportDate=?`).get(date)||{};
    const snap=db.prepare("SELECT status,reconciliationStatus FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? AND snapshotId=? LIMIT 1").get(date,snapshotId)||{};
    const dailyAfter=safeJson(db.prepare("SELECT summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)?.summaryJson,{});
    if(Number(verify.covered||0)!==inside.members.length||String(snap.status||'').toUpperCase()!=='VALID'||String(snap.reconciliationStatus||'').toUpperCase()!=='COMPLETED'||text(dailyAfter.finalizedSnapshotId)!==snapshotId){const error=new Error('V464事务内回读校验失败，已拒绝提交。');error.code='V464_POST_WRITE_VERIFY_FAILED';throw error;}
    db.exec('COMMIT');
    return{ok:true,version:V464_WHPP_OFFLINE_RECOVERY_ID,reportDate:date,repaired:true,snapshotId,members:inside.members.length,stateFinalRows:inside.finalRowsAll.length,historicalFinalRowsWritten:memberFinalRows.length,networkCalls:0,protectedCurrentFactsUnchanged:true,recoveryProof};
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}

function authenticated(req,res){if(req.user)return true;res.status(401).json({ok:false,version:V464_WHPP_OFFLINE_RECOVERY_ID,code:'AUTH_REQUIRED',error:'Authentication required.'});return false;}
function getHandler(req,res){
  if(!authenticated(req,res))return;
  try{
    const proof=inspectV464WhppOfflineRecovery(req.query?.reportDate||'',getDb());
    const role=String(req.user?.role||'').toUpperCase();
    return res.json({...proof,canRepair:['OPERATOR','ADMIN'].includes(role)});
  }catch(error){return res.status(400).json({ok:false,version:V464_WHPP_OFFLINE_RECOVERY_ID,code:error?.code||'V464_PREFLIGHT_FAILED',error:error?.message||String(error)});}
}
function executePost(req,res){
  const confirmation=text(req.body?.confirmation||req.query?.confirmation),reportDate=req.body?.reportDate||req.query?.reportDate||'';
  if(text(req.get?.(HEADER))!==CONFIRMATION||confirmation!==CONFIRMATION)return res.status(400).json({ok:false,version:V464_WHPP_OFFLINE_RECOVERY_ID,code:'V464_EXPLICIT_CONFIRMATION_REQUIRED',error:'需要V464显式离线恢复确认。'});
  try{
    const result=repairV464WhppOfflineHistory({reportDate,db:getDb()});
    try{auditAction(req,'WHPP_HISTORY_OFFLINE_RECOVERY',{businessType:'WHPP',reportDate:result.reportDate,snapshotId:result.snapshotId||'',members:Number(result.members||0),version:V464_WHPP_OFFLINE_RECOVERY_ID});}catch(error){console.warn('[CE-QC][V464_AUDIT_LOG_FAILED]',error?.message||error);}
    return res.json(result);
  }catch(error){return res.status(409).json({ok:false,version:V464_WHPP_OFFLINE_RECOVERY_ID,code:error?.code||'V464_RECOVERY_FAILED',error:error?.message||String(error),proof:error?.proof||undefined});}
}
function postHandler(req,res){
  if(!authenticated(req,res))return;
  return sameOriginWriteGuard(req,res,()=>requireOperator(req,res,()=>executePost(req,res)));
}

export function handleV464WhppOfflineRecoveryRequest(req,res,next){
  if(req.path!==V464_WHPP_OFFLINE_RECOVERY_ROUTE)return false;
  if(req.method==='GET'){getHandler(req,res);return true;}
  if(req.method==='POST'){postHandler(req,res);return true;}
  if(typeof next==='function')next();
  return true;
}

console.info('[CE-QC][V464_WHPP_OFFLINE_RECOVERY]',V464_WHPP_OFFLINE_RECOVERY_ID,V464_WHPP_OFFLINE_RECOVERY_ROUTE_ID,'inert proof/repair module; no Express prototype mutation. Exact V464 route is dispatched lazily by the already-authenticated V462 middleware only. POST remains same-origin + OPERATOR guarded, audited, member-locked, transactional and fully offline.');