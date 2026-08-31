export const V384_CCSL_PROCESSING_PROOF_ID='2026-08-31-v384-scan-success-required-track-final-proof-v1';
const CCSL_TYPES=new Set(['CE','CEAF','TBKH','ALI1688']);
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

export function readV384CcslProcessingProof(db,{reportDate='',snapshotId=''}={}){
  const date=text(reportDate),sid=text(snapshotId);
  if(!date||!sid)return{id:V384_CCSL_PROCESSING_PROOF_ID,source:0,covered:0,missing:0,complete:false,scanRows:0,finalRows:0,podLocked:0,reasons:{INVALID_SCOPE:1},missingBills:[],missingReasons:[]};
  const sourceRows=db.prepare(`SELECT shipmentCode,businessType FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND businessType IN ('CE','CEAF','TBKH','ALI1688')`).all(sid,date)
    .filter(row=>CCSL_TYPES.has(text(row.businessType).toUpperCase()));
  const scanRows=db.prepare('SELECT * FROM scan_results WHERE reportDate=?').all(date);
  const finalRows=db.prepare('SELECT * FROM final_rows WHERE reportDate=?').all(date);
  const podLocks=db.prepare('SELECT shipmentCode FROM pod_locks').all();
  return buildV384CcslProcessingProof({sourceBills:sourceRows,scanResults:scanRows,finalRows,podLocks});
}
