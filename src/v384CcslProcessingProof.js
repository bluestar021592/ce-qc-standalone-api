export const V384_CCSL_PROCESSING_PROOF_ID='2026-08-31-v384-scan-success-required-track-final-proof-v1';
const SCAN_TERMINAL_STATUSES=new Set(['85','100']);

function text(value=''){return String(value??'').trim();}
function billOf(row={}){return text(row.运单号||row.shipmentCode||row.waybill||row.billNo).toUpperCase();}
function truthy(value){return value===true||value===1||String(value||'').toLowerCase()==='true'||String(value||'')==='是';}
function parseJson(value,fallback={}){try{return value&&typeof value==='object'?value:JSON.parse(String(value||''))||fallback;}catch{return fallback;}}

function scanFailed(row={}){
  if(!row||!billOf(row))return true;
  const raw=parseJson(row.rawJson,{});
  const joined=[row.scanCategory,row.扫描分类,row.currentState,row.查询状态,row.API状态,row.errorMessage,row.错误信息,raw?.查询状态,raw?.API状态,raw?.errorMessage,raw?.错误信息]
    .map(text).join('|').toUpperCase();
  return joined.includes('REFRESH_FAILED')||joined.includes('API失败')||joined.includes('SCAN_PENDING_RETRY')||joined.includes('订单扫描待重试');
}
function scanTerminal(row={}){
  const raw=parseJson(row.rawJson,{});
  const orderStatus=text(row.orderStatus||raw?.orderStatus);
  return SCAN_TERMINAL_STATUSES.has(orderStatus)||truthy(row.isPod)||truthy(row.是否POD)||text(row.退回状态)==='已退回';
}
function finalProcessed(row={}){
  if(!row||!billOf(row))return false;
  const raw=parseJson(row.rawJson,{});
  const joined=[row.primaryCategory,row.category,row.异常分类,row.主分类,row.qcConclusion,row.QC判断,row.查询状态,row.API状态,row.errorMessage,row.错误信息,raw?.primaryCategory,raw?.异常分类,raw?.查询状态,raw?.API状态,raw?.errorMessage,raw?.错误信息]
    .map(text).join('|').toUpperCase();
  return !joined.includes('REFRESH_FAILED')&&!joined.includes('API失败')&&!joined.includes('待重试')&&!joined.includes('SCAN_PENDING_RETRY');
}

export function evaluateV384CcslMember({shipmentCode='',scanRow=null,finalRow=null,podLocked=false}={}){
  const bill=text(shipmentCode||billOf(scanRow)||billOf(finalRow)).toUpperCase();
  if(!bill)return{shipmentCode:'',covered:false,reason:'MISSING_SHIPMENT_CODE'};
  if(podLocked)return{shipmentCode:bill,covered:true,reason:'POD_LOCK'};
  if(!scanRow)return{shipmentCode:bill,covered:false,reason:'SCAN_MISSING'};
  if(scanFailed(scanRow))return{shipmentCode:bill,covered:false,reason:'SCAN_FAILED_OR_RETRY'};
  if(scanTerminal(scanRow))return{shipmentCode:bill,covered:true,reason:'SCAN_TERMINAL'};
  if(finalProcessed(finalRow))return{shipmentCode:bill,covered:true,reason:'TRACK_FINAL_PROCESSED'};
  return{shipmentCode:bill,covered:false,reason:'TRACK_REQUIRED_WITHOUT_FINAL_PROOF'};
}

export function buildV384CcslProcessingProof({sourceBills=[],scanResults=[],finalRows=[],podLocks=[]}={}){
  const source=[...new Set((sourceBills||[]).map(item=>text(typeof item==='string'?item:billOf(item)).toUpperCase()).filter(Boolean))];
  const scanBy=new Map();
  for(const row of scanResults||[]){const bill=billOf(row);if(bill)scanBy.set(bill,row);}
  const finalBy=new Map();
  for(const row of finalRows||[]){const bill=billOf(row);if(bill)finalBy.set(bill,row);}
  const podSet=new Set((podLocks||[]).map(item=>text(typeof item==='string'?item:billOf(item)).toUpperCase()).filter(Boolean));
  const details=source.map(shipmentCode=>evaluateV384CcslMember({shipmentCode,scanRow:scanBy.get(shipmentCode)||null,finalRow:finalBy.get(shipmentCode)||null,podLocked:podSet.has(shipmentCode)}));
  const covered=details.filter(item=>item.covered).length;
  const reasons=Object.fromEntries([...new Set(details.map(item=>item.reason))].map(reason=>[reason,details.filter(item=>item.reason===reason).length]));
  const missingDetails=details.filter(item=>!item.covered);
  return{
    id:V384_CCSL_PROCESSING_PROOF_ID,
    source:source.length,covered,missing:Math.max(0,source.length-covered),complete:covered>=source.length,
    scanRows:scanBy.size,finalRows:finalBy.size,podLocked:podSet.size,reasons,
    missingBills:missingDetails.slice(0,50).map(item=>item.shipmentCode),
    missingReasons:missingDetails.slice(0,50)
  };
}

function persistedProofSql(boundary=''){
  const scanBoundary=boundary?" AND COALESCE(s.updatedAt,'')>=?":'';
  const finalBoundary=boundary?" AND COALESCE(f.updatedAt,'')>=?":'';
  return `(
    EXISTS (SELECT 1 FROM pod_locks p WHERE p.shipmentCode=u.shipmentCode)
    OR EXISTS (
      SELECT 1 FROM scan_results s
      WHERE s.reportDate=u.reportDate AND s.shipmentCode=u.shipmentCode${scanBoundary}
        AND UPPER(COALESCE(s.scanCategory,'')) NOT LIKE '%API失败%'
        AND UPPER(COALESCE(s.scanCategory,'')) NOT LIKE '%待重试%'
        AND (
          COALESCE(s.isPod,0)=1 OR COALESCE(s.orderStatus,'') IN ('85','100')
          OR EXISTS (
            SELECT 1 FROM final_rows f
            WHERE f.reportDate=u.reportDate AND f.shipmentCode=u.shipmentCode${finalBoundary}
              AND UPPER(COALESCE(f.primaryCategory,'')) NOT LIKE '%待重试%'
              AND UPPER(COALESCE(f.category,'')) NOT LIKE '%待重试%'
              AND UPPER(COALESCE(f.qcConclusion,'')) NOT LIKE '%API失败%'
          )
        )
    )
  )`;
}

export function readV384CcslProcessingProof(db,{reportDate='',snapshotId='',boundary='',includeMissingBills=true}={}){
  const date=text(reportDate),sid=text(snapshotId),life=text(boundary);
  if(!date||!sid)return{id:V384_CCSL_PROCESSING_PROOF_ID,source:0,covered:0,missing:0,complete:false,reasons:{INVALID_SCOPE:1},missingBills:[],missingReasons:[],lifecycleBoundary:life};
  const proofSql=persistedProofSql(life);
  const countParams=life?[life,life,sid,date]:[sid,date];
  const row=db.prepare(`SELECT COUNT(*) source,COALESCE(SUM(CASE WHEN ${proofSql} THEN 1 ELSE 0 END),0) covered
    FROM unified_import_rows u
    WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType IN ('CE','CEAF','TBKH','ALI1688')`).get(...countParams)||{};
  const source=Number(row.source||0),covered=Number(row.covered||0),missing=Math.max(0,source-covered);
  let missingBills=[];
  if(includeMissingBills!==false&&missing>0){
    const missingParams=[sid,date];
    if(life)missingParams.push(life,life);
    missingBills=db.prepare(`SELECT u.shipmentCode FROM unified_import_rows u
      WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType IN ('CE','CEAF','TBKH','ALI1688') AND NOT ${proofSql}
      ORDER BY u.shipmentCode LIMIT 50`).all(...missingParams).map(item=>text(item.shipmentCode).toUpperCase()).filter(Boolean);
  }
  return{
    id:V384_CCSL_PROCESSING_PROOF_ID,source,covered,missing,complete:covered>=source,
    reasons:missing?{MISSING_VALID_PROCESSING_PROOF:missing}:{},missingBills,
    missingReasons:missingBills.map(shipmentCode=>({shipmentCode,covered:false,reason:'MISSING_VALID_PROCESSING_PROOF'})),
    lifecycleBoundary:life,queryMode:includeMissingBills===false?'INDEXED_EXISTS_COUNT_ONLY':'INDEXED_EXISTS_CURRENT_SNAPSHOT_ONLY'
  };
}
