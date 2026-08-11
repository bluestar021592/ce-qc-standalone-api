import { loadRangeDashboard as loadRangeDashboardV55 } from './rangeDashboardStoreV55.js';
import { classifyFinalRoutingDestination, ROUTING_DESTINATIONS } from './routingDestinationV48.js';

const PATCH_ID='2026-08-11-v59-metric-detail-state-parity-v1';
const CCSL_TYPES=new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);

export function loadRangeDashboard(fromDate,toDate){
  const range=loadRangeDashboardV55(fromDate,toDate);
  for(const state of Object.values(range.states||{}))patchState(state);
  for(const state of Object.values(range.aggregates||{}))patchState(state);
  return {...range,queryMode:`${range.queryMode||'SQL'}+CARRY_THRESHOLD_V58`,reconciliationRuleVersion:PATCH_ID};
}

// Metric drill-down must read the exact same already-built state/detailTabs that
// produced the card summary. Do not independently re-query/reclassify the same
// date range here: that previously allowed a visible card such as 金边门店=11 to
// open a second code path that returned 0 rows.
export function loadMetricDetail({businessType='CCSL',fromDate='',toDate='',tab='allData',page=1,pageSize=200}={}){
  const type=String(businessType||'CCSL').trim().toUpperCase();
  const key=normalizeDetailKey(type,String(tab||'allData'));
  const range=loadRangeDashboardV55(fromDate,toDate);
  const state=pickState(range,type);
  patchState(state);

  const detail=state?.detailTabs?.[key]||state?.dashboard?.detailTabs?.[key]||null;
  const rows=unique(detail?.rows||[]).map(normalizeRegistryRowDisplay);
  const safePage=Math.max(1,Number(page||1)||1);
  const safeSize=Math.max(1,Math.min(500,Number(pageSize||200)||200));
  const start=(safePage-1)*safeSize;
  return {
    ok:true,
    patchId:PATCH_ID,
    source:'V58_STATE_DETAIL_TABS',
    businessType:type,
    fromDate,
    toDate,
    tab:key,
    requestedTab:String(tab||''),
    page:safePage,
    pageSize:safeSize,
    total:rows.length,
    rows:rows.slice(start,start+safeSize)
  };
}

function normalizeDetailKey(type,key){
  const raw=String(key||'').trim();
  const common={
    all:'allData',
    cecnRetention:'ccslCnDiversion',
    ceztRetention:'ccslZtDiversion',
    ccsl580Diversion:'ccsl580Retention',
    cycle2plus:'cycle2'
  };
  if(SHOPEE_TYPES.has(type)||type==='SHOPEE'){
    const shopee={
      allData:'all',podClosed:'pod',accountingReturned:'returned',accountingOpen:'unresolved',
      pendingAll:'pending1',pending2plus:'pending2',ocAll:'oc1',oc2plus:'oc2',
      cycle2plus:'cycle2'
    };
    return shopee[raw]||raw;
  }
  return common[raw]||raw;
}

function pickState(range,type){
  if(type==='CCSL')return range?.aggregates?.CCSL||null;
  if(type==='SHOPEE')return range?.aggregates?.SHOPEE||null;
  if(CCSL_TYPES.has(type)||SHOPEE_TYPES.has(type))return range?.states?.[type]||null;
  return null;
}

function patchState(state){
  if(!state)return;
  const tabs=state.detailTabs||{};
  const source=unique([...(tabs.coreAbnormal?.rows||[]),...(tabs.abnormal?.rows||[])]);
  const abnormal=source.filter(isActionableCarryRow).map(normalizeRegistryRowDisplay);
  const severe=abnormal.filter(isSevereCarryRow);
  setTab(tabs,'coreAbnormal','遗留异常',abnormal);
  setTab(tabs,'abnormal','遗留异常',abnormal);
  setTab(tabs,'severeAbnormal','严重异常',severe);
  renameRegistryTabs(tabs);
  if(state.dashboard?.detailTabs){
    setTab(state.dashboard.detailTabs,'coreAbnormal','遗留异常',abnormal);
    setTab(state.dashboard.detailTabs,'abnormal','遗留异常',abnormal);
    setTab(state.dashboard.detailTabs,'severeAbnormal','严重异常',severe);
    renameRegistryTabs(state.dashboard.detailTabs);
  }
  for(const summary of [state.v55Summary,state.dashboard?.v55Summary,state.dashboard?.metrics]){
    if(!summary||typeof summary!=='object')continue;
    summary.abnormal=abnormal.length;
    summary.severe=severe.length;
    summary.severeAbnormal=severe.length;
  }
  if(state.dashboard){
    state.dashboard.abnormalCount=abnormal.length;
    patchMetricRows(state.detailTabs?.dashboard?.rows,abnormal.length,severe.length);
    patchMetricRows(state.dashboard?.detailTabs?.dashboard?.rows,abnormal.length,severe.length);
  }
}

function renameRegistryTabs(tabs){
  if(!tabs||typeof tabs!=='object')return;
  for(const [keys,label] of [[['cecnRetention','ccslCnDiversion'],'CCSLCN'],[['ceztRetention','ccslZtDiversion'],'CEZT'],[['ccsl580Retention','ccsl580Diversion'],'CCSL580']]){
    for(const key of keys){
      if(!tabs[key])continue;
      tabs[key].label=label;
      if(Array.isArray(tabs[key].rows))tabs[key].rows=tabs[key].rows.map(normalizeRegistryRowDisplay);
    }
  }
}

function patchMetricRows(rows,abnormal,severe){
  if(!Array.isArray(rows))return;
  for(const row of rows){
    let label=String(row?.项目||row?.metricKey||row?.label||'').trim();
    const renamed=registryLabel(label);
    if(renamed!==label){
      if('项目'in row)row.项目=renamed;
      if('metricKey'in row)row.metricKey=renamed;
      if('label'in row)row.label=renamed;
      label=renamed;
    }
    if(label==='严重异常')assignMetric(row,severe);
    if(['遗留异常','当前异常'].includes(label))assignMetric(row,abnormal);
  }
}
function assignMetric(row,value){
  row.数值=Number(value||0);row.数值原值=Number(value||0);row.value=Number(value||0);
}
function setTab(tabs,key,label,rows){if(!tabs||typeof tabs!=='object')return;const values=unique(rows);tabs[key]={...(tabs[key]||{}),label,rows:values,total:values.length};}

function isActionableCarryRow(row={}){
  // CEZT / CCSLCN / CCSL580 are normal registration destinations. Once the
  // latest effective trajectory is there, the parcel must never appear in
  // 遗留异常/严重异常, regardless of old Pending/OC/盘点/history/category text.
  if(isNormalRegistryDestination(row))return false;

  const c=category(row);
  const pending=pendingDays(row),oc=ocDays(row),cycle=cycleDays(row);

  // Dedicated business-state thresholds own the decision. A 41-day-old source
  // record that is currently only “盘点1天” must not be promoted by generic age.
  if(/盘点/i.test(c)||cycle>0)return cycle>=2;
  if(/(?:^|[^A-Z])OC(?:\d|\b)/i.test(c)||oc>0)return oc>=2;
  if(/PENDING/i.test(c)||pending>0)return isPendingNonContinuous(row)||pending>=3;

  if(/门店途中/i.test(c))return shopTransferDays(row)>=2;
  if(/门店滞留|门店入库/i.test(c))return shopRetentionDays(row)>=2;
  if(/入库无扫描|工单/i.test(c))return true;
  if(/正常流转|PICKUP_SUCCESS|正常门店|派送中|待派送|正常$/i.test(c))return false;
  if(/严重超时未更新|SEVERE|CRITICAL|严重异常/i.test(`${c} ${row.severity||row.严重等级||''}`))return true;

  // V55 has already excluded terminal/normal-flow rows. Keep only rows that
  // still carry a concrete abnormal category after the V58 destination guard.
  return Boolean(c);
}

function isNormalRegistryDestination(row={}){
  if(classifyFinalRoutingDestination(row).destination)return true;
  return /^(?:CCSLCN_DIVERSION|CCSLZT_DIVERSION|CCSL580_(?:RETENTION|DIVERSION)|CECN_RETENTION|CEZT_RETENTION)$/i.test(category(row));
}

function normalizeRegistryRowDisplay(row={}){
  const destination=classifyFinalRoutingDestination(row).destination;
  const label=destination===ROUTING_DESTINATIONS.CCSLCN?'CCSLCN'
    :destination===ROUTING_DESTINATIONS.CCSLZT?'CEZT'
      :destination===ROUTING_DESTINATIONS.CCSL580?'CCSL580':'';
  if(!label)return row;
  return {...row,当前分类:label,登记状态:'正常登记'};
}

function isSevereCarryRow(row={}){
  if(!isActionableCarryRow(row))return false;
  const c=category(row);
  if(/严重超时未更新|SEVERE|CRITICAL|严重异常/i.test(`${c} ${row.severity||row.严重等级||''}`))return true;
  return Math.max(pendingDays(row),ocDays(row),cycleDays(row),number(row.节点未更新天数))>=3;
}

function registryLabel(value=''){
  const label=String(value||'').trim();
  if(['CCSLCN分流','CECN滞留包裹','CCSLCN滞留包裹'].includes(label))return'CCSLCN';
  if(['CCSLZT分流','CEZT滞留包裹','CCSLZT滞留包裹'].includes(label))return'CEZT';
  if(['580滞留包裹','CCSL580分流','CCSL580滞留包裹'].includes(label))return'CCSL580';
  return label;
}
function category(row){return String(row.primaryCategory||row.当前分类||row.主分类||row.异常分类||'').trim();}
function pendingDays(row){return Math.max(number(row.pendingDistinctDayCount??row.Pending当前次数??row.Pending次数??row.pendingDays),extractDays(category(row),'Pending'));}
function ocDays(row){return Math.max(number(row.OC天数??row.ocDays),extractDays(category(row),'OC'));}
function cycleDays(row){return Math.max(number(row.盘点天数??row.cycleCountDays),extractDays(category(row),'盘点'));}
function shopTransferDays(row){return Math.max(number(row.shopTransferNaturalDays??row.门店途中天数),extractDays(category(row),'门店途中'));}
function shopRetentionDays(row){return Math.max(number(row.shopRetentionNaturalDays??row.门店滞留天数),extractDays(category(row),'门店滞留'),extractDays(category(row),'门店入库'));}
function isPendingNonContinuous(row){return row.Pending不连续==='是'||/不连续/.test(String(row.pendingContinuity||row.pendingFactDateContinuity||row.Pending事实连续性||row.Pending连续性||''));}
function extractDays(text,prefix){const match=String(text||'').match(new RegExp(`${prefix}\\s*(\\d+)\\s*(?:天|次)?`,'i'));return match?Number(match[1]):0;}
function number(value){const n=Number(value||0);return Number.isFinite(n)?n:0;}
function unique(rows){const map=new Map();for(const row of rows||[]){const key=`${row.reportDate||''}|${row.businessType||''}|${String(row.shipmentCode||row.运单号||'').toUpperCase()}`;if(row.shipmentCode||row.运单号)map.set(key,row);}return[...map.values()];}

export const RANGE_DASHBOARD_V58_PATCH_ID=PATCH_ID;
