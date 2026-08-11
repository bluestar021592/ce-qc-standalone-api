import { loadRangeDashboard as loadRangeDashboardV55 } from './rangeDashboardStoreV55.js';

// V55 correctness needs the canonical row set while it calculates each metric,
// but bootstrap/business-state responses must stay lightweight.  Keep exact
// totals and only a bounded residual-abnormal preview; full card drill-down is
// served on demand by /api/v55/metric-detail.
export function loadRangeDashboard(fromDate,toDate){
  const range=loadRangeDashboardV55(fromDate,toDate);
  for(const state of Object.values(range.states||{}))compactState(state);
  for(const state of Object.values(range.aggregates||{}))compactState(state);
  return {...range,queryMode:`${range.queryMode||'SQL'}+COMPACT_V55`};
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
    if(['coreAbnormal','abnormal'].includes(key))value.rows=rows.slice(0,300);
    else value.rows=[];
  }
}

export const RANGE_DASHBOARD_V55_COMPACT_ID='2026-08-11-v55-dashboard-reconciliation-compact-v1';
