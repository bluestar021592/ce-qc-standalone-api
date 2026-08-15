import { getDb } from './db.js';
import { loadRangeDashboard as loadRangeDashboardV58 } from './rangeDashboardStoreV58.js';

export const RANGE_DASHBOARD_V136_TERMINAL_OVERLAY_ID='2026-08-15-v137-scoped-terminal-overlay-v2';
const OPEN_TABS=new Set(['accountingOpen','unresolved','ordinaryOpen','coreAbnormal','abnormal','severeAbnormal','pendingAll','pending1','pending2plus','pending2','pending3','pendingNonContinuous','ocAll','oc1','oc2plus','oc2','oc3','cycle2','cycle2plus','inboundNoScan','workOrderAbnormal','provinceOpen','deliveryStay','returnRequired','shopTransit','shopArrived','shopStuck','pvDelivery','pvStoreRetention','pvStoreInboundNoScan','pvOtherUnresolved']);
const LOOKUP_CHUNK=350;

export function loadRangeDashboard(fromDate,toDate){
  const range=loadRangeDashboardV58(fromDate,toDate);
  const bills=collectRangeBills(range);
  const authority=loadTerminalAuthority(bills);
  for(const state of Object.values(range.states||{}))patchState(state,authority);
  for(const state of Object.values(range.aggregates||{}))patchState(state,authority);
  compactRange(range);
  return {...range,queryMode:`${range.queryMode||'SQL'}+LATEST_TERMINAL_V137_SCOPED`,terminalAuthority:RANGE_DASHBOARD_V136_TERMINAL_OVERLAY_ID,terminalLookupBills:bills.length};
}

function collectRangeBills(range={}){
  const set=new Set();
  const addRows=rows=>{for(const row of rows||[]){const bill=billOf(row);if(bill)set.add(bill);}};
  for(const state of [...Object.values(range.states||{}),...Object.values(range.aggregates||{})]){
    if(!state)continue;
    addRows(state.finalRows);
    for(const tabs of [state.detailTabs,state.dashboard?.detailTabs]){
      if(!tabs)continue;
      for(const value of Object.values(tabs))if(Array.isArray(value?.rows))addRows(value.rows);
    }
  }
  return [...set];
}

function chunks(values,size=LOOKUP_CHUNK){const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;}
function loadTerminalAuthority(bills=[]){
  const db=getDb();const map=new Map();
  const absorb=(bill,row,priority)=>{bill=String(bill||'').trim().toUpperCase();if(!bill)return;const current=map.get(bill);if(current&&current.priority>priority)return;const truth=terminalTruth(row);if(truth)map.set(bill,{...truth,priority});};
  for(const batch of chunks(bills)){
    if(!batch.length)continue;
    const placeholders=batch.map(()=>'?').join(',');
    for(const row of db.prepare(`SELECT shipmentCode,status carryStatus,closeReason,stateJson carryJson,updatedAt carryUpdatedAt FROM carryover_open_items WHERE shipmentCode IN (${placeholders}) ORDER BY updatedAt`).all(...batch)){
      absorb(row.shipmentCode,{...safe(row.carryJson),state:row.closeReason||'',closeReason:row.closeReason||'',carryStatus:row.carryStatus||''},2);
    }
    for(const row of db.prepare(`SELECT shipmentCode,rawJson,primaryCategory,isPod,updatedAt FROM business_final_rows WHERE businessType IN ('SHOPEE','WHPP') AND shipmentCode IN (${placeholders}) ORDER BY updatedAt`).all(...batch)){
      absorb(row.shipmentCode,{...safe(row.rawJson),primaryCategory:row.primaryCategory,isPod:row.isPod},3);
    }
    for(const row of db.prepare(`SELECT shipmentCode,rawJson,primaryCategory,isPod,updatedAt FROM final_rows WHERE shipmentCode IN (${placeholders}) ORDER BY updatedAt`).all(...batch)){
      absorb(row.shipmentCode,{...safe(row.rawJson),primaryCategory:row.primaryCategory,isPod:row.isPod},3);
    }
    for(const row of db.prepare(`SELECT shipmentCode,state,stateJson,updatedAt FROM shipment_current_state WHERE shipmentCode IN (${placeholders})`).all(...batch)){
      absorb(row.shipmentCode,{...safe(row.stateJson),state:row.state||'',currentState:row.state||''},4);
    }
  }
  return map;
}
function safe(value){try{return typeof value==='object'&&value?value:JSON.parse(String(value||'{}'));}catch{return {};}}
function terminalTruth(row={}){
  const state=String(row.currentState||row.state||'').toUpperCase();const close=String(row.closeReason||'').toUpperCase();const cat=String(row.primaryCategory||row.主分类||row.异常分类||'').toUpperCase();const order=String(row.orderStatus??row.scanOrderStatus??'').trim();
  if(Number(row.isPod||0)===1||row.是否POD==='是'||row.POD状态==='POD'||order==='85'||state==='POD'||close==='POD')return {kind:'POD',currentState:'POD',category:'POD'};
  if(order==='100'||row.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(state)||['RETURNED','RETURN_COMPLETED'].includes(close)||cat==='退回')return {kind:'RETURNED',currentState:'RETURN_COMPLETED',category:'退回'};
  if(order==='10'||row.订单取消==='是'||row.取消状态==='已取消'||state==='ORDER_CANCELLED'||close==='ORDER_CANCELLED'||/订单取消|CANCEL/.test(cat))return {kind:'CANCELLED',currentState:'ORDER_CANCELLED',category:'订单取消'};
  const normal=new Set(['SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION','NORMAL_FINAL','NORMAL_FINAL_HUB']);
  if(normal.has(state)||normal.has(close)||normal.has(cat)||String(row.carryStatus||'').toUpperCase()==='CLOSED'&&/NORMAL|DIVERSION|PICKUP|580|CEZT|CECN/.test(`${state} ${close} ${cat}`))return {kind:'NORMAL',currentState:state||close||'NORMAL_FINAL',category:row.primaryCategory||row.主分类||'正常闭环'};
  return null;
}
function billOf(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();}
function applyTruth(row,truth){if(!truth)return row;const base={...row,currentState:truth.currentState,闭环状态:'已闭环',当前分类:truth.category,primaryCategory:truth.category};
  if(truth.kind==='POD')return {...base,isPod:1,是否POD:'是',POD状态:'POD'};
  if(truth.kind==='RETURNED')return {...base,isPod:0,是否POD:'否',POD状态:'不适用(已退回)',退回状态:'已退回'};
  if(truth.kind==='CANCELLED')return {...base,isPod:0,是否POD:'否',POD状态:'不适用(订单取消)',订单取消:'是',取消状态:'已取消',Pending次数:0,Pending当前次数:0,OC天数:0,盘点天数:0,入库无扫描节点:'否'};
  return {...base,POD状态:base.POD状态==='POD'?'POD':'不适用(正常闭环)'};
}
function isTerminal(row={}){return row.闭环状态==='已闭环'||['POD','RETURN_COMPLETED','RETURNED','ORDER_CANCELLED'].includes(String(row.currentState||'').toUpperCase());}
function unique(rows=[]){const m=new Map();for(const row of rows||[]){const b=billOf(row);if(b)m.set(b,row);}return [...m.values()];}
function tab(tabs,key){return tabs?.[key]||null;}
function setRows(tabs,key,rows){if(!tabs?.[key])return;const values=unique(rows);tabs[key]={...tabs[key],rows:values,total:values.length};}
function patchTabs(tabs,allRows,authority){if(!tabs)return;for(const [key,value] of Object.entries(tabs)){if(!value||!Array.isArray(value.rows))continue;let rows=value.rows.map(row=>applyTruth(row,authority.get(billOf(row))));if(OPEN_TABS.has(key))rows=rows.filter(row=>!isTerminal(row));setRows(tabs,key,rows);}
  const pod=allRows.filter(r=>String(r.currentState||'').toUpperCase()==='POD'||r.是否POD==='是');const returned=allRows.filter(r=>String(r.currentState||'').toUpperCase()==='RETURN_COMPLETED'||r.退回状态==='已退回');const cancelled=allRows.filter(r=>String(r.currentState||'').toUpperCase()==='ORDER_CANCELLED'||r.订单取消==='是');const open=allRows.filter(r=>!isTerminal(r));
  for(const key of ['podClosed','pod'])setRows(tabs,key,pod);for(const key of ['accountingReturned','returned'])setRows(tabs,key,returned);for(const key of ['accountingOpen','unresolved','ordinaryOpen'])setRows(tabs,key,open);setRows(tabs,'cancelled',cancelled);
}
function patchSummary(obj,tabs,allRows){if(!obj||typeof obj!=='object')return;const pod=(tab(tabs,'podClosed')||tab(tabs,'pod'))?.total||allRows.filter(r=>r.是否POD==='是').length;const returned=(tab(tabs,'accountingReturned')||tab(tabs,'returned'))?.total||allRows.filter(r=>r.退回状态==='已退回').length;const open=(tab(tabs,'accountingOpen')||tab(tabs,'unresolved'))?.total||allRows.filter(r=>!isTerminal(r)).length;const cancelled=tab(tabs,'cancelled')?.total||allRows.filter(r=>r.订单取消==='是').length;
  for(const [key,value] of [['pod',pod],['returned',returned],['open',open],['unresolved',open],['cancelled',cancelled]])if(Object.hasOwn(obj,key)||['pod','returned','unresolved'].includes(key))obj[key]=value;
  if(Object.hasOwn(obj,'podRate'))obj.podRate=allRows.length?Number((pod*100/allRows.length).toFixed(2)):0;
  const map=[['pending1','pendingAll'],['pending2','pending2plus'],['pending3','pending3'],['pendingNonContinuous','pendingNonContinuous'],['oc1','ocAll'],['oc2','oc2plus'],['oc3','oc3'],['cycle2','cycle2'],['inboundNoScan','inboundNoScan'],['provinceOpen','provinceOpen']];for(const [metric,key] of map){const t=tab(tabs,key);if(t&&Object.hasOwn(obj,metric))obj[metric]=t.total;}
}
function patchState(state,authority){if(!state)return;const tabs=state.detailTabs||{};const source=unique(state.finalRows||tabs.all?.rows||tabs.allData?.rows||[]);const allRows=source.map(row=>applyTruth(row,authority.get(billOf(row))));state.finalRows=allRows;patchTabs(tabs,allRows,authority);if(state.dashboard?.detailTabs)patchTabs(state.dashboard.detailTabs,allRows,authority);patchSummary(state.v55Summary,tabs,allRows);patchSummary(state.dashboard?.v55Summary,tabs,allRows);patchSummary(state.dashboard?.metrics,tabs,allRows);if(state.dashboard){const pod=(tab(tabs,'podClosed')||tab(tabs,'pod'))?.total||0;const open=(tab(tabs,'accountingOpen')||tab(tabs,'unresolved'))?.total||0;if(Object.hasOwn(state.dashboard,'todayPod'))state.dashboard.todayPod=pod;if(Object.hasOwn(state.dashboard,'abnormalCount'))state.dashboard.abnormalCount=(tab(tabs,'coreAbnormal')||tab(tabs,'abnormal'))?.total||open;}
}
function compactRange(range){for(const state of [...Object.values(range.states||{}),...Object.values(range.aggregates||{})]){if(!state)continue;state.finalRows=[];for(const tabs of [state.detailTabs,state.dashboard?.detailTabs]){if(!tabs)continue;for(const [key,value] of Object.entries(tabs)){if(!value||!Array.isArray(value.rows))continue;if(key==='dashboard')value.rows=value.rows.slice(0,100);else if(['coreAbnormal','abnormal','severeAbnormal'].includes(key))value.rows=value.rows.slice(0,300);else value.rows=[];}}}}

export const __test={collectRangeBills,terminalTruth};
