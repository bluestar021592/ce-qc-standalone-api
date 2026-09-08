import { getDb } from './db.js';
import { ensureV246TrackingSchema, v246InclusiveDays } from './v246TrackingLedgerCore.js';

export const V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID='2026-09-03-v419-canonical-export-ledger-truth-v2';
export const V479_CANONICAL_LEDGER_READ_ID='2026-09-08-v479-primary-key-scalar-ledger-hydration-v1';
const TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const STRICT_TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const LEDGER_CHUNK_SIZE=900;
const text=v=>String(v??'').trim();
const billOf=v=>text(v).toUpperCase();
const dateKey=v=>{const m=text(v).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const safeJson=(value,fallback={})=>{try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}};
const chunks=(values,size=LEDGER_CHUNK_SIZE)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
const positiveAttempt=value=>{const n=Number(value||0);return Number.isFinite(n)&&n>0?Math.min(3,Math.floor(n)):0;};

function strictSigningDays(ledger={}){
  const pod=dateKey(ledger.podDate);if(!pod)return 0;
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
    const podDate=dateKey(ledger.podDate);row.podDate=podDate;if(podDate)row.podTime=dateKey(legacyPodTime)===podDate?legacyPodTime:podDate;
    const attempt=positiveAttempt(ledger.attemptNo);
    if(attempt){row.attemptNo=attempt;row.trackAttemptNo=attempt;row.podAttemptNo=attempt;row.currentAttemptNo=attempt;row.attemptSource=text(ledger.attemptSource)||'V246_LEDGER';row.attemptEvidenceComplete=true;}
    if(STRICT_TYPES.has(type)){
      const strictDays=strictSigningDays(ledger);
      if(strictDays>0){row.signingDays=strictDays;row.deliveryDays=strictDays;row.signingDaysSource='V246严格START→POD';row.deliveryDaysSource=row.signingDaysSource;row.dispatchSigningEvidenceComplete=true;row.signingEvidenceComplete=true;}
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

export function applyV419CanonicalExportLedgerTruth(businessType,rows=[],{db=getDb(),onProgress=()=>{}}={}){
  const type=text(businessType).toUpperCase();
  if(!TYPES.has(type)||!Array.isArray(rows)||!rows.length)return rows;
  ensureV246TrackingSchema(db);
  const byBill=new Map();
  for(const row of rows){const bill=billOf(row?.shipmentCode||row?.运单号);if(!bill)continue;if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(row);}
  const bills=[...byBill.keys()];
  let matched=0,terminal=0,pod=0,returned=0,open=0,attemptLocked=0,processed=0,openJsonRows=0,strictEvidenceRows=0;
  onProgress({phase:'hydrateCurrentTruth',completed:0,total:bills.length,entries:bills.length,source:V479_CANONICAL_LEDGER_READ_ID,batchSize:LEDGER_CHUNK_SIZE});
  for(const part of chunks(bills)){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;
    let ledger=[];
    try{
      ledger=db.prepare(`SELECT shipmentCode,businessType,trackingStatus,terminalReason,currentState,currentCategory,podDate,attemptNo,attemptSource,signingDays,lastEventTime,lastCheckedAt FROM qc_tracking_ledger WHERE shipmentCode IN (${marks})`).all(...part)
        .filter(locked=>text(locked.businessType).toUpperCase()===type);
    }catch{ledger=[];}
    const openBills=ledger.filter(locked=>!(text(locked.trackingStatus).toUpperCase()==='TERMINAL'&&text(locked.terminalReason))).map(locked=>billOf(locked.shipmentCode)).filter(Boolean);
    const strictPodBills=STRICT_TYPES.has(type)?ledger.filter(locked=>text(locked.trackingStatus).toUpperCase()==='TERMINAL'&&text(locked.terminalReason).toUpperCase()==='POD').map(locked=>billOf(locked.shipmentCode)).filter(Boolean):[];
    const currentJson=jsonColumnByBill(db,openBills,'currentStateJson');
    const evidenceJson=jsonColumnByBill(db,strictPodBills,'evidenceJson');
    openJsonRows+=currentJson.size;strictEvidenceRows+=evidenceJson.size;
    for(const locked of ledger){
      const bill=billOf(locked.shipmentCode),members=byBill.get(bill)||[];if(!members.length)continue;
      if(currentJson.has(bill))locked.currentStateJson=currentJson.get(bill);
      if(evidenceJson.has(bill))locked.evidenceJson=evidenceJson.get(bill);
      matched+=members.length;
      for(const row of members){
        if(text(locked.trackingStatus).toUpperCase()==='TERMINAL'&&text(locked.terminalReason)){
          applyTerminalTruth(type,row,locked);terminal+=1;if(text(locked.terminalReason).toUpperCase()==='POD')pod+=1;if(text(locked.terminalReason).toUpperCase()==='RETURNED')returned+=1;
        }else{applyOpenTruth(row,locked);open+=1;}
        if(row.pod&&positiveAttempt(locked.attemptNo))attemptLocked+=1;
        row.currentState=text(locked.currentState)||row.currentState;
        row.primaryCategory=text(locked.currentCategory)||row.primaryCategory;
        row.v419CanonicalExportTruthId=V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID;
        row.v419LedgerLastCheckedAt=text(locked.lastCheckedAt);
        if(row.evidence?.add)row.evidence.add('V246 canonical ledger');
      }
    }
    processed+=part.length;
    onProgress({phase:'hydrateCurrentTruth',completed:Math.min(processed,bills.length),total:bills.length,entries:bills.length,matched,terminal,pod,returned,open,attemptLocked,openJsonRows,strictEvidenceRows,source:V479_CANONICAL_LEDGER_READ_ID,batchSize:LEDGER_CHUNK_SIZE});
  }
  Object.defineProperty(rows,'v419CanonicalExportDiagnostics',{value:{id:V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID,readId:V479_CANONICAL_LEDGER_READ_ID,type,rows:rows.length,matched,terminal,pod,returned,open,attemptLocked,openJsonRows,strictEvidenceRows,ledgerChunkSize:LEDGER_CHUNK_SIZE,primaryKeyOnly:true},enumerable:false,configurable:true});
  return rows;
}

console.info('[CE-QC][V419_EXPORT_LEDGER_TRUTH]',V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID,V479_CANONICAL_LEDGER_READ_ID,'daily membership stays historical; export hydration uses shipmentCode primary-key scalar reads, with JSON fetched only for OPEN or strict POD evidence.');
