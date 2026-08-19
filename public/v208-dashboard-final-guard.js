(function retireV208DashboardFinalGuard(global){
  'use strict';
  if(global.__CE_QC_V208_DASHBOARD_FINAL_GUARD__)return;
  global.__CE_QC_V208_DASHBOARD_FINAL_GUARD__='2026-08-19-v221-retired-passive-v1';
  // V221 keeps this asset as a compatibility marker only. Exact SHOPEE 3001→POD
  // timing and attempt evidence remain backend-owned; this file must not create
  // MutationObservers, polling timers, duplicate cards, or competing averages.
  console.info('[CE-QC][V208_RETIRED] V221 passive mode; no dashboard DOM overlay or polling.');
})(window);