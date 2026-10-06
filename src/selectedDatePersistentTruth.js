const dateKey=v=>{const s=String(v||'').trim().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const safeJson=(v,fallback={})=>{try{return v&&typeof v==='object'?v:(JSON.parse(String(v||''))||fallback)}catch{return fallback}};

function persistedPod(row={}){
  if(Number(row.isPod||0)===1)return true;
  const raw=safeJson(row.rawJson,{});
  const state=String(raw.currentState||raw.scanNormalizedState||raw.POD状态||'').trim().toUpperCase();
  return state==='POD'||String(raw.orderStatus||'').trim()==='85'||raw.是否POD==='是';
}
function persistedGroup(row={}){
  const raw=safeJson(row.rawJson,{});
  return String(row.recipient_group||raw.recipient_group||raw.recipientGroup||'').trim().toUpperCase();
}
function latestValidBatchId(db,date){
  try{return String(db.prepare("SELECT batchId FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,rowid DESC LIMIT 1").get(date)?.batchId||'')}
  catch{return''}
}
function sourceBills(db,businessType,date){
  try{
    const batchId=latestValidBatchId(db,date);
    if(!batchId)return new Set();
    return new Set(db.prepare("SELECT UPPER(TRIM(shipmentCode)) shipmentCode FROM unified_import_rows WHERE batchId=? AND reportDate=? AND UPPER(TRIM(businessType))=? GROUP BY UPPER(TRIM(shipmentCode))").all(batchId,date,businessType).map(row=>String(row.shipmentCode||'').trim().toUpperCase()).filter(Boolean));
  }catch{return new Set()}
}

export function persistentSelectedDatePodTruth(db,businessType='',reportDate=''){
  const type=String(businessType||'').trim().toUpperCase(),date=dateKey(reportDate);
  if(!date)return{authoritative:false,bills:[],sourceCount:0,resolvedCount:0};
  let owner='',group='',sourceType='';
  if(type==='WHPP'){owner='WHPP';sourceType='WHPP';}
  else if(type==='SHOPEECN'){owner='SHOPEE';group='CN';sourceType='SHOPEECN';}
  else if(type==='SHOPEEVN'){owner='SHOPEE';group='VN';sourceType='SHOPEEVN';}
  else return{authoritative:false,bills:[],sourceCount:0,resolvedCount:0};
  try{
    const source=sourceBills(db,sourceType,date);
    const rows=db.prepare(`SELECT shipmentCode,isPod,recipient_group,rawJson
      FROM business_final_rows
      WHERE businessType=? AND reportDate=?
      ORDER BY shipmentCode`).all(owner,date);
    const resolved=new Set(),pod=new Set();
    for(const row of rows){
      const bill=String(row.shipmentCode||'').trim().toUpperCase();
      if(!bill||!source.has(bill))continue;
      if(group&&persistedGroup(row)!==group)continue;
      resolved.add(bill);
      if(persistedPod(row))pod.add(bill);
    }
    return{authoritative:source.size>0&&resolved.size===source.size,bills:[...pod],sourceCount:source.size,resolvedCount:resolved.size};
  }catch{return{authoritative:false,bills:[],sourceCount:0,resolvedCount:0}}
}
export function persistentSelectedDatePodBills(db,businessType='',reportDate=''){
  return persistentSelectedDatePodTruth(db,businessType,reportDate).bills;
}

export function persistentWhppCompletionTruth(db,reportDate=''){
  const date=dateKey(reportDate);
  if(!date)return{locked:false,reportDate:'',reason:'REPORT_DATE_MISSING',sourceCount:0,finalCount:0};
  let daily=null,history=null,snapshot=null,finalCount=0,sourceCount=0;
  try{daily=db.prepare("SELECT totalCount,summaryJson,updatedAt FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)||null}catch{}
  try{history=db.prepare("SELECT summaryJson,updatedAt FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)||null}catch{}
  try{snapshot=db.prepare(`SELECT snapshotId,generatedAt,createdAt
      FROM business_export_snapshots
      WHERE businessType='WHPP' AND reportDate=?
        AND COALESCE(status,'VALID')='VALID'
        AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'
      ORDER BY createdAt DESC LIMIT 1`).get(date)||null}catch{}
  try{finalCount=Number(db.prepare("SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) count FROM business_final_rows WHERE businessType='WHPP' AND reportDate=?").get(date)?.count||0)}catch{}
  try{const batchId=latestValidBatchId(db,date);sourceCount=batchId?Number(db.prepare("SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) count FROM unified_import_rows WHERE batchId=? AND reportDate=? AND UPPER(TRIM(businessType))='WHPP'").get(batchId,date)?.count||0):0}catch{}

  const dailySummary=safeJson(daily?.summaryJson,{});
  const historySummary=safeJson(history?.summaryJson,{});
  const membershipMatches=finalCount>0&&(!sourceCount||finalCount===sourceCount);
  const snapshotLocked=Boolean(snapshot?.snapshotId);
  const dailyLocked=Boolean(dailySummary.completed===true&&['COMPLETED','COMPLETED_WITH_RETRY'].includes(String(dailySummary.snapshotStatus||dailySummary.reconciliationStatus||'').toUpperCase()));
  const historyBalanced=Boolean(history&&(historySummary.accounting?.balanced===true||Number(historySummary.total||historySummary.accounting?.total||0)>0));
  const historyLocked=historyBalanced&&membershipMatches;
  const locked=membershipMatches&&(snapshotLocked||dailyLocked||historyLocked);

  return{
    locked,finalized:locked,reportDate:date,sourceCount,finalCount,
    snapshotLocked,dailyLocked,historyLocked,membershipMatches,
    snapshotId:String(snapshot?.snapshotId||dailySummary.finalizedSnapshotId||historySummary.snapshotId||''),
    finalizedAt:String(dailySummary.finalizedAt||snapshot?.generatedAt||snapshot?.createdAt||history?.updatedAt||''),
    completionSource:snapshotLocked?'IMMUTABLE_EXPORT_SNAPSHOT':dailyLocked?'DAILY_SUMMARY':historyLocked?'FINAL_ROWS_HISTORY':'',
    reason:locked?'PERSISTED_WHPP_COMPLETED':sourceCount&&finalCount!==sourceCount?'SOURCE_FINAL_MEMBERSHIP_MISMATCH':'PERSISTED_WHPP_INCOMPLETE'
  };
}
