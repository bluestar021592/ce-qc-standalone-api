import crypto from 'node:crypto';
import { getDb, nowIso } from './db.js';
import { buildWhppDashboard } from './whppReporting.js';

export const V92_WHPP_TERMINAL_AUTHORITY_ID='2026-08-13-v92-whpp-terminal-authority-v1';
const WHPP='WHPP';
const text=v=>String(v??'').trim();
const upper=v=>text(v).toUpperCase();
const billOf=r=>upper(r?.shipmentCode||r?.运单号||r?.waybill||'');
function json(v,f={}){try{return v&&typeof v==='object'?v:JSON.parse(String(v||''))||f;}catch{return f;}}
function uniq(a=[]){return [...new Set(a.map(text).filter(Boolean))];}

export function resolveWhppTerminalEvidence({scanRow={},latestEvent=null}={}){
  const s=text(scanRow?.orderStatus), code=text(latestEvent?.eventCode);
  const at=text(scanRow?.lastUpdateDate||scanRow?.creationDate||scanRow?.updatedAt||latestEvent?.eventTime);
  if(s==='85')return{terminal:'POD',source:'SCAN_85',observedAt:at,orderStatus:s,eventCode:code};
  if(s==='100')return{terminal:'RETURNED',source:'SCAN_100',observedAt:at,orderStatus:s,eventCode:code};
  if(s==='10')return{terminal:'ORDER_CANCELLED',source:'SCAN_10',observedAt:at,orderStatus:s,eventCode:code};
  if(code==='80')return{terminal:'POD',source:'TRACK_80',observedAt:text(latestEvent?.eventTime),orderStatus:s,eventCode:code};
  if(code==='86')return{terminal:'RETURNED',source:'TRACK_86',observedAt:text(latestEvent?.eventTime),orderStatus:s,eventCode:code};
  return null;
}

export function applyWhppTerminalAuthority(row={},evidence=null){
  if(!evidence?.terminal)return{...row};
  const tags=new Set(Array.isArray(row.tags)?row.tags:[]); tags.add('WHPP_TERMINAL_AUTHORITY'); tags.add(evidence.source);
  const common={...row,terminalAuthority:true,terminalAuthoritySource:evidence.source,terminalObservedAt:evidence.observedAt||row.terminalObservedAt||row.latestEventTime||'',trackRequired:false,跨日状态:'已闭环',Pending状态:'否',Pending次数:0,Pending当前次数:0,pendingDistinctDayCount:0,Pending日期:'',Pending连续:'否',Pending连续性:'',Pending不连续:'否',OC状态:'否',OC天数:0,盘点状态:'否',盘点天数:0,入库无扫描节点:'否',无轨迹:'否',returnRequired:false,退回待处理:'否',tags:[...tags]};
  if(evidence.terminal==='POD')return{...common,currentState:'POD',scanNormalizedState:evidence.source==='SCAN_85'?'POD':(common.scanNormalizedState||''),primaryCategory:'POD',主分类:'POD',异常分类:'POD',是否POD:'是',POD状态:'POD',退回状态:'未退回',订单取消:'否',取消状态:'',trackSkippedReason:'POD_COMPLETED',carry状态:'closed_pod',QC判断:`WHPP终态闭环：${evidence.source==='SCAN_85'?'扫描orderStatus=85已签收':'最新轨迹eventCode=80已签收'}`};
  if(evidence.terminal==='RETURNED')return{...common,currentState:'RETURN_COMPLETED',scanNormalizedState:evidence.source==='SCAN_100'?'RETURN_COMPLETED':(common.scanNormalizedState||''),primaryCategory:'退回',主分类:'退回',异常分类:'退回',是否POD:'否',POD状态:'未POD',退回状态:'已退回',订单取消:'否',取消状态:'',trackSkippedReason:'RETURN_COMPLETED',carry状态:'closed_return',QC判断:`WHPP终态闭环：${evidence.source==='SCAN_100'?'扫描orderStatus=100已退回':'最新轨迹eventCode=86已退回'}`};
  return{...common,currentState:'ORDER_CANCELLED',scanNormalizedState:'ORDER_CANCELLED',primaryCategory:'订单取消',主分类:'订单取消',异常分类:'订单取消',是否POD:'否',POD状态:'未POD',退回状态:'未退回',订单取消:'是',取消状态:'已取消',trackSkippedReason:'ORDER_CANCELLED',carry状态:'closed_cancelled',QC判断:'WHPP终态闭环：扫描orderStatus=10订单取消'};
}

function scans(db){return new Map(db.prepare("SELECT reportDate,shipmentCode,orderStatus,rawJson FROM business_scan_results WHERE businessType='WHPP'").all().map(r=>[`${r.reportDate}|${upper(r.shipmentCode)}`,{...json(r.rawJson,{}),...r}]));}
function latestEvents(db){
  const rows=db.prepare(`SELECT e.reportDate,e.shipmentCode,e.eventTime,e.eventCode,e.rawJson FROM business_track_events e WHERE e.businessType='WHPP' AND NOT EXISTS(SELECT 1 FROM business_track_events n WHERE n.businessType=e.businessType AND n.reportDate=e.reportDate AND n.shipmentCode=e.shipmentCode AND (COALESCE(n.eventTime,'')>COALESCE(e.eventTime,'') OR (COALESCE(n.eventTime,'')=COALESCE(e.eventTime,'') AND n.id>e.id)))`).all();
  return new Map(rows.map(r=>[`${r.reportDate}|${upper(r.shipmentCode)}`,{...json(r.rawJson,{}),...r}]));
}
function stateForDate(db,date,snapshotId=''){
  const daily=db.prepare("SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY id").all(date).map(r=>({...json(r.rowJson,{}),shipmentCode:upper(r.shipmentCode),businessType:WHPP,reportDate:date}));
  const finals=db.prepare("SELECT shipmentCode,rawJson FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode").all(date).map(r=>({...json(r.rawJson,{}),shipmentCode:upper(r.shipmentCode),businessType:WHPP,reportDate:date}));
  return{businessType:WHPP,reportDate:date,snapshotId,pnhBills:daily.map(billOf),dailyParseRows:daily,finalRows:finals};
}
function writeCorrectedSnapshot(db,date,state,dashboard,count,now){
  const snapshotId=`WHPP-V92-${date}-${crypto.randomUUID()}`;
  const compact={...state,snapshotId,snapshotStatus:'COMPLETED',terminalAuthorityVersion:V92_WHPP_TERMINAL_AUTHORITY_ID};
  const payload={state:compact,dashboard:{...dashboard,snapshotId},status:'VALID',reconciliationStatus:'COMPLETED',repair:{patchId:V92_WHPP_TERMINAL_AUTHORITY_ID,repairedTerminalRows:count,generatedAt:now}};
  db.prepare('INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,payloadJson,generatedAt,createdAt) VALUES(?,?,?,?,?,?,?)').run(snapshotId,WHPP,date,'V92_TERMINAL_AUTHORITY',JSON.stringify(payload),now,now);
  db.prepare('INSERT INTO business_history_summary(businessType,reportDate,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt').run(WHPP,date,JSON.stringify({...dashboard.metrics,accounting:dashboard.accounting,snapshotId,terminalAuthorityVersion:V92_WHPP_TERMINAL_AUTHORITY_ID}),now,now);
  return snapshotId;
}

export function repairWhppTerminalAuthority(db=getDb()){
  const finals=db.prepare("SELECT reportDate,shipmentCode,rawJson,isPod,primaryCategory,carryStatus FROM business_final_rows WHERE businessType='WHPP'").all();
  const scan=scans(db), events=latestEvents(db), repairs=[];
  for(const stored of finals){
    const bill=upper(stored.shipmentCode), key=`${stored.reportDate}|${bill}`;
    const evidence=resolveWhppTerminalEvidence({scanRow:scan.get(key)||{},latestEvent:events.get(key)||null});
    if(!evidence)continue;
    const before={...json(stored.rawJson,{}),shipmentCode:bill,reportDate:stored.reportDate,businessType:WHPP};
    const corrected=applyWhppTerminalAuthority(before,evidence);
    const terminalNow=upper(before.currentState);
    const already=evidence.terminal==='POD'?(Number(stored.isPod||0)===1&&terminalNow==='POD'):evidence.terminal==='RETURNED'?(['RETURNED','RETURN_COMPLETED'].includes(terminalNow)&&upper(stored.primaryCategory)==='退回'):(terminalNow==='ORDER_CANCELLED'&&upper(stored.primaryCategory)==='订单取消');
    if(!already||before.Pending次数||before.Pending当前次数||before.OC天数||before.盘点天数||before.跨日状态!=='已闭环')repairs.push({stored,bill,evidence,corrected});
  }
  if(!repairs.length)return{patchId:V92_WHPP_TERMINAL_AUTHORITY_ID,scanned:finals.length,repaired:0,affectedDates:[],affectedBills:[]};
  const now=nowIso(), dates=uniq(repairs.map(x=>x.stored.reportDate));
  db.exec('BEGIN IMMEDIATE');
  try{
    const finalStmt=db.prepare("UPDATE business_final_rows SET isPod=?,primaryCategory=?,apiStatus='SUCCESS',carryStatus=?,latestEventTime=?,rawJson=?,updatedAt=? WHERE businessType='WHPP' AND reportDate=? AND shipmentCode=?");
    const currentStmt=db.prepare("UPDATE shipment_current_state SET businessType='WHPP',reportDate=?,state=?,apiStatus='SUCCESS',lastEventTime=?,stateJson=?,updatedAt=? WHERE shipmentCode=?");
    const carryStmt=db.prepare("UPDATE carryover_open_items SET businessType='WHPP',lastReportDate=?,status='CLOSED',apiStatus='SUCCESS',closeReason=?,stateJson=?,updatedAt=? WHERE shipmentCode=?");
    const legacyCarry=db.prepare("UPDATE business_carry_bills SET status=?,primaryCategory=?,retryStatus='',reason=?,rawJson=?,updatedAt=? WHERE businessType='WHPP' AND shipmentCode=? AND status='active'");
    const podLock=db.prepare("INSERT INTO business_pod_locks(businessType,shipmentCode,podTime,source,createdAt,updatedAt) VALUES('WHPP',?,?,'V92_TERMINAL_AUTHORITY',?,?) ON CONFLICT(businessType,shipmentCode) DO UPDATE SET podTime=excluded.podTime,source=excluded.source,updatedAt=excluded.updatedAt");
    for(const x of repairs){
      const t=x.evidence.terminal, cat=t==='POD'?'POD':t==='RETURNED'?'退回':'订单取消', carry=t==='POD'?'closed_pod':t==='RETURNED'?'closed_return':'closed_cancelled', at=x.evidence.observedAt||x.corrected.latestEventTime||'', raw=JSON.stringify(x.corrected);
      finalStmt.run(t==='POD'?1:0,cat,carry,at,raw,now,x.stored.reportDate,x.bill);
      currentStmt.run(x.stored.reportDate,t,at,raw,now,x.bill);
      carryStmt.run(x.stored.reportDate,t,raw,now,x.bill);
      legacyCarry.run(carry,cat,x.corrected.QC判断||'',raw,now,x.bill);
      if(t==='POD'){podLock.run(x.bill,at,now,now);db.prepare("UPDATE business_scan_results SET isPod=1,updatedAt=? WHERE businessType='WHPP' AND reportDate=? AND shipmentCode=? AND orderStatus='85'").run(now,x.stored.reportDate,x.bill);}
    }
    for(const date of dates){const state=stateForDate(db,date), dashboard=buildWhppDashboard(state);writeCorrectedSnapshot(db,date,state,dashboard,repairs.filter(x=>x.stored.reportDate===date).length,now);}
    const stateRow=db.prepare("SELECT valueJson FROM business_states WHERE businessType='WHPP'").get();
    if(stateRow?.valueJson){const current=json(stateRow.valueJson,{}), date=text(current.reportDate);if(dates.includes(date)){const st=stateForDate(db,date,current.snapshotId||'');const active=st.finalRows.filter(r=>!['POD','RETURN_COMPLETED','RETURNED','ORDER_CANCELLED'].includes(upper(r.currentState))).map(billOf);const pods=st.finalRows.filter(r=>upper(r.currentState)==='POD'||r.是否POD==='是').map(billOf);const updated={...current,finalRows:st.finalRows,trackResults:st.finalRows,carryBills:active,nextCarryBills:active,podLocks:uniq([...(current.podLocks||[]),...pods]),terminalAuthorityVersion:V92_WHPP_TERMINAL_AUTHORITY_ID};db.prepare("UPDATE business_states SET valueJson=?,updatedAt=? WHERE businessType='WHPP'").run(JSON.stringify(updated),now);}}
    db.prepare('INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt').run('v92_whpp_terminal_authority_last_run',JSON.stringify({patchId:V92_WHPP_TERMINAL_AUTHORITY_ID,scanned:finals.length,repaired:repairs.length,affectedDates:dates,runAt:now}),now);
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  return{patchId:V92_WHPP_TERMINAL_AUTHORITY_ID,scanned:finals.length,repaired:repairs.length,affectedDates:dates,affectedBills:uniq(repairs.map(x=>x.bill))};
}
