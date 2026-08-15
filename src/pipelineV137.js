import { runQcPipeline as runQcPipelineLegacy, reconcileShopeeStateFromEvidence } from './pipeline.js';
import { decorateLocationDimensions } from './locationDimensionsV137.js';

export { reconcileShopeeStateFromEvidence };
export const PIPELINE_V137_ID='2026-08-15-v137-scan-only-final-reconciliation-v3';

function billOf(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();}
function unique(values=[]){return [...new Set((values||[]).map(value=>String(value||'').trim().toUpperCase()).filter(Boolean))];}
function isShopee(state={}){return String(state.businessType||'').toUpperCase()==='SHOPEE';}
function tags(row,extra){return [...new Set([...(Array.isArray(row?.tags)?row.tags:[]),extra].filter(Boolean))];}

function cancellationRow(source={},scanRow={},bill=''){
  return {...source,...scanRow,shipmentCode:bill,运单号:bill,
    orderStatus:'10',currentState:'ORDER_CANCELLED',scanNormalizedState:'ORDER_CANCELLED',
    primaryCategory:'订单取消',主分类:'订单取消',异常分类:'订单取消',订单取消:'是',取消状态:'已取消',
    是否POD:'否',POD状态:'不适用(订单取消)',退回状态:'未退回',trackRequired:false,trackSkippedReason:'ORDER_CANCELLED',
    carry状态:'closed_cancelled',跨日状态:'已闭环',Pending状态:'否',Pending次数:0,Pending当前次数:0,pendingDistinctDayCount:0,Pending日期:'',Pending连续:'否',Pending连续性:'',Pending不连续:'否',
    OC状态:'否',OC天数:0,OC次数:0,盘点状态:'否',盘点天数:0,盘点次数:0,派送中停留天数:0,入库无扫描节点:'否',无轨迹:'否',
    tags:tags(scanRow,'ORDER_CANCELLED'),matchedRule:'NORMAL_FINAL_HUB',命中规则:'ORDER_STATUS_10',QC判断:'订单扫描orderStatus=10，订单已取消，按正常终态闭环；不进入轨迹，不计未POD/Pending/OC/普通遗留异常'};
}

function holdRow(source={},scanRow={},bill=''){
  const status=String(scanRow.orderStatus||'').trim();
  return {...source,...scanRow,shipmentCode:bill,运单号:bill,currentState:'SCAN_STATUS_HOLD',scanNormalizedState:'SCAN_STATUS_HOLD',
    primaryCategory:'扫描状态待识别',主分类:'扫描状态待识别',异常分类:'扫描状态待识别',是否POD:'否',POD状态:'未POD',退回状态:'未退回',
    trackRequired:false,trackSkippedReason:'SCAN_STATUS_NOT_TRACKABLE',carry状态:'active',跨日状态:'未闭环',Pending状态:'否',Pending次数:0,Pending当前次数:0,pendingDistinctDayCount:0,Pending日期:'',Pending连续:'否',Pending连续性:'',Pending不连续:'否',
    OC状态:'否',OC天数:0,OC次数:0,盘点状态:'否',盘点天数:0,盘点次数:0,派送中停留天数:0,入库无扫描节点:'否',无轨迹:'否',轨迹节点数:0,
    tags:tags(scanRow,'SCAN_STATUS_HOLD'),systemHold:true,API状态:'已跳过',查询状态:'scan_status_hold',QC判断:`扫描orderStatus=${status||'UNKNOWN'}不属于50/60/70开放轨迹状态；未调用CE轨迹接口，保留后台下一轮重新扫描`};
}

function decorateCoreRows(state={}){
  if(isShopee(state))return state;
  const daily=new Map((state.dailyParseRows||[]).map(row=>[billOf(row),row]));
  state.finalRows=(state.finalRows||[]).map(row=>decorateLocationDimensions(row,daily.get(billOf(row))||{}));
  state.trackResults=(state.trackResults||[]).map(row=>decorateLocationDimensions(row,daily.get(billOf(row))||{}));
  return state;
}

export function reconcileCoreScanOnlyState(state={}){
  if(isShopee(state))return state;
  const scans=Array.isArray(state.scanResults)?state.scanResults:[];
  const daily=new Map((state.dailyParseRows||[]).map(row=>[billOf(row),row]));
  const existing=new Map((state.finalRows||[]).map(row=>[billOf(row),row]).filter(([bill])=>bill));
  const holds=[];let recovered=0;

  for(const scanRow of scans){
    const bill=billOf(scanRow);if(!bill||existing.has(bill))continue;
    const scanState=String(scanRow.currentState||scanRow.scanNormalizedState||'').toUpperCase();
    if(!['ORDER_CANCELLED','SCAN_STATUS_HOLD'].includes(scanState))continue;
    const source=daily.get(bill)||{};
    const raw=scanState==='ORDER_CANCELLED'?cancellationRow(source,scanRow,bill):holdRow(source,scanRow,bill);
    raw.reportDate=state.reportDate||source.reportDate||'';
    raw.businessType=source.businessType||scanRow.businessType||'CCSL';
    const row=decorateLocationDimensions(raw,source);
    existing.set(bill,row);recovered++;
    if(scanState==='SCAN_STATUS_HOLD')holds.push(bill);
  }

  if(recovered){
    state.finalRows=[...existing.values()];
    const currentCarry=unique(state.nextCarryBills?.length?state.nextCarryBills:state.carryBills||[]);
    state.nextCarryBills=unique([...currentCarry,...holds]);
    state.carryBills=[...state.nextCarryBills];
    state.lastRunSummary={...(state.lastRunSummary||{}),nextCarry:state.nextCarryBills.length,scanOnlyRecovered:recovered,scanStatusHolds:holds.length,pipelineReconciliation:PIPELINE_V137_ID};
    state.lastRun={...(state.lastRun||{}),...state.lastRunSummary};
  }
  decorateCoreRows(state);
  return state;
}

export async function runQcPipeline(args={}){
  const state=args.state||{};
  try{
    const result=await runQcPipelineLegacy(args);
    if(result?.state&&!isShopee(result.state))reconcileCoreScanOnlyState(result.state);
    return result;
  }catch(error){
    try{if(!isShopee(state))reconcileCoreScanOnlyState(state);}catch(reconcileError){console.error('[CE-QC][V137_PIPELINE_RECONCILE]',reconcileError?.stack||reconcileError);}
    throw error;
  }
}
