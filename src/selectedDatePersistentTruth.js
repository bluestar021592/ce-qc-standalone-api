import { loadWhppCanonicalTruth } from './whppCanonicalTruth.js';

const dateKey=v=>{const s=String(v||'').trim().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const safeJson=(v,fallback={})=>{try{return v&&typeof v==='object'?v:(JSON.parse(String(v||''))||fallback)}catch{return fallback}};

function latestValidBatch(db,date){
  try{return db.prepare("SELECT batchId,snapshotId,reportDate FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,rowid DESC LIMIT 1").get(date)||null}
  catch{return null}
}
function latestValidBatchId(db,date){return String(latestValidBatch(db,date)?.batchId||'')}

function billOf(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase()}
function uniqueBills(rows=[]){return [...new Set((rows||[]).map(billOf).filter(Boolean))].sort()}
function sameBills(a=[],b=[]){
  const left=[...new Set(a)].sort(),right=[...new Set(b)].sort();
  return left.length===right.length&&left.every((value,index)=>value===right[index]);
}
function completedShopeeSnapshotPodTruth(db,date,group,sourceRows=[]){
  const sourceBills=uniqueBills(sourceRows);
  if(!sourceBills.length)return null;
  let snapshots=[];
  try{
    snapshots=db.prepare(`SELECT snapshotId,payloadJson,status,reconciliationStatus,createdAt
      FROM business_export_snapshots
      WHERE businessType='SHOPEE' AND reportDate=?
      ORDER BY id DESC LIMIT 20`).all(date);
  }catch{
    try{snapshots=db.prepare(`SELECT snapshotId,payloadJson,status,reconciliationStatus,createdAt
      FROM business_export_snapshots
      WHERE businessType='SHOPEE' AND reportDate=?
      ORDER BY createdAt DESC LIMIT 20`).all(date)}catch{return null}
  }
  for(const row of snapshots){
    const status=String(row.status||'VALID').toUpperCase();
    const recon=String(row.reconciliationStatus||'COMPLETED').toUpperCase();
    if(status==='INVALID'||recon==='FAILED')continue;
    const payload=safeJson(row.payloadJson,{}),tabs=payload?.view?.detailTabs||{};
    const allRows=tabs?.[`${group}_all`]?.rows||tabs?.byRecipientGroup?.[group]?.all?.rows||[];
    const podRows=tabs?.[`${group}_pod`]?.rows||tabs?.byRecipientGroup?.[group]?.pod?.rows||[];
    const allBills=uniqueBills(allRows);
    if(!sameBills(sourceBills,allBills))continue;
    const podBills=uniqueBills(podRows).filter(code=>sourceBills.includes(code));
    return{
      authoritative:true,bills:podBills,sourceCount:sourceBills.length,resolvedCount:allBills.length,
      source:'IMMUTABLE_SHOPEE_COMPLETED_SNAPSHOT',snapshotId:String(row.snapshotId||'')
    };
  }
  return null;
}

export function persistentSelectedDatePodTruth(db,businessType='',reportDate=''){
  const type=String(businessType||'').trim().toUpperCase(),date=dateKey(reportDate);
  if(!date)return{authoritative:false,bills:[],sourceCount:0,resolvedCount:0,source:'REPORT_DATE_MISSING'};
  const batch=latestValidBatch(db,date);
  if(!batch)return{authoritative:false,bills:[],sourceCount:0,resolvedCount:0,source:'LATEST_VALID_BATCH_MISSING'};

  try{
    if(type==='WHPP'){
      const truth=loadWhppCanonicalTruth(date,String(batch.snapshotId||''),db);
      const rows=Array.isArray(truth?.rows)?truth.rows:[];
      const bills=rows
        .filter(row=>row?.truthEvidence?.pod===true||Number(row?.isPod||0)===1||row?.是否POD==='是'||String(row?.currentState||'').toUpperCase()==='POD')
        .map(row=>String(row.shipmentCode||row.运单号||'').trim().toUpperCase())
        .filter(Boolean);
      const sourceCount=Number(truth?.total||0);
      return{
        authoritative:sourceCount>0&&rows.length===sourceCount,
        bills:[...new Set(bills)],
        sourceCount,
        resolvedCount:rows.length,
        source:'WHPP_CANONICAL_TRUTH'
      };
    }

    if(!['SHOPEECN','SHOPEEVN'].includes(type))return{authoritative:false,bills:[],sourceCount:0,resolvedCount:0,source:'UNSUPPORTED_BUSINESS'};
    const group=type==='SHOPEECN'?'CN':'VN';
    const sourceRows=db.prepare(`
      SELECT u.shipmentCode
      FROM unified_import_rows u
      WHERE u.batchId=? AND u.reportDate=? AND UPPER(TRIM(u.businessType))=?
      ORDER BY u.rowNumber,u.shipmentCode
    `).all(batch.batchId,date,type);

    const snapshotTruth=completedShopeeSnapshotPodTruth(db,date,group,sourceRows);
    if(snapshotTruth)return snapshotTruth;

    const rows=db.prepare(`
      SELECT u.shipmentCode,
             CASE
               WHEN COALESCE(f.isPod,0)=1 THEN 1
               WHEN UPPER(COALESCE(c.state,'')) IN ('POD','DELIVERED','SIGNED') THEN 1
               WHEN COALESCE(s.isPod,0)=1 OR TRIM(COALESCE(s.orderStatus,''))='85' THEN 1
               WHEN p.shipmentCode IS NOT NULL THEN 1
               ELSE 0
             END AS isPod
      FROM unified_import_rows u
      LEFT JOIN business_final_rows f
        ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      LEFT JOIN shipment_current_state c
        ON c.shipmentCode=u.shipmentCode AND c.reportDate=u.reportDate AND UPPER(TRIM(c.businessType))=UPPER(TRIM(u.businessType))
      LEFT JOIN business_scan_results s
        ON s.businessType='SHOPEE' AND s.shipmentCode=u.shipmentCode AND s.reportDate=u.reportDate
      LEFT JOIN business_pod_locks p
        ON p.businessType='SHOPEE' AND p.shipmentCode=u.shipmentCode
      WHERE u.batchId=? AND u.reportDate=? AND UPPER(TRIM(u.businessType))=?
      ORDER BY u.rowNumber,u.shipmentCode
    `).all(batch.batchId,date,type);
    const unique=new Map();
    for(const row of rows){
      const bill=String(row.shipmentCode||'').trim().toUpperCase();
      if(bill&&!unique.has(bill))unique.set(bill,row);
    }
    const formalRows=[...unique.values()];
    const bills=formalRows.filter(row=>Number(row.isPod||0)===1)
      .map(row=>String(row.shipmentCode||'').trim().toUpperCase()).filter(Boolean);
    return{
      authoritative:bills.length>0,
      bills,
      sourceCount:formalRows.length,
      resolvedCount:formalRows.length,
      source:'FORMAL_DASHBOARD_MEMBERSHIP_SQL'
    };
  }catch(error){
    return{authoritative:false,bills:[],sourceCount:0,resolvedCount:0,source:'PERSISTENT_TRUTH_ERROR',error:String(error?.message||error)}
  }
}
export function persistentSelectedDatePodBills(db,businessType='',reportDate=''){
  return persistentSelectedDatePodTruth(db,businessType,reportDate).bills;
}

export function persistentWhppCompletionTruth(db,reportDate=''){
  const date=dateKey(reportDate);
  if(!date)return{locked:false,reportDate:'',reason:'REPORT_DATE_MISSING',sourceCount:0,finalCount:0};
  const batch=latestValidBatch(db,date);

  // V738: the unified snapshot is the highest-level durable owner of the
  // three-family lifecycle. Once the exact selected-date snapshot is COMPLETED,
  // WHPP must never be demoted by a slower downstream canonical reconstruction.
  // This is also the fast path used by /api/whpp/progress so a 7s browser read
  // cannot time out and falsely paint a completed date as "WHPP待处理".
  if(batch?.snapshotId){
    try{
      const unified=db.prepare("SELECT status,createdAt FROM unified_snapshots WHERE snapshotId=? LIMIT 1").get(batch.snapshotId)||null;
      if(String(unified?.status||'').toUpperCase()==='COMPLETED'){
        let sourceCount=0;
        try{sourceCount=Number(db.prepare("SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) count FROM unified_import_rows WHERE batchId=? AND reportDate=? AND UPPER(TRIM(businessType))='WHPP'").get(batch.batchId,date)?.count||0)}catch{}
        return{
          locked:true,finalized:true,reportDate:date,sourceCount,finalCount:sourceCount,
          canonicalTotal:sourceCount,canonicalResolved:sourceCount,
          unifiedCompleted:true,unifiedWhppCompleted:true,
          snapshotLocked:false,dailyLocked:false,historyLocked:false,membershipMatches:true,
          snapshotId:String(batch.snapshotId||''),finalizedAt:String(unified?.createdAt||''),
          completionSource:'UNIFIED_COMPLETED_FAST_PATH',
          reason:'PERSISTED_WHPP_COMPLETED'
        };
      }
    }catch{}
  }

  let daily=null,history=null,snapshot=null,unifiedSnapshot=null,finalCount=0,sourceCount=0,canonical=null;
  try{daily=db.prepare("SELECT totalCount,summaryJson,updatedAt FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)||null}catch{}
  try{history=db.prepare("SELECT summaryJson,updatedAt FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)||null}catch{}
  try{snapshot=db.prepare(`SELECT snapshotId,generatedAt,createdAt
      FROM business_export_snapshots
      WHERE businessType='WHPP' AND reportDate=?
        AND COALESCE(status,'VALID')='VALID'
        AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'
      ORDER BY createdAt DESC LIMIT 1`).get(date)||null}catch{}
  try{finalCount=Number(db.prepare("SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) count FROM business_final_rows WHERE businessType='WHPP' AND reportDate=?").get(date)?.count||0)}catch{}
  try{sourceCount=batch?Number(db.prepare("SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) count FROM unified_import_rows WHERE batchId=? AND reportDate=? AND UPPER(TRIM(businessType))='WHPP'").get(batch.batchId,date)?.count||0):0}catch{}
  try{unifiedSnapshot=batch?db.prepare("SELECT status,payloadJson,createdAt FROM unified_snapshots WHERE snapshotId=? LIMIT 1").get(batch.snapshotId)||null:null}catch{}
  try{canonical=loadWhppCanonicalTruth(date,String(batch?.snapshotId||''),db)}catch{}

  const dailySummary=safeJson(daily?.summaryJson,{});
  const historySummary=safeJson(history?.summaryJson,{});
  const unifiedPayload=safeJson(unifiedSnapshot?.payloadJson,{});
  const canonicalTotal=Number(canonical?.total||0);
  const canonicalResolved=Array.isArray(canonical?.rows)?canonical.rows.length:0;
  const membershipMatches=(canonicalTotal>0&&canonicalResolved===canonicalTotal)
    ||(finalCount>0&&(!sourceCount||finalCount===sourceCount));

  const snapshotLocked=Boolean(snapshot?.snapshotId);
  const dailyLocked=Boolean(dailySummary.completed===true&&['COMPLETED','COMPLETED_WITH_RETRY'].includes(String(dailySummary.snapshotStatus||dailySummary.reconciliationStatus||'').toUpperCase()));
  const historyBalanced=Boolean(history&&(historySummary.accounting?.balanced===true||Number(historySummary.total||historySummary.accounting?.total||0)>0));
  const historyLocked=historyBalanced&&membershipMatches;

  const unifiedCompleted=String(unifiedSnapshot?.status||'').toUpperCase()==='COMPLETED';
  const unifiedChildStatus=String(unifiedPayload?.parentRun?.children?.WHPP?.status||'').toUpperCase();
  const unifiedWhppCompleted=unifiedCompleted&&(
    unifiedChildStatus==='COMPLETED'
    ||Boolean(unifiedPayload?.sourceSnapshots?.WHPP)
    ||String(unifiedPayload?.validationStatus||'').toUpperCase()==='VALID_COMPLETED'
    ||String(unifiedPayload?.reconciliationStatus||'').toUpperCase()==='PASSED'
    ||unifiedCompleted
  );

  const locked=unifiedWhppCompleted||membershipMatches&&(snapshotLocked||dailyLocked||historyLocked);
  const completionSource=unifiedWhppCompleted?'UNIFIED_COMPLETED'
    :snapshotLocked?'IMMUTABLE_EXPORT_SNAPSHOT'
    :dailyLocked?'DAILY_SUMMARY'
    :historyLocked?'FINAL_ROWS_HISTORY':'';

  return{
    locked,finalized:locked,reportDate:date,sourceCount,finalCount,
    canonicalTotal,canonicalResolved,unifiedCompleted,unifiedWhppCompleted,
    snapshotLocked,dailyLocked,historyLocked,membershipMatches,
    snapshotId:String(snapshot?.snapshotId||dailySummary.finalizedSnapshotId||historySummary.snapshotId||batch?.snapshotId||''),
    finalizedAt:String(dailySummary.finalizedAt||snapshot?.generatedAt||snapshot?.createdAt||unifiedSnapshot?.createdAt||history?.updatedAt||''),
    completionSource,
    reason:locked?'PERSISTED_WHPP_COMPLETED'
      :sourceCount&&finalCount!==sourceCount?'SOURCE_FINAL_MEMBERSHIP_MISMATCH'
      :'PERSISTED_WHPP_INCOMPLETE'
  };
}
