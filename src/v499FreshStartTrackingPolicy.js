import { getDb } from './db.js';

export const V499_FRESH_START_TRACKING_POLICY_ID='2026-09-10-v500-managed-fresh-start-v246-gate-v1';
export const V499_FRESH_START_READY_KEY='v499_fresh_start_tracking_ready';

// Managed bootstrap deliberately starts in recovery-safe mode. On a large legacy
// database, immediately lifting that guard causes the V246 startup 90-day/30-day
// reconciliation to run on the web process and can starve first paint. Keep the
// managed disable in place until the user-authorized full purge has completed and
// written an explicit fresh-start marker. Non-managed/direct starts keep the prior
// behavior. A separate HARD flag still provides an emergency stop at any time.
const hardDisable=String(process.env.CE_QC_HARD_DISABLE_V246_TRACKING||'')==='1';
const inheritedDisable=String(process.env.CE_QC_DISABLE_V246_TRACKING||'')==='1';
const readyOverride=String(process.env.CE_QC_V499_FRESH_START_READY_OVERRIDE||'').trim();
let freshStartReady=false;
if(readyOverride==='1')freshStartReady=true;
else if(readyOverride==='0')freshStartReady=false;
else{
  try{
    const db=getDb();
    freshStartReady=String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(V499_FRESH_START_READY_KEY)?.value||'')==='1';
  }catch{}
}

if(inheritedDisable&&!hardDisable&&freshStartReady)delete process.env.CE_QC_DISABLE_V246_TRACKING;

export function inspectV499FreshStartTrackingPolicy(){
  const v246Enabled=String(process.env.CE_QC_DISABLE_V246_TRACKING||'')!=='1';
  return {
    id:V499_FRESH_START_TRACKING_POLICY_ID,
    hardDisable,
    inheritedDisable,
    freshStartReady,
    waitingForFreshStart:Boolean(inheritedDisable&&!hardDisable&&!freshStartReady),
    v246Enabled
  };
}

console.info('[CE-QC][V499_FRESH_START_TRACKING]',JSON.stringify(inspectV499FreshStartTrackingPolicy()));