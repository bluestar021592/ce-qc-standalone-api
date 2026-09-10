import { getDb } from './db.js';
import { ensureV246TrackingSchema, v246InclusiveDays } from './v246TrackingLedgerCore.js';

export const V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID='2026-09-03-v419-canonical-export-ledger-truth-v2';
export const V479_CANONICAL_LEDGER_READ_ID='2026-09-08-v479-primary-key-scalar-ledger-hydration-v1';
export const V493_SCAN85_POD_DATE_RECOVERY_ID='2026-09-09-v493-scan85-saved-terminal-pod-date-v2';
export const V495_SAVED_TERMINAL_EVENT_POD_DATE_ID='2026-09-10-v495-shipment-current-state-terminal-event-pod-date-v1';
const TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const STRICT_TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const LEDGER_CHUNK_SIZE=900;
const text=v=>String(v??'').trim();
const billOf=v=>text(v).toUpperCase();
const dateKey=v=>{const m=text(v).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const safeJson=(value,fallback={})=>{try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}};
const chunks=(values,size=LEDGER_CHUNK_SIZE)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
const positiveAttempt=value=>{const n=Number(value||0);return Number.isFinite(n)&&n>0?Math.min(3,Math.floor(n)):0;};
const terminalPodToken=value=>{const v=text(value).toUpperCase();return v==='POD'||v==='DELIVERED'||v==='SIGNED';};

export function v495SavedTerminalEventPodDate(currentState={}){
  const raw=safeJson(currentState.stateJson,{});
  const terminalProof=terminalPodToken(currentState.state)
    ||terminalPodToken(currentState.apiStatus)
    ||text(currentState.apiStatus)==='85'
    ||text(raw.orderStatus)==='85'
    ||terminalPodToken(raw.state)
    ||terminalPodToken(raw.status)
    ||terminalPodToken(raw.statusCode);
  return terminalProof?dateKey(currentState.lastEventTime):'';
}
function scan85SavedPodDate(ledger={}){
  const direct=dateKey(ledger.savedTerminalPodDate);if(direct)return direct;
  const raw=safeJson(ledger.currentStateJson,{});
  const explicit=[raw.POD时间,raw.podTime,raw.podClosedAt,raw.podAt,raw.deliveredAt,raw.deliveryCompletedAt,raw.签收时间,raw.signTime,raw.signedTime];
  for(const value of explicit){const d=dateKey(value);if(d)return d;}
  if(text(raw.orderStatus)!=='85')return'';
  for(const value of [raw.updateTime,raw.lastUpdateDate,raw.updatedAt,raw.scanTime,raw.statusTime,raw.modifyTime]){const d=dateKey(value);if(d)return d;}
  return'';
}
function strictSigningDays(ledger={},podOverride=''){
  const pod=dateKey(podOverride||ledger.podDate);if(!pod)return 0;
  const evidence=safeJson(ledger.evidenceJson,{}),starts=Array.isArray(evidence?.starts)?evidence.starts:[];
  const first=starts.map(item=>text(item?.time||item?.eventTime||item)).map(dateKey).filter(Boolean).sort()[0]||'';
  return first?(v246InclusiveDays(first,pod)||0):0;
}
function clearPodDerivedTruth(row){
  row.podDate='';row.podTime='';row.podSource='';row.podPriority=99;
  row.attemptNo=0;row.trackAttemptNo=0;row.podAttemptNo=0;row.currentAttemptNo=0;row.attemptSource='';row.attemptEvidenceComplete=false;
  row.signingDays=0;row.deliveryDays=0;row.signingDaysSource='';row.deliveryDaysSource='';row.dispatchSigningEvidenceComplete=false;row.signingEvidenceComplete=false;
}
function applyOpenTruth(row,ledger){
  const raw=safeJson(ledger.currentStateJson,{}),state=text(ledger.currentState),category=text(ledger.currentCategory),evidence=`${state} ${category} ${raw.primaryCategory||''} ${raw.主分类||''} ${raw.异常分类||''}`;
  clearPodDerivedTruth(row);row.pod=false;row.returned=false;row.cancelled=false;
  row.pending=/PENDING/i.test(evidence)||Number(raw.pendingDistinctDayCount||raw.Pending次数||raw.Pending当前次数||raw.Pending天数||raw.pendingDays||0)>0;
  row.delivering=!row.pending&&/DELIVER|派送|派件|ASSIGN/i.test(evidence);
  if(row.pending){row.statusCode='P';row.statusDesc='Pending';}
  else if(row.delivering){row.statusCode='W';row.statusDesc='分配派送中';}
  else{row.statusCode=text(raw.状态标识||row.statusCode);row.statusDesc=category||state||row.statusDesc||'OPEN';}
}
function applyTerminalTruth(type,row,ledger){
  const reason=text(ledger.terminalReason).toUpperCase(),legacyPodTime=text(row.podTime);
  clearPodDerivedTruth(row);
  if(reason==='POD'){
    row.pod=true;row.returned=false;row.cancelled=false;row.pending=false;row.delivering=false;row.statusCode='Y';row.statusDesc='POD';
    const lockedPodDate=dateKey(ledger.podDate),directRecoveredPodDate=lockedPodDate?'':dateKey(ledger.savedTerminalPodDate),recoveredPodDate=lockedPodDate?'':scan85SavedPodDate(ledger),podDate=lockedPodDate||recoveredPodDate;
    row.podDate=podDate;if(podDate)row.podTime=dateKey(legacyPodTime)===podDate?legacyPodTime:podDate;
    if(recoveredPodDate){
      if(directRecoveredPodDate){row.podSource='V495_SAVED_TERMINAL_EVENT_TIME';row.v495SavedTerminalEventPodDateId=V495_SAVED_TERMINAL_EVENT_POD_DATE_ID;}
      else{row.podSource='V493_SCAN85_SAVED_TERMINAL_TIME';row.v493Scan85PodDateRecoveryId=V493_SCAN85_POD_DATE_RECOVERY_ID;}
    }
    const attempt=positiveAttempt(ledger.attemptNo);
    if(attempt){row.attemptNo=attempt;row.trackAttemptNo=attempt;row.podAttemptNo=attempt;row.currentAttemptNo=attempt;row.attemptSource=text(ledger.attemptSource)||'V246_LEDGER';row.attemptEvidenceComplete=true;}
    if(STRICT_TYPES.has(type)){
      const strictDays=strictSigningDays(ledger,podDate);
      if(strictDays>0){row.signingDays=strictDays;row.deliveryDays=strictDays;row.signingDaysSource=directRecoveredPodDate?'V495保存的终态事件时间 + V246严格START→POD':recoveredPodDate?'V493保存的85终态时间 + V246严格START→POD':'V246严格START→POD';row.deliveryDaysSource=row.signingDaysSource;row.dispatchSigningEvidenceComplete=true;row.signingEvidenceComplete=true;}
    }else if(Number(ledger.signingDays||0)>0){
      row.signingDays=Number(ledger.signingDays);row.deliveryDays=Number(ledger.signingDays);row.signingDaysSource='V246首次日报→POD';row.deliveryDaysSource=row.signingDaysSource;row.signingEvidenceComplete=true;
    }
    return;
  }
  row.pod=false;row.pending=false;row.delivering=false;
  if(reason==='RETURNED'){
    row.returned=true;row.cancelled=false;row.statusCode='R';row.statusDesc='RETURNED';
  }else if(reason==='ORDER_CANCELLED'){
    row.returned=false;row.cancelled=true;row.statusCode='N';row.statusDesc='ORDER_CANCELLED';
  }else{
    row.returned=false;row.cancelled=false;row.statusDesc=text(ledger.currentCategory||ledger.currentState||reason||row.statusDesc);
  }
}
function jsonColumnByBill(db,bills,column){
  const allowed=column==='currentStateJson'?'currentStateJson':column==='evidenceJson'?'evidenceJson':'';
  const out=new Map();if(!allowed||!bills.length)return out;
  for(const part of chunks(bills)){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;
    let rows=[];try{rows=db.prepare(`SELECT shipmentCode,${allowed} AS jsonValue FROM qc_tracking_ledger WHERE shipmentCode IN (${marks})`).all(...part);}catch{rows=[];}
    for(const row of rows)out.set(billOf(row.shipmentCode),row.jsonValue);
  }
  return out;
}
function shipmentCurrentStateByBill(db,bills){
  const out=new Map();if(!bills.length)return out;
  for(const part of chunks(bills)){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;
    let rows=[];
    try{rows=db.prepare(`SELECT shipmentCode,state,apiStatus,lastEventCode,lastEventTime,stateJson FROM shipment_current_state WHERE shipmentCode IN (${marks})`).all(...part);}
    catch{
      try{rows=db.prepare(`SELECT shipmentCode,stateJson FROM shipment_current_state WHERE shipmentCode IN (${marks})`).all(...part);}catch{rows=[];}
    }
    for(const row of rows){const code=billOf(row.shipmentCode);if(code)out.set(code,row);}
  }
  return out;
}

export function applyV419CanonicalExportLedgerTruth(businessType,rows=[],{db=getDb(),onProgress=()=>{}}={}){
  const type=text(businessType).toUpperCase();
  if(!TYPES.has(type)||!Array.isArray(rows)||!rows.length)return rows;
  ensureV246TrackingSchema(db);
  const byBill=new Map();
  for(const row of rows){const bill=billOf(row?.shipmentCode||row?.运单号);if(!bill)continue;if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(row);}
  const bills=[...byBill.keys()];
  let matched=0,terminal=0,pod=0,returned=0,open=0,attemptLocked=0,processed=0,openJsonRows=0,strictEvidenceRows=0,scan85PodDateRows=0,terminalStateFallbackRows=0,savedTerminalEventPodDateRows=0;
  onProgress({phase:'hydrateLedgerTruth',completed:0,total:bills.length,entries:bills.length,source:V479_CANONICAL_LEDGER_READ_ID,batchSize:LEDGER_CHUNK_SIZE});
  for(const part of chunks(bills)){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;
    let ledger=[];
    try{
      ledger=db.prepare(`SELECT shipmentCode,businessType,trackingStatus,terminalReason,currentState,currentCategory,podDate,attemptNo,attemptSource,signingDays,lastEventTime,lastCheckedAt FROM qc_tracking_ledger WHERE shipmentCode IN (${marks})`).all(...part)
        .filter(locked=>text(locked.businessType).toUpperCase()===type);
    }catch{ledger=[];}
    const openBills=ledger.filter(locked=>!(text(locked.trackingStatus).toUpperCase()==='TERMINAL'&&text(locked.terminalReason))).map(locked=>billOf(locked.shipmentCode)).filter(Boolean);
    const strictPodBills=STRICT_TYPES.has(type)?ledger.filter(locked=>text(locked.trackingStatus).toUpperCase()==='TERMINAL'&&text(locked.terminalReason).toUpperCase()==='POD').map(locked=>billOf(locked.shipmentCode)).filter(Boolean):[];
    const strictMissingPodDateBills=STRICT_TYPES.has(type)?ledger.filter(locked=>text(locked.trackingStatus).toUpperCase()==='TERMINAL'&&text(locked.terminalReason).toUpperCase()==='POD'&&!dateKey(locked.podDate)).map(locked=>billOf(locked.shipmentCode)).filter(Boolean):[];
    const currentStateBills=[...new Set([...openBills,...strictMissingPodDateBills])];
    const currentJson=jsonColumnByBill(db,currentStateBills,'currentStateJson');
    const stillMissingSavedTerminal=strictMissingPodDateBills.filter(code=>!scan85SavedPodDate({currentStateJson:currentJson.get(code)}));
    const stateFallback=shipmentCurrentStateByBill(db,stillMissingSavedTerminal),savedTerminalPodDate=new Map();
    for(const code of stillMissingSavedTerminal){
      const candidate=stateFallback.get(code);if(!candidate)continue;
      const directPodDate=v495SavedTerminalEventPodDate(candidate);
      if(directPodDate){savedTerminalPodDate.set(code,directPodDate);terminalStateFallbackRows+=1;continue;}
      if(text(candidate.stateJson)&&scan85SavedPodDate({currentStateJson:candidate.stateJson})){currentJson.set(code,candidate.stateJson);terminalStateFallbackRows+=1;}
    }
    const evidenceJson=jsonColumnByBill(db,strictPodBills,'evidenceJson');
    openJsonRows+=currentJson.size;strictEvidenceRows+=evidenceJson.size;
    for(const locked of ledger){
      const bill=billOf(locked.shipmentCode),members=byBill.get(bill)||[];if(!members.length)continue;
      if(currentJson.has(bill))locked.currentStateJson=currentJson.get(bill);
      if(savedTerminalPodDate.has(bill))locked.savedTerminalPodDate=savedTerminalPodDate.get(bill);
      if(evidenceJson.has(bill))locked.evidenceJson=evidenceJson.get(bill);
      const directRecoveredBeforeApply=!dateKey(locked.podDate)&&Boolean(dateKey(locked.savedTerminalPodDate));
      const recoveredBeforeApply=!dateKey(locked.podDate)&&Boolean(scan85SavedPodDate(locked));
      matched+=members.length;
      for(const row of members){
        if(text(locked.trackingStatus).toUpperCase()==='TERMINAL'&&text(locked.terminalReason)){
          applyTerminalTruth(type,row,locked);terminal+=1;if(text(locked.terminalReason).toUpperCase()==='POD')pod+=1;if(text(locked.terminalReason).toUpperCase()==='RETURNED')returned+=1;
        }else{applyOpenTruth(row,locked);open+=1;}
        if(row.pod&&positiveAttempt(locked.attemptNo))attemptLocked+=1;
        if(recoveredBeforeApply&&row.podDate)scan85PodDateRows+=1;
        if(directRecoveredBeforeApply&&row.podDate)savedTerminalEventPodDateRows+=1;
        row.currentState=text(locked.currentState)||row.currentState;
        row.primaryCategory=text(locked.currentCategory)||row.primaryCategory;
        row.v419CanonicalExportTruthId=V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID;
        row.v419LedgerLastCheckedAt=text(locked.lastCheckedAt);
        if(row.evidence?.add)row.evidence.add('V246 canonical ledger');
      }
    }
    processed+=part.length;
    onProgress({phase:'hydrateLedgerTruth',completed:Math.min(processed,bills.length),total:bills.length,entries:bills.length,matched,terminal,pod,returned,open,attemptLocked,openJsonRows,strictEvidenceRows,scan85PodDateRows,terminalStateFallbackRows,savedTerminalEventPodDateRows,source:V479_CANONICAL_LEDGER_READ_ID,batchSize:LEDGER_CHUNK_SIZE,podDateRecovery:V493_SCAN85_POD_DATE_RECOVERY_ID,terminalEventPodDateRecovery:V495_SAVED_TERMINAL_EVENT_POD_DATE_ID});
  }
  Object.defineProperty(rows,'v419CanonicalExportDiagnostics',{value:{id:V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID,readId:V479_CANONICAL_LEDGER_READ_ID,podDateRecoveryId:V493_SCAN85_POD_DATE_RECOVERY_ID,terminalEventPodDateRecoveryId:V495_SAVED_TERMINAL_EVENT_POD_DATE_ID,type,rows:rows.length,matched,terminal,pod,returned,open,attemptLocked,openJsonRows,strictEvidenceRows,scan85PodDateRows,terminalStateFallbackRows,savedTerminalEventPodDateRows,ledgerChunkSize:LEDGER_CHUNK_SIZE,primaryKeyOnly:true},enumerable:false,configurable:true});
  return rows;
}

console.info('[CE-QC][V495_SAVED_TERMINAL_EVENT_POD_DATE]',V495_SAVED_TERMINAL_EVENT_POD_DATE_ID,'strict POD rows with blank canonical podDate may recover only from shipment_current_state.lastEventTime when saved state/apiStatus/stateJson explicitly proves POD (POD/DELIVERED/SIGNED or orderStatus/apiStatus=85); shipment_current_state.updatedAt and export time are never used.');
console.info('[CE-QC][V493_EXPORT_POD_DATE_RECOVERY]',V493_SCAN85_POD_DATE_RECOVERY_ID,'formal export reads local saved state only for strict POD rows whose canonical podDate is blank: qc_tracking_ledger.currentStateJson first, shipment_current_state fallback second; orderStatus=85 may recover POD date only from saved terminal timestamps such as updateTime/lastUpdateDate, never from export time or lastCheckedAt.');
console.info('[CE-QC][V419_EXPORT_LEDGER_TRUTH]',V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID,V479_CANONICAL_LEDGER_READ_ID,'daily membership stays historical; export hydration uses shipmentCode primary-key scalar reads, with JSON fetched only for OPEN or strict POD evidence/recovery gaps.');