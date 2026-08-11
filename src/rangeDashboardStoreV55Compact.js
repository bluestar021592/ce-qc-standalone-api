import { loadRangeDashboard as loadRangeDashboardV58 } from './rangeDashboardStoreV58.js';

// V58 keeps V55's canonical row source but applies the final carry/severe thresholds
// before bootstrap/business-state responses are compacted. Full shipment drill-down
// remains on demand via /api/v55/metric-detail.
export function loadRangeDashboard(fromDate,toDate){
  const range=loadRangeDashboardV58(fromDate,toDate);
  for(const state of Object.values(range.states||{}))compactState(state);
  for(const state of Object.values(range.aggregates||{}))compactState(state);
  return {...range,queryMode:`${range.queryMode||'SQL'}+COMPACT_V58`};
}

function compactState(state){
  if(!state)return;
  state.finalRows=[];
  compactTabs(state.detailTabs);
  compactTabs(state.dashboard?.detailTabs);
}

function compactTabs(tabs){
  if(!tabs||typeof tabs!=='object')return;
  for(const [key,value] of Object.entries(tabs)){
    if(!value||typeof value!=='object')continue;
    const rows=Array.isArray(value.rows)?value.rows:[];
    if(key==='dashboard')value.rows=rows.slice(0,100);
    else if(['coreAbnormal','abnormal','severeAbnormal'].includes(key))value.rows=rows.slice(0,300);
    else value.rows=[];
  }
}

export const RANGE_DASHBOARD_V55_COMPACT_ID='2026-08-11-v58-carry-threshold-compact-v1';
