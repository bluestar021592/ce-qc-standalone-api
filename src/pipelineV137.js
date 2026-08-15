import { runQcPipeline as runQcPipelineLegacy, reconcileShopeeStateFromEvidence } from './pipeline.js';
import { analyzeShipment } from './analyzer.js';

export { reconcileShopeeStateFromEvidence };
export const PIPELINE_V137_ID='2026-08-15-v137-scan-only-final-reconciliation-v1';

function billOf(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();}
function unique(values=[]){return [...new Set((values||[]).map(value=>String(value||'').trim().toUpperCase()).filter(Boolean))];}
function isShopee(state={}){return String(state.businessType||'').toUpperCase()==='SHOPEE';}

function holdEvent(row={}){
  const bill=billOf(row);const status=String(row.orderStatus||'').trim();
  return {shipmentCode:bill,eventCode:'SCAN_STATUS_HOLD',trackingEventCode:'SCAN_STATUS_HOLD',syntheticType:'SCAN_STATUS_HOLD',__ceQcSynthetic:'SCAN_STATUS_HOLD',scanOrderStatus:status,eventTime:'',trackingEventDesc:`orderStatus=${status||'UNKNOWN'} local scan hold`};
}

export function reconcileCoreScanOnlyState(state={}){
  if(isShopee(state))return state;
  const scans=Array.isArray(state.scanResults)?state.scanResults:[];
  const daily=new Map((state.dailyParseRows||[]).map(row=>[billOf(row),row]));
  const existing=new Map((state.finalRows||[]).map(row=>[billOf(row),row]).filter(([bill])=>bill));
  const holds=[];
  const recovered=[];

  for(const scanRow of scans){
    const bill=billOf(scanRow);if(!bill||existing.has(bill))continue;
    const scanState=String(scanRow.currentState||scanRow.scanNormalizedState||'').toUpperCase();
    if(!['ORDER_CANCELLED','SCAN_STATUS_HOLD'].includes(scanState))continue;
    const events=scanState==='SCAN_STATUS_HOLD'?[holdEvent(scanRow)]:[];
    const analyzed=analyzeShipment({waybill:bill,scanRow,events,reportDate:state.reportDate||''});
    const source=daily.get(bill)||{};
    const row={...source,...scanRow,...analyzed,shipmentCode:bill,运单号:bill,reportDate:state.reportDate||source.reportDate||'',businessType:source.businessType||scanRow.businessType||'CCSL'};
    existing.set(bill,row);recovered.push(row);
    if(scanState==='SCAN_STATUS_HOLD')holds.push(bill);
  }

  if(!recovered.length)return state;
  state.finalRows=[...existing.values()];
  const currentCarry=unique(state.nextCarryBills?.length?state.nextCarryBills:state.carryBills||[]);
  state.nextCarryBills=unique([...currentCarry,...holds]);
  state.carryBills=[...state.nextCarryBills];
  state.lastRunSummary={...(state.lastRunSummary||{}),nextCarry:state.nextCarryBills.length,scanOnlyRecovered:recovered.length,scanStatusHolds:holds.length,pipelineReconciliation:PIPELINE_V137_ID};
  state.lastRun={...(state.lastRun||{}),...state.lastRunSummary};
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
