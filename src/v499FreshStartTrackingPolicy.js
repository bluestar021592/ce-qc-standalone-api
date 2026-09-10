export const V499_FRESH_START_TRACKING_POLICY_ID='2026-09-10-v499-fresh-start-v246-auto-tracking-v1';

// Managed bootstrap still enables recovery-safe mode for heavy startup maintenance,
// but V246 is the lightweight operational freshness owner: hourly ledger anti-leak
// reconciliation + Cambodia 02:00 rolling-30-day/ALL-OPEN refresh. Do not let the
// temporary bootstrap recovery flag silently disable that production contract.
// A deliberate emergency stop remains available through the separate HARD flag.
const hardDisable=String(process.env.CE_QC_HARD_DISABLE_V246_TRACKING||'')==='1';
const inheritedDisable=String(process.env.CE_QC_DISABLE_V246_TRACKING||'')==='1';
if(inheritedDisable&&!hardDisable)delete process.env.CE_QC_DISABLE_V246_TRACKING;

export function inspectV499FreshStartTrackingPolicy(){
  return {
    id:V499_FRESH_START_TRACKING_POLICY_ID,
    hardDisable,
    inheritedDisable,
    v246Enabled:String(process.env.CE_QC_DISABLE_V246_TRACKING||'')!=='1'
  };
}

console.info('[CE-QC][V499_FRESH_START_TRACKING]',JSON.stringify(inspectV499FreshStartTrackingPolicy()));
