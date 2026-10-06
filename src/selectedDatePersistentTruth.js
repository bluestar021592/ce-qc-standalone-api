const dateKey=v=>{const s=String(v||'').trim().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const safeJson=(v,fallback={})=>{try{return v&&typeof v==='object'?v:(JSON.parse(String(v||''))||fallback)}catch{return fallback}};

export function persistentSelectedDatePodBills(db,businessType='',reportDate=''){
  const type=String(businessType||'').trim().toUpperCase(),date=dateKey(reportDate);
  if(!date)return[];
  let owner='',group='';
  if(type==='WHPP')owner='WHPP';
  else if(type==='SHOPEECN'){owner='SHOPEE';group='CN';}
  else if(type==='SHOPEEVN'){owner='SHOPEE';group='VN';}
  else return[];
  try{
    const sql=`SELECT UPPER(TRIM(shipmentCode)) shipmentCode
      FROM business_final_rows
      WHERE businessType=? AND reportDate=? AND COALESCE(isPod,0)=1
      ${group?"AND UPPER(TRIM(COALESCE(recipient_group,'')))=?":''}
      GROUP BY UPPER(TRIM(shipmentCode))
      ORDER BY shipmentCode`;
    const rows=group?db.prepare(sql).all(owner,date,group):db.prepare(sql).all(owner,date);
    return rows.map(row=>String(row.shipmentCode||'').trim().toUpperCase()).filter(Boolean);
  }catch{return[]}
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
  try{sourceCount=Number(db.prepare("SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) count FROM unified_import_rows WHERE reportDate=? AND UPPER(TRIM(businessType))='WHPP'").get(date)?.count||0)}catch{}

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
